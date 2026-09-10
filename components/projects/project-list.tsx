"use client";

import { Fragment, useRef, useState, type RefObject, type UIEvent } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileImage,
  FolderOpen,
  Search,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useQueries, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { CreatorCell } from "@/components/creator-cell";
import { canvasPurchaseTargets } from "@/lib/canvas-purchase";
import { useDeleteProject, useProjects } from "@/lib/hooks/use-projects";
import { SAMPLE_ORDERS_KEY } from "@/lib/hooks/use-sample-orders";
import { useCustomers, useProducts, useSuppliers } from "@/lib/hooks/use-workspace-records";
import { formatDate } from "@/lib/format";
import { useAdminCreators } from "@/lib/hooks/use-admin-creators";
import { sendSamplePurchases } from "@/lib/sample-purchase-client";
import { getCanvasStore, type Canvas, type CanvasSendRecord, type Project } from "@/lib/store";
import { cn } from "@/lib/utils";

function displayValue(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Not set";
}

function formatCurrency(project: Project): string {
  if (!project.currencyCode) return "Not set";
  return project.currencySymbol
    ? `${project.currencyCode} (${project.currencySymbol})`
    : project.currencyCode;
}

function canvasStatusLabel(status: Canvas["status"]): string {
  if (status === "awaiting_approval") return "Await approval";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Draft";
}

function fuzzyMatch(value: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = value.toLocaleLowerCase();
  if (haystack.includes(needle)) return true;
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function getProjectSearchText(project: Project): string {
  return [
    project.customerName,
    project.employeeName,
    project.employeeTitle,
    project.employeeTel,
    project.name,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

interface ProjectColumnFilters {
  sequence: string;
  customer: string;
  employee: string;
  project: string;
  created: string;
  currency: string;
  destination: string;
  canvasCount: string;
}

const emptyProjectColumnFilters: ProjectColumnFilters = {
  sequence: "",
  customer: "",
  employee: "",
  project: "",
  created: "",
  currency: "",
  destination: "",
  canvasCount: "",
};

function latestCanvasSendSequence(records: readonly CanvasSendRecord[]): string {
  return (
    [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.sequence ?? "Not sent"
  );
}

function columnInputClassName(): string {
  return "bg-background h-8 min-w-28 text-xs normal-case";
}

function projectMatchesColumnFilters(input: {
  project: Project;
  filters: ProjectColumnFilters;
  canvases: readonly Canvas[] | undefined;
  sequence: string;
  canvasLoading: boolean;
}): boolean {
  const project = input.project;
  const employeeText = [
    project.employeeName,
    project.employeeTitle,
    project.employeeEmail,
    project.employeeTel,
  ]
    .filter(Boolean)
    .join(" ");
  const created = formatDate(project.createdAt);
  const canvasCount = input.canvases?.length.toString() ?? "";
  return (
    (input.canvasLoading || fuzzyMatch(input.sequence, input.filters.sequence)) &&
    fuzzyMatch(displayValue(project.customerName), input.filters.customer) &&
    fuzzyMatch(employeeText || "Not set", input.filters.employee) &&
    fuzzyMatch(project.name, input.filters.project) &&
    fuzzyMatch(created, input.filters.created) &&
    fuzzyMatch(formatCurrency(project), input.filters.currency) &&
    fuzzyMatch(displayValue(project.destinationCountryName), input.filters.destination) &&
    (input.canvasLoading || fuzzyMatch(canvasCount, input.filters.canvasCount))
  );
}

function ProjectCanvasDetailRow({
  project,
  canvases,
  loading,
  sendsByCanvasId,
  onOpenCanvas,
  isAdmin = false,
}: {
  project: Project;
  canvases: readonly Canvas[] | undefined;
  loading: boolean;
  sendsByCanvasId: Map<string, readonly CanvasSendRecord[]>;
  onOpenCanvas?: (projectId: string, canvasId: string) => void;
  isAdmin?: boolean;
}) {
  const suppliers = useSuppliers();
  const products = useProducts();
  const customers = useCustomers();
  const queryClient = useQueryClient();

  async function sendCanvasPurchase(canvas: Canvas) {
    try {
      const [fullCanvas, renderImages, storedSends] = await Promise.all([
        getCanvasStore().getCanvas(canvas.id),
        getCanvasStore().listImages(canvas.id),
        getCanvasStore().listCanvasSends(canvas.id),
      ]);
      const sends = storedSends.length ? storedSends : (sendsByCanvasId.get(canvas.id) ?? []);
      const approvedSend =
        sends.find((send) => send.status === "approved") ??
        [...sends].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (canvas.status !== "approved" || !approvedSend) {
        toast.error("Approve this canvas before sending supplier purchase orders.");
        return;
      }
      const targetCanvas = fullCanvas ?? canvas;
      const targets = canvasPurchaseTargets({
        canvas: targetCanvas,
        suppliers: suppliers.data ?? [],
        products: products.data ?? [],
      });
      if (targets.length === 0) {
        toast.error("No supplier emails found in this canvas.");
        return;
      }
      const result = await sendSamplePurchases({
        canvas: targetCanvas,
        project,
        customers: customers.data ?? [],
        suppliers: suppliers.data ?? [],
        products: products.data ?? [],
        images: renderImages,
        approvedSend,
        targets,
        origin: window.location.origin,
      });
      void queryClient.invalidateQueries({ queryKey: SAMPLE_ORDERS_KEY });
      const failedCount = result.failedEmailCount + result.failedStatusCount;
      if (result.failedStatusCount) {
        toast.error(
          `Sample Status could not save ${result.failedStatusCount} supplier order(s). ${result.firstError ?? ""}`,
        );
      } else if (failedCount) {
        toast.error(`${result.sentCount} purchase email(s) sent; ${failedCount} failed.`);
      } else toast.success(`${approvedSend.sequence} purchase sent to ${result.sentCount} supplier(s).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Purchase email delivery failed.");
    }
  }

  function purchaseButton(canvas: Canvas) {
    return (
      <ConfirmDialog
        title="Send supplier purchase orders?"
        description="This sends one purchase email per supplier in this approved canvas."
        confirmLabel="Send purchase"
        onConfirm={() => sendCanvasPurchase(canvas)}
        trigger={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Send ${canvas.name} supplier purchase emails`}
            title={
              canvas.status === "approved" ? "Send supplier purchase" : "Available after approval"
            }
            disabled={
              canvas.status !== "approved" ||
              customers.isLoading ||
              suppliers.isLoading ||
              products.isLoading
            }
            onClick={(event) => event.stopPropagation()}
          >
            <ShoppingCart />
          </Button>
        }
      />
    );
  }

  function canvasSupplierCount(canvas: Canvas): number {
    const seen = new Set<string>();
    for (const node of canvas.content.nodes) {
      if (node.type !== "suppler") continue;
      const data = node.data as Record<string, unknown>;
      const id = typeof data.supplierId === "string" ? data.supplierId : "";
      if (id) seen.add(id);
    }
    return seen.size;
  }

  return (
    <tr className="bg-muted/20">
      <td colSpan={isAdmin ? 10 : 9} className="px-4 py-3">
        {loading ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-md" />
            ))}
          </div>
        ) : canvases && canvases.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {canvases.map((canvas) =>
              onOpenCanvas ? (
                <div
                  key={canvas.id}
                  className="bg-background hover:border-primary/50 flex items-start gap-3 rounded-md border p-3 text-left transition-colors"
                >
                  <button
                    type="button"
                    className="focus-visible:ring-ring flex min-w-0 flex-1 items-start gap-3 rounded-sm text-left outline-none focus-visible:ring-2"
                    onClick={() => onOpenCanvas(project.id, canvas.id)}
                  >
                    <FileImage className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{canvas.name}</span>
                        <Badge variant={canvas.status === "approved" ? "default" : "secondary"}>
                          {canvasStatusLabel(canvas.status)}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground mt-1 block text-xs">
                        Created {formatDate(canvas.createdAt)}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        {canvasSupplierCount(canvas)} supplier{canvasSupplierCount(canvas) === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                  {purchaseButton(canvas)}
                </div>
              ) : (
                <div
                  key={canvas.id}
                  className="bg-background hover:border-primary/50 flex items-start gap-3 rounded-md border p-3 text-left transition-colors"
                >
                  <Link
                    href={`/projects/${project.id}/canvases/${canvas.id}`}
                    className="focus-visible:ring-ring flex min-w-0 flex-1 items-start gap-3 rounded-sm outline-none focus-visible:ring-2"
                  >
                    <FileImage className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{canvas.name}</span>
                        <Badge variant={canvas.status === "approved" ? "default" : "secondary"}>
                          {canvasStatusLabel(canvas.status)}
                        </Badge>
                      </span>
                      <span className="text-muted-foreground mt-1 block text-xs">
                        Created {formatDate(canvas.createdAt)}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        {canvasSupplierCount(canvas)} supplier{canvasSupplierCount(canvas) === 1 ? "" : "s"}
                      </span>
                    </span>
                  </Link>
                  {purchaseButton(canvas)}
                </div>
              ),
            )}
          </div>
        ) : (
          <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
            No canvases in this project.
          </p>
        )}
      </td>
    </tr>
  );
}

function ProjectTable({
  projects,
  onOpenProject,
  onOpenCanvas,
  stickyTopClassName,
  tableViewportClassName,
  isAdmin = false,
}: {
  projects: Project[];
  onOpenProject?: (projectId: string) => void;
  onOpenCanvas?: (projectId: string, canvasId: string) => void;
  stickyTopClassName: string;
  tableViewportClassName?: string;
  isAdmin?: boolean;
}) {
  const creators = useAdminCreators(isAdmin);
  const del = useDeleteProject();
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);
  const [query, setQuery] = useState("");
  const [columnFilters, setColumnFilters] =
    useState<ProjectColumnFilters>(emptyProjectColumnFilters);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const globalProjects = projects.filter((project) =>
    fuzzyMatch(getProjectSearchText(project), query),
  );
  const canvasQueries = useQueries({
    queries: globalProjects.map((project) => ({
      queryKey: ["canvases", project.id] as const,
      queryFn: () => getCanvasStore().listCanvases(project.id),
    })),
  });
  const canvasResultByProjectId = new Map(
    globalProjects.map((project, index) => [project.id, canvasQueries[index]] as const),
  );
  const canvasIds = globalProjects.flatMap(
    (project) => canvasResultByProjectId.get(project.id)?.data?.map((canvas) => canvas.id) ?? [],
  );
  const sendQueries = useQueries({
    queries: canvasIds.map((canvasId) => ({
      queryKey: ["canvas-sends", canvasId] as const,
      queryFn: () => getCanvasStore().listCanvasSends(canvasId),
    })),
  });
  const sendsByCanvasId = new Map(
    canvasIds.map((canvasId, index) => [canvasId, sendQueries[index]?.data ?? []] as const),
  );
  const sendsLoading = sendQueries.some((queryResult) => queryResult.isLoading);
  const visibleProjects = globalProjects.filter((project) => {
    const canvasResult = canvasResultByProjectId.get(project.id);
    const canvases = canvasResult?.data;
    const projectSends = (canvases ?? []).flatMap((canvas) => sendsByCanvasId.get(canvas.id) ?? []);
    return projectMatchesColumnFilters({
      project,
      filters: columnFilters,
      canvases,
      sequence: latestCanvasSendSequence(projectSends),
      canvasLoading: Boolean(canvasResult?.isLoading || sendsLoading),
    });
  });

  function updateColumnFilter(key: keyof ProjectColumnFilters, value: string) {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }

  function filterInput(
    key: keyof ProjectColumnFilters,
    label: string,
    className = columnInputClassName(),
  ) {
    return (
      <Input
        value={columnFilters[key]}
        onChange={(event) => updateColumnFilter(key, event.target.value)}
        placeholder="Search"
        aria-label={`Search ${label}`}
        className={className}
      />
    );
  }

  async function onDelete(projectId: string) {
    await del.mutateAsync(projectId);
    toast.success("Project deleted");
  }

  function syncHorizontalScroll(
    event: UIEvent<HTMLDivElement>,
    targetRef: RefObject<HTMLDivElement | null>,
  ) {
    if (syncingScrollRef.current) return;
    const target = targetRef.current;
    if (!target) return;
    syncingScrollRef.current = true;
    target.scrollLeft = event.currentTarget.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }

  return (
    <div className="bg-card flex min-h-0 flex-1 flex-col rounded-lg border shadow-sm">
      <div
        className={`bg-card sticky ${stickyTopClassName} z-20 rounded-t-lg border-b px-4 py-3 shadow-sm`}
      >
        <div className="relative mb-3 max-w-md">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Fuzzy search projects"
            aria-label="Fuzzy search projects"
            className="bg-background h-9 pl-8 text-sm normal-case"
          />
        </div>
        <div
          ref={topScrollRef}
          className="overflow-x-scroll"
          aria-label="Scroll project table horizontally"
          onScroll={(event) => syncHorizontalScroll(event, tableScrollRef)}
        >
          <div className="h-4 min-w-[1280px]" />
        </div>
      </div>
      <div
        ref={tableScrollRef}
        className={cn("min-h-0 overflow-auto", tableViewportClassName)}
        onScroll={(event) => syncHorizontalScroll(event, topScrollRef)}
      >
        <table className="w-full min-w-[1280px] text-left text-sm">
          <thead className="bg-muted/60 text-muted-foreground border-b text-xs font-medium tracking-wide uppercase">
            <tr>
              <th scope="col" className="px-4 py-3">
                CA #
              </th>
              <th scope="col" className="px-4 py-3">
                Customer name
              </th>
              <th scope="col" className="px-4 py-3">
                Employee name
              </th>
              <th scope="col" className="px-4 py-3">
                Project name
              </th>
              <th scope="col" className="px-4 py-3">
                Created date
              </th>
              <th scope="col" className="px-4 py-3">
                Currency
              </th>
              <th scope="col" className="px-4 py-3">
                Destination
              </th>
              <th scope="col" className="px-4 py-3 text-center">
                Canvas #
              </th>
              {isAdmin ? (
                <th scope="col" className="px-4 py-3">
                  Creator
                </th>
              ) : null}
              <th scope="col" className="w-28 px-4 py-3 text-right">
                Actions
              </th>
            </tr>
            <tr className="bg-background/70 border-t">
              <th scope="col" className="px-4 py-2">
                {filterInput("sequence", "CA number")}
              </th>
              <th scope="col" className="px-4 py-2">
                {filterInput("customer", "customer name")}
              </th>
              <th scope="col" className="px-4 py-2">
                {filterInput("employee", "employee")}
              </th>
              <th scope="col" className="px-4 py-2">
                {filterInput("project", "project name")}
              </th>
              <th scope="col" className="px-4 py-2">
                {filterInput("created", "created date")}
              </th>
              <th scope="col" className="px-4 py-2">
                {filterInput("currency", "currency")}
              </th>
              <th scope="col" className="px-4 py-2">
                {filterInput("destination", "destination")}
              </th>
              <th scope="col" className="px-4 py-2">
                {filterInput(
                  "canvasCount",
                  "canvas count",
                  "bg-background h-8 min-w-20 text-xs normal-case",
                )}
              </th>
              {isAdmin ? <th scope="col" className="px-4 py-2" /> : null}
              <th scope="col" className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {visibleProjects.length ? (
              visibleProjects.map((project) => {
                const canvasResult = canvasResultByProjectId.get(project.id);
                const canvases = canvasResult?.data;
                const expanded = expandedProjectId === project.id;
                const count = canvases?.length ?? 0;
                const sequence = latestCanvasSendSequence(
                  (canvases ?? []).flatMap((canvas) => sendsByCanvasId.get(canvas.id) ?? []),
                );
                return (
                  <Fragment key={project.id}>
                    <tr className="hover:bg-muted/35 transition-colors">
                      <td className="px-4 py-3 align-top font-semibold tabular-nums">
                        {sendsLoading || canvasResult?.isLoading ? "..." : sequence}
                      </td>
                      <td className="max-w-56 px-4 py-3 align-top font-medium break-words">
                        {displayValue(project.customerName)}
                      </td>
                      <td className="max-w-56 px-4 py-3 align-top break-words">
                        <span className="font-medium">{displayValue(project.employeeName)}</span>
                        {project.employeeTitle || project.employeeEmail ? (
                          <span className="text-muted-foreground mt-1 block text-xs">
                            {[project.employeeTitle, project.employeeEmail]
                              .filter(Boolean)
                              .join(" / ")}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-64 px-4 py-3 align-top">
                        {onOpenProject ? (
                          <button
                            type="button"
                            onClick={() => onOpenProject(project.id)}
                            className="focus-visible:ring-ring hover:text-primary rounded-sm text-left font-medium break-words outline-none focus-visible:ring-2"
                          >
                            {project.name}
                          </button>
                        ) : (
                          <Link
                            href={`/projects/${project.id}`}
                            className="focus-visible:ring-ring hover:text-primary rounded-sm font-medium break-words outline-none focus-visible:ring-2"
                          >
                            {project.name}
                          </Link>
                        )}
                        <span className="text-muted-foreground mt-1 block text-xs">
                          Updated {formatDate(project.updatedAt)}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-4 py-3 align-top">
                        {formatDate(project.createdAt)}
                      </td>
                      <td className="px-4 py-3 align-top">{formatCurrency(project)}</td>
                      <td className="max-w-48 px-4 py-3 align-top break-words">
                        {displayValue(project.destinationCountryName)}
                      </td>
                      <td className="px-4 py-3 text-center align-top">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1.5 px-2"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name} canvases`}
                          onClick={() =>
                            setExpandedProjectId((current) =>
                              current === project.id ? null : project.id,
                            )
                          }
                        >
                          {expanded ? <ChevronDown /> : <ChevronRight />}
                          {canvasResult?.isLoading ? "..." : count}
                        </Button>
                      </td>
                      {isAdmin ? (
                        <td className="max-w-48 px-4 py-3 align-top break-words">
                          <CreatorCell creators={creators} userId={project.userId} />
                        </td>
                      ) : null}
                      <td className="px-4 py-3 align-top">
                        <div className="flex justify-end gap-1">
                          {onOpenProject ? (
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Open ${project.name}`}
                              onClick={() => onOpenProject(project.id)}
                            >
                              <ArrowUpRight />
                            </Button>
                          ) : (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Open ${project.name}`}
                              render={<Link href={`/projects/${project.id}`} />}
                            >
                              <ArrowUpRight />
                            </Button>
                          )}
                          <ConfirmDialog
                            title="Delete project?"
                            description="This permanently deletes the project and all of its canvases."
                            onConfirm={() => onDelete(project.id)}
                            trigger={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Delete ${project.name}`}
                              >
                                <Trash2 />
                              </Button>
                            }
                          />
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <ProjectCanvasDetailRow
                        project={project}
                        canvases={canvases}
                        loading={Boolean(canvasResult?.isLoading)}
                        sendsByCanvasId={sendsByCanvasId}
                        isAdmin={isAdmin}
                        onOpenCanvas={onOpenCanvas}
                      />
                    ) : null}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={isAdmin ? 10 : 9} className="text-muted-foreground px-4 py-10 text-center">
                  No matching projects.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProjectList({
  redirectOnCreate = true,
  onOpenProject,
  onOpenCanvas,
  onProjectCreated,
  isAdmin = false,
  stickyTopClassName = "top-14",
  className,
  tableViewportClassName,
}: {
  redirectOnCreate?: boolean;
  onOpenProject?: (projectId: string) => void;
  onOpenCanvas?: (projectId: string, canvasId: string) => void;
  onProjectCreated?: (projectId: string) => void;
  isAdmin?: boolean;
  stickyTopClassName?: string;
  className?: string;
  tableViewportClassName?: string;
}) {
  const { data: projects, isLoading, isError, error } = useProjects();

  return (
    <div className={cn("flex min-h-0 flex-col gap-6", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Workspace
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
            Organize canvases for products, suppliers, customers, and image workflows.
          </p>
        </div>
        <CreateProjectDialog
          redirectOnCreate={redirectOnCreate}
          onCreated={(project) => onProjectCreated?.(project.id)}
        />
      </div>

      {isLoading ? (
        <div className="bg-card rounded-lg border p-3 shadow-sm">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-11 last:mb-0" />
          ))}
        </div>
      ) : isError ? (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
          Failed to load projects: {error instanceof Error ? error.message : "unknown error"}
        </p>
      ) : projects && projects.length > 0 ? (
        <ProjectTable
          projects={projects}
          onOpenProject={onOpenProject}
          onOpenCanvas={onOpenCanvas}
          stickyTopClassName={stickyTopClassName}
          tableViewportClassName={tableViewportClassName}
          isAdmin={isAdmin}
        />
      ) : (
        <div className="bg-card flex min-h-80 flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center shadow-sm">
          <div className="bg-accent text-accent-foreground flex size-12 items-center justify-center rounded-lg">
            <FolderOpen className="size-6" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium">No projects yet</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              Create your first project to start arranging canvas nodes.
            </p>
          </div>
          <CreateProjectDialog
            redirectOnCreate={redirectOnCreate}
            onCreated={(project) => onProjectCreated?.(project.id)}
          />
        </div>
      )}
    </div>
  );
}
