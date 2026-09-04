import { describe, expect, it, vi } from "vitest";

import type * as VectorMatch from "@/lib/supplier-image-vector-match";
import { createSupplierImageGeminiMatcher, type SupplierImageGeminiConfig } from "./supplier-image-gemini";
import type { SupplierImageMatchResponse } from "./supplier-image-match";

/**
 * These tests isolate the resolveMinCosine live-override seam by stubbing the
 * two network hops the matcher makes:
 *   1. fetchImageBuffer — the SSRF-safe image-bytes fetcher (mocked at the module
 *      path the matcher imports). We return a tiny marker so embed requests can
 *      distinguish ref/a/b images.
 *   2. fetch → Gemini embedContent. We return fixed 768-dim unit vectors so the
 *      cosine between ref↔a is 1.0 and ref↔b is 0.0. That makes the threshold
 *      behaviour deterministic: a 0.85 cutoff keeps a, drops b.
 */
vi.mock("@/lib/supplier-image-vector-match", async (original) => {
  const real = (await original()) as typeof VectorMatch;
  return {
    ...real,
    fetchImageBuffer: vi.fn(async (source: string) => {
      const marker = source.includes("ref.png") ? Buffer.from("ref") : source.includes("a.png") ? Buffer.from("a") : Buffer.from("b");
      return marker;
    }),
  };
});
const vAxis = Array.from({ length: 768 }, (_, i) => (i < 384 ? 1 / Math.sqrt(384) : 0));
const vOther = Array.from({ length: 768 }, (_, i) => (i >= 384 ? 1 / Math.sqrt(384) : 0));

function fakeFetcher(): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof url === "string" ? url : url.toString());
    if (!u.pathname.endsWith(":embedContent")) {
      return new Response("", { status: 200, headers: { "Content-Type": "image/png" } });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      content: { parts: { inline_data: { data: string } }[] };
    };
    const marker = Buffer.from(body.content.parts[0]!.inline_data.data, "base64").toString("utf8");
    const vector = marker === "b" ? vOther : vAxis;
    return new Response(JSON.stringify({ embedding: { values: vector } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

const baseConfig: SupplierImageGeminiConfig = {
  apiKey: "k",
  model: "gemini-embedding-2",
  dimensionality: 768,
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  timeoutMs: 60_000,
  topK: 12,
  minCosine: 0,
  fallbackToLocal: false,
};

const request = {
  queryImage: { name: "ref.png", url: "https://images.example.com/ref.png" },
  catalog: [
    {
      catalogItemId: "p1:v1",
      supplierId: "s1",
      supplierName: "S",
      productId: "p1",
      productSubject: "Match",
      productType: "woven-label" as const,
      variantId: "v1",
      imageName: "a.png",
      imageUrl: "https://images.example.com/a.png",
      detail: "d",
      material: "m",
      colorNotes: "c",
      parameters: {},
    },
    {
      catalogItemId: "p2:v2",
      supplierId: "s1",
      supplierName: "S",
      productId: "p2",
      productSubject: "NoMatch",
      productType: "woven-label" as const,
      variantId: "v2",
      imageName: "b.png",
      imageUrl: "https://images.example.com/b.png",
      detail: "d",
      material: "m",
      colorNotes: "c",
      parameters: {},
    },
  ],
  currentSupplierId: "s1",
  engine: "gemini" as const,
};

describe("createSupplierImageGeminiMatcher resolveMinCosine override", () => {
  it("overrides config.minCosine with the DB value", async () => {
    const matcher = createSupplierImageGeminiMatcher({
      fetcher: fakeFetcher(),
      config: { ...baseConfig, minCosine: 0 },
      resolveMinCosine: async () => 0.85,
    });
    const result = (await matcher(request, undefined)) as SupplierImageMatchResponse;

    // ref↔a cosine 1.0 ≥ 0.85 → kept; ref↔b cosine 0.0 < 0.85 → dropped.
    expect(result.searchedCount).toBe(2);
    const ids = result.matches.map((m) => m.catalogItemId);
    expect(ids).toContain("p1:v1");
    expect(ids).not.toContain("p2:v2");
  });

  it("keeps the env-config default when the resolver returns null", async () => {
    const matcher = createSupplierImageGeminiMatcher({
      fetcher: fakeFetcher(),
      config: { ...baseConfig, minCosine: 0 },
      resolveMinCosine: async () => null,
    });
    const result = (await matcher(request, undefined)) as SupplierImageMatchResponse;

    // minCosine 0 keeps both.
    const ids = result.matches.map((m) => m.catalogItemId);
    expect(ids).toContain("p1:v1");
    expect(ids).toContain("p2:v2");
  });

  it("ignores a non-finite resolver value and keeps the env default", async () => {
    const matcher = createSupplierImageGeminiMatcher({
      fetcher: fakeFetcher(),
      config: { ...baseConfig, minCosine: 0 },
      resolveMinCosine: async () => Number.NaN,
    });
    const result = (await matcher(request, undefined)) as SupplierImageMatchResponse;

    // NaN is ignored → effectively minCosine 0 → b survives.
    expect(result.matches.map((m) => m.catalogItemId)).toContain("p2:v2");
  });
});
