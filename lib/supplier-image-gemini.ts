import "server-only";

import { z } from "zod";

import { env, type Env } from "@/lib/env";
import { cosineSimilarity, similarityPercentFromCosine } from "@/lib/image-vector-search";
import { fetchImageBuffer } from "@/lib/supplier-image-vector-match";
import {
  SUPPLIER_MATCH_GEMINI_MODEL,
  supplierImageMatchRequestSchema,
  type SupplierImageMatchRequest,
  type SupplierImageMatchResponse,
} from "@/lib/supplier-image-match";
import {
  matchSupplierImages,
  type SupplierImageMatcher,
} from "@/lib/supplier-image-vector-match";

export const GEMINI_MATCH_MODEL = SUPPLIER_MATCH_GEMINI_MODEL;

/** 20 MB mirrors the eland reference cap; Gemini accepts well under this. */
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
/** Keep embedding API calls serial-ish so we don't hammer rate limits on a
 *  100-image catalog. 4 in-flight is a safe, modest concurrency. */
const EMBED_CONCURRENCY = 4;
/** Gemini catalog images ≤100 per request (existing MAX_SUPPLIER_MATCH_CATALOG_IMAGES). */

export interface SupplierImageGeminiConfig {
  apiKey: string;
  model: string;
  /** Embedding dimension (e.g. 768). Gemini truncates excess values from the end. */
  dimensionality: number;
  /** Base API root (overridable for tests / future regional endpoints). */
  baseUrl: string;
  timeoutMs: number;
  topK: number;
  fallbackToLocal: boolean;
}

interface GeminiMatcherOptions {
  fetcher?: typeof fetch;
  config?: SupplierImageGeminiConfig | null;
  fallbackMatcher?: SupplierImageMatcher;
}

const geminiEmbedResponseSchema = z
  .object({
    embedding: z.object({ values: z.array(z.number().finite()) }).strict(),
    usageMetadata: z.record(z.unknown()).optional(),
  })
  .strict();

const geminiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.number().int().optional(),
        message: z.string().trim().min(1).max(2_000).optional(),
        status: z.string().trim().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function normalizeEnvString(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : undefined;
}

export function buildSupplierImageGeminiConfig(
  rawEnv: Pick<
    Env,
    | "GEMINI_API_KEY"
    | "GEMINI_EMBEDDING_MODEL"
    | "GEMINI_EMBEDDING_DIM"
    | "GEMINI_EMBEDDING_TIMEOUT_MS"
    | "GEMINI_MATCH_TOP_K"
    | "GEMINI_MATCH_FALLBACK_TO_LOCAL"
  >,
): SupplierImageGeminiConfig | null {
  const apiKey = normalizeEnvString(rawEnv.GEMINI_API_KEY);
  if (!apiKey) return null;
  return {
    apiKey,
    model: rawEnv.GEMINI_EMBEDDING_MODEL,
    dimensionality: rawEnv.GEMINI_EMBEDDING_DIM,
    baseUrl: "https://generativelanguage.googleapis.com",
    timeoutMs: rawEnv.GEMINI_EMBEDDING_TIMEOUT_MS,
    topK: rawEnv.GEMINI_MATCH_TOP_K,
    fallbackToLocal: rawEnv.GEMINI_MATCH_FALLBACK_TO_LOCAL,
  };
}

function getConfiguredGeminiConfig(
  config: SupplierImageGeminiConfig | null | undefined,
): SupplierImageGeminiConfig | null {
  return config === undefined ? buildSupplierImageGeminiConfig(env) : config;
}

function resolveBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function inferImageMime(source: string, fallback = "image/jpeg"): { mime: string; ext: string } {
  if (source.startsWith("data:")) {
    const match = /^data:(image\/(png|jpe?g|webp|gif));/i.exec(source);
    if (match?.[2]) {
      const ext = match[2] === "jpeg" ? "jpg" : match[2];
      return { mime: match[1], ext };
    }
    return { mime: fallback, ext: "jpg" };
  }
  const ext = (source.split(".").pop() ?? "").toLowerCase();
  if (ext === "png") return { mime: "image/png", ext: "png" };
  if (ext === "webp") return { mime: "image/webp", ext: "webp" };
  if (ext === "gif") return { mime: "image/gif", ext: "gif" };
  return { mime: fallback, ext: "jpg" };
}

function combineAbortSignals(
  left: AbortSignal | undefined,
  right: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!left) return right;
  if (!right) return left;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([left, right]);
  }
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(left.reason ?? right.reason);
  };
  if (left.aborted || right.aborted) {
    onAbort();
    return controller.signal;
  }
  left.addEventListener("abort", onAbort, { once: true });
  right.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

function describeGeminiError(status: number, payload: unknown): string {
  const parsed = geminiErrorSchema.safeParse(payload);
  const apiMessage = parsed.success ? parsed.data.error?.message : undefined;
  const statusDetail =
    apiMessage ?? `Gemini failed with HTTP ${status}.`;
  if (status === 400) {
    return `Gemini rejected the request (400): ${statusDetail}`;
  }
  if (status === 401 || status === 403) {
    return `Gemini rejected the API key (${status}). Check GEMINI_API_KEY in .env.local.`;
  }
  if (status === 429) {
    return `Gemini rate limit hit (429). Wait a moment before retrying: ${statusDetail}`;
  }
  if (status === 502 || status === 503) {
    return `Gemini embedding API is unavailable (${status}). Retry shortly: ${statusDetail}`;
  }
  return statusDetail;
}

/** Embed a single image buffer via Gemini's embedContent endpoint. The image
 *  bytes are sent as base64 inline_data; output_dimensionality truncates the
 *  returned vector to the configured length. */
async function embedImageBuffer(
  fetcher: typeof fetch,
  config: SupplierImageGeminiConfig,
  buffer: Buffer,
  mime: string,
  label: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const timeoutSignal =
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(config.timeoutMs)
      : undefined;
  const requestSignal = combineAbortSignals(signal, timeoutSignal);

  const url = new URL(
    `/v1beta/models/${config.model}:embedContent`,
    resolveBaseUrl(config.baseUrl),
  ).toString();
  const body = {
    content: {
      parts: [
        {
          inline_data: {
            mime_type: mime,
            data: buffer.toString("base64"),
          },
        },
      ],
    },
    output_dimensionality: config.dimensionality,
  };

  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": config.apiKey,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini search request timed out or was cancelled.");
    }
    const message = error instanceof Error ? error.message : `Gemini ${label} is unreachable.`;
    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (jsonError) {
    const reason = jsonError instanceof Error ? `${jsonError.name}: ${jsonError.message}` : String(jsonError);
    throw new Error(
      `Gemini returned an unreadable response for ${label} (status ${response.status}): ${reason}`,
    );
  }

  if (!response.ok) {
    throw new Error(describeGeminiError(response.status, payload));
  }

  const parsed = geminiEmbedResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Gemini returned an invalid embedding payload.");
  }
  const values = parsed.data.embedding.values;
  if (values.length === 0) throw new Error(`Gemini returned an empty embedding for ${label}.`);
  return values;
}

/** Fetch the image bytes for a catalog/query URL through the shared SSRF-safe
 *  buffer fetcher, then embed. Wraps fetch failures with the item's id. */
async function embedImageSource(
  fetcher: typeof fetch,
  config: SupplierImageGeminiConfig,
  source: string,
  label: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const buffer = await fetchImageBuffer(source, fetcher, signal);
  if (buffer.length === 0 || buffer.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`${label} image is empty or exceeds 20 MB.`);
  }
  const { mime } = inferImageMime(source);
  return embedImageBuffer(fetcher, config, buffer, mime, label, signal);
}

/** Map an array of jobs to results with a small concurrency pool, so a
 *  100-image catalog doesn't fire 100 simultaneous Gemini requests. */
async function poolMap<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | Error)[]> {
  const results: (R | Error)[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]!, index);
      } catch (error) {
        results[index] = error instanceof Error ? error : new Error(String(error));
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function callGeminiMatch(
  fetcher: typeof fetch,
  config: SupplierImageGeminiConfig,
  input: SupplierImageMatchRequest,
  signal?: AbortSignal,
): Promise<SupplierImageMatchResponse> {
  // 1) Embed the reference image.
  const referenceVector = await embedImageSource(
    fetcher,
    config,
    input.queryImage.url,
    "reference",
    signal,
  );

  // 2) Embed every catalog image with bounded concurrency. A failure on one
  //    catalog image is surfaced (not swallowed) so the user sees which image
  //    broke rather than a silently shorter ranking.
  const catalogJobs = input.catalog.map((item) => ({ item }));
  const embedded = await poolMap(catalogJobs, EMBED_CONCURRENCY, async (job) => {
    const vector = await embedImageSource(
      fetcher,
      config,
      job.item.imageUrl,
      `catalog ${job.item.catalogItemId}`,
      signal,
    );
    return { catalogItemId: job.item.catalogItemId, vector };
  });

  // Re-throw the first catalog failure (after the reference succeeded) so the
  // caller sees a clear error; matches eland's "throw on failure" posture.
  const firstFailure = embedded.find((entry): entry is Error => entry instanceof Error);
  if (firstFailure) {
    throw firstFailure;
  }

  const catalogVectors = embedded.filter(
    (entry): entry is { catalogItemId: string; vector: number[] } =>
      !(entry instanceof Error) && entry !== undefined,
  );

  // 3) Cosine-rank reference vs each catalog vector.
  const matches = catalogVectors
    .map((entry) => ({
      catalogItemId: entry.catalogItemId,
      cosine: cosineSimilarity(referenceVector, entry.vector),
      similarity: 0,
    }))
    .map((partial) => ({
      ...partial,
      similarity: similarityPercentFromCosine(partial.cosine),
    }))
    .sort((left, right) => {
      if (right.cosine !== left.cosine) return right.cosine - left.cosine;
      return left.catalogItemId.localeCompare(right.catalogItemId);
    })
    .slice(0, Math.max(1, config.topK));

  return {
    matches,
    searchedCount: catalogVectors.length,
    model: GEMINI_MATCH_MODEL,
  };
}

export function createSupplierImageGeminiMatcher({
  fetcher = fetch,
  config,
  fallbackMatcher,
}: GeminiMatcherOptions = {}): SupplierImageMatcher {
  const resolvedConfig = getConfiguredGeminiConfig(config);
  const resolveFallback: SupplierImageMatcher =
    fallbackMatcher ??
    (async (rawInput, signal) => matchSupplierImages(rawInput, signal));

  if (!resolvedConfig) {
    return async function localOnlyMatcher(rawInput, signal) {
      return resolveFallback(rawInput, signal);
    };
  }

  return async function matchSupplierImagesWithGemini(rawInput, signal) {
    const input = supplierImageMatchRequestSchema.parse(rawInput);
    try {
      return await callGeminiMatch(fetcher, resolvedConfig, input, signal);
    } catch (error) {
      if (resolvedConfig.fallbackToLocal) {
        return resolveFallback(input, signal);
      }
      throw error;
    }
  };
}

export const matchSupplierImagesWithGemini = createSupplierImageGeminiMatcher();
