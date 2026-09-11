"use client";

import {
  Image as ImageIcon,
  Download,
  Package,
  PackageOpen,
  Paintbrush,
  Palette,
  Sparkles,
  Square,
  StickyNote,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImageThumbnailStack } from "@/components/image-thumbnail-stack";
import { PALETTE_DRAG_MIME_TYPE, paletteEntries, serializePaletteDragPayload } from "@/lib/nodes/palette";
import { NODE_META } from "@/lib/nodes/registry";
import type { CanvasNode, NodeType } from "@/lib/nodes/types";
import type { GenericNodeDefinition } from "@/lib/workspace-settings";
import { useCanvasActions } from "./canvas-context";

const ICONS: Record<NodeType, LucideIcon> = {
  note: StickyNote,
  image: ImageIcon,
  imageInput: ImageIcon,
  group: Square,
  generate: Sparkles,
  imageOutput: Download,
  suppler: Package,
  product: PackageOpen,
  action: Zap,
  pantone: Palette,
  g2: Wand2,
  painted: Paintbrush,
};

function nodeDisplayName(node: CanvasNode): string {
  if (node.type === "imageInput") {
    return typeof node.data.alias === "string" && node.data.alias.trim()
      ? node.data.alias.trim()
      : "Input";
  }
  if (node.type === "pantone") {
    const alias = typeof node.data.alias === "string" ? node.data.alias.trim() : "";
    const name = typeof node.data.name === "string" ? node.data.name.trim() : "";
    const code = typeof node.data.code === "string" ? node.data.code.trim() : "";
    return alias || name || code || "Pantone";
  }
  if (node.type === "group") {
    return typeof node.data.label === "string" && node.data.label.trim()
      ? node.data.label.trim()
      : "Group";
  }
  return NODE_META[node.type].label;
}

export function NodePalette({
  nodes,
  onAdd,
  genericNodeDefinitions,
  genericNodeDefinitionsLoading,
  genericNodeDefinitionsError,
  genericNodeDefinitionsErrorMessage,
  onAddGenericNode,
  isAdmin = true,
}: {
  nodes: CanvasNode[];
  onAdd: (type: NodeType) => void;
  genericNodeDefinitions: readonly GenericNodeDefinition[];
  genericNodeDefinitionsLoading: boolean;
  genericNodeDefinitionsError: boolean;
  genericNodeDefinitionsErrorMessage?: string | null;
  onAddGenericNode: (definition: GenericNodeDefinition) => void;
  isAdmin?: boolean;
}) {
  const { leaveGroupNode } = useCanvasActions();
  const groupNodes = nodes.filter((node) => node.type === "group");
  const entries = paletteEntries(isAdmin);

  return (
    <aside className="bg-card flex min-h-0 w-44 shrink-0 flex-col gap-1.5 overflow-y-auto border-r p-3 shadow-sm">
      <span className="text-muted-foreground px-1 py-1 text-xs font-medium tracking-wide uppercase">
        Add node
      </span>
      {entries.map((entry) => {
        const meta = NODE_META[entry.type];
        const Icon = ICONS[entry.type];
        return (
          <button
            key={entry.type}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                PALETTE_DRAG_MIME_TYPE,
                serializePaletteDragPayload({ kind: "registered-node", type: entry.type }),
              );
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onAdd(entry.type)}
            className="focus-visible:ring-ring bg-background hover:border-primary/30 hover:bg-accent/60 flex h-9 cursor-grab items-center gap-2 rounded-md border px-2 text-sm shadow-sm transition-colors outline-none focus-visible:ring-2 active:cursor-grabbing"
          >
            <Icon className="text-muted-foreground size-4 shrink-0" />
            {entry.label}
          </button>
        );
      })}
      <div className="mt-2 grid gap-1.5 border-t pt-2">
        <span className="text-muted-foreground px-1 py-1 text-xs font-medium tracking-wide uppercase">
          Generic
        </span>
        {genericNodeDefinitionsLoading ? (
          <div className="grid gap-1.5" aria-label="Loading generic nodes">
            <div className="bg-muted h-9 animate-pulse rounded-md" />
            <div className="bg-muted h-9 animate-pulse rounded-md" />
          </div>
        ) : genericNodeDefinitionsError ? (
          <div className="text-destructive grid gap-1 px-1 py-2 text-xs">
            <p>Unable to load generic nodes.</p>
            {genericNodeDefinitionsErrorMessage ? (
              <p className="text-destructive/80">{genericNodeDefinitionsErrorMessage}</p>
            ) : null}
          </div>
        ) : genericNodeDefinitions.length === 0 ? (
          <p className="text-muted-foreground px-1 py-2 text-xs">No generic nodes.</p>
        ) : (
          genericNodeDefinitions.map((definition) => (
            <button
              key={definition.id}
              type="button"
              draggable
              title={definition.name}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  PALETTE_DRAG_MIME_TYPE,
                  serializePaletteDragPayload({
                    kind: "generic-preset",
                    definitionId: definition.id,
                  }),
                );
                event.dataTransfer.effectAllowed = "move";
              }}
              onClick={() => onAddGenericNode(definition)}
              className="focus-visible:ring-ring bg-background hover:border-primary/30 hover:bg-accent/60 flex h-9 cursor-grab items-center gap-2 rounded-md border px-2 text-sm shadow-sm transition-colors outline-none focus-visible:ring-2 active:cursor-grabbing"
            >
              <ImageThumbnailStack
                images={definition.images}
                maximumVisible={2}
                className="w-7 shrink-0"
                thumbnailClassName="size-5 -ml-3 rounded-sm"
                remainingClassName="size-5 -ml-3 text-[0.5rem]"
              />
              <span className="min-w-0 truncate">{definition.name}</span>
            </button>
          ))
        )}
      </div>
      <p className="text-muted-foreground mt-2 px-1 text-xs leading-5">
        Drag onto the canvas, or click to drop at the center.
      </p>
      {groupNodes.length ? (
        <div className="mt-3 grid gap-2 border-t pt-3">
          <span className="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">
            Groups
          </span>
          {groupNodes.map((group) => {
            const children = nodes.filter((node) => node.parentId === group.id);
            return (
              <div key={group.id} className="bg-background rounded-md border p-2 text-xs">
                <p className="truncate font-medium">{nodeDisplayName(group)}</p>
                <div className="text-muted-foreground mt-1 grid gap-1">
                  {children.length ? (
                    children.map((child) => (
                      <div key={child.id} className="group/child flex min-w-0 items-center gap-1">
                        <p className="min-w-0 flex-1 truncate">
                          {NODE_META[child.type].label}: {nodeDisplayName(child)}
                        </p>
                        <ConfirmDialog
                          title="Leave group?"
                          description="Remove this node from the group while preserving its canvas position."
                          confirmLabel="Leave"
                          destructive={false}
                          onConfirm={() => leaveGroupNode(child.id)}
                          trigger={
                            <button
                              type="button"
                              aria-label={`Remove ${nodeDisplayName(child)} from group`}
                              title="Remove from group"
                              className="text-muted-foreground hover:text-destructive focus-visible:ring-ring grid size-5 shrink-0 place-items-center rounded opacity-0 transition-opacity outline-none group-hover/child:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
                            >
                              <X className="size-3" />
                            </button>
                          }
                        />
                      </div>
                    ))
                  ) : (
                    <p>No nodes</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
