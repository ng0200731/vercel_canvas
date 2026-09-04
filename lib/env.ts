import { z } from "zod";

/**
 * Centralized, validated environment access.
 *
 * All third-party credentials are OPTIONAL so the app can run in a local/demo
 * mode with zero configuration. Capabilities switch on as their keys are added:
 *   - Supabase configured       → cloud auth, Postgres persistence, Storage
 *   - Local Postgres configured → Docker Postgres on this machine (no auth)
 *   - Xiangsu configured        → AI image generation
 * Otherwise the app degrades gracefully (localStorage persistence, no auth, no AI).
 *
 * Priority: cloud Supabase > local Postgres > browser localStorage.
 *
 * Treat empty string env entries as "not set" so a blank `.env` line never fails.
 */
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());

const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional());

const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.email().optional(),
);

const optionalPort = z.preprocess((value) => {
  if (value === "") return undefined;
  if (typeof value === "string") return Number(value);
  return value;
}, z.number().int().min(1).max(65535).optional());

const optionalBoolean = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

const optionalInt = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : value;
  }
  return value;
}, z.number().int().optional());

const optionalNumber = z.preprocess((value) => {
  if (value === "" || value === undefined) return undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().optional());

function optionalNumberDefault(defaultValue: number) {
  return optionalNumber.transform((value) => value ?? defaultValue);
}

function optionalIntDefault(defaultValue: number) {
  return optionalInt.transform((value) => value ?? defaultValue);
}

const DEFAULT_LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";

const envSchema = z
  .object({
    // ── Supabase (optional) ──────────────────────────────────────────────
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
    // Server-only — NEVER expose to the client.
    SUPABASE_SERVICE_ROLE_KEY: optionalString,

    // ── Local Postgres (optional, dev) ───────────────────────────────────
    // Server-only connection string.
    DATABASE_URL: optionalString,
    LOCAL_USER_ID: optionalString.default(DEFAULT_LOCAL_USER_ID),
    // Browser-visible flag so client store selection can switch without exposing
    // DATABASE_URL. Set true when developing against local Docker Postgres.
    NEXT_PUBLIC_LOCAL_POSTGRES: optionalBoolean.default(false),

    // ── Xiangsu AI (optional, server-only) ──────────────────────────────
    XIANGSU_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,
    OPENAI_BASE_URL: optionalUrl.default("https://api.openai.com"),

    // ── Picture Sherlock CLIP sidecar (optional, server-only) ────────
    PICTURE_SHERLOCK_URL: optionalUrl,
    PICTURE_SHERLOCK_TIMEOUT_MS: optionalIntDefault(90_000).pipe(
      z.number().int().min(1_000).max(300_000),
    ),
    PICTURE_SHERLOCK_FALLBACK_TO_LOCAL: optionalBoolean.default(true),

    // ── Milvus Lite CLIP sidecar (optional, server-only) ─────────────
    // Prefer Docker on Windows (Milvus Lite is unreliable on the host).
    MILVUS_MATCH_URL: optionalUrl,
    MILVUS_MATCH_TIMEOUT_MS: optionalIntDefault(90_000).pipe(
      z.number().int().min(1_000).max(300_000),
    ),
    MILVUS_MATCH_FALLBACK_TO_LOCAL: optionalBoolean.default(true),

    // ── the-eland.co LabelStash Partner Search API (optional, server-only) ──
    // Authenticates with the X-API-Key header against POST /api/portal/v1/search.
    // The key is created self-serve at https://the-eland.co/portal/keys (shown
    // exactly once). The API searches only images your org previously uploaded
    // at /portal/upload — there is no upload API and no per-supplier filter.
    ELAND_PORTAL_API_KEY: optionalString,
    ELAND_PORTAL_BASE_URL: optionalUrl.default("https://the-eland.co"),
    ELAND_PORTAL_TIMEOUT_MS: optionalIntDefault(60_000).pipe(
      z.number().int().min(1_000).max(300_000),
    ),
    ELAND_PORTAL_TOP_K: optionalIntDefault(10).pipe(
      z.number().int().min(1).max(10),
    ),

    // ── Google Gemini image-embedding search (optional, server-only) ──
    // Authenticates with the X-goog-api-key header against
    // POST /v1beta/models/<model>:embedContent. Embeds the reference image and
    // each selected-supplier catalog image with gemini-embedding-2, then cosine
    // ranks them in-process — no Python sidecar, no external catalog. Catalog
    // images stay scoped to the selected supplier (the request only carries
    // the current supplier's images).
    GEMINI_API_KEY: optionalString,
    GEMINI_EMBEDDING_MODEL: optionalString.default("gemini-embedding-2"),
    GEMINI_EMBEDDING_DIM: optionalIntDefault(768).pipe(z.number().int().min(1).max(3072)),
    GEMINI_EMBEDDING_TIMEOUT_MS: optionalIntDefault(60_000).pipe(
      z.number().int().min(1_000).max(300_000),
    ),
    GEMINI_MATCH_TOP_K: optionalIntDefault(12).pipe(z.number().int().min(1).max(100)),
    // Minimum cosine similarity [-1, 1] for a catalog image to be surfaced as a
    // Gemini match. Results below this are dropped before top-K truncation, so
    // the % column no longer shows "8X%" near-misses that look visually off.
    // Leave unset (or 0) to keep the original "rank everything" behaviour.
    GEMINI_MATCH_MIN_COSINE: optionalNumberDefault(0).pipe(
      z.number().min(-1).max(1),
    ),
    GEMINI_MATCH_FALLBACK_TO_LOCAL: optionalBoolean.default(false),

    // SMTP (optional, server-only). An optional local catcher overrides 163.com, then Gmail.
    SMTP_LOCAL_HOST: optionalString,
    SMTP_LOCAL_PORT: optionalPort,
    SMTP_LOCAL_SECURE: optionalBoolean.default(false),
    SMTP_LOCAL_USERNAME: optionalEmail,
    SMTP_LOCAL_PASSWORD: optionalString,
    SMTP_163_USERNAME: optionalEmail,
    SMTP_163_PASSWORD: optionalString,
    SMTP_GMAIL_USERNAME: optionalEmail,
    SMTP_GMAIL_PASSWORD: optionalString,
    SMTP_FROM_NAME: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().trim().min(1).max(100).optional(),
    ),

    // ── App ──────────────────────────────────────────────────────────────
    NEXT_PUBLIC_APP_URL: optionalUrl.default("http://localhost:3000"),
  })
  .superRefine((value, context) => {
    const pairs = [
      ["SMTP_163_USERNAME", value.SMTP_163_USERNAME, "SMTP_163_PASSWORD", value.SMTP_163_PASSWORD],
      ["SMTP_LOCAL_HOST", value.SMTP_LOCAL_HOST, "SMTP_LOCAL_PORT", value.SMTP_LOCAL_PORT],
      [
        "SMTP_LOCAL_USERNAME",
        value.SMTP_LOCAL_USERNAME,
        "SMTP_LOCAL_PASSWORD",
        value.SMTP_LOCAL_PASSWORD,
      ],
      [
        "SMTP_GMAIL_USERNAME",
        value.SMTP_GMAIL_USERNAME,
        "SMTP_GMAIL_PASSWORD",
        value.SMTP_GMAIL_PASSWORD,
      ],
    ] as const;

    for (const [firstKey, firstValue, secondKey, secondValue] of pairs) {
      if (Boolean(firstValue) === Boolean(secondValue)) continue;
      context.addIssue({
        code: "custom",
        path: [firstValue ? secondKey : firstKey],
        message: `${firstKey} and ${secondKey} must be configured together.`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Explicit property access is required so Next.js can inline NEXT_PUBLIC_*
  // values into the browser bundle at build time.
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    LOCAL_USER_ID: process.env.LOCAL_USER_ID,
    NEXT_PUBLIC_LOCAL_POSTGRES: process.env.NEXT_PUBLIC_LOCAL_POSTGRES,
    XIANGSU_API_KEY: process.env.XIANGSU_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    PICTURE_SHERLOCK_URL: process.env.PICTURE_SHERLOCK_URL,
    PICTURE_SHERLOCK_TIMEOUT_MS: process.env.PICTURE_SHERLOCK_TIMEOUT_MS,
    PICTURE_SHERLOCK_FALLBACK_TO_LOCAL: process.env.PICTURE_SHERLOCK_FALLBACK_TO_LOCAL,
    MILVUS_MATCH_URL: process.env.MILVUS_MATCH_URL,
    MILVUS_MATCH_TIMEOUT_MS: process.env.MILVUS_MATCH_TIMEOUT_MS,
    MILVUS_MATCH_FALLBACK_TO_LOCAL: process.env.MILVUS_MATCH_FALLBACK_TO_LOCAL,
    ELAND_PORTAL_API_KEY: process.env.ELAND_PORTAL_API_KEY,
    ELAND_PORTAL_BASE_URL: process.env.ELAND_PORTAL_BASE_URL,
    ELAND_PORTAL_TIMEOUT_MS: process.env.ELAND_PORTAL_TIMEOUT_MS,
    ELAND_PORTAL_TOP_K: process.env.ELAND_PORTAL_TOP_K,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL,
    GEMINI_EMBEDDING_DIM: process.env.GEMINI_EMBEDDING_DIM,
    GEMINI_EMBEDDING_TIMEOUT_MS: process.env.GEMINI_EMBEDDING_TIMEOUT_MS,
    GEMINI_MATCH_TOP_K: process.env.GEMINI_MATCH_TOP_K,
    GEMINI_MATCH_MIN_COSINE: process.env.GEMINI_MATCH_MIN_COSINE,
    GEMINI_MATCH_FALLBACK_TO_LOCAL: process.env.GEMINI_MATCH_FALLBACK_TO_LOCAL,
    SMTP_163_USERNAME: process.env.SMTP_163_USERNAME,
    SMTP_163_PASSWORD: process.env.SMTP_163_PASSWORD,
    SMTP_LOCAL_HOST: process.env.SMTP_LOCAL_HOST,
    SMTP_LOCAL_PORT: process.env.SMTP_LOCAL_PORT,
    SMTP_LOCAL_SECURE: process.env.SMTP_LOCAL_SECURE,
    SMTP_LOCAL_USERNAME: process.env.SMTP_LOCAL_USERNAME,
    SMTP_LOCAL_PASSWORD: process.env.SMTP_LOCAL_PASSWORD,
    SMTP_GMAIL_USERNAME: process.env.SMTP_GMAIL_USERNAME,
    SMTP_GMAIL_PASSWORD: process.env.SMTP_GMAIL_PASSWORD,
    SMTP_FROM_NAME: process.env.SMTP_FROM_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  });
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables. Check your .env file — see .env.example.");
  }
  return parsed.data;
}

export const env = loadEnv();

/** Browser-safe Supabase key. Publishable keys replace the legacy anon-key name. */
export const supabasePublicKey =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when Supabase URL + anon key are present (auth + cloud persistence active). */
export const isSupabaseConfigured = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && supabasePublicKey);

/**
 * Client-safe local Postgres flag. True when the public switch is on and Supabase
 * is not configured. Server routes still require DATABASE_URL.
 */
export const isLocalPostgresConfigured =
  !isSupabaseConfigured && Boolean(env.NEXT_PUBLIC_LOCAL_POSTGRES);

/** Fixed owner id for single-user local Postgres mode. */
export const localUserId = env.LOCAL_USER_ID ?? DEFAULT_LOCAL_USER_ID;

/** True when a Xiangsu API key is present (AI image generation active). */
export const isXiangsuConfigured = Boolean(env.XIANGSU_API_KEY);

/** True when an OpenAI API key is present (allows A/B testing the mask
 *  contract against the reference OpenAI implementation, bypassing xiangsu). */
export const isOpenAiConfigured = Boolean(env.OPENAI_API_KEY);

/** True when the Picture Sherlock CLIP sidecar is configured. */
export const isPictureSherlockConfigured = Boolean(env.PICTURE_SHERLOCK_URL);

/** True when the Milvus Lite CLIP match sidecar is configured. */
export const isMilvusMatchConfigured = Boolean(env.MILVUS_MATCH_URL);

/** True when the the-eland.co LabelStash Partner Search API key is present. */
export const isElandConfigured = Boolean(env.ELAND_PORTAL_API_KEY);

/** True when a Google Gemini API key is present (multi-modal image embedding search active). */
export const isGeminiConfigured = Boolean(env.GEMINI_API_KEY);

/**
 * Server-only: returns DATABASE_URL when local Postgres mode is active.
 * Throws if misconfigured.
 */
export function requireLocalDatabaseUrl(): string {
  if (isSupabaseConfigured) {
    throw new Error("Local Postgres is disabled while Supabase is configured.");
  }
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required for local Postgres mode. See docs/SETUP.md.",
    );
  }
  return env.DATABASE_URL;
}
