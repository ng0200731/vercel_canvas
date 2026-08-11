"use client";

import { z } from "zod";

import { isLocalPostgresConfigured, isSupabaseConfigured } from "@/lib/env";
import type { ImageGenerationOutputFormat } from "@/lib/image-generation-models";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UploadResult {
  url: string;
  storagePath: string | null;
}

const MAX_DIMENSION = 1280;
const QUALITY = 0.85;
const DEFAULT_FORMAT: ImageGenerationOutputFormat = "webp";

const localUploadResponseSchema = z.object({
  url: z.string().min(1).optional(),
  storagePath: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
});

function mimeForFormat(format: ImageGenerationOutputFormat): string {
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  return "image/webp";
}

function extensionForFormat(format: ImageGenerationOutputFormat): string {
  if (format === "jpeg") return "jpg";
  return format;
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `f-${Date.now()}`;
}

/**
 * Decodes the file, scales it down to MAX_DIMENSION on its longest side, and
 * re-encodes using the selected format. Keeps localStorage (demo mode) and
 * Storage uploads small.
 */
async function fileToScaled(
  file: File,
  format: ImageGenerationOutputFormat,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const mime = mimeForFormat(format);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))),
      mime,
      QUALITY,
    );
  });
  return blob;
}

/** Data URLs are needed only in zero-storage demo mode. FileReader keeps the
 * base64 conversion asynchronous instead of blocking the UI with toDataURL. */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read the encoded image."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to create an image data URL."));
      }
    };
    reader.readAsDataURL(blob);
  });
}

async function uploadToLocalPostgres(
  blob: Blob,
  format: ImageGenerationOutputFormat,
): Promise<UploadResult> {
  const form = new FormData();
  form.append(
    "file",
    new File([blob], `upload.${extensionForFormat(format)}`, {
      type: mimeForFormat(format),
    }),
  );

  const response = await fetch("/api/uploads", {
    method: "POST",
    body: form,
  });
  const payload: unknown = await response.json().catch(() => null);
  const parsed = localUploadResponseSchema.safeParse(payload);
  if (!response.ok || !parsed.success || !parsed.data.url) {
    throw new Error(
      (parsed.success ? parsed.data.error : null) ??
        "Failed to upload image to local Postgres storage.",
    );
  }
  return { url: parsed.data.url, storagePath: parsed.data.storagePath ?? null };
}

/**
 * Uploads an image and returns a URL + storage path.
 * - Supabase configured: scaled blob -> Storage `uploads/<uid>/<id>.<ext>`, returns public URL.
 * - Local Postgres: scaled blob -> `.data/uploads` via `/api/uploads`.
 * - Browser demo mode: scaled data URL stored directly on the node.
 */
export async function uploadImage(
  file: File,
  format: ImageGenerationOutputFormat = DEFAULT_FORMAT,
): Promise<UploadResult> {
  const blob = await fileToScaled(file, format);

  if (isSupabaseConfigured) {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Sign in to upload images.");

    const path = `${user.id}/${uid()}.${extensionForFormat(format)}`;
    const { error } = await supabase.storage
      .from("uploads")
      .upload(path, blob, { contentType: mimeForFormat(format), upsert: false });
    if (error) throw new Error(error.message);

    const { data } = supabase.storage.from("uploads").getPublicUrl(path);
    return { url: data.publicUrl, storagePath: path };
  }

  if (isLocalPostgresConfigured) {
    return uploadToLocalPostgres(blob, format);
  }

  return { url: await blobToDataUrl(blob), storagePath: null };
}

/**
 * Wraps a cross-origin remote image URL so the fetch goes through the app's
 * own `/api/remote-image` proxy. Direct browser `fetch()` to third-party image
 * hosts often fails with a generic `TypeError: Failed to fetch` because the
 * host sends no CORS headers (or a browser extension rewrites the request);
 * the proxy runs server-side and avoids both. Same-origin and data: URLs are
 * untouched (they don't need the proxy).
 */
function proxiedRemoteImageUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("data:") || url.startsWith("/")) return url;
  try {
    const parsed = new URL(url);
    // Same-origin absolute URLs (e.g. the app's own served uploads) skip the proxy.
    if (parsed.origin === window.location.origin) return url;
    return `/api/remote-image?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

/** Converts a provider result (data URL or remote URL) into durable app storage. */
export async function persistGeneratedImage(
  url: string,
  format: ImageGenerationOutputFormat = DEFAULT_FORMAT,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const response = await fetch(proxiedRemoteImageUrl(url), { signal });
  if (!response.ok) throw new Error("Failed to read the generated image.");
  const blob = await response.blob();
  signal?.throwIfAborted();
  const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  return uploadImage(
    new File([blob], `generated.${extension}`, { type: blob.type || "image/png" }),
    format,
  );
}
