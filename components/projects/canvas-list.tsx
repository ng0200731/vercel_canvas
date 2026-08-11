"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toDataURL } from "qrcode";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  FileImage,
  Loader2,
  Mail,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { buildCanvasReport } from "@/lib/canvas-report";
import {
  buildCanvasSendLinks,
  createCanvasSendToken,
  normalizePublicAppUrl,
} from "@/lib/canvas-send-links";
import { ImagePreviewDialog } from "@/components/image-preview-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateCanvasDialog } from "@/components/projects/create-canvas-dialog";
import { canvasPurchaseTargets } from "@/lib/canvas-purchase";
import { sendCanvasReportEmail } from "@/lib/email/client";
import { emailRecipientSchema } from "@/lib/email/schemas";
import { useCanvases, useDeleteCanvas } from "@/lib/hooks/use-canvases";
import { useProject } from "@/lib/hooks/use-projects";
import { SAMPLE_ORDERS_KEY } from "@/lib/hooks/use-sample-orders";
import {
  useCustomers,
  useProducts,
  useSuppliers,
  useWorkspaceOptions,
} from "@/lib/hooks/use-workspace-records";
import { formatDate } from "@/lib/format";
import { sendSamplePurchases } from "@/lib/sample-purchase-client";
import {
  getCanvasStore,
  type Canvas,
  type CanvasSendRecord,
  type ImageRecord,
  type Project,
} from "@/lib/store";

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

interface CanvasColumnFilters {
  name: string;
  created: string;
  updated: string;
  status: string;
  email: string;
}

const emptyCanvasColumnFilters: CanvasColumnFilters = {
  name: "",
  created: "",
  updated: "",
  status: "",
  email: "",
};

interface AddressBookOption {
  id: string;
  name: string;
  email: string;
  isFavorite: boolean;
}

function splitEmailList(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function appendEmail(value: string, email: string): string {
  const addresses = splitEmailList(value);
  if (!addresses.some((address) => address.toLocaleLowerCase() === email.toLocaleLowerCase())) {
    addresses.push(email);
  }
  return addresses.join(", ");
}

function removeEmail(value: string, email: string): string {
  return splitEmailList(value)
    .filter((address) => address.toLocaleLowerCase() !== email.toLocaleLowerCase())
    .join(", ");
}

function AddressBookEmailField({
  id,
  label,
  value,
  disabled,
  addresses,
  multiple = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  addresses: readonly AddressBookOption[];
  multiple?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [browseAddressBook, setBrowseAddressBook] = useState(false);
  const selectedAddresses = splitEmailList(value);
  const selectedAddressSet = new Set(
    selectedAddresses.map((address) => address.toLocaleLowerCase()),
  );
  const visibleAddresses = [...addresses]
    .filter((address) => {
      if (multiple && selectedAddressSet.has(address.email.toLocaleLowerCase())) return false;
      const query = browseAddressBook ? "" : multiple ? (splitEmailList(value).at(-1) ?? "") : value;
      const normalizedQuery = query.trim().toLocaleLowerCase();
      if (!normalizedQuery) return true;
      return `${address.name} ${address.email}`.toLocaleLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite));

  return (
    <div className="relative grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={multiple ? "text" : "email"}
          autoComplete="email"
          placeholder={multiple ? "name@example.com, manager@example.com" : "recipient@example.com"}
          value={value}
          disabled={disabled}
          required={!multiple}
          className="pr-9"
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setBrowseAddressBook(false);
            onChange(event.target.value);
            setOpen(true);
          }}
        />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          aria-label={`Open ${label} address book`}
          title="Address book"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setBrowseAddressBook(true);
            setOpen((current) => !current);
          }}
        >
          <BookOpen />
        </Button>
      </div>
      {open && !disabled && visibleAddresses.length > 0 ? (
        <div className="bg-popover text-popover-foreground absolute top-full right-0 left-0 z-50 mt-1 max-h-44 overflow-y-auto rounded-md border p-1 shadow-lg">
          {visibleAddresses.map((address) => (
            <button
              key={address.id}
              type="button"
              className="hover:bg-accent focus-visible:ring-ring flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(multiple ? appendEmail(value, address.email) : address.email);
                setBrowseAddressBook(true);
                setOpen(false);
              }}
            >
              <Mail className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{address.name}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {address.email}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {selectedAddresses.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedAddresses.map((email) => {
            const valid = emailRecipientSchema.safeParse(email).success;
            return (
              <span
                key={email}
                className={`inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                  valid
                    ? "bg-muted text-muted-foreground"
                    : "border-destructive/40 bg-destructive/10 text-destructive"
                }`}
                title={valid ? email : "Invalid email address"}
              >
                <span className="max-w-52 truncate">{email}</span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  className="size-4"
                  aria-label={`Remove ${email}`}
                  disabled={disabled}
                  onClick={() => onChange(multiple ? removeEmail(value, email) : "")}
                >
                  <X className="size-3" />
                </Button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function SendCanvasDialog({ canvas, project }: { canvas: Canvas; project: Project | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const customers = useCustomers();
  const suppliers = useSuppliers();
  const products = useProducts();
  const addressBook = useWorkspaceOptions("address-book");
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loadedCanvas, setLoadedCanvas] = useState<Canvas | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentRecords, setSentRecords] = useState<string[]>([]);
  const [sendHistory, setSendHistory] = useState<CanvasSendRecord[]>([]);
  const [recipient, setRecipient] = useState("");
  const [cc, setCc] = useState("");
  const addressOptions: AddressBookOption[] = (addressBook.data ?? []).map((option) => ({
    id: option.id,
    name: option.name,
    email: option.code,
    isFavorite: option.isFavorite,
  }));
  const previewItems = images.map((image) => ({
    id: image.id,
    src: image.url,
    alt: image.prompt ?? "Render history image",
  }));

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setLoading(true);
    try {
      const [fullCanvas, renderImages] = await Promise.all([
        getCanvasStore().getCanvas(canvas.id),
        getCanvasStore().listImages(canvas.id),
        getCanvasStore().listCanvasSends(canvas.id).then(setSendHistory),
      ]);
      setLoadedCanvas(fullCanvas ?? canvas);
      setImages(renderImages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load render history");
    } finally {
      setLoading(false);
    }
  }

  function selectImage(imageId: string) {
    setSelectedImageIds([imageId]);
  }

  async function sendSelected() {
    const recipients = splitEmailList(recipient);
    if (recipients.length === 0) {
      toast.error("Enter at least one recipient email.");
      return;
    }
    const invalidRecipient = recipients.find(
      (address) => !emailRecipientSchema.safeParse(address).success,
    );
    if (invalidRecipient) {
      toast.error(`Enter a valid recipient email address: ${invalidRecipient}`);
      return;
    }
    const ccAddresses = splitEmailList(cc);
    const invalidCc = ccAddresses.find(
      (address) => !emailRecipientSchema.safeParse(address).success,
    );
    if (invalidCc) {
      toast.error(`Enter a valid CC email address: ${invalidCc}`);
      return;
    }
    if (selectedImageIds.length === 0) {
      toast.error("Please select one render image before sending the canvas report.");
      return;
    }

    setSending(true);
    try {
      const selectedImages = images.filter((image) => selectedImageIds.includes(image.id));
      const publicAppUrl = normalizePublicAppUrl(
        process.env.NEXT_PUBLIC_APP_URL,
        window.location.origin,
      );
      const approvalToken = createCanvasSendToken();
      const provisionalSend = await getCanvasStore().createCanvasSend({
        canvasId: canvas.id,
        recipientEmail: recipients.join(", "),
        reportUrl: publicAppUrl,
        approvalToken,
        approvalUrl: publicAppUrl,
        rejectionUrl: publicAppUrl,
        qrCodeDataUrl: null,
        selectedImageIds,
        reportSnapshot: { pending: true },
      });
      const { reportUrl, approvalUrl, rejectionUrl } = buildCanvasSendLinks({
        baseUrl: publicAppUrl,
        sequence: provisionalSend.sequence,
        token: approvalToken,
      });
      const qrCodeDataUrl = await toDataURL(reportUrl, {
        width: 180,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      const report = buildCanvasReport({
        canvas: loadedCanvas ?? canvas,
        project,
        customers: customers.data ?? [],
        suppliers: suppliers.data ?? [],
        products: products.data ?? [],
        images: selectedImages,
        send: {
          sequence: provisionalSend.sequence,
          reportUrl,
          approvalUrl,
          rejectionUrl,
          qrCodeDataUrl,
        },
      });
      const finalizedSend = await getCanvasStore().updateCanvasSend(provisionalSend.id, {
        reportUrl,
        approvalUrl,
        rejectionUrl,
        qrCodeDataUrl,
        reportSnapshot: {
          schemaVersion: report.schemaVersion,
          title: report.title,
          generatedAt: report.generatedAt,
          project: report.project,
          canvas: report.canvas,
          sections: report.sections,
          steps: report.steps,
          send: report.send
            ? {
                ...report.send,
                selectedImageIds: report.send.selectedImageIds
                  ? [...report.send.selectedImageIds]
                  : undefined,
              }
            : undefined,
        },
      });
      const filename = canvas.name.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "") || "canvas";
      const result = await sendCanvasReportEmail({
        to: recipients,
        cc: ccAddresses,
        canvasName: canvas.name,
        subject: `${canvas.name} canvas report`,
        html: report.html,
        text: report.text,
        pdfFilename: `${filename}-report.pdf`,
        report: {
          schemaVersion: report.schemaVersion,
          title: report.title,
          generatedAt: report.generatedAt,
          project: report.project,
          canvas: report.canvas,
          sections: report.sections,
          steps: report.steps,
          send: report.send
            ? {
                ...report.send,
                selectedImageIds: report.send.selectedImageIds
                  ? [...report.send.selectedImageIds]
                  : undefined,
              }
            : undefined,
        },
      });
      await getCanvasStore().updateCanvasStatus(canvas.id, "awaiting_approval");
      const sentAt = new Date().toLocaleString();
      setSentRecords((current) => [
        `${sentAt} - ${finalizedSend.sequence} delivered to ${recipients.join(", ")} with ${
          result.provider === "local"
            ? "Local SMTP"
            : result.provider === "163"
              ? "163.com"
              : "Gmail"
        }`,
        ...current.filter((record) => !record.startsWith(sentAt)),
      ]);
      setSendHistory((current) => {
        const withoutProvisional = current.filter((record) => record.id !== finalizedSend.id);
        return [finalizedSend, ...withoutProvisional];
      });
      void queryClient.invalidateQueries({ queryKey: ["canvases", canvas.projectId] });
      toast.success(`Email sent to ${recipients.length} recipient(s).`, {
        position: "bottom-right",
      });
      setSelectedImageIds([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Email delivery failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => void handleOpenChange(true)}>
        <Mail />
        Send
      </Button>
      <Dialog open={open} onOpenChange={(nextOpen) => void handleOpenChange(nextOpen)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Send canvas report</DialogTitle>
            <DialogDescription>
              Sends the full canvas report by local server email. 163.com is tried first, then
              Gmail; a PDF copy is attached when available.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <AddressBookEmailField
              id={`canvas-email-recipient-${canvas.id}`}
              label="To"
              value={recipient}
              disabled={sending}
              addresses={addressOptions}
              multiple
              onChange={setRecipient}
            />
            <AddressBookEmailField
              id={`canvas-email-cc-${canvas.id}`}
              label="CC"
              value={cc}
              disabled={sending}
              addresses={addressOptions}
              multiple
              onChange={setCc}
            />
          </div>
          {loading ? (
            <div className="text-muted-foreground flex h-56 items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              Loading render history...
            </div>
          ) : images.length ? (
            <div className="grid max-h-80 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
              {images.map((image, index) => {
                const selected = selectedImageIds.includes(image.id);
                return (
                  <div
                    key={image.id}
                    className={`relative rounded-md border p-2 text-left ${
                      selected ? "border-primary ring-primary ring-2" : ""
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={`${selected ? "Unselect" : "Select"} render from ${formatDate(
                        image.createdAt,
                      )}`}
                      className={`absolute top-3 right-3 z-10 flex size-6 items-center justify-center rounded-full border shadow-sm ${
                        selected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "bg-background/90 text-muted-foreground"
                      }`}
                      onClick={() => selectImage(image.id)}
                    >
                      {selected ? <Check className="size-3.5" /> : null}
                    </button>
                    <ImagePreviewDialog
                      src={image.url}
                      alt={image.prompt ?? "Render history image"}
                      title="Render preview"
                      gallery={previewItems}
                      initialIndex={index}
                      selectedItemId={selectedImageIds[0] ?? null}
                      selectedLabel="Selected"
                      selectLabel="Select"
                      onSelect={(item) => {
                        if (item.id) selectImage(item.id);
                      }}
                      trigger={
                        <button
                          type="button"
                          className="focus-visible:ring-ring block w-full cursor-zoom-in rounded outline-none focus-visible:ring-2"
                          aria-label="Open render preview"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.url}
                            alt={image.prompt ?? "Render history image"}
                            className="bg-muted aspect-video w-full rounded object-contain"
                          />
                        </button>
                      }
                    />
                    <span className="text-muted-foreground mt-2 block truncate text-xs">
                      {formatDate(image.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-muted-foreground flex h-56 items-center justify-center text-sm">
              No render history images found.
            </div>
          )}
          {sentRecords.length ? (
            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">Send out record</p>
              <div className="text-muted-foreground grid gap-1 text-xs">
                {sentRecords.map((record) => (
                  <p key={record}>{record}</p>
                ))}
              </div>
            </div>
          ) : null}
          {sendHistory.length ? (
            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">Approval history</p>
              <div className="text-muted-foreground grid gap-1 text-xs">
                {sendHistory.map((record, index) => (
                  <p key={`${record.id}-${index}`}>
                    {record.sequence} - {canvasStatusLabel(record.status)} -{" "}
                    {formatDate(record.createdAt)} - {record.recipientEmail}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={
                sending ||
                splitEmailList(recipient).length === 0 ||
                customers.isLoading ||
                suppliers.isLoading ||
                products.isLoading
              }
              onClick={() => void sendSelected()}
            >
              {sending ? "Sending..." : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CanvasActions({
  canvas,
  projectId,
  project,
  onOpen,
}: {
  canvas: Canvas;
  projectId: string;
  project: Project | null;
  onOpen?: (canvasId: string) => void;
}) {
  const del = useDeleteCanvas(projectId);
  const queryClient = useQueryClient();
  const customers = useCustomers();
  const suppliers = useSuppliers();
  const products = useProducts();
  const [purchasing, setPurchasing] = useState(false);

  async function onDelete() {
    await del.mutateAsync(canvas.id);
    toast.success("Canvas deleted");
  }

  async function sendPurchase() {
    setPurchasing(true);
    try {
      const [fullCanvas, renderImages, sends] = await Promise.all([
        getCanvasStore().getCanvas(canvas.id),
        getCanvasStore().listImages(canvas.id),
        getCanvasStore().listCanvasSends(canvas.id),
      ]);
      const approvedSend =
        sends.find((send) => send.status === "approved") ??
        [...sends].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      if (!approvedSend || canvas.status !== "approved") {
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
        toast.error(
          `${result.sentCount} purchase email(s) sent; ${failedCount} failed and can be retried from Sample Status.`,
        );
      } else toast.success(`${approvedSend.sequence} purchase sent to ${result.sentCount} supplier(s).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Purchase email delivery failed.");
    } finally {
      setPurchasing(false);
    }
  }

  const purchaseDisabled =
    purchasing ||
    customers.isLoading ||
    suppliers.isLoading ||
    products.isLoading ||
    canvas.status !== "approved";

  return (
    <div className="flex justify-end gap-2">
      {onOpen ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onOpen(canvas.id)}>
          <ArrowUpRight />
          View/Edit
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          render={<Link href={`/projects/${projectId}/canvases/${canvas.id}`} />}
        >
          <ArrowUpRight />
          View/Edit
        </Button>
      )}
      <SendCanvasDialog canvas={canvas} project={project} />
      <ConfirmDialog
        title="Send supplier purchase orders?"
        description="This sends one purchase email per supplier in this approved canvas."
        confirmLabel="Send purchase"
        onConfirm={() => void sendPurchase()}
        trigger={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Send ${canvas.name} supplier purchase emails`}
            title={
              canvas.status === "approved"
                ? "Send supplier purchase"
                : "Available after canvas approval"
            }
            disabled={purchaseDisabled}
          >
            <ShoppingCart />
          </Button>
        }
      />
      <ConfirmDialog
        title="Delete canvas?"
        description="This permanently deletes the canvas."
        onConfirm={onDelete}
        trigger={
          <Button size="icon-sm" variant="ghost" aria-label="Delete canvas">
            <Trash2 />
          </Button>
        }
      />
    </div>
  );
}

export function CanvasList({
  projectId,
  redirectOnCreate = true,
  onOpenCanvas,
  onCanvasCreated,
}: {
  projectId: string;
  redirectOnCreate?: boolean;
  onOpenCanvas?: (canvasId: string) => void;
  onCanvasCreated?: (canvasId: string) => void;
}) {
  const { data: canvases, isLoading, isError, error } = useCanvases(projectId);
  const project = useProject(projectId);
  const suppliers = useSuppliers();
  const products = useProducts();
  const [columnFilters, setColumnFilters] = useState<CanvasColumnFilters>(emptyCanvasColumnFilters);
  const employeeEmail = project.data?.employeeEmail ?? "";

  function canvasSupplierCount(canvas: Canvas): number {
    const seen = new Set<string>();
    for (const node of canvas.content.nodes) {
      if (node.type !== "suppler") continue;
      const data = node.data as Record<string, unknown>;
      const id = typeof data.supplierId === "string" ? data.supplierId : "";
      if (id) seen.add(id);
    }
    return Math.min(seen.size, suppliers.data?.length ?? Infinity) || seen.size;
  }
  const supplierCountsReady = !suppliers.isLoading && !products.isLoading;
  const visibleCanvases =
    canvases?.filter(
      (canvas) =>
        fuzzyMatch(canvas.name, columnFilters.name) &&
        fuzzyMatch(formatDate(canvas.createdAt), columnFilters.created) &&
        fuzzyMatch(formatDate(canvas.updatedAt), columnFilters.updated) &&
        fuzzyMatch(canvasStatusLabel(canvas.status), columnFilters.status) &&
        (project.isLoading || fuzzyMatch(employeeEmail || "Not set", columnFilters.email)),
    ) ?? [];

  function updateColumnFilter(key: keyof CanvasColumnFilters, value: string) {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }

  function filterInput(key: keyof CanvasColumnFilters, label: string) {
    return (
      <Input
        value={columnFilters[key]}
        onChange={(event) => updateColumnFilter(key, event.target.value)}
        placeholder="Search"
        aria-label={`Search ${label}`}
        className="bg-background h-8 min-w-28 text-xs normal-case"
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Project assets
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Canvases</h2>
        </div>
        <CreateCanvasDialog
          projectId={projectId}
          redirectOnCreate={redirectOnCreate}
          onCreated={(canvas) => onCanvasCreated?.(canvas.id)}
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
          Failed to load canvases: {error instanceof Error ? error.message : "unknown error"}
        </p>
      ) : canvases && canvases.length > 0 ? (
        <div className="bg-card overflow-hidden rounded-lg border shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground text-xs uppercase">
                <tr>
                  <th className="px-4 py-3">Canvas name</th>
                  <th className="px-4 py-3">Create time</th>
                  <th className="px-4 py-3">Last update</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Employer email</th>
                  <th className="px-4 py-3 text-center">Suppliers</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
                <tr className="bg-background/70 border-t">
                  <th className="px-4 py-2">{filterInput("name", "canvas name")}</th>
                  <th className="px-4 py-2">{filterInput("created", "create time")}</th>
                  <th className="px-4 py-2">{filterInput("updated", "last update")}</th>
                  <th className="px-4 py-2">{filterInput("status", "status")}</th>
                  <th className="px-4 py-2">{filterInput("email", "employer email")}</th>
                  <th className="px-4 py-2" />
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleCanvases.length ? (
                  visibleCanvases.map((canvas) => (
                    <tr key={canvas.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 font-medium">
                          <FileImage className="text-muted-foreground size-4" />
                          {canvas.name}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {formatDate(canvas.createdAt)}
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {formatDate(canvas.updatedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={canvas.status === "approved" ? "default" : "secondary"}>
                          {canvasStatusLabel(canvas.status)}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {project.isLoading ? (
                          <Skeleton className="h-4 w-36" />
                        ) : project.data?.employeeEmail ? (
                          <a
                            href={`mailto:${project.data.employeeEmail}`}
                            className="hover:text-foreground underline-offset-4 hover:underline"
                          >
                            {project.data.employeeEmail}
                          </a>
                        ) : (
                          "Not set"
                        )}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {supplierCountsReady ? canvasSupplierCount(canvas) : "..."}
                      </td>
                      <td className="px-4 py-3">
                        <CanvasActions
                          canvas={canvas}
                          projectId={projectId}
                          project={project.data ?? null}
                          onOpen={onOpenCanvas}
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="text-muted-foreground px-4 py-10 text-center">
                      No matching canvases.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-card flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center shadow-sm">
          <div className="bg-secondary text-secondary-foreground flex size-11 items-center justify-center rounded-lg">
            <FileImage className="size-5" />
          </div>
          <p className="font-medium">No canvases yet</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            Create a canvas to start arranging notes, references, colors, and generation nodes.
          </p>
          <CreateCanvasDialog
            projectId={projectId}
            redirectOnCreate={redirectOnCreate}
            onCreated={(canvas) => onCanvasCreated?.(canvas.id)}
          />
        </div>
      )}
    </div>
  );
}
