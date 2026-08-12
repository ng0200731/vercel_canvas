import { describe, expect, it, vi } from "vitest";

import { createSupplierImageMatchPostHandler } from "@/app/api/supplier-image-match/route";
import { SUPPLIER_MATCH_MODEL } from "@/lib/supplier-image-match";
import type { SupplierImageMatcher } from "@/lib/supplier-image-vector-match";

function post(body: unknown): Request {
  return new Request("http://localhost/api/supplier-image-match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  queryImage: { name: "reference.png", url: "https://images.example.com/reference.png" },
  catalog: [
    {
      catalogItemId: "product-1:variant-1",
      supplierId: "supplier-1",
      supplierName: "Selected Supplier",
      productId: "product-1",
      productSubject: "Woven label",
      productType: "woven-label",
      variantId: "variant-1",
      imageName: "woven.png",
      imageUrl: "https://images.example.com/woven.png",
      detail: "Soft woven label",
      material: "Polyester",
      colorNotes: "Black",
      parameters: {},
    },
  ],
  currentSupplierId: "supplier-1",
};

describe("POST /api/supplier-image-match", () => {
  it("rejects cross-supplier catalogs before searching", async () => {
    const matchPictureSherlock = vi.fn<SupplierImageMatcher>();
    const matchMilvus = vi.fn<SupplierImageMatcher>();
    const matchLocal = vi.fn<SupplierImageMatcher>();
    const matchEland = vi.fn<SupplierImageMatcher>();
    const handler = createSupplierImageMatchPostHandler({
      matchPictureSherlock,
      matchMilvus,
      matchLocal,
      matchEland,
      matchGemini: vi.fn<SupplierImageMatcher>(),
    });
    const response = await handler(
      post({
        ...validBody,
        catalog: [{ ...validBody.catalog[0], supplierId: "supplier-2" }],
      }),
    );

    expect(response.status).toBe(400);
    expect(matchPictureSherlock).not.toHaveBeenCalled();
    expect(matchMilvus).not.toHaveBeenCalled();
    expect(matchLocal).not.toHaveBeenCalled();
  });

  it("forwards the validated selected-supplier catalog to Picture Sherlock by default", async () => {
    const matchPictureSherlock = vi.fn<SupplierImageMatcher>().mockResolvedValue({
      matches: [
        {
          catalogItemId: "product-1:variant-1",
          similarity: 91.5,
          cosine: 0.83,
        },
      ],
      searchedCount: 1,
      model: SUPPLIER_MATCH_MODEL,
    });
    const matchMilvus = vi.fn<SupplierImageMatcher>();
    const matchLocal = vi.fn<SupplierImageMatcher>();
    const matchEland = vi.fn<SupplierImageMatcher>();
    const handler = createSupplierImageMatchPostHandler({
      matchPictureSherlock,
      matchMilvus,
      matchLocal,
      matchEland,
      matchGemini: vi.fn<SupplierImageMatcher>(),
    });
    const response = await handler(post(validBody));

    expect(response.status).toBe(200);
    expect(matchPictureSherlock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentSupplierId: "supplier-1",
        engine: "picture-sherlock",
      }),
      expect.any(AbortSignal),
    );
    expect(matchMilvus).not.toHaveBeenCalled();
    expect(matchLocal).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      searchedCount: 1,
      model: SUPPLIER_MATCH_MODEL,
    });
  });

  it("dispatches milvus engine to the Milvus matcher", async () => {
    const matchPictureSherlock = vi.fn<SupplierImageMatcher>();
    const matchMilvus = vi.fn<SupplierImageMatcher>().mockResolvedValue({
      matches: [
        {
          catalogItemId: "product-1:variant-1",
          similarity: 88,
          cosine: 0.76,
        },
      ],
      searchedCount: 1,
      model: "milvus-clip-vit-base-patch32",
    });
    const matchLocal = vi.fn<SupplierImageMatcher>();
    const matchEland = vi.fn<SupplierImageMatcher>();
    const handler = createSupplierImageMatchPostHandler({
      matchPictureSherlock,
      matchMilvus,
      matchLocal,
      matchEland,
      matchGemini: vi.fn<SupplierImageMatcher>(),
    });
    const response = await handler(post({ ...validBody, engine: "milvus" }));

    expect(response.status).toBe(200);
    expect(matchMilvus).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "milvus" }),
      expect.any(AbortSignal),
    );
    expect(matchPictureSherlock).not.toHaveBeenCalled();
    expect(matchLocal).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      model: "milvus-clip-vit-base-patch32",
    });
  });

  it("dispatches gemini engine to the Gemini matcher", async () => {
    const matchPictureSherlock = vi.fn<SupplierImageMatcher>();
    const matchMilvus = vi.fn<SupplierImageMatcher>();
    const matchLocal = vi.fn<SupplierImageMatcher>();
    const matchEland = vi.fn<SupplierImageMatcher>();
    const matchGemini = vi.fn<SupplierImageMatcher>().mockResolvedValue({
      matches: [
        {
          catalogItemId: "product-1:variant-1",
          similarity: 84,
          cosine: 0.68,
        },
      ],
      searchedCount: 1,
      model: "gemini-embedding-2",
    });
    const handler = createSupplierImageMatchPostHandler({
      matchPictureSherlock,
      matchMilvus,
      matchLocal,
      matchEland,
      matchGemini,
    });
    const response = await handler(post({ ...validBody, engine: "gemini" }));

    expect(response.status).toBe(200);
    expect(matchGemini).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "gemini" }),
      expect.any(AbortSignal),
    );
    expect(matchPictureSherlock).not.toHaveBeenCalled();
    expect(matchMilvus).not.toHaveBeenCalled();
    expect(matchLocal).not.toHaveBeenCalled();
    expect(matchEland).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      model: "gemini-embedding-2",
    });
  });

  it("dispatches local engine to the in-process matcher", async () => {
    const matchPictureSherlock = vi.fn<SupplierImageMatcher>();
    const matchMilvus = vi.fn<SupplierImageMatcher>();
    const matchLocal = vi.fn<SupplierImageMatcher>().mockResolvedValue({
      matches: [
        {
          catalogItemId: "product-1:variant-1",
          similarity: 79.4,
          cosine: 0.59,
        },
      ],
      searchedCount: 1,
      model: SUPPLIER_MATCH_MODEL,
    });
    const handler = createSupplierImageMatchPostHandler({
      matchPictureSherlock,
      matchMilvus,
      matchLocal,
      matchEland: vi.fn<SupplierImageMatcher>(),
      matchGemini: vi.fn<SupplierImageMatcher>(),
    });
    const response = await handler(post({ ...validBody, engine: "local" }));

    expect(response.status).toBe(200);
    expect(matchLocal).toHaveBeenCalledWith(
      expect.objectContaining({ engine: "local" }),
      expect.any(AbortSignal),
    );
    expect(matchPictureSherlock).not.toHaveBeenCalled();
    expect(matchMilvus).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      searchedCount: 1,
      model: SUPPLIER_MATCH_MODEL,
    });
  });

  it("maps provider failures to a 502 response", async () => {
    const handler = createSupplierImageMatchPostHandler({
      matchPictureSherlock: vi
        .fn<SupplierImageMatcher>()
        .mockRejectedValue(new Error("Embedding failed")),
      matchMilvus: vi.fn<SupplierImageMatcher>(),
      matchLocal: vi.fn<SupplierImageMatcher>(),
      matchEland: vi.fn<SupplierImageMatcher>(),
      matchGemini: vi.fn<SupplierImageMatcher>(),
    });
    const response = await handler(post(validBody));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Embedding failed" });
  });

  it("still accepts a Picture Sherlock-backed matcher payload", async () => {
    const handler = createSupplierImageMatchPostHandler({
      matchPictureSherlock: vi.fn<SupplierImageMatcher>().mockResolvedValue({
        matches: [
          {
            catalogItemId: "product-1:variant-1",
            similarity: 91.5,
            cosine: 0.83,
          },
        ],
        searchedCount: 1,
        model: "picture-sherlock-clip-vit-base-patch32",
      }),
      matchMilvus: vi.fn<SupplierImageMatcher>(),
      matchLocal: vi.fn<SupplierImageMatcher>(),
      matchEland: vi.fn<SupplierImageMatcher>(),
      matchGemini: vi.fn<SupplierImageMatcher>(),
    });
    const response = await handler(post(validBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      searchedCount: 1,
      model: "picture-sherlock-clip-vit-base-patch32",
    });
  });
});
