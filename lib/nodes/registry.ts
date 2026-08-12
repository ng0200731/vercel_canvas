import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT,
  DEFAULT_IMAGE_GENERATION_RESOLUTION,
  DEFAULT_IMAGE_GENERATION_SIZE,
} from "@/lib/image-generation-models";
import type { CanvasNode, NodeType } from "./types";

export interface NodeMeta {
  type: NodeType;
  label: string;
  description: string;
  /** Shown in the palette. `generate` is enabled in M7. */
  palette: boolean;
  defaultData: () => Record<string, unknown>;
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Distinct accent colors cycled through so each group (and its children) is easy to tell apart. */
const GROUP_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#8b5cf6",
];

function pickGroupColor(): string {
  return GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];
}

export const NODE_META: Record<NodeType, NodeMeta> = {
  note: {
    type: "note",
    label: "Note",
    description: "A text note",
    palette: false,
    defaultData: () => ({ text: "" }),
  },
  image: {
    type: "image",
    label: "Image",
    description: "Display an image",
    palette: false,
    defaultData: () => ({ url: null }),
  },
  imageInput: {
    type: "imageInput",
    label: "Input",
    description: "Named image input",
    palette: true,
    defaultData: () => ({
      alias: "image",
      imageUrl: null,
      storagePath: null,
      genericImages: [],
      selectedGenericImageId: null,
    }),
  },
  group: {
    type: "group",
    label: "Group",
    description: "A grouping box",
    palette: false,
    defaultData: () => ({ label: "Group", color: pickGroupColor() }),
  },
  generate: {
    type: "generate",
    label: "Generate",
    description: "AI image generation",
    palette: true,
    defaultData: () => ({
      prompt: "",
      promptRows: [{ id: uid(), sourceNodeId: "", maskId: "", changeType: "color", targetText: "" }],
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      size: DEFAULT_IMAGE_GENERATION_SIZE,
      outputFormat: DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT,
      resolution: DEFAULT_IMAGE_GENERATION_RESOLUTION,
      references: [],
      status: "idle",
      resultUrl: null,
    }),
  },
  imageOutput: {
    type: "imageOutput",
    label: "Output",
    description: "Generated image result",
    palette: true,
    defaultData: () => ({
      resultUrl: null,
      status: "idle",
      createdAt: new Date().toISOString(),
    }),
  },
  suppler: {
    type: "suppler",
    label: "Supplier",
    description: "Choose supplier product references",
    palette: true,
    defaultData: () => ({
      alias: "supplier",
      selectedProductType: null,
      productTypeQuery: "",
      supplierQuery: "",
      supplierId: null,
      supplierName: null,
      productId: null,
      productSubject: null,
      variantId: null,
      variantImageUrl: null,
      variantImageName: null,
    }),
  },
  product: {
    type: "product",
    label: "Product",
    description: "Choose customer product references",
    palette: true,
    defaultData: () => ({
      alias: "product",
      customerQuery: "",
      customerId: null,
      customerName: null,
      productId: null,
      productSubject: null,
      variantId: null,
      variantImageUrl: null,
      variantImageName: null,
    }),
  },
  action: {
    type: "action",
    label: "Action",
    description: "Track a workflow action",
    palette: true,
    defaultData: () => ({
      title: "Action",
      notes: "",
      status: "manual",
    }),
  },
  pantone: {
    type: "pantone",
    label: "Pantone",
    description: "Find Pantone library colors",
    palette: true,
    defaultData: () => ({
      alias: "pantone",
      query: "",
      code: null,
      name: null,
      hex: null,
      catalog: null,
      catalogFilter: null,
    }),
  },
  g2: {
    type: "g2",
    label: "G2 Edit",
    description: "Upload image, mark regions, edit with GPT Image 2",
    palette: true,
    defaultData: () => ({
      mainImageUrl: null,
      mainImageStoragePath: null,
      mainImageSourceNodeId: null,
      mainImageAlias: null,
      g2Regions: [],
      undoStack: [],
      redoStack: [],
      references: [],
      prompt: "",
      systemPrompt: "",
      // Preserve the G2 node's pre-redesign defaults (model gpt-image-2,
      // 1024x1024, PNG, preview). These differ from the model toolkit defaults
      // (which use webp), so they are spelled out here explicitly.
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      size: "1024x1024" as const,
      outputFormat: "png" as const,
      resolution: "preview" as const,
      matchSourceSize: true,
      status: "idle",
      resultUrl: null,
    }),
  },
  painted: {
    type: "painted",
    label: "Painted",
    description: "Paste, drop, or wire in a main image",
    palette: true,
    defaultData: () => ({
      mainImageUrl: null,
      mainImageStoragePath: null,
      mainImageOverride: false,
      alias: null,
      paintedRegions: [],
      paintedUndoStack: [],
      paintedRedoStack: [],
      prompt: "",
      // Edit-image defaults (mirror the G2 node): PNG preview at 1024x1024 so
      // the edited result round-trips cleanly through /api/generate and lands
      // next to the original in the Output node.
      model: DEFAULT_IMAGE_GENERATION_MODEL,
      size: "1024x1024" as const,
      outputFormat: "png" as const,
      resolution: "preview" as const,
      matchSourceSize: true,
      status: "idle",
      resultUrl: null,
    }),
  },
};

/** Node types surfaced in the palette (excludes `generate` until M7). */
export const PALETTE_NODE_TYPES: NodeType[] = Object.values(NODE_META)
  .filter((m) => m.palette)
  .map((m) => m.type);

export function createNode(type: NodeType, position: { x: number; y: number }): CanvasNode {
  return {
    id: uid(),
    type,
    position,
    data: NODE_META[type].defaultData(),
  };
}
