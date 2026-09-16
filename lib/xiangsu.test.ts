// @vitest-environment node
// The generator's default fetcher is undici's, so multipart bodies are undici's
// FormData/Blob (the same classes Node uses at runtime). jsdom can't represent
// those (its Blob/FormData are different classes undici rejects), so these tests
// must run in the node environment to match production.
import { describe, expect, it, vi } from "vitest";

import { createXiangsuImageGenerator } from "@/lib/xiangsu";

const sweaterDataUrl = "data:image/png;base64,c3dlYXRlcg==";
const vintageDataUrl = "data:image/png;base64,dmludGFnZQ==";

const input = {
  model: "gpt-image-2" as const,
  prompt: "A precise product photograph",
  size: "1024x1024" as const,
  outputFormat: "webp" as const,
  resolution: "preview" as const,
  references: [],
};

function formDataBody(body: BodyInit | null | undefined): FormData {
  // The generator's default fetcher is undici's, so the multipart body is
  // undici's FormData class — not the global `FormData`. Duck-type instead of
  // `instanceof` so the assertion holds regardless of the fetch implementation.
  expect(body).toBeTruthy();
  expect(typeof (body as FormData).get).toBe("function");
  expect(typeof (body as FormData).append).toBe("function");
  return body as FormData;
}

function stringFormValue(form: FormData, name: string): string {
  const value = form.get(name);
  expect(typeof value).toBe("string");
  return String(value);
}

describe("Xiangsu image generator", () => {
  it("converts a base64 response to a PNG data URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    await expect(generate(input)).resolves.toEqual({
      url: "data:image/png;base64,aW1hZ2U=",
      model: "gpt-image-2",
    });

    const [, request] = fetcher.mock.calls[0];
    expect(request?.headers).toEqual({
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      model: "gpt-image-2",
      prompt: expect.stringContaining(input.prompt),
      n: 1,
      size: "1024x1024",
      quality: "low",
      response_format: "b64_json",
      output_format: "png",
    });
  });

  it("appends the GPT Image spec suffix and maps size+quality from resolution", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }),
    );
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    await generate({
      ...input,
      size: "1536x1024",
      resolution: "2K",
    });

    const [, request] = fetcher.mock.calls[0];
    const body = JSON.parse(String(request?.body));
    expect(body.size).toBe("2160x1440");
    expect(body.quality).toBe("medium");
    expect(body.output_format).toBe("png");
    expect(body.response_format).toBe("b64_json");
    expect(body.prompt).toContain("必须严格按 3:2 宽高比生成");
    expect(body.prompt).toContain("输出分辨率必须为 2160x1440");
  });

  it("prefixes an optional system prompt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }),
    );
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    await generate({ ...input, systemPrompt: "You are a brand photographer." });

    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body as string));
    expect(body.prompt.startsWith("You are a brand photographer.\n\n")).toBe(true);
  });

  it("sends GPT image reference edits as ordered multipart image files with doc-compliant fields", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    await generate({
      ...input,
      prompt: "change @sweater texture to @vintage",
      references: [
        { kind: "image", alias: "vintage", url: vintageDataUrl },
        { kind: "image", alias: "sweater", url: sweaterDataUrl },
      ],
    });

    const [url, request] = fetcher.mock.calls[0];
    const form = formDataBody(request?.body);
    const images = form.getAll("image");
    expect(url).toBe("https://www.xiangsuai.cn/v1/images/edits");
    expect(request?.headers).toEqual({ Authorization: "Bearer secret" });
    expect(stringFormValue(form, "model")).toBe("gpt-image-2");
    expect(stringFormValue(form, "n")).toBe("1");
    expect(stringFormValue(form, "size")).toBe("1024x1024");
    expect(stringFormValue(form, "quality")).toBe("low");
    expect(stringFormValue(form, "response_format")).toBe("b64_json");
    expect(stringFormValue(form, "output_format")).toBe("png");
    expect(form.get("background")).toBeNull();
    expect(images).toHaveLength(2);
    expect(images[0]).toBeInstanceOf(Blob);
    expect(images[1]).toBeInstanceOf(Blob);
    expect((images[0] as Blob).type).toBe("image/png");
    expect((images[1] as Blob).type).toBe("image/png");
    expect(stringFormValue(form, "prompt")).toContain("Provider image 1 is @sweater");
    expect(stringFormValue(form, "prompt")).toContain("Provider image 2 is @vintage");
    expect(stringFormValue(form, "prompt")).toContain("Do not copy people, faces, bodies, poses");
  });

  it("sends Pantone color edits as the second multipart image", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [{ b64_json: "aW1hZ2U=" }] }));
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    await generate({
      ...input,
      prompt: "change @sweater color to @Yellow C and keep every detail from @sweater",
      references: [
        { kind: "image", alias: "sweater", url: sweaterDataUrl },
        { kind: "pantone", alias: "Yellow C", label: "Yellow C", hex: "#fedd00" },
      ],
    });

    const [, request] = fetcher.mock.calls[0];
    const form = formDataBody(request?.body);
    const images = form.getAll("image");
    const prompt = stringFormValue(form, "prompt");

    expect(images).toHaveLength(2);
    expect((images[0] as Blob).type).toBe("image/png");
    expect((images[1] as Blob).type).toBe("image/png");
    expect(prompt).toContain("Provider image 1 is @sweater");
    expect(prompt).toContain("Provider image 2 is @Yellow C");
    expect(prompt).toContain("solid Pantone color reference for Yellow C (#FEDD00)");
    expect(prompt).toContain("Provider image 1 / @sweater is the target/base image");
    expect(prompt).toContain("Provider image 2 / @Yellow C is only a color reference");
    expect(prompt).toContain("Preserve every detail from @sweater");
  });

  it("uses the native Gemini endpoint and parses its inline image", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } }] } },
        ],
      }),
    );
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    await expect(
      generate({
        model: "gemini-3.1-flash-image-preview",
        prompt: "change @sweater color to @Yellow C",
        size: "1536x1024",
        outputFormat: "png",
        resolution: "2K",
        references: [
          { kind: "image", alias: "sweater", url: sweaterDataUrl },
          { kind: "pantone", alias: "Yellow C", label: "Yellow C", hex: "#fedd00" },
        ],
      }),
    ).resolves.toEqual({
      url: "data:image/png;base64,aW1hZ2U=",
      model: "gemini-3.1-flash-image-preview",
    });
    const [url, request] = fetcher.mock.calls.at(-1) ?? [];
    expect(url).toBe(
      "https://www.xiangsuai.cn/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
    );
    expect((request?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    const body = JSON.parse(String(request?.body)) as {
      generationConfig: { imageConfig: { aspectRatio: string; imageSize: string } };
    };
    expect(body.generationConfig.imageConfig.aspectRatio).toBe("3:2");
    expect(body.generationConfig.imageConfig.imageSize).toBe("2K");
  });

  it("accepts a remote image URL", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: [{ url: "https://images.example/generated.png" }] }),
      );
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    await expect(generate(input)).resolves.toEqual({
      url: "https://images.example/generated.png",
      model: "gpt-image-2",
    });
  });

  it("accepts image_url, result_url, and output_url fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ image_url: { url: "https://images.example/image_url.png" } }],
      }),
    );
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });
    await expect(generate(input)).resolves.toEqual({
      url: "https://images.example/image_url.png",
      model: "gpt-image-2",
    });

    const fetcher2 = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: [{ result_url: "https://images.example/result.png" }] }),
    );
    await expect(
      createXiangsuImageGenerator({ apiKey: "secret", fetcher: fetcher2 })(input),
    ).resolves.toEqual({ url: "https://images.example/result.png", model: "gpt-image-2" });

    const fetcher3 = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ output: [{ output_url: "https://images.example/output.png" }] }),
    );
    await expect(
      createXiangsuImageGenerator({ apiKey: "secret", fetcher: fetcher3 })(input),
    ).resolves.toEqual({ url: "https://images.example/output.png", model: "gpt-image-2" });
  });

  it("rejects malformed JSON and missing image payloads", async () => {
    const invalidJson = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 200 }));
    const noImage = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [] }));

    await expect(
      createXiangsuImageGenerator({ apiKey: "secret", fetcher: invalidJson })(input),
    ).rejects.toThrow("invalid response");
    await expect(
      createXiangsuImageGenerator({ apiKey: "secret", fetcher: noImage })(input),
    ).rejects.toThrow("did not return an image");
  });

  it("sanitizes provider errors and requires a server key", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: "Authorization failed for secret-value" } },
          { status: 401 },
        ),
      );

    await expect(
      createXiangsuImageGenerator({ apiKey: "secret-value", fetcher })(input),
    ).rejects.toThrow("Authorization failed for [redacted]");
    await expect(createXiangsuImageGenerator({ apiKey: undefined })(input)).rejects.toThrow(
      "XIANGSU_API_KEY",
    );
  });

  it("maps raw fetch failures to a clearer provider connection error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      createXiangsuImageGenerator({ apiKey: "secret", fetcher })({
        ...input,
        model: "gemini-3-pro-image-preview",
      }),
    ).rejects.toThrow("provider connection failed");
  });

  it("does not impose a client-side timeout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        await new Promise((resolve) =>
          setTimeout(
            () => resolve(Response.json({ data: [{ b64_json: "aW1hZ2U=" }] })),
            20,
          ),
        ),
    );
    const generate = createXiangsuImageGenerator({ apiKey: "secret", fetcher });

    await expect(generate(input)).resolves.toMatchObject({ model: "gpt-image-2" });
  });

  it("forwards caller cancellation to the provider request", async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const generate = createXiangsuImageGenerator({
      apiKey: "secret",
      fetcher,
    });
    const controller = new AbortController();

    const request = generate(input, controller.signal);
    controller.abort(new DOMException("Stopped by user", "AbortError"));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
