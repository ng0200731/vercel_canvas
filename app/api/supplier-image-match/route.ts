import { NextResponse } from "next/server";

import { supplierImageMatchRequestSchema } from "@/lib/supplier-image-match";
import { matchSupplierImagesWithEland } from "@/lib/supplier-image-eland";
import { matchSupplierImagesWithMilvus } from "@/lib/supplier-image-milvus";
import { matchSupplierImagesWithPictureSherlock } from "@/lib/supplier-image-picture-sherlock";
import { matchSupplierImages, type SupplierImageMatcher } from "@/lib/supplier-image-vector-match";

export const runtime = "nodejs";
export const maxDuration = 120;

interface SupplierImageMatchRouteDependencies {
  matchPictureSherlock: SupplierImageMatcher;
  matchMilvus: SupplierImageMatcher;
  matchLocal: SupplierImageMatcher;
  matchEland: SupplierImageMatcher;
}

export function createSupplierImageMatchPostHandler({
  matchPictureSherlock,
  matchMilvus,
  matchLocal,
  matchEland,
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
});
