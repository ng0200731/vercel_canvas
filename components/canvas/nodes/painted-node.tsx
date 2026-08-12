"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { type NodeProps } from "@xyflow/react";
import { ImageIcon, Link2, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { ImagePreviewDialog } from "@/components/image-preview-dialog";
import { cn } from "@/lib/utils";
import { NODE_PORT_COLORS } from "@/lib/nodes/ports";
import type { PaintedCanvasNode } from "@/lib/nodes/types";
import {
  isImageRefDrag,
  readImageRefDrag,
  writeImageRefDrag,
} from "@/lib/nodes/image-ref-drag";
import { uploadImage } from "@/lib/upload";
import { useCanvasActions, useConnectionHighlight, useGroupAccent } from "../canvas-context";
import { NodeDeleteButton } from "./delete-button";
import { InputPort, OutputPort } from "./port";
import { ResizeHandle } from "./resize-handle";

const DEFAULT_WIDTH = 256;
const DEFAULT_HEIGHT = 220;

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

export function PaintedNode({ id, data, parentId, selected }: NodeProps<PaintedCanvasNode>) {
  const { updateNodeData, getG2ImageReferences, addG2ImageReference, deleteEdge } =
    useCanvasActions();
  const highlight = useConnectionHighlight(id);
  const accent = useGroupAccent(parentId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const width = data.width ?? DEFAULT_WIDTH;
  const height = data.height ?? DEFAULT_HEIGHT;

  // Wired image inputs — reuse the G2 machinery: an un_ROLEd wired edge seeds
  // `main`, exactly the single-image-wins behavior G2 already has.
  const { main: wiredMainRef } = getG2ImageReferences(id);
  const wired = wiredMainRef?.imageUrl ?? null;
  const wiredEdgeId = wiredMainRef?.edgeId ?? null;

  const override = Boolean(data.mainImageOverride);
  const overrideUrl = typeof data.mainImageUrl === "string" ? data.mainImageUrl : null;

  // Drive renders from the resolved URL. The stored `mainImageUrl` is kept in
  // sync with the wire by the effect below when no override is active.
  const mainImageUrl = resolvePaintedMainImage({ override, overrideUrl, wired });

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
    });
  }

  function disconnectWire() {
    if (wiredEdgeId) deleteEdge(wiredEdgeId);
  }

  const isWired = wired !== null;
  const showClearButton = mainImageUrl !== null;

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
      </div>

      <div className="bg-muted/40 relative flex flex-1 items-center justify-center">
        {mainImageUrl ? (
          <>
            <ImagePreviewDialog
              src={mainImageUrl}
              alt="Painted image"
              title="Painted image preview"
              trigger={
                <button
                  type="button"
                  className="nodrag nopan focus-visible:ring-ring h-full min-h-0 w-full min-w-0 cursor-zoom-in overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset"
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
            {/* Replace (re-upload / re-paste) */}
            <button
              type="button"
              aria-label="Replace image"
              title="Replace image"
              className="nodrag nopan bg-background/85 focus-visible:ring-ring absolute top-2 left-2 flex size-7 items-center justify-center rounded-md border shadow-sm backdrop-blur-sm outline-none focus-visible:ring-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3.5" />
            </button>
            {/* Reference drag handle: drag onto a Generate/G2 reference slot. */}
            <button
              type="button"
              draggable
              title="Drag onto a Generate/G2 node to use as a reference image"
              className="nodrag bg-background/85 focus-visible:ring-ring absolute top-2 right-2 flex size-7 cursor-grab items-center justify-center rounded-md border shadow-sm backdrop-blur-sm outline-none focus-visible:ring-2 active:cursor-grabbing"
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
                className="nodrag nopan bg-background/90 text-foreground absolute top-2 right-11 flex size-5 items-center justify-center rounded-sm shadow-sm"
                onClick={override ? clearOverride : disconnectWire}
              >
                <X className="size-3" />
              </button>
            )}
            {/* Source badge: which path provided the image. */}
            <span className="nodrag nopan absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[0.6rem] text-white">
              {override ? "pasted" : "wired"}
            </span>
          </>
        ) : uploading ? (
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
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

      <OutputPort color={NODE_PORT_COLORS.painted} />
      <ResizeHandle nodeId={id} width={width} height={height} minWidth={140} minHeight={140} />
    </div>
  );
}
