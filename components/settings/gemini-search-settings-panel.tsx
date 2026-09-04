"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsPanelHeader } from "@/components/settings/settings-panel-header";

const SETTING_KEY = "gemini-match-min-cosine";
const MIN = 0;
const MAX = 1;
const STEP = 0.01;
// Keeps the panel's hint in sync with lib/env.ts GEMINI_MATCH_MIN_COSINE default.
// Changing the env default means updating this number too.
const ENV_DEFAULT = 0;

const PRESETS = [
  { label: "Loose 0.70", value: 0.7 },
  { label: "Balanced 0.80", value: 0.8 },
  { label: "Strict 0.85", value: 0.85 },
] as const;

interface SettingState {
  status: "loading" | "ready" | "unavailable";
  value: number | null;
  error: string | null;
}

function parseThreshold(input: string): number | null {
  if (input.trim() === "") return null;
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function GeminiSearchSettingsPanel() {
  const [state, setState] = useState<SettingState>({
    status: "loading",
    value: null,
    error: null,
  });
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/app-settings?key=${SETTING_KEY}`);
        if (response.status === 503) {
          if (cancelled) return;
          setState({ status: "unavailable", value: null, error: null });
          setDraft(String(ENV_DEFAULT));
          return;
        }
        const payload = (await response.json()) as { value?: number | null; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          setState({
            status: "unavailable",
            value: null,
            error: payload.error ?? "Failed to load the current setting.",
          });
          setDraft(String(ENV_DEFAULT));
          return;
        }
        const stored = typeof payload.value === "number" ? payload.value : null;
        setState({ status: "ready", value: stored, error: null });
        setDraft(String(stored ?? ENV_DEFAULT));
      } catch {
        if (cancelled) return;
        setState({ status: "unavailable", value: null, error: "Unable to reach the settings API." });
        setDraft(String(ENV_DEFAULT));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPreset = useCallback((value: number) => {
    setDraft(value.toFixed(2));
  }, []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseThreshold(draft);
    if (parsed === null || parsed < MIN || parsed > MAX) {
      toast.error(`Enter a value between ${MIN} and ${MAX}.`);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/app-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: SETTING_KEY, value: parsed }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to save the setting.");
      }
      setState({ status: "ready", value: parsed, error: null });
      toast.success("Saved — applies to the next Gemini search.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the setting.");
    } finally {
      setSaving(false);
    }
  }

  const isUnavailable = state.status === "unavailable";
  const draftValue = parseThreshold(draft);
  const canSave =
    state.status !== "loading" &&
    !saving &&
    draftValue !== null &&
    draftValue >= MIN &&
    draftValue <= MAX &&
    !(state.value !== null && draftValue === state.value);

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <SettingsPanelHeader
        title="Gemini image search"
        description="Live override of GEMINI_MATCH_MIN_COSINE. Catalog images below this cosine similarity are dropped before ranking, so visually-off near-misses no longer pad the results. Editing here takes effect on the next search — no server restart. Leave at 0 to keep every ranked result."
        action={
          state.status === "ready" ? (
            <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
              <Sparkles className="size-3.5" />
              Using {state.value === null ? `env default (${ENV_DEFAULT.toFixed(2)})` : state.value.toFixed(2)}
            </span>
          ) : null
        }
      />

      {isUnavailable ? (
        <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-4 text-sm">
          <p className="font-medium">Database-backed settings are unavailable.</p>
          <p className="text-muted-foreground mt-1 leading-6">
            {state.error ?? "Configure Supabase or local Postgres to use this panel."} For now,
            edit <code className="font-mono text-xs">GEMINI_MATCH_MIN_COSINE</code> in{" "}
            <code className="font-mono text-xs">.env.local</code> and restart the dev server.
          </p>
        </div>
      ) : null}

      <form onSubmit={handleSave} className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="gemini-min-cosine" className="text-sm font-medium">
            Minimum cosine similarity ({MIN.toFixed(2)}–{MAX.toFixed(2)})
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="gemini-min-cosine"
              type="number"
              inputMode="decimal"
              step={STEP}
              min={MIN}
              max={MAX}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={state.status === "loading" || isUnavailable}
              className="w-32 font-mono tabular-nums"
              aria-label="Minimum cosine similarity"
            />
            <span className="text-muted-foreground text-xs">
              {state.value === null
                ? `env default ${ENV_DEFAULT.toFixed(2)} when unset`
                : `current ${state.value.toFixed(2)}`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applyPreset(preset.value)}
                disabled={state.status === "loading" || isUnavailable}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => applyPreset(0)}
              disabled={state.status === "loading" || isUnavailable}
            >
              Reset (0)
            </Button>
          </div>
          <p className="text-muted-foreground text-xs leading-5">
            <strong>Loose 0.70</strong> surfaces more candidates; <strong>Strict 0.85</strong> keeps
            only the closest visual matches. <strong>Reset (0)</strong> keeps every ranked result
            (the original behaviour).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!canSave}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save setting"}
          </Button>
          {state.status === "loading" ? (
            <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              Loading current value…
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
