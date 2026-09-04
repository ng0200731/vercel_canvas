import { NextResponse } from "next/server";

import { createSupplierImageGeminiMatcher } from "@/lib/supplier-image-gemini";
import { isLocalPostgresConfigured, isSupabaseConfigured } from "@/lib/env";
import { supplierImageMatchRequestSchema } from "@/lib/supplier-image-match";
import { matchSupplierImagesWithEland } from "@/lib/supplier-image-eland";
import { matchSupplierImagesWithMilvus } from "@/lib/supplier-image-milvus";
import { matchSupplierImagesWithPictureSherlock } from "@/lib/supplier-image-picture-sherlock";
import { matchSupplierImages, type SupplierImageMatcher } from "@/lib/supplier-image-vector-match";
import { createPostgresWorkspaceRecordStore } from "@/lib/store/postgresWorkspaceRecordStore";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Live, DB-backed override of GEMINI_MATCH_MIN_COSINE. Only the local-Postgres
 *  mode ships a server-side store wired here (Supabase mode reads the same
 *  app_settings row via its client path); when neither is configured, falls
 *  back to the env default by returning null. Any DB error also returns null —
 *  a settings-store failure must never break a search. */
async function resolveGeminiMinCosine(): Promise<number | null> {
  if (!isSupabaseConfigured && !isLocalPostgresConfigured) return null;
  try {
    const value = await createPostgresWorkspaceRecordStore().getAppSetting(
      "gemini-match-min-cosine",
    );
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

interface SupplierImageMatchRouteDependencies {
  matchPictureSherlock: SupplierImageMatcher;
  matchMilvus: SupplierImageMatcher;
  matchLocal: SupplierImageMatcher;
  matchEland: SupplierImageMatcher;
  matchGemini: SupplierImageMatcher;
}

export function createSupplierImageMatchPostHandler({
  matchPictureSherlock,
  matchMilvus,
  matchLocal,
  matchEland,
  matchGemini,
}: SupplierImageMatchRouteDependencies) {
  return async function POST(request: Request) {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const parsed = supplierImageMatchRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid supplier image search request." },
        { status: 400 },
      );
    }

    const match =
      parsed.data.engine === "milvus"
        ? matchMilvus
        : parsed.data.engine === "local" || parsed.data.engine === "labelstash"
          ? matchLocal
          : parsed.data.engine === "eland"
            ? matchEland
            : parsed.data.engine === "gemini"
              ? matchGemini
              : matchPictureSherlock;

    try {
      return NextResponse.json(await match(parsed.data, request.signal));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Supplier image search failed.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  };
}

export const POST = createSupplierImageMatchPostHandler({
  matchPictureSherlock: matchSupplierImagesWithPictureSherlock,
  matchMilvus: matchSupplierImagesWithMilvus,
  matchLocal: matchSupplierImages,
  matchEland: matchSupplierImagesWithEland,
  matchGemini: createSupplierImageGeminiMatcher({ resolveMinCosine: resolveGeminiMinCosine }),
});
