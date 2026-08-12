"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type FinalConnectionState,
  type NodeChange,
  type NodeTypes,
  type OnConnectStartParams,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronLeft, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { SendCanvasDialog } from "@/components/projects/canvas-list";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCanvas } from "@/lib/hooks/use-canvas";
import { useProject } from "@/lib/hooks/use-projects";
import {
  refreshWorkspaceRecords,
  useGenericNodeDefinitions,
} from "@/lib/hooks/use-workspace-records";
import {
  normalizeImageGenerationModel,
  normalizeImageGenerationOutputFormat,
  normalizeImageGenerationResolution,
  normalizeImageGenerationSize,
  resolutionForImageGenerationModel,
  type ImageGenerationResolution,
  type ImageGenerationSize,
  type ImageGenerationOutputFormat,
} from "@/lib/image-generation-models";
import { createGenerationRunManager } from "@/lib/generation-run";
import { getCanvasStore } from "@/lib/store";
import {
  createGenericPresetNode,
  PALETTE_DRAG_MIME_TYPE,
  parsePaletteDragPayload,
  sortGenericNodeDefinitions,
} from "@/lib/nodes/palette";
import { createNode } from "@/lib/nodes/registry";
import {
  colorForNodeType,
  DEFAULT_EDGE_COLOR,
  EDGE_WIDTH,
  HIGHLIGHT_EDGE_COLOR,
  HIGHLIGHT_EDGE_WIDTH,
} from "@/lib/nodes/ports";
import type {
  CanvasContent,
  CanvasEdge,
  CanvasNode,
  ImageMaskRegion,
  NodeType,
} from "@/lib/nodes/types";
import { cn } from "@/lib/utils";
import type { GenericNodeDefinition } from "@/lib/workspace-settings";
import {
  CanvasActionsContext,
  ConnectionHighlightContext,
  ReferenceHoverContext,
  type ConnectedImageReference,
  type ConnectedInputReference,
  type ConnectedOutputState,
  type ConnectedPantoneReference,
  type G2ImageReferences,
} from "./canvas-context";
import { NodePalette } from "./node-palette";
import { CanvasLogPanel } from "./canvas-log-panel";
import { RenderGalleryDialog } from "./render-gallery-dialog";
import { DeletableEdge } from "./edges/canvas-edge";
import { ActionNode } from "./nodes/action-node";
import { G2Node } from "./nodes/g2-node";
import { GenerateNode } from "./nodes/generate-node";
import { GroupNode } from "./nodes/group-node";
import { InputNode } from "./nodes/input-node";
import { ImageNode } from "./nodes/image-node";
import { NoteNode } from "./nodes/note-node";
import { OutputNode } from "./nodes/output-node";
import { PaintedNode } from "./nodes/painted-node";
import { PantoneNode } from "./nodes/pantone-node";
import { ProductNode } from "./nodes/product-node";
import { SupplerNode } from "./nodes/suppler-node";

const AUTOSAVE_DEBOUNCE_MS = 600;
const NEW_NODE_DISPLACEMENT = 32;
const POSITION_EPSILON = 1;
const MAX_PLACEMENT_PROBES = 40;
const FIELD_FOCUS_RETRIES = 12;
const GROUP_FIT_PADDING = 18;
const ACTIVE_GENERATION_LEAVE_MESSAGE =
  "Image generation is still running. Leaving this canvas may lose the generated image. Leave anyway?";

const CANVAS_NODE_TYPES: NodeTypes = {
  note: NoteNode,
  image: ImageNode,
  imageInput: InputNode,
  group: GroupNode,
  generate: GenerateNode,
  imageOutput: OutputNode,
  suppler: SupplerNode,
  product: ProductNode,
  action: ActionNode,
  pantone: PantoneNode,
  g2: G2Node,
  painted: PaintedNode,
};

const CANVAS_EDGE_TYPES: EdgeTypes = { deletable: DeletableEdge };

const DEFAULT_CANVAS_EDGE_OPTIONS = {
  type: "deletable" as const,
  style: { stroke: DEFAULT_EDGE_COLOR, strokeWidth: EDGE_WIDTH },
};

type HoverTarget = {
  kind: "node" | "edge";
  id: string;
} | null;

interface ClientPoint {
  x: number;
  y: number;
}

interface NodeConnectionTarget {
  nodeId: string;
  /** When dropped on a G2 node's tagged area, the role to record on the edge. */
  g2Role?: "main" | "reference";
}

type PendingGroupMembershipChange =
  | {
      kind: "add";
      nodeId: string;
      groupId: string;
      center: XYPosition;
    }
  | {
      kind: "leave";
      nodeId: string;
      groupId: string;
      center: XYPosition;
    };

type NodeCreationRequest =
  | { kind: "registered-node"; type: NodeType }
  | { kind: "generic-preset"; definition: GenericNodeDefinition };

function getClientPoint(event: MouseEvent | TouchEvent): ClientPoint | null {
  if ("changedTouches" in event) {
    const touch = event.changedTouches[0] ?? event.touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  return { x: event.clientX, y: event.clientY };
}

function findNodeConnectionTarget(
  point: ClientPoint,
  sourceNodeId: string,
): NodeConnectionTarget | null {
  const element = document.elementFromPoint(point.x, point.y);
  const nodeElement = element?.closest<HTMLElement>(".react-flow__node");
  const nodeId = nodeElement?.getAttribute("data-id");

  if (!nodeElement || !nodeId || nodeId === sourceNodeId) return null;

  // Surface a G2 drop-area role if the pointer is on a tagged zone so the
  // created edge can remember main vs. reference.
  const dropZone = element?.closest<HTMLElement>("[data-g2-drop]");
  const g2Role =
    dropZone?.getAttribute("data-g2-drop") === "main" ||
    dropZone?.getAttribute("data-g2-drop") === "reference"
      ? (dropZone.getAttribute("data-g2-drop") as "main" | "reference")
      : undefined;

  if (!nodeElement.querySelector('[data-handleid="left"]')) return null;
  return g2Role ? { nodeId, g2Role } : { nodeId };
}

/**
 * Reorder so each parent appears before its children. React Flow paints nodes in
 * array order, so this keeps child nodes on top of their group container.
 */
function reorderChildrenAfterParents(nodes: CanvasNode[]): CanvasNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const ordered: CanvasNode[] = [];
  const seen = new Set<string>();
  const visit = (n: CanvasNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    if (parent) visit(parent);
    ordered.push(n);
  };
  for (const n of nodes) visit(n);
  return ordered;
}

/**
 * Absolute geometry of a node. With `nodeOrigin [0.5,0.5]`, React Flow's
 * `internals.positionAbsolute` is the **top-left** corner and the stored
 * `position` is the center — so we expose top-left (`x`,`y`), size, and the
 * center (`cx`,`cy`) to keep reparenting math reference-correct.
 */
type Rectable =
  | {
      internals?: { positionAbsolute?: XYPosition };
      measured?: { width?: number; height?: number };
    }
  | undefined;

function rectOf(
  n: Rectable,
): { x: number; y: number; w: number; h: number; cx: number; cy: number } | null {
  const abs = n?.internals?.positionAbsolute;
  const w = n?.measured?.width ?? 0;
  const h = n?.measured?.height ?? 0;
  if (!abs || !w || !h) return null;
  return { x: abs.x, y: abs.y, w, h, cx: abs.x + w / 2, cy: abs.y + h / 2 };
}

function isSamePosition(a: XYPosition, b: XYPosition): boolean {
  return Math.abs(a.x - b.x) < POSITION_EPSILON && Math.abs(a.y - b.y) < POSITION_EPSILON;
}

function findNewNodePosition(base: XYPosition, nodes: CanvasNode[]): XYPosition {
  const isOccupied = (position: XYPosition) =>
    nodes.some((node) => !node.parentId && isSamePosition(node.position, position));

  for (let step = 0; step <= MAX_PLACEMENT_PROBES; step += 1) {
    const position =
      step === 0
        ? base
        : {
            x: base.x + NEW_NODE_DISPLACEMENT * step,
            y: base.y + NEW_NODE_DISPLACEMENT * step,
          };
    if (!isOccupied(position)) return position;
  }

  return {
    x: base.x + NEW_NODE_DISPLACEMENT * (MAX_PLACEMENT_PROBES + 1),
    y: base.y + NEW_NODE_DISPLACEMENT * (MAX_PLACEMENT_PROBES + 1),
  };
}

function findFreePositionInRect(
  base: XYPosition,
  rect: { x: number; y: number; w: number; h: number },
  occupiedRects: Array<{ x: number; y: number; w: number; h: number }>,
  nodeSize = { width: 240, height: 240 },
): XYPosition {
  const halfW = nodeSize.width / 2;
  const halfH = nodeSize.height / 2;
  const clampInside = (position: XYPosition): XYPosition => ({
    x: Math.min(rect.x + rect.w - halfW, Math.max(rect.x + halfW, position.x)),
    y: Math.min(rect.y + rect.h - halfH, Math.max(rect.y + halfH, position.y)),
  });
  const overlaps = (position: XYPosition) => {
    const candidate = {
      x: position.x - halfW,
      y: position.y - halfH,
      w: nodeSize.width,
      h: nodeSize.height,
    };
    return occupiedRects.some((occupied) => rectsOverlap(candidate, occupied));
  };

  const first = clampInside(base);
  if (!overlaps(first)) return first;

  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      const position = clampInside({
        x: rect.x + halfW + column * (nodeSize.width + 24),
        y: rect.y + halfH + row * (nodeSize.height + 24),
      });
      if (!overlaps(position)) return position;
    }
  }

  return first;
}

function getNodeSizeFromData(node: CanvasNode, fallback: { width: number; height: number }) {
  return {
    width: typeof node.data.width === "number" ? node.data.width : fallback.width,
    height: typeof node.data.height === "number" ? node.data.height : fallback.height,
  };
}

function getGroupRectFromNode(node: CanvasNode): { x: number; y: number; w: number; h: number } {
  const size = getNodeSizeFromData(node, { width: 320, height: 192 });
  return {
    x: node.position.x - size.width / 2,
    y: node.position.y - size.height / 2,
    w: size.width,
    h: size.height,
  };
}

function getAbsoluteNodeCenter(
  node: CanvasNode,
  nodesById: Map<string, CanvasNode>,
  fallbackGroupRect?: { x: number; y: number; w: number; h: number },
): XYPosition {
  if (!node.parentId) return node.position;
  const parent = nodesById.get(node.parentId);
  const parentRect = fallbackGroupRect ?? (parent ? getGroupRectFromNode(parent) : null);
  if (!parentRect) return node.position;
  return {
    x: parentRect.x + node.position.x,
    y: parentRect.y + node.position.y,
  };
}

function getFallbackNodeRect(
  node: CanvasNode,
  nodesById: Map<string, CanvasNode>,
  fallbackSize: { width: number; height: number },
  fallbackGroupRect?: { x: number; y: number; w: number; h: number },
) {
  const size = getNodeSizeFromData(node, fallbackSize);
  const center = getAbsoluteNodeCenter(node, nodesById, fallbackGroupRect);
  return {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    w: size.width,
    h: size.height,
    cx: center.x,
    cy: center.y,
  };
}

function rectsOverlap(
  left: { x: number; y: number; w: number; h: number },
  right: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  );
}

function appendSelectedNode(nodes: CanvasNode[], node: CanvasNode): CanvasNode[] {
  return nodes
    .map((n) => (n.selected ? { ...n, selected: false } : n))
    .concat({
      ...node,
      selected: true,
    });
}

function nodeNeedsInitialFieldFocus(type: NodeType): boolean {
  return type === "imageInput" || type === "pantone" || type === "suppler" || type === "product";
}

function focusNewNodeField(nodeId: string) {
  let attempts = 0;

  function focusField(field: HTMLInputElement) {
    field.focus({ preventScroll: true });
    field.select();

    for (const delay of [0, 80]) {
      window.setTimeout(() => {
        if (document.activeElement !== field) {
          field.focus({ preventScroll: true });
          field.select();
        }
      }, delay);
    }
  }

  function tryFocus() {
    attempts += 1;
    const nodeElement = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${nodeId}"]`,
    );
    const field = nodeElement?.querySelector<HTMLInputElement>("[data-new-node-focus-field]");

    if (field) {
      focusField(field);
      return;
    }

    if (attempts < FIELD_FOCUS_RETRIES) {
      window.requestAnimationFrame(tryFocus);
    }
  }

  window.requestAnimationFrame(tryFocus);
}

function findConnectedOutputNodeId(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  generateNodeId: string,
): string | null {
  return findConnectedNodeIdsByType(nodes, edges, generateNodeId, "imageOutput")[0] ?? null;
}

function findConnectedNodeIdsByType(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  nodeId: string,
  type: NodeType,
): string[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const connectedIds = new Set<string>();

  for (const edge of edges) {
    const otherNodeId =
      edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null;

    if (otherNodeId && nodesById.get(otherNodeId)?.type === type) {
      connectedIds.add(otherNodeId);
    }
  }

  return [...connectedIds];
}

function outputStatus(value: unknown): ConnectedOutputState["status"] {
  return value === "idle" || value === "loading" || value === "error" || value === "done"
    ? value
    : "idle";
}

function imageMasksFromData(value: unknown): ImageMaskRegion[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ImageMaskRegion => {
    if (typeof item !== "object" || item === null) return false;
    const record = item as Record<string, unknown>;
    return (
      typeof record.id === "string" &&
      typeof record.name === "string" &&
      Array.isArray(record.strokes)
    );
  });
}

function imageMasksForImage(value: unknown, imageKey: string): ImageMaskRegion[] {
  return imageMasksFromData(value).filter((mask) => !mask.imageKey || mask.imageKey === imageKey);
}

function findConnectedOutputState(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  generateNodeId: string,
): ConnectedOutputState | null {
  const outputNodeId = findConnectedOutputNodeId(nodes, edges, generateNodeId);
  const outputNode = outputNodeId ? nodes.find((node) => node.id === outputNodeId) : undefined;
  if (!outputNode) return null;

  return {
    nodeId: outputNode.id,
    resultUrl: typeof outputNode.data.resultUrl === "string" ? outputNode.data.resultUrl : null,
    prompt: typeof outputNode.data.prompt === "string" ? outputNode.data.prompt : undefined,
    model: typeof outputNode.data.model === "string" ? outputNode.data.model : undefined,
    outputFormat: normalizeImageGenerationOutputFormat(outputNode.data.outputFormat),
    status: outputStatus(outputNode.data.status),
    error: typeof outputNode.data.error === "string" ? outputNode.data.error : undefined,
  };
}

function findConnectedInputReferences(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  nodeId: string,
): ConnectedInputReference[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const seen = new Set<string>();
  const references: ConnectedInputReference[] = [];

  for (const edge of edges) {
    const otherNodeId =
      edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null;
    if (!otherNodeId || seen.has(otherNodeId)) continue;

    const node = nodesById.get(otherNodeId);
    if (!node) continue;

    if (node.type === "imageInput") {
      const imageUrl = typeof node.data.imageUrl === "string" ? node.data.imageUrl : null;
      if (!imageUrl) continue;

      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : "image";

      seen.add(otherNodeId);
      references.push({
        edgeId: edge.id,
        nodeId: otherNodeId,
        kind: "image",
        alias,
        label: alias,
        imageUrl,
        masks: imageMasksForImage(
          node.data.imageMasks,
          typeof node.data.selectedGenericImageId === "string"
            ? node.data.selectedGenericImageId
            : imageUrl,
        ),
      });
      continue;
    }

    if (node.type === "suppler") {
      const imageUrl =
        typeof node.data.variantImageUrl === "string" ? node.data.variantImageUrl : null;
      if (!imageUrl) continue;

      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : "supplier";
      const label =
        typeof node.data.productSubject === "string" && node.data.productSubject.trim()
          ? node.data.productSubject.trim()
          : alias;

      seen.add(otherNodeId);
      references.push({
        edgeId: edge.id,
        nodeId: otherNodeId,
        kind: "image",
        alias,
        label,
        imageUrl,
        masks: imageMasksForImage(
          node.data.imageMasks,
          typeof node.data.productId === "string" && typeof node.data.variantId === "string"
            ? `${node.data.productId}:${node.data.variantId}`
            : imageUrl,
        ),
      });
      continue;
    }

    if (node.type === "product") {
      const imageUrl =
        typeof node.data.variantImageUrl === "string" ? node.data.variantImageUrl : null;
      if (!imageUrl) continue;

      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : "product";
      const label =
        typeof node.data.productSubject === "string" && node.data.productSubject.trim()
          ? node.data.productSubject.trim()
          : alias;

      seen.add(otherNodeId);
      references.push({
        edgeId: edge.id,
        nodeId: otherNodeId,
        kind: "image",
        alias,
        label,
        imageUrl,
        masks: imageMasksForImage(
          node.data.imageMasks,
          typeof node.data.productId === "string" && typeof node.data.variantId === "string"
            ? `${node.data.productId}:${node.data.variantId}`
            : imageUrl,
        ),
      });
      continue;
    }

    if (node.type === "pantone") {
      const swatchHex =
        typeof node.data.hex === "string" && node.data.hex.startsWith("#") ? node.data.hex : null;
      if (!swatchHex) continue;

      const name =
        typeof node.data.name === "string" && node.data.name.trim() ? node.data.name.trim() : null;
      const code =
        typeof node.data.code === "string" && node.data.code.trim() ? node.data.code.trim() : null;
      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : (name ?? code ?? "pantone");
      const label = name
        ? name
            .split("-")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ")
        : (code ?? "Pantone");

      seen.add(otherNodeId);
      references.push({
        edgeId: edge.id,
        nodeId: otherNodeId,
        kind: "pantone",
        alias,
        label,
        swatchHex,
      });
    }
  }

  return references;
}

/**
 * Image-bearing sources wired into a G2 node, split by the `data.g2Role`
 * recorded on each edge at drop time. Reuses the same per-node-type logic as
 * {@link findConnectedInputReferences} (imageInput / suppler / product /
 * pantone / image / imageOutput) — only pixels-in-a-node sources count; pure
 * note/group nodes are skipped.
 *
 * Role resolution:
 *  - an edge with `data.g2Role === "main"` → main image;
 *  - an edge with `data.g2Role === "reference"` → reference;
 *  - an edge with no role → reference, EXCEPT when exactly one un_ROLEd edge
 *    exists and no explicit "main" edge is present, that single edge is the
 *    main image (so a plain Input→G2 wire still seeds image A).
 */
function findG2ImageReferences(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  nodeId: string,
): G2ImageReferences {
  const nodesById = new Map(nodes.map((node) => [node.id, node] as const));
  const seen = new Set<string>();
  const mainRefs: ConnectedImageReference[] = [];
  const otherRefs: ConnectedInputReference[] = [];

  function classify(edge: CanvasEdge, ref: ConnectedInputReference): void {
    const role = (edge.data as { g2Role?: unknown } | undefined)?.g2Role;
    if (role === "main") {
      // Only an image can be the main (mask carrier). A Pantone dropped on the
      // "main" area can't carry a mask → route it to references instead.
      if (ref.kind === "image") {
        mainRefs.push(ref);
      } else {
        otherRefs.push(ref);
      }
    } else if (role === "reference") {
      otherRefs.push(ref);
    } else {
      otherRefs.push(ref);
    }
  }

  for (const edge of edges) {
    const otherNodeId =
      edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null;
    if (!otherNodeId || seen.has(otherNodeId)) continue;

    const node = nodesById.get(otherNodeId);
    if (!node) continue;

    const push = (ref: Omit<ConnectedImageReference, "edgeId" | "nodeId"> | Omit<ConnectedPantoneReference, "edgeId" | "nodeId">) => {
      seen.add(otherNodeId);
      classify(edge, { ...ref, edgeId: edge.id, nodeId: otherNodeId } as ConnectedInputReference);
    };

    if (node.type === "imageInput") {
      const imageUrl = typeof node.data.imageUrl === "string" ? node.data.imageUrl : null;
      if (!imageUrl) continue;
      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : "image";
      push({
        kind: "image",
        alias,
        label: alias,
        imageUrl,
        masks: imageMasksForImage(
          node.data.imageMasks,
          typeof node.data.selectedGenericImageId === "string"
            ? node.data.selectedGenericImageId
            : imageUrl,
        ),
      });
      continue;
    }

    if (node.type === "suppler") {
      const imageUrl =
        typeof node.data.variantImageUrl === "string" ? node.data.variantImageUrl : null;
      if (!imageUrl) continue;
      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : "supplier";
      const label =
        typeof node.data.productSubject === "string" && node.data.productSubject.trim()
          ? node.data.productSubject.trim()
          : alias;
      push({
        kind: "image",
        alias,
        label,
        imageUrl,
        masks: imageMasksForImage(
          node.data.imageMasks,
          typeof node.data.productId === "string" && typeof node.data.variantId === "string"
            ? `${node.data.productId}:${node.data.variantId}`
            : imageUrl,
        ),
      });
      continue;
    }

    if (node.type === "product") {
      const imageUrl =
        typeof node.data.variantImageUrl === "string" ? node.data.variantImageUrl : null;
      if (!imageUrl) continue;
      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : "product";
      const label =
        typeof node.data.productSubject === "string" && node.data.productSubject.trim()
          ? node.data.productSubject.trim()
          : alias;
      push({
        kind: "image",
        alias,
        label,
        imageUrl,
        masks: imageMasksForImage(
          node.data.imageMasks,
          typeof node.data.productId === "string" && typeof node.data.variantId === "string"
            ? `${node.data.productId}:${node.data.variantId}`
            : imageUrl,
        ),
      });
      continue;
    }

    if (node.type === "image" || node.type === "imageOutput") {
      const imageUrl =
        node.type === "image"
          ? (typeof node.data.url === "string" ? node.data.url : null)
          : (typeof node.data.resultUrl === "string" ? node.data.resultUrl : null);
      if (!imageUrl) continue;
      const alt =
        node.type === "image"
          ? (typeof node.data.alt === "string" ? node.data.alt : null)
          : (typeof node.data.prompt === "string" ? node.data.prompt : null);
      const alias =
        alt && alt.trim() ? alt.trim() : node.type === "image" ? "image" : "output";
      push({ kind: "image", alias, label: alias, imageUrl, masks: [] });
      continue;
    }

    if (node.type === "pantone") {
      // Pantone is a color-only source — no image URL, no mask. Surface it as
      // a pantone reference so the G2 node renders the same solid-color swatch
      // chip the Generate node does (see generate-node.tsx). Identical guard to
      // findConnectedInputReferences: no hex chosen yet → skip, so nothing
      // renders until a real color is picked, matching the Generate behavior.
      const swatchHex =
        typeof node.data.hex === "string" && node.data.hex.startsWith("#") ? node.data.hex : null;
      if (!swatchHex) continue;

      const name =
        typeof node.data.name === "string" && node.data.name.trim() ? node.data.name.trim() : null;
      const code =
        typeof node.data.code === "string" && node.data.code.trim() ? node.data.code.trim() : null;
      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : (name ?? code ?? "pantone");
      const label = name
        ? name
            .split("-")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ")
        : (code ?? "Pantone");
      push({ kind: "pantone", alias, label, swatchHex });
      continue;
    }

    if (node.type === "painted") {
      const imageUrl =
        typeof node.data.mainImageUrl === "string" && node.data.mainImageUrl
          ? node.data.mainImageUrl
          : null;
      if (!imageUrl) continue;
      const alias =
        typeof node.data.alias === "string" && node.data.alias.trim()
          ? node.data.alias.trim()
          : "painted";
      const label = alias;
      push({ kind: "image", alias, label, imageUrl, masks: [] });
      continue;
    }
  }

  // No explicit main edge and exactly one un_ROLEd reference → promote it to
  // main — but ONLY if that reference is an image (Pantone can't be the mask
  // carrier). A lone Pantone stays a reference; the user must still add an
  // image to be the main.
  let references = otherRefs;
  if (mainRefs.length === 0 && otherRefs.length === 1 && otherRefs[0]!.kind === "image") {
    mainRefs.push(otherRefs[0]!);
    references = [];
  }

  return { main: mainRefs[0] ?? null, references };
}

function normalizeNodeType(node: CanvasNode): CanvasNode {
  const normalizedType = (node.type as string) === "output" ? "imageOutput" : node.type;
  const data =
    (normalizedType === "generate" || normalizedType === "imageOutput") &&
    node.data.status === "loading"
      ? { ...node.data, status: "idle", error: undefined }
      : node.data;
  if (normalizedType !== "generate") {
    return normalizedType === node.type && data === node.data
      ? node
      : { ...node, type: normalizedType, data };
  }
  const model = normalizeImageGenerationModel(data.model);

  return {
    ...node,
    type: normalizedType,
    data: {
      ...data,
      model,
      size: normalizeImageGenerationSize(data.size),
      outputFormat: normalizeImageGenerationOutputFormat(data.outputFormat),
      resolution: normalizeImageGenerationResolution(
        data.resolution ?? resolutionForImageGenerationModel(model),
      ),
    },
  };
}

function Editor({
  projectId,
  canvasId,
  embedded = false,
  onBack,
}: {
  projectId: string;
  canvasId: string;
  embedded?: boolean;
  onBack?: () => void;
}) {
  const { data: canvas, isLoading } = useCanvas(canvasId);
  const { data: project } = useProject(projectId);
  const genericNodeDefinitionsQuery = useGenericNodeDefinitions();
  const genericNodeDefinitions = useMemo(
    () => sortGenericNodeDefinitions(genericNodeDefinitionsQuery.data ?? []),
    [genericNodeDefinitionsQuery.data],
  );
  const genericNodeDefinitionsById = useMemo(
    () => new Map(genericNodeDefinitions.map((definition) => [definition.id, definition] as const)),
    [genericNodeDefinitions],
  );
  const [nodes, setNodes] = useNodesState<CanvasNode>([]);
  const [edges, setEdges] = useEdgesState<CanvasEdge>([]);
  const nodesRef = useRef<CanvasNode[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const generationRunManagerRef = useRef(createGenerationRunManager());
  const loadedRef = useRef(false);
  const skipAutosaveAfterLoadRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isConnectingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logPanelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [logPanelContent, setLogPanelContent] = useState<CanvasContent>({
    nodes: [],
    edges: [],
  });
  const { screenToFlowPosition, getNodes, getInternalNode } = useReactFlow<
    CanvasNode,
    CanvasEdge
  >();
  const queryClient = useQueryClient();
  const [saveOpen, setSaveOpen] = useState(false);
  const [canvasName, setCanvasName] = useState("");
  const [saving, setSaving] = useState(false);
  const [connectedNotice, setConnectedNotice] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [pendingGroupNodeIds, setPendingGroupNodeIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [pendingGroupMembershipChange, setPendingGroupMembershipChange] =
    useState<PendingGroupMembershipChange | null>(null);
  const connectedNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasActiveGeneration = nodes.some(
    (node) =>
      (node.type === "generate" || node.type === "imageOutput") && node.data.status === "loading",
  );

  useEffect(() => {
    if (!hasActiveGeneration) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ACTIVE_GENERATION_LEAVE_MESSAGE;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasActiveGeneration]);

  const confirmLeavingActiveGeneration = useCallback(() => {
    if (!hasActiveGeneration) return true;
    return window.confirm(ACTIVE_GENERATION_LEAVE_MESSAGE);
  }, [hasActiveGeneration]);

  const handleCanvasNavigationClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!hasActiveGeneration || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      if (confirmLeavingActiveGeneration()) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [confirmLeavingActiveGeneration, hasActiveGeneration],
  );

  // Live connection drag: which node the wire started from (source highlight)
  // and which node + dot the pointer is currently hovering over (target highlight).
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [connectionTargetId, setConnectionTargetId] = useState<string | null>(null);
  const [connectionTargetDot, setConnectionTargetDot] = useState<"left" | "right" | null>(null);
  const [connectionTargetG2Drop, setConnectionTargetG2Drop] = useState<"main" | "reference" | null>(null);
  const [hoverTarget, setHoverTarget] = useState<HoverTarget>(null);
  const [hoveredReferenceNodeId, setHoveredReferenceNodeId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  // ComfyUI style: the in-progress wire and both highlight rings share the
  // source node's type color.
  const connectionColor = connectionSourceId
    ? colorForNodeType(nodes.find((n) => n.id === connectionSourceId)?.type)
    : DEFAULT_EDGE_COLOR;

  const setCanvasNodes = useCallback(
    (action: SetStateAction<CanvasNode[]>) => {
      const nextNodes =
        typeof action === "function"
          ? (action as (previous: CanvasNode[]) => CanvasNode[])(nodesRef.current)
          : action;
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
    },
    [setNodes],
  );

  const setCanvasEdges = useCallback(
    (action: SetStateAction<CanvasEdge[]>) => {
      const nextEdges =
        typeof action === "function"
          ? (action as (previous: CanvasEdge[]) => CanvasEdge[])(edgesRef.current)
          : action;
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
    },
    [setEdges],
  );

  const getCurrentCanvasContent = useCallback(
    (): CanvasContent => ({
      nodes: nodesRef.current,
      edges: edgesRef.current,
    }),
    [],
  );

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(
    () => () => {
      generationRunManagerRef.current.cancelAll();
    },
    [],
  );

  // Load the canvas content once it arrives.
  useEffect(() => {
    if (canvas && !loadedRef.current) {
      loadedRef.current = true;
      skipAutosaveAfterLoadRef.current = true;
      const nextNodes = reorderChildrenAfterParents(canvas.content.nodes.map(normalizeNodeType));
      // Force the custom (deletable) edge type so the remove button renders.
      // Older edges were saved before dots had explicit ids — backfill
      // sourceHandle/targetHandle (right=source, left=target under the old
      // model) so they keep attaching instead of going limp.
      const nextEdges = canvas.content.edges.map((e) => ({
        ...e,
        type: "deletable" as const,
        sourceHandle: e.sourceHandle ?? "right",
        targetHandle: e.targetHandle ?? "left",
        style: { ...e.style, stroke: DEFAULT_EDGE_COLOR, strokeWidth: EDGE_WIDTH },
      }));
      setCanvasNodes(nextNodes);
      setCanvasEdges(nextEdges);
      setLogPanelContent({ nodes: nextNodes, edges: nextEdges });
    }
  }, [canvas, setCanvasNodes, setCanvasEdges]);

  // Bumped only when node *data* changes (not position). Keeps CanvasActions
  // stable during drag frames while still refreshing connection consumers when
  // pantone/image/prompt payloads change.
  const [graphEpoch, setGraphEpoch] = useState(0);

  const updateNodeData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      setCanvasNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
      );
      setGraphEpoch((epoch) => epoch + 1);
    },
    [setCanvasNodes],
  );

  // Live topology/data is read from refs. Depend on edges + graphEpoch so
  // connect/disconnect and data edits refresh consumers, while pure position
  // drags leave the actions object stable (no context re-render storm).
  const getConnectedInputReferences = useCallback(
    (nodeId: string) =>
      findConnectedInputReferences(nodesRef.current, edgesRef.current, nodeId),
    [edges, graphEpoch],
  );

  const getG2ImageReferences = useCallback(
    (nodeId: string) =>
      findG2ImageReferences(nodesRef.current, edgesRef.current, nodeId),
    [edges, graphEpoch],
  );

  const hasConnectedOutputNode = useCallback(
    (generateNodeId: string) =>
      findConnectedOutputNodeId(nodesRef.current, edgesRef.current, generateNodeId) !== null,
    [edges, graphEpoch],
  );

  const getConnectedOutputState = useCallback(
    (generateNodeId: string) =>
      findConnectedOutputState(nodesRef.current, edgesRef.current, generateNodeId),
    [edges, graphEpoch],
  );

  const scheduleAutosave = useCallback(() => {
    if (!loadedRef.current || skipAutosaveAfterLoadRef.current) return;
    if (isDraggingRef.current || isConnectingRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (isDraggingRef.current || isConnectingRef.current) return;
      const content = getCurrentCanvasContent();
      void getCanvasStore()
        .saveCanvasContent(canvasId, content)
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Failed to autosave canvas");
        });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [canvasId, getCurrentCanvasContent]);

  function openSaveDialog() {
    setCanvasName(canvas?.name ?? "");
    setSaveOpen(true);
  }

  async function saveCanvas(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = canvasName.trim();
    if (!name) {
      toast.error("Enter a canvas name");
      return;
    }

    setSaving(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const content = getCurrentCanvasContent();
      await getCanvasStore().renameCanvas(canvasId, name);
      await getCanvasStore().saveCanvasContent(canvasId, content);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["canvas", canvasId] }),
        queryClient.invalidateQueries({ queryKey: ["canvases", projectId] }),
      ]);
      setSaveOpen(false);
      toast.success("Canvas saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save canvas");
    } finally {
      setSaving(false);
    }
  }

  // Debounced autosave whenever nodes/edges change (after the initial load).
  // Skip while dragging/connecting so position updates don't thrash IndexedDB + localStorage.
  useEffect(() => {
    if (!loadedRef.current) return;
    if (skipAutosaveAfterLoadRef.current) {
      skipAutosaveAfterLoadRef.current = false;
      return;
    }
    scheduleAutosave();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, scheduleAutosave]);

  // Keep the side log panel off the hot path: it only needs a slightly lagged snapshot.
  useEffect(() => {
    if (!loadedRef.current) return;
    if (logPanelTimer.current) clearTimeout(logPanelTimer.current);
    logPanelTimer.current = setTimeout(() => {
      setLogPanelContent(getCurrentCanvasContent());
    }, 250);
    return () => {
      if (logPanelTimer.current) clearTimeout(logPanelTimer.current);
    };
  }, [nodes, edges, getCurrentCanvasContent]);

  useEffect(
    () => () => {
      if (logPanelTimer.current) clearTimeout(logPanelTimer.current);
    },
    [],
  );

  const addCanvasConnection = useCallback(
    (connection: Connection, edgeData?: Record<string, unknown>) => {
      const source = nodesRef.current.find((node) => node.id === connection.source);
      if (source?.type === "group") {
        const childIds = nodesRef.current
          .filter((node) => node.parentId === source.id && node.id !== connection.target)
          .map((node) => node.id);
        if (childIds.includes(connection.target)) {
          toast.error("A group cannot batch-connect to one of its own nodes.");
          return;
        }
        let created = 0;
        setCanvasEdges((current) => {
          let next = current;
          for (const childId of childIds) {
            const duplicate = next.some(
              (edge) => edge.source === childId && edge.target === connection.target,
            );
            if (duplicate) continue;
            next = addEdge(
              {
                ...connection,
                source: childId,
                sourceHandle: "right",
                targetHandle: "left",
                type: "deletable",
                style: { stroke: DEFAULT_EDGE_COLOR, strokeWidth: EDGE_WIDTH },
              },
              next,
            );
            created += 1;
          }
          return next;
        });
        toast.success(`${created} connection${created === 1 ? "" : "s"} created`);
        return;
      }
      setCanvasEdges((eds) =>
        addEdge(
          {
            ...connection,
            targetHandle: "left",
            type: "deletable",
            style: { stroke: DEFAULT_EDGE_COLOR, strokeWidth: EDGE_WIDTH },
            data: edgeData,
          },
          eds,
        ),
      );
      if (connectedNoticeTimer.current) clearTimeout(connectedNoticeTimer.current);
      setConnectedNotice(true);
      connectedNoticeTimer.current = setTimeout(() => setConnectedNotice(false), 3000);
    },
    [setCanvasEdges],
  );

  const onConnect = addCanvasConnection;

  // G2: create a role-tagged edge from an arbitrary source node into this G2
  // node, used by the G2 node's HTML5 drag-fallback (the Link2 handle on
  // image/output nodes) when the user drops onto the main/reference area. The
  // primary path is dragging the source node's React Flow edge dot, which is
  // wired directly via onConnectEnd above.
  const addG2ImageReference = useCallback(
    (g2NodeId: string, sourceNodeId: string, role: "main" | "reference") => {
      const source = nodesRef.current.find((node) => node.id === sourceNodeId);
      if (!source || sourceNodeId === g2NodeId) return false;
      // Accept any image-bearing node OR a Pantone (color-only) node. A
      // Pantone dropped on "main" is silently rerouted to "reference" by
      // findG2ImageReferences (it can't carry a mask), so allow the edge here
      // and let the role resolver sort it out.
      const imageType = ["image", "imageOutput", "imageInput", "suppler", "product", "pantone", "painted"].includes(
        source.type ?? "",
      );
      if (!imageType) return false;
      const exists = edgesRef.current.some(
        (edge) => edge.source === sourceNodeId && edge.target === g2NodeId,
      );
      if (exists) return false;
      addCanvasConnection(
        {
          source: sourceNodeId,
          sourceHandle: null,
          target: g2NodeId,
          targetHandle: "left",
        },
        { g2Role: role },
      );
      return true;
    },
    [addCanvasConnection],
  );

  const handleSelectionEnd = useCallback(() => {
    const selectedIds = nodesRef.current
      .filter((node) => node.selected && !node.parentId && node.type !== "group")
      .map((node) => node.id);
    if (selectedIds.length < 2) return;
    setPendingGroupNodeIds(selectedIds);
    setGroupName("");
    setGroupDialogOpen(true);
  }, []);

  const createSelectionGroup = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const label = groupName.trim();
      if (!label) return;
      const selected = pendingGroupNodeIds
        .map((id) => ({
          node: nodesRef.current.find((node) => node.id === id),
          rect: rectOf(getInternalNode(id)),
        }))
        .filter(
          (entry): entry is { node: CanvasNode; rect: NonNullable<ReturnType<typeof rectOf>> } =>
            Boolean(
              entry.node && entry.rect && !entry.node.parentId && entry.node.type !== "group",
            ),
        );
      if (selected.length < 2) {
        setGroupDialogOpen(false);
        return;
      }
      const padding = GROUP_FIT_PADDING;
      const left = Math.min(...selected.map(({ rect }) => rect.x)) - padding;
      const top = Math.min(...selected.map(({ rect }) => rect.y)) - padding;
      const right = Math.max(...selected.map(({ rect }) => rect.x + rect.w)) + padding;
      const bottom = Math.max(...selected.map(({ rect }) => rect.y + rect.h)) + padding;
      const group = createNode("group", { x: (left + right) / 2, y: (top + bottom) / 2 });
      group.data = { ...group.data, label, width: right - left, height: bottom - top };
      const selectedRects = new Map(selected.map(({ node, rect }) => [node.id, rect] as const));
      setCanvasNodes((current) =>
        reorderChildrenAfterParents([
          ...current.map((node) => {
            const rect = selectedRects.get(node.id);
            if (!rect) return { ...node, selected: false };
            return {
              ...node,
              parentId: group.id,
              position: { x: rect.cx - left, y: rect.cy - top },
              selected: false,
            };
          }),
          { ...group, selected: true },
        ]),
      );
      setGroupDialogOpen(false);
      setPendingGroupNodeIds([]);
      toast.success(`Grouped ${selected.length} nodes`);
    },
    [getInternalNode, groupName, pendingGroupNodeIds, setCanvasNodes],
  );

  const onConnectStart = useCallback(
    (_event: MouseEvent | TouchEvent, { nodeId }: OnConnectStartParams) => {
      // Light up the node the wire is coming from (both its dots); clear stale target.
      isConnectingRef.current = true;
      setConnectionSourceId(nodeId);
      setConnectionTargetId(null);
      setConnectionTargetDot(null);
    },
    [],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      // React Flow completes exact handle drops before this callback. When the
      // pointer is instead released over a highlighted node body, connect to
      // that node's left/input port so the saved edge remains fully anchored.
      if (
        connectionState.fromHandle &&
        !connectionState.toHandle &&
        connectionState.isValid !== false
      ) {
        const point = getClientPoint(event);
        const target = point
          ? findNodeConnectionTarget(point, connectionState.fromHandle.nodeId)
          : null;

        if (target) {
          addCanvasConnection(
            {
              source: connectionState.fromHandle.nodeId,
              sourceHandle: connectionState.fromHandle.id ?? null,
              target: target.nodeId,
              targetHandle: "left",
            },
            target.g2Role ? { g2Role: target.g2Role } : undefined,
          );
        }
      }

      isConnectingRef.current = false;
      scheduleAutosave();
      setConnectionSourceId(null);
      setConnectionTargetId(null);
      setConnectionTargetDot(null);
      setConnectionTargetG2Drop(null);
    },
    [addCanvasConnection, scheduleAutosave],
  );

  useEffect(
    () => () => {
      if (connectedNoticeTimer.current) clearTimeout(connectedNoticeTimer.current);
    },
    [],
  );

  const fitGroupToChildren = useCallback(
    (
      groupId: string,
      nodesToFit: CanvasNode[],
      centersByNodeId = new Map<string, XYPosition>(),
    ): CanvasNode[] => {
      const group = nodesToFit.find((node) => node.id === groupId);
      if (!group) return nodesToFit;
      const children = nodesToFit.filter((node) => node.parentId === groupId);
      if (children.length === 0) return nodesToFit;

      const nodesById = new Map(nodesToFit.map((node) => [node.id, node] as const));
      const groupRect = rectOf(getInternalNode(groupId)) ?? getGroupRectFromNode(group);
      const padding = GROUP_FIT_PADDING;
      const childRects = children
        .map((child) => {
          const measured = rectOf(getInternalNode(child.id));
          const center = centersByNodeId.get(child.id);
          if (measured) return { id: child.id, ...measured };
          const fallbackRect = getFallbackNodeRect(
            child,
            nodesById,
            { width: 220, height: 160 },
            groupRect,
          );
          const cx = center?.x ?? fallbackRect.cx;
          const cy = center?.y ?? fallbackRect.cy;
          return {
            id: child.id,
            x: cx - fallbackRect.w / 2,
            y: cy - fallbackRect.h / 2,
            w: fallbackRect.w,
            h: fallbackRect.h,
            cx,
            cy,
          };
        })
        .filter((rect) => rect.w > 0 && rect.h > 0);
      if (childRects.length === 0) return nodesToFit;

      const left = Math.min(...childRects.map((rect) => rect.x)) - padding;
      const top = Math.min(...childRects.map((rect) => rect.y)) - padding;
      const right = Math.max(...childRects.map((rect) => rect.x + rect.w)) + padding;
      const bottom = Math.max(...childRects.map((rect) => rect.y + rect.h)) + padding;
      const nextWidth = right - left;
      const nextHeight = bottom - top;

      return reorderChildrenAfterParents(
        nodesToFit.map((node) => {
          if (node.id === groupId) {
            return {
              ...node,
              position: { x: left + nextWidth / 2, y: top + nextHeight / 2 },
              data: { ...node.data, width: nextWidth, height: nextHeight },
            };
          }
          if (node.parentId !== groupId) return node;
          const rect = childRects.find((candidate) => candidate.id === node.id);
          const measured = rectOf(getInternalNode(node.id));
          const center = centersByNodeId.get(node.id);
          const cx = center?.x ?? rect?.cx ?? measured?.cx ?? groupRect.x + node.position.x;
          const cy = center?.y ?? rect?.cy ?? measured?.cy ?? groupRect.y + node.position.y;
          return { ...node, position: { x: cx - left, y: cy - top } };
        }),
      );
    },
    [getInternalNode],
  );

  const detachNodeFromGroup = useCallback(
    (nodeId: string, centerOverride?: XYPosition) => {
      let sourceGroupId: string | null = null;
      setCanvasNodes((current) => {
        const node = current.find((candidate) => candidate.id === nodeId);
        if (!node?.parentId) return current;
        sourceGroupId = node.parentId;
        const measured = rectOf(getInternalNode(nodeId));
        const center =
          centerOverride ?? (measured ? { x: measured.cx, y: measured.cy } : node.position);
        const detachedNodes = current.map((candidate) => {
          if (candidate.id !== nodeId) return candidate;
          const detached = { ...candidate, position: center };
          delete detached.parentId;
          return detached;
        });
        return fitGroupToChildren(sourceGroupId, detachedNodes);
      });
      if (sourceGroupId) toast.success("Node removed from group");
    },
    [fitGroupToChildren, getInternalNode, setCanvasNodes],
  );

  const addNodeToGroup = useCallback(
    (nodeId: string, groupId: string, center: XYPosition) => {
      setCanvasNodes((current) => {
        const group = current.find((candidate) => candidate.id === groupId);
        if (!group) return current;
        const nodesById = new Map(current.map((node) => [node.id, node] as const));
        const groupRect = rectOf(getInternalNode(groupId)) ?? getGroupRectFromNode(group);
        const occupiedRects = current
          .filter((node) => node.parentId === groupId && node.id !== nodeId)
          .map(
            (node) =>
              rectOf(getInternalNode(node.id)) ??
              getFallbackNodeRect(node, nodesById, { width: 240, height: 240 }, groupRect),
          );
        const nextCenter = findFreePositionInRect(center, groupRect, occupiedRects);
        const nextNodes = current.map((node) => {
          if (node.id !== nodeId) return node;
          return {
            ...node,
            parentId: groupId,
            position: { x: nextCenter.x - groupRect.x, y: nextCenter.y - groupRect.y },
          };
        });
        return fitGroupToChildren(groupId, nextNodes, new Map([[nodeId, nextCenter]]));
      });
      toast.success("Node added to group");
    },
    [fitGroupToChildren, getInternalNode, setCanvasNodes],
  );

  const keepNodeInGroupAndFit = useCallback(
    (nodeId: string, groupId: string, center: XYPosition) => {
      setCanvasNodes((current) =>
        fitGroupToChildren(
          groupId,
          current.map((node) =>
            node.id === nodeId
              ? {
                  ...node,
                  parentId: groupId,
                  position: node.position,
                }
              : node,
          ),
          new Map([[nodeId, center]]),
        ),
      );
    },
    [fitGroupToChildren, setCanvasNodes],
  );

  function confirmPendingGroupMembershipChange() {
    if (!pendingGroupMembershipChange) return;
    if (pendingGroupMembershipChange.kind === "add") {
      addNodeToGroup(
        pendingGroupMembershipChange.nodeId,
        pendingGroupMembershipChange.groupId,
        pendingGroupMembershipChange.center,
      );
    } else {
      detachNodeFromGroup(pendingGroupMembershipChange.nodeId, pendingGroupMembershipChange.center);
    }
    setPendingGroupMembershipChange(null);
  }

  function cancelPendingGroupMembershipChange() {
    if (pendingGroupMembershipChange?.kind === "leave") {
      keepNodeInGroupAndFit(
        pendingGroupMembershipChange.nodeId,
        pendingGroupMembershipChange.groupId,
        pendingGroupMembershipChange.center,
      );
    }
    setPendingGroupMembershipChange(null);
  }

  const onNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  // Group membership changes are explicit: dropping into or out of a group
  // opens a confirmation dialog, then geometry is fitted around the result.
  // Also end the drag guard and schedule one deferred autosave for the final positions.
  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, _node: CanvasNode, draggedNodes: CanvasNode[]) => {
      isDraggingRef.current = false;
      scheduleAutosave();

      if (pendingGroupMembershipChange) return;
      const allNodes = getNodes();
      const groups = new Map<string, { x: number; y: number; w: number; h: number }>();
      for (const n of allNodes) {
        if (n.type !== "group") continue;
        const r = rectOf(getInternalNode(n.id));
        if (r) groups.set(n.id, r);
        else groups.set(n.id, getGroupRectFromNode(n));
      }
      if (groups.size === 0) return;

      const draggedIds = new Set(draggedNodes.map((n) => n.id));
      for (const n of allNodes) {
        if (!draggedIds.has(n.id) || n.type === "group") continue;
        const r = rectOf(getInternalNode(n.id));
        if (!r) continue;
        let target: string | null = null;
        for (const [gid, g] of groups) {
          const isCurrentGroup = n.parentId === gid;
          const isInsideForNewGroup =
            r.cx >= g.x && r.cx <= g.x + g.w && r.cy >= g.y && r.cy <= g.y + g.h;
          const isStillOverCurrentGroup = isCurrentGroup && rectsOverlap(r, g);
          if (isInsideForNewGroup || isStillOverCurrentGroup) {
            target = gid;
            break;
          }
        }
        const current = n.parentId ?? null;
        if (target === current) continue;

        if (current && target !== current) {
          setPendingGroupMembershipChange({
            kind: "leave",
            nodeId: n.id,
            groupId: current,
            center: { x: r.cx, y: r.cy },
          });
          return;
        }

        if (!current && target) {
          setPendingGroupMembershipChange({
            kind: "add",
            nodeId: n.id,
            groupId: target,
            center: { x: r.cx, y: r.cy },
          });
          return;
        }
      }
    },
    [getInternalNode, getNodes, pendingGroupMembershipChange, scheduleAutosave],
  );

  // Release children to the canvas when their group is removed via React Flow's
  // own deletion path (e.g. the Delete/Backspace key) — otherwise their
  // parentId would dangle and they'd jump or vanish. Only intercepts "remove"
  // changes; everything else passes through untouched.
  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const removeIds = changes.filter((c) => c.type === "remove").map((c) => c.id);
      if (removeIds.length > 0) {
        const releases = new Map<string, XYPosition>();
        for (const n of getNodes()) {
          if (n.parentId && removeIds.includes(n.parentId)) {
            const r = rectOf(getInternalNode(n.id));
            if (r) releases.set(n.id, { x: r.cx, y: r.cy });
          }
        }
        if (releases.size > 0) {
          setCanvasNodes((nds) =>
            nds.map((n) => {
              if (!releases.has(n.id)) return n;
              const detached = { ...n };
              delete detached.parentId;
              return { ...detached, position: releases.get(n.id)! };
            }),
          );
        }
      }
      setCanvasNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
    },
    [getNodes, getInternalNode, setCanvasNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      setCanvasEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
    },
    [setCanvasEdges],
  );

  // While dragging a wire, highlight whichever node the pointer is over and its
  // left/input port, which receives node-body drops. Hit-testing the DOM keeps
  // this aligned with the visible node geometry regardless of zoom and pan.
  useEffect(() => {
    if (!connectionSourceId) return;
    const handlePointerMove = (event: PointerEvent) => {
      const target = findNodeConnectionTarget(
        { x: event.clientX, y: event.clientY },
        connectionSourceId,
      );
      const targetId = target?.nodeId ?? null;
      const dot = target ? "left" : null;
      const g2Drop = target?.g2Role ?? null;
      setConnectionTargetId((prev) => (prev === targetId ? prev : targetId));
      setConnectionTargetDot((prev) => (prev === dot ? prev : dot));
      setConnectionTargetG2Drop((prev) => (prev === g2Drop ? prev : g2Drop));
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [connectionSourceId]);

  const connectionHighlight = useMemo(
    () => ({
      sourceId: connectionSourceId,
      targetId: connectionTargetId,
      targetDot: connectionTargetDot,
      targetG2Drop: connectionTargetG2Drop,
      color: connectionColor,
    }),
    [connectionSourceId, connectionTargetId, connectionTargetDot, connectionTargetG2Drop, connectionColor],
  );

  const referenceHover = useMemo(
    () => ({
      hoveredReferenceNodeId,
      setHoveredReferenceNodeId,
    }),
    [hoveredReferenceNodeId],
  );

  const updateConnectedOutputData = useCallback(
    (generateNodeId: string, patch: Record<string, unknown>) => {
      const outputNodeId = findConnectedOutputNodeId(
        nodesRef.current,
        edgesRef.current,
        generateNodeId,
      );
      if (!outputNodeId) return false;

      setCanvasNodes((nds) =>
        nds.map((node) =>
          node.id === outputNodeId ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      );
      setGraphEpoch((epoch) => epoch + 1);

      return true;
    },
    [setCanvasNodes],
  );

  const startGenerationRun = useCallback(
    (generateNodeId: string) => generationRunManagerRef.current.start(generateNodeId),
    [],
  );

  const isGenerationRunCurrent = useCallback(
    (generateNodeId: string, runId: string) =>
      generationRunManagerRef.current.isCurrent(generateNodeId, runId),
    [],
  );

  const finishGenerationRun = useCallback((generateNodeId: string, runId: string) => {
    generationRunManagerRef.current.finish(generateNodeId, runId);
  }, []);

  const cancelGenerationRun = useCallback(
    (nodeId: string) => {
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const targetNode = currentNodes.find((node) => node.id === nodeId);
      if (
        !targetNode ||
        (targetNode.type !== "generate" &&
          targetNode.type !== "imageOutput" &&
          targetNode.type !== "painted")
      ) {
        return false;
      }

      const generateNodeIds = new Set<string>();
      const outputNodeIds = new Set<string>();
      if (targetNode.type === "generate" || targetNode.type === "painted") {
        generateNodeIds.add(targetNode.id);
      } else {
        outputNodeIds.add(targetNode.id);
        // An imageOutput may be fed by a `generate` OR a `painted` node — both
        // own generation runs. A painted node acts as a run owner just like a
        // generate node (see cancelGenerationRun above).
        for (const runOwnerId of findConnectedNodeIdsByType(
          currentNodes,
          currentEdges,
          targetNode.id,
          "generate",
        )) {
          const runOwnerNode = currentNodes.find((node) => node.id === runOwnerId);
          if (
            generationRunManagerRef.current.has(runOwnerId) ||
            runOwnerNode?.data.status === "loading"
          ) {
            generateNodeIds.add(runOwnerId);
          }
        }
        for (const runOwnerId of findConnectedNodeIdsByType(
          currentNodes,
          currentEdges,
          targetNode.id,
          "painted",
        )) {
          const runOwnerNode = currentNodes.find((node) => node.id === runOwnerId);
          if (
            generationRunManagerRef.current.has(runOwnerId) ||
            runOwnerNode?.data.status === "loading"
          ) {
            generateNodeIds.add(runOwnerId);
          }
        }
      }

      for (const generateNodeId of generateNodeIds) {
        for (const outputNodeId of findConnectedNodeIdsByType(
          currentNodes,
          currentEdges,
          generateNodeId,
          "imageOutput",
        )) {
          outputNodeIds.add(outputNodeId);
        }
      }

      const affectedNodeIds = new Set([...generateNodeIds, ...outputNodeIds]);
      const hadLoadingState = currentNodes.some(
        (node) => affectedNodeIds.has(node.id) && node.data.status === "loading",
      );
      let abortedRequest = false;
      for (const generateNodeId of generateNodeIds) {
        abortedRequest = generationRunManagerRef.current.cancel(generateNodeId) || abortedRequest;
      }

      if (!abortedRequest && !hadLoadingState) return false;
      setCanvasNodes((canvasNodes) =>
        canvasNodes.map((node) =>
          affectedNodeIds.has(node.id)
            ? { ...node, data: { ...node.data, status: "idle", error: undefined } }
            : node,
        ),
      );
      setGraphEpoch((epoch) => epoch + 1);
      return true;
    },
    [setCanvasNodes],
  );

  const writeGeneratedImageToOutput = useCallback(
    (
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
    ) => {
      const updated = updateConnectedOutputData(generateNodeId, {
        resultUrl: url,
        prompt: meta.prompt,
        model: meta.model,
        outputFormat: meta.outputFormat,
        generationDurationMs: meta.durationMs,
        status: "done",
        error: undefined,
      });

      if (!updated) return false;

      void getCanvasStore()
        .recordImage({
          canvasId,
          source: "generated",
          url,
          storagePath: meta.storagePath,
          prompt: meta.prompt,
          model: meta.model,
          modelDetails: {
            model: meta.model,
            size: meta.size,
            resolution: meta.resolution,
            outputFormat: meta.outputFormat,
            durationMs: meta.durationMs ?? null,
          },
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Failed to record generated image");
        });

      return true;
    },
    [canvasId, updateConnectedOutputData],
  );

  const deleteNode = useCallback(
    (id: string) => {
      cancelGenerationRun(id);
      // If a group is being removed, release its children back to the canvas at
      // their current absolute centers (otherwise their parentId dangles).
      const centerById = new Map<string, XYPosition>();
      for (const n of getNodes()) {
        if (n.id === id || n.parentId === id) {
          const r = rectOf(getInternalNode(n.id));
          if (r) centerById.set(n.id, { x: r.cx, y: r.cy });
        }
      }
      setCanvasNodes((nds) =>
        nds
          .filter((n) => n.id !== id)
          .map((n) => {
            if (n.parentId !== id) return n;
            const center = centerById.get(n.id);
            const detached = { ...n };
            delete detached.parentId;
            return { ...detached, position: center ?? n.position };
          }),
      );
      // Drop any wires that were attached to the removed node.
      setCanvasEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    },
    [cancelGenerationRun, getNodes, getInternalNode, setCanvasNodes, setCanvasEdges],
  );

  const ungroupNode = useCallback(
    (id: string) => {
      const centers = new Map<string, XYPosition>();
      for (const node of getNodes()) {
        if (node.parentId !== id) continue;
        const rect = rectOf(getInternalNode(node.id));
        if (rect) centers.set(node.id, { x: rect.cx, y: rect.cy });
      }
      setCanvasNodes((current) =>
        current
          .filter((node) => node.id !== id)
          .map((node) => {
            if (node.parentId !== id) return node;
            const detached = { ...node, position: centers.get(node.id) ?? node.position };
            delete detached.parentId;
            return detached;
          }),
      );
      setCanvasEdges((current) =>
        current.filter((edge) => edge.source !== id && edge.target !== id),
      );
      toast.success("Group disassembled");
    },
    [getInternalNode, getNodes, setCanvasEdges, setCanvasNodes],
  );

  const disconnectGroupNode = useCallback(
    (id: string) => {
      const childIds = new Set(
        getNodes()
          .filter((node) => node.parentId === id)
          .map((node) => node.id),
      );
      if (childIds.size === 0) {
        toast.info("This group has no child nodes to disconnect.");
        return;
      }

      let removed = 0;
      setCanvasEdges((current) =>
        current.filter((edge) => {
          const isLegacyGroupEdge = edge.source === id || edge.target === id;
          const isOutgoingChildEdge = childIds.has(edge.source) && !childIds.has(edge.target);
          const shouldRemove = isLegacyGroupEdge || isOutgoingChildEdge;
          if (shouldRemove) removed += 1;
          return !shouldRemove;
        }),
      );

      if (removed > 0) {
        toast.success(`${removed} connection${removed === 1 ? "" : "s"} disconnected`);
      } else {
        toast.info("No external group connections to disconnect.");
      }
    },
    [getNodes, setCanvasEdges],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setCanvasEdges((eds) => eds.filter((e) => e.id !== id));
    },
    [setCanvasEdges],
  );

  const getNodeConnectionCount = useCallback((id: string) => {
    const connected = new Set<string>();
    for (const edge of edgesRef.current) {
      if (edge.source === id) connected.add(edge.target);
      if (edge.target === id) connected.add(edge.source);
    }
    return connected.size;
  }, []);

  const deleteAll = useCallback(() => {
    setCanvasNodes([]);
    setCanvasEdges([]);
    toast.success("Canvas cleared");
  }, [setCanvasNodes, setCanvasEdges]);

  const [refreshing, setRefreshing] = useState(false);

  const applyCanvasContent = useCallback(
    (content: CanvasContent) => {
      skipAutosaveAfterLoadRef.current = true;
      const nextNodes = reorderChildrenAfterParents(content.nodes.map(normalizeNodeType));
      const nextEdges = content.edges.map((e) => ({
        ...e,
        type: "deletable" as const,
        sourceHandle: e.sourceHandle ?? "right",
        targetHandle: e.targetHandle ?? "left",
        style: { ...e.style, stroke: DEFAULT_EDGE_COLOR, strokeWidth: EDGE_WIDTH },
      }));
      setCanvasNodes(nextNodes);
      setCanvasEdges(nextEdges);
      setLogPanelContent({ nodes: nextNodes, edges: nextEdges });
      setGraphEpoch((epoch) => epoch + 1);
    },
    [setCanvasNodes, setCanvasEdges],
  );

  const refreshCanvasData = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // Flush any pending autosave so local graph edits aren't dropped.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (loadedRef.current) {
        await getCanvasStore().saveCanvasContent(canvasId, getCurrentCanvasContent());
      }

      await Promise.all([
        refreshWorkspaceRecords(queryClient),
        queryClient.refetchQueries({ queryKey: ["canvas", canvasId] }),
        queryClient.refetchQueries({ queryKey: ["canvases", projectId] }),
      ]);

      const freshCanvas = await getCanvasStore().getCanvas(canvasId);
      if (freshCanvas) {
        loadedRef.current = true;
        applyCanvasContent(freshCanvas.content);
      }
      toast.success("Refreshed customers, suppliers, nodes, and generic nodes");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh data");
    } finally {
      setRefreshing(false);
    }
  }, [
    applyCanvasContent,
    canvasId,
    getCurrentCanvasContent,
    projectId,
    queryClient,
    refreshing,
  ]);

  const resizeNode = useCallback(
    (id: string, width: number, height: number) => {
      setCanvasNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          // nodeOrigin is [0.5, 0.5], so `position` is the node's CENTER. To
          // keep the visible top-left corner pinned while resizing, recompute
          // the center from the (fixed) top-left and the new size.
          // Prefer the stored size (no measurement lag) over `measured`.
          const oldW = (n.data.width as number | undefined) ?? n.measured?.width ?? width;
          const oldH = (n.data.height as number | undefined) ?? n.measured?.height ?? height;
          if (oldW === width && oldH === height) return n;
          const topLeftX = n.position.x - oldW / 2;
          const topLeftY = n.position.y - oldH / 2;
          return {
            ...n,
            position: { x: topLeftX + width / 2, y: topLeftY + height / 2 },
            data: { ...n.data, width, height },
          };
        }),
      );
    },
    [setCanvasNodes],
  );

  const findGroupAtPosition = useCallback(
    (position: XYPosition): string | null => {
      const group = getNodes().find((candidate) => {
        if (candidate.type !== "group") return false;
        const measuredRect = rectOf(getInternalNode(candidate.id));
        const rect = measuredRect ?? getGroupRectFromNode(candidate);
        return (
          position.x >= rect.x &&
          position.x <= rect.x + rect.w &&
          position.y >= rect.y &&
          position.y <= rect.y + rect.h
        );
      });
      return group?.id ?? null;
    },
    [getInternalNode, getNodes],
  );

  const addNodeAtPosition = useCallback(
    (request: NodeCreationRequest, position: XYPosition) => {
      const type = request.kind === "registered-node" ? request.type : "imageInput";
      let targetGroupId: string | null = null;
      if (type !== "group") {
        targetGroupId = findGroupAtPosition(position);
      }
      const nodePosition = targetGroupId
        ? position
        : findNewNodePosition(position, nodesRef.current);
      const node =
        request.kind === "generic-preset"
          ? createGenericPresetNode(request.definition, nodePosition)
          : createNode(type, nodePosition);
      setCanvasNodes((nds) => appendSelectedNode(nds, node));
      if (targetGroupId) {
        setPendingGroupMembershipChange({
          kind: "add",
          nodeId: node.id,
          groupId: targetGroupId,
          center: position,
        });
      }
      if (request.kind === "registered-node" && nodeNeedsInitialFieldFocus(type)) {
        focusNewNodeField(node.id);
      }
    },
    [findGroupAtPosition, setCanvasNodes],
  );

  const addNodeAtCenter = useCallback(
    (type: NodeType) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      addNodeAtPosition({ kind: "registered-node", type }, position);
    },
    [addNodeAtPosition, screenToFlowPosition],
  );

  const addGenericNodeAtCenter = useCallback(
    (definition: GenericNodeDefinition) => {
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      addNodeAtPosition({ kind: "generic-preset", definition }, position);
    },
    [addNodeAtPosition, screenToFlowPosition],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragOverGroupId(null);
      const payload = parsePaletteDragPayload(event.dataTransfer.getData(PALETTE_DRAG_MIME_TYPE));
      if (!payload) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      if (payload.kind === "registered-node") {
        addNodeAtPosition(payload, position);
        return;
      }

      const definition = genericNodeDefinitionsById.get(payload.definitionId);
      if (!definition) {
        toast.error("This generic node is no longer available.");
        return;
      }
      addNodeAtPosition({ kind: "generic-preset", definition }, position);
    },
    [addNodeAtPosition, genericNodeDefinitionsById, screenToFlowPosition],
  );

  const onDragOverCanvas = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const type = event.dataTransfer.types.includes(PALETTE_DRAG_MIME_TYPE);
      if (!type) {
        setDragOverGroupId(null);
        return;
      }
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setDragOverGroupId(findGroupAtPosition(position));
    },
    [findGroupAtPosition, screenToFlowPosition],
  );

  const clearDragOverGroup = useCallback(() => setDragOverGroupId(null), []);

  const hoveredGraph = useMemo(() => {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const flowEdgeIds = new Set<string>();

    if (!hoverTarget) return { nodeIds, edgeIds, flowEdgeIds };

    if (hoverTarget.kind === "edge") {
      const edge = edges.find((candidate) => candidate.id === hoverTarget.id);
      if (!edge) return { nodeIds, edgeIds, flowEdgeIds };

      edgeIds.add(edge.id);
      flowEdgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
      return { nodeIds, edgeIds, flowEdgeIds };
    }

    nodeIds.add(hoverTarget.id);
    for (const edge of edges) {
      if (edge.source !== hoverTarget.id) continue;
      edgeIds.add(edge.id);
      flowEdgeIds.add(edge.id);
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
    }

    return { nodeIds, edgeIds, flowEdgeIds };
  }, [edges, hoverTarget]);

  const renderedNodes = useMemo<CanvasNode[]>(
    () =>
      nodes.map((node) => ({
        ...node,
        className: cn(
          node.className,
          hoveredGraph.nodeIds.has(node.id) && "canvas-node-highlight",
          hoveredReferenceNodeId === node.id && "canvas-node-reference-highlight",
          dragOverGroupId === node.id && "canvas-group-drop-target",
        ),
      })),
    [dragOverGroupId, hoveredGraph.nodeIds, hoveredReferenceNodeId, nodes],
  );

  const renderedEdges = useMemo<CanvasEdge[]>(
    () =>
      edges.map((edge) => {
        const isHighlighted = hoveredGraph.edgeIds.has(edge.id);
        const isFlowing = hoveredGraph.flowEdgeIds.has(edge.id);
        return {
          ...edge,
          data: {
            ...(edge.data ?? {}),
            flow: isFlowing,
          },
          style: {
            ...edge.style,
            stroke: isHighlighted ? HIGHLIGHT_EDGE_COLOR : DEFAULT_EDGE_COLOR,
            strokeWidth: isHighlighted ? HIGHLIGHT_EDGE_WIDTH : EDGE_WIDTH,
          },
        };
      }),
    [edges, hoveredGraph.edgeIds, hoveredGraph.flowEdgeIds],
  );

  const clearHoverTarget = useCallback(() => setHoverTarget(null), []);

  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: CanvasNode) => {
    setHoverTarget({ kind: "node", id: node.id });
  }, []);

  const onEdgeMouseEnter = useCallback((_event: React.MouseEvent, edge: CanvasEdge) => {
    setHoverTarget({ kind: "edge", id: edge.id });
  }, []);

  // Lagged snapshot keeps the log panel off the drag/render hot path.
  const liveCanvas = useMemo(
    () => (canvas ? { ...canvas, content: logPanelContent } : null),
    [canvas, logPanelContent],
  );

  const actions = useMemo(
    () => ({
      updateNodeData,
      getConnectedInputReferences,
      getG2ImageReferences,
      addG2ImageReference,
      hasConnectedOutputNode,
      getConnectedOutputState,
      updateConnectedOutputData,
      startGenerationRun,
      isGenerationRunCurrent,
      finishGenerationRun,
      cancelGenerationRun,
      writeGeneratedImageToOutput,
      deleteNode,
      getNodeConnectionCount,
      ungroupNode,
      disconnectGroupNode,
      leaveGroupNode: detachNodeFromGroup,
      deleteEdge,
      resizeNode,
    }),
    [
      updateNodeData,
      getConnectedInputReferences,
      getG2ImageReferences,
      addG2ImageReference,
      hasConnectedOutputNode,
      getConnectedOutputState,
      updateConnectedOutputData,
      startGenerationRun,
      isGenerationRunCurrent,
      finishGenerationRun,
      cancelGenerationRun,
      writeGeneratedImageToOutput,
      deleteNode,
      getNodeConnectionCount,
      ungroupNode,
      disconnectGroupNode,
      detachNodeFromGroup,
      deleteEdge,
      resizeNode,
    ],
  );

  return (
    <div
      onClickCapture={handleCanvasNavigationClickCapture}
      className={
        embedded
          ? "bg-background flex h-[calc(100dvh-6rem)] flex-col"
          : "bg-background flex h-[calc(100dvh-3.5rem)] flex-col"
      }
    >
      <div className="bg-background/90 supports-[backdrop-filter]:bg-background/70 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur">
        {onBack ? (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back to project"
            onClick={() => {
              if (confirmLeavingActiveGeneration()) onBack();
            }}
          >
            <ChevronLeft />
          </Button>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Back to project"
            render={<Link href={`/projects/${projectId}`} />}
          >
            <ChevronLeft />
          </Button>
        )}
        {isLoading || !canvas ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <div className="min-w-0">
            <p className="text-muted-foreground text-[0.7rem] font-medium tracking-wide uppercase">
              Canvas
            </p>
            <span className="block truncate text-sm font-semibold">{canvas.name}</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {canvas ? <SendCanvasDialog canvas={canvas} project={project ?? null} /> : null}
          <RenderGalleryDialog canvasId={canvasId} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shadow-sm"
            disabled={isLoading || !canvas || refreshing}
            onClick={() => void refreshCanvasData()}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
          <ConfirmDialog
            title="Delete all nodes?"
            description="This removes every node and wire from this canvas."
            confirmLabel="Delete all"
            onConfirm={deleteAll}
            trigger={
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isLoading || !canvas || (nodes.length === 0 && edges.length === 0)}
                className="shadow-sm"
              >
                <Trash2 />
                Delete all
              </Button>
            }
          />
          <Button
            type="button"
            size="sm"
            className="shadow-sm"
            disabled={isLoading || !canvas || saving}
            onClick={openSaveDialog}
          >
            <Save />
            Save canvas
          </Button>
        </div>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <form onSubmit={saveCanvas} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Save canvas</DialogTitle>
              <DialogDescription>
                Add a name and save this canvas content to the active database.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="canvas-save-name">Canvas name</Label>
              <Input
                id="canvas-save-name"
                autoFocus
                className="h-10"
                placeholder="Canvas name"
                value={canvasName}
                onChange={(event) => setCanvasName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
              <Button type="submit" disabled={saving || !canvasName.trim()}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <form onSubmit={createSelectionGroup} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Name this group</DialogTitle>
              <DialogDescription>
                The selected nodes will move and batch-connect together through the group output.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="canvas-group-name">Group name</Label>
              <Input
                id="canvas-group-name"
                autoFocus
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Product preparation"
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit" disabled={!groupName.trim()}>
                Create group
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingGroupMembershipChange !== null}
        onOpenChange={(open) => {
          if (!open) cancelPendingGroupMembershipChange();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingGroupMembershipChange?.kind === "add" ? "Add to group?" : "Leave group?"}
            </DialogTitle>
            <DialogDescription>
              {pendingGroupMembershipChange?.kind === "add"
                ? "Add this node to the group and resize the group rectangle around it."
                : "Remove this node from the group. If you cancel, the group rectangle will expand around the node's new position."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancelPendingGroupMembershipChange}>
              No
            </Button>
            <Button type="button" onClick={confirmPendingGroupMembershipChange}>
              Yes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex min-h-0 flex-1">
        <CanvasActionsContext.Provider value={actions}>
          <NodePalette
            nodes={nodes}
            onAdd={addNodeAtCenter}
            genericNodeDefinitions={genericNodeDefinitions}
            genericNodeDefinitionsLoading={genericNodeDefinitionsQuery.isLoading}
            genericNodeDefinitionsError={genericNodeDefinitionsQuery.isError}
            onAddGenericNode={addGenericNodeAtCenter}
          />
          <ReferenceHoverContext.Provider value={referenceHover}>
            <ConnectionHighlightContext.Provider value={connectionHighlight}>
              <div
                className="relative flex-1"
                onDrop={onDrop}
                onDragEnter={onDragOverCanvas}
                onDragOver={onDragOverCanvas}
                onDragLeave={clearDragOverGroup}
              >
                {connectedNotice && (
                  <div className="bg-card text-foreground pointer-events-none absolute top-3 right-3 z-30 rounded-md border px-3 py-1.5 text-xs font-semibold shadow-md">
                    connected
                  </div>
                )}
                {isLoading || !canvas ? (
                  <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                    Loading canvas...
                  </div>
                ) : (
                  <ReactFlow
                    nodes={renderedNodes}
                    edges={renderedEdges}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={handleEdgesChange}
                    onConnect={onConnect}
                    onConnectStart={onConnectStart}
                    onConnectEnd={onConnectEnd}
                    onNodeMouseEnter={onNodeMouseEnter}
                    onNodeMouseLeave={clearHoverTarget}
                    onEdgeMouseEnter={onEdgeMouseEnter}
                    onEdgeMouseLeave={clearHoverTarget}
                    onNodeDragStart={onNodeDragStart}
                    onNodeDragStop={onNodeDragStop}
                    onSelectionEnd={handleSelectionEnd}
                    selectionOnDrag
                    selectionMode={SelectionMode.Partial}
                    panOnDrag={[1, 2]}
                    nodeTypes={CANVAS_NODE_TYPES}
                    edgeTypes={CANVAS_EDGE_TYPES}
                    nodeOrigin={[0.5, 0.5]}
                    connectionMode={ConnectionMode.Loose}
                    connectionLineType={ConnectionLineType.Bezier}
                    connectionLineStyle={{
                      stroke: connectionColor,
                      strokeWidth: EDGE_WIDTH,
                    }}
                    defaultEdgeOptions={DEFAULT_CANVAS_EDGE_OPTIONS}
                    deleteKeyCode={["Delete", "Backspace"]}
                    fitView
                    className="bg-background"
                  >
                    <Background
                      variant={BackgroundVariant.Dots}
                      gap={24}
                      size={1}
                      color="color-mix(in oklch, var(--muted-foreground), transparent 62%)"
                    />
                    <Controls />
                    <MiniMap pannable zoomable />
                  </ReactFlow>
                )}
              </div>
            </ConnectionHighlightContext.Provider>
          </ReferenceHoverContext.Provider>
          {liveCanvas ? <CanvasLogPanel canvas={liveCanvas} project={project ?? null} /> : null}
        </CanvasActionsContext.Provider>
      </div>
    </div>
  );
}

export function CanvasEditor({
  projectId,
  canvasId,
  embedded = false,
  onBack,
}: {
  projectId: string;
  canvasId: string;
  embedded?: boolean;
  onBack?: () => void;
}) {
  return (
    <ReactFlowProvider>
      <Editor projectId={projectId} canvasId={canvasId} embedded={embedded} onBack={onBack} />
    </ReactFlowProvider>
  );
}
