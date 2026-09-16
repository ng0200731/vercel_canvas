import { z } from "zod";

export const IMAGE_GENERATION_MODEL_IDS = [
  "gpt-image-2",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "dall-e-3",
  "dall-e-2",
  "gemini-2.5-flash-image",
  "gemini-3-pro-image-preview",
  "gemini-3-pro-image-preview-2K",
  "gemini-3-pro-image-preview-4K",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-image-preview-2K",
  "gemini-3.1-flash-image-preview-4K",
] as const;

export const imageGenerationModelIdSchema = z.enum(IMAGE_GENERATION_MODEL_IDS);
export type ImageGenerationModelId = z.infer<typeof imageGenerationModelIdSchema>;

/** Models confirmed to work with Xiangsu's image generation endpoint. */
export const XIANGSU_IMAGE_MODEL_IDS = IMAGE_GENERATION_MODEL_IDS;
export const xiangsuImageModelIdSchema = z.enum(XIANGSU_IMAGE_MODEL_IDS);

export const imageGenerationResponseSchema = z.object({
  url: z.string().min(1),
  model: imageGenerationModelIdSchema,
});

export const imageGenerationErrorSchema = z.object({
  error: z.string().min(1),
});

export const MAX_IMAGE_GENERATION_REFERENCES = 14;

export const imageReferenceUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      if (value.startsWith("/")) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "data:";
      } catch {
        return false;
      }
    },
    { message: "Reference image must be an HTTP(S) URL or data URL." },
  );

export const imageGenerationReferenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    alias: z.string().trim().min(1).max(80),
    url: imageReferenceUrlSchema,
    maskUrl: imageReferenceUrlSchema.optional(),
  }),
  z.object({
    kind: z.literal("pantone"),
    alias: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
]);

export type ImageGenerationReference = z.infer<typeof imageGenerationReferenceSchema>;

// Canvas-facing size options. Each entry is identified by an aspect ratio; the
// actual output pixels are computed from the aspect ratio + resolution in
// lib/xiangsu.ts (see gptImageSizeForResolution) per the GPT Image 2 contract.
export const IMAGE_GENERATION_SIZES = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "1792x1024",
  "1024x1792",
  "1280x960",
  "960x1280",
  "1792x768",
  "768x1792",
] as const;
export const imageGenerationSizeSchema = z.enum(IMAGE_GENERATION_SIZES);
export type ImageGenerationSize = z.infer<typeof imageGenerationSizeSchema>;

export type ImageGenerationAspectRatio =
  | "1:1"
  | "3:2"
  | "2:3"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "21:9"
  | "9:21";

export const IMAGE_SIZE_STEP = 16;
export const IMAGE_SIZE_MIN_PIXELS = 655360;
export const IMAGE_SIZE_MAX_PIXELS = 8294400;
export const IMAGE_SIZE_MAX_LONG_EDGE = 3840;
export const IMAGE_SIZE_MAX_RATIO = 3;

const ASPECT_RATIO_BY_SIZE: Record<ImageGenerationSize, ImageGenerationAspectRatio> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
  "1792x1024": "16:9",
  "1024x1792": "9:16",
  "1280x960": "4:3",
  "960x1280": "3:4",
  "1792x768": "21:9",
  "768x1792": "9:21",
};

const SIZE_BY_RATIO: Record<ImageGenerationAspectRatio, ImageGenerationSize> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
  "16:9": "1792x1024",
  "9:16": "1024x1792",
  "4:3": "1280x960",
  "3:4": "960x1280",
  "21:9": "1792x768",
  "9:21": "768x1792",
};

// Fixed GPT Image 2 pixel table per the provider contract: rows = aspect ratio,
// columns = resolution (1K/low, 2K/medium, 4K/high).
const GPT_IMAGE_SIZE_TABLE: Record<ImageGenerationAspectRatio, {
  low: [number, number];
  medium: [number, number];
  high: [number, number];
}> = {
  "1:1": { low: [1024, 1024], medium: [2048, 2048], high: [2880, 2880] },
  "3:2": { low: [1536, 1024], medium: [2160, 1440], high: [3456, 2304] },
  "2:3": { low: [1024, 1536], medium: [1440, 2160], high: [2304, 3456] },
  "16:9": { low: [1280, 720], medium: [2560, 1440], high: [3840, 2160] },
  "9:16": { low: [720, 1280], medium: [1440, 2560], high: [2160, 3840] },
  "4:3": { low: [1024, 768], medium: [2048, 1536], high: [3200, 2400] },
  "3:4": { low: [768, 1024], medium: [1536, 2048], high: [2400, 3200] },
  "21:9": { low: [1920, 816], medium: [3120, 1344], high: [3840, 1648] },
  "9:21": { low: [816, 1920], medium: [1344, 3120], high: [1648, 3840] },
};

function alignToStep(value: number): number {
  return Math.max(IMAGE_SIZE_STEP, Math.round(value / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP);
}

/**
 * Align a width up to the 16-px step. Used when the minimum-pixel constraint
 * is binding — rounding to nearest can undershoot by up to half a step, so
 * the dependent dimension is rounded up to guarantee crossing the floor.
 */
function alignToStepUp(value: number): number {
  return Math.max(IMAGE_SIZE_STEP, Math.ceil(value / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP);
}

function clampAspect(width: number, height: number): { width: number; height: number } {
  if (width / height > IMAGE_SIZE_MAX_RATIO) {
    width = alignToStep(height * IMAGE_SIZE_MAX_RATIO);
  } else if (height / width > IMAGE_SIZE_MAX_RATIO) {
    height = alignToStep(width * IMAGE_SIZE_MAX_RATIO);
  }
  return { width, height };
}

/**
 * Scale an arbitrary pixel size to satisfy the provider's pixel-count bounds
 * (IMAGE_SIZE_MIN_PIXELS ≤ w*h ≤ IMAGE_SIZE_MAX_PIXELS), preserving aspect
 * ratio (clamped to IMAGE_SIZE_MAX_RATIO) and aligning to IMAGE_SIZE_STEP.
 *
 * Used for `matchSourceSize` requests where the source image's natural
 * dimensions fall outside the provider's accepted range — e.g. a 450×620
 * product photo (279k px) is below the 655,360 minimum and would be rejected
 * with "Invalid image size … total minimum number of pixels … must be at
 * least 655,360".
 */
export function sizeWithinProviderBounds(dims: {
  width: number;
  height: number;
}): { width: number; height: number } {
  const { width, height } = dims;
  if (!width || !height) return { width, height };
  const pixels = width * height;

  if (pixels < IMAGE_SIZE_MIN_PIXELS) {
    const scale = Math.sqrt(IMAGE_SIZE_MIN_PIXELS / pixels);
    const newHeight = alignToStepUp(height * scale);
    const newWidth = alignToStep(newHeight * (width / height));
    return clampAspect(newWidth, newHeight);
  }

  if (pixels > IMAGE_SIZE_MAX_PIXELS) {
    const scale = Math.sqrt(IMAGE_SIZE_MAX_PIXELS / pixels);
    const newWidth = alignToStep(width * scale);
    const newHeight = alignToStep(newWidth * (height / width));
    return clampAspect(newWidth, newHeight);
  }

  return clampAspect(alignToStep(width), alignToStep(height));
}

function dynamicGptImageSize(
  ratio: ImageGenerationAspectRatio,
  quality: "low" | "medium" | "high",
): [number, number] {
  // Unmapped ratios (1:2, 2:1, 5:4, 4:5, …) are computed from target pixel count
  // and aligned to the 16-px step. Targets roughly match the fixed-table totals.
  const targetPixels = quality === "high" ? 8_294_400 : quality === "medium" ? 4_147_200 : 1_036_800;
  const [rw, rh] = ratio.split(":").map(Number);
  const aspect = rw / rh;
  let height = alignToStep(Math.sqrt(targetPixels / aspect));
  let width = alignToStep(height * aspect);
  if (width > IMAGE_SIZE_MAX_LONG_EDGE) {
    width = IMAGE_SIZE_MAX_LONG_EDGE;
    if (width < height) [width, height] = [height, width];
  }
  if (height > IMAGE_SIZE_MAX_LONG_EDGE) height = IMAGE_SIZE_MAX_LONG_EDGE;
  if (width / height > IMAGE_SIZE_MAX_RATIO) {
    width = alignToStep(height * IMAGE_SIZE_MAX_RATIO);
  }
  return [width, height];
}

/** Wire-level output size for GPT Image 2, e.g. "2160x1440". */
export function gptImageSizeForResolution(
  size: ImageGenerationSize,
  resolution: ImageGenerationResolution,
): string {
  const ratio = aspectRatioForImageGenerationSize(size);
  const quality = gptImageQualityForResolution(resolution);
  const entry = GPT_IMAGE_SIZE_TABLE[ratio]?.[quality];
  if (entry) return `${entry[0]}x${entry[1]}`;
  const [w, h] = dynamicGptImageSize(ratio, quality);
  return `${w}x${h}`;
}

export function gptImageDimensionsForResolution(
  size: ImageGenerationSize,
  resolution: ImageGenerationResolution,
): { width: number; height: number } {
  const ratio = aspectRatioForImageGenerationSize(size);
  const quality = gptImageQualityForResolution(resolution);
  const entry = GPT_IMAGE_SIZE_TABLE[ratio]?.[quality];
  if (entry) return { width: entry[0], height: entry[1] };
  const [w, h] = dynamicGptImageSize(ratio, quality);
  return { width: w, height: h };
}

/** UI Resolution → provider quality. preview = low (1K), 2K = medium, 4K = high. */
export function gptImageQualityForResolution(
  resolution: ImageGenerationResolution,
): "low" | "medium" | "high" {
  if (resolution === "4K") return "high";
  if (resolution === "2K") return "medium";
  return "low";
}

export const IMAGE_GENERATION_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export const imageGenerationOutputFormatSchema = z.enum(IMAGE_GENERATION_OUTPUT_FORMATS);
export type ImageGenerationOutputFormat = z.infer<typeof imageGenerationOutputFormatSchema>;

export const IMAGE_GENERATION_RESOLUTIONS = ["preview", "2K", "4K"] as const;
export const imageGenerationResolutionSchema = z.enum(IMAGE_GENERATION_RESOLUTIONS);
export type ImageGenerationResolution = z.infer<typeof imageGenerationResolutionSchema>;

export const DEFAULT_IMAGE_GENERATION_SIZE: ImageGenerationSize = "1024x1024";
export const DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT: ImageGenerationOutputFormat = "webp";
export const DEFAULT_IMAGE_GENERATION_RESOLUTION: ImageGenerationResolution = "preview";

export const imageGenerationRequestSchema = z.object({
  model: xiangsuImageModelIdSchema,
  prompt: z.string().min(1).max(2000),
  systemPrompt: z.string().trim().max(2000).optional(),
  size: imageGenerationSizeSchema.optional().default(DEFAULT_IMAGE_GENERATION_SIZE),
  outputFormat: imageGenerationOutputFormatSchema
    .optional()
    .default(DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT),
  resolution: imageGenerationResolutionSchema
    .optional()
    .default(DEFAULT_IMAGE_GENERATION_RESOLUTION),
  references: z
    .array(imageGenerationReferenceSchema)
    .max(MAX_IMAGE_GENERATION_REFERENCES)
    .optional()
    .default([]),
  matchSourceSize: z.boolean().optional().default(false),
});

export const DEFAULT_IMAGE_GENERATION_MODEL: ImageGenerationModelId = "gpt-image-2";

export type ModelCapability = "image" | "text" | "video";
export type ModelFamily = "gemini-image" | "gpt-image" | "gpt-text" | "deepseek" | "seedance";

export interface ModelCatalogEntry {
  id: string;
  officialName: string;
  aliases: readonly string[];
  family: ModelFamily;
  capability: ModelCapability;
  enabled: boolean;
}

export interface ModelCatalogGroup {
  id: ModelFamily;
  label: string;
  entries: readonly ModelCatalogEntry[];
}

export const MODEL_CATALOG_GROUPS: readonly ModelCatalogGroup[] = [
  {
    id: "gemini-image",
    label: "Gemini Image Series",
    entries: [
      {
        id: "gemini-2.5-flash-image",
        officialName: "gemini-2.5-flash-image",
        aliases: ["Banana 1", "Nano Banana 1"],
        family: "gemini-image",
        capability: "image",
        enabled: false,
      },
      {
        id: "gemini-3-pro-image-preview",
        officialName: "gemini-3-pro-image-preview",
        aliases: ["Banana Pro", "Nano Banana Pro"],
        family: "gemini-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gemini-3-pro-image-preview-2K",
        officialName: "gemini-3-pro-image-preview-2K",
        aliases: ["Banana Pro", "Nano Banana Pro"],
        family: "gemini-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gemini-3-pro-image-preview-4K",
        officialName: "gemini-3-pro-image-preview-4K",
        aliases: ["Banana Pro", "Nano Banana Pro"],
        family: "gemini-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gemini-3.1-flash-image-preview",
        officialName: "gemini-3.1-flash-image-preview",
        aliases: ["Banana 2", "Nano Banana 2"],
        family: "gemini-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gemini-3.1-flash-image-preview-2K",
        officialName: "gemini-3.1-flash-image-preview-2K",
        aliases: ["Banana 2", "Nano Banana 2"],
        family: "gemini-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gemini-3.1-flash-image-preview-4K",
        officialName: "gemini-3.1-flash-image-preview-4K",
        aliases: ["Banana 2", "Nano Banana 2"],
        family: "gemini-image",
        capability: "image",
        enabled: true,
      },
    ],
  },
  {
    id: "gpt-image",
    label: "GPT Image Series",
    entries: [
      {
        id: "gpt-image-2",
        officialName: "gpt-image-2",
        aliases: ["DALL-E 3", "GPT Image V2"],
        family: "gpt-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gpt-image-2.5-flare",
        officialName: "gpt-image-2.5-flare",
        aliases: ["GPT Image 2.5 Flare", "GPT Image V2.5"],
        family: "gpt-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gpt-image-2.5-sunburst",
        officialName: "gpt-image-2.5-sunburst",
        aliases: ["GPT Image 2.5 Sunburst"],
        family: "gpt-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gpt-image-1.5",
        officialName: "gpt-image-1.5",
        aliases: ["GPT Image High Quality"],
        family: "gpt-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gpt-image-1",
        officialName: "gpt-image-1",
        aliases: ["GPT Image Standard"],
        family: "gpt-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "gpt-image-1-mini",
        officialName: "gpt-image-1-mini",
        aliases: ["GPT Image Economy"],
        family: "gpt-image",
        capability: "image",
        enabled: false,
      },
      {
        id: "dall-e-3",
        officialName: "dall-e-3",
        aliases: ["DALL-E 3 Legacy"],
        family: "gpt-image",
        capability: "image",
        enabled: true,
      },
      {
        id: "dall-e-2",
        officialName: "dall-e-2",
        aliases: ["DALL-E 2 Legacy"],
        family: "gpt-image",
        capability: "image",
        enabled: true,
      },
    ],
  },
  {
    id: "gpt-text",
    label: "GPT Text Series",
    entries: [
      {
        id: "gpt-5.2",
        officialName: "gpt-5.2",
        aliases: ["GPT5 Standard"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
      {
        id: "gpt-5.3-codex",
        officialName: "gpt-5.3-codex",
        aliases: ["GPT5 Code"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
      {
        id: "gpt-5.4",
        officialName: "gpt-5.4",
        aliases: ["GPT5 Lite", "GPT5 Fast"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
      {
        id: "gpt-5.4-mini",
        officialName: "gpt-5.4-mini",
        aliases: ["GPT5 Mini"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
      {
        id: "gpt-5.4-xhigh",
        officialName: "gpt-5.4-xhigh",
        aliases: ["GPT5 High Speed"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
      {
        id: "gpt-5.5",
        officialName: "gpt-5.5",
        aliases: ["GPT5 Mid"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
      {
        id: "gpt-5.5-xhigh",
        officialName: "gpt-5.5-xhigh",
        aliases: ["GPT5 Ultra High"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
      {
        id: "gpt-5.6-sol",
        officialName: "gpt-5.6-sol",
        aliases: ["GPT5 Sol", "Solar"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
      {
        id: "gpt-5.6-terra",
        officialName: "gpt-5.6-terra",
        aliases: ["GPT5 Terra", "Earth"],
        family: "gpt-text",
        capability: "text",
        enabled: false,
      },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek Series",
    entries: [
      {
        id: "deepseek-v3.1",
        officialName: "deepseek-v3.1",
        aliases: ["DeepSeek V3 Base"],
        family: "deepseek",
        capability: "text",
        enabled: false,
      },
      {
        id: "deepseek-v3.2",
        officialName: "deepseek-v3.2",
        aliases: ["DeepSeek V3 Base"],
        family: "deepseek",
        capability: "text",
        enabled: false,
      },
      {
        id: "deepseek-v4-flash",
        officialName: "deepseek-v4-flash",
        aliases: ["DeepSeek Flash"],
        family: "deepseek",
        capability: "text",
        enabled: false,
      },
      {
        id: "deepseek-v4-pro",
        officialName: "deepseek-v4-pro",
        aliases: ["DeepSeek Pro"],
        family: "deepseek",
        capability: "text",
        enabled: false,
      },
    ],
  },
  {
    id: "seedance",
    label: "Video Series",
    entries: [
      {
        id: "mg-seedance2.0",
        officialName: "mg-seedance2.0 (all variants)",
        aliases: ["Seedance 2", "MG Video V2"],
        family: "seedance",
        capability: "video",
        enabled: false,
      },
    ],
  },
] as const;

export const MODEL_CATALOG = MODEL_CATALOG_GROUPS.flatMap((group) => group.entries);

export function normalizeImageGenerationModel(value: unknown): ImageGenerationModelId {
  const parsed = xiangsuImageModelIdSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_IMAGE_GENERATION_MODEL;
}

export function normalizeImageGenerationSize(value: unknown): ImageGenerationSize {
  const parsed = imageGenerationSizeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_IMAGE_GENERATION_SIZE;
}

export function normalizeImageGenerationOutputFormat(value: unknown): ImageGenerationOutputFormat {
  const parsed = imageGenerationOutputFormatSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT;
}

export function normalizeImageGenerationResolution(value: unknown): ImageGenerationResolution {
  const parsed = imageGenerationResolutionSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_IMAGE_GENERATION_RESOLUTION;
}

export function resolutionForImageGenerationModel(
  model: ImageGenerationModelId,
): ImageGenerationResolution {
  if (model.endsWith("-4K")) return "4K";
  if (model.endsWith("-2K")) return "2K";
  return "preview";
}

export function geminiImageSizeForResolution(
  resolution: ImageGenerationResolution,
): "1K" | "2K" | "4K" {
  if (resolution === "4K") return "4K";
  if (resolution === "2K") return "2K";
  return "1K";
}

export function aspectRatioForImageGenerationSize(
  size: ImageGenerationSize,
): ImageGenerationAspectRatio {
  return ASPECT_RATIO_BY_SIZE[size];
}

export function imageGenerationSizeForAspectRatio(
  ratio: ImageGenerationAspectRatio,
): ImageGenerationSize {
  return SIZE_BY_RATIO[ratio];
}

/** Human-readable ratio label for UI, e.g. "16 : 9". */
export function aspectRatioLabel(ratio: ImageGenerationAspectRatio): string {
  return ratio.replace(":", " : ");
}

export function getModelCatalogEntry(model: ImageGenerationModelId): ModelCatalogEntry {
  const entry = MODEL_CATALOG.find((candidate) => candidate.id === model);
  if (!entry) throw new Error(`Missing model catalog entry for ${model}.`);
  return entry;
}

export function getModelDisplayName(model: string | null | undefined): string | null {
  if (!model) return null;
  const entry = MODEL_CATALOG.find((candidate) => candidate.id === model);
  return entry?.aliases.at(-1) ?? model;
}
