import { describe, expect, it, vi } from "vitest";

import type * as VectorMatch from "@/lib/supplier-image-vector-match";
import {
  createSupplierImageGeminiCaptionMatcher,
  type SupplierImageGeminiCaptionConfig,
} from "./supplier-image-gemini-caption";
import type { SupplierImageMatchResponse } from "./supplier-image-match";

/**
 * These tests isolate the caption→embed pipeline and the resolveMinCosine seam
 * by stubbing the two network hops:
 *   1. fetchImageBuffer — the SSRF-safe image-bytes fetcher (mocked at the module
 *      path the matcher imports). We return a tiny marker so caption requests can
 *      distinguish ref/a/b images.
 *   2. fetch → Gemini. :generateContent writes a caption derived from the marker
 *      ("match caption" for ref/a, "other caption" for b); :embedContent returns
 *      a fixed 768-dim unit vector keyed off the caption so the cosine between
 *      ref↔a is 1.0 and ref↔b is 0.0. That makes the threshold deterministic:
 *      a 0.85 cutoff keeps a, drops b.
 */
vi.mock("@/lib/supplier-image-vector-match", async (original) => {
  const real = (await original()) as typeof VectorMatch;
  return {
    ...real,
    fetchImageBuffer: vi.fn(async (source: string) => {
      const marker = source.includes("ref.png")
        ? Buffer.from("ref")
        : source.includes("a.png")
          ? Buffer.from("a")
          : Buffer.from("b");
      return marker;
    }),
  };
});
const vAxis = Array.from({ length: 768 }, (_, i) => (i < 384 ? 1 / Math.sqrt(384) : 0));
const vOther = Array.from({ length: 768 }, (_, i) => (i >= 384 ? 1 / Math.sqrt(384) : 0));

interface EmbedRequest {
  content: { parts: { text: string }[] };
  taskType: string;
}
const seenEmbedRequests: EmbedRequest[] = [];

function fakeFetcher(): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof url === "string" ? url : url.toString());
    if (u.pathname.endsWith(":generateContent")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        contents: { parts: { inline_data: { data: string } }[] }[];
      };
      const marker = Buffer.from(
        body.contents[0]!.parts[0]!.inline_data.data,
        "base64",
      ).toString("utf8");
      const caption = marker === "b" ? "other caption" : "match caption";
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: caption }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.pathname.endsWith(":embedContent")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as EmbedRequest;
      seenEmbedRequests.push(body);
      const vector = body.content.parts[0]!.text === "other caption" ? vOther : vAxis;
      return new Response(JSON.stringify({ embedding: { values: vector } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("", { status: 200, headers: { "Content-Type": "image/png" } });
  }) as typeof fetch;
}

const baseConfig: SupplierImageGeminiCaptionConfig = {
  apiKey: "k",
  visionModel: "gemini-2.5-flash",
  embeddingModel: "gemini-embedding-001",
  dimensionality: 768,
  baseUrl: "https://generativelanguage.googleapis.com",
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
  engine: "gemini-caption" as const,
};

describe("createSupplierImageGeminiCaptionMatcher", () => {
  it("captions then embeds the reference as RETRIEVAL_QUERY and catalog as RETRIEVAL_DOCUMENT", async () => {
    seenEmbedRequests.length = 0;
    const matcher = createSupplierImageGeminiCaptionMatcher({
      fetcher: fakeFetcher(),
      config: { ...baseConfig, minCosine: 0 },
    });
    await matcher(request, undefined);

    expect(seenEmbedRequests).toHaveLength(3); // ref + 2 catalog images
    const reference = seenEmbedRequests.find((r) => r.content.parts[0]!.text === "match caption");
    // ref and a both produce "match caption"; the reference embed is the first call.
    expect(seenEmbedRequests[0]!.taskType).toBe("RETRIEVAL_QUERY");
    // Catalog embeds use RETRIEVAL_DOCUMENT.
    expect(seenEmbedRequests.slice(1).every((r) => r.taskType === "RETRIEVAL_DOCUMENT")).toBe(true);
    expect(reference).toBeDefined();
  });

  it("overrides config.minCosine with the DB value", async () => {
    seenEmbedRequests.length = 0;
    const matcher = createSupplierImageGeminiCaptionMatcher({
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
    expect(result.model).toBe("gemini-caption-v1");
  });

  it("keeps the env-config default when the resolver returns null", async () => {
    const matcher = createSupplierImageGeminiCaptionMatcher({
      fetcher: fakeFetcher(),
      config: { ...baseConfig, minCosine: 0 },
      resolveMinCosine: async () => null,
    });
    const result = (await matcher(request, undefined)) as SupplierImageMatchResponse;

    const ids = result.matches.map((m) => m.catalogItemId);
    expect(ids).toContain("p1:v1");
    expect(ids).toContain("p2:v2");
  });

  it("ignores a non-finite resolver value and keeps the env default", async () => {
    const matcher = createSupplierImageGeminiCaptionMatcher({
      fetcher: fakeFetcher(),
      config: { ...baseConfig, minCosine: 0 },
      resolveMinCosine: async () => Number.NaN,
    });
    const result = (await matcher(request, undefined)) as SupplierImageMatchResponse;

    // NaN is ignored → effectively minCosine 0 → b survives.
    expect(result.matches.map((m) => m.catalogItemId)).toContain("p2:v2");
  });
});
