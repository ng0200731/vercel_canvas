import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODEL_IDS,
  MODEL_CATALOG,
  MODEL_CATALOG_GROUPS,
  aspectRatioForImageGenerationSize,
  geminiImageSizeForResolution,
  getModelDisplayName,
  gptImageQualityForResolution,
  gptImageSizeForResolution,
  normalizeImageGenerationOutputFormat,
  normalizeImageGenerationResolution,
  normalizeImageGenerationSize,
  normalizeImageGenerationModel,
  resolutionForImageGenerationModel,
} from "@/lib/image-generation-models";

describe("image generation model catalog", () => {
  it("keeps only currently available image models enabled", () => {
    expect(DEFAULT_IMAGE_GENERATION_MODEL).toBe("gpt-image-2");
    expect(
      IMAGE_GENERATION_MODEL_IDS.filter(
        (id) => MODEL_CATALOG.find((entry) => entry.id === id)?.enabled,
      ),
    ).toEqual([
      "gpt-image-2",
      "gpt-image-2.5-flare",
      "gpt-image-2.5-sunburst",
      "gpt-image-1.5",
      "gpt-image-1",
      "dall-e-3",
      "dall-e-2",
      "gemini-3-pro-image-preview",
      "gemini-3-pro-image-preview-2K",
      "gemini-3-pro-image-preview-4K",
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-image-preview-2K",
      "gemini-3.1-flash-image-preview-4K",
    ]);
  });

  it("shows disabled entries for unavailable image, text, and video models", () => {
    const disabledEntries = MODEL_CATALOG.filter((entry) => !entry.enabled);
    expect(disabledEntries.length).toBeGreaterThan(0);
    expect(disabledEntries.some((entry) => entry.id === "gemini-2.5-flash-image")).toBe(true);
    expect(disabledEntries.some((entry) => entry.id === "gpt-image-1-mini")).toBe(true);
    expect(disabledEntries.some((entry) => entry.aliases.includes("GPT5 Standard"))).toBe(true);
    expect(disabledEntries.some((entry) => entry.aliases.includes("DeepSeek Flash"))).toBe(true);
    expect(disabledEntries.some((entry) => entry.aliases.includes("Seedance 2"))).toBe(true);
  });

  it("keeps all requested catalog groups and aliases", () => {
    expect(MODEL_CATALOG_GROUPS.map((group) => group.label)).toEqual([
      "Gemini Image Series",
      "GPT Image Series",
      "GPT Text Series",
      "DeepSeek Series",
      "Video Series",
    ]);
    expect(
      MODEL_CATALOG.find((entry) => entry.id === "gemini-3.1-flash-image-preview-4K")?.aliases,
    ).toEqual(["Banana 2", "Nano Banana 2"]);
    expect(MODEL_CATALOG.find((entry) => entry.id === "gpt-image-2")?.aliases).toEqual([
      "DALL-E 3",
      "GPT Image V2",
    ]);
  });

  it("provides friendly model names for canvas and history UI", () => {
    expect(getModelDisplayName("gemini-3.1-flash-image-preview")).toBe("Nano Banana 2");
    expect(getModelDisplayName("gemini-3-pro-image-preview-4K")).toBe("Nano Banana Pro");
    expect(getModelDisplayName("legacy-model")).toBe("legacy-model");
    expect(getModelDisplayName(null)).toBeNull();
  });

  it("normalizes legacy and unknown models to gpt-image-2", () => {
    expect(normalizeImageGenerationModel("flux")).toBe("gpt-image-2");
    expect(normalizeImageGenerationModel("flux-kontext")).toBe("gpt-image-2");
    expect(normalizeImageGenerationModel("gpt-5.4")).toBe("gpt-image-2");
    expect(normalizeImageGenerationModel("gemini-2.5-flash-image")).toBe("gemini-2.5-flash-image");
  });

  it("normalizes image generation settings", () => {
    expect(normalizeImageGenerationSize("1536x1024")).toBe("1536x1024");
    expect(normalizeImageGenerationSize("bad")).toBe("1024x1024");
    expect(normalizeImageGenerationOutputFormat("png")).toBe("png");
    expect(normalizeImageGenerationOutputFormat("gif")).toBe("webp");
    expect(normalizeImageGenerationResolution("4K")).toBe("4K");
    expect(normalizeImageGenerationResolution("8K")).toBe("preview");
    expect(resolutionForImageGenerationModel("gemini-3-pro-image-preview-2K")).toBe("2K");
    expect(geminiImageSizeForResolution("preview")).toBe("1K");
    expect(aspectRatioForImageGenerationSize("1024x1536")).toBe("2:3");
    expect(aspectRatioForImageGenerationSize("1792x1024")).toBe("16:9");
    expect(aspectRatioForImageGenerationSize("768x1792")).toBe("9:21");
  });

  it("maps GPT Image resolution + aspect ratio to the documented fixed pixel sizes", () => {
    expect(gptImageSizeForResolution("1024x1024", "preview")).toBe("1024x1024");
    expect(gptImageSizeForResolution("1536x1024", "2K")).toBe("2160x1440");
    expect(gptImageSizeForResolution("1024x1536", "4K")).toBe("2304x3456");
    expect(gptImageSizeForResolution("1792x1024", "2K")).toBe("2560x1440");
    expect(gptImageSizeForResolution("1280x960", "4K")).toBe("3200x2400");
    expect(gptImageSizeForResolution("1792x768", "2K")).toBe("3120x1344");
    expect(gptImageQualityForResolution("preview")).toBe("low");
    expect(gptImageQualityForResolution("2K")).toBe("medium");
    expect(gptImageQualityForResolution("4K")).toBe("high");
  });
});
