import "server-only";

import sharp from "sharp";

import { env } from "@/lib/env";
import {
  cosineSimilarity,
  embedRgbRaw,
  IMAGE_VECTOR_EMBED_SIZE,
  similarityPercentFromCosine,
  type ImageVector,
} from "@/lib/image-vector-search";
import {
  SUPPLIER_MATCH_MODEL,
  SUPPLIER_MATCH_LABELSTASH_MODEL,
  supplierImageMatchRequestSchema,
  type SupplierImageMatchRequest,
  type SupplierImageMatchResponse,
} from "@/lib/supplier-image-match";

const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
/** Keep catalog embeds serial-ish: multi-region sharp work is memory-heavy on Windows. */
const MAX_PARALLEL_EMBEDS = 2;
/** Cap decoded working size before region crops (final embed is only 48×48). */
const MAX_WORKING_IMAGE_SIDE = 384;

// libvips can OOM under concurrent decode/extract on large catalogs.
// Disable cache and keep a single worker so memory stays bounded.
sharp.cache(false);
sharp.concurrency(1);

export type SupplierImageMatcher = (
  input: SupplierImageMatchRequest,
  signal?: AbortSignal,
) => Promise<SupplierImageMatchResponse>;

export type ImageEmbedder = (
  source: string,
  signal?: AbortSignal,
) => Promise<ImageVector>;

interface ImageRegionVector {
  label: string;
  vector: ImageVector;
}

export type ImageRegionEmbedder = (
  source: string,
  signal?: AbortSignal,
) => Promise<readonly ImageRegionVector[]>;

interface SupplierImageVectorMatcherOptions {
  embedImage?: ImageEmbedder;
  embedImageRegions?: ImageRegionEmbedder;
  fetcher?: typeof fetch;
}

interface ImageCropRegion {
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".local")) {
    return true;
  }
  if (/^(?:127|10)\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(normalized)) return true;
  return /^(?:0\.0\.0\.0|169\.254\.169\.254)$/.test(normalized);
}

function isConfiguredLocalImageUrl(url: URL): boolean {
  const configuredOrigins = [env.NEXT_PUBLIC_APP_URL, env.NEXT_PUBLIC_SUPABASE_URL]
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value).origin);
  if (!configuredOrigins.includes(url.origin)) return false;
  return (
    url.pathname.startsWith("/api/uploads/") ||
    url.pathname.includes("/storage/v1/object/public/uploads/")
  );
}

function assertSafeRemoteImageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Supplier catalog images must use HTTP(S).");
  }
  if (isPrivateHostname(url.hostname) && !isConfiguredLocalImageUrl(url)) {
    throw new Error("A supplier catalog image points to a private network address.");
  }
  return url;
}

function bufferFromDataUrl(value: string): Buffer {
  const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match?.[2]) throw new Error("Image data URL is invalid.");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (buffer.length === 0 || buffer.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("An image is empty or exceeds 12 MB.");
  }
  return buffer;
}

async function fetchRemoteImage(
  source: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  let url = assertSafeRemoteImageUrl(source);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetcher(url, { signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) throw new Error("Image redirect could not be read.");
      url = assertSafeRemoteImageUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Image request failed with ${response.status}.`);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (
      contentType &&
      contentType !== "application/octet-stream" &&
      !/^image\/(?:png|jpe?g|webp|gif)$/i.test(contentType)
    ) {
      throw new Error("A supplier catalog URL did not return a supported image.");
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_IMAGE_BYTES) {
      throw new Error("A supplier catalog image exceeds 12 MB.");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_SOURCE_IMAGE_BYTES) {
      throw new Error("A supplier catalog image is empty or exceeds 12 MB.");
    }
    return buffer;
  }
  throw new Error("Image redirect limit exceeded.");
}

function createSharp(sourceBuffer: Buffer) {
  return sharp(sourceBuffer, {
    animated: false,
    // Guard against pathological inputs; catalog images are product photos.
    limitInputPixels: 64_000_000,
    sequentialRead: true,
  });
}

export async function embedImageSource(
  source: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ImageVector> {
  signal?.throwIfAborted();
  const sourceBuffer = source.startsWith("data:")
    ? bufferFromDataUrl(source)
    : await fetchRemoteImage(source, fetcher, signal);

  const { data, info } = await createSharp(sourceBuffer)
    .rotate()
    .resize(IMAGE_VECTOR_EMBED_SIZE, IMAGE_VECTOR_EMBED_SIZE, {
      fit: "fill",
      withoutEnlargement: false,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  signal?.throwIfAborted();
  if (info.channels < 3) {
    throw new Error("Image embedding requires an RGB image.");
  }
  return embedRgbRaw(data, IMAGE_VECTOR_EMBED_SIZE);
}

/** Fetch a query/catalog image URL (http/https or data URL) into a Buffer.
 *  Reuses the SSRF-safe remote fetcher, so it enforces the same private-host
 *  guards as the local embedding path. Exposed for sidecars/matchers that need
 *  the raw image bytes (e.g. the eland multipart `image` field). */
export async function fetchImageBuffer(
  source: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  return source.startsWith("data:") ? bufferFromDataUrl(source) : fetchRemoteImage(source, fetcher, signal);
}

function boundedCrop(
  label: string,
  leftRatio: number,
  topRatio: number,
  widthRatio: number,
  heightRatio: number,
  imageWidth: number,
  imageHeight: number,
): ImageCropRegion {
  const width = Math.max(1, Math.round(imageWidth * widthRatio));
  const height = Math.max(1, Math.round(imageHeight * heightRatio));
  const maxLeft = Math.max(0, imageWidth - width);
  const maxTop = Math.max(0, imageHeight - height);
  return {
    label,
    left: Math.min(maxLeft, Math.max(0, Math.round(imageWidth * leftRatio))),
    top: Math.min(maxTop, Math.max(0, Math.round(imageHeight * topRatio))),
    width,
    height,
  };
}

function buildImageCropRegions(imageWidth: number, imageHeight: number): ImageCropRegion[] {
  return [
    boundedCrop("full", 0, 0, 1, 1, imageWidth, imageHeight),
    boundedCrop("center", 0.15, 0.15, 0.7, 0.7, imageWidth, imageHeight),
    boundedCrop("horizontal-top", 0, 0, 1, 0.45, imageWidth, imageHeight),
    boundedCrop("horizontal-middle", 0, 0.275, 1, 0.45, imageWidth, imageHeight),
    boundedCrop("horizontal-bottom", 0, 0.55, 1, 0.45, imageWidth, imageHeight),
    boundedCrop("vertical-left", 0, 0, 0.45, 1, imageWidth, imageHeight),
    boundedCrop("vertical-middle", 0.275, 0, 0.45, 1, imageWidth, imageHeight),
    boundedCrop("vertical-right", 0.55, 0, 0.45, 1, imageWidth, imageHeight),
  ];
}

async function embedImageBufferRegion(
  workingBuffer: Buffer,
  region: ImageCropRegion,
  signal: AbortSignal | undefined,
): Promise<ImageRegionVector> {
  const { data, info } = await createSharp(workingBuffer)
    .extract({
      left: region.left,
      top: region.top,
      width: region.width,
      height: region.height,
    })
    .resize(IMAGE_VECTOR_EMBED_SIZE, IMAGE_VECTOR_EMBED_SIZE, {
      fit: "fill",
      withoutEnlargement: false,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  signal?.throwIfAborted();
  if (info.channels < 3) {
    throw new Error("Image embedding requires an RGB image.");
  }
  return { label: region.label, vector: embedRgbRaw(data, IMAGE_VECTOR_EMBED_SIZE) };
}

/**
 * Decode once, downscale to a working size, then crop regions sequentially.
 * Avoids re-decoding the full original for every region (libvips OOM trigger).
 */
export async function embedImageSourceRegions(
  source: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<readonly ImageRegionVector[]> {
  signal?.throwIfAborted();
  const sourceBuffer = source.startsWith("data:")
    ? bufferFromDataUrl(source)
    : await fetchRemoteImage(source, fetcher, signal);

  const rotated = createSharp(sourceBuffer).rotate();
  const metadata = await rotated.metadata();
  const originalWidth = metadata.width;
  const originalHeight = metadata.height;
  if (!originalWidth || !originalHeight) throw new Error("Image dimensions could not be read.");

  const longest = Math.max(originalWidth, originalHeight);
  const scale = longest > MAX_WORKING_IMAGE_SIDE ? MAX_WORKING_IMAGE_SIDE / longest : 1;
  const workWidth = Math.max(1, Math.round(originalWidth * scale));
  const workHeight = Math.max(1, Math.round(originalHeight * scale));

  // Single decode + optional downscale; regions extract from this smaller buffer.
  const workingBuffer = await createSharp(sourceBuffer)
    .rotate()
    .resize(workWidth, workHeight, {
      fit: "fill",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .png()
    .toBuffer();

  signal?.throwIfAborted();
  const regions = buildImageCropRegions(workWidth, workHeight);
  // Sequential: peak memory stays near one decode + one crop, not 8× concurrent.
  const embedded: ImageRegionVector[] = [];
  for (const region of regions) {
    signal?.throwIfAborted();
    embedded.push(await embedImageBufferRegion(workingBuffer, region, signal));
  }
  return embedded;
}

async function mapWithConcurrency<T, Result>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

/**
 * Embed the query + selected-supplier catalog, insert into an in-memory vector
 * collection, then rank by cosine similarity (highest first).
 */
export async function runSupplierImageVectorSearch(
  input: SupplierImageMatchRequest,
  embedImage: ImageEmbedder,
  signal?: AbortSignal,
  embedImageRegions?: ImageRegionEmbedder,
): Promise<SupplierImageMatchResponse> {
  const queryVector = await embedImage(input.queryImage.url, signal);
  const catalogVectors = await mapWithConcurrency(
    input.catalog,
    MAX_PARALLEL_EMBEDS,
    async (item) => {
      const regions = embedImageRegions
        ? await embedImageRegions(item.imageUrl, signal)
        : [{ label: "full", vector: await embedImage(item.imageUrl, signal) }];
      return { item, regions };
    },
  );

  if (catalogVectors.length === 0) {
    throw new Error("No supplier catalog images could be indexed for search.");
  }
  const hits = catalogVectors.map((entry) => {
    const bestRegion = entry.regions.reduce<ImageRegionVector | null>((best, region) => {
      if (region.vector.length !== queryVector.length) {
        throw new Error("Embedding dimensions do not match.");
      }
      if (!best) return region;
      return cosineSimilarity(queryVector, region.vector) >
        cosineSimilarity(queryVector, best.vector)
        ? region
        : best;
    }, null);
    if (!bestRegion) throw new Error("A supplier catalog image could not be embedded.");
    const cosine = cosineSimilarity(queryVector, bestRegion.vector);
    return {
      id: entry.item.catalogItemId,
      cosine,
      similarity: similarityPercentFromCosine(cosine),
    };
  });

  return {
    matches: hits
      .sort((left, right) => {
        if (right.cosine !== left.cosine) return right.cosine - left.cosine;
        return left.id.localeCompare(right.id);
      })
      .map((hit) => ({
      catalogItemId: hit.id,
      similarity: hit.similarity,
      cosine: hit.cosine,
    })),
    searchedCount: input.catalog.length,
    model: input.engine === "labelstash" ? SUPPLIER_MATCH_LABELSTASH_MODEL : SUPPLIER_MATCH_MODEL,
  };
}

export function createSupplierImageVectorMatcher({
  embedImage,
  embedImageRegions,
  fetcher = fetch,
}: SupplierImageVectorMatcherOptions = {}): SupplierImageMatcher {
  const resolveEmbed: ImageEmbedder =
    embedImage ?? ((source, signal) => embedImageSource(source, fetcher, signal));
  const resolveRegionEmbed: ImageRegionEmbedder | undefined =
    embedImageRegions ??
    (embedImage ? undefined : (source, signal) => embedImageSourceRegions(source, fetcher, signal));

  return async function matchSupplierImages(rawInput, signal) {
    const input = supplierImageMatchRequestSchema.parse(rawInput);
    return runSupplierImageVectorSearch(input, resolveEmbed, signal, resolveRegionEmbed);
  };
}

export const matchSupplierImages = createSupplierImageVectorMatcher();
