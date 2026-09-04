import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { isLocalPostgresConfigured, isSupabaseConfigured } from "@/lib/env";
import { createPostgresWorkspaceRecordStore } from "@/lib/store/postgresWorkspaceRecordStore";

export const runtime = "nodejs";

// Whitelist of supported scalar settings and their value schemas. Adding a new
// setting means extending this map (plus the app_settings.key CHECK + the
// matching zod schema on the client). Kept central so the route stays the
// single source of truth for what the UI may persist.
const SETTING_SCHEMAS = {
  "gemini-match-min-cosine": z.number().min(-1).max(1),
} satisfies Record<string, z.ZodNumber>;

const allowedKeys = new Set(Object.keys(SETTING_SCHEMAS));

function assertDbConfigured(): NextResponse | null {
  // Pure demo mode (no Supabase, no local Postgres) has no server-side store;
  // the UI should surface "edit .env.local" rather than silently failing.
  if (!isSupabaseConfigured && !isLocalPostgresConfigured) {
    return NextResponse.json(
      {
        error:
          "Application settings require a database (Supabase or local Postgres). Edit .env.local instead.",
      },
      { status: 503 },
    );
  }
  return null;
}

export async function GET(request: Request) {
  const blocked = assertDbConfigured();
  if (blocked) return blocked;

  const key = new URL(request.url).searchParams.get("key");
  if (!key || !allowedKeys.has(key)) {
    return NextResponse.json({ error: "Unknown setting key." }, { status: 400 });
  }

  // On the server we always go directly to the Postgres store (the local-DB
  // backend), never the browser-side remote/local stores. getWorkspaceRecordStore
  // picks the client store for browser code; here we use the server-side store.
  const store = createPostgresWorkspaceRecordStore();
  try {
    const value = await store.getAppSetting(key);
    return NextResponse.json({ value: value ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read setting.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const postSchema = z.object({
  key: z.enum(Object.keys(SETTING_SCHEMAS) as [string, ...string[]]),
  value: z.unknown(),
});

export async function POST(request: Request) {
  const blocked = assertDbConfigured();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid app setting request." },
      { status: 400 },
    );
  }

  const { key, value } = parsed.data;
  const valueSchema = SETTING_SCHEMAS[key as keyof typeof SETTING_SCHEMAS];
  const valueParsed = valueSchema.safeParse(value);
  if (!valueParsed.success) {
    return NextResponse.json(
      { error: valueParsed.error.issues[0]?.message ?? "Invalid setting value." },
      { status: 400 },
    );
  }

  const store = createPostgresWorkspaceRecordStore();
  try {
    await store.setAppSetting(key, valueParsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save setting.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
