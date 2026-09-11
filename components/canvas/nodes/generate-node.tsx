"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { type NodeProps } from "@xyflow/react";
import { ChevronRight, Loader2, Plus, Sparkles, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImagePreviewDialog } from "@/components/image-preview-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT,
  DEFAULT_IMAGE_GENERATION_MODEL,
  DEFAULT_IMAGE_GENERATION_RESOLUTION,
  DEFAULT_IMAGE_GENERATION_SIZE,
  getModelCatalogEntry,
  IMAGE_GENERATION_OUTPUT_FORMATS,
  IMAGE_GENERATION_RESOLUTIONS,
  IMAGE_GENERATION_SIZES,
  type ImageGenerationModelId,
  type ImageGenerationOutputFormat,
  type ImageGenerationReference,
  type ImageGenerationResolution,
  type ImageGenerationSize,
  imageGenerationErrorSchema,
  imageGenerationResponseSchema,
  MAX_IMAGE_GENERATION_REFERENCES,
  normalizeImageGenerationOutputFormat,
  normalizeImageGenerationResolution,
  normalizeImageGenerationSize,
  normalizeImageGenerationModel,
  resolutionForImageGenerationModel,
} from "@/lib/image-generation-models";
import { tryParseJsonResponse } from "@/lib/parse-json-response";
import { isStaleGenerationConfigurationError } from "@/lib/generation-errors";
import {
  compileGeneratePromptRows,
  emptyGeneratePromptRow,
  generatePromptRowState,
  generatePromptRowText,
  masksForPromptSource,
  normalizeGeneratePromptRow,
  type GeneratePromptSourceReference,
} from "@/lib/generate-prompt";
import { isAbortError } from "@/lib/generation-run";
import { imageOutputSpecLine } from "@/lib/image-generation-spec";
import { decodeMaskPng, unionMaskPngBlob } from "@/lib/mask-union";
import { compileReferencePrompt } from "@/lib/reference-prompt";
import { persistGeneratedImage } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { NODE_PORT_COLORS } from "@/lib/nodes/ports";
import {
  GENERATE_CHANGE_TYPES,
  type GenerateCanvasNode,
  type GenerateChangeType,
  type GeneratePromptRow,
} from "@/lib/nodes/types";
import {
  useCanvasActions,
  useConnectionHighlight,
  useGroupAccent,
  useReferenceHover,
  type ConnectedImageReference,
  type ConnectedInputReference,
} from "../canvas-context";
import { NodeDeleteButton } from "./delete-button";
import { InputPort, OutputPort } from "./port";
import { ResizeHandle } from "./resize-handle";

const DEFAULT_WIDTH = 288;
const DEFAULT_HEIGHT = 500;

function nowMs(): number {
  return Date.now();
}

type ImageProvider = "gpt" | "gemini";
type GeminiVersion = "1" | "2" | "pro";

const GPT_MODEL_OPTIONS: readonly {
  label: string;
  description: string;
  model: ImageGenerationModelId;
  status: "current" | "legacy";
  enabled: boolean;
  disabledReason?: string;
}[] = [
  {
    label: "2",
    description: "GPT Image 2",
    model: "gpt-image-2",
    status: "current",
    enabled: true,
  },
  {
    label: "1.5 Pro",
    description: "GPT Image 1.5",
    model: "gpt-image-1.5",
    status: "current",
    enabled: true,
  },
  {
    label: "1",
    description: "GPT Image 1",
    model: "gpt-image-1",
    status: "current",
    enabled: true,
  },
  {
    label: "1 Mini",
    description: "GPT Image 1 Mini",
    model: "gpt-image-1-mini",
    status: "current",
    enabled: false,
    disabledReason: "Unavailable on Xiangsu currently",
  },
  {
    label: "DALL-E 3",
    description: "Legacy generation",
    model: "dall-e-3",
    status: "legacy",
    enabled: true,
  },
  {
    label: "DALL-E 2",
    description: "Legacy generation",
    model: "dall-e-2",
    status: "legacy",
    enabled: true,
  },
];

const GEMINI_VERSION_OPTIONS: readonly {
  label: string;
  value: GeminiVersion;
  description: string;
  enabled: boolean;
  disabledReason?: string;
}[] = [
  {
    label: "Nano Banana Pro",
    value: "pro",
    description: "gemini-3-pro-image-preview",
    enabled: true,
  },
  {
    label: "Nano Banana 2",
    value: "2",
    description: "gemini-3.1-flash-image-preview",
    enabled: true,
  },
  {
    label: "Nano Banana 1",
    value: "1",
    description: "NanoBanana 1",
    enabled: false,
    disabledReason: "gemini-2.5-flash-image · unavailable on Xiangsu currently",
  },
];

const SIZE_LABELS: Record<ImageGenerationSize, string> = {
  "1024x1024": "Square · 1:1",
  "1536x1024": "Wide · 3:2",
  "1024x1536": "Tall · 2:3",
  "1792x1024": "16:9",
  "1024x1792": "9:16",
  "1280x960": "4:3",
  "960x1280": "3:4",
  "1792x768": "21:9",
  "768x1792": "9:21",
};

const FORMAT_LABELS: Record<ImageGenerationOutputFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
};

const RESOLUTION_LABELS: Record<ImageGenerationResolution, string> = {
  preview: "Preview",
  "2K": "2K",
  "4K": "4K",
};

function providerForModel(model: ImageGenerationModelId): ImageProvider {
  return model.startsWith("gemini-") ? "gemini" : "gpt";
}

function geminiVersionForModel(model: ImageGenerationModelId): GeminiVersion {
  if (model.startsWith("gemini-3-pro-image-preview")) return "pro";
  if (model.startsWith("gemini-3.1-flash-image-preview")) return "2";
  return "1";
}

function geminiModelFor(
  version: GeminiVersion,
  resolution: ImageGenerationResolution,
): ImageGenerationModelId {
  if (version === "1") return "gemini-2.5-flash-image";
  const suffix = resolution === "preview" ? "" : `-${resolution}`;
  if (version === "pro") {
    return `gemini-3-pro-image-preview${suffix}` as ImageGenerationModelId;
  }
  return `gemini-3.1-flash-image-preview${suffix}` as ImageGenerationModelId;
}

function hasImageUrl(reference: ConnectedInputReference): reference is ConnectedImageReference {
  return reference.kind === "image" && typeof reference.imageUrl === "string";
}

function toGenerationReference(
  reference: ConnectedInputReference,
  selectedMaskUrl?: string,
): ImageGenerationReference | null {
  if (reference.kind === "image") {
    const entry: ImageGenerationReference = {
      kind: "image",
      alias: reference.alias,
      url: reference.imageUrl,
    };
    // Use the user-selected mask from the prompt row, NOT the first mask
    // on the source node. The prompt row's Mask dropdown is the source of
    // truth for which mask applies to this edit.
    if (selectedMaskUrl && selectedMaskUrl.length > 0) {
      entry.maskUrl = selectedMaskUrl;
    }
    return entry;
  }

  return {
    kind: "pantone",
    alias: reference.alias,
    label: reference.label,
    hex: reference.swatchHex,
  };
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyPromptRow(): GeneratePromptRow {
  return emptyGeneratePromptRow(uid());
}

async function fetchMaskBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function uploadCombinedMask(blob: Blob, sourceAlias: string): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", blob, "combined.png");
    form.append("name", `combined-${sourceAlias}`);
    const res = await fetch("/api/masks", { method: "POST", body: form });
    if (!res.ok) return null;
    const json = (await res.json()) as { url?: unknown };
    return typeof json.url === "string" ? json.url : null;
  } catch {
    return null;
  }
}

async function computeUnionMasksForReferences(
  references: readonly ImageGenerationReference[],
): Promise<ImageGenerationReference[]> {
  const perSourceMasks = new Map<string, string[]>();
  for (const reference of references) {
    if (reference.kind !== "image" || !reference.maskUrl) continue;
    if (!reference.alias) continue;
    const list = perSourceMasks.get(reference.alias) ?? [];
    if (!list.includes(reference.maskUrl)) list.push(reference.maskUrl);
    perSourceMasks.set(reference.alias, list);
  }
  const combinedByAlias = new Map<string, string>();
  await Promise.all(
    Array.from(perSourceMasks.entries()).map(async ([alias, urls]) => {
      if (urls.length < 2) return;
      const decoded = await Promise.all(urls.map((url) => fetchMaskBlob(url)));
      const decodedMasks = (
        await Promise.all(
          decoded.filter((blob): blob is Blob => Boolean(blob)).map((blob) => decodeMaskPng(blob)),
        )
      ).filter((mask): mask is NonNullable<Awaited<ReturnType<typeof decodeMaskPng>>> =>
        Boolean(mask),
      );
      const union = await unionMaskPngBlob(decodedMasks);
      if (!union) return;
      const uploaded = await uploadCombinedMask(union.blob, alias);
      if (uploaded) combinedByAlias.set(alias, uploaded);
    }),
  );
  if (combinedByAlias.size === 0) return [...references];
  return references.map((reference) => {
    if (reference.kind !== "image" || !reference.alias) return reference;
    const combined = combinedByAlias.get(reference.alias);
    if (!combined) return reference;
    return { ...reference, maskUrl: combined };
  });
}

interface MentionMatch {
  start: number;
  end: number;
  query: string;
}

function mentionAtCaret(value: string, caret: number): MentionMatch | null {
  const match = value.slice(0, caret).match(/@([^\s@]*)$/);
  if (!match || match.index === undefined) return null;
  return { start: match.index, end: caret, query: match[1] ?? "" };
}

function aliasAtOffset(
  value: string,
  offset: number,
  aliases: readonly { nodeId: string; alias: string; label: string }[],
  masks: readonly { nodeId: string; name: string }[] = [],
): string | null {
  // Empty / whitespace-only prompts used to hang the tab: `(@?[^\s@]*)` can match
  // zero-length tokens, so RegExp.lastIndex never advances and the loop never exits.
  // Require a non-empty token (`+`) — same shape as renderHighlightedAliases.
  if (!value || offset < 0 || offset > value.length) return null;
  const match = /(^|\s)(@?[^\s@]+)/g;
  let token: RegExpExecArray | null;
  while ((token = match.exec(value))) {
    // Defensive: never spin forever if a future pattern can match empty.
    if (token[0].length === 0) {
      match.lastIndex += 1;
      continue;
    }
    const start = (token.index ?? 0) + token[1].length;
    const end = start + token[2].length;
    if (offset < start || offset > end) continue;
    const rawName = token[2] ?? "";
    const isAlias = rawName.startsWith("@");
    const name = (isAlias ? rawName.slice(1) : rawName).toLocaleLowerCase();
    if (!name) continue;
    return (
      (isAlias
        ? aliases.find((option) => option.alias.toLocaleLowerCase() === name)?.nodeId
        : undefined) ??
      masks.find((mask) => mask.name.toLocaleLowerCase() === name)?.nodeId ??
      null
    );
  }
  return null;
}

function caretOffsetFromPoint(event: ReactMouseEvent<HTMLTextAreaElement>): number | null {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position?.offsetNode === event.currentTarget) return position.offset;
  const range = documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
  return range?.startContainer === event.currentTarget ? range.startOffset : null;
}

function renderHighlightedAliases(
  value: string,
  aliases: readonly { nodeId: string; alias: string; label: string }[],
  masks: readonly { nodeId: string; name: string }[] = [],
) {
  const tokenPattern = /(^|\s)(@?[^\s@]+)/g;
  const parts: Array<{ text: string; highlight: "alias" | "mask" | null }> = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(value))) {
    const token = match[2] ?? "";
    const tokenStart = (match.index ?? 0) + (match[1]?.length ?? 0);
    const tokenEnd = tokenStart + token.length;
    const isAlias = token.startsWith("@");
    const name = (isAlias ? token.slice(1) : token).toLocaleLowerCase();
    const highlight =
      isAlias && aliases.some((option) => option.alias.toLocaleLowerCase() === name)
        ? "alias"
        : !isAlias && masks.some((mask) => mask.name.toLocaleLowerCase() === name)
          ? "mask"
          : null;
    if (!highlight) continue;
    if (tokenStart > cursor) parts.push({ text: value.slice(cursor, tokenStart), highlight: null });
    parts.push({ text: value.slice(tokenStart, tokenEnd), highlight });
    cursor = tokenEnd;
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), highlight: null });
  return parts.length ? parts : [{ text: value, highlight: null }];
}

function AliasMentionInput({
  value,
  disabled,
  ariaLabel,
  aliases,
  className,
  onChange,
}: {
  value: string;
  disabled: boolean;
  ariaLabel: string;
  aliases: readonly { nodeId: string; alias: string; label: string }[];
  className?: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<MentionMatch | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = mention
    ? aliases.filter((option) =>
        option.alias.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase()),
      )
    : [];

  function updateMention(nextValue: string, caret: number | null) {
    setMention(caret === null ? null : mentionAtCaret(nextValue, caret));
    setActiveIndex(0);
  }

  function insertAlias(alias: string) {
    if (!mention) return;
    const nextValue = `${value.slice(0, mention.start)}@${alias} ${value.slice(mention.end)}`;
    const nextCaret = mention.start + alias.length + 2;
    onChange(nextValue);
    setMention(null);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!mention || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Escape") {
      setMention(null);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const suggestion = suggestions[activeIndex] ?? suggestions[0];
      if (suggestion) insertAlias(suggestion.alias);
    }
  }

  return (
    <div className="relative min-w-0">
      <Input
        ref={inputRef}
        value={value}
        disabled={disabled}
        placeholder="@pantone red"
        aria-label={ariaLabel}
        className={cn("nodrag nopan h-8 px-2 text-xs", className)}
        onChange={(event) => {
          onChange(event.target.value);
          updateMention(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) =>
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyUp={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(() => setMention(null), 120)}
      />
      {mention ? (
        <div className="nodrag nopan bg-popover text-popover-foreground absolute top-full right-0 left-0 z-40 mt-1 max-h-32 overflow-y-auto rounded-md border p-1 shadow-md">
          {suggestions.length ? (
            suggestions.map((option, index) => (
              <button
                key={option.nodeId}
                type="button"
                className={cn(
                  "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs",
                  index === activeIndex ? "bg-accent" : "hover:bg-accent",
                )}
                onPointerDown={(event) => {
                  event.preventDefault();
                  insertAlias(option.alias);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="truncate">@{option.alias}</span>
              </button>
            ))
          ) : (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">No matching alias</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AliasMentionTextarea({
  value,
  disabled,
  aliases,
  masks = [],
  onChange,
}: {
  value: string;
  disabled: boolean;
  aliases: readonly { nodeId: string; alias: string; label: string }[];
  masks?: readonly { nodeId: string; name: string }[];
  onChange: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [mention, setMention] = useState<MentionMatch | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { setHoveredReferenceNodeId } = useReferenceHover();
  const suggestions = mention
    ? aliases.filter((option) => {
        const query = mention.query.toLocaleLowerCase();
        return (
          option.alias.toLocaleLowerCase().includes(query) ||
          option.label.toLocaleLowerCase().includes(query)
        );
      })
    : [];

  function updateMention(nextValue: string, caret: number | null) {
    setMention(caret === null ? null : mentionAtCaret(nextValue, caret));
    setActiveIndex(0);
  }

  function insertAlias(alias: string) {
    if (!mention) return;
    const nextValue = `${value.slice(0, mention.start)}@${alias} ${value.slice(mention.end)}`;
    const nextCaret = mention.start + alias.length + 2;
    onChange(nextValue);
    setMention(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  useLayoutEffect(() => {
    const selection = selectionRef.current;
    if (!selection || !textareaRef.current) return;
    textareaRef.current.setSelectionRange(selection.start, selection.end);
    selectionRef.current = null;
  }, [value]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!mention || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Escape") {
      setMention(null);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const suggestion = suggestions[activeIndex] ?? suggestions[0];
      if (suggestion) insertAlias(suggestion.alias);
    }
  }

  return (
    <div className="bg-background/60 border-input focus-within:border-ring focus-within:ring-ring/30 relative rounded-md border focus-within:ring-2">
      <textarea
        ref={textareaRef}
        rows={5}
        value={value}
        disabled={disabled}
        placeholder="Describe the image... use @ to mention connected aliases"
        className="nodrag nopan caret-foreground placeholder:text-muted-foreground relative z-10 block min-h-28 w-full resize-none rounded-md border-0 bg-transparent p-2 text-sm leading-5 text-transparent outline-none selection:bg-yellow-300/40 disabled:cursor-not-allowed disabled:opacity-50"
        onChange={(event) => {
          selectionRef.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
          onChange(event.target.value);
          updateMention(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) =>
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart)
        }
        onKeyUp={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
          updateMention(event.currentTarget.value, event.currentTarget.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onMouseMove={(event) => {
          // Hover-highlight connected sources named in the prompt. Skip empty
          // prompts entirely so we never pay the token scan cost on click/focus.
          if (!value) {
            setHoveredReferenceNodeId(null);
            return;
          }
          const offset = caretOffsetFromPoint(event);
          const nextHover = offset === null ? null : aliasAtOffset(value, offset, aliases, masks);
          setHoveredReferenceNodeId(nextHover);
        }}
        onScroll={(event) => {
          if (highlightRef.current) {
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        onMouseLeave={() => setHoveredReferenceNodeId(null)}
        onBlur={() => {
          window.setTimeout(() => setMention(null), 120);
          setHoveredReferenceNodeId(null);
        }}
      />
      <div
        ref={highlightRef}
        aria-hidden="true"
        className="text-foreground pointer-events-none absolute inset-0 z-0 overflow-hidden p-2 text-sm leading-5 break-words whitespace-pre-wrap"
      >
        {renderHighlightedAliases(value, aliases, masks).map((part, index) =>
          part.highlight ? (
            <mark
              key={`${part.text}-${index}`}
              className={cn(
                "text-foreground rounded-sm",
                part.highlight === "alias" ? "bg-yellow-300/70" : "bg-cyan-300/70",
              )}
            >
              {part.text}
            </mark>
          ) : (
            <span key={`${part.text}-${index}`}>{part.text}</span>
          ),
        )}
      </div>
      {mention ? (
        <div className="nodrag nopan bg-popover text-popover-foreground absolute right-2 left-2 z-40 mt-1 max-h-36 overflow-y-auto rounded-md border p-1 shadow-md">
          {suggestions.length ? (
            suggestions.map((option, index) => (
              <button
                key={option.nodeId}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                  index === activeIndex ? "bg-accent" : "hover:bg-accent",
                )}
                onPointerDown={(event) => {
                  event.preventDefault();
                  insertAlias(option.alias);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="truncate">@{option.alias}</span>
                <span className="text-muted-foreground truncate">{option.label}</span>
              </button>
            ))
          ) : (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">No matching alias</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function GenerateNode({ id, data, parentId, selected }: NodeProps<GenerateCanvasNode>) {
  const {
    updateNodeData,
    getConnectedInputReferences,
    hasConnectedOutputNode,
    getConnectedOutputState,
    updateConnectedOutputData,
    startGenerationRun,
    isGenerationRunCurrent,
    finishGenerationRun,
    cancelGenerationRun,
    writeGeneratedImageToOutput,
    deleteEdge,
  } = useCanvasActions();
  const highlight = useConnectionHighlight(id);
  const accent = useGroupAccent(parentId);
  const { hoveredReferenceNodeId, setHoveredReferenceNodeId } = useReferenceHover();
  const [invalidPromptRows, setInvalidPromptRows] = useState<ReadonlySet<string>>(new Set());
  const [maskPreviewRowId, setMaskPreviewRowId] = useState<string | null>(null);
  const [showLogOverlay, setShowLogOverlay] = useState(false);
  // Provider / Version / Resolution / Size / Format defaults to collapsed; user expands when needed.
  const [modelSectionCollapsed, setModelSectionCollapsed] = useState(true);
  const width = data.width ?? DEFAULT_WIDTH;
  const height = data.height ?? DEFAULT_HEIGHT;
  useEffect(() => {
    if (data.status !== "error" || !isStaleGenerationConfigurationError(data.error)) return;
    updateNodeData(id, { status: "idle", error: undefined });
  }, [data.error, data.status, id, updateNodeData]);

  useEffect(
    () => () => {
      setHoveredReferenceNodeId(null);
    },
    [setHoveredReferenceNodeId],
  );

  // Stable fallback row id so empty generate nodes don't churn keys / autosave on every render.
  const fallbackPromptRowIdRef = useRef<string | null>(null);
  if (fallbackPromptRowIdRef.current === null) {
    fallbackPromptRowIdRef.current = uid();
  }

  const hasOutput = hasConnectedOutputNode(id);
  const connectedOutput = getConnectedOutputState(id);
  const connectedOutputHasImage = Boolean(connectedOutput?.resultUrl);
  // Memoize on the stable action identity (edges + graphEpoch) so we don't allocate
  // new reference arrays every parent render / drag frame.
  const connectedReferences = useMemo(
    () => getConnectedInputReferences(id),
    [getConnectedInputReferences, id],
  );
  const connectedImageReferences = useMemo(
    () => connectedReferences.filter(hasImageUrl),
    [connectedReferences],
  );
  const promptReferences: GeneratePromptSourceReference[] = useMemo(
    () =>
      connectedImageReferences.map((reference) => ({
        nodeId: reference.nodeId,
        alias: reference.alias,
        imageUrl: reference.imageUrl,
        masks: reference.masks.map((mask) => ({
          id: mask.id,
          name: mask.name,
          maskUrl: mask.maskUrl,
        })),
      })),
    [connectedImageReferences],
  );
  const promptRows = useMemo(() => {
    if (Array.isArray(data.promptRows) && data.promptRows.length) {
      return data.promptRows.map((row) => {
        const existingId = typeof row?.id === "string" && row.id ? row.id : null;
        return normalizeGeneratePromptRow(
          row,
          promptReferences,
          existingId ?? fallbackPromptRowIdRef.current!,
        );
      });
    }
    return [emptyGeneratePromptRow(fallbackPromptRowIdRef.current!)];
  }, [data.promptRows, promptReferences]);

  // Persist a stable empty row once so subsequent renders reuse the same id.
  useEffect(() => {
    if (Array.isArray(data.promptRows) && data.promptRows.length > 0) return;
    updateNodeData(id, {
      promptRows: [emptyGeneratePromptRow(fallbackPromptRowIdRef.current!)],
    });
  }, [data.promptRows, id, updateNodeData]);

  const connectedReferenceUrls = useMemo(
    () => new Set(connectedImageReferences.map((reference) => reference.imageUrl)),
    [connectedImageReferences],
  );
  const manualImageReferences = data.references.filter((url) => !connectedReferenceUrls.has(url));
  // For each connected source image, find the mask URL selected in *any*
  // prompt row pointing at that source. If multiple rows reference the same
  // source, the last row wins (rare in practice; matches the row-merge logic).
  const selectedMaskUrlBySourceNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of promptRows) {
      if (!row.sourceNodeId || !row.maskId) continue;
      const source = promptReferences.find((r) => r.nodeId === row.sourceNodeId);
      if (!source) continue;
      const mask = source.masks.find((m) => m.id === row.maskId);
      if (mask?.maskUrl) {
        map.set(row.sourceNodeId, mask.maskUrl);
      }
    }
    return map;
  }, [promptRows, promptReferences]);
  const allGenerationReferences = connectedReferences
    .map((reference) =>
      toGenerationReference(
        reference,
        reference.kind === "image" ? selectedMaskUrlBySourceNode.get(reference.nodeId) : undefined,
      ),
    )
    .filter((reference): reference is ImageGenerationReference => reference !== null)
    .concat(
      manualImageReferences.map((url, index) => ({
        kind: "image" as const,
        alias: `reference-${index + 1}`,
        url,
      })),
    );
  const hasReferenceItems = connectedReferences.length > 0 || manualImageReferences.length > 0;
  const hasGenerationReferences = allGenerationReferences.length > 0;
  const hasMaskAttached = allGenerationReferences.some(
    (reference) => reference.kind === "image" && Boolean(reference.maskUrl),
  );
  const model = normalizeImageGenerationModel(data.model);
  const provider = providerForModel(model);
  const size = normalizeImageGenerationSize(data.size ?? DEFAULT_IMAGE_GENERATION_SIZE);
  const outputFormat = normalizeImageGenerationOutputFormat(
    data.outputFormat ?? DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT,
  );
  const resolution = normalizeImageGenerationResolution(
    data.resolution ??
      resolutionForImageGenerationModel(model) ??
      DEFAULT_IMAGE_GENERATION_RESOLUTION,
  );
  const systemPrompt = typeof data.systemPrompt === "string" ? data.systemPrompt : "";
  const previewFinalPrompt = useMemo(() => {
    if (!allGenerationReferences.length) return "";
    const rowPrompt = compileGeneratePromptRows(promptRows, promptReferences).trim();
    const existingPrompt = data.prompt.trim();
    const missingRows = rowPrompt
      .split("\n")
      .filter(
        (line) =>
          line.trim() &&
          !existingPrompt.split("\n").some((existing) => existing.trim() === line.trim()),
      );
    const mergedPrompt = [existingPrompt, ...missingRows].filter(Boolean).join("\n");
    if (!mergedPrompt) return "";
    const compiled = compileReferencePrompt(mergedPrompt, allGenerationReferences);
    const spec = imageOutputSpecLine({
      isGptModel: model.startsWith("gpt-image"),
      matchSourceSize: data.matchSourceSize === true,
      size,
      resolution,
    });
    const systemPromptText = systemPrompt.trim();
    const base = systemPromptText ? `${systemPromptText}\n\n${compiled.prompt}` : compiled.prompt;
    return `${base}${spec}`;
  }, [
    allGenerationReferences,
    promptRows,
    promptReferences,
    data.prompt,
    data.matchSourceSize,
    systemPrompt,
    model,
    size,
    resolution,
  ]);
  const geminiVersion = geminiVersionForModel(model);
  const selectedModel = getModelCatalogEntry(model);
  const isGenerating = data.status === "loading";
  const aliasOptions = connectedReferences.map((reference) => ({
    nodeId: reference.nodeId,
    alias: reference.alias,
    label: reference.label,
  }));
  const selectedGptOption = GPT_MODEL_OPTIONS.find((option) => option.model === model);
  const currentModelUnavailable =
    provider === "gpt"
      ? Boolean(selectedGptOption && !selectedGptOption.enabled)
      : geminiVersion === "1";
  const currentModelBlockedByReferences =
    provider === "gpt" &&
    Boolean(selectedGptOption?.status === "legacy" && hasGenerationReferences);

  const renderedReferences = connectedReferences.map((reference) => {
    const isReferenceHovered = hoveredReferenceNodeId === reference.nodeId;

    if (reference.kind === "pantone") {
      return (
        <div
          key={reference.nodeId}
          title={`@${reference.alias}`}
          onPointerEnter={() => setHoveredReferenceNodeId(reference.nodeId)}
          onPointerLeave={() => setHoveredReferenceNodeId(null)}
          onPointerCancel={() => setHoveredReferenceNodeId(null)}
          className={cn(
            "group/reference relative size-9 overflow-hidden rounded border transition-[box-shadow,transform]",
            isReferenceHovered &&
              "ring-offset-background shadow-lg ring-2 ring-yellow-400 ring-offset-1",
          )}
        >
          <div
            className="size-full"
            style={{ backgroundColor: reference.swatchHex }}
            aria-hidden="true"
          />
          <span className="absolute right-0 bottom-0 left-0 truncate bg-black/55 px-0.5 text-[0.55rem] leading-3 text-white">
            {reference.label}
          </span>
          <ConfirmDialog
            title="Remove reference?"
            description={`Disconnect @${reference.alias} from this Generate node?`}
            confirmLabel="Remove"
            onConfirm={() => deleteEdge(reference.edgeId)}
            trigger={
              <button
                type="button"
                aria-label={`Remove @${reference.alias} reference`}
                className="nodrag nopan bg-background/90 text-foreground focus-visible:ring-ring absolute top-0.5 right-0.5 z-10 flex size-5 items-center justify-center rounded-sm border opacity-0 shadow-sm transition-opacity group-hover/reference:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
              >
                <X className="size-3" />
              </button>
            }
          />
        </div>
      );
    }

    return (
      <div
        key={reference.nodeId}
        title={`@${reference.alias}`}
        onPointerEnter={() => setHoveredReferenceNodeId(reference.nodeId)}
        onPointerLeave={() => setHoveredReferenceNodeId(null)}
        onPointerCancel={() => setHoveredReferenceNodeId(null)}
        className={cn(
          "group/reference relative size-9 overflow-hidden rounded transition-[box-shadow,transform]",
          isReferenceHovered &&
            "ring-offset-background shadow-lg ring-2 ring-yellow-400 ring-offset-1",
        )}
      >
        <ImagePreviewDialog
          src={reference.imageUrl}
          alt={`@${reference.alias} reference`}
          title={`@${reference.alias} reference image`}
          trigger={
            <button
              type="button"
              className="nodrag nopan focus-visible:ring-ring size-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset"
              aria-label={`Enlarge @${reference.alias} reference image`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={reference.imageUrl} alt="" className="size-full object-cover" />
            </button>
          }
        />
        <span className="absolute right-0 bottom-0 left-0 truncate bg-black/55 px-0.5 text-[0.55rem] leading-3 text-white">
          @{reference.alias}
        </span>
        <ConfirmDialog
          title="Remove reference?"
          description={`Disconnect @${reference.alias} from this Generate node?`}
          confirmLabel="Remove"
          onConfirm={() => deleteEdge(reference.edgeId)}
          trigger={
            <button
              type="button"
              aria-label={`Remove @${reference.alias} reference`}
              className="nodrag nopan bg-background/90 text-foreground focus-visible:ring-ring absolute top-0.5 right-0.5 z-10 flex size-5 items-center justify-center rounded-sm border opacity-0 shadow-sm transition-opacity group-hover/reference:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
            >
              <X className="size-3" />
            </button>
          }
        />
      </div>
    );
  });

  function addReference(url: string) {
    if (!manualImageReferences.includes(url)) {
      updateNodeData(id, { references: [...manualImageReferences, url] });
    }
  }
  function removeReference(url: string) {
    updateNodeData(id, { references: manualImageReferences.filter((r) => r !== url) });
  }

  function removeAllReferences() {
    connectedReferences.forEach((reference) => deleteEdge(reference.edgeId));
    updateNodeData(id, { references: [] });
  }

  function updatePromptRows(rows: GeneratePromptRow[]) {
    updateNodeData(id, { promptRows: rows });
  }

  function autoMatchedPromptRow(): GeneratePromptRow {
    const source = promptReferences[0];
    const mask = source?.masks[0];
    return {
      ...emptyPromptRow(),
      sourceNodeId: source?.nodeId ?? "",
      maskId: mask?.id ?? "",
    };
  }

  function appendPromptRowText(row: GeneratePromptRow) {
    if (!row.sourceNodeId || !row.targetText.trim()) return;
    const line = generatePromptRowText(row, promptReferences).trim();
    if (!line) return;
    const nextPrompt = [data.prompt.trim(), `- ${line}`].filter(Boolean).join("\n");
    updateNodeData(id, { prompt: nextPrompt });
  }

  function patchPromptRow(rowId: string, patch: Partial<GeneratePromptRow>) {
    setInvalidPromptRows((current) => {
      if (!current.has(rowId)) return current;
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
    updatePromptRows(promptRows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function promptRowMissingFields(row: GeneratePromptRow): string[] {
    const missing: string[] = [];
    if (!row.sourceNodeId) missing.push("source");
    if (!row.changeType) missing.push("change");
    if (!row.targetText.trim()) missing.push("target");
    return missing;
  }

  function addPromptRow() {
    // Only validate the last row (the one the user just filled in).
    // Previous rows are already-committed, separate prompt blocks — don't
    // re-validate them.
    const lastRow = promptRows[promptRows.length - 1];
    if (lastRow && promptRowMissingFields(lastRow).length > 0) {
      setInvalidPromptRows(new Set([lastRow.id]));
      return;
    }

    if (lastRow) appendPromptRowText(lastRow);
    // Keep the completed row's fields intact as a visible record. Just
    // append a fresh empty row for the next entry.
    updatePromptRows([...promptRows, emptyPromptRow()]);
    setInvalidPromptRows(new Set());
  }

  function deletePromptRow(rowId: string) {
    const nextRows = promptRows.filter((row) => row.id !== rowId);
    updatePromptRows(nextRows.length ? nextRows : [emptyPromptRow()]);
  }

  async function onGenerate() {
    const rowPrompt = compileGeneratePromptRows(promptRows, promptReferences).trim();
    const existingPrompt = data.prompt.trim();
    const missingRows = rowPrompt
      .split("\n")
      .filter(
        (line) =>
          line.trim() &&
          !existingPrompt.split("\n").some((existing) => existing.trim() === line.trim()),
      );
    const prompt = [existingPrompt, ...missingRows].filter(Boolean).join("\n");
    if (!prompt) {
      toast.error("Enter prompt text or complete at least one prompt row first");
      return;
    }
    if (allGenerationReferences.length > MAX_IMAGE_GENERATION_REFERENCES) {
      toast.error(`Use no more than ${MAX_IMAGE_GENERATION_REFERENCES} reference images`);
      return;
    }

    const run = startGenerationRun(id);
    if (!run) return;

    const outputReady = updateConnectedOutputData(id, {
      status: "loading",
      error: undefined,
    });
    if (!outputReady) {
      finishGenerationRun(id, run.runId);
      toast.error("Connect an Output node before generating");
      return;
    }

    updateNodeData(id, {
      status: "loading",
      error: undefined,
      model,
      size,
      outputFormat,
      resolution,
      systemPrompt,
    });
    const generationStartedAt = nowMs();
    try {
      const referencesWithUnionMask = await computeUnionMasksForReferences(allGenerationReferences);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: run.signal,
        body: JSON.stringify({
          model,
          prompt,
          systemPrompt: systemPrompt || undefined,
          size,
          outputFormat,
          resolution,
          references: referencesWithUnionMask,
          matchSourceSize: data.matchSourceSize === true && hasMaskAttached,
        }),
      });
      if (!isGenerationRunCurrent(id, run.runId)) return;
      const json: unknown | null = await tryParseJsonResponse(res);
      if (!isGenerationRunCurrent(id, run.runId)) return;
      const parsed = imageGenerationResponseSchema.safeParse(json);
      if (!res.ok || json === null || !parsed.success) {
        const error = json !== null ? imageGenerationErrorSchema.safeParse(json) : null;
        const detail = error !== null && error.success ? error.data.error : null;
        throw new Error(detail ?? `Generation failed (HTTP ${res.status})`);
      }
      const persisted = await persistGeneratedImage(parsed.data.url, outputFormat, run.signal);
      if (!isGenerationRunCurrent(id, run.runId)) return;
      const generationDurationMs = Math.max(0, nowMs() - generationStartedAt);
      updateNodeData(id, {
        status: "done",
        resultUrl: persisted.url,
        model: parsed.data.model,
        size,
        outputFormat,
        resolution,
        generationDurationMs,
        error: undefined,
      });
      const outputWritten = writeGeneratedImageToOutput(id, persisted.url, {
        prompt,
        model: parsed.data.model,
        size,
        resolution,
        outputFormat,
        storagePath: persisted.storagePath,
        durationMs: generationDurationMs,
      });
      if (!outputWritten) {
        throw new Error("Output node was disconnected before generation finished");
      }
      toast.success("Image generated and saved to Renders.");
    } catch (err) {
      const cancelled =
        run.signal.aborted || !isGenerationRunCurrent(id, run.runId) || isAbortError(err);
      if (cancelled) return;
      const message = err instanceof Error ? err.message : "Generation failed";
      updateNodeData(id, { status: "error", error: message });
      updateConnectedOutputData(id, { status: "error", error: message });
      toast.error(message);
    } finally {
      finishGenerationRun(id, run.runId);
      // Auto-open the log overlay so the user can inspect exactly what was
      // sent to the model — without needing the terminal.
      setShowLogOverlay(true);
    }
  }

  function stopGeneration() {
    if (cancelGenerationRun(id)) {
      toast.info("Generation stopped.");
    }
  }

  return (
    <div
      style={{
        width,
        height,
        ...(accent ? { outline: `2px solid ${accent}`, outlineOffset: 2 } : {}),
        ...highlight,
      }}
      aria-busy={isGenerating}
      className={cn(
        "group bg-card relative flex flex-col overflow-hidden rounded-lg border shadow-md",
        selected && "ring-primary ring-offset-background shadow-lg ring-2 ring-offset-2",
      )}
    >
      <NodeDeleteButton id={id} />
      <InputPort color={NODE_PORT_COLORS.generate} top={16} zIndex={30} />
      <div className="bg-card relative z-20 flex h-11 shrink-0 items-center gap-2 border-b px-3 pr-10 text-sm font-medium shadow-sm">
        <Sparkles className="size-4" />
        Generate
        {isGenerating ? (
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            title="Stop generation"
            aria-label="Stop generation"
            className="nodrag nopan ml-auto"
            onClick={stopGeneration}
          >
            <Square className="fill-current" />
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setModelSectionCollapsed((collapsed) => !collapsed)}
            aria-expanded={!modelSectionCollapsed}
            className="nodrag nopan text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs select-none"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform",
                !modelSectionCollapsed && "rotate-90",
              )}
            />
            Model settings
          </button>
          <span className="text-muted-foreground truncate font-mono text-[0.65rem]">
            {selectedModel.officialName}
            {provider === "gpt" ? " · output pinned to PNG" : null}
          </span>
        </div>

        {!modelSectionCollapsed ? (
          <>
            <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Provider</span>
            <Select
              value={provider}
              disabled={isGenerating}
              onValueChange={(value) => {
                const nextProvider = value === "gemini" ? "gemini" : "gpt";
                updateNodeData(id, {
                  model:
                    nextProvider === "gemini"
                      ? geminiModelFor("pro", resolution)
                      : DEFAULT_IMAGE_GENERATION_MODEL,
                });
              }}
            >
              <SelectTrigger className="nodrag nopan w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="nodrag nopan">
                <SelectItem value="gpt">GPT Image</SelectItem>
                <SelectItem value="gemini">NanoBanana</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Version</span>
            {provider === "gemini" ? (
              <Select
                value={geminiVersion}
                disabled={isGenerating}
                onValueChange={(value) => {
                  const nextVersion = value === "1" || value === "2" ? value : "pro";
                  const nextResolution = nextVersion === "1" ? "preview" : resolution;
                  updateNodeData(id, {
                    model: geminiModelFor(nextVersion, nextResolution),
                    resolution: nextResolution,
                  });
                }}
              >
                <SelectTrigger className="nodrag nopan w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" className="nodrag nopan">
                  <SelectGroup>
                    <SelectLabel>Latest first</SelectLabel>
                    {GEMINI_VERSION_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        disabled={!option.enabled}
                      >
                        <span className="flex flex-col items-start">
                          <span>{option.label}</span>
                          <span className="text-muted-foreground text-[0.65rem]">
                            {option.enabled
                              ? option.description
                              : (option.disabledReason ?? option.description)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={model}
                disabled={isGenerating}
                onValueChange={(value) => {
                  updateNodeData(id, { model: normalizeImageGenerationModel(value) });
                }}
              >
                <SelectTrigger className="nodrag nopan w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" className="nodrag nopan">
                  <SelectGroup>
                    <SelectLabel>Latest first</SelectLabel>
                    {GPT_MODEL_OPTIONS.filter((option) => option.status === "current").map(
                      (option) => (
                        <SelectItem
                          key={option.model}
                          value={option.model}
                          disabled={!option.enabled}
                        >
                          <span className="flex flex-col items-start">
                            <span>{option.label}</span>
                            <span className="text-muted-foreground text-[0.65rem]">
                              {option.enabled
                                ? option.description
                                : (option.disabledReason ?? option.description)}
                            </span>
                          </span>
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Legacy</SelectLabel>
                    {GPT_MODEL_OPTIONS.filter((option) => option.status === "legacy").map(
                      (option) => (
                        <SelectItem
                          key={option.model}
                          value={option.model}
                          disabled={hasGenerationReferences}
                        >
                          <span className="flex flex-col items-start">
                            <span>{option.label}</span>
                            <span className="text-muted-foreground text-[0.65rem]">
                              {hasGenerationReferences
                                ? "Prompt-only only, remove references first"
                                : option.description}
                            </span>
                          </span>
                        </SelectItem>
                      ),
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Resolution</span>
            <Select
              value={resolution}
              disabled={isGenerating || geminiVersion === "1"}
              onValueChange={(value) => {
                const nextResolution = normalizeImageGenerationResolution(value);
                updateNodeData(id, {
                  resolution: nextResolution,
                  model:
                    provider === "gemini" ? geminiModelFor(geminiVersion, nextResolution) : model,
                });
              }}
            >
              <SelectTrigger className="nodrag nopan w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="nodrag nopan">
                {IMAGE_GENERATION_RESOLUTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {RESOLUTION_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Size</span>
            <Select
              value={size}
              disabled={isGenerating}
              onValueChange={(value) => {
                updateNodeData(id, { size: normalizeImageGenerationSize(value) });
              }}
            >
              <SelectTrigger className="nodrag nopan w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="nodrag nopan">
                {IMAGE_GENERATION_SIZES.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span className="flex flex-col items-start">
                      <span>{SIZE_LABELS[option]}</span>
                      <span className="text-muted-foreground font-mono text-[0.65rem]">
                        {option}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-xs">Format</span>
            <Select
              value={outputFormat}
              disabled={isGenerating || provider === "gpt"}
              onValueChange={(value) => {
                updateNodeData(id, {
                  outputFormat: normalizeImageGenerationOutputFormat(value),
                });
              }}
            >
              <SelectTrigger className="nodrag nopan w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" className="nodrag nopan">
                {IMAGE_GENERATION_OUTPUT_FORMATS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {FORMAT_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
          </>
        ) : null}

        {hasGenerationReferences && hasMaskAttached ? (
          <label className="nodrag nopan flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={Boolean(data.matchSourceSize)}
              disabled={isGenerating}
              onChange={(event) => updateNodeData(id, { matchSourceSize: event.target.checked })}
            />
            <span>Match source size (recommended with mask)</span>
          </label>
        ) : null}

        <details className="group bg-background/60 rounded-md border p-2 text-xs">
          <summary className="text-muted-foreground flex cursor-pointer list-none items-center gap-1 select-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            System prompt
          </summary>
          <div className="mt-2 flex flex-col gap-1">
            <textarea
              value={systemPrompt}
              disabled={isGenerating}
              placeholder="Optional system prompt prepended to every request (e.g. brand voice, style guardrails)"
              onChange={(event) => updateNodeData(id, { systemPrompt: event.target.value })}
              className="nodrag nopan caret-foreground placeholder:text-muted-foreground bg-background/60 focus-visible:ring-ring min-h-16 w-full resize-y rounded-md border p-2 text-xs leading-5 outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </details>

        <div className="flex flex-col gap-1">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">Reference image</span>
            {hasReferenceItems && (
              <ConfirmDialog
                title="Remove all references?"
                description="This disconnects every connected reference and removes all dropped reference images from this Generate node."
                confirmLabel="Remove all"
                onConfirm={removeAllReferences}
                trigger={
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={isGenerating}
                    className="nodrag nopan text-destructive hover:text-destructive"
                  >
                    <Trash2 />
                    Clear all
                  </Button>
                }
              />
            )}
          </div>
          <div
            className="bg-background/60 flex min-h-14 flex-wrap gap-1 rounded-md border border-dashed p-1"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              if (isGenerating) return;
              e.preventDefault();
              const url = e.dataTransfer.getData("application/ica-image-url");
              if (url) addReference(url);
            }}
          >
            {hasReferenceItems ? (
              <>
                {renderedReferences}
                {manualImageReferences.map((url) => (
                  <div
                    key={url}
                    className="group/reference relative size-9 overflow-hidden rounded"
                  >
                    <ImagePreviewDialog
                      src={url}
                      alt="Dropped reference"
                      title="Dropped reference image"
                      trigger={
                        <button
                          type="button"
                          className="nodrag nopan focus-visible:ring-ring size-full cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-inset"
                          aria-label="Enlarge dropped reference image"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" className="size-full object-cover" />
                        </button>
                      }
                    />
                    <ConfirmDialog
                      title="Remove reference?"
                      description="Remove this dropped image from the Generate node?"
                      confirmLabel="Remove"
                      onConfirm={() => removeReference(url)}
                      trigger={
                        <button
                          type="button"
                          aria-label="Remove reference"
                          className="nodrag nopan bg-background/90 text-foreground focus-visible:ring-ring absolute top-0.5 right-0.5 z-10 flex size-5 items-center justify-center rounded-sm border opacity-0 shadow-sm transition-opacity group-hover/reference:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
                        >
                          <X className="size-3" />
                        </button>
                      }
                    />
                  </div>
                ))}
              </>
            ) : (
              <span className="text-muted-foreground px-1 py-1 text-xs">
                Drop an image reference
              </span>
            )}
          </div>
        </div>

        <details className="group bg-background/60 rounded-md border p-2 text-xs">
          <summary className="text-muted-foreground flex cursor-pointer list-none items-center justify-between gap-2 select-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              Prompt program
              {promptRows.length > 1 ? (
                <span className="text-muted-foreground bg-muted/60 rounded px-1 text-[0.6rem]">
                  {promptRows.length}
                </span>
              ) : null}
            </span>
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center justify-end">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={isGenerating}
                className="nodrag nopan"
                onClick={addPromptRow}
              >
                <Plus />
                Add row
              </Button>
            </div>
            <div className="grid gap-2">
              {promptRows.map((row, index) => {
                const sourceMasks = masksForPromptSource(promptReferences, row.sourceNodeId);
                const selectedSourceReference = promptReferences.find(
                  (reference) => reference.nodeId === row.sourceNodeId,
                );
                const selectedMaskReference = sourceMasks.find((mask) => mask.id === row.maskId);
                const preview = generatePromptRowText(row, promptReferences);
                const rowState = generatePromptRowState(row, promptReferences);
                const complete = rowState === "complete";
                const rowInvalid = invalidPromptRows.has(row.id);
                const missingFields = promptRowMissingFields(row);

                return (
                  <div
                    key={row.id}
                    className={cn(
                      "bg-background grid gap-1 rounded-md border p-2",
                      rowState === "partial" && "border-amber-400/70",
                    )}
                  >
                    <div className="grid grid-cols-[1fr_1fr_0.9fr_1fr_auto] gap-1">
                      <Select
                        value={row.sourceNodeId || "__source__"}
                        disabled={isGenerating}
                        onValueChange={(value) =>
                          patchPromptRow(row.id, {
                            sourceNodeId: value === "__source__" ? "" : (value ?? ""),
                            maskId: "",
                          })
                        }
                      >
                        <SelectTrigger
                          className={cn(
                            "nodrag nopan h-8 px-2 text-xs",
                            rowInvalid &&
                              missingFields.includes("source") &&
                              "border-destructive ring-destructive/40 ring-1",
                          )}
                          aria-label={`Prompt row ${index + 1} source alias`}
                        >
                          <span
                            data-slot="select-value"
                            className={cn(
                              "flex flex-1 items-center truncate text-left",
                              !selectedSourceReference && "text-muted-foreground",
                            )}
                          >
                            {selectedSourceReference
                              ? `@${selectedSourceReference.alias}`
                              : "@source"}
                          </span>
                        </SelectTrigger>
                        <SelectContent align="start" className="nodrag nopan">
                          <SelectItem value="__source__">@source</SelectItem>
                          {promptReferences.map((reference) => (
                            <SelectItem key={reference.nodeId} value={reference.nodeId}>
                              @{reference.alias}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={row.maskId || "__mask__"}
                        disabled={isGenerating || !row.sourceNodeId}
                        onValueChange={(value) => {
                          const nextValue = value ?? "__mask__";
                          patchPromptRow(row.id, {
                            maskId: nextValue === "__mask__" ? "" : nextValue,
                          });
                        }}
                      >
                        <SelectTrigger
                          className={cn("nodrag nopan h-8 px-2 text-xs")}
                          aria-label={`Prompt row ${index + 1} mask`}
                        >
                          <span
                            data-slot="select-value"
                            className={cn(
                              "flex flex-1 items-center gap-1 truncate text-left",
                              !selectedMaskReference && "text-muted-foreground",
                            )}
                          >
                            {selectedMaskReference?.name ??
                              (row.sourceNodeId && sourceMasks.length === 0
                                ? "No mask (optional)"
                                : "mask (optional)")}
                            {selectedMaskReference?.maskUrl ? (
                              <span
                                role="button"
                                tabIndex={0}
                                onPointerDown={(event: ReactMouseEvent<HTMLSpanElement>) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  setMaskPreviewRowId(row.id);
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.stopPropagation();
                                    event.preventDefault();
                                    setMaskPreviewRowId(row.id);
                                  }
                                }}
                                className="nodrag nopan ml-1 cursor-pointer text-[10px] text-blue-400 underline hover:text-blue-300"
                                title="Open mask preview"
                              >
                                PNG
                              </span>
                            ) : null}
                          </span>
                        </SelectTrigger>
                        <SelectContent align="start" className="nodrag nopan">
                          <SelectItem value="__mask__">
                            {row.sourceNodeId && sourceMasks.length === 0
                              ? "No mask (optional)"
                              : "mask (optional)"}
                          </SelectItem>
                          {sourceMasks.map((mask) => (
                            <SelectItem key={mask.id} value={mask.id}>
                              {mask.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={row.changeType}
                        disabled={isGenerating}
                        onValueChange={(value) =>
                          patchPromptRow(row.id, {
                            changeType: GENERATE_CHANGE_TYPES.includes(value as GenerateChangeType)
                              ? (value as GenerateChangeType)
                              : "color",
                          })
                        }
                      >
                        <SelectTrigger
                          className={cn(
                            "nodrag nopan h-8 px-2 text-xs",
                            rowInvalid &&
                              missingFields.includes("change") &&
                              "border-destructive ring-destructive/40 ring-1",
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start" className="nodrag nopan">
                          {GENERATE_CHANGE_TYPES.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <AliasMentionInput
                        value={row.targetText}
                        disabled={isGenerating}
                        aliases={aliasOptions}
                        ariaLabel={`Prompt row ${index + 1} target`}
                        className={cn(
                          rowInvalid &&
                            missingFields.includes("target") &&
                            "border-destructive ring-destructive/40 ring-1",
                        )}
                        onChange={(targetText) => patchPromptRow(row.id, { targetText })}
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        disabled={isGenerating || (promptRows.length === 1 && rowState === "empty")}
                        aria-label={`Delete prompt row ${index + 1}`}
                        className="nodrag nopan size-8"
                        onClick={() => deletePromptRow(row.id)}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                    <p
                      className={cn(
                        "truncate font-mono text-[0.65rem]",
                        complete ? "text-foreground" : "text-muted-foreground",
                      )}
                      title={preview}
                    >
                      {preview || "@product use collar region change color to @pantone red"}
                    </p>
                    {selectedMaskReference?.maskUrl ? (
                      <button
                        type="button"
                        onClick={() => setMaskPreviewRowId(row.id)}
                        className="nodrag nopan bg-muted relative block h-20 w-full cursor-zoom-in overflow-hidden rounded-md border"
                        title="Open mask preview"
                      >
                        {(() => {
                          const sourceRef = selectedSourceReference?.nodeId
                            ? connectedImageReferences.find(
                                (reference) => reference.nodeId === selectedSourceReference.nodeId,
                              )
                            : undefined;
                          return sourceRef?.imageUrl ? (
                            <img
                              src={sourceRef.imageUrl}
                              alt="source"
                              className="absolute inset-0 h-full w-full object-contain"
                              draggable={false}
                            />
                          ) : null;
                        })()}
                        <img
                          src={selectedMaskReference.maskUrl}
                          alt={`Mask ${selectedMaskReference.name}`}
                          className="absolute inset-0 h-full w-full object-contain opacity-40 mix-blend-multiply"
                          draggable={false}
                        />
                        <span className="absolute bottom-0.5 left-1 rounded bg-black/70 px-1 text-[0.6rem] text-white">
                          mask: {selectedMaskReference.name} (shaded = region to change)
                        </span>
                      </button>
                    ) : null}
                    {rowState === "partial" ? (
                      <p className="text-[0.65rem] text-amber-600 dark:text-amber-300">
                        Complete the source and target to include this row. Mask is optional.
                      </p>
                    ) : null}
                    {rowInvalid ? (
                      <p className="text-destructive text-[0.65rem]">
                        Complete the highlighted field{missingFields.length === 1 ? "" : "s"} before
                        adding another row.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </details>

        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs">Prompt</span>
          <AliasMentionTextarea
            value={data.prompt}
            disabled={isGenerating}
            aliases={aliasOptions}
            masks={promptReferences.flatMap((reference) =>
              reference.masks.map((mask) => ({ nodeId: reference.nodeId, name: mask.name })),
            )}
            onChange={(prompt) => updateNodeData(id, { prompt })}
          />
          <span className="text-muted-foreground text-[0.65rem]">
            Add context or refine the generated prompt here.
          </span>
        </div>

        <div className="grid gap-1">
          <details className="nodrag nopan bg-background/60 rounded-md border p-2 text-xs">
            <summary className="text-muted-foreground cursor-pointer text-xs select-none">
              Preview final prompt sent to model
            </summary>
            <pre className="bg-muted/40 mt-2 max-h-64 overflow-auto rounded p-2 text-[0.7rem] leading-5 break-words whitespace-pre-wrap">
              {previewFinalPrompt || "(Connect a reference and enter a prompt to preview.)"}
            </pre>
          </details>
        </div>
      </div>

      <div className="bg-card relative z-20 flex shrink-0 flex-col gap-1 border-t px-3 py-2">
        <ConfirmDialog
          title={connectedOutputHasImage ? "Replace output image?" : "Generate image?"}
          description={
            connectedOutputHasImage
              ? `This will replace the current Output image as soon as generation starts. Download it first if you need to keep it. Run ${selectedModel.aliases[0]} at ${size}?`
              : `Run ${selectedModel.aliases[0]} at ${size}? This may use API credits.`
          }
          confirmLabel="Generate"
          destructive={false}
          onConfirm={() => void onGenerate()}
          trigger={
            <Button
              type="button"
              size="sm"
              disabled={
                isGenerating ||
                !hasOutput ||
                allGenerationReferences.length > MAX_IMAGE_GENERATION_REFERENCES ||
                currentModelUnavailable ||
                currentModelBlockedByReferences
              }
              className={cn("w-full", isGenerating && "cursor-not-allowed")}
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {isGenerating ? "Generating..." : "Generate"}
            </Button>
          }
        />

        {!hasOutput && <p className="text-muted-foreground text-xs">Connect an Output node.</p>}
        {hasGenerationReferences && (
          <p className="text-muted-foreground text-xs">
            {allGenerationReferences.length} reference
            {allGenerationReferences.length === 1 ? "" : "s"} will guide this generation.
          </p>
        )}
        <button
          type="button"
          onClick={() => setShowLogOverlay(true)}
          className="nodrag nopan text-left text-[0.65rem] text-blue-500 underline hover:text-blue-400"
          title="Open the most recent request/response sent to the AI model"
        >
          View last generate request →
        </button>
        {allGenerationReferences.length > MAX_IMAGE_GENERATION_REFERENCES && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Remove references until there are no more than {MAX_IMAGE_GENERATION_REFERENCES}.
          </p>
        )}
        {provider === "gemini" && geminiVersion === "1" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            NanoBanana 1 is currently unavailable on Xiangsu. Use NanoBanana 2 or Pro.
          </p>
        )}
        {provider === "gpt" && selectedGptOption && !selectedGptOption.enabled && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {selectedGptOption.label} is currently unavailable on Xiangsu. Use GPT Image 2, 1.5 Pro,
            or 1.
          </p>
        )}
        {provider === "gpt" && currentModelBlockedByReferences && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            DALL-E works only with prompt-only generation. Remove references or switch to a GPT
            Image model.
          </p>
        )}
        {data.status === "error" && data.error && (
          <p className="text-destructive text-xs">{data.error}</p>
        )}
      </div>
      <OutputPort color={NODE_PORT_COLORS.generate} />
      <ResizeHandle nodeId={id} width={width} height={height} minWidth={280} minHeight={400} />
      {showLogOverlay ? <GenerateLogOverlay onClose={() => setShowLogOverlay(false)} /> : null}
      {(() => {
        if (!maskPreviewRowId) return null;
        const row = promptRows.find((r) => r.id === maskPreviewRowId);
        if (!row) return null;
        const masks = masksForPromptSource(promptReferences, row.sourceNodeId);
        const mask = masks.find((m) => m.id === row.maskId);
        if (!mask?.maskUrl) return null;
        const sourceRef = promptReferences.find(
          (reference) => reference.nodeId === row.sourceNodeId,
        );
        return (
          <MaskPreviewOverlay
            maskUrl={mask.maskUrl}
            maskName={mask.name}
            sourceImageUrl={sourceRef?.imageUrl ?? null}
            onClose={() => setMaskPreviewRowId(null)}
          />
        );
      })()}
    </div>
  );
}

function MaskPreviewOverlay({
  maskUrl,
  maskName,
  sourceImageUrl,
  onClose,
}: {
  maskUrl: string;
  maskName: string;
  sourceImageUrl: string | null;
  onClose: () => void;
}) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [highlightDataUrl, setHighlightDataUrl] = useState<string | null>(null);
  useEffect(() => {
    setImgSize(null);
    if (!sourceImageUrl) return;
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = sourceImageUrl;
  }, [sourceImageUrl]);
  // Mask PNGs follow the OpenAI images.edit convention: transparent pixels (alpha=0)
  // are the region to regenerate, opaque pixels are preserved. Render the transparent
  // region as a solid yellow overlay so the user can see the mask region.
  useEffect(() => {
    setHighlightDataUrl(null);
    if (!maskUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(img, 0, 0);
      try {
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let index = 0; index < data.length; index += 4) {
          const alpha = data[index + 3];
          if (alpha < 32) {
            // transparent → region to regenerate → yellow highlight
            data[index] = 250;
            data[index + 1] = 204;
            data[index + 2] = 21;
            data[index + 3] = 180;
          } else {
            // opaque → preserve → no overlay
            data[index + 3] = 0;
          }
        }
        context.putImageData(imageData, 0, 0);
        setHighlightDataUrl(canvas.toDataURL("image/png"));
      } catch {
        setHighlightDataUrl(null);
      }
    };
    img.onerror = () => setHighlightDataUrl(null);
    img.src = maskUrl;
  }, [maskUrl]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const aspect = imgSize ? `${imgSize.w} / ${imgSize.h}` : "1 / 1";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background relative max-h-full max-w-3xl overflow-auto rounded-lg border p-3 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close mask preview"
          className="absolute top-2 right-2 z-10 inline-flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        >
          <X className="size-4" />
        </button>
        <div className="mb-2 flex items-center gap-2 pr-8">
          <span className="text-sm font-medium">Mask preview</span>
          <span className="text-muted-foreground text-xs">· {maskName}</span>
        </div>
        <div
          className="bg-muted relative w-full overflow-hidden rounded-md border"
          style={{ aspectRatio: aspect, maxHeight: "70vh", maxWidth: "100%" }}
        >
          {/* Mask highlight layer (bottom, full opacity so the yellow region reads). */}
          {highlightDataUrl ? (
            <img
              src={highlightDataUrl}
              alt={`Mask ${maskName} highlight`}
              className="absolute inset-0 z-0 h-full w-full object-contain"
              draggable={false}
            />
          ) : (
            <img
              src={maskUrl}
              alt={`Mask ${maskName}`}
              className="absolute inset-0 z-0 h-full w-full object-contain opacity-60 mix-blend-screen"
              draggable={false}
            />
          )}
          {/* Source image on top at 50% so the object stays visible without
              burying the yellow mask region underneath. */}
          {sourceImageUrl ? (
            <img
              src={sourceImageUrl}
              alt="source"
              className="absolute inset-0 z-10 h-full w-full object-contain opacity-50"
              draggable={false}
            />
          ) : null}
        </div>
        <p className="text-muted-foreground mt-2 text-[0.7rem]">
          Yellow = region the model will regenerate. Unmarked area = pixel-identical to source.
        </p>
      </div>
    </div>
  );
}

interface GenerateLogEntry {
  id: string;
  timestamp: number;
  ok: boolean;
  request: unknown;
  response?: unknown;
  error?: string;
  durationMs?: number;
}

function GenerateLogOverlay({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<readonly GenerateLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetch("/api/generate-log", { cache: "no-store" })
      .then(async (res) => {
        const data = await tryParseJsonResponse(res);
        if (!res.ok || data === null) {
          throw new Error(`Failed to load log (HTTP ${res.status})`);
        }
        return data as { entries?: readonly GenerateLogEntry[] };
      })
      .then((data) => {
        setEntries(data.entries ?? []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load log");
        setLoading(false);
      });
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const latest = entries[0];
  const jsonText = latest
    ? JSON.stringify(latest, null, 2)
    : "No generate log entries yet. Click Generate first.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-background relative max-h-[85vh] max-w-4xl overflow-auto rounded-lg border p-3 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close generate log"
          className="absolute top-2 right-2 z-10 inline-flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        >
          <X className="size-4" />
        </button>
        <button
          type="button"
          onClick={refresh}
          className="nodrag nopan absolute top-2 right-12 z-10 inline-flex h-8 items-center rounded-full bg-black/60 px-3 text-xs text-white hover:bg-black/80"
        >
          Refresh
        </button>
        <div className="mb-2 flex items-center gap-2 pr-24">
          <span className="text-sm font-medium">Generate request log</span>
          <span className="text-muted-foreground text-xs">
            · {entries.length} entr{entries.length === 1 ? "y" : "ies"} · showing most recent
          </span>
        </div>
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : (
          <textarea
            readOnly
            value={jsonText}
            className="nodrag nopan bg-muted h-[60vh] w-full resize-none rounded-md border p-3 font-mono text-[0.7rem] leading-snug"
            onClick={(event) => event.currentTarget.select()}
          />
        )}
        <p className="text-muted-foreground mt-2 text-[0.7rem]">
          Click the textarea to select all, then Ctrl+C to copy. Paste back to Claude.
        </p>
      </div>
    </div>
  );
}
