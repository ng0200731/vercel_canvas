"use client";

import { useState } from "react";
import { Copy, Images, LoaderCircle } from "lucide-react";
import { toast } from "sonner";

import { ImagePreviewDialog } from "@/components/image-preview-dialog";
import { ImageDownloadButton } from "@/components/image-download-button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  getModelDisplayName,
  imageGenerationModelIdSchema,
  resolutionForImageGenerationModel,
} from "@/lib/image-generation-models";
import { getCanvasStore, type ImageRecord } from "@/lib/store";

interface RenderGalleryDialogProps {
  canvasId: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

function resolutionBadge(image: ImageRecord): string {
  if (image.modelDetails?.resolution) return image.modelDetails.resolution;
  const parsedModel = imageGenerationModelIdSchema.safeParse(image.model);
  return parsedModel.success ? resolutionForImageGenerationModel(parsedModel.data) : "Preview";
}

function sizeBadge(image: ImageRecord, dimensions?: ImageDimensions): string {
  const size = image.modelDetails?.size;
  if (size === "1024x1024") return "Square";
  if (size === "1536x1024") return "Wide";
  if (size === "1024x1536") return "Tall";
  if (dimensions) {
    if (dimensions.width > dimensions.height) return "Wide";
    if (dimensions.height > dimensions.width) return "Tall";
  }
  return "Square";
}

function formatFromUrl(url: string): string | null {
  if (url.startsWith("data:image/")) {
    const match = url.match(/^data:image\/([^;,]+)/i);
    return match?.[1] ? match[1].replace("jpeg", "jpg").toUpperCase() : null;
  }

  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase();
    if (extension === "jpg" || extension === "jpeg") return "JPG";
    if (extension === "png") return "PNG";
    if (extension === "webp") return "WEBP";
  } catch {
    const extension = url.split("?")[0]?.split(".").pop()?.toLowerCase();
    if (extension === "jpg" || extension === "jpeg") return "JPG";
    if (extension === "png") return "PNG";
    if (extension === "webp") return "WEBP";
  }

  return null;
}

function formatBadge(image: ImageRecord): string {
  const format = image.modelDetails?.outputFormat?.toUpperCase();
  return format?.replace("JPEG", "JPG") || formatFromUrl(image.url) || "WEBP";
}

function modelSummary(image: ImageRecord): string {
  const details = image.modelDetails;
  const model = details?.model ?? image.model;
  return [getModelDisplayName(model), details?.size, details?.resolution, details?.outputFormat]
    .filter((value): value is string => Boolean(value))
    .join(" / ");
}

function durationBadge(image: ImageRecord): string | null {
  const durationMs = image.modelDetails?.durationMs;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  if (durationMs < 1000) return `${durationMs}ms`;
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function creationDateTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function RenderGalleryDialog({ canvasId }: RenderGalleryDialogProps) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<Record<string, ImageDimensions>>({});
  const previewItems = images.map((image) => ({
    src: image.url,
    alt: image.prompt ?? "Generated image",
  }));

  async function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setLoading(true);
    setError(null);
    try {
      setImages(await getCanvasStore().listImages(canvasId));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Failed to load renders");
    } finally {
      setLoading(false);
    }
  }

  async function copyPrompt(prompt: string | null) {
    const value = prompt?.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success("copied");
    } catch {
      toast.error("Unable to copy prompt.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => void handleOpenChange(nextOpen)}>
      <DialogTrigger
        render={
          <Button type="button" size="sm" variant="outline" className="shadow-sm">
            <Images />
            Renders
          </Button>
        }
      />
      <DialogContent className="h-[min(46rem,calc(100dvh-2rem))] max-w-[calc(100vw-2rem)] grid-rows-[auto_1fr] overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Rendered images</DialogTitle>
          <DialogDescription>
            {images.length} saved result{images.length === 1 ? "" : "s"} from this canvas.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 px-5 pb-5">
          {loading ? (
            <div className="text-muted-foreground flex h-64 items-center justify-center gap-2 text-sm">
              <LoaderCircle className="size-4 animate-spin" />
              Loading renders...
            </div>
          ) : error ? (
            <div className="text-destructive flex h-64 items-center justify-center text-sm">
              {error}
            </div>
          ) : images.length === 0 ? (
            <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-3 text-center text-sm">
              <Images className="size-8" />
              <p>No rendered images yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((image, index) => (
                <article
                  key={image.id}
                  className="group bg-card overflow-hidden rounded-md border shadow-sm"
                >
                  <div className="bg-muted relative">
                    <ImagePreviewDialog
                      src={image.url}
                      alt={image.prompt ?? "Generated image"}
                      title="Rendered image preview"
                      gallery={previewItems}
                      initialIndex={index}
                      trigger={
                        <button
                          type="button"
                          className="focus-visible:ring-ring block aspect-square w-full cursor-zoom-in overflow-hidden focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.url}
                            alt={image.prompt ?? "Generated image"}
                            className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                            onLoad={(event) => {
                              const target = event.currentTarget;
                              setDimensions((current) => ({
                                ...current,
                                [image.id]: {
                                  width: target.naturalWidth,
                                  height: target.naturalHeight,
                                },
                              }));
                            }}
                          />
                        </button>
                      }
                    />
                    <ImageDownloadButton
                      url={image.url}
                      baseName={`render-${image.createdAt.replaceAll(":", "-")}`}
                      title="Download rendered image"
                      ariaLabel="Download rendered image"
                      className="absolute right-2 bottom-2 shadow-md"
                    />
                  </div>
                  <div className="flex min-h-32 flex-col gap-2 p-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="secondary">{resolutionBadge(image)}</Badge>
                      <Badge variant="secondary">{sizeBadge(image, dimensions[image.id])}</Badge>
                      <Badge variant="secondary">{formatBadge(image)}</Badge>
                      {durationBadge(image) ? (
                        <Badge variant="outline">{durationBadge(image)}</Badge>
                      ) : null}
                    </div>
                    <div className="grid gap-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground text-[0.68rem] font-medium">
                          Prompt
                        </span>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Copy prompt"
                          title="Copy prompt"
                          disabled={!image.prompt}
                          onClick={() => void copyPrompt(image.prompt)}
                        >
                          <Copy />
                        </Button>
                      </div>
                      <p className="text-foreground bg-muted/35 max-h-24 overflow-y-auto rounded-md border px-2 py-1.5 text-xs leading-5 whitespace-pre-wrap">
                        {image.prompt ?? "No prompt saved"}
                      </p>
                    </div>
                    <p className="text-muted-foreground mt-auto truncate text-[0.7rem] font-medium">
                      {modelSummary(image) || "No model details"}
                    </p>
                    <time
                      dateTime={image.createdAt}
                      className="text-muted-foreground text-[0.68rem] tabular-nums"
                    >
                      {creationDateTime(image.createdAt)}
                    </time>
                  </div>
                </article>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
