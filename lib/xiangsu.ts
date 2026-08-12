import "server-only";

import { z } from "zod";

import { env } from "@/lib/env";
import type {
  ImageGenerationOutputFormat,
  ImageGenerationModelId,
  ImageGenerationReference,
  ImageGenerationResolution,
  ImageGenerationSize,
} from "@/lib/image-generation-models";
import {
  aspectRatioForImageGenerationSize,
  geminiImageSizeForResolution,
  gptImageQualityForResolution,
  gptImageSizeForResolution,
  sizeWithinProviderBounds,
  xiangsuImageModelIdSchema,
} from "@/lib/image-generation-models";
import { imageOutputSpecLine } from "@/lib/image-generation-spec";
import {
  compileReferencePrompt,
  orderedReferences,
  referencesForProvider,
  type ProviderImageReference,
} from "@/lib/reference-prompt";
import {
  alphaMapBbox,
  alphaMapFromBuffer,
  compositeAlphaShape,
} from "@/lib/mask-composite";
import sharp from "sharp";

const XIANGSU_GENERATION_URL = "https://www.xiangsuai.cn/v1/images/generations";
const XIANGSU_EDIT_URL = "https://www.xiangsuai.cn/v1/images/edits";
const XIANGSU_GEMINI_BASE_URL = "https://www.xiangsuai.cn/v1beta/models";

const providerImageSchema = z
  .object({
    b64_json: z.string().min(1).optional(),
    url: z.string().url().optional(),
    image_url: z
      .union([z.string().url(), z.object({ url: z.string().url() })])
      .optional(),
    result_url: z.string().url().optional(),
    output_url: z.string().url().optional(),
  })
  .passthrough();

const providerSuccessSchema = z
  .object({
    data: z.array(providerImageSchema).optional(),
    result: z.array(providerImageSchema).optional(),
    output: z.array(providerImageSchema).optional(),
    images: z.array(providerImageSchema).optional(),
    image: z.array(providerImageSchema).optional(),
  })
  .passthrough();

const geminiSuccessSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          parts: z.array(
            z
              .object({
                inlineData: z.object({ mimeType: z.string(), data: z.string().min(1) }).optional(),
                inline_data: z
                  .object({ mime_type: z.string(), data: z.string().min(1) })
                  .optional(),
              })
              .passthrough(),
          ),
        }),
      }),
    )
    .min(1),
});

const providerErrorSchema = z.object({
  error: z
    .union([
      z.string(),
      z.object({
        message: z.string().optional(),
      }),
    ])
    .optional(),
  message: z.string().optional(),
});

export interface XiangsuGenerateInput {
  model: ImageGenerationModelId;
  prompt: string;
  systemPrompt?: string;
  size: ImageGenerationSize;
  outputFormat: ImageGenerationOutputFormat;
  resolution: ImageGenerationResolution;
  references: ImageGenerationReference[];
  matchSourceSize?: boolean;
}

export interface XiangsuGenerateOutput {
  url: string;
  model: ImageGenerationModelId;
  /** Diagnostics captured during the request — the compiled prompt text
   * actually sent, the resolved alias→image/mask map, and the multipart
   * form fields. Populated only for GPT image edits; empty for Gemini. */
  diagnostics?: XiangsuGenerateDiagnostics;
}

export interface XiangsuGenerateDiagnostics {
  compiledPrompt: string;
  resolvedReferences: Array<{
    alias: string;
    role: "base-image-with-mask" | "base-image" | "reference-image" | "pantone";
    imageUrl?: string;
    maskUrl?: string;
    description?: string;
  }>;
  formFields: Record<string, string>;
  editMode?: "placement" | "color-only" | "texture";
}

interface XiangsuGeneratorOptions {
  apiKey: string | undefined;
  fetcher?: typeof fetch;
}

function providerErrorMessage(payload: unknown): string | null {
  const parsed = providerErrorSchema.safeParse(payload);
  if (!parsed.success) return null;
  if (typeof parsed.data.error === "string") return parsed.data.error;
  return parsed.data.error?.message ?? parsed.data.message ?? null;
}

function sanitizeMessage(message: string, apiKey: string): string {
  return message.replaceAll(apiKey, "[redacted]").slice(0, 500);
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

function isNetworkFetchError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("fetch failed")
  );
}

function promptContent(prompt: string, imageUrls: readonly string[]) {
  if (imageUrls.length === 0) return prompt;

  return [
    { type: "text" as const, text: prompt },
    ...imageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];
}

function isGptImageModel(model: ImageGenerationModelId): boolean {
  return model.startsWith("gpt-image");
}

function isDallEModel(model: ImageGenerationModelId): boolean {
  return model.startsWith("dall-e-");
}

function isGeminiImageModel(model: ImageGenerationModelId): boolean {
  return model.startsWith("gemini-");
}

async function geminiParts(
  prompt: string,
  imageUrls: readonly string[],
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const url of imageUrls) {
    const blob = await blobFromReferenceUrl(url, fetcher, signal);
    const data = Buffer.from(await blob.arrayBuffer()).toString("base64");
    parts.push({ inline_data: { mime_type: blob.type || "image/png", data } });
  }
  return parts;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "bin";
}

function blobFromDataUrl(url: string): Blob {
  const commaIndex = url.indexOf(",");
  if (!url.startsWith("data:") || commaIndex < 0) {
    throw new Error("Reference image data URL is invalid.");
  }

  const metadata = url.slice("data:".length, commaIndex);
  const metadataParts = metadata.split(";");
  const mimeType = metadataParts[0] || "application/octet-stream";
  const isBase64 = metadataParts.includes("base64");
  const payload = url.slice(commaIndex + 1);
  const bytes = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return new Blob([bytes], { type: mimeType });
}

async function blobFromReferenceUrl(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  if (url.startsWith("data:")) return blobFromDataUrl(url);

  // Relative URLs (e.g. legacy mask paths saved as "/uploads/masks/...") have
  // no origin to resolve against on the server; pin them to the public app URL.
  let target = url;
  if (url.startsWith("/")) {
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    target = `${baseUrl}${url}`;
  }

  const response = await fetcher(target, { signal });
  if (!response.ok) {
    throw new Error(`Reference image request failed with ${response.status}.`);
  }

  return response.blob();
}

async function appendEditImages(
  form: FormData,
  imageUrls: readonly string[],
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ width: number; height: number } | null> {
  let firstImageDimensions: { width: number; height: number } | null = null;
  for (const [index, imageUrl] of imageUrls.entries()) {
    const blob = await blobFromReferenceUrl(imageUrl, fetcher, signal);
    const extension = extensionForMimeType(blob.type);
    form.append("image", blob, `reference-${index + 1}.${extension}`);
    if (index === 0) {
      firstImageDimensions = await imageDimensions(blob);
    }
  }
  return firstImageDimensions;
}

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const buffer = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    if (meta.width && meta.height) return { width: meta.width, height: meta.height };
  } catch {
    // fall through to null
  }
  return null;
}

/**
 * Different ASPECT between the served base image and the mask means the mask
 * was drawn against a different image/variant (or a stale mask survived a
 * variant swap). A pure pixel-count mismatch (same aspect, different scale) is
 * benign — we resample the base into the mask's grid — but an aspect mismatch
 * would warp the user's highlight, so reject loudly instead of silently
 * producing a misaligned edit. Exported for unit testing.
 */
export function assertMaskAspectCompatible(
  baseDims: { width: number; height: number },
  maskDims: { width: number; height: number },
): void {
  if (!baseDims.height || !maskDims.height) return;
  const baseAspect = baseDims.width / baseDims.height;
  const maskAspect = maskDims.width / maskDims.height;
  const ASPECT_EPSILON = 1e-3; // ~0.1%
  if (Math.abs(baseAspect - maskAspect) > ASPECT_EPSILON) {
    throw new Error(
      `Mask (aspect ${maskAspect.toFixed(3)}) doesn't match the source image (aspect ${baseAspect.toFixed(3)}). Redraw the mask on the current image.`,
    );
  }
}

function isOpenAiEditEligible(input: XiangsuGenerateInput): boolean {
  if (!env.OPENAI_API_KEY) return false;
  // OpenAI images.edit supports a single base image + optional mask. Only
  // A/B test when there's exactly one reference image (the base) so the
  // request shape matches.
  return input.references.filter((r) => r.kind === "image").length === 1;
}

export function createXiangsuImageGenerator({
  apiKey,
  fetcher = fetch,
}: XiangsuGeneratorOptions) {
  return async function generateImage(
    input: XiangsuGenerateInput,
    requestSignal?: AbortSignal,
  ): Promise<XiangsuGenerateOutput> {
    const useOpenAi = env.OPENAI_API_KEY && isOpenAiEditEligible(input);
    const effectiveApiKey = useOpenAi ? env.OPENAI_API_KEY : apiKey;
    if (!effectiveApiKey) {
      throw new Error("AI generation is disabled. Set XIANGSU_API_KEY or OPENAI_API_KEY in .env.local.");
    }

    if (!xiangsuImageModelIdSchema.safeParse(input.model).success) {
      throw new Error("This model is not supported by Xiangsu image generation. Use GPT Image 2.");
    }

    const controller = new AbortController();
    const abortFromRequest = () => controller.abort(requestSignal?.reason);
    if (requestSignal?.aborted) {
      abortFromRequest();
    } else {
      requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
    }
    try {
      let compiled = compileReferencePrompt(input.prompt, input.references);
      const ordered = orderedReferences(input.prompt, referencesForProvider(input.references));
      const diagnosticsRef: { current?: XiangsuGenerateDiagnostics } = {};

      if (compiled.imageUrls.length > 0 && isDallEModel(input.model)) {
        throw new Error(
          "DALL-E models do not support reference-image editing. Use a GPT Image model.",
        );
      }

      const isGptModel = isGptImageModel(input.model);
      const isGemini = isGeminiImageModel(input.model);
      const gptQuality = gptImageQualityForResolution(input.resolution);
      const gptSize = gptImageSizeForResolution(input.size, input.resolution);
      const gptOutputFormat: ImageGenerationOutputFormat = isGptModel ? "png" : input.outputFormat;

      const systemPrompt = input.systemPrompt?.trim();
      const basePrompt = systemPrompt ? `${systemPrompt}\n\n${compiled.prompt}` : compiled.prompt;
      const specSuffix = imageOutputSpecLine({
        isGptModel,
        matchSourceSize: input.matchSourceSize,
        size: input.size,
        resolution: input.resolution,
      });
      const promptWithSpec = `${basePrompt}${specSuffix}`;

      const response = isGemini
        ? await fetcher(`${XIANGSU_GEMINI_BASE_URL}/${input.model}:generateContent`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: await geminiParts(
                    basePrompt,
                    compiled.imageUrls,
                    fetcher,
                    controller.signal,
                  ),
                },
              ],
              generationConfig: {
                imageConfig: {
                  aspectRatio: aspectRatioForImageGenerationSize(input.size),
                  imageSize: geminiImageSizeForResolution(input.resolution),
                },
              },
            }),
            signal: controller.signal,
          })
        : compiled.imageUrls.length > 0 && isGptModel
          ? await (async () => {
              // Route any mask-attached GPT edit through runMaskedTextureTransfer.
              // It uses the user's own (reference-resolved) prompt as the
              // instruction, sends only the base image to the provider, and
              // uses the mask only to compute a bounding box for the final
              // composite — so a rough brush highlight covers the whole object.
              if (compiled.maskUrl) {
                return await runMaskedTextureTransfer(
                  input,
                  ordered,
                  basePrompt,
                  gptQuality,
                  gptSize,
                  apiKey,
                  fetcher,
                  controller.signal,
                  diagnosticsRef,
                );
              }

              const form = new FormData();
              form.append("model", input.model);
              form.append("prompt", promptWithSpec);
              form.append("n", "1");
              form.append("quality", gptQuality);
              form.append("response_format", "b64_json");
              form.append("output_format", gptOutputFormat);
              const firstImageDimensions = await appendEditImages(
                form,
                compiled.imageUrls,
                fetcher,
                controller.signal,
              );
              if (compiled.maskUrl) {
                const maskBlob = await blobFromReferenceUrl(
                  compiled.maskUrl,
                  fetcher,
                  controller.signal,
                );
                const maskDimensions = await imageDimensions(maskBlob);
                if (
                  firstImageDimensions &&
                  maskDimensions &&
                  (firstImageDimensions.width !== maskDimensions.width ||
                    firstImageDimensions.height !== maskDimensions.height)
                ) {
                  throw new Error(
                    `Mask dimensions (${maskDimensions.width}x${maskDimensions.height}) don't match the source image (${firstImageDimensions.width}x${firstImageDimensions.height}). Redraw the mask on the current variant.`,
                  );
                }
                form.append("mask", maskBlob, "mask.png");
                if (input.matchSourceSize && firstImageDimensions) {
                  const providerSize = sizeWithinProviderBounds(firstImageDimensions);
                  form.append("size", `${providerSize.width}x${providerSize.height}`);
                } else {
                  form.append("size", gptSize);
                }
              } else {
                form.append("size", gptSize);
              }

              // Build diagnostics so the user can audit exactly what was sent.
              const resolvedReferences: XiangsuGenerateDiagnostics["resolvedReferences"] =
                compiled.imageUrls.map((url, index) => {
                  const alias = ordered[index]?.alias ?? `image-${index + 1}`;
                  const isBaseWithMask = index === 0 && Boolean(compiled.maskUrl);
                  return {
                    alias,
                    role: isBaseWithMask
                      ? "base-image-with-mask"
                      : "reference-image",
                    imageUrl: url,
                    maskUrl: isBaseWithMask ? compiled.maskUrl : undefined,
                    description: ordered[index]?.description,
                  };
                });
              const formFields: Record<string, string> = {
                model: input.model,
                prompt: promptWithSpec,
                n: "1",
                quality: gptQuality,
                response_format: "b64_json",
                output_format: gptOutputFormat,
              };
              for (let index = 0; index < compiled.imageUrls.length; index += 1) {
                formFields[`image[${index}]`] = compiled.imageUrls[index];
              }
              formFields.size = String(form.get("size") ?? "");
              if (compiled.maskUrl) formFields.mask = compiled.maskUrl;

              (diagnosticsRef as { current?: XiangsuGenerateDiagnostics }).current = {
                compiledPrompt: promptWithSpec,
                resolvedReferences,
                formFields,
              };

              const editUrl = env.OPENAI_API_KEY
                ? `${env.OPENAI_BASE_URL ?? "https://api.openai.com"}/v1/images/edits`
                : XIANGSU_EDIT_URL;
              const editAuth = env.OPENAI_API_KEY
                ? `Bearer ${env.OPENAI_API_KEY}`
                : `Bearer ${apiKey}`;

              return fetcher(editUrl, {
                method: "POST",
                headers: {
                  Authorization: editAuth,
                },
                body: form,
                signal: controller.signal,
              });
            })()
          : await fetcher(XIANGSU_GENERATION_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: input.model,
                prompt: promptWithSpec,
                n: 1,
                size: gptSize,
                quality: gptQuality,
                response_format: "b64_json",
                output_format: gptOutputFormat,
                ...(compiled.imageUrls.length > 0
                  ? {
                      image_urls: compiled.imageUrls,
                      content: promptContent(promptWithSpec, compiled.imageUrls),
                    }
                  : {}),
              }),
              signal: controller.signal,
            });

      let payload: unknown;
      try {
        if (response instanceof Response) {
          payload = await response.json();
        } else {
          // Two-pass path already produced a final result — return it directly.
          return response;
        }
      } catch {
        throw new Error("The image provider returned an invalid response.");
      }

      if (!(response instanceof Response) || !response.ok) {
        if (!(response instanceof Response)) {
          throw new Error("The image provider did not return a usable response.");
        }
        const message = providerErrorMessage(payload) ?? "The image provider rejected the request.";
        throw new Error(sanitizeMessage(message, effectiveApiKey ?? ""));
      }

      if (isGeminiImageModel(input.model)) {
        const parsedGemini = geminiSuccessSchema.safeParse(payload);
        if (!parsedGemini.success) throw new Error("The Gemini provider did not return an image.");
        const imagePart = parsedGemini.data.candidates[0].content.parts.find(
          (part) => part.inlineData || part.inline_data,
        );
        const inline = imagePart?.inlineData
          ? { mimeType: imagePart.inlineData.mimeType, data: imagePart.inlineData.data }
          : imagePart?.inline_data
            ? { mimeType: imagePart.inline_data.mime_type, data: imagePart.inline_data.data }
            : null;
        if (!inline) throw new Error("The Gemini provider did not return an image.");
        return {
          url: `data:${inline.mimeType};base64,${inline.data}`,
          model: input.model,
          diagnostics: diagnosticsRef.current,
        };
      }

      const parsed = providerSuccessSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("The image provider did not return an image.");
      }

      const list =
        parsed.data.data ??
        parsed.data.result ??
        parsed.data.output ??
        parsed.data.images ??
        parsed.data.image ??
        [];
      const image = list[0];
      if (!image) throw new Error("The image provider did not return an image.");

      const imageUrl =
        (typeof image.image_url === "string" ? image.image_url : image.image_url?.url) ??
        image.url ??
        image.result_url ??
        image.output_url;
      const url = imageUrl ?? (image.b64_json ? `data:image/png;base64,${image.b64_json}` : null);
      if (!url) throw new Error("The image provider did not return an image.");
      return { url, model: input.model, diagnostics: diagnosticsRef.current };
    } catch (error) {
      if (isAbortError(error)) {
        if (requestSignal?.aborted) {
          throw requestSignal.reason instanceof Error
            ? requestSignal.reason
            : new DOMException("Generation cancelled", "AbortError");
        }
        throw new Error("Image generation was aborted. Please try again.");
      }
      if (isNetworkFetchError(error)) {
        throw new Error(
          "The image provider connection failed. Please retry, or switch to GPT Image 2 / 1.5 Pro.",
        );
      }
      throw error;
    } finally {
      requestSignal?.removeEventListener("abort", abortFromRequest);
    }
  };
}

/**
 * Run a single GPT-image edit call. Returns the fetched image bytes
 * (PNG/JPEG/WebP) decoded from the provider response.
 */
async function callGptImageEdit(
  editUrl: string,
  authHeader: string,
  form: FormData,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetcher(editUrl, {
    method: "POST",
    headers: { Authorization: authHeader },
    body: form,
    signal,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The image provider returned an invalid response.");
  }
  if (!response.ok) {
    const message = providerErrorMessage(payload) ?? "The image provider rejected the request.";
    throw new Error(message);
  }

  const parsed = providerSuccessSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("The image provider did not return an image.");
  }
  const list =
    parsed.data.data ??
    parsed.data.result ??
    parsed.data.output ??
    parsed.data.images ??
    parsed.data.image ??
    [];
  const image = list[0];
  if (!image) throw new Error("The image provider did not return an image.");
  const b64 = image.b64_json ?? null;
  const remoteUrl =
    (typeof image.image_url === "string" ? image.image_url : image.image_url?.url) ??
    image.url ??
    image.result_url ??
    image.output_url;

  if (b64) {
    return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png" };
  }
  if (remoteUrl) {
    const imgRes = await fetcher(remoteUrl, { signal });
    if (!imgRes.ok) {
      throw new Error(`Download of generated image failed (${imgRes.status}).`);
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const mimeType = imgRes.headers.get("content-type") ?? "image/png";
    return { buffer: buf, mimeType };
  }
  throw new Error("The image provider did not return an image.");
}

/**
 * Single-pass masked edit.
 *
 * The user's brush highlight is rough intent, not a pixel-exact selection
 * (a thin stroke may cover ~1% of the image). We let `gpt-image` understand
 * the rough mask location and render the edit, then clip the result to the
 * mask's real shape — not a bounding rectangle:
 *   - The base image AND the mask PNG are both sent to the provider. OpenAI's
 *     images.edit convention is transparent = edit / opaque = keep, which
 *     matches our mask, so the model regenerates only inside the mask. This
 *     is the primary shape constraint.
 *   - The prompt also names the mask's bounding box in words so the model
 *     knows the rough area even before reading the mask pixels.
 *   - `compositeAlphaShape` then feathers the seam (small dilate + soft band)
 *     so the recolor blends with the surrounding fabric and nothing drifts
 *     outside the mask — but it is no longer the main clip, the provider is.
 *   - Color-only edits (Pantone target, no second image ref) keep a tighter
 *     feather to preserve the original pattern edge; object/material edits
 *     feather more so the new material blends with the surrounding garment.
 */
async function runMaskedTextureTransfer(
  input: XiangsuGenerateInput,
  ordered: ProviderImageReference[],
  compiledPrompt: string,
  gptQuality: string,
  gptSize: string,
  apiKey: string | undefined,
  fetcher: typeof fetch,
  signal: AbortSignal,
  diagnosticsRef: { current?: XiangsuGenerateDiagnostics },
): Promise<{ url: string; model: ImageGenerationModelId; diagnostics?: XiangsuGenerateDiagnostics }> {
  const maskCarrier = ordered.find((reference) => reference.maskUrl);
  if (!maskCarrier || !maskCarrier.url || !maskCarrier.maskUrl) {
    throw new Error("Masked texture transfer requires a base image with a mask.");
  }

  const editUrl = env.OPENAI_API_KEY
    ? `${env.OPENAI_BASE_URL ?? "https://api.openai.com"}/v1/images/edits`
    : XIANGSU_EDIT_URL;
  const editAuth = env.OPENAI_API_KEY
    ? `Bearer ${env.OPENAI_API_KEY}`
    : `Bearer ${apiKey}`;

  // Fetch base and mask bytes.
  const baseBlob = await blobFromReferenceUrl(maskCarrier.url, fetcher, signal);
  const maskBlob = await blobFromReferenceUrl(maskCarrier.maskUrl, fetcher, signal);
  const baseBuffer = Buffer.from(await baseBlob.arrayBuffer());
  const maskBuffer = Buffer.from(await maskBlob.arrayBuffer());
  const baseDims = await imageDimensions(baseBlob);
  const maskDims = await imageDimensions(maskBlob);

  // The mask is GROUND TRUTH for the coordinate grid: it was built client-side
  // at the natural dims of the image the user actually saw and drew on (see
  // createMaskFromG2Regions + g2-node.onGenerate). The served base is the same
  // image, so its aspect should match the mask's aspect; only their pixel
  // counts may differ (e.g. a scaled upload at MAX_DIMENSION=1280). The previous
  // version resized the MASK onto the base's pixel dims with `fit: "fill"`,
  // which independently stretches each axis — a different aspect deforms which
  // pixels are transparent and the edit lands shifted/scaled relative to the
  // highlight. We instead resample the BASE into the MASK's grid and send the
  // mask UNSTRETCHED, so the transparent region is exactly where the user drew.
  //
  // Guard first (mirrors the sibling masked path at the `compiled.maskUrl`
  // branch above): different ASPECT means the mask was drawn against a
  // different image/variant — reject loudly instead of silently warping. A pure
  // pixel-count mismatch (same aspect) is benign and resolved by the resample.
  if (baseDims && maskDims && baseDims.height > 0 && maskDims.height > 0) {
    assertMaskAspectCompatible(baseDims, maskDims);
  }

  // Pin every downstream coordinate space (alpha map, bbox, size, composite)
  // to the mask's native grid — the grid the user drew on.
  const baseWidth = maskDims?.width ?? baseDims?.width ?? 0;
  const baseHeight = maskDims?.height ?? baseDims?.height ?? 0;

  // Re-encode the mask as PNG preserving its native dims (`ensureAlpha`
  // guarantees channel 3 exists for `alphaMapFromBuffer` downstream). The mask
  // is NOT resized here — its transparent region must stay exactly where the
  // user drew it. Mask convention (OpenAI images.edit, and this codebase):
  // alpha = 0 (transparent) = the region to edit; alpha = 255 (opaque) = keep.
  const maskPngBuffer = await sharp(maskBuffer).ensureAlpha().png().toBuffer();

  // Re-encode the base as PNG and resample it INTO the mask's grid. The aspect
  // guard above guarantees aspect matches, so `fit: "fill"` is a near-1:1
  // resample that does not deform content. kernel: "nearest" avoids smearing
  // detail; acceptable for the base (photographic) since the aspect match makes
  // the scale factor uniform across both axes. Base is the only image sent to
  // the provider (other image refs were dropped by compileReferencePrompt), so
  // it must share the mask's grid for the provider's mask clip to land right.
  const basePngBuffer =
    baseWidth && baseHeight
      ? await sharp(baseBuffer)
          .ensureAlpha()
          .resize(baseWidth, baseHeight, { fit: "fill", kernel: "nearest" })
          .png()
          .toBuffer()
      : await sharp(baseBuffer).png().toBuffer();

  // --- Prompt -------------------------------------------------------------
  // Use the user's own (reference-resolved) instruction from
  // compileReferencePrompt rather than overwriting it with a hardcoded
  // texture-transfer template. That compiled prompt already contains the
  // "Reference image mapping:" header, the user instruction verbatim
  // (e.g. "change color to @pantone"), and every applicable constraint
  // (colour/texture/object transfer, mask guidance). We only append the
  // output-format spec line so the model keeps the base image's aspect ratio.
  const specSuffix = imageOutputSpecLine({
    isGptModel: true,
    matchSourceSize: input.matchSourceSize,
    size: input.size,
    resolution: input.resolution,
  });
  const passPrompt = `${compiledPrompt}${specSuffix}`;

  // --- Edit kind + mask shape --------------------------------------------
  // Decide whether this is a color-only change (target reference is a Pantone
  // swatch and no second *image* reference is attached) or an object/
  // material change. Color-only edits should preserve the original pattern;
  // object/material edits legitimately let the model repaint texture inside
  // the mask.
  const isColorOnly =
    ordered.some((reference) => reference.source === "pantone") &&
    !ordered.some(
      (reference) => reference !== maskCarrier && reference.source === "image",
    );

  // The mask's bounding box (in base-pixel space) is used both as a textual
  // spatial cue in the prompt and for diagnostics. The highlight is rough
  // intent, so we do NOT collapse the edit to this rectangle — the actual
  // mask is sent to the provider and the local composite follows its shape.
  const rawAlphaMap =
    baseWidth && baseHeight
      ? await alphaMapFromBuffer(maskPngBuffer, baseWidth, baseHeight)
      : null;
  const maskBboxBase = rawAlphaMap ? alphaMapBbox(rawAlphaMap) : null;

  // Rough-location cue: tell the model the bbox in words so even without the
  // attached mask it knows where to focus. Strict wording — the stroke is a
  // literal selection, not a hint to expand the edit to a neighbouring object.
  const locationCue =
    maskBboxBase && baseWidth && baseHeight
      ? `\n\nMask region (exact): bounding box (${maskBboxBase.minX},${maskBboxBase.minY})–(${maskBboxBase.maxX},${maskBboxBase.maxY}) on a ${baseWidth}×${baseHeight}px image. Recolor ONLY the pixels inside the attached alpha mask; do not recolor any neighbouring panel, seam, or object of the same material — the stroke is a literal selection, not a hint.`
      : "";

  const form = new FormData();
  form.append("model", input.model);
  form.append("prompt", `${passPrompt}${locationCue}`);
  form.append("n", "1");
  form.append("quality", gptQuality);
  form.append("response_format", "b64_json");
  form.append("output_format", "png");
  form.append("image[]", new Blob([new Uint8Array(basePngBuffer)], { type: "image/png" }), "base.png");
  // Attach every auxiliary image reference (image[1..]) so the model has real
  // source pixels to draw from when filling the transparent region — e.g. a
  // "paste @product in this region" edit needs the product image, not just its
  // alias name. compileReferencePrompt no longer drops image refs when a mask
  // is attached, so `ordered` carries them after the maskCarrier (base).
  const auxiliaryImageRefs = ordered.filter((reference) => reference !== maskCarrier && reference.source === "image");
  const auxiliaryImageUrls: string[] = [];
  for (const reference of auxiliaryImageRefs) {
    if (!reference.url) continue;
    try {
      const auxBlob = await blobFromReferenceUrl(reference.url, fetcher, signal);
      const auxBuffer = Buffer.from(await auxBlob.arrayBuffer());
      const auxPngBuffer = await sharp(auxBuffer).ensureAlpha().png().toBuffer();
      form.append("image[]", new Blob([new Uint8Array(auxPngBuffer)], { type: "image/png" }), `${reference.alias}.png`);
      auxiliaryImageUrls.push(reference.url);
    } catch {
      // If an auxiliary fetch fails, continue without it — the prompt still
      // names the alias and the object/material constraint guides the model.
    }
  }
  // Send the actual mask PNG (OpenAI edit convention: transparent = edit,
  // opaque = keep) so the model regenerates only inside it. This is the primary
  // shape constraint — the local composite below only feathers the seam and
  // guards against drift outside the mask. The mask is sent UNSTRETCHED, in the
  // grid the user drew on.
  if (maskPngBuffer.length > 0) {
    form.append("mask", new Blob([new Uint8Array(maskPngBuffer)], { type: "image/png" }), "mask.png");
  }

  // Declared output size MUST follow the grid we actually send (base + mask are
  // at maskDims — the user's drawing grid). Previously, when `matchSourceSize`
  // was off this sent an unrelated `gptSize` (e.g. 1024x1024) while base+mask
  // were at natural dims; a relay that resamples its input to `size` before
  // applying the mask then shifted the mask's pixel grid and the edit landed
  // off-target. With a mask attached the output is pixel-aligned to the base, so
  // size is derived from baseWidth/baseHeight (= maskDims) for both modes. The
  // user's `size`/`resolution` selectors still control the quality tier via
  // `gptQuality` above; the masked path ignores them for output dims on
  // purpose. `sizeWithinProviderBounds` clamps to the 16-px step + provider
  // min/max px so the declared size stays relay-acceptable.
  const providerSize =
    baseWidth && baseHeight
      ? sizeWithinProviderBounds({ width: baseWidth, height: baseHeight })
      : null;
  form.append("size", providerSize ? `${providerSize.width}x${providerSize.height}` : gptSize);

  const result = await callGptImageEdit(editUrl, editAuth, form, fetcher, signal);

  // --- Final composite --------------------------------------------------
  // The provider already clipped the repaint to the mask. Composite locally
  // only to feather the seam (small dilate to round the raw stroke edge +
  // soft band) so the recolor blends with the surrounding fabric and
  // nothing drifts outside the mask. A color-only edit keeps a tighter edge
  // to preserve the original pattern; an object edit feathers more so the
  // new material blends with the surrounding garment.
  //
  // NOTE: compositeAlphaShape resizes the provider's output to its own
  // `width×height` derived from `baseBuffer`'s metadata (the ORIGINAL served
  // base, not the resampled grid). The mask passed here is `maskPngBuffer`,
  // which is in the mask's native dims. alphaMapFromBuffer inside the
  // composite resamples the mask to the base's metadata dims with
  // kernel: "nearest" — aspect already matches (guarded above), so this is a
  // near-1:1 resample and the transparent region stays aligned. To keep the
  // composite in a single coordinate space we pass the RESAMPLED base
  // (`basePngBuffer`, already at maskDims) so its metadata dims equal the
  // mask's grid, and the provider output is resized to that same grid.
  let finalBuffer: Buffer;
  // Edit mode: a "placement" edit has a real auxiliary image attached (a
  // product photo to paste). Those need a TIGHT seam — the pasted content's
  // edges must stay crisp, not be dilated/feathered into a halo (which is what
  // reads as "the region is now blurred"). Color-only stays tight to preserve
  // the original pattern; texture/material keeps the existing feathering so a
  // new material blends with surrounding fabric.
  const isPlacement =
    !isColorOnly &&
    ordered.some((reference) => reference !== maskCarrier && reference.source === "image");
  const editMode: "placement" | "color-only" | "texture" = isPlacement
    ? "placement"
    : isColorOnly
      ? "color-only"
      : "texture";
  if (baseWidth && baseHeight && maskPngBuffer.length > 0) {
    const bboxShortSide = maskBboxBase
      ? Math.min(maskBboxBase.width, maskBboxBase.height)
      : 0;
    const isThinMask = bboxShortSide > 0 && bboxShortSide < 24;
    let dilate: number;
    let feather: number;
    if (isPlacement) {
      // Crisp seam — preserve the pasted product's edge. A 1px feather just
      // softens the single-pixel boundary anti-alias; no dilation.
      dilate = 0;
      feather = 2;
    } else if (isColorOnly) {
      dilate = 2;
      feather = 3;
    } else if (isThinMask) {
      dilate = 6;
      feather = 8;
    } else {
      dilate = 2;
      feather = 6;
    }
    finalBuffer = await compositeAlphaShape(basePngBuffer, result.buffer, maskPngBuffer, {
      dilate,
      feather,
    });
  } else {
    finalBuffer = result.buffer;
  }

  // --- Diagnostics ------------------------------------------------------
  const passPromptWithCue = `${passPrompt}${locationCue}`;
  (diagnosticsRef as { current?: XiangsuGenerateDiagnostics }).current = {
    compiledPrompt: passPromptWithCue,
    resolvedReferences: ordered.map((reference) => ({
      alias: reference.alias,
      role: reference === maskCarrier ? ("base-image-with-mask" as const) : reference.source === "pantone" ? ("pantone" as const) : ("reference-image" as const),
      imageUrl: reference.url,
      maskUrl: reference === maskCarrier ? reference.maskUrl : undefined,
      description: reference.description,
    })),
    formFields: {
      model: input.model,
      prompt: passPromptWithCue,
      "image[0]": maskCarrier.url,
      ...Object.fromEntries(auxiliaryImageUrls.map((url, index) => [`image[${index + 1}]`, url])),
      ...(maskPngBuffer.length > 0 ? { mask: maskCarrier.maskUrl ?? "(attached png)" } : {}),
      ...(maskBboxBase ? { maskBbox: `${maskBboxBase.minX},${maskBboxBase.minY} ${maskBboxBase.maxX},${maskBboxBase.maxY} (${maskBboxBase.width}x${maskBboxBase.height})` } : {}),
      size: String(form.get("size") ?? ""),
      editMode,
    },
  };

  // Upload final buffer via /api/uploads.
  const uploadForm = new FormData();
  uploadForm.append(
    "file",
    new Blob([new Uint8Array(finalBuffer)], { type: "image/png" }),
    "masked-texture-result.png",
  );
  const uploadRes = await fetcher(
    `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/uploads`,
    {
      method: "POST",
      body: uploadForm,
      signal,
    },
  ).catch(() => null);

  if (uploadRes && uploadRes.ok) {
    const body = (await uploadRes.json().catch(() => null)) as { url?: string } | null;
    if (body?.url) {
      return { url: body.url, model: input.model, diagnostics: diagnosticsRef.current };
    }
  }

  const dataUrl = `data:image/png;base64,${finalBuffer.toString("base64")}`;
  return { url: dataUrl, model: input.model, diagnostics: diagnosticsRef.current };
}

export const generateXiangsuImage = createXiangsuImageGenerator({
  apiKey: env.XIANGSU_API_KEY,
});
