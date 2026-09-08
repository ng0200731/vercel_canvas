import { cookies } from "next/headers";

import { isLocalPostgresConfigured, isSupabaseConfigured, localUserId } from "@/lib/env";
import {
  PREFERRED_SMTP_PROVIDER_COOKIE,
  PREFERRED_SMTP_PROVIDER_SETTING,
  preferredSmtpProviderSchema,
} from "@/lib/email/schemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { createPostgresWorkspaceRecordStore } from "./postgresWorkspaceRecordStore";

/**
 * Server-side scalar settings access shared by the app-settings route and the
 * mailer, so saves and delivery reads agree on the same value/backend.
 *
 * Backend selection:
 *  1. Supabase (service scope, stable `localUserId` row) when configured.
 *  2. Local Postgres when configured.
 *  3. Pure demo mode, or a Supabase/local DB that fails: the SMTP provider
 *     preference falls back to a request-scoped server cookie, so the choice
 *     still drives delivery for that browser. Other settings (e.g. Gemini)
 *     surface DB errors instead.
 */

function isPreferenceCookieValid(value: string | undefined): value is string {
  return typeof value === "string" && preferredSmtpProviderSchema.safeParse(value).success;
}

function databaseConfigured(): boolean {
  return isSupabaseConfigured || isLocalPostgresConfigured;
}

async function getAppSettingFromDb(key: string): Promise<unknown | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await getSupabaseServiceClient()
      .from("app_settings")
      .select("value")
      .eq("user_id", localUserId)
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error(`Failed to read application setting: ${error.message}`);
    return data?.value ?? null;
  }
  return createPostgresWorkspaceRecordStore().getAppSetting(key);
}

async function setAppSettingToDb(key: string, value: unknown): Promise<void> {
  if (isSupabaseConfigured) {
    const { error } = await getSupabaseServiceClient().from("app_settings").upsert(
      {
        user_id: localUserId,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,key" },
    );
    if (error) throw new Error(`Failed to save application setting: ${error.message}`);
    return;
  }
  await createPostgresWorkspaceRecordStore().setAppSetting(key, value);
}

async function readPreferenceCookie(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(PREFERRED_SMTP_PROVIDER_COOKIE)?.value;
  return isPreferenceCookieValid(value) ? value : null;
}

async function writePreferenceCookie(value: unknown): Promise<void> {
  const store = await cookies();
  if (value === null) {
    store.delete(PREFERRED_SMTP_PROVIDER_COOKIE);
    return;
  }
  if (!preferredSmtpProviderSchema.safeParse(value).success) return;
  store.set(PREFERRED_SMTP_PROVIDER_COOKIE, String(value), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
}

export async function getAppSetting(key: string): Promise<unknown | null> {
  if (databaseConfigured()) {
    try {
      return await getAppSettingFromDb(key);
    } catch (error) {
      // SMTP preference is resilient: fall back to the cookie. Other settings
      // surface the DB error to the caller.
      if (key === PREFERRED_SMTP_PROVIDER_SETTING) {
        console.warn("SMTP provider preference read from DB failed; using session cookie.", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return readPreferenceCookie();
      }
      throw error;
    }
  }

  if (key === PREFERRED_SMTP_PROVIDER_SETTING) return readPreferenceCookie();
  return null;
}

export async function setAppSetting(key: string, value: unknown): Promise<void> {
  if (databaseConfigured()) {
    try {
      await setAppSettingToDb(key, value);
      return;
    } catch (error) {
      // SMTP preference persists to the session cookie so saving still works
      // even if the database is unavailable; other settings surface the error.
      if (key === PREFERRED_SMTP_PROVIDER_SETTING) {
        console.warn("SMTP provider preference save to DB failed; persisting to session cookie.", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        await writePreferenceCookie(value);
        return;
      }
      throw error;
    }
  }

  if (key === PREFERRED_SMTP_PROVIDER_SETTING) {
    await writePreferenceCookie(value);
    return;
  }
  throw new Error("No application settings database is configured.");
}