"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { convertAndDownloadImage, DOWNLOAD_IMAGE_FORMATS } from "@/lib/download-image";
import { cn } from "@/lib/utils";

/**
 * Download button that lets the user choose an output format (JPG / BMP / PNG / WebP).
 * Handles its own loading state and converts the image in the browser before saving.
 */
export function ImageDownloadButton({
  url,
  baseName,
  disabled,
  title = "Download image",
  ariaLabel = "Download image",
  className,
}: {
  url: string | null | undefined;
  baseName: string;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function download(format: (typeof DOWNLOAD_IMAGE_FORMATS)[number]["value"]) {
    if (!url) return;
    setBusy(true);
    try {
      await convertAndDownloadImage({ url, baseName, format });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to download this image.");
    } finally {
      setBusy(false);
    }
  }

  const trigger = (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      disabled={disabled || busy || !url}
      title={title}
      aria-label={ariaLabel}
      className={cn("bg-background/85 backdrop-blur-sm", className)}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Download />}
    </Button>
  );

  if (disabled || !url) {
    return trigger;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="end" className="min-w-28">
        {DOWNLOAD_IMAGE_FORMATS.map((format) => (
          <DropdownMenuItem
            key={format.value}
            onClick={() => void download(format.value)}
          >
            {format.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
