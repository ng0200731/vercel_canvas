# Gemini API Reference — Image Generation & Image Search

> Complete technical reference for building an image-generation + similar-image-search web app on the **Google Gemini Developer API** (the `generativelanguage.googleapis.com` service). Written against the app in this repo (`server.js` + `public/index.html`), your API key, and the model list that key returned in 2026-09.
>
> Applies to the Gemini Developer API. Google also offers Vertex AI (enterprise, GCP) with the same underlying models — see §14 for the differences.

---

## Table of contents

1. [Architecture overview](#1-architecture-overview)
2. [The API key](#2-the-api-key)
3. [API base URL & authentication](#3-api-base-url--authentication)
4. [Model catalogue (your key's list)](#4-model-catalogue-your-keys-list)
5. [Image generation](#5-image-generation)
6. [Image understanding / captioning (the vision step)](#6-image-understanding--captioning-the-vision-step)
7. [Embeddings for search](#7-embeddings-for-search)
8. [Full similar-image search pipeline](#8-full-similar-image-search-pipeline)
9. [The similarity score, explained](#9-the-similarity-score-explained)
10. [cURL examples](#10-curl-examples)
11. [Node SDK examples](#11-node-sdk-examples)
12. [Error codes & troubleshooting](#12-error-codes--troubleshooting)
13. [Limits, pricing & region](#13-limits-pricing--region)
14. [Gemini Developer API vs Vertex AI](#14-gemini-developer-api-vs-vertex-ai)
15. [Production notes](#15-production-notes)
16. [Official resources](#16-official-resources)

---

## 1. Architecture overview

```
┌─────────────┐   HTTP   ┌──────────────────┐   HTTPS   ┌────────────────────────────┐
│   Browser   │ ───────▶ │  Express server  │ ────────▶ │  generativelanguage.googleapis.com │
│ (index.html)│ ◀─────── │   (server.js)    │ ◀──────── │   (Gemini Developer API)  │
└─────────────┘   JSON   └──────────────────┘           └────────────────────────────┘
     │                      │   images → uploads/            │  models:
     │                      │   vectors → library.json       │   gemini-2.5-flash-image  (generate)
     └──────────────────────┘                                │   gemini-2.5-flash        (vision caption)
                                                             │   gemini-embedding-001    (embed text)
```

Three distinct Gemini capabilities are combined:

| Capability | Gemini model | Purpose |
|---|---|---|
| **Image generation** | `gemini-2.5-flash-image` | Turn a text prompt into an image |
| **Image understanding (vision)** | `gemini-2.5-flash` | Read an image and write a text caption |
| **Embeddings** | `gemini-embedding-001` | Turn text into a vector for similarity |

The search is built on a **caption → embedding → cosine-similarity** chain, *not* on raw pixel comparison. See §8–§9.

---

## 2. The API key

### 2.1 Where to get it
- Create at **Google AI Studio** → **Get API key**: <https://aistudio.google.com/apikey>
- A key is bound to a Google Cloud project. Select or create the project there.

### 2.2 Key formats
Two formats exist; both are accepted by the API but look different:

| Prefix | Generation | Notes |
|---|---|---|
| `AIza...` | Older | The classic Gemini API key format |
| `AQ.Ab8RN6Ju...` | Newer | Newer AI Studio / enterprise-style key. **Your key uses this format** — it validated successfully with HTTP 200 in this project. |

> ⚠️ A key starting with something else (e.g. a Google OAuth token or a GCP service-account credential) is **not** a Gemini API key and returns `API_KEY_INVALID`.

### 2.3 Where the key must live — security
- The key must be sent only from **server-side** code (Node). Never embed it in `public/index.html` or any browser JavaScript — anyone can read it from DevTools.
- Load it from an environment variable via `dotenv`:
  ```js
  const API_KEY = process.env.GEMINI_API_KEY;
  ```
- `.env` is already in `.gitignore`. Never commit it.
- **If a key is ever pasted into chat/logs/screenshots/commits: revoke it immediately** at <https://aistudio.google.com/apikey> and create a new one. Keys in this project were treated as compromised for exactly that reason.

### 2.4 Region (IMPORTANT for this project)
Google restricts the Gemini Developer API by **geographic region**, enforced by the request IP. When accessed from an unsupported region, the API returns:

```json
{
  "error": { "code": 400, "status": "FAILED_PRECONDITION",
             "message": "User location is not supported for the API use." }
}
```

- **This is not a key problem** — the key authenticated fine. It is a location block.
- In this project the block was observed directly, and using a **VPN from a supported region** returned HTTP 200 and a full model list.
- Authoritative supported-locations list: <https://ai.google.dev/gemini-api/docs/available-regions>.

---

## 3. API base URL & authentication

- **Base URL:** `https://generativelanguage.googleapis.com`
- **API version:** `v1beta` (stable enough for production features; use `v1` where your SDK pins it)
- **Auth:** pass the key as a query parameter `?key=YOUR_KEY` on every call.

Examples:

```
GET  https://generativelanguage.googleapis.com/v1beta/models?key=KEY
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=KEY
```

> The REST API also supports the `x-goog-api-key` header. The Node SDK passes `?key=` automatically.

---

## 4. Model catalogue (your key's list)

These are the **50 models** your key returned (`GET /v1beta/models`) on 2026-09. Grouped by role:

**Image generation (text → image)**
```
gemini-2.5-flash-image
gemini-3-pro-image
gemini-3-pro-image-preview
gemini-3.1-flash-image
gemini-3.1-flash-image-preview
gemini-3.1-flash-lite-image
```

**General text + vision (used here to *describe* images)**
```
gemini-2.5-flash          gemini-2.5-pro          gemini-2.5-flash-lite
gemini-flash-latest       gemini-flash-lite-latest gemini-pro-latest
gemini-3.1-flash          gemini-3.1-flash-lite   gemini-3.1-flash-lite-preview
gemini-3.1-pro-preview    gemini-3.5-flash        gemini-3.5-flash-lite
gemini-3-flash-preview    gemini-3.6-flash        gemini-3.7-flash
gemini-3.8-flash
```

**Embeddings (text / multimodal → vector)**
```
gemini-embedding-001
gemini-embedding-2-preview
gemini-embedding-2
```

**Other / media / preview**
```
gemini-omni-flash-preview        gemini-omni-1.1-flash
gemini-3.1-flash-tts-preview     gemini-3.5-transcribe
gemini-3.5-transcribe-live       gemini-3.1-flash-preview
gemini-2.5-native-audio-*        gemini-2.5-computer-use-preview-10-2025
gemini-robotics-er-2-preview     antigravity-preview-05-2026
deep-research-*-04-2026          aqa
lyria-*-preview / lyria-3.5       nano-banana-pro-preview
veo-3.1-generate-preview         veo-3.1-fast-generate-preview
veo-3.1-lite-generate-preview
```

> **Model churn:** Google deprecates and replaces models over time. `gemini-2.0-flash` was in this project's original config but **no longer appears in the list** — always re-check `GET /models` and keep model names configurable (as this app does via `.env`), never hard-coded.

---

## 5. Image generation

### 5.1 Endpoint
```
POST /v1beta/models/{IMAGE_MODEL}:generateContent?key=KEY
```
`IMAGE_MODEL` = one of the image models from §4 (default here: `gemini-2.5-flash-image`).

### 5.2 Key request fields
- `contents` — the prompt (text, or text + image for *editing*).
- `generationConfig.responseModalities` — **required** to get image output:
  ```json
  { "responseModalities": ["TEXT", "IMAGE"] }
  ```

### 5.3 Minimal request body
```json
{
  "contents": [{ "parts": [{ "text": "A cozy cottage in a snowy forest at sunset" }] }],
  "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
}
```

### 5.4 Response — extracting the image
The response's first candidate contains `parts`. Look for the part with `inlineData`:
```json
{
  "candidates": [{
    "content": {
      "parts": [
        { "text": "Here is your image..." },
        { "inlineData": {
            "mimeType": "image/png",
            "data": "<base64-encoded-image-bytes>"
        } }
      ]
    }
  }]
}
```
- `inlineData.data` is **base64** — decode it or embed directly in the browser as `data:<mimeType>;base64,<data>`.
- If only `text` is returned and no `inlineData`, generation was refused/blocked; surface `parts[].text` to the user.

### 5.5 Editing an existing image
Attach an image in `contents.parts` as `inlineData` alongside the text prompt (same shape as §6) — the image model can modify it ("make the sky pink").

---

## 6. Image understanding / captioning (the vision step)

### 6.1 Endpoint
```
POST /v1beta/models/{VISION_MODEL}:generateContent?key=KEY
```
`VISION_MODEL` = a general model (default here: `gemini-2.5-flash`).

### 6.2 Request — image + instruction
Images are passed as **inline base64** (up to the API's inline limit; larger files should use the Files API — see §13):
```json
{
  "contents": [{
    "role": "user",
    "parts": [
      { "inlineData": { "mimeType": "image/jpeg", "data": "<base64>" } },
      { "text": "Describe this image for visual similarity search. Include main subjects, colors, composition, setting, style, and distinctive details. One concise paragraph, no speculation." }
    ]
  }]
}
```
MIME types supported inline: `image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/heif`.

### 6.3 Response
`candidates[0].content.parts[].text` contains the caption (via `result.response.text()` in the SDK).

---

## 7. Embeddings for search

### 7.1 Endpoint
```
POST /v1beta/models/gemini-embedding-001:embedContent?key=KEY
```

### 7.2 Request — a single text input
```json
{
  "model": "models/gemini-embedding-001",
  "content": { "parts": [{ "text": "<the caption>" }] },
  "taskType": "RETRIEVAL_DOCUMENT"
}
```

### 7.3 `taskType` values (important)
Google tunes the embedding per retrieval role:
- `RETRIEVAL_DOCUMENT` — use when embedding the **library** items.
- `RETRIEVAL_QUERY` — use when embedding the **search query**.

Using the correct one per side improves ranking.

### 7.4 Response
```json
{
  "embedding": { "values": [0.0123, -0.0456, ... , 0.0891] }
}
```
Default dimensionality for `gemini-embedding-001` is **3072** (768 outputs; configurable via `outputDimensionality`).

> **Note on multimodal embeddings:** The stable public path here is **text-in** embeddings. That is exactly why this app first converts each image to a caption (§6) and then embeds the caption (§7) — it makes the search "multimodal from the app's perspective" using models your key is confirmed to access.

---

## 8. Full similar-image search pipeline

This is the exact flow `server.js` implements.

**Indexing (batch upload)**
1. Client uploads N images → `POST /api/upload` (multipart).
2. For each image, server:
   - reads bytes → base64
   - **describeImage()** → Gemini vision model writes a caption
   - **embedDescription(..., "RETRIEVAL_DOCUMENT")** → `gemini-embedding-001` → vector
   - stores `{ id, filename, caption, embedding }` in `library.json`
3. Images on disk live in `uploads/` (served at `/images/...`).

**Querying (search)**
1. Client uploads one query image → `POST /api/search`.
2. Server describes it with the **same** vision model, embeds with `"RETRIEVAL_QUERY"`.
3. Computes **cosine similarity** between the query vector and every library vector.
4. Sorts descending, returns top-N (default 5) with a score.

> **Consistency rule:** use the *same* vision model when indexing and when searching. Different captions from different models reduce comparability.

---

## 9. The similarity score, explained

- **Score = cosine similarity × 100**, computed between two 3072-dim embedding vectors.
  ```
  cos(A, B) = (A · B) / (‖A‖ · ‖B‖)
  ```
  Range: `-1…1` → shown as `-100%…100%`. For this pipeline realistic values are ~0.3–0.9.

- **What it measures:** *semantic* closeness of the **captions**, which encode what Gemini understood: main subjects, scene/setting, style, mood, colors, composition.

| Captures | Does NOT capture |
|---|---|
| Main subjects & objects | Exact pixel matching |
| Scene / setting | Precise geometry |
| Style & mood | Raw color histograms |
| Composition & colors (as described) | Fine details the caption omits |

- **Interpretation (soft guide, not a hard rule):**
  - ~0.90+ → near-identical description (very likely the same or duplicate scene)
  - ~0.70–0.90 → clearly related
  - ~0.50–0.70 → loosely related
  - < ~0.50 → probably unrelated

- It depends on **how Gemini words the caption** — two photos both captioned "a red car on a highway" score high even if pixel-wise different; two similar-looking cars captioned with different colors may score lower. Treat the % as a ranking aid and verify visually.

- For *true* visual-similarity (color/texture/pixel), you would need a different approach (CLIP-style model or image-hash + perceptual hashing) — the current design is **understanding-based**, which is what you asked for.

---

## 10. cURL examples

**List models**
```bash
curl -sS "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
```

**Generate an image (returns JSON with base64 in `inlineData.data`)**
```bash
curl -sS -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{ "parts": [{ "text": "a red apple on a white table" }] }],
    "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
  }'
```

**Describe an image** (inline base64; real payload is much longer)
```bash
curl -sS -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{ "role":"user", "parts": [
      { "inlineData": { "mimeType": "image/jpeg", "data": "<base64>" } },
      { "text": "Describe this image briefly." }
    ] }]
  }'
```

**Embed a caption**
```bash
curl -sS -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=$GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": { "parts": [{ "text": "a red car on a highway" }] },
    "taskType": "RETRIEVAL_QUERY"
  }'
```

**Test the key + reachability** (the diagnostic used in this project)
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY"
# 200 = key OK + network OK; 400 FAILED_PRECONDITION = region block; 400 API_KEY_INVALID = bad key
```

---

## 11. Node SDK examples

SDK: `@google/generative-ai` (v0.24.0 in this repo). See `server.js` for the working versions.

**Setup**
```js
import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
```

**Generate an image**
```js
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-image",
  generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
});
const result = await model.generateContent("a red apple on a white table");
const parts = result.response.candidates[0].content.parts;
const imagePart = parts.find((p) => p.inlineData?.data);
// imagePart.inlineData.data  -> base64
// imagePart.inlineData.mimeType -> "image/png"
```

**Describe an image (vision)**
```js
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const result = await model.generateContent({
  contents: [{ role: "user", parts: [
    { inlineData: { mimeType: "image/jpeg", data: base64 } },
    { text: "Describe this image for similarity search." },
  ] }],
});
const caption = result.response.text();
```

**Embed a caption**
```js
const embedModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
const res = await embedModel.embedContent({
  content: { parts: [{ text: caption }] },
  taskType: "RETRIEVAL_DOCUMENT", // or "RETRIEVAL_QUERY"
});
const vector = res.embedding.values; // 3072 numbers
```

**Cosine similarity (pure JS)**
```js
function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
```

---

## 12. Error codes & troubleshooting

| HTTP | `status` / reason | Meaning | Fix |
|---|---|---|---|
| 400 | `API_KEY_INVALID` | Bad/revoked/wrong-type key | Regenerate key at AI Studio |
| 400 | `FAILED_PRECONDITION` / "User location is not supported" | **Region block** | Use supported region/VPN/hosting |
| 400 | `INVALID_ARGUMENT` | Malformed body, bad model name, bad mimeType | Check model name & request shape |
| 403 | `PERMISSION_DENIED` | Project has no billing / API not enabled | Enable Generative Language API + billing on the project |
| 404 | — | Model not found (deprecated name) | Re-check `GET /models`; update model name |
| 429 | `RESOURCE_EXHAUSTED` | Rate limit / quota hit | Retry with backoff; raise quota |
| 500/503 | — | Transient server error | Retry with exponential backoff |
| — | `fetch failed` / `ECONNREFUSED` | Network/proxy/VPN issue or port conflict | Check connectivity; VPN on; free the port |

**Common project-specific gotchas**
- **Stale server process** → old `.env`/model still loaded. Symptom: error still names `gemini-2.0-flash` after you changed config. Fix: kill the old `node server.js` process, then run `start.bat` once.
- **Port in use** → `EADDRINUSE`. Change `PORT` in `.env` (the project tested on `3457/3458/3459/3460` because `3000` was taken).
- **Model deprecation** → a configured model vanishes from the list; keep model names in `.env`, not code.

---

## 13. Limits, pricing & region

- **Rate/quota:** per-minute and per-day quotas per model. Hit `429` when exceeded → implement retry/backoff. Raised by requesting quota increase on the cloud project.
- **Billing:** the Gemini API requires billing on a cloud project; unmetered free tier may apply for low volume on some keys/regions. Actual rates change — see <https://ai.google.dev/gemini-api/pricing> (do not trust hard-coded prices).
- **Inline size limits:** images passed inline are size-limited; files larger than the inline cap must use the **Files API**:
  ```
  POST /v1beta/files?key=KEY        (upload file, get a URI + name)
  POST /v1beta/files/{name}:generateContent  (refer to file by URI)
  ```
  Use it for very large/high-res uploads in production.
- **Output dimensions:** `gemini-embedding-001` default 3072 dims; can set `outputDimensionality` to e.g. 768 for lower storage/cost.
- **Region:** mandatory supported-region check (§2.4).

---

## 14. Gemini Developer API vs Vertex AI

| | **Gemini Developer API** | **Vertex AI** |
|---|---|---|
| Entry | `aistudio.google.com` key | Google Cloud console |
| Auth | `?key=API_KEY` | OAuth / service account |
| Target | Individual devs, fast prototyping | Enterprise, GCP-governed |
| Models | Same underlying models | Same underlying models |
| This app | Uses this API | Swap base + auth to migrate |

Both expose the same model families; Vertex adds IAM, VPC, monitoring, and per-project billing controls.

---

## 15. Production notes

- **Storage:** this app stores vectors in `library.json` and images on local disk — fine for a prototype/small library. For scale use object storage (GCS/R2) for images and a vector DB (`pgvector`, Qdrant, Weaviate, Pinecone) for embeddings.
- **Async indexing:** each uploaded image = 1 vision call + 1 embed call. For large batch uploads, process via a job queue instead of blocking the HTTP request.
- **Auth/tenancy:** add per-user libraries (scope library.json by user) and rate limiting.
- **Validation:** restrict file types, size, and scan for malicious content on upload.
- **Secrets:** key lives only server-side; rotate if ever exposed; never ship `.env`.
- **Cost control:** cache embeddings; cap batch size (`MAX_UPLOAD_BATCH=20`); use `outputDimensionality` if storage is a concern.

---

## 16. Official resources

- API keys — <https://aistudio.google.com/apikey>
- Gemini API docs — <https://ai.google.dev/gemini-api/docs>
- Available regions — <https://ai.google.dev/gemini-api/docs/available-regions>
- Pricing — <https://ai.google.dev/gemini-api/pricing>
- Model list (live) — `GET https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY`
- Node SDK — <https://ai.google.dev/gemini-api/docs/quickstart>
- Files API (large media) — <https://ai.google.dev/gemini-api/docs/files>
