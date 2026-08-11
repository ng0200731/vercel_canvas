import "server-only";

import { z } from "zod";

import { env, type Env } from "@/lib/env";
import { fetchImageBuffer } from "@/lib/supplier-image-vector-match";
import {
  SUPPLIER_MATCH_ELAND_MODEL,
  supplierImageMatchRequestSchema,
  type SupplierImageMatchRequest,
  type SupplierImageMatchResponse,
} from "@/lib/supplier-image-match";

export const ELAND_MATCH_MODEL = SUPPLIER_MATCH_ELAND_MODEL;

/** 8 MB is the practical max the portal accepts for a reference image; the
 *  PDF recommends "well under 20 MB" and the same images you uploaded. */
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;

export interface SupplierImageElandConfig {
  apiKey: string;
  baseUrl: string;
  /** Portal upload link prefix, e.g. "https://the-eland.co". */
  portalUploadUrl: string;
  timeoutMs: number;
  topK: number;
}

interface ElandMatcherOptions {
  fetcher?: typeof fetch;
  config?: SupplierImageElandConfig | null;
}

/** the-eland.co returns score in any numeric range (relative ranking signal),
 *  higher = more similar. We surface it undistorted via `cosine` (so the dialog
 *  can rank by it) and map it to a 0–100 `similarity` for the % meter. */
const elandResultSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
    name: z.string().trim().min(1).max(300),
    description: z.string().trim().max(2_000).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).nullable().optional(),
    /* score is a relative ranking signal, unbounded; leave it numeric. */
    score: z.number().finite(),
    imageUrl: z.string().trim().max(2_000).nullable(),
    thumbnailUrl: z.string().trim().max(2_000).nullable(),
  })
  .strict();

const elandSearchResponseSchema = z
  .object({
    top_k: z.number().int().min(0).max(20).optional(),
    results: z.array(elandResultSchema).max(100),
  })
  .strict();

const elandErrorSchema = z.object({ error: z.string().trim().min(1).max(1_000) }).strict();

function normalizeEnvString(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : undefined;
}

export function buildSupplierImageElandConfig(
  rawEnv: Pick<
    Env,
    "ELAND_PORTAL_API_KEY" | "ELAND_PORTAL_BASE_URL" | "ELAND_PORTAL_TIMEOUT_MS" | "ELAND_PORTAL_TOP_K"
  >,
): SupplierImageElandConfig | null {
  const apiKey = normalizeEnvString(rawEnv.ELAND_PORTAL_API_KEY);
  if (!apiKey) return null;
  const baseUrl = normalizeEnvString(rawEnv.ELAND_PORTAL_BASE_URL) ?? "https://the-eland.co";
  return {
    apiKey,
    baseUrl,
    portalUploadUrl: baseUrl,
    timeoutMs: rawEnv.ELAND_PORTAL_TIMEOUT_MS,
    topK: rawEnv.ELAND_PORTAL_TOP_K,
  };
}

function getConfiguredElandConfig(
  config: SupplierImageElandConfig | null | undefined,
): SupplierImageElandConfig | null {
  return config === undefined ? buildSupplierImageElandConfig(env) : config;
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
  return { mime: "image/jpeg", ext: "jpg" };
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

function scoreToSimilarityPercent(score: number): number {
  // eland's `score` is an unbounded relative ranking signal. Cosine-like
  // values cluster in ~[0, 1]; coerce negatives to 0 and cap at 1 before
  // converting to a 0–100 %, so the dialog's SimilarityMeter reads sensibly.
  const clamped = Math.max(0, Math.min(1, score));
  return Math.round(clamped * 10_000) / 100;
}

async function callElandSearch(
  fetcher: typeof fetch,
  config: SupplierImageElandConfig,
  input: SupplierImageMatchRequest,
  signal?: AbortSignal,
): Promise<SupplierImageMatchResponse> {
  const timeoutSignal =
    typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(config.timeoutMs)
      : undefined;
  const requestSignal = combineAbortSignals(signal, timeoutSignal);

  // Fetch the reference image bytes through the SSRF-safe buffer fetcher.
  // The API wants a file (multipart), not a URL.
  const referenceBuffer = await fetchImageBuffer(input.queryImage.url, fetcher, signal);
  if (referenceBuffer.length === 0 || referenceBuffer.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("The reference image is empty or exceeds 20 MB.");
  }
  const { mime, ext } = inferImageMime(input.queryImage.url);

  const form = new FormData();
  const imageFile = new File([new Uint8Array(referenceBuffer)], `reference.${ext}`, { type: mime });
  form.append("image", imageFile);
  const query = input.query?.trim();
  if (query) form.append("query", query);
  // top_k is clamped server-side to 1–10; ask for the configured maximum.
  form.append("top_k", String(Math.max(1, Math.min(10, config.topK))));

  let response: Response;
  try {
    response = await fetcher(new URL("/api/portal/v1/search", resolveBaseUrl(config.baseUrl)), {
      method: "POST",
      // Do NOT set Content-Type — fetch adds the multipart boundary itself.
      headers: { "X-API-Key": config.apiKey, Accept: "application/json" },
      body: form,
      signal: requestSignal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("the-eland.co search request timed out or was cancelled.");
    }
    const message = error instanceof Error ? error.message : "the-eland.co is unreachable.";
    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("the-eland.co returned an unreadable response.");
  }

  if (!response.ok) {
    const parsed = elandErrorSchema.safeParse(payload);
    const detail = parsed.success ? parsed.data.error : `the-eland.co failed with ${response.status}.`;
    if (response.status === 401) {
      throw new Error(
        "the-eland.co rejected the API key (401). Check ELAND_PORTAL_API_KEY and that the key is still Active at /portal/keys.",
      );
    }
    // 429 already consumed budget — surface Retry-After so the caller waits.
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new Error(
        `the-eland.co rate limit hit (429). Wait ${retryAfter ?? "a few"} seconds before retrying: ${detail}`,
      );
    }
    if (response.status === 400) {
      throw new Error(`the-eland.co rejected the request (400): ${detail}`);
    }
    if (response.status === 502 || response.status === 503) {
      throw new Error(`the-eland.co search is unavailable (${response.status}). Retry shortly: ${detail}`);
    }
    throw new Error(detail);
  }

  const parsed = elandSearchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("the-eland.co returned an invalid search payload.");
  }

  const matches = parsed.data.results
    .map((result) => ({
      // eland returns its own opaque ids; re-use them as catalogItemId so each
      // card has a stable key. The dialog renders eland's own image metadata
      // (remote*) instead of joining the local gallery, so no local match is
      // expected.
      catalogItemId: result.id,
      similarity: scoreToSimilarityPercent(result.score),
      cosine: Math.max(-1, Math.min(1, result.score)),
      remoteName: result.name,
      remoteImageUrl: result.imageUrl ?? null,
      remoteThumbnailUrl: result.thumbnailUrl ?? null,
      remoteDescription: result.description ?? null,
      remoteTags: result.tags ?? undefined,
      remoteId: result.id,
    }))
    .sort((left, right) => {
      if (right.cosine !== left.cosine) return right.cosine - left.cosine;
      return left.catalogItemId.localeCompare(right.catalogItemId);
    });

  return {
    matches,
    searchedCount: parsed.data.top_k ?? matches.length,
    model: ELAND_MATCH_MODEL,
    portalUploadUrl: config.portalUploadUrl,
  };
}

export function createSupplierImageElandMatcher({
  fetcher = fetch,
  config,
}: ElandMatcherOptions = {}): (
  input: SupplierImageMatchRequest,
  signal?: AbortSignal,
) => Promise<SupplierImageMatchResponse> {
  const resolvedConfig = getConfiguredElandConfig(config);

  return async function matchSupplierImagesWithEland(rawInput, signal) {
    const input = supplierImageMatchRequestSchema.parse(rawInput);
    if (!resolvedConfig) {
      throw new Error(
        "the-eland.co is not configured. Set ELAND_PORTAL_API_KEY in .env.local (create a key at https://the-eland.co/portal/keys).",
      );
    }
    return callElandSearch(fetcher, resolvedConfig, input, signal);
  };
}

export const matchSupplierImagesWithEland = createSupplierImageElandMatcher();
