# Google Gemini Reverse Image Search

A self-contained, copy-paste-ready integration for reverse-image search using
**Google Gemini's multi-modal image embedding API** (`gemini-embedding-2`).
Embed a reference image and a catalog of images, then cosine-rank them in
process — **no Python sidecar, no external catalog, no LLM**.

Use this doc to port the feature into another web app.

---

## 1. How it works

1. Upload a **reference image** (the thing you're searching *for*).
2. Collect a **catalog** of candidate images (the things you're searching *through*).
3. Call Gemini's `embedContent` endpoint for the reference + every catalog image.
4. Compute **cosine similarity** between the reference vector and each catalog vector.
5. Drop anything below `minCosine`, sort high→low, slice to `topK`.

Everything is server-side. The API key never reaches the browser.

---

## 2. Get an API key

- Go to **https://aistudio.google.com/app/apikey** → *Get API key*.
- This is a **server-only** key. Never prefix the env var with `NEXT_PUBLIC_`.

> **Key for this project** (from `.env.local`, keep server-only / out of git):
> ```
> GEMINI_API_KEY=your-gemini-api-key
> ```

---

## 3. Environment variables

```bash
# Google Gemini image-embedding search (optional, server-only)
GEMINI_API_KEY=                 # required to enable the feature
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
GEMINI_EMBEDDING_DIM=768
GEMINI_EMBEDDING_TIMEOUT_MS=60000
GEMINI_MATCH_TOP_K=12
# Min cosine [-1,1] to surface a result. 0 = keep everything.
# Gemini product photos cluster in 0.55-1.0; 0.80 hides weak near-misses.
GEMINI_MATCH_MIN_COSINE=0
# On API failure, fall back to a local matcher (you must supply one).
GEMINI_MATCH_FALLBACK_TO_LOCAL=false
```

---

## 4. The core client

Drop this into `lib/gemini-image-search.ts` (or equivalent).

```ts
import "server-only";

const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const EMBED_CONCURRENCY = 4;

export interface GeminiImageSearchConfig {
  apiKey: string;
  model: string;          // e.g. "gemini-embedding-2"
  dimensionality: number; // e.g. 768
  baseUrl: string;        // "https://generativelanguage.googleapis.com"
  timeoutMs: number;
  topK: number;
  minCosine: number;      // [-1, 1]
}

interface CatalogItem {
  id: string;
  imageUrl: string; // http(s) URL or data: URL
}

interface SearchResult {
  id: string;
  cosine: number;      // [-1, 1]
  similarity: number;  // 0-100 (linear map from cosine)
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function similarityPercentFromCosine(cosine: number): number {
  return Math.round(Math.max(0, Math.min(1, (cosine + 1) / 2)) * 100);
}

function inferMime(source: string, fallback = "image/jpeg"): string {
  if (source.startsWith("data:")) {
    const m = /^data:(image\/(png|jpe?g|webp|gif));/i.exec(source);
    return m?.[1] ?? fallback;
  }
  const ext = source.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return fallback;
}

/** Fetch image bytes through an SSRF-safe fetcher, then base64-embed via Gemini. */
async function embedImageSource(
  fetcher: typeof fetch,
  config: GeminiImageSearchConfig,
  source: string,
  label: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const res = await fetcher(source, { signal });
  if (!res.ok) throw new Error(`Failed to fetch ${label} image (${res.status}).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(`${label} image is empty or exceeds 20 MB.`);
  }
  return embedImageBuffer(fetcher, config, buffer, inferMime(source), label, signal);
}

async function embedImageBuffer(
  fetcher: typeof fetch,
  config: GeminiImageSearchConfig,
  buffer: Buffer,
  mime: string,
  label: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const timeoutSignal =
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(config.timeoutMs) : undefined;
  const signal_ = timeoutSignal && signal ? AbortSignal.any([signal, timeoutSignal]) : signal ?? timeoutSignal;

  const url = `${config.baseUrl.replace(/\/$/, "")}/v1beta/models/${config.model}:embedContent`;
  const body = {
    content: { parts: [{ inline_data: { mime_type: mime, data: buffer.toString("base64") } }] },
    output_dimensionality: config.dimensionality,
  };

  const response = await fetcher(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": config.apiKey,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: signal_,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    embedding?: { values: number[] };
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Gemini failed (HTTP ${response.status}).`);
  }
  const values = payload.embedding?.values ?? [];
  if (!values.length) throw new Error(`Gemini returned an empty embedding for ${label}.`);
  return values;
}

/** Map jobs over a concurrency pool so a 100-image catalog doesn't fire 100 calls at once. */
async function poolMap<T, R>(items: readonly T[], concurrency: number, worker: (item: T, i: number) => Promise<R>): Promise<(R | Error)[]> {
  const results: (R | Error)[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]!, index);
      } catch (e) {
        results[index] = e instanceof Error ? e : new Error(String(e));
      }
    }
  });
  await Promise.all(runners);
  return results;
}

export async function searchByImage(
  fetcher: typeof fetch,
  config: GeminiImageSearchConfig,
  referenceUrl: string,
  catalog: CatalogItem[],
  signal?: AbortSignal,
): Promise<{ results: SearchResult[]; searchedCount: number }> {
  const referenceVector = await embedImageSource(fetcher, config, referenceUrl, "reference", signal);

  const embedded = await poolMap(catalog, EMBED_CONCURRENCY, async (item) => ({
    id: item.id,
    vector: await embedImageSource(fetcher, config, item.imageUrl, item.id, signal),
  }));

  const firstFailure = embedded.find((e): e is Error => e instanceof Error);
  if (firstFailure) throw firstFailure;

  const vectors = embedded.filter(
    (e): e is { id: string; vector: number[] } => !(e instanceof Error) && e !== undefined,
  );

  const results = vectors
    .map((entry) => {
      const cosine = cosineSimilarity(referenceVector, entry.vector);
      return { id: entry.id, cosine, similarity: similarityPercentFromCosine(cosine) };
    })
    .filter((r) => r.cosine >= config.minCosine)
    .sort((a, b) => b.cosine - a.cosine || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, config.topK));

  return { results, searchedCount: vectors.length };
}
```

---

## 5. Wire it to an API route

```ts
// app/api/reverse-image-search/route.ts
import { NextResponse } from "next/server";
import { searchByImage, type GeminiImageSearchConfig } from "@/lib/gemini-image-search";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const { referenceUrl, catalog } = await request.json();
  const config: GeminiImageSearchConfig = {
    apiKey: process.env.GEMINI_API_KEY!,
    model: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2",
    dimensionality: Number(process.env.GEMINI_EMBEDDING_DIM ?? 768),
    baseUrl: "https://generativelanguage.googleapis.com",
    timeoutMs: Number(process.env.GEMINI_EMBEDDING_TIMEOUT_MS ?? 60000),
    topK: Number(process.env.GEMINI_MATCH_TOP_K ?? 12),
    minCosine: Number(process.env.GEMINI_MATCH_MIN_COSINE ?? 0),
  };
  try {
    const data = await searchByImage(fetch, config, referenceUrl, catalog, request.signal);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed." },
      { status: 502 },
    );
  }
}
```

---

## 6. Client request shape

```ts
const res = await fetch("/api/reverse-image-search", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    referenceUrl: "https://.../target.jpg", // or data: URL
    catalog: [
      { id: "sku-1", imageUrl: "https://.../a.jpg" },
      { id: "sku-2", imageUrl: "https://.../b.jpg" },
    ],
  }),
});
const { results } = await res.json();
// results: [{ id, cosine, similarity }, ...]  sorted high → low
```

---

## 7. Tuning `GEMINI_MATCH_MIN_COSINE`

Gemini image embeddings put natural product photos in a **0.55–1.0** cosine band,
which the linear `%` mapping turns into **78–100%** — so unrelated items still
read as "8X%". Set `minCosine` to hide weak near-misses:

| Value | Effect |
|-------|--------|
| `0`   | Keep everything (default behaviour). |
| `0.70` | Loose — surface more candidates. |
| `0.80` | Balanced — recommended starting point. |
| `0.85` | Strict — only the closest visual matches. |

---

## 8. Gotchas

- **Server-only.** The key is sent as the `X-goog-api-key` header; keep it out of the browser bundle.
- **Image size.** Gemini accepts well under 20 MB; the client enforces that cap.
- **Concurrency.** Embedding 100 catalog images = 100 API calls. The `poolMap` helper caps in-flight requests at 4 to respect rate limits.
- **Failure mode.** Set `GEMINI_MATCH_FALLBACK_TO_LOCAL=true` only if you supply a local fallback matcher; otherwise the search errors out (fail-loud, not silent).
- **Output dimensionality.** `output_dimensionality` truncates the vector from the end — pass the same value you index/compare against.

---

## 9. Porting checklist

- [ ] Add env vars (server-only) + `.env.example` entry.
- [ ] Add `lib/gemini-image-search.ts` (section 4).
- [ ] Add the API route (section 5).
- [ ] Call the route from the client (section 6).
- [ ] Render results ranked by `cosine` / `similarity`.
- [ ] (Optional) Add a settings panel to live-adjust `minCosine`.
