"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Mail, Send, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendTestEmail } from "@/lib/email/client";
import { emailRecipientSchema } from "@/lib/email/schemas";

import { SettingsPanelHeader } from "./settings-panel-header";

const SETTING_KEY = "preferred-smtp-provider";

type Preference = "163" | "gmail" | null;

interface PreferenceState {
  status: "loading" | "ready" | "unavailable";
  value: Preference;
  error: string | null;
}

const providerCards = [
  {
    label: "Optional override",
    name: "Local catcher",
    server: "SMTP_LOCAL_HOST",
    port: "SMTP_LOCAL_PORT",
    username: "SMTP_LOCAL_USERNAME",
    password: "SMTP_LOCAL_PASSWORD",
  },
  {
    label: "Preferred",
    name: "163.com",
    server: "smtp.163.com",
    port: "465 / SSL",
    username: "SMTP_163_USERNAME",
    password: "SMTP_163_PASSWORD",
  },
  {
    label: "Fallback",
    name: "Gmail",
    server: "smtp.gmail.com",
    port: "587 / STARTTLS",
    username: "SMTP_GMAIL_USERNAME",
    password: "SMTP_GMAIL_PASSWORD",
  },
] as const;

const preferenceOptions = [
  { value: "163" as const, label: "163.com", hint: "Preferred when sending from China." },
  { value: "gmail" as const, label: "Gmail", hint: "Preferred when sending overseas." },
  { value: null, label: "Auto", hint: "163.com first, then Gmail." },
] as const;

const setupSteps = [
  {
    name: "Local catcher (optional)",
    steps: [
      "For local testing, run Mailpit, MailHog, or another local SMTP catcher.",
      "Set SMTP_LOCAL_HOST and SMTP_LOCAL_PORT in .env.local. SMTP_LOCAL_SECURE defaults to false.",
      "Leave these variables blank to send from the local app through 163.com, then Gmail.",
    ],
  },
  {
    name: "163.com",
    steps: [
      "Sign in to mail.163.com, open Settings, then enable the SMTP service under POP3/SMTP/IMAP.",
      "Generate an authorization password. Do not use the normal 163.com account password.",
      "Set SMTP_163_USERNAME to the complete 163.com email address and SMTP_163_PASSWORD to that authorization password.",
    ],
  },
  {
    name: "Gmail",
    steps: [
      "Enable 2-Step Verification on the Google account, then create an App Password for Mail.",
      "Set SMTP_GMAIL_USERNAME to the complete Gmail address and SMTP_GMAIL_PASSWORD to the 16-character App Password.",
      "Gmail uses required STARTTLS on port 587.",
    ],
  },
] as const;

export function SmtpSettingsPanel() {
  // Default to Auto (null) so the choice is usable immediately; the stored
  // value is loaded on mount. Options stay selectable even if the settings API
  // is unavailable — saving simply reports a clear error in that case.
  const [pref, setPref] = useState<PreferenceState>({
    status: "ready",
    value: null,
    error: null,
  });
  const [savingPref, setSavingPref] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/app-settings?key=${SETTING_KEY}`);
        if (response.status === 503) {
          if (cancelled) return;
          setPref({ status: "unavailable", value: null, error: null });
          return;
        }
        const payload = (await response.json()) as { value?: "163" | "gmail" | null; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          setPref({
            status: "unavailable",
            value: null,
            error: payload.error ?? "Failed to load the current setting.",
          });
          return;
        }
        const stored = payload.value === "163" || payload.value === "gmail" ? payload.value : null;
        setPref({ status: "ready", value: stored, error: null });
      } catch {
        if (cancelled) return;
        setPref({ status: "unavailable", value: null, error: "Unable to reach the settings API." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function choosePreference(next: Preference) {
    if (next === pref.value) return;
    const previous = pref.value;
    // Reflect the user's choice immediately; persistence is attempted below.
    setPref((current) => ({ ...current, value: next }));
    setSavingPref(true);
    try {
      const response = await fetch("/api/app-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: SETTING_KEY, value: next }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Failed to save the setting.");
      setPref({ status: "ready", value: next, error: null });
      toast.success(
        next === null
          ? "Auto: 163.com first, then Gmail."
          : `Preferred provider set to ${next === "163" ? "163.com" : "Gmail"}.`,
      );
    } catch (error) {
      // Persistence failed (e.g. no database configured). Revert the selection
      // so the UI does not silently claim a preference that was not saved.
      setPref({ status: "unavailable", value: previous, error: null });
      toast.error(
        error instanceof Error
          ? `${error.message} Your choice was not saved.`
          : "Unable to save the setting.",
      );
    } finally {
      setSavingPref(false);
    }
  }

  async function handleTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedRecipient = emailRecipientSchema.safeParse(recipient);
    if (!parsedRecipient.success) {
      toast.error(parsedRecipient.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }

    setSending(true);
    try {
      const result = await sendTestEmail({ to: parsedRecipient.data });
      toast.success(
        `Test email accepted by ${
          result.provider === "local"
            ? "Local SMTP"
            : result.provider === "163"
              ? "163.com"
              : "Gmail"
        }.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test email failed.");
    } finally {
      setSending(false);
    }
  }

  const isUnavailable = pref.status === "unavailable";

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <SettingsPanelHeader
        title="SMTP delivery"
        description="Choose which remote provider is tried first. The chosen provider is attempted first; if it fails, the other configured remote provider is used automatically. An optional local SMTP catcher always overrides remote delivery."
        action={
          pref.status === "ready" ? (
            <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
              <Mail className="size-3.5" />
              {pref.value === null
                ? "Auto: 163.com then Gmail"
                : `Preferred: ${pref.value === "163" ? "163.com" : "Gmail"}`}
            </span>
          ) : null
        }
      />

      {isUnavailable ? (
        <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-4 text-sm">
          <p className="font-medium">Saved provider preference is unavailable right now.</p>
          <p className="text-muted-foreground mt-1 leading-6">
            {pref.error ??
              "Configure Supabase or local Postgres to persist your choice here."}{" "}
            The default is <strong>Auto</strong> (163.com first, then Gmail). Without a database,
            your selection is not saved, so sending keeps using the default order.
          </p>
        </div>
      ) : null}

      <form className="rounded-lg border p-5">
        <div className="flex items-start gap-3">
          <span className="bg-secondary text-secondary-foreground grid size-9 shrink-0 place-items-center rounded-md">
            <Mail className="size-4" />
          </span>
          <div>
            <h3 className="font-semibold">Preferred remote provider</h3>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              The other configured provider remains the automatic fallback. Local SMTP, when set,
              always takes precedence over this choice.
            </p>
          </div>
        </div>

        <fieldset disabled={savingPref}>
          <legend className="sr-only">Preferred SMTP provider</legend>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {preferenceOptions.map((option) => {
              const checked = pref.value === option.value;
              return (
                <label
                  key={option.label}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                    checked ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="preferred-smtp-provider"
                    value={option.value ?? ""}
                    checked={checked}
                    onChange={() => void choosePreference(option.value)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="text-muted-foreground block text-xs leading-5">
                      {option.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {savingPref ? (
            <p className="text-muted-foreground mt-3 inline-flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </p>
          ) : null}
        </fieldset>
      </form>

      <div className="overflow-hidden rounded-lg border">
        <div className="bg-muted/40 grid gap-px md:grid-cols-3">
          {providerCards.map((provider) => (
            <article key={provider.name} className="bg-background p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="bg-secondary text-secondary-foreground grid size-9 place-items-center rounded-md">
                  <Mail className="size-4" />
                </span>
                <div>
                  <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                    {provider.label}
                  </p>
                  <h3 className="font-semibold">{provider.name}</h3>
                </div>
              </div>
              <dl className="grid gap-3 text-sm">
                <div className="grid grid-cols-[7rem_1fr] items-center gap-3 border-t pt-3">
                  <dt className="text-muted-foreground flex items-center gap-2">
                    <Server className="size-3.5" /> Server
                  </dt>
                  <dd className="text-right font-medium">{provider.server}</dd>
                </div>
                <div className="grid grid-cols-[7rem_1fr] items-center gap-3 border-t pt-3">
                  <dt className="text-muted-foreground">Port</dt>
                  <dd className="text-right font-medium">{provider.port}</dd>
                </div>
                <div className="grid grid-cols-[7rem_1fr] items-center gap-3 border-t pt-3">
                  <dt className="text-muted-foreground">Username</dt>
                  <dd className="truncate text-right font-mono text-xs">{provider.username}</dd>
                </div>
                <div className="grid grid-cols-[7rem_1fr] items-center gap-3 border-t pt-3">
                  <dt className="text-muted-foreground">Password</dt>
                  <dd className="truncate text-right font-mono text-xs">{provider.password}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>

      <form onSubmit={(event) => void handleTest(event)} className="rounded-lg border p-5">
        <div className="flex items-start gap-3">
          <span className="bg-secondary text-secondary-foreground grid size-9 shrink-0 place-items-center rounded-md">
            <Send className="size-4" />
          </span>
          <div>
            <h3 className="font-semibold">Send a test email</h3>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              Performs a real SMTP delivery using the same preferred-provider-with-fallback flow as
              Canvas Send.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="smtp-test-recipient">Recipient email</Label>
            <Input
              id="smtp-test-recipient"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              disabled={sending}
              required
            />
          </div>
          <Button type="submit" disabled={sending}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            {sending ? "Sending..." : "Send test email"}
          </Button>
        </div>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        {setupSteps.map((provider) => (
          <article key={provider.name} className="rounded-lg border p-5">
            <h3 className="font-semibold">{provider.name}</h3>
            <ol className="text-muted-foreground mt-3 grid list-decimal gap-2 pl-5 text-sm leading-6">
              {provider.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>
        ))}
      </div>

      <div className="bg-muted/35 flex items-start gap-3 rounded-lg border p-4 text-sm leading-6">
        <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" />
        <div>
          <p>
            In Vercel, open Project Settings → Environment Variables, add at least one complete
            credential pair (163.com and/or Gmail), and redeploy. The preferred-provider choice here
            only reorders those configured providers — it does not change credentials. Set local
            SMTP variables only for a local catcher. You may also set{" "}
            <span className="font-mono text-xs">SMTP_FROM_NAME</span> for the sender display name.
          </p>
          <p className="mt-2">
            Email credentials must never use the{" "}
            <span className="font-mono text-xs">NEXT_PUBLIC_</span> prefix and must not be entered
            in the browser.
          </p>
        </div>
      </div>
    </section>
  );
}
