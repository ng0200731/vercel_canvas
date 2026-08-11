import { describe, expect, it, vi } from "vitest";

import { createXiangsuImageGenerator } from "@/lib/xiangsu";

// Real 1x1 PNGs for testing
const redPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const transparentPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const input = {
  model: "gpt-image-2" as const,
  prompt: "A precise product photograph",
  size: "1024x1024" as const,
  outputFormat: "webp" as const,
  resolution: "preview" as const,
  references: [],
};

function formDataBody(body: BodyInit | null | undefined): FormData {
  expect(body).toBeInstanceOf(FormData);
  return body as FormData;
}

function stringFormValue(form: FormData, name: string): string {
  const value = form.get(name);
  expect(typeof value).toBe("string");
  return String(value);
}

describe("Xiangsu multi-mask generation", () => {
  it("splits promptRows by mask and makes sequential edit calls, compositing each result", async () => {
    // Mock fetcher to handle sequential calls:
    // 1. First edit call for mask "ll" (pantone)
    // 2. Second edit call for mask "5" (supplier)
    // 3. Third edit call for mask "rr" (woven)
    // 4. Upload call for final composited result
    // 5. Fetch of each uploaded result URL for compositing
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v1/images/edits")) {
        // Return a valid PNG for each edit call
        return Response.json({ data: [{ b64_json: redPng.replace("data:image/png;base64,", "") }] });
      }
      if (url.includes("/api/uploads")) {
        return Response.json({ url: "https://images.example/multi-mask-result.png" });
      }
      if (url.startsWith("https://images.example/")) {
        // Return the actual image bytes for the uploaded result URL
        return new Response(Buffer.from(redPng.split(",")[1], "base64"), {
          headers: { "Content-Type": "image/png" },
        });
      }
      return Response.json({});
    });

    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    const promptRows = [
      {
        id: "row-1",
        sourceNodeId: "product-node",
        maskId: "mask-ll",
        changeType: "color" as const,
        targetText: "@pantone",
        maskUrl: transparentPng,
      },
      {
        id: "row-2",
        sourceNodeId: "product-node",
        maskId: "mask-5",
        changeType: "object" as const,
        targetText: "@supplier",
        maskUrl: transparentPng,
      },
      {
        id: "row-3",
        sourceNodeId: "product-node",
        maskId: "mask-rr",
        changeType: "texture" as const,
        targetText: "@woven",
        maskUrl: transparentPng,
      },
    ];

    const result = await generate({
      ...input,
      prompt: "apply @pantone to the mask ll @product\napply @supplier to the mask 5\napply @woven to the mask rr",
      references: [
        { kind: "image", alias: "product", url: redPng },
        { kind: "pantone", alias: "pantone", label: "Pantone 18-1763", hex: "#e53e3e" },
        { kind: "image", alias: "supplier", url: redPng },
        { kind: "image", alias: "woven", url: redPng },
      ],
      promptRows,
    });

    expect(result.url).toBe("https://images.example/multi-mask-result.png");
    // Should make 3 edit calls + 1 upload call = 4 total (filtering out internal fetches)
    const editCalls = fetcher.mock.calls.filter(([url]) => String(url).includes("/v1/images/edits"));
    const uploadCalls = fetcher.mock.calls.filter(([url]) => String(url).includes("/api/uploads"));
    expect(editCalls.length).toBe(3);
    expect(uploadCalls.length).toBe(1);

    // Each edit call should carry a mask and a focused prompt naming the
    // target alias for that group (@pantone / @supplier / @woven), proving
    // the rows were split per-mask rather than bundled into one request.
    const editForms = editCalls.map(([, req]) => req?.body as FormData);
    expect(editForms.length).toBe(3);
    expect(editForms.every((form) => form.get("mask") instanceof Blob)).toBe(true);
    const editTargets = editForms.map((form) => String(form.get("prompt")));
    expect(editTargets.some((p) => p.includes("@pantone"))).toBe(true);
    expect(editTargets.some((p) => p.includes("@supplier"))).toBe(true);
    expect(editTargets.some((p) => p.includes("@woven"))).toBe(true);
  });

  it("falls back to single-mask path when no promptRows have maskUrl", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: [{ b64_json: redPng.replace("data:image/png;base64,", "") }] })
    );
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    // No promptRows, or promptRows without maskUrl
    const result = await generate({
      ...input,
      prompt: "change @product texture to @vintage",
      references: [
        { kind: "image", alias: "product", url: redPng, maskUrl: transparentPng },
        { kind: "image", alias: "vintage", url: redPng },
      ],
      promptRows: [],
    });

    expect(result.url).toBeDefined();
    // Only 1 edit call (no upload in single-mask path when upload fails)
    const editCalls = fetcher.mock.calls.filter(([url]) => String(url).includes("/v1/images/edits"));
    expect(editCalls.length).toBe(1);
  });

  it("handles multiple masks on the same base image with different target types", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v1/images/edits")) {
        return Response.json({ data: [{ b64_json: redPng.replace("data:image/png;base64,", "") }] });
      }
      if (url.includes("/api/uploads")) {
        return Response.json({ url: "https://images.example/multi-mask-result.png" });
      }
      if (url.startsWith("https://images.example/")) {
        return new Response(Buffer.from(redPng.split(",")[1], "base64"), {
          headers: { "Content-Type": "image/png" },
        });
      }
      return Response.json({});
    });

    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    const promptRows = [
      {
        id: "row-1",
        sourceNodeId: "product-node",
        maskId: "mask-collar",
        changeType: "color" as const,
        targetText: "@pantone",
        maskUrl: transparentPng,
      },
      {
        id: "row-2",
        sourceNodeId: "product-node",
        maskId: "mask-sleeve",
        changeType: "texture" as const,
        targetText: "@supplier",
        maskUrl: transparentPng,
      },
    ];

    const result = await generate({
      ...input,
      prompt: "apply @pantone to the mask collar @product\napply @supplier to the mask sleeve",
      references: [
        { kind: "image", alias: "product", url: redPng },
        { kind: "pantone", alias: "pantone", label: "Pantone 19-4052", hex: "#3b82f6" },
        { kind: "image", alias: "supplier", url: redPng },
      ],
      promptRows,
    });

    expect(result.url).toBe("https://images.example/multi-mask-result.png");
    // 2 edit calls + 1 upload +
    const editCalls = fetcher.mock.calls.filter(([url]) => String(url).includes("/v1/images/edits"));
    const uploadCalls = fetcher.mock.calls.filter(([url]) => String(url).includes("/api/uploads"));
    expect(editCalls.length).toBe(2);
    expect(uploadCalls.length).toBe(1);

    // Each edit call carries a mask and a focused prompt naming one target.
    const editForms = editCalls.map(([, req]) => req?.body as FormData);
    expect(editForms.length).toBe(2);
    expect(editForms.every((form) => form.get("mask") instanceof Blob)).toBe(true);
    const editTargets = editForms.map((form) => String(form.get("prompt")));
    expect(editTargets.some((p) => p.includes("@pantone"))).toBe(true);
    expect(editTargets.some((p) => p.includes("@supplier"))).toBe(true);
  });

  it("ignores null/non-object promptRows instead of throwing 'reading sourceNodeId'", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/v1/images/edits")) {
        return Response.json({ data: [{ b64_json: redPng.replace("data:image/png;base64,", "") }] });
      }
      if (url.includes("/api/uploads")) {
        return Response.json({ url: "https://images.example/multi-mask-result.png" });
      }
      if (url.startsWith("https://images.example/")) {
        return new Response(Buffer.from(redPng.split(",")[1], "base64"), {
          headers: { "Content-Type": "image/png" },
        });
      }
      if (url.startsWith("data:")) {
        return new Response(Buffer.from(redPng.split(",")[1], "base64"), {
          headers: { "Content-Type": "image/png" },
        });
      }
      return Response.json({});
    });

    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    // A malformed row alongside a good one. The `undefined`/`null` slots must
    // not crash the filter with a TypeError — they are dropped.
    const promptRows = ([
      null,
      undefined,
      { id: "row-1", sourceNodeId: "product-node", maskId: "mask-ll", changeType: "color", targetText: "@pantone", maskUrl: transparentPng },
      { id: "row-2" },
      "not-a-row",
    ] as unknown[]) as Parameters<typeof generate>[0]["promptRows"];

    const result = await generate({
      ...input,
      prompt: "apply @pantone to the mask ll @product",
      references: [
        { kind: "image", alias: "product", url: redPng },
        { kind: "pantone", alias: "pantone", label: "Pantone 18-1763", hex: "#e53e3e" },
      ],
      promptRows,
    });

    expect(result.url).toBe("https://images.example/multi-mask-result.png");
    const editCalls = fetcher.mock.calls.filter(([url]) => String(url).includes("/v1/images/edits"));
    // Only the one well-formed row should drive an edit call.
    expect(editCalls.length).toBe(1);
  });
});