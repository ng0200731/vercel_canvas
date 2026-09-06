"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { Coins, Edit3, Heart, Mail, MapPin, Plus, RefreshCw, Search, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useReplaceWorkspaceOptions, useWorkspaceOptions } from "@/lib/hooks/use-workspace-records";
import type { WorkspaceOption, WorkspaceOptionKind } from "@/lib/workspace-settings";
import { OrderControls } from "./order-controls";
import { SettingsPanelHeader } from "./settings-panel-header";

const optionDraftSchema = z.object({
  code: z.string().trim().min(1, "Code is required.").max(254, "Use 254 characters or fewer."),
  name: z.string().trim().min(1, "Name is required.").max(120, "Use 120 characters or fewer."),
  symbol: z.string().trim().max(12, "Use 12 characters or fewer."),
});

type OptionDraft = z.input<typeof optionDraftSchema>;
type DraftErrors = Partial<Record<keyof OptionDraft | "form", string>>;

const panelCopy: Record<
  WorkspaceOptionKind,
  {
    title: string;
    description: string;
    singular: string;
    searchPlaceholder: string;
  }
> = {
  currency: {
    title: "Currency",
    description: "Project currency options and preferred sequence.",
    singular: "currency",
    searchPlaceholder: "Search code, name, or symbol",
  },
  "destination-country": {
    title: "Destination country",
    description: "Delivery destination options and preferred sequence.",
    singular: "destination country",
    searchPlaceholder: "Search country code or name",
  },
  "address-book": {
    title: "Address book",
    description: "Reusable email recipients for canvas sends.",
    singular: "address",
    searchPlaceholder: "Search name or email",
  },
  "supplier-product-type": {
    title: "Supplier product type",
    description: "Product type options used by supplier products and canvas nodes.",
    singular: "product type",
    searchPlaceholder: "Search product type",
  },
};

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `option-${Date.now()}`;
}

function editorErrors(result: z.ZodSafeParseError<OptionDraft>): DraftErrors {
  const errors: DraftErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if ((key === "code" || key === "name" || key === "symbol") && !errors[key]) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

function OptionEditorDialog({
  kind,
  open,
  option,
  options,
  pending,
  onOpenChange,
  onSave,
}: {
  kind: WorkspaceOptionKind;
  open: boolean;
  option: WorkspaceOption | null;
  options: WorkspaceOption[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: z.output<typeof optionDraftSchema>) => Promise<boolean>;
}) {
  const fieldId = useId();
  const copy = panelCopy[kind];
  const [draft, setDraft] = useState<OptionDraft>({
    code: option?.code ?? "",
    name: option?.name ?? "",
    symbol: option?.symbol ?? "",
  });
  const [errors, setErrors] = useState<DraftErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = optionDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(editorErrors(parsed));
      return;
    }
    if (kind === "address-book" && !z.email().safeParse(parsed.data.code).success) {
      setErrors({ code: "Enter a valid email address." });
      return;
    }

    const duplicate = options.some(
      (candidate) =>
        candidate.id !== option?.id &&
        candidate.code.toLocaleLowerCase() === parsed.data.code.toLocaleLowerCase(),
    );
    if (duplicate) {
      setErrors({ code: `${parsed.data.code.toUpperCase()} is already in the list.` });
      return;
    }

    setErrors({});
    if (await onSave(parsed.data)) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {option ? "Edit" : "Add"} {copy.singular}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-code`}>
                {kind === "address-book" ? "Email address" : "Code"}
              </Label>
              <Input
                id={`${fieldId}-code`}
                autoFocus
                value={draft.code}
                aria-invalid={Boolean(errors.code)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    code:
                      kind === "address-book"
                        ? event.target.value
                        : event.target.value.toUpperCase(),
                  }))
                }
                placeholder={
                  kind === "currency" ? "USD" : kind === "address-book" ? "buyer@example.com" : "US"
                }
              />
              {errors.code ? <p className="text-destructive text-xs">{errors.code}</p> : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={`${fieldId}-name`}>
                {kind === "address-book" ? "Display name" : "Name"}
              </Label>
              <Input
                id={`${fieldId}-name`}
                value={draft.name}
                aria-invalid={Boolean(errors.name)}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder={
                  kind === "currency"
                    ? "US Dollar"
                    : kind === "address-book"
                      ? "Buyer team"
                      : "United States"
                }
              />
              {errors.name ? <p className="text-destructive text-xs">{errors.name}</p> : null}
            </div>

            {kind === "currency" ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${fieldId}-symbol`}>Symbol</Label>
                <Input
                  id={`${fieldId}-symbol`}
                  value={draft.symbol}
                  aria-invalid={Boolean(errors.symbol)}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, symbol: event.target.value }))
                  }
                  placeholder="$"
                />
                {errors.symbol ? <p className="text-destructive text-xs">{errors.symbol}</p> : null}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : option ? "Save changes" : `Add ${copy.singular}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OptionsLoadingTable({ kind }: { kind: WorkspaceOptionKind }) {
  return (
    <div
      className="overflow-hidden rounded-lg border"
      aria-label={`Loading ${panelCopy[kind].title}`}
    >
      <div className="bg-muted/50 h-10 border-b" />
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="grid h-12 grid-cols-[4rem_7rem_1fr_8rem] items-center gap-3 border-b px-4 last:border-b-0"
        >
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="ml-auto h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

export function OrderedOptionSettingsPanel({ kind }: { kind: WorkspaceOptionKind }) {
  const copy = panelCopy[kind];
  const Icon =
    kind === "currency" ? Coins : kind === "address-book" ? Mail : kind === "supplier-product-type" ? Tags : MapPin;
  const query = useWorkspaceOptions(kind);
  const replace = useReplaceWorkspaceOptions(kind);
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceOption | null>(null);
  const options = useMemo(
    () => [...(query.data ?? [])].sort((left, right) => left.sortIndex - right.sortIndex),
    [query.data],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleOptions = options.filter((option) =>
    [option.code, option.name, option.symbol ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch),
    ),
  );

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(option: WorkspaceOption) {
    setEditing(option);
    setEditorOpen(true);
  }

  async function saveOption(draft: z.output<typeof optionDraftSchema>): Promise<boolean> {
    const existingIndex = editing
      ? options.findIndex((option) => option.id === editing.id)
      : options.length;
    const saved: WorkspaceOption = {
      id: editing?.id ?? uid(),
      kind,
      code: kind === "address-book" ? draft.code.toLocaleLowerCase() : draft.code.toUpperCase(),
      name: draft.name,
      symbol: kind === "currency" ? draft.symbol || null : null,
      isFavorite: editing?.isFavorite ?? false,
      sortIndex: editing?.sortIndex ?? options.length,
    };
    const next = editing
      ? options.map((option, index) => (index === existingIndex ? saved : option))
      : [...options, saved];

    try {
      await replace.mutateAsync(next);
      toast.success(`${copy.title} list updated`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to save ${copy.singular}`);
      return false;
    }
  }

  async function deleteOption(option: WorkspaceOption) {
    try {
      await replace.mutateAsync(options.filter((candidate) => candidate.id !== option.id));
      toast.success(`${option.name} removed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to remove ${copy.singular}`);
    }
  }

  async function moveOption(option: WorkspaceOption, direction: -1 | 1) {
    const index = options.findIndex((candidate) => candidate.id === option.id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= options.length) return;
    const next = [...options];
    [next[index], next[destination]] = [next[destination], next[index]];
    try {
      await replace.mutateAsync(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change sequence");
    }
  }

  async function toggleFavorite(option: WorkspaceOption) {
    try {
      await replace.mutateAsync(
        options.map((candidate) =>
          candidate.id === option.id
            ? { ...candidate, isFavorite: !candidate.isFavorite }
            : candidate,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update favorite");
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-5">
      <SettingsPanelHeader
        title={copy.title}
        description={copy.description}
        action={
          <Button
            type="button"
            disabled={query.isLoading || query.isError || replace.isPending}
            onClick={openNew}
          >
            <Plus /> Add {copy.singular}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            placeholder={copy.searchPlaceholder}
            aria-label={`Search ${copy.title.toLocaleLowerCase()}`}
          />
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">
          {visibleOptions.length === options.length
            ? `${options.length} entries`
            : `${visibleOptions.length} of ${options.length} entries`}
        </p>
      </div>

      {query.isLoading ? (
        <OptionsLoadingTable kind={kind} />
      ) : query.isError ? (
        <div className="border-destructive/30 bg-destructive/5 flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border p-6 text-center">
          <p className="text-destructive text-sm font-medium">
            Unable to load {copy.title.toLocaleLowerCase()}.
          </p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            <RefreshCw /> Retry
          </Button>
        </div>
      ) : options.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
          <Icon className="text-muted-foreground size-6" />
          <p className="font-medium">No {copy.title.toLocaleLowerCase()} entries</p>
          <Button type="button" variant="outline" onClick={openNew}>
            <Plus /> Add {copy.singular}
          </Button>
        </div>
      ) : visibleOptions.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <Search className="text-muted-foreground size-5" />
          <p className="font-medium">No matching entries</p>
          <Button type="button" variant="ghost" onClick={() => setSearch("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-[34rem] overflow-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <thead className="bg-muted/80 text-muted-foreground sticky top-0 z-10 text-xs uppercase">
                <tr>
                  <th className="w-20 px-4 py-3 font-semibold">Sequence</th>
                  <th className="w-28 px-4 py-3 font-semibold">Code</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  {kind === "currency" ? (
                    <th className="w-28 px-4 py-3 font-semibold">Symbol</th>
                  ) : null}
                  <th className="w-44 px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleOptions.map((option) => {
                  const index = options.findIndex((candidate) => candidate.id === option.id);
                  return (
                    <tr key={option.id} className="hover:bg-muted/30">
                      <td className="text-muted-foreground px-4 py-2.5 font-mono text-xs tabular-nums">
                        {option.sortIndex + 1}
                      </td>
                      <td className="px-4 py-2.5 font-mono font-semibold">{option.code}</td>
                      <td className="px-4 py-2.5 font-medium">{option.name}</td>
                      {kind === "currency" ? (
                        <td className="px-4 py-2.5 text-base">{option.symbol ?? "-"}</td>
                      ) : null}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <OrderControls
                            label={option.name}
                            index={index}
                            total={options.length}
                            disabled={replace.isPending}
                            onMove={(direction) => void moveOption(option, direction)}
                          />
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={
                              option.isFavorite
                                ? `Remove ${option.name} from favorites`
                                : `Favorite ${option.name}`
                            }
                            title={option.isFavorite ? "Favorite" : "Add favorite"}
                            disabled={replace.isPending}
                            onClick={() => void toggleFavorite(option)}
                          >
                            <Heart
                              className={option.isFavorite ? "fill-current text-rose-500" : ""}
                            />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit ${option.name}`}
                            title={`Edit ${option.name}`}
                            disabled={replace.isPending}
                            onClick={() => openEdit(option)}
                          >
                            <Edit3 />
                          </Button>
                          <ConfirmDialog
                            title={`Remove ${option.name}?`}
                            description={`This removes ${option.name} from future ${copy.title.toLocaleLowerCase()} selections.`}
                            confirmLabel="Remove"
                            onConfirm={() => deleteOption(option)}
                            trigger={
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove ${option.name}`}
                                title={`Remove ${option.name}`}
                                disabled={replace.isPending}
                              >
                                <Trash2 />
                              </Button>
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editorOpen ? (
        <OptionEditorDialog
          kind={kind}
          open
          option={editing}
          options={options}
          pending={replace.isPending}
          onOpenChange={setEditorOpen}
          onSave={saveOption}
        />
      ) : null}
    </section>
  );
}
