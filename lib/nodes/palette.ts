import { z } from "zod";

import { genericNodeDefinitionSchema, type GenericNodeDefinition } from "@/lib/workspace-settings";

import { createNode, NODE_META } from "./registry";
import { NODE_TYPES, type CanvasNode, type NodeType } from "./types";

export const PALETTE_DRAG_MIME_TYPE = "application/ica-node";

export interface PaletteNodeEntry {
  type: NodeType;
  label: string;
}

const FULL_PALETTE_TYPES: NodeType[] = [
  "imageInput",
  "generate",
  "imageOutput",
  "suppler",
  "product",
  "action",
  "pantone",
  "g2",
  "painted",
];

const REGULAR_PALETTE_TYPES: NodeType[] = [
  "imageInput",
  "product",
  "suppler",
  "pantone",
  "generate",
  "imageOutput",
];

export function paletteEntries(isAdmin: boolean): PaletteNodeEntry[] {
  const types = isAdmin ? FULL_PALETTE_TYPES : REGULAR_PALETTE_TYPES;
  return types.map((type) => ({
    type,
    label: !isAdmin && type === "product" ? "Customer" : NODE_META[type].label,
  }));
}

const paletteDragPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("registered-node"),
      type: z.enum(NODE_TYPES),
    })
    .strict(),
  z
    .object({
      kind: z.literal("generic-preset"),
      definitionId: z.string().trim().min(1),
    })
    .strict(),
]);

export type PaletteDragPayload = z.infer<typeof paletteDragPayloadSchema>;

export function serializePaletteDragPayload(payload: PaletteDragPayload): string {
  return JSON.stringify(paletteDragPayloadSchema.parse(payload));
}

export function parsePaletteDragPayload(value: unknown): PaletteDragPayload | null {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const parsed = paletteDragPayloadSchema.safeParse(JSON.parse(value) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function sortGenericNodeDefinitions(
  definitions: readonly GenericNodeDefinition[],
): GenericNodeDefinition[] {
  return [...definitions].sort(
    (left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name),
  );
}

export function createGenericPresetNode(
  definition: GenericNodeDefinition,
  position: { x: number; y: number },
): CanvasNode {
  const parsed = genericNodeDefinitionSchema.parse(definition);
  const node = createNode("imageInput", position);

  return {
    ...node,
    data: {
      ...node.data,
      alias: parsed.name,
      imageUrl: null,
      storagePath: null,
      genericDefinitionId: parsed.id,
      genericDefinitionName: parsed.name,
      genericImages: parsed.images.map((image) => ({ ...image })),
      selectedGenericImageId: null,
    },
  };
}
