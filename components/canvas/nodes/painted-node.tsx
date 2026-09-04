"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
} from "react";
import { type NodeProps } from "@xyflow/react";
import { ImageIcon, Link2, Loader2, Square, Upload, Wand2, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImagePreviewDialog } from "@/components/image-preview-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  IMAGE_GENERATION_OUTPUT_FORMATS,
  IMAGE_GENERATION_RESOLUTIONS,
  IMAGE_GENERATION_SIZES,
  type ImageGenerationModelId,
  type ImageGenerationOutputFormat,
  type ImageGenerationReference,
  type ImageGenerationResolution,
  type ImageGenerationSize,
  imageGenerationErrorSchema,
  imageGenerationResponseSchema,
  normalizeImageGenerationModel,
  normalizeImageGenerationOutputFormat,
  normalizeImageGenerationResolution,
  normalizeImageGenerationSize,
} from "@/lib/image-generation-models";
import { NODE_PORT_COLORS } from "@/lib/nodes/ports";
import { createMaskFromG2Regions } from "@/lib/nodes/g2";
import { G2MentionTextarea, type MentionCandidate } from "@/lib/prompt-mention-g2";
import type { G2Region, PaintedCanvasNode } from "@/lib/nodes/types";
import {
  isImageRefDrag,
  readImageRefDrag,
  writeImageRefDrag,
} from "@/lib/nodes/image-ref-drag";
import { G2DrawOverlay } from "./g2-draw-overlay";
import { isAbortError } from "@/lib/generation-run";
import {
  useCanvasActions,
  useConnectionHighlight,
  useGroupAccent,
} from "../canvas-context";
import { persistGeneratedImage, uploadImage } from "@/lib/upload";
import { NodeDeleteButton } from "./delete-button";
import { InputPort, OutputPort } from "./port";
import { ResizeHandle } from "./resize-handle";

const DEFAULT_WIDTH = 256;
// Taller now that the body also hosts a prompt + generation options + Edit Region button.
const DEFAULT_HEIGHT = 440;

function firstImageFile(items: DataTransferItemList): File | null {
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return null;
}

/**
 * Resolve which main image URL the Painted node should render.
 *
 * The node has two ways to acquire a main image:
 *  - a paste/drop **override** stored on the node data, or
 *  - a **wired** image source promoted from an incoming edge.
 *
 * Override wins when present; otherwise a wired source promotes to main.
 * This is the one piece of mildly novel logic and lives entirely in this
 * component — exported so a unit test can pin it.
 */
export function resolvePaintedMainImage(input: {
  override: boolean;
  overrideUrl: string | null;
  wired: string | null;
}): string | null {
  if (input.override && input.overrideUrl) return input.overrideUrl;
  return input.wired;
}

/**
 * Decide the alias roles for a Painted region edit.
 *
 * When the Painted node has its OWN pasted/dropped image (override) AND a
 * wired source, the canvas sends TWO images to the provider: the own image is
 * the base/mask carrier (this is what gets edited) and the wired source is an
 * auxiliary reference pasted INTO the masked region (the thing `@supplier`
 * resolves to). That mirrors G2's main + references split and is what lets the
 * server-side object/color/material constraints fire (they need >=2 mentioned
 * images).
 *
 * When there is no own image, the wired source is the base itself (wire-only)
 * — same single-image behavior as before, so a standalone-wired Painted node
 * still works. Exported so a unit test can pin the decision.
 */
export function resolvePaintedEditAliases(input: {
  override: boolean;
  overrideUrl: string | null;
  wiredAlias: string | null;
  dataAlias: string | null | undefined;
}): { baseAlias: string; supplierAlias: string | null } {
  const hasOwn = input.override && Boolean(input.overrideUrl);
  const ownAlias = input.dataAlias && input.dataAlias.trim() ? input.dataAlias.trim() : "painted";
  if (hasOwn) {
    return { baseAlias: ownAlias, supplierAlias: input.wiredAlias ?? "supplier" };
  }
  return { baseAlias: input.wiredAlias ?? ownAlias, supplierAlias: null };
}

// ── Generation option label maps ─────────────────────────────────────────
// Duplicated from g2-node.tsx — they are plain literal maps not exported by
// lib/image-generation-models, and the user asked to NOT extract a shared
// module (avoid touching G2). Kept in sync with G2 by copy.
const PAINTED_GPT_MODEL_OPTIONS: readonly {
  label: string;
  description: string;
  model: ImageGenerationModelId;
  status: "current" | "legacy";
  enabled: boolean;
  disabledReason?: string;
}[] = [
  { label: "2", description: "GPT Image 2", model: "gpt-image-2", status: "current", enabled: true },
  { label: "1.5 Pro", description: "GPT Image 1.5", model: "gpt-image-1.5", status: "current", enabled: true },
  { label: "1", description: "GPT Image 1", model: "gpt-image-1", status: "current", enabled: true },
  {
    label: "1 Mini",
    description: "GPT Image 1 Mini",
    model: "gpt-image-1-mini",
    status: "current",
    enabled: false,
    disabledReason: "Unavailable on Xiangsu currently",
  },
  { label: "DALL-E 3", description: "Legacy generation", model: "dall-e-3", status: "legacy", enabled: true },
  { label: "DALL-E 2", description: "Legacy generation", model: "dall-e-2", status: "legacy", enabled: true },
];

const SIZE_LABELS: Record<ImageGenerationSize, string> = {
  "1024x1024": "Square · 1:1",
  "1536x1024": "Wide · 3:2",
  "1024x1536": "Tall · 2:3",
  "1792x1024": "16:9",
  "1024x1792": "9:16",
  "1280x960": "4:3",
  "960x1280": "3:4",
  "1792x768": "21:9",
  "768x1792": "9:21",
};

const FORMAT_LABELS: Record<ImageGenerationOutputFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
};

const RESOLUTION_LABELS: Record<ImageGenerationResolution, string> = {
  preview: "Preview",
  "2K": "2K",
  "4K": "4K",
};

export function PaintedNode({ id, data, parentId, selected }: NodeProps<PaintedCanvasNode>) {
  const {
    updateNodeData,
    getG2ImageReferences,
    addG2ImageReference,
    deleteEdge,
    hasConnectedOutputNode,
    getConnectedOutputState,
    updateConnectedOutputData,
    startGenerationRun,
    isGenerationRunCurrent,
    finishGenerationRun,
    cancelGenerationRun,
    writeGeneratedImageToOutput,
  } = useCanvasActions();
  const highlight = useConnectionHighlight(id);
  const accent = useGroupAccent(parentId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  // Local abort fallback. The canvas-level cancelGenerationRun guard has not
  // historically recognized the `painted` type; this controller guarantees
  // the node's own Stop button can cancel the in-flight request regardless.
  const localAbortRef = useRef<AbortController | null>(null);
  const width = data.width ?? DEFAULT_WIDTH;
  const height = data.height ?? DEFAULT_HEIGHT;

  // Wired image inputs — reuse the G2 machinery: an un_ROLEd wired edge seeds
  // `main`, exactly the single-image-wins behavior G2 already has.
  const { main: wiredMainRef } = getG2ImageReferences(id);
  const wired = wiredMainRef?.imageUrl ?? null;
  const wiredEdgeId = wiredMainRef?.edgeId ?? null;
  const wiredNodeId = wiredMainRef?.nodeId ?? null;
  const wiredAlias = wiredMainRef?.alias ?? null;
  const wiredLabel = wiredMainRef?.label ?? null;

  const override = Boolean(data.mainImageOverride);
  const overrideUrl = typeof data.mainImageUrl === "string" ? data.mainImageUrl : null;

  // Drive renders from the resolved URL. The stored `mainImageUrl` is kept in
  // sync with the wire by the effect below when no override is active.
  const mainImageUrl = resolvePaintedMainImage({ override, overrideUrl, wired });

  // ── Region state (defensive: legacy painted nodes have no paintedRegions) ──
  const paintedRegions = useMemo<G2Region[]>(
    () => (Array.isArray(data.paintedRegions) ? (data.paintedRegions as G2Region[]) : []),
    [data.paintedRegions],
  );
  const paintedUndoStack = useMemo<G2Region[][]>(
    () => (Array.isArray(data.paintedUndoStack) ? (data.paintedUndoStack as G2Region[][]) : []),
    [data.paintedUndoStack],
  );
  const paintedRedoStack = useMemo<G2Region[][]>(
    () => (Array.isArray(data.paintedRedoStack) ? (data.paintedRedoStack as G2Region[][]) : []),
    [data.paintedRedoStack],
  );

  const prompt = typeof data.prompt === "string" ? data.prompt : "";

  // ── @alias mention candidates ───────────────────────────────────────────────
  // The wired supplier (or other) source becomes a mentionable @alias so the
  // user can reference it in the prompt. When the Painted node also has its own
  // image, surface that as a separate base @alias too — the prompt may name
  // both ("@painted … to @supplier"). Same candidate shape as G2's dropdown.
  const { baseAlias } = resolvePaintedEditAliases({
    override,
    overrideUrl,
    wiredAlias,
    dataAlias: typeof data.alias === "string" ? data.alias : null,
  });
  const mentionCandidates: MentionCandidate[] = useMemo(() => {
    const candidates: MentionCandidate[] = [];
    if (override && overrideUrl) {
      candidates.push({
        id,
        alias: baseAlias,
        label: "Painted image",
        group: "Base",
      });
    }
    if (wired) {
      candidates.push({
        id: wiredNodeId ?? "wired",
        alias: wiredAlias ?? "main",
        label: wiredLabel ?? "Wired image",
        group: "Wired",
      });
    }
    return candidates;
  }, [override, overrideUrl, wired, wiredNodeId, wiredAlias, wiredLabel, id, baseAlias]);

  // ── Generation options ───────────────────────────────────────────────────
  const model = normalizeImageGenerationModel(data.model ?? "gpt-image-2");
  const size = normalizeImageGenerationSize(data.size ?? "1024x1024");
  const outputFormat = normalizeImageGenerationOutputFormat(data.outputFormat ?? "png");
  const resolution = normalizeImageGenerationResolution(data.resolution ?? "preview");
  const matchSourceSize = data.matchSourceSize !== false; // default on
  const isGptModel = model.startsWith("gpt-image") || model.startsWith("dall-e");

  // ── Connected Output state ───────────────────────────────────────────────
  const hasOutput = hasConnectedOutputNode(id);
  const connectedOutput = getConnectedOutputState(id);
  const connectedOutputHasImage = Boolean(connectedOutput?.resultUrl);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || !file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const { url, storagePath } = await uploadImage(file);
        updateNodeData(id, {
          mainImageUrl: url,
          mainImageStoragePath: storagePath,
          mainImageOverride: true,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [id, updateNodeData],
  );

  // Resolution effect: when no override is active, promote a wired source to
  // `data.mainImageUrl` so the value persists. Shadowed while an override is
  // active (do not overwrite the user's paste/drop).
  useEffect(() => {
    if (!override && wired && wired !== overrideUrl) {
      updateNodeData(id, { mainImageUrl: wired, mainImageStoragePath: null });
    }
  }, [override, wired, overrideUrl, id, updateNodeData]);

  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const file = firstImageFile(event.clipboardData.items);
    if (!file) return;
    event.preventDefault();
    void handleFile(file);
  }

  // Pasting via the keyboard targets the focused node. Mirror the InputNode
  // pattern: listen on `window` while this node is selected.
  useEffect(() => {
    if (!selected) return;
    function handleWindowPaste(event: ClipboardEvent) {
      if (event.defaultPrevented || !event.clipboardData) return;
      const file = firstImageFile(event.clipboardData.items);
      if (!file) return;
      event.preventDefault();
      void handleFile(file);
    }
    window.addEventListener("paste", handleWindowPaste);
    return () => window.removeEventListener("paste", handleWindowPaste);
  }, [handleFile, selected]);

  // Drop a cross-node image-ref (Link2 handle) onto the body → wire the source
  // in so a wired image promotes to main. Reuse the G2 "main" drop path: the
  // edge carries data.g2Role="main" which `getG2ImageReferences` classifies as
  // the main image.
  function acceptImageDrop(event: React.DragEvent<HTMLElement>) {
    if (!isImageRefDrag(event.dataTransfer)) return;
    const payload = readImageRefDrag(event.dataTransfer);
    if (!payload?.sourceNodeId) return;
    if (wiredMainRef?.nodeId === payload.sourceNodeId) return; // already wired as main
    event.preventDefault();
    const ok = addG2ImageReference(id, payload.sourceNodeId, "main");
    if (!ok) toast.error("That node has no image to reference");
  }

  function clearOverride() {
    // Drop the paste/drop override so a wired source (if any) re-promotes.
    // If nothing is wired, the main image is simply cleared.
    updateNodeData(id, {
      mainImageUrl: wired,
      mainImageStoragePath: null,
      mainImageOverride: false,
      // A pasted-override image is gone; its regions no longer apply.
      paintedRegions: [],
      paintedUndoStack: [],
      paintedRedoStack: [],
    });
  }

  function disconnectWire() {
    if (wiredEdgeId) deleteEdge(wiredEdgeId);
  }

  // ── Region overlay commit ────────────────────────────────────────────────
  function commitRegions(
    nextRegions: G2Region[],
    nextUndo: G2Region[][],
    nextRedo: G2Region[][],
  ) {
    updateNodeData(id, {
      paintedRegions: nextRegions,
      paintedUndoStack: nextUndo,
      paintedRedoStack: nextRedo,
    });
  }

  // ── Regional edit (mask + /api/generate) ──────────────────────────────────
  // Mirrors g2-node.tsx `onGenerate` but simplified: a single reference (the
  // main image with its mask), a plain prompt (no @alias rewriting, no system
  // prompt), result written to the connected Output node.
  const onEditRegion = useCallback(async () => {
    if (!mainImageUrl) {
      toast.error("Add a main image first");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Enter a prompt");
      return;
    }
    if (paintedRegions.length === 0) {
      toast.error("Draw a region on the image");
      return;
    }

    const run = startGenerationRun(id);
    if (!run) return; // an edit is already running for this node

    const outputReady = updateConnectedOutputData(id, { status: "loading", error: undefined });
    if (!outputReady) {
      finishGenerationRun(id, run.runId);
      toast.error("Connect an Output node before editing");
      return;
    }

    setIsGenerating(true);
    updateNodeData(id, { status: "loading", error: undefined });
    localAbortRef.current = new AbortController();

    try {
      // Read the main image's natural dims (mask sizing + matchSourceSize).
      const mainBlobRes = await fetch(mainImageUrl);
      const mainBlob = await mainBlobRes.blob();
      const mainBitmap = await createImageBitmap(mainBlob);
      const naturalWidth = mainBitmap.width;
      const naturalHeight = mainBitmap.height;

      // ── Single-region edit ──────────────────────────────────────────────────
      // We MUST edit only the FIRST region this node holds. Editing all regions
      // at once fails: the mask is a union of every hole, the model's location
      // cue is the union bbox, and with two instructions in the prompt the
      // model applies the FIRST instruction to whatever it sees first — so
      // "change region-1 color to blue / change region-2 color to yellow"
      // paints BOTH holes blue (region-2's instruction wins) and region-1
      // visibly "does not change" (it got the wrong colour or no displacement).
      // Fix: one Painted node == one region. We mask only region[0] and build
      // the prompt from that region's name regardless of other strokes.
      // ── Alias roles ────────────────────────────────────────────────────────
      // When the Painted node has its OWN image (override) AND a wired source,
      // we send TWO images: the own image is the base/mask carrier (the thing
      // being edited), the wired source is an auxiliary reference pasted INTO
      // the masked region — so the user's "@supplier" mention resolves to real
      // source pixels and the server-side object/color constraints fire (they
      // need >=2 mentioned images). Without that second reference the model
      // only ever sees the base image + a mask and drifts to a generic recolor.
      // Wire-only (no own image) keeps the single-image behavior: the wired
      // source IS the base.
      const { baseAlias, supplierAlias } = resolvePaintedEditAliases({
        override,
        overrideUrl,
        wiredAlias,
        dataAlias: typeof data.alias === "string" ? data.alias : null,
      });
      const mentionToken = `@${baseAlias}`;
      const activeRegion = paintedRegions[0]!;
      const activeRegionName = (activeRegion.name?.trim() || "region-1").replace(/\s+/g, "-");
      // If the user's prompt already mentions the region (e.g. "change region-1
      // color to @supplier") use it verbatim; otherwise wrap their text as the
      // instruction for the active region. Always anchor with the base @alias
      // so it leads the prompt text — that puts the base at image[0] in the
      // server's ordered list (the mask carrier) and the wired source (whose
      // @alias the user typed) at image[1] as the paste source. Server-side
      // colour/object constraints need a base-image mention to fire.
      let resolvedPrompt: string;
      if (prompt.includes(activeRegionName)) {
        resolvedPrompt = prompt.includes(mentionToken)
          ? prompt
          : `${mentionToken}: ${prompt}`;
      } else {
        resolvedPrompt = `${mentionToken}: ${prompt.replace(/^\s*@?\w+:\s*/, "")} (apply to ${activeRegionName})`;
      }

      // Mask ONLY the first region — separate it from any others the user may
      // have drawn so this node edits exactly one hole and the location cue /
      // bbox the server computes are that region alone, not a union.
      const maskBlob = await createMaskFromG2Regions(
        naturalWidth,
        naturalHeight,
        [activeRegion],
      );
      mainBitmap.close();
      if (!maskBlob) throw new Error("Failed to create mask from regions");

      // Upload the mask.
      const maskForm = new FormData();
      maskForm.append("file", maskBlob, "painted-mask.png");
      maskForm.append("name", `painted-mask-${id}`);
      const maskRes = await fetch("/api/masks", { method: "POST", body: maskForm });
      if (!maskRes.ok) throw new Error("Failed to upload mask");
      const maskJson = (await maskRes.json()) as { url?: unknown };
      const maskUrl = typeof maskJson.url === "string" ? maskJson.url : null;
      if (!maskUrl) throw new Error("Failed to get mask URL");

      // Reference list: the base (main image, carries the mask) is always
      // entry 0. When the Painted node also has a wired source that is a
      // separate image from the base (own override present), append it as a
      // second reference so the server attaches it as image[1] — the paste
      // source the user's @supplier mention resolves to. This mirrors G2's
      // main + references shape and is what makes object/color transfer fire.
      const referenceList: ImageGenerationReference[] = [
        {
          kind: "image",
          alias: baseAlias,
          url: mainImageUrl,
          maskUrl,
        },
      ];
      if (override && overrideUrl && wired && supplierAlias) {
        referenceList.push({ kind: "image", alias: supplierAlias, url: wired });
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: run.signal,
        body: JSON.stringify({
          model,
          prompt: resolvedPrompt,
          size,
          outputFormat: isGptModel ? "png" : outputFormat,
          resolution,
          references: referenceList,
          matchSourceSize,
        }),
      });

      if (!isGenerationRunCurrent(id, run.runId)) return;
      const json: unknown = await res.json();
      if (!isGenerationRunCurrent(id, run.runId)) return;

      const parsed = imageGenerationResponseSchema.safeParse(json);
      if (!res.ok || !parsed.success) {
        const error = imageGenerationErrorSchema.safeParse(json);
        throw new Error(error.success ? error.data.error : "Edit failed");
      }

      const finalFormat = isGptModel ? "png" : outputFormat;
      const persisted = await persistGeneratedImage(parsed.data.url, finalFormat, run.signal);
      if (!isGenerationRunCurrent(id, run.runId)) return;

      updateNodeData(id, { status: "done", resultUrl: persisted.url, error: undefined });

      const outputWritten = writeGeneratedImageToOutput(id, persisted.url, {
        prompt,
        model,
        size,
        resolution,
        outputFormat: finalFormat,
        storagePath: persisted.storagePath,
      });
      if (!outputWritten) {
        throw new Error("Output node was disconnected before the edit finished");
      }
      toast.success("Region edited and saved to Renders.");
    } catch (err) {
      const cancelled =
        run.signal.aborted ||
        !isGenerationRunCurrent(id, run.runId) ||
        isAbortError(err) ||
        Boolean(localAbortRef.current?.signal.aborted);
      if (cancelled) return;
      const message = err instanceof Error ? err.message : "Edit failed";
      updateNodeData(id, { status: "error", error: message });
      updateConnectedOutputData(id, { status: "error", error: message });
      toast.error(message);
    } finally {
      setIsGenerating(false);
      localAbortRef.current = null;
      finishGenerationRun(id, run.runId);
    }
  }, [
    id,
    mainImageUrl,
    prompt,
    paintedRegions,
    startGenerationRun,
    updateConnectedOutputData,
    finishGenerationRun,
    updateNodeData,
    model,
    size,
    outputFormat,
    isGptModel,
    resolution,
    matchSourceSize,
    isGenerationRunCurrent,
    writeGeneratedImageToOutput,
    override,
    overrideUrl,
    wired,
    data.alias,
    wiredAlias,
  ]);

  function stopGeneration() {
    // Fire the local controller first — guaranteed to cancel the in-flight
    // request regardless of the canvas-level cancel guard's node-type filter.
    localAbortRef.current?.abort(new DOMException("Edit cancelled", "AbortError"));
    // Then ask the canvas manager to abort the run + reset node state. It may
    // bail on the type guard (canvas-editor.tsx); the local abort + the
    // isGenerationRunCurrent checks inside onEditRegion still short-circuit.
    if (cancelGenerationRun(id)) {
      toast.info("Edit stopped.");
    }
    updateNodeData(id, { status: "idle", error: undefined });
    setIsGenerating(false);
  }

  const isWired = wired !== null;
  const showClearButton = mainImageUrl !== null;
  const regionCount = paintedRegions.length;

  return (
    <div
      style={{
        width,
        height,
        ...(accent ? { outline: `2px solid ${accent}`, outlineOffset: 2 } : {}),
        ...highlight,
      }}
      onPaste={handlePaste}
      className={cn(
        "group bg-card relative flex flex-col overflow-hidden rounded-lg border shadow-md",
        selected && "ring-primary ring-offset-background shadow-lg ring-2 ring-offset-2",
      )}
    >
      <NodeDeleteButton id={id} />
      <InputPort color={NODE_PORT_COLORS.painted} top={16} zIndex={30} />
      <div className="bg-card relative z-20 flex h-9 shrink-0 items-center gap-2 border-b px-3 pr-10 text-sm font-medium shadow-sm">
        <ImageIcon className="size-4" />
        Painted
        {isGenerating ? (
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            title="Stop edit"
            aria-label="Stop edit"
            className="nodrag nopan ml-auto"
            onClick={stopGeneration}
          >
            <Square className="fill-current" />
          </Button>
        ) : null}
      </div>

      <div className="bg-muted/40 relative flex items-center justify-center">
        {mainImageUrl ? (
          <>
            <ImagePreviewDialog
              src={mainImageUrl}
              alt="Painted image"
              title="Painted image preview"
              trigger={
                <button
                  type="button"
                  className="nodrag nopan focus-visible:ring-ring h-full min-h-0 max-h-[220px] w-full min-w-0 cursor-zoom-in overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  aria-label="Enlarge painted image"
                  title="Enlarge image"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mainImageUrl}
                    alt=""
                    draggable={false}
                    className="h-full min-h-0 w-full min-w-0 object-contain"
                  />
                </button>
              }
            />
            {/* Region overlay entry — open the draw editor. */}
            <button
              type="button"
              onClick={() => setOverlayOpen(true)}
              title={regionCount > 0 ? "Edit regions" : "Draw a region"}
              className="nodrag nopan absolute top-1.5 left-1.5 z-10 rounded bg-black/45 px-1 text-[0.55rem] text-white/90 hover:bg-black/70"
            >
              {regionCount > 0
                ? `${regionCount} region${regionCount === 1 ? "" : "s"} · click to edit`
                : "Draw region"}
            </button>
            {/* Replace (re-upload / re-paste) */}
            <button
              type="button"
              aria-label="Replace image"
              title="Replace image"
              className="nodrag nopan bg-background/85 focus-visible:ring-ring absolute top-1.5 right-11 z-10 flex size-7 items-center justify-center rounded-md border shadow-sm backdrop-blur-sm outline-none focus-visible:ring-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3.5" />
            </button>
            {/* Reference drag handle: drag onto a Generate/G2 reference slot. */}
            <button
              type="button"
              draggable
              title="Drag onto a Generate/G2 node to use as a reference image"
              className="nodrag bg-background/85 focus-visible:ring-ring absolute top-1.5 right-2 z-10 flex size-7 cursor-grab items-center justify-center rounded-md border shadow-sm backdrop-blur-sm outline-none focus-visible:ring-2 active:cursor-grabbing"
              onDragStart={(e) => {
                e.dataTransfer.setData("application/ica-image-url", mainImageUrl);
                writeImageRefDrag(e.dataTransfer, {
                  url: mainImageUrl,
                  sourceNodeId: id,
                  alias: typeof data.alias === "string" && data.alias ? data.alias : null,
                  label: typeof data.alias === "string" && data.alias ? data.alias : "Painted",
                });
              }}
            >
              <Link2 className="size-3.5" />
            </button>
            {/* Clear: remove the override (and re-promote a wire if present),
                or disconnect the wire if that's what's currently held. */}
            {showClearButton && (
              <button
                type="button"
                aria-label={override ? "Clear pasted image" : "Disconnect wired image"}
                title={override ? "Clear pasted image" : "Disconnect wired image"}
                className="nodrag nopan bg-background/90 text-foreground absolute top-1.5 right-20 z-10 flex size-5 items-center justify-center rounded-sm shadow-sm"
                onClick={override ? clearOverride : disconnectWire}
              >
                <X className="size-3" />
              </button>
            )}
            {/* Alias badge: when a wired source is also present show BOTH the
                painted base alias and the wired source alias (two images get
                sent); otherwise the single source's alias / a "pasted"/"wired"
                pill. */}
            {override && wiredAlias ? (
              <div className="nodrag nopan absolute bottom-1 left-1 z-10 flex gap-1">
                <span className="rounded bg-black/55 px-1 text-[0.6rem] text-white">@{baseAlias}</span>
                <span className="rounded bg-black/55 px-1 text-[0.6rem] text-white">@{wiredAlias}</span>
              </div>
            ) : !override && wiredAlias ? (
              <span className="nodrag nopan absolute bottom-1 left-1 z-10 rounded bg-black/55 px-1 text-[0.6rem] text-white">
                @{wiredAlias}
              </span>
            ) : (
              <span className="nodrag nopan absolute bottom-1 left-1 z-10 rounded bg-black/55 px-1 text-[0.6rem] text-white">
                {override ? "pasted" : "wired"}
              </span>
            )}
          </>
        ) : uploading ? (
          <div className="flex min-h-28 items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              // A dragged file — upload it as the override; a cross-node
              // image-ref — wire it in as the main source.
              if (isImageRefDrag(e.dataTransfer)) {
                acceptImageDrop(e);
                return;
              }
              e.preventDefault();
              void handleFile(e.dataTransfer.files?.[0]);
            }}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-28 min-w-32 flex-col items-center justify-center gap-1 rounded-md p-3 text-center text-xs transition-colors outline-none focus-visible:ring-2"
          >
            <ImageIcon className="size-6" />
            <span>Paste, drop, or wire an image</span>
            <span className="text-[0.6rem] text-muted-foreground/80">
              {isWired ? "wired source is pending" : "Ctrl+V, drag a file, or drop a node line"}
            </span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {/* ── Edit controls: prompt + options + Edit Region ─────────────────── */}
      <div className="nodrag nopan bg-card flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs">
            Prompt{" "}
            <span className="text-[0.6rem]">
              {override && wired
                ? `· use @${baseAlias} for this image, @${wiredAlias ?? "supplier"} for the wired source`
                : `· use @${wiredAlias ?? "main"} to reference the wired image`}
            </span>
          </span>
          <G2MentionTextarea
            value={prompt}
            disabled={isGenerating}
            aliases={mentionCandidates}
            onChange={(value) => updateNodeData(id, { prompt: value })}
            placeholder='e.g. "re-render the selected region as brushed steel, keep the original lighting"'
          />
        </div>

        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs">Model</span>
          <Select
            value={model}
            disabled={isGenerating}
            onValueChange={(value) => updateNodeData(id, { model: normalizeImageGenerationModel(value) })}
          >
            <SelectTrigger className="nodrag nopan w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="nodrag nopan">
              <SelectGroup>
                <SelectLabel>Latest first</SelectLabel>
                {PAINTED_GPT_MODEL_OPTIONS.filter((o) => o.status === "current").map((option) => (
                  <SelectItem key={option.model} value={option.model} disabled={!option.enabled}>
                    <span className="flex flex-col items-start">
                      <span>{option.label}</span>
                      <span className="text-muted-foreground text-[0.65rem]">
                        {option.enabled ? option.description : (option.disabledReason ?? option.description)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectGroup>
                <SelectLabel>Legacy</SelectLabel>
                {PAINTED_GPT_MODEL_OPTIONS.filter((o) => o.status === "legacy").map((option) => (
                  <SelectItem key={option.model} value={option.model}>
                    <span className="flex flex-col items-start">
                      <span>{option.label}</span>
                      <span className="text-muted-foreground text-[0.65rem]">{option.description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Resolution</span>
            <Select
              value={resolution}
              disabled={isGenerating}
              onValueChange={(value) => updateNodeData(id, { resolution: normalizeImageGenerationResolution(value) })}
            >
              <SelectTrigger className="nodrag nopan w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="nodrag nopan">
                {IMAGE_GENERATION_RESOLUTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {RESOLUTION_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Size</span>
            <Select
              value={size}
              disabled={isGenerating}
              onValueChange={(value) => updateNodeData(id, { size: normalizeImageGenerationSize(value) })}
            >
              <SelectTrigger className="nodrag nopan w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="nodrag nopan">
                {IMAGE_GENERATION_SIZES.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span className="flex flex-col items-start">
                      <span>{SIZE_LABELS[option]}</span>
                      <span className="text-muted-foreground font-mono text-[0.65rem]">{option}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Format</span>
            <Select
              value={isGptModel ? "png" : outputFormat}
              disabled={isGenerating || isGptModel}
              onValueChange={(value) => updateNodeData(id, { outputFormat: normalizeImageGenerationOutputFormat(value) })}
            >
              <SelectTrigger className="nodrag nopan w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="nodrag nopan">
                {IMAGE_GENERATION_OUTPUT_FORMATS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {FORMAT_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-muted-foreground truncate font-mono text-[0.65rem]">
          {model}
          {isGptModel ? " · output pinned to PNG" : null}
        </p>

        {regionCount > 0 ? (
          <label className="nodrag nopan flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={matchSourceSize}
              disabled={isGenerating}
              onChange={(event) => updateNodeData(id, { matchSourceSize: event.target.checked })}
            />
            <span>Match source size (recommended with mask)</span>
          </label>
        ) : null}

        <ConfirmDialog
          title={connectedOutputHasImage ? "Replace output image?" : "Edit region?"}
          description={
            connectedOutputHasImage
              ? "This will replace the current Output image. Download it first if you need to keep it."
              : `Re-render the region using ${model} with ${regionCount} region(s). This may use API credits.`
          }
          confirmLabel="Edit"
          destructive={false}
          onConfirm={() => void onEditRegion()}
          trigger={
            <Button
              type="button"
              size="sm"
              disabled={
                isGenerating || !hasOutput || !mainImageUrl || !prompt.trim() || regionCount === 0
              }
              className={cn("nodrag nopan w-full", isGenerating && "cursor-not-allowed")}
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {isGenerating ? "Editing..." : "Edit Region"}
            </Button>
          }
        />
        {!hasOutput && <p className="text-muted-foreground text-xs">Connect an Output node.</p>}
        {!mainImageUrl && <p className="text-muted-foreground text-xs">Add a main image.</p>}
        {regionCount === 0 && mainImageUrl && (
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            className="nodrag nopan text-left text-xs text-primary hover:underline"
          >
            Click the image to draw a region (Rect or Brush).
          </button>
        )}
        {data.status === "error" && data.error ? (
          <p className="text-destructive text-xs">{data.error}</p>
        ) : null}
      </div>

      <OutputPort color={NODE_PORT_COLORS.painted} />
      <ResizeHandle nodeId={id} width={width} height={height} minWidth={200} minHeight={320} />

      {mainImageUrl && (
        <G2DrawOverlay
          open={overlayOpen}
          onOpenChange={setOverlayOpen}
          imageUrl={mainImageUrl}
          regions={paintedRegions}
          undoStack={paintedUndoStack}
          redoStack={paintedRedoStack}
          onCommit={commitRegions}
        />
      )}
    </div>
  );
}
