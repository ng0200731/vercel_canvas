"use client";

import { useEffect } from "react";
import { type NodeProps } from "@xyflow/react";
import { Download, ImageIcon, Link2, Loader2, Square } from "lucide-react";
import { toast } from "sonner";

import { ImagePreviewDialog } from "@/components/image-preview-dialog";
import { ImageDownloadButton } from "@/components/image-download-button";
import { Button } from "@/components/ui/button";
import { isStaleGenerationConfigurationError } from "@/lib/generation-errors";
import { cn } from "@/lib/utils";
import { NODE_PORT_COLORS } from "@/lib/nodes/ports";
import { writeImageRefDrag } from "@/lib/nodes/image-ref-drag";
import type { OutputCanvasNode } from "@/lib/nodes/types";
import { useCanvasActions, useConnectionHighlight, useGroupAccent } from "../canvas-context";
import { NodeDeleteButton } from "./delete-button";
import { InputPort, OutputPort } from "./port";
import { ResizeHandle } from "./resize-handle";

const DEFAULT_WIDTH = 264;
const DEFAULT_HEIGHT = 220;

function formatDuration(ms?: number): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatCreatedAt(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function OutputNode({ id, data, parentId, selected }: NodeProps<OutputCanvasNode>) {
  const { cancelGenerationRun, updateNodeData } = useCanvasActions();
  const highlight = useConnectionHighlight(id);
  const accent = useGroupAccent(parentId);
  const width = data.width ?? DEFAULT_WIDTH;
  const height = data.height ?? DEFAULT_HEIGHT;
  const resultUrl = data.resultUrl;
  const durationLabel = formatDuration(data.generationDurationMs);
  const createdAtLabel = formatCreatedAt(data.createdAt);

  useEffect(() => {
    if (data.status !== "error" || !isStaleGenerationConfigurationError(data.error)) return;
    updateNodeData(id, { status: "idle", error: undefined });
  }, [data.error, data.status, id, updateNodeData]);

  function stopGeneration() {
    if (cancelGenerationRun(id)) {
      toast.info("Generation stopped.");
    }
  }

  return (
    <div
      style={{
        width,
        height,
        ...(accent ? { outline: `2px solid ${accent}`, outlineOffset: 2 } : {}),
        ...highlight,
      }}
      className={cn(
        "group bg-card relative flex flex-col gap-2 overflow-hidden rounded-lg border p-3 shadow-md",
        selected && "ring-primary ring-offset-background shadow-lg ring-2 ring-offset-2",
      )}
    >
      <NodeDeleteButton id={id} />
      <InputPort color={NODE_PORT_COLORS.imageOutput} />
      <div className="flex items-center gap-2 pr-6 text-sm font-medium">
        <Download className="size-4" />
        Output
        {data.status === "loading" ? (
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
        ) : durationLabel ? (
          <span className="text-muted-foreground ml-auto text-[0.68rem] tabular-nums">
            {durationLabel}
          </span>
        ) : null}
      </div>
      {createdAtLabel ? (
        <div className="text-muted-foreground truncate text-[0.68rem]">
          Created {createdAtLabel}
        </div>
      ) : null}

      <div className="bg-muted/40 relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border">
        {data.status === "loading" ? (
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        ) : resultUrl ? (
          <>
            <ImagePreviewDialog
              src={resultUrl}
              alt={data.prompt ?? "Generated output"}
              title="Generated output image"
              trigger={
                <button
                  type="button"
                  className="nodrag nopan focus-visible:ring-ring h-full min-h-0 w-full min-w-0 cursor-zoom-in overflow-hidden rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  aria-label="Enlarge generated output image"
                  title="Enlarge image"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resultUrl}
                    alt=""
                    draggable={false}
                    className="h-full min-h-0 w-full min-w-0 object-contain"
                  />
                </button>
              }
            />
            <button
              type="button"
              draggable
              title="Drag as a reference image"
              aria-label="Drag output as a reference image"
              className="nodrag nopan bg-background/85 focus-visible:ring-ring absolute top-2 right-2 z-10 flex size-7 cursor-grab items-center justify-center rounded-md border shadow-sm backdrop-blur-sm outline-none focus-visible:ring-2 active:cursor-grabbing"
              onDragStart={(event) => {
                event.dataTransfer.setData("application/ica-image-url", resultUrl);
                writeImageRefDrag(event.dataTransfer, {
                  url: resultUrl,
                  sourceNodeId: id,
                  alias: typeof data.prompt === "string" && data.prompt ? null : null,
                  label: "Output",
                });
              }}
            >
              <Link2 className="size-3.5" />
            </button>
            <ImageDownloadButton
              url={resultUrl}
              baseName={`generated-${data.model ?? "image"}`}
              title="Download generated image"
              ariaLabel="Download generated image"
              className="nodrag nopan absolute top-2 right-11 z-10 shadow-sm"
            />
          </>
        ) : data.status === "error" ? (
          <p className="text-destructive px-3 text-center text-xs">
            {data.error ?? "Generation failed"}
          </p>
        ) : (
          <div className="text-muted-foreground flex flex-col items-center gap-2 text-xs">
            <ImageIcon className="size-6" />
            <span>Awaiting generation</span>
          </div>
        )}
      </div>

      <ResizeHandle nodeId={id} width={width} height={height} minWidth={176} minHeight={152} />
      <OutputPort color={NODE_PORT_COLORS.imageOutput} />
    </div>
  );
}
