"use client";

import { createContext, useContext, type CSSProperties } from "react";
import { useReactFlow } from "@xyflow/react";

import { DEFAULT_EDGE_COLOR } from "@/lib/nodes/ports";
import type {
  ImageGenerationOutputFormat,
  ImageGenerationResolution,
  ImageGenerationSize,
} from "@/lib/image-generation-models";
import type { GenerationRunHandle } from "@/lib/generation-run";
import type { ImageMaskRegion } from "@/lib/nodes/types";

export interface ConnectedImageReference {
  edgeId: string;
  nodeId: string;
  kind: "image";
  alias: string;
  label: string;
  imageUrl: string;
  masks: ImageMaskRegion[];
}

export interface ConnectedPantoneReference {
  edgeId: string;
  nodeId: string;
  kind: "pantone";
  alias: string;
  label: string;
  swatchHex: string;
}

export type ConnectedInputReference = ConnectedImageReference | ConnectedPantoneReference;

export interface ConnectedOutputState {
  nodeId: string;
  resultUrl: string | null;
  prompt?: string;
  model?: string;
  outputFormat?: ImageGenerationOutputFormat;
  status: "idle" | "loading" | "error" | "done";
  error?: string;
}

/**
 * A single image- or color-bearing source wired into a G2 node, split by the
 * role the drop recorded on the edge. `main` is the image (A) — the mask
 * carrier; `reference` holds B/C/D… and may be either an image reference or a
 * Pantone swatch. Reuses the ConnectedInputReference union so Pantone sources
 * (color-only, no pixels) flow through the same plumbing as image sources —
 * the G2 editor just needs to know which one is the main image vs. a reference.
 */
export interface G2ImageReferences {
  main: ConnectedImageReference | null;
  references: ConnectedInputReference[];
}

export interface CanvasActions {
  /** Patch a node's data object (shallow merge). */
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  /** Return image inputs connected to a node, used as named generation references. */
  getConnectedInputReferences: (nodeId: string) => ConnectedInputReference[];
  /**
   * G2 only: image-bearing sources wired into the node, split by the
   * `data.g2Role` recorded on each edge at drop time ("main" vs. "reference").
   * Edges without a role default to "reference" (so legacy wires still show
   * up as references); a single un_ROLEd edge is treated as main.
   */
  getG2ImageReferences: (nodeId: string) => G2ImageReferences;
  /**
   * G2 only: create a wired edge from `sourceNodeId` into the G2 node `g2NodeId`,
   * tagged with the drop role so the thumbnail lands in the right area. Used by
   * the G2 node's HTML5 drag-fallback (the Link2 handle on image/output nodes);
   * the primary path is dragging the React Flow edge dot, which the canvas
   * editor wires directly. Returns false if the source has no image or the
   * edge already exists.
   */
  addG2ImageReference: (g2NodeId: string, sourceNodeId: string, role: "main" | "reference") => boolean;
  /** True when a Generate node is connected to an Output node. */
  hasConnectedOutputNode: (generateNodeId: string) => boolean;
  /** Current data snapshot for the Output node connected to a Generate node. */
  getConnectedOutputState: (generateNodeId: string) => ConnectedOutputState | null;
  /** Patch the Output node connected to a Generate node. Returns false when no Output is wired. */
  updateConnectedOutputData: (generateNodeId: string, patch: Record<string, unknown>) => boolean;
  /** Claim the single active generation slot for a Generate node. */
  startGenerationRun: (generateNodeId: string) => GenerationRunHandle | null;
  /** True only while this exact request is still allowed to write canvas state. */
  isGenerationRunCurrent: (generateNodeId: string, runId: string) => boolean;
  /** Release a run without affecting a newer request for the same node. */
  finishGenerationRun: (generateNodeId: string, runId: string) => void;
  /** Abort active work and reset a Generate node or connected Output node to idle. */
  cancelGenerationRun: (nodeId: string) => boolean;
  /** Store a generated image URL on the connected Output node and record it in image history. */
  writeGeneratedImageToOutput: (
    generateNodeId: string,
    url: string,
    meta: {
      prompt: string;
      model: string;
      size: ImageGenerationSize;
      resolution: ImageGenerationResolution;
      outputFormat: ImageGenerationOutputFormat;
      storagePath: string | null;
      durationMs?: number;
    },
  ) => boolean;
  /** Remove a node and any wires connected to it. */
  deleteNode: (id: string) => void;
  /** Count unique nodes connected by wires to this node. */
  getNodeConnectionCount: (id: string) => number;
  /** Remove a group shell while preserving its children and their connections. */
  ungroupNode: (id: string) => void;
  /** Remove all external outgoing wires created from a group's direct children. */
  disconnectGroupNode: (id: string) => void;
  /** Detach one child node from its parent group while preserving its canvas position. */
  leaveGroupNode: (id: string) => void;
  /** Remove a single wire (edge) between nodes. */
  deleteEdge: (id: string) => void;
  /** Resize a node (px). Keeps the top-left corner fixed under nodeOrigin [0.5,0.5]. */
  resizeNode: (id: string, width: number, height: number) => void;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);

export function useCanvasActions(): CanvasActions {
  const ctx = useContext(CanvasActionsContext);
  if (!ctx) {
    throw new Error("useCanvasActions must be used within CanvasActionsContext");
  }
  return ctx;
}

/**
 * Returns the accent color of this node's parent group (if any), so a grouped
 * node can paint an outline matching its group. Reads the live store; the node
 * re-renders when its own `parentId` changes (attach/detach).
 */
export function useGroupAccent(parentId?: string | null): string | null {
  const { getNode } = useReactFlow();
  if (!parentId) return null;
  const parent = getNode(parentId);
  return (parent?.data?.color as string | undefined) ?? null;
}

/**
 * Live connection-in-progress state. The source node (where the drag started)
 * and the node currently under the cursor (the drop target) are both
 * highlighted so the user can see where a wire is coming from and where it will
 * land. Kept in its own context (separate from {@link CanvasActionsContext}) so
 * action-only consumers don't re-render while a drag is in flight.
 */
export interface ConnectionHighlight {
  sourceId: string | null;
  targetId: string | null;
  /** Which dot on the hovered target node the pointer is over ("left" | "right" | null). */
  targetDot: "left" | "right" | null;
  /**
   * When the connection pointer is hovering a G2 node's tagged drop area, the
   * role of that area ("main" | "reference" | null). Lets the G2 node highlight
   * just that area instead of the whole node body.
   */
  targetG2Drop: "main" | "reference" | null;
  /** Color shared by the in-progress wire and all highlight rings — the source node's type color. */
  color: string;
}

export const ConnectionHighlightContext = createContext<ConnectionHighlight>({
  sourceId: null,
  targetId: null,
  targetDot: null,
  targetG2Drop: null,
  color: DEFAULT_EDGE_COLOR,
});

export interface ReferenceHover {
  hoveredReferenceNodeId: string | null;
  setHoveredReferenceNodeId: (nodeId: string | null) => void;
}

export const ReferenceHoverContext = createContext<ReferenceHover>({
  hoveredReferenceNodeId: null,
  setHoveredReferenceNodeId: () => undefined,
});

export function useReferenceHover(): ReferenceHover {
  return useContext(ReferenceHoverContext);
}

/** ~50% alpha, appended to a 6-digit hex color to soften the ring's outer glow. */
const RING_GLOW_ALPHA = "80";

/**
 * Returns a box-shadow ring style when `id` is the connection source or the
 * hovered target, otherwise `undefined`. Uses box-shadow (not border) so the
 * node's layout never shifts while it is highlighted.
 */
export function useConnectionHighlight(id: string): CSSProperties | undefined {
  const { sourceId, targetId, color } = useContext(ConnectionHighlightContext);
  if (id !== sourceId && id !== targetId) return undefined;
  return {
    boxShadow: `0 0 0 2px ${color}, 0 0 16px ${color}${RING_GLOW_ALPHA}`,
  };
}
