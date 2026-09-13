import "server-only";

import { z } from "zod";

import { env, type Env } from "@/lib/env";
import { cosineSimilarity, similarityPercentFromCosine } from "@/lib/image-vector-search";
import { fetchImageBuffer } from "@/lib/supplier-image-vector-match";
import {
  SUPPLIER_MATCH_GEMINI_CAPTION_MODEL,
  supplierImageMatchRequestSchema,
  type SupplierImageMatchRequest,
  type SupplierImageMatchResponse,
} from "@/lib/supplier-image-match";
import {
  matchSupplierImages,
  type SupplierImageMatcher,
} from "@/lib/supplier-image-vector-match";

export const GEMINI_CAPTION_MATCH_MODEL = SUPPLIER_MATCH_GEMINI_CAPTION_MODEL;

/** 20 MB mirrors the reference cap used by the multimodal Gemini matcher. */
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
/** Each image takes two Gemini calls (vision caption + text embed), so keep
 *  concurrency modest to respect rate limits on a 100-image catalog. */
const EMBED_CONCURRENCY = 3;
/** Cap the caption we embed so a verbose model response can't balloon the
 *  request body or the stored embedding source. */
const MAX_CAPTION_CHARS = 2_000;
/** Captioning a product photo for similarity search is a benign task, but
 *  Gemini's default safety filters can reject a normal image (e.g. skin tone
 *  in a fashion photo tripping a threshold), which surfaces as an empty
 *  caption. Loosen all four filters for this description-only call so the model
 *  actually returns a caption instead of a silent block. */
const CAPTION_SAFETY_SETTINGS: ReadonlyArray<{ category: string; threshold: string }> = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

export interface SupplierImageGeminiCaptionConfig {
  apiKey: string;
  /** Vision model that turns an image into a text caption (e.g. gemini-2.5-flash). */
  visionModel: string;
  /** Embedding model that embeds the caption text (e.g. gemini-embedding-001). */
  embeddingModel: string;
  /** Embedding dimension; Gemini truncates excess values from the end. */
  dimensionality: number;
  /** Base API root (overridable for tests / future regional endpoints). */
  baseUrl: string;
  timeoutMs: number;
  topK: number;
  /** Minimum cosine similarity [-1, 1] for a catalog image to be surfaced. */
  minCosine: number;
  fallbackToLocal: boolean;
}

interface GeminiCaptionMatcherOptions {
  fetcher?: typeof fetch;
  config?: SupplierImageGeminiCaptionConfig | null;
  fallbackMatcher?: SupplierImageMatcher;
  /** Per-request live override for `minCosine` — same seam as the multimodal
   *  Gemini matcher: a UI-persisted setting can take effect without a restart. */
  resolveMinCosine?: () => Promise<number | null>;
}

const geminiGenerateResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z.object({
              parts: z.array(z.object({ text: z.string().optional() })),
            }),
            finishReason: z.string().optional(),
          })
          .passthrough(),
      )
      .min(0)
      .optional(),
    promptFeedback: z
      .object({
        blockReason: z.string().optional(),
        blockReasonMessage: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const geminiEmbedResponseSchema = z
  .object({
    embedding: z.object({ values: z.array(z.number().finite()) }).passthrough(),
    usageMetadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

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

export function buildSupplierImageGeminiCaptionConfig(
  rawEnv: Pick<
    Env,
    | "GEMINI_API_KEY"
    | "GEMINI_CAPTION_VISION_MODEL"
    | "GEMINI_CAPTION_EMBEDDING_MODEL"
    | "GEMINI_EMBEDDING_DIM"
    | "GEMINI_EMBEDDING_TIMEOUT_MS"
    | "GEMINI_MATCH_TOP_K"
    | "GEMINI_MATCH_MIN_COSINE"
    | "GEMINI_MATCH_FALLBACK_TO_LOCAL"
  >,
): SupplierImageGeminiCaptionConfig | null {
  const apiKey = normalizeEnvString(rawEnv.GEMINI_API_KEY);
  if (!apiKey) return null;
  return {
    apiKey,
    visionModel: rawEnv.GEMINI_CAPTION_VISION_MODEL,
    embeddingModel: rawEnv.GEMINI_CAPTION_EMBEDDING_MODEL,
    dimensionality: rawEnv.GEMINI_EMBEDDING_DIM,
    baseUrl: "https://generativelanguage.googleapis.com",
    timeoutMs: rawEnv.GEMINI_EMBEDDING_TIMEOUT_MS,
    topK: rawEnv.GEMINI_MATCH_TOP_K,
    minCosine: rawEnv.GEMINI_MATCH_MIN_COSINE,
    fallbackToLocal: rawEnv.GEMINI_MATCH_FALLBACK_TO_LOCAL,
  };
}

function getConfiguredGeminiCaptionConfig(
  config: SupplierImageGeminiCaptionConfig | null | undefined,
): SupplierImageGeminiCaptionConfig | null {
  return config === undefined ? buildSupplierImageGeminiCaptionConfig(env) : config;
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

function describeGeminiCaptionError(status: number, payload: unknown): string {
  const parsed = geminiErrorSchema.safeParse(payload);
  const apiMessage = parsed.success ? parsed.data.error?.message : undefined;
  const statusDetail = apiMessage ?? `Gemini failed with HTTP ${status}.`;
  // Google blocks Gemini by geographic region (enforced on the request IP),
  // *after* the key authenticates — so a valid key still 400s with this message.
  // This is not a key or model problem; the fix is to reach the API from a
  // supported region (VPN / hosting), per docs/GEMINI_IMAGE_SEARCH_API.md §2.5.
  if (/user location is not supported/i.test(statusDetail)) {
    return "Google blocked this request because of your network location — the Gemini API is region-restricted (this is not a key or model problem). Connect from a supported region (e.g. VPN or a supported-region host) and retry. See docs/GEMINI_IMAGE_SEARCH_API.md §2.5.";
  }
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
    return `Gemini caption API is unavailable (${status}). Retry shortly: ${statusDetail}`;
  }
  return statusDetail;
}

/** Turn a single image buffer into a text caption via the Gemini vision model.
 *  The bytes travel as base64 inline_data; responseModalities TEXT keeps the
 *  reply to text only. */
async function captionImageBuffer(
  fetcher: typeof fetch,
  config: SupplierImageGeminiCaptionConfig,
  buffer: Buffer,
  mime: string,
  label: string,
  signal?: AbortSignal,
): Promise<string> {
  const timeoutSignal =
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(config.timeoutMs)
      : undefined;
  const requestSignal = combineAbortSignals(signal, timeoutSignal);

  const url = new URL(
    `/v1beta/models/${config.visionModel}:generateContent`,
    resolveBaseUrl(config.baseUrl),
  ).toString();
  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mime,
              data: buffer.toString("base64"),
            },
          },
          {
            text: "Describe this image for visual similarity search. Include main subjects, colors, composition, setting, style, and distinctive details. One concise paragraph, no speculation.",
          },
        ],
      },
    ],
    generationConfig: { responseModalities: ["TEXT"] },
    safetySettings: CAPTION_SAFETY_SETTINGS,
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
      throw new Error("Gemini caption search request timed out or was cancelled.");
    }
    const message = error instanceof Error ? error.message : `Gemini captioning ${label} failed.`;
    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (jsonError) {
    const reason =
      jsonError instanceof Error ? `${jsonError.name}: ${jsonError.message}` : String(jsonError);
    throw new Error(
      `Gemini returned an unreadable response for ${label} (status ${response.status}): ${reason}`,
    );
  }

  if (!response.ok) {
    throw new Error(describeGeminiCaptionError(response.status, payload));
  }

  const parsed = geminiGenerateResponseSchema.safeParse(payload);
  const parts = parsed.success ? parsed.data.candidates?.[0]?.content.parts ?? [] : [];
  const caption = parts
    .map((part) => part.text ?? "")
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join("\n");
  if (!caption) {
    // A 200 with no text is almost always a safety block or a non-STOP finish
    // reason (not an auth/model failure). Surface the exact reason so the
    // dialog can tell the user why instead of a vague "wrote no caption".
    const blockReason = parsed.success
      ? (parsed.data.promptFeedback?.blockReason ?? "NONE")
      : "UNPARSEABLE";
    const blockMessage = parsed.success ? parsed.data.promptFeedback?.blockReasonMessage : undefined;
    const finishReason = parsed.success ? parsed.data.candidates?.[0]?.finishReason : undefined;
    const detail = blockMessage?.trim() || blockReason;
    throw new Error(
      `Gemini wrote no caption for ${label}.${finishReason ? ` finishReason=${finishReason}` : ""}${blockReason !== "NONE" ? ` blocked=${blockReason}: ${detail}` : " Response had no text content."}`,
    );
  }
  return caption.slice(0, MAX_CAPTION_CHARS);
}

/** Embed a caption string via Gemini's embedContent text endpoint. taskType
 *  tunes retrieval: RETRIEVAL_DOCUMENT for the catalog, RETRIEVAL_QUERY for the
 *  reference (matching the same-law pipeline in docs/GEMINI_IMAGE_SEARCH_API.md). */
async function embedCaptionText(
  fetcher: typeof fetch,
  config: SupplierImageGeminiCaptionConfig,
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  label: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const timeoutSignal =
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(config.timeoutMs)
      : undefined;
  const requestSignal = combineAbortSignals(signal, timeoutSignal);

  const url = new URL(
    `/v1beta/models/${config.embeddingModel}:embedContent`,
    resolveBaseUrl(config.baseUrl),
  ).toString();
  const body = {
    content: { parts: [{ text }] },
    taskType,
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
      throw new Error("Gemini caption search request timed out or was cancelled.");
    }
    const message = error instanceof Error ? error.message : `Gemini ${label} is unreachable.`;
    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (jsonError) {
    const reason =
      jsonError instanceof Error ? `${jsonError.name}: ${jsonError.message}` : String(jsonError);
    throw new Error(
      `Gemini returned an unreadable response for ${label} (status ${response.status}): ${reason}`,
    );
  }

  if (!response.ok) {
    throw new Error(describeGeminiCaptionError(response.status, payload));
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
 *  buffer fetcher, then caption + embed the caption. Wraps failures with the
 *  item's id. */
async function captionAndEmbedSource(
  fetcher: typeof fetch,
  config: SupplierImageGeminiCaptionConfig,
  source: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  label: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const buffer = await fetchImageBuffer(source, fetcher, signal);
  if (buffer.length === 0 || buffer.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`${label} image is empty or exceeds 20 MB.`);
  }
  const { mime } = inferImageMime(source);
  const caption = await captionImageBuffer(fetcher, config, buffer, mime, label, signal);
  return embedCaptionText(fetcher, config, caption, taskType, label, signal);
}

/** Map an array of jobs to results with a small concurrency pool, so a
 *  100-image catalog doesn't fire hundreds of simultaneous Gemini calls. */
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

async function callGeminiCaptionMatch(
  fetcher: typeof fetch,
  config: SupplierImageGeminiCaptionConfig,
  input: SupplierImageMatchRequest,
  signal?: AbortSignal,
): Promise<SupplierImageMatchResponse> {
  // 1) Caption + embed the reference image (retrieval query).
  const referenceVector = await captionAndEmbedSource(
    fetcher,
    config,
    input.queryImage.url,
    "RETRIEVAL_QUERY",
    "reference",
    signal,
  );

  // 2) Caption + embed every catalog image (retrieval document) with bounded
  //    concurrency. A failure on one catalog image is surfaced (not swallowed)
  //    so the user sees which image broke rather than a shorter ranking.
  const catalogJobs = input.catalog.map((catalogItem) => ({ item: catalogItem }));
  const embedded = await poolMap(catalogJobs, EMBED_CONCURRENCY, async (job) => {
    const vector = await captionAndEmbedSource(
      fetcher,
      config,
      job.item.imageUrl,
      "RETRIEVAL_DOCUMENT",
      `catalog ${job.item.catalogItemId}`,
      signal,
    );
    return { catalogItemId: job.item.catalogItemId, vector };
  });

  const firstFailure = embedded.find((entry): entry is Error => entry instanceof Error);
  if (firstFailure) {
    throw firstFailure;
  }

  const catalogVectors = embedded.filter(
    (entry): entry is { catalogItemId: string; vector: number[] } =>
      !(entry instanceof Error) && entry !== undefined,
  );

  // 3) Cosine-rank the reference caption vector against each catalog caption
  //    vector; drop below minCosine, top-K, sort by cosine descending.
  const matches = catalogVectors
    .map((entry) => ({
      catalogItemId: entry.catalogItemId,
      cosine: cosineSimilarity(referenceVector, entry.vector),
      similarity: 0,
    }))
    .filter((entry) => entry.cosine >= config.minCosine)
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
    model: GEMINI_CAPTION_MATCH_MODEL,
  };
}

export function createSupplierImageGeminiCaptionMatcher({
  fetcher = fetch,
  config,
  fallbackMatcher,
  resolveMinCosine,
}: GeminiCaptionMatcherOptions = {}): SupplierImageMatcher {
  const resolvedConfig = getConfiguredGeminiCaptionConfig(config);
  const resolveFallback: SupplierImageMatcher =
    fallbackMatcher ?? (async (rawInput, signal) => matchSupplierImages(rawInput, signal));

  if (!resolvedConfig) {
    return async function localOnlyMatcher(rawInput, signal) {
      return resolveFallback(rawInput, signal);
    };
  }

  return async function matchSupplierImagesWithGeminiCaption(rawInput, signal) {
    const input = supplierImageMatchRequestSchema.parse(rawInput);
    let effectiveConfig = resolvedConfig;
    if (resolveMinCosine) {
      try {
        const override = await resolveMinCosine();
        if (override != null && Number.isFinite(override)) {
          effectiveConfig = { ...resolvedConfig, minCosine: override };
        }
      } catch {
        // A missing/unreachable DB must never fail the search; fall back to env.
      }
    }
    try {
      return await callGeminiCaptionMatch(fetcher, effectiveConfig, input, signal);
    } catch (error) {
      if (effectiveConfig.fallbackToLocal) {
        return resolveFallback(input, signal);
      }
      throw error;
    }
  };
}

export const matchSupplierImagesWithGeminiCaption = createSupplierImageGeminiCaptionMatcher();