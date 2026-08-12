"use client";

import { useCallback, useContext, useMemo, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { ImageIcon, Loader2, Square, Wand2, X } from "lucide-react";
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
import { NODE_PORT_COLORS } from "@/lib/nodes/ports";
import type { G2CanvasNode, G2Region } from "@/lib/nodes/types";
import { createMaskFromG2Regions } from "@/lib/nodes/g2";
import {
  readImageRefDrag,
  isImageRefDrag,
} from "@/lib/nodes/image-ref-drag";
import {
  IMAGE_GENERATION_OUTPUT_FORMATS,
  IMAGE_GENERATION_RESOLUTIONS,
  IMAGE_GENERATION_SIZES,
  type ImageGenerationModelId,
  type ImageGenerationOutputFormat,
  type ImageGenerationResolution,
  type ImageGenerationSize,
  type ImageGenerationReference,
  imageGenerationErrorSchema,
  imageGenerationResponseSchema,
  normalizeImageGenerationModel,
  normalizeImageGenerationOutputFormat,
  normalizeImageGenerationResolution,
  normalizeImageGenerationSize,
} from "@/lib/image-generation-models";
import { persistGeneratedImage } from "@/lib/upload";
import { isAbortError } from "@/lib/generation-run";
import { G2MentionTextarea, type MentionCandidate } from "@/lib/prompt-mention-g2";
import {
  useCanvasActions,
  useConnectionHighlight,
  useGroupAccent,
  ConnectionHighlightContext,
  type ConnectedImageReference,
} from "../canvas-context";
import { G2DrawOverlay } from "./g2-draw-overlay";
import { NodeDeleteButton } from "./delete-button";
import { InputPort, OutputPort } from "./port";
import { ResizeHandle } from "./resize-handle";

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 560;

const G2_GPT_MODEL_OPTIONS: readonly {
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

export function G2Node({ id, data, parentId, selected }: NodeProps<G2CanvasNode>) {
  const {
    updateNodeData,
    hasConnectedOutputNode,
    getConnectedOutputState,
    updateConnectedOutputData,
    startGenerationRun,
    isGenerationRunCurrent,
    finishGenerationRun,
    cancelGenerationRun,
    writeGeneratedImageToOutput,
    getG2ImageReferences,
    addG2ImageReference,
    deleteEdge,
  } = useCanvasActions();
  const highlight = useConnectionHighlight(id);
  const accent = useGroupAccent(parentId);
  const width = data.width ?? DEFAULT_WIDTH;
  const height = data.height ?? DEFAULT_HEIGHT;

  // Live connection drag: which drop area the pointer is hovering on this node.
  const { sourceId, targetId, targetG2Drop } = useContext(ConnectionHighlightContext);
  const draggingWire = sourceId !== null && sourceId !== id;
  const hoveringThisNode = draggingWire && targetId === id;
  const dropHighlight = hoveringThisNode ? targetG2Drop : null;

  // ── State ───────────────────────────────────────────────────────────────
  const [isGenerating, setIsGenerating] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [hoveredAliasId, setHoveredAliasId] = useState<string | null>(null);

  // Wires are the source of truth — derive main + references from the edges.
  const { main: mainRef, references } = getG2ImageReferences(id);
  const mainImageUrl = mainRef?.imageUrl ?? null;
  const mainImageAlias = mainRef?.alias ?? null;

  const g2Regions = useMemo<G2Region[]>(
    () => (Array.isArray(data.g2Regions) ? (data.g2Regions as G2Region[]) : []),
    [data.g2Regions],
  );
  const undoStack = useMemo<G2Region[][]>(
    () => (Array.isArray(data.undoStack) ? (data.undoStack as G2Region[][]) : []),
    [data.undoStack],
  );
  const redoStack = useMemo<G2Region[][]>(
    () => (Array.isArray(data.redoStack) ? (data.redoStack as G2Region[][]) : []),
    [data.redoStack],
  );
  const prompt = typeof data.prompt === "string" ? data.prompt : "";
  const systemPrompt = typeof data.systemPrompt === "string" ? data.systemPrompt : "";
  const hasOutput = hasConnectedOutputNode(id);
  const connectedOutput = getConnectedOutputState(id);
  const connectedOutputHasImage = Boolean(connectedOutput?.resultUrl);

  const model = normalizeImageGenerationModel(data.model ?? "gpt-image-2");
  const size = normalizeImageGenerationSize(data.size ?? "1024x1024");
  const outputFormat = normalizeImageGenerationOutputFormat(data.outputFormat ?? "png");
  const resolution = normalizeImageGenerationResolution(data.resolution ?? "preview");
  const matchSourceSize = data.matchSourceSize !== false; // default on
  const isGptModel = model.startsWith("gpt-image") || model.startsWith("dall-e");

  // Removing the wire removes the image. Re-delete any region the overlay drew.
  function removeMainImage() {
    if (mainRef) deleteEdge(mainRef.edgeId);
    updateNodeData(id, { g2Regions: [], undoStack: [], redoStack: [] });
  }
  function removeReference(edgeId: string) {
    deleteEdge(edgeId);
  }

  // Allow an HTML5 drag (the Link2 handle on image/output nodes) to behave the
  // same as a wire drop: it sets the image on the targeted area by creating an
  // edge. Wires are the source of truth — the edge carries the role.
  function acceptImageDrop(event: React.DragEvent<HTMLElement>, role: "main" | "reference"): void {
    if (!isImageRefDrag(event.dataTransfer)) return;
    const payload = readImageRefDrag(event.dataTransfer);
    if (!payload?.sourceNodeId) return; // can't make an edge without a source node
    event.preventDefault();
    if (role === "main" && mainRef?.nodeId === payload.sourceNodeId) return; // already main
    if (role === "reference" && references.some((r) => r.nodeId === payload.sourceNodeId)) return;
    const ok = addG2ImageReference(id, payload.sourceNodeId, role);
    if (!ok) toast.error("That node has no image to reference");
  }

  // ── Overlay commit (regions + history) ──────────────────────────────────
  function commitRegions(nextRegions: G2Region[], nextUndo: G2Region[][], nextRedo: G2Region[][]) {
    updateNodeData(id, {
      g2Regions: nextRegions,
      undoStack: nextUndo,
      redoStack: nextRedo,
    });
  }

  // ── Mention candidates ──────────────────────────────────────────────────
  const mentionCandidates: MentionCandidate[] = useMemo(() => {
    const list: MentionCandidate[] = [];
    if (mainRef) {
      list.push({
        id: mainRef.nodeId,
        alias: mainImageAlias ?? "main",
        label: mainImageAlias ?? "Main image",
        group: "Main",
      });
    }
    references.forEach((r, i) => {
      list.push({ id: r.nodeId, alias: r.alias, label: r.label, group: "References" });
      void i;
    });
    g2Regions.forEach((r) => {
      list.push({
        id: `region-${r.id}`,
        alias: r.name,
        label: `Region · ${r.name}`,
        group: "Regions",
      });
    });
    return list;
  }, [mainRef, mainImageAlias, references, g2Regions]);

  // ── Generate ────────────────────────────────────────────────────────────
  const onGenerate = useCallback(async () => {
    if (!mainImageUrl) {
      toast.error("Add a main image first");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Enter a prompt");
      return;
    }
    if (g2Regions.length === 0) {
      toast.error("Draw at least one region on the image");
      return;
    }

    const run = startGenerationRun(id);
    if (!run) return;

    const outputReady = updateConnectedOutputData(id, {
      status: "loading",
      error: undefined,
    });
    if (!outputReady) {
      finishGenerationRun(id, run.runId);
      toast.error("Connect an Output node before generating");
      return;
    }

    setIsGenerating(true);
    updateNodeData(id, { status: "loading", error: undefined });

    try {
      // Fetch the main image so we can read its natural dims (mask sizing +
      // matchSourceSize) and reuse the blob.
      const mainBlobRes = await fetch(mainImageUrl);
      const mainBlob = await mainBlobRes.blob();
      const mainBitmap = await createImageBitmap(mainBlob);
      const naturalWidth = mainBitmap.width;
      const naturalHeight = mainBitmap.height;

      const maskBlob = await createMaskFromG2Regions(naturalWidth, naturalHeight, g2Regions);
      mainBitmap.close();
      if (!maskBlob) {
        throw new Error("Failed to create mask from regions");
      }

      // Upload the mask
      const maskForm = new FormData();
      maskForm.append("file", maskBlob, "g2-mask.png");
      maskForm.append("name", `g2-mask-${id}`);
      const maskRes = await fetch("/api/masks", { method: "POST", body: maskForm });
      if (!maskRes.ok) throw new Error("Failed to upload mask");
      const maskJson = (await maskRes.json()) as { url?: unknown };
      const maskUrl = typeof maskJson.url === "string" ? maskJson.url : null;
      if (!maskUrl) throw new Error("Failed to get mask URL");

      // Build the reference list: main image (with mask) + each reference.
      // References may be images OR Pantone swatches (kind: "pantone") — the
      // server turns a Pantone into a solid-color PNG swatch + color-transfer
      // constraint (compileReferencePrompt), so it needs no image URL.
      const referenceList: ImageGenerationReference[] = [
        { kind: "image", alias: mainImageAlias ?? "main", url: mainImageUrl, maskUrl },
        ...references.map((r): ImageGenerationReference => {
          if (r.kind === "pantone") {
            return { kind: "pantone", alias: r.alias, label: r.label, hex: r.swatchHex };
          }
          return { kind: "image", alias: r.alias, url: r.imageUrl };
        }),
      ];

      // Regions are NOT provider image references — they are mask regions on the
      // main image. Rewrite @region-name tokens in the prompt to refer to the
      // main image's alias so the provider maps them correctly, and append a
      // region-naming note so the model knows the mask region's name.
      const regionNames = g2Regions
        .map((r) => r.name)
        .filter((name) => name && name.trim())
        .map((name) => name.trim());
      let resolvedPrompt = prompt;
      if (regionNames.length > 0 && mainImageAlias) {
        for (const name of regionNames) {
          const token = new RegExp(`@${escapeRegExp(name)}\\b`, "g");
          resolvedPrompt = resolvedPrompt.replace(token, `@${mainImageAlias}`);
        }
        const regionNote = `\n\nRegion names on @${mainImageAlias} (defined by the attached mask, transparent = edit): ${regionNames
          .map((name) => `@${name}`)
          .join(", ")}. Apply the instruction to the named region(s) inside the mask.`;
        resolvedPrompt = `${resolvedPrompt}${regionNote}`;
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: run.signal,
        body: JSON.stringify({
          model,
          prompt: resolvedPrompt,
          systemPrompt: systemPrompt || undefined,
          size,
          outputFormat: isGptModel ? "png" : outputFormat,
          resolution,
          references: referenceList,
          matchSourceSize: matchSourceSize,
        }),
      });

      if (!isGenerationRunCurrent(id, run.runId)) return;

      const json: unknown = await res.json();
      if (!isGenerationRunCurrent(id, run.runId)) return;

      const parsed = imageGenerationResponseSchema.safeParse(json);
      if (!res.ok || !parsed.success) {
        const error = imageGenerationErrorSchema.safeParse(json);
        throw new Error(error.success ? error.data.error : "Generation failed");
      }

      const finalFormat = isGptModel ? "png" : outputFormat;
      const persisted = await persistGeneratedImage(parsed.data.url, finalFormat, run.signal);
      if (!isGenerationRunCurrent(id, run.runId)) return;

      updateNodeData(id, {
        status: "done",
        resultUrl: persisted.url,
        error: undefined,
      });

      const outputWritten = writeGeneratedImageToOutput(id, persisted.url, {
        prompt,
        model,
        size,
        resolution,
        outputFormat: finalFormat,
        storagePath: persisted.storagePath,
      });

      if (!outputWritten) {
        throw new Error("Output node was disconnected before generation finished");
      }

      toast.success("Image edited and saved to Renders.");
    } catch (err) {
      const cancelled =
        run.signal.aborted || !isGenerationRunCurrent(id, run.runId) || isAbortError(err);
      if (cancelled) return;
      const message = err instanceof Error ? err.message : "Generation failed";
      updateNodeData(id, { status: "error", error: message });
      updateConnectedOutputData(id, { status: "error", error: message });
      toast.error(message);
    } finally {
      setIsGenerating(false);
      finishGenerationRun(id, run.runId);
    }
  }, [
    id, mainImageUrl, prompt, g2Regions, startGenerationRun, updateConnectedOutputData,
    finishGenerationRun, updateNodeData, mainImageAlias, mainRef, references, model, systemPrompt,
    size, outputFormat, isGptModel, resolution, matchSourceSize, isGenerationRunCurrent,
    writeGeneratedImageToOutput,
  ]);
  function stopGeneration() {
    if (cancelGenerationRun(id)) {
      toast.info("Generation stopped.");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const mainAliasLabel = mainImageAlias ? `@${mainImageAlias}` : "Main";

  return (
    <div
      style={{
        width,
        height,
        ...(accent ? { outline: `2px solid ${accent}`, outlineOffset: 2 } : {}),
        ...highlight,
      }}
      aria-busy={isGenerating}
      className={cn(
        "group bg-card relative flex flex-col overflow-hidden rounded-lg border shadow-md",
        selected && "ring-primary ring-offset-background shadow-lg ring-2 ring-offset-2",
      )}
    >
      <NodeDeleteButton id={id} />
      <InputPort color={NODE_PORT_COLORS.g2} top={16} zIndex={30} />
      <div className="bg-card relative z-20 flex h-11 shrink-0 items-center gap-2 border-b px-3 pr-10 text-sm font-medium shadow-sm">
        <Wand2 className="size-4" />
        G2 Edit
        {isGenerating ? (
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            title="Stop generation"
            aria-label="Stop generation"
            className="nodrag nopan ml-auto"
            onClick={stopGeneration}
          >
            <Square className="fill-current" />
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-3">
        {/* ── Main image area (drop region A from a wired source) ──────────── */}
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Main image (A)</span>
          {mainImageUrl ? (
            <div
              data-g2-drop="main"
              className={cn(
                "nodrag nopan relative overflow-hidden rounded-md border outline-none transition-[box-shadow]",
                dropHighlight === "main"
                  ? "ring-2 ring-yellow-400 shadow-[0_0_0_3px_rgba(250,204,21,0.45)]"
                  : dropHighlight === "reference"
                    ? "opacity-40"
                    : "hover:border-primary/60",
              )}
            >
              <button
                type="button"
                onClick={() => setOverlayOpen(true)}
                className="block w-full cursor-zoom-in"
                title="Open region editor"
                onDragEnter={(e) => acceptImageDrop(e, "main")}
                onDrop={(e) => acceptImageDrop(e, "main")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mainImageUrl}
                  alt="Main"
                  className="max-h-44 w-full object-contain bg-muted/40"
                  draggable={false}
                />
              </button>
              {/* alias badge */}
              <span className="nodrag nopan absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[0.6rem] text-white">
                {mainAliasLabel}
              </span>
              <span className="nodrag nopan absolute top-1 left-1 rounded bg-black/45 px-1 text-[0.55rem] text-white/90">
                {g2Regions.length} region{g2Regions.length === 1 ? "" : "s"} · click to edit
              </span>
              {/* clear — removes the wire */}
              <button
                type="button"
                onClick={removeMainImage}
                title="Disconnect main image"
                className="nodrag nopan bg-background/90 text-foreground absolute top-1 right-1 flex size-5 items-center justify-center rounded-sm shadow-sm"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <div
              data-g2-drop="main"
              onDragEnter={(e) => acceptImageDrop(e, "main")}
              onDrop={(e) => acceptImageDrop(e, "main")}
              className={cn(
                "nodrag nopan bg-muted/40 flex min-h-[120px] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground outline-none transition-[box-shadow,border-color,background-color]",
                dropHighlight === "main"
                  ? "border-yellow-400 bg-yellow-400/10 shadow-[0_0_0_3px_rgba(250,204,21,0.45)]"
                  : dropHighlight === "reference"
                    ? "opacity-40"
                    : "hover:bg-muted/60",
              )}
            >
              <ImageIcon className="size-4" />
              <span>Drag a node line here</span>
              <span className="text-[0.6rem] text-muted-foreground/80">{"drop on a source node's edge dot"}</span>
            </div>
          )}
        </div>

        {/* ── Reference images area (drop B/C/D from wired sources) ───────── */}
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Reference images (B, C, D...)</span>
          <div
            data-g2-drop="references"
            onDragEnter={(e) => acceptImageDrop(e, "reference")}
            onDrop={(e) => acceptImageDrop(e, "reference")}
            className={cn(
              "nodrag nopan bg-background/60 flex min-h-12 flex-wrap gap-1 rounded-md border border-dashed p-1 outline-none transition-[box-shadow,border-color]",
              dropHighlight === "reference"
                ? "border-yellow-400 bg-yellow-400/10 shadow-[0_0_0_3px_rgba(250,204,21,0.45)]"
                : dropHighlight === "main"
                  ? "opacity-40"
                  : "hover:bg-background/80",
            )}
          >
            {references.length > 0 ? (
              references.map((ref) => (
                <div
                  key={ref.edgeId}
                  className={cn(
                    "group/ref relative size-10 overflow-hidden rounded transition-[box-shadow,transform]",
                    hoveredAliasId === ref.nodeId && "ring-2 ring-yellow-400",
                  )}
                >
                  {ref.kind === "image" ? (
                    <ImagePreviewDialog
                      src={ref.imageUrl}
                      alt={`@${ref.alias} reference`}
                      title={`@${ref.alias} reference image`}
                      trigger={
                        <button
                          type="button"
                          className="nodrag nopan size-full cursor-zoom-in outline-none"
                          aria-label={`Enlarge @${ref.alias} reference image`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ref.imageUrl} alt="" className="size-full object-cover" />
                        </button>
                      }
                    />
                  ) : (
                    // Pantone swatch — no image URL; show a solid color chip
                    // with its hex label so the swatch is still inspectable.
                    <div
                      className="nodrag nopan size-full"
                      style={{ backgroundColor: ref.swatchHex }}
                      title={`@${ref.alias} Pantone ${ref.label} (${ref.swatchHex})`}
                      aria-label={`@${ref.alias} Pantone ${ref.label}`}
                    />
                  )}
                  <span className="nodrag nopan absolute bottom-0 left-0 right-0 truncate bg-black/55 px-0.5 text-[0.55rem] leading-3 text-white">
                    @{ref.alias}
                  </span>
                  <button
                    type="button"
                    className="nodrag nopan bg-background/90 text-foreground absolute top-0.5 right-0.5 z-10 flex size-4 items-center justify-center rounded-sm opacity-0 shadow-sm transition-opacity group-hover/ref:opacity-100"
                    onClick={() => removeReference(ref.edgeId)}
                  >
                    <X className="size-2.5" />
                  </button>
                </div>
              ))
            ) : (
              <span className="text-muted-foreground px-1 py-1 text-xs">
                {dropHighlight === "reference" ? "Release to add as reference" : "Drag a node line here to add a reference"}
              </span>
            )}
          </div>
        </div>

        {/* ── Prompt (with @alias mentions) ────────────────────────────────── */}
        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs">
            Prompt <span className="text-[0.6rem]">· use @main, @alias, @region-name</span>
          </span>
          <G2MentionTextarea
            value={prompt}
            disabled={isGenerating}
            aliases={mentionCandidates}
            onChange={(value) => updateNodeData(id, { prompt: value })}
            onHoverAlias={setHoveredAliasId}
            placeholder='e.g. "change the @collar region to leather, match @fabric-ref"'
          />
        </div>

        {/* ── System prompt ─────────────────────────────────────────────────── */}
        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs">System prompt (optional)</span>
          <textarea
            value={systemPrompt}
            disabled={isGenerating}
            placeholder="Optional system prompt (e.g. brand style, quality instructions)"
            onChange={(e) => updateNodeData(id, { systemPrompt: e.target.value })}
            className="nodrag nopan caret-foreground placeholder:text-muted-foreground min-h-12 w-full resize-y rounded-md border bg-background/60 p-2 text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* ── Generation controls ───────────────────────────────────────────── */}
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
                {G2_GPT_MODEL_OPTIONS.filter((o) => o.status === "current").map((option) => (
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
                {G2_GPT_MODEL_OPTIONS.filter((o) => o.status === "legacy").map((option) => (
                  <SelectItem key={option.model} value={option.model} disabled={option.model.startsWith("dall-e") && references.length > 0}>
                    <span className="flex flex-col items-start">
                      <span>{option.label}</span>
                      <span className="text-muted-foreground text-[0.65rem]">
                        {option.model.startsWith("dall-e") && references.length > 0
                          ? "Prompt-only, remove references first"
                          : option.description}
                      </span>
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

        {g2Regions.length > 0 ? (
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

        {/* ── Generate button ────────────────────────────────────────────────── */}
        <ConfirmDialog
          title={connectedOutputHasImage ? "Replace output image?" : "Edit image?"}
          description={
            connectedOutputHasImage
              ? `This will replace the current Output image. Download it first if you need to keep it.`
              : `Edit the main image using ${model} with ${g2Regions.length} region(s) and ${references.length} reference(s). This may use API credits.`
          }
          confirmLabel="Edit"
          destructive={false}
          onConfirm={() => void onGenerate()}
          trigger={
            <Button
              type="button"
              size="sm"
              disabled={isGenerating || !hasOutput || !mainImageUrl || !prompt.trim() || g2Regions.length === 0}
              className={cn("nodrag nopan w-full", isGenerating && "cursor-not-allowed")}
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {isGenerating ? "Editing..." : "Edit Image"}
            </Button>
          }
        />
        {!hasOutput && <p className="text-muted-foreground text-xs">Connect an Output node.</p>}
        {!mainImageUrl && <p className="text-muted-foreground text-xs">Add a main image.</p>}
        {g2Regions.length === 0 && mainImageUrl && (
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            className="nodrag nopan text-left text-xs text-primary hover:underline"
          >
            Click the main image to draw a region (Rect or Brush).
          </button>
        )}

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {data.status === "error" && data.error && (
          <p className="text-destructive text-xs">{data.error}</p>
        )}
      </div>

      <OutputPort color={NODE_PORT_COLORS.g2} />
      <ResizeHandle nodeId={id} width={width} height={height} minWidth={280} minHeight={400} />

      {mainImageUrl && (
        <G2DrawOverlay
          open={overlayOpen}
          onOpenChange={setOverlayOpen}
          imageUrl={mainImageUrl}
          regions={g2Regions}
          undoStack={undoStack}
          redoStack={redoStack}
          onCommit={commitRegions}
          hoveredRegionId={
            hoveredAliasId?.startsWith("region-") ? hoveredAliasId.slice("region-".length) : null
          }
        />
      )}
    </div>
  );
}

/** Escape a string for safe use in a RegExp body. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
