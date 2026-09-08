"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { Boxes, Edit3, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImageThumbnailStack } from "@/components/image-thumbnail-stack";
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
import {
  useDeleteGenericNodeDefinition,
  useGenericNodeDefinitions,
  useReorderGenericNodeDefinitions,
  useUpsertGenericNodeDefinition,
} from "@/lib/hooks/use-workspace-records";
import {
  genericNodeDefinitionInputSchema,
  type GenericNodeDefinition,
  type GenericNodeDefinitionInput,
} from "@/lib/workspace-settings";
import { OrderControls } from "./order-controls";
import { SettingsPanelHeader } from "./settings-panel-header";
import { MultiImageUploadField } from "./multi-image-upload-field";

function GenericNodeEditorDialog({
  open,
  definition,
  definitions,
  pending,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  definition: GenericNodeDefinition | null;
  definitions: GenericNodeDefinition[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: GenericNodeDefinitionInput) => Promise<boolean>;
}) {
  const nameId = useId();
  const [name, setName] = useState(definition?.name ?? "");
  const [images, setImages] = useState(definition?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = genericNodeDefinitionInputSchema.safeParse({ name, images });
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setError(
        firstIssue?.path[0] === "images"
          ? "Upload at least one image for this node."
          : (firstIssue?.message ?? "Check the form."),
      );
      return;
    }
    const duplicate = definitions.some(
      (candidate) =>
        candidate.id !== definition?.id &&
        candidate.name.toLocaleLowerCase() === parsed.data.name.toLocaleLowerCase(),
    );
    if (duplicate) {
      setError(`A generic node named ${parsed.data.name} already exists.`);
      return;
    }

    setError(null);
    if (await onSave(parsed.data)) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{definition ? "Edit generic node" : "Add generic node"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor={nameId}>Node name</Label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Fabric reference"
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label>Node images</Label>
              <span className="text-muted-foreground text-xs tabular-nums">
                {images.length} image{images.length === 1 ? "" : "s"}
              </span>
            </div>
            <MultiImageUploadField
              images={images}
              disabled={pending}
              onBusyChange={setUploading}
              onChange={(nextImages) => {
                setImages(nextImages);
                setError(null);
              }}
            />
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || uploading}>
              {pending ? "Saving..." : definition ? "Save changes" : "Add generic node"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GenericNodesLoadingTable() {
  return (
    <div className="overflow-hidden rounded-lg border" aria-label="Loading generic nodes">
      <div className="bg-muted/50 h-10 border-b" />
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="grid h-16 grid-cols-[4rem_4rem_1fr_10rem] items-center gap-3 border-b px-4 last:border-b-0"
        >
          <Skeleton className="h-4 w-8" />
          <Skeleton className="size-10" />
          <Skeleton className="h-4 w-48 max-w-full" />
          <Skeleton className="ml-auto h-7 w-28" />
        </div>
      ))}
    </div>
  );
}

export function GenericNodeSettingsPanel() {
  const query = useGenericNodeDefinitions();
  const upsert = useUpsertGenericNodeDefinition();
  const remove = useDeleteGenericNodeDefinition();
  const reorder = useReorderGenericNodeDefinitions();
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<GenericNodeDefinition | null>(null);
  const definitions = useMemo(
    () => [...(query.data ?? [])].sort((left, right) => left.sortIndex - right.sortIndex),
    [query.data],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleDefinitions = definitions.filter((definition) =>
    definition.name.toLocaleLowerCase().includes(normalizedSearch),
  );
  const mutationPending = upsert.isPending || remove.isPending || reorder.isPending;

  function openNew() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(definition: GenericNodeDefinition) {
    setEditing(definition);
    setEditorOpen(true);
  }

  async function saveDefinition(input: GenericNodeDefinitionInput): Promise<boolean> {
    try {
      await upsert.mutateAsync({ id: editing?.id ?? null, input });
      toast.success(editing ? "Generic node updated" : "Generic node added to the palette");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save generic node");
      return false;
    }
  }

  async function deleteDefinition(definition: GenericNodeDefinition) {
    try {
      await remove.mutateAsync(definition.id);
      toast.success(`${definition.name} removed`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove generic node");
    }
  }

  async function moveDefinition(definition: GenericNodeDefinition, direction: -1 | 1) {
    const index = definitions.findIndex((candidate) => candidate.id === definition.id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= definitions.length) return;
    const next = [...definitions];
    [next[index], next[destination]] = [next[destination], next[index]];
    try {
      await reorder.mutateAsync(next.map((candidate) => candidate.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change node sequence");
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-5">
      <SettingsPanelHeader
        title="Generic node"
        description="Canvas palette definitions and preferred sequence."
        action={
          <Button
            type="button"
            disabled={query.isLoading || query.isError || mutationPending}
            onClick={openNew}
          >
            <Plus /> Add generic node
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
            placeholder="Search node name"
            aria-label="Search generic nodes"
          />
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">
          {visibleDefinitions.length === definitions.length
            ? `${definitions.length} nodes`
            : `${visibleDefinitions.length} of ${definitions.length} nodes`}
        </p>
      </div>

      {query.isLoading ? (
        <GenericNodesLoadingTable />
      ) : query.isError ? (
        <div className="border-destructive/30 bg-destructive/5 flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border p-6 text-center">
          <p className="text-destructive text-sm font-medium">Unable to load generic nodes.</p>
          {query.error ? (
            <p className="text-destructive/80 max-w-md text-xs">
              {query.error.message}
            </p>
          ) : null}
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>
            <RefreshCw /> Retry
          </Button>
        </div>
      ) : definitions.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
          <span className="bg-secondary text-secondary-foreground grid size-11 place-items-center rounded-md">
            <Boxes className="size-5" />
          </span>
          <div>
            <p className="font-medium">No generic nodes yet</p>
          </div>
          <Button type="button" variant="outline" onClick={openNew}>
            <Plus /> Add generic node
          </Button>
        </div>
      ) : visibleDefinitions.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <Search className="text-muted-foreground size-5" />
          <p className="font-medium">No matching nodes</p>
          <Button type="button" variant="ghost" onClick={() => setSearch("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-[34rem] overflow-auto">
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead className="bg-muted/80 text-muted-foreground sticky top-0 z-10 text-xs uppercase">
                <tr>
                  <th className="w-20 px-4 py-3 font-semibold">Sequence</th>
                  <th className="w-32 px-4 py-3 font-semibold">Images</th>
                  <th className="px-4 py-3 font-semibold">Node name</th>
                  <th className="w-44 px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleDefinitions.map((definition) => {
                  const index = definitions.findIndex(
                    (candidate) => candidate.id === definition.id,
                  );
                  return (
                    <tr key={definition.id} className="hover:bg-muted/30">
                      <td className="text-muted-foreground px-4 py-2.5 font-mono text-xs tabular-nums">
                        {definition.sortIndex + 1}
                      </td>
                      <td className="px-4 py-2.5">
                        <div
                          className="flex items-center gap-2"
                          title={`${definition.images.length} images`}
                        >
                          <ImageThumbnailStack images={definition.images} />
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {definition.images.length}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-medium">{definition.name}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <OrderControls
                            label={definition.name}
                            index={index}
                            total={definitions.length}
                            disabled={mutationPending}
                            onMove={(direction) => void moveDefinition(definition, direction)}
                          />
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit ${definition.name}`}
                            title={`Edit ${definition.name}`}
                            disabled={mutationPending}
                            onClick={() => openEdit(definition)}
                          >
                            <Edit3 />
                          </Button>
                          <ConfirmDialog
                            title={`Remove ${definition.name}?`}
                            description="This removes the definition from the canvas palette. Existing canvas nodes keep their saved image and name."
                            confirmLabel="Remove"
                            onConfirm={() => deleteDefinition(definition)}
                            trigger={
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove ${definition.name}`}
                                title={`Remove ${definition.name}`}
                                disabled={mutationPending}
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
        <GenericNodeEditorDialog
          open
          definition={editing}
          definitions={definitions}
          pending={upsert.isPending}
          onOpenChange={setEditorOpen}
          onSave={saveDefinition}
        />
      ) : null}
    </section>
  );
}
