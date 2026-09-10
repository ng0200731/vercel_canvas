"use client";

export type DownloadImageFormat = "jpg" | "bmp" | "png" | "webp";

export interface DownloadFormatOption {
  value: DownloadImageFormat;
  label: string;
  mime: string;
  ext: string;
}

export const DOWNLOAD_IMAGE_FORMATS: DownloadFormatOption[] = [
  { value: "jpg", label: "JPG", mime: "image/jpeg", ext: "jpg" },
  { value: "bmp", label: "BMP", mime: "image/bmp", ext: "bmp" },
  { value: "png", label: "PNG", mime: "image/png", ext: "png" },
  { value: "webp", label: "WebP", mime: "image/webp", ext: "webp" },
];

// ── Existing filename-style download (no re-encode) ──────────────────────────

function extensionFromMimeType(mimeType: string | null): string | null {
  if (!mimeType) return null;
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  return null;
}

function extensionFromFormat(format: string | null | undefined): string | null {
  if (!format) return null;
  if (format === "jpeg") return "jpg";
  if (format === "png" || format === "webp" || format === "jpg") return format;
  return null;
}

export async function downloadImageFile({
  url,
  baseName,
  outputFormat,
}: {
  url: string;
  baseName: string;
  outputFormat?: string | null;
}): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to download this image.");

  const blob = await response.blob();
  const extension =
    extensionFromFormat(outputFormat) ??
    extensionFromMimeType(blob.type) ??
    extensionFromMimeType(response.headers.get("content-type")) ??
    "png";

  triggerDownload(blob, `${baseName}.${extension}`);
}

// ── Format-converting download (JPG / PNG / WebP / BMP) ──────────────────────

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to download this image.");
  return response.blob();
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to decode this image."));
    };
    img.src = objectUrl;
  });
}

/**
 * Encode RGBA ImageData as a 32-bit bottom-up BGRA BMP (BITMAPINFOHEADER).
 * Browsers cannot produce BMP via canvas.toBlob, so we write the file ourselves.
 */
export function encodeBmp(imageData: ImageData): Blob {
  const { width: w, height: h, data } = imageData;
  const rowSize = w * 4; // 32bpp rows are already 4-byte aligned.
  const pixelArraySize = rowSize * h;
  const fileSize = 54 + pixelArraySize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // BITMAPFILEHEADER
  bytes[0] = 0x42; // 'B'
  bytes[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true); // reserved
  view.setUint32(10, 54, true); // pixel data offset

  // BITMAPINFOHEADER
  view.setUint32(14, 40, true); // header size
  view.setInt32(18, w, true);
  view.setInt32(22, h, true); // positive height = bottom-up
  view.setUint16(26, 1, true); // planes
  view.setUint16(28, 32, true); // bits per pixel
  view.setUint32(30, 0, true); // BI_RGB
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true); // ~72 DPI horizontal
  view.setInt32(42, 2835, true); // ~72 DPI vertical
  view.setUint32(46, 0, true); // colors used
  view.setUint32(50, 0, true); // important colors

  let offset = 54;
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * rowSize; // flip to bottom-up
    for (let x = 0; x < w; x++) {
      const si = srcRow + x * 4;
      bytes[offset] = data[si + 2]; // B
      bytes[offset + 1] = data[si + 1]; // G
      bytes[offset + 2] = data[si]; // R
      bytes[offset + 3] = data[si + 3]; // A
      offset += 4;
    }
  }

  return new Blob([buffer], { type: "image/bmp" });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Conversion failed."))), mime);
  });
}

/**
 * Fetch, convert, and download an image as the requested format.
 * Loading via a blob object-URL keeps the canvas untainted, so pixel reads
 * (needed for BMP/PNG alpha) work for cross-origin images too.
 */
export async function convertAndDownloadImage({
  url,
  baseName,
  format,
}: {
  url: string;
  baseName: string;
  format: DownloadImageFormat;
}): Promise<void> {
  const sourceBlob = await fetchBlob(url);
  const img = await loadImageFromBlob(sourceBlob);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1;
  canvas.height = img.naturalHeight || 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to convert this image.");

  // JPEG has no alpha channel — paint white so transparency doesn't turn black.
  if (format === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);

  let out: Blob;
  if (format === "bmp") {
    out = encodeBmp(ctx.getImageData(0, 0, canvas.width, canvas.height));
  } else {
    const mime = DOWNLOAD_IMAGE_FORMATS.find((f) => f.value === format)?.mime ?? "image/png";
    out = await canvasToBlob(canvas, mime);
  }

  triggerDownload(out, `${baseName}.${format}`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}