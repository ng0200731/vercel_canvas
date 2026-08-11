import type { GeneratePromptSourceReference } from "@/lib/generate-prompt";

interface RowMaskSelection {
  sourceNodeId: string;
  maskId: string;
}

interface SelectedMaskUrlsInput {
  prompt: string;
  references: readonly GeneratePromptSourceReference[];
  rowSelections?: readonly RowMaskSelection[];
}

/**
 * Decide which `maskUrl` to attach to each connected source image when the
 * Generate node fires. Returns a map keyed by `source.nodeId`.
 *
 * Two paths feed the result, in priority order:
 *
 * 1. **Explicit prompt rows** — when a row has `sourceNodeId` + `maskId`,
 *    that mask's URL is attached to the source. This is the trusted path:
 *    the user picked the mask in the row UI.
 * 2. **Freeform prompt text** — when no row already covers a source, we
 *    scan the prompt for `@source.alias` plus any of that source's mask
 *    names. If both co-occur, attach the mask. This lets hand-typed
 *    instructions like "@product use the 34 mask to add @logo" trigger
 *    the masked-edit path even when the user never touched the row UI.
 *
 * The first mask on a source whose name appears in the prompt wins for
 * that source. Rows are processed before text so explicit choices always
 * beat the auto-attached heuristic.
 */
export function selectedMaskUrlsForReferences(
  input: SelectedMaskUrlsInput,
): Map<string, string> {
  const { prompt, references, rowSelections } = input;
  const map = new Map<string, string>();
  const lowered = prompt.toLocaleLowerCase();

  function lookupMask(sourceNodeId: string, maskId: string): string | undefined {
    const source = references.find((candidate) => candidate.nodeId === sourceNodeId);
    return source?.masks.find((mask) => mask.id === maskId)?.maskUrl;
  }

  function setIfMissing(sourceNodeId: string, maskUrl: string | undefined): void {
    if (!sourceNodeId || !maskUrl) return;
    if (!map.has(sourceNodeId)) map.set(sourceNodeId, maskUrl);
  }

  // 1. Explicit rows. Persisted rows can be null/undefined or a non-object
  // when a saved canvas has a malformed `promptRows` entry — guard before
  // touching fields or this throws "Cannot read properties of undefined
  // (reading 'sourceNodeId')" on every render of the Generate node.
  for (const row of rowSelections ?? []) {
    if (row === null || typeof row !== "object") continue;
    const sourceNodeId = typeof row.sourceNodeId === "string" ? row.sourceNodeId : "";
    const maskId = typeof row.maskId === "string" ? row.maskId : "";
    if (!sourceNodeId || !maskId) continue;
    setIfMissing(sourceNodeId, lookupMask(sourceNodeId, maskId));
  }

  // 2. Freeform text — only fill in sources the rows didn't already cover.
  for (const source of references) {
    if (map.has(source.nodeId)) continue;
    const url = resolveMaskAttachmentByAlias({ prompt, source, lowered });
    if (url) map.set(source.nodeId, url);
  }

  // Touch `lowered` so the linter doesn't flag it as unused in the
  // signature — when callers pre-compute the lowercase prompt they can
  // pass it through `resolveMaskAttachmentByAlias` directly.
  void lowered;

  return map;
}

interface ResolveAliasInput {
  prompt: string;
  source: GeneratePromptSourceReference;
  /** Optional pre-lowercased prompt to avoid recomputation. */
  lowered?: string;
}

/**
 * Resolve a mask URL by scanning the prompt for `@<source.alias>` plus any
 * of the source's mask names. Returns `undefined` when:
 *   - the source alias does not appear in the prompt, or
 *   - no mask name on the source appears in the prompt, or
 *   - the matching mask has no saved `maskUrl`.
 *
 * Exported separately so the G2 prompt-side resolver can reuse the same
 * logic without re-importing the row-merge machinery.
 */
export function resolveMaskAttachmentByAlias(
  input: ResolveAliasInput,
): string | undefined {
  const { prompt, source } = input;
  const lowered = input.lowered ?? prompt.toLocaleLowerCase();
  const aliasNeedle = `@${source.alias.toLocaleLowerCase()}`;
  if (!lowered.includes(aliasNeedle)) return undefined;
  for (const mask of source.masks) {
    if (!mask.maskUrl) continue;
    const name = mask.name.trim().toLocaleLowerCase();
    if (!name) continue;
    if (lowered.includes(name)) return mask.maskUrl;
  }
  return undefined;
}
