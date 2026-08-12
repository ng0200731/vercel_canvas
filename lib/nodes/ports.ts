import type { NodeType } from "./types";

/** ComfyUI-style color per node type. Shared by the input/output ports. */
export const NODE_PORT_COLORS: Record<NodeType, string> = {
  note: "#f59e0b", // amber
  image: "#10b981", // green
  imageInput: "#06b6d4", // cyan
  group: "#94a3b8", // slate
  generate: "#a855f7", // purple
  imageOutput: "#84cc16", // lime
  suppler: "#0ea5e9", // sky
  product: "#14b8a6", // teal
  action: "#f43f5e", // rose
  pantone: "#f97316", // orange
  g2: "#ef4444", // red
  painted: "#8b5cf6", // violet
};

/** Default connection wire color. */
export const DEFAULT_EDGE_COLOR = "#94a3b8"; // slate

/** Stroke width for link wires. */
export const EDGE_WIDTH = 1.25;

/** Hover/focus color for the active relationship between nodes. */
export const HIGHLIGHT_EDGE_COLOR = "#0f766e"; // teal

/** Stroke width for the active relationship between nodes. */
export const HIGHLIGHT_EDGE_WIDTH = 3;

export function colorForNodeType(type: string | undefined): string {
  if (!type) return DEFAULT_EDGE_COLOR;
  return NODE_PORT_COLORS[type as NodeType] ?? DEFAULT_EDGE_COLOR;
}
