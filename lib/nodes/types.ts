import type { Edge, Node } from "@xyflow/react";
import type {
  ImageGenerationModelId,
  ImageGenerationOutputFormat,
  ImageGenerationResolution,
  ImageGenerationSize,
} from "@/lib/image-generation-models";
import type { SupplierProductType } from "@/lib/workspace-records";
import type { GenericNodeImage } from "@/lib/workspace-settings";
import type { PantoneCatalog } from "./pantone";

export interface ImageMaskStrokePoint {
  x: number;
  y: number;
}

export interface ImageMaskStroke {
  id: string;
  thickness: number;
  points: ImageMaskStrokePoint[];
  closed?: boolean;
}

export type ImageMaskColorScope = "global" | "region";

export interface ImageMaskColorSelection {
  id: string;
  seed: ImageMaskStrokePoint;
  tolerance: number;
  scope: ImageMaskColorScope;
}

export interface ImageMaskRegion {
  id: string;
  name: string;
  imageKey?: string;
  excludedMaskIds?: string[];
  strokes: ImageMaskStroke[];
  colorSelections?: ImageMaskColorSelection[];
  maskUrl?: string;
}

export const GENERATE_CHANGE_TYPES = ["texture", "color", "density", "object", "other"] as const;
export type GenerateChangeType = (typeof GENERATE_CHANGE_TYPES)[number];

export interface GeneratePromptRow {
  id: string;
  sourceNodeId: string;
  maskId: string;
  changeType: GenerateChangeType;
  targetText: string;
}

/** Registered canvas node type identifiers (kept in sync with the registry). */
export const NODE_TYPES = [
  "note",
  "image",
  "group",
  "imageInput",
  "generate",
  "imageOutput",
  "suppler",
  "product",
  "action",
  "pantone",
  "g2",
  "painted",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

// ── Per-type node data ───────────────────────────────────────────────────
// Each carries an index signature so the type satisfies React Flow v12's
// `Record<string, unknown>` data constraint; declared fields keep their types.
export interface NoteNodeData {
  text: string;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface ImageNodeData {
  url: string | null;
  alt?: string;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface InputNodeData {
  alias: string;
  imageUrl: string | null;
  storagePath?: string | null;
  imageMasks?: ImageMaskRegion[];
  genericDefinitionId?: string;
  genericDefinitionName?: string;
  /** Definition images are snapshotted when the node is created. */
  genericImages?: GenericNodeImage[];
  selectedGenericImageId?: string | null;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface GroupNodeData {
  label: string;
  /** Accent color shared by the group and its child nodes for identification. */
  color?: string;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface GenerateNodeData {
  prompt: string;
  promptRows?: GeneratePromptRow[];
  model: ImageGenerationModelId;
  size?: ImageGenerationSize;
  outputFormat?: ImageGenerationOutputFormat;
  resolution?: ImageGenerationResolution;
  systemPrompt?: string;
  references: string[];
  /** When true and a mask is attached, the edit request sets `size` to the
   * source image's exact pixel dimensions (preserves aspect + spatial
   * alignment with the mask). When false, uses the selected `size`/`resolution`. */
  matchSourceSize?: boolean;
  status: "idle" | "loading" | "error" | "done";
  resultUrl: string | null;
  error?: string;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface OutputNodeData {
  resultUrl: string | null;
  prompt?: string;
  model?: string;
  outputFormat?: ImageGenerationOutputFormat;
  generationDurationMs?: number;
  createdAt?: string;
  status: "idle" | "loading" | "error" | "done";
  error?: string;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface SupplerNodeData {
  alias: string;
  selectedProductType: SupplierProductType | null;
  productTypeQuery: string;
  supplierQuery: string;
  supplierId: string | null;
  supplierName: string | null;
  productId: string | null;
  productSubject: string | null;
  variantId: string | null;
  variantImageUrl: string | null;
  variantImageName: string | null;
  imageMasks?: ImageMaskRegion[];
  title?: string;
  notes?: string;
  status?: "draft" | "ready" | "blocked";
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface ProductNodeData {
  alias: string;
  customerQuery: string;
  customerId: string | null;
  customerName: string | null;
  productId: string | null;
  productSubject: string | null;
  variantId: string | null;
  variantImageUrl: string | null;
  variantImageName: string | null;
  imageMasks?: ImageMaskRegion[];
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface ActionNodeData {
  title: string;
  notes: string;
  status: "manual" | "queued" | "done";
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface PantoneNodeData {
  alias: string;
  query: string;
  code: string | null;
  name: string | null;
  hex: string | null;
  catalog?: PantoneCatalog | null;
  catalogFilter?: PantoneCatalog | null;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface G2Region {
  id: string;
  name: string; // editable in the draw overlay; referenced in the prompt via @name
  type: "rect" | "freehand";
  /**
   * Coordinates are stored in the main image's NATURAL pixel space so masks
   * render correctly regardless of the view size used to draw them.
   * - rect:     { left, top, width, height }
   * - freehand: { points: {x,y}[], thickness, closed }
   */
  data: Record<string, unknown>;
  color: string;
  /** Rect outline width (visual only; rects fill the whole interior) or brush stroke width. */
  thickness: number;
}

export interface G2Reference {
  /** Reference image URL (B, C, D…). */
  url: string;
  /** Node the image was dragged from, when dropped from a canvas node (for @alias). */
  sourceNodeId: string | null;
  /** Alias shown on the thumbnail and used in @ mentions. */
  alias: string | null;
}

export interface G2NodeData {
  /** Main uploaded/dragged image A */
  mainImageUrl: string | null;
  mainImageStoragePath: string | null;
  /** Node the main image was dragged from (for the @alias badge). */
  mainImageSourceNodeId: string | null;
  /** Alias shown on the main-image thumbnail (e.g. "@shoe"). */
  mainImageAlias: string | null;
  /** Regions drawn on the main image, in natural-image pixel space. */
  g2Regions: G2Region[];
  /** Undo/redo snapshots of g2Regions (overlay editor history). */
  undoStack: G2Region[][];
  redoStack: G2Region[][];
  /** Reference image descriptors (B, C, D...). */
  references: G2Reference[];
  /** Edit prompt (supports @alias mentions). */
  prompt: string;
  /** System prompt */
  systemPrompt: string;
  /** Generation options (user-editable). */
  model?: ImageGenerationModelId;
  size?: ImageGenerationSize;
  outputFormat?: ImageGenerationOutputFormat;
  resolution?: ImageGenerationResolution;
  matchSourceSize?: boolean;
  status: "idle" | "loading" | "error" | "done";
  resultUrl: string | null;
  error?: string;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface PaintedNodeData {
  /**
   * The resolved main image URL to render (either an override or a promoted
   * wired source). Written by the component's resolution effect.
   */
  mainImageUrl: string | null;
  mainImageStoragePath: string | null;
  /**
   * True while the last main image came from a paste/drop on the node body
   * (not a wired source). While true, the wired value is shadowed — the
   * resolution effect does not overwrite it. Clearing the override (set to
   * false) lets a wired source re-promote to `mainImageUrl`.
   */
  mainImageOverride: boolean;
  /** Optional alias badge shown on the thumbnail (e.g. "@shoe"). */
  alias?: string | null;
  /**
   * Regions drawn on the main image in its NATURAL pixel space, reusing the
   * G2 region shape. The Painted node drives its OWN region editor and mask —
   * these are NOT G2 node regions; the name keeps them self-documenting.
   */
  paintedRegions?: G2Region[];
  paintedUndoStack?: G2Region[][];
  paintedRedoStack?: G2Region[][];
  /** Plain-text edit prompt (NO @alias mention system, unlike G2). */
  prompt?: string;
  /** Generation options (mirror G2's option set). */
  model?: ImageGenerationModelId;
  size?: ImageGenerationSize;
  outputFormat?: ImageGenerationOutputFormat;
  resolution?: ImageGenerationResolution;
  matchSourceSize?: boolean;
  /** Run status, kept in sync with the connected Output node. */
  status?: "idle" | "loading" | "error" | "done";
  resultUrl?: string | null;
  error?: string;
  /** Node size in pixels; set by the resize handle. Absent = type default. */
  width?: number;
  height?: number;
  [key: string]: unknown;
}

// ── Generic shapes used by the persistence layer ─────────────────────────
export type CanvasNode = Node<Record<string, unknown>, NodeType>;
export type CanvasEdge = Edge;

export interface CanvasContent {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const EMPTY_CANVAS_CONTENT: CanvasContent = { nodes: [], edges: [] };

// ── Per-type node shapes for typed components ────────────────────────────
export type NoteCanvasNode = Node<NoteNodeData, "note">;
export type ImageCanvasNode = Node<ImageNodeData, "image">;
export type InputCanvasNode = Node<InputNodeData, "imageInput">;
export type GroupCanvasNode = Node<GroupNodeData, "group">;
export type GenerateCanvasNode = Node<GenerateNodeData, "generate">;
export type OutputCanvasNode = Node<OutputNodeData, "imageOutput">;
export type SupplerCanvasNode = Node<SupplerNodeData, "suppler">;
export type ProductCanvasNode = Node<ProductNodeData, "product">;
export type ActionCanvasNode = Node<ActionNodeData, "action">;
export type PantoneCanvasNode = Node<PantoneNodeData, "pantone">;
export type G2CanvasNode = Node<G2NodeData, "g2">;
export type PaintedCanvasNode = Node<PaintedNodeData, "painted">;
