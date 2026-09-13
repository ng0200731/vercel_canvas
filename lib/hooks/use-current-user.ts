"use client";

import { useEffect, useState } from "react";

import { isSupabaseConfigured } from "@/lib/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * The signed-in user's id, or null while loading / when signed out.
 * Used to tell a user's own records apart from admin-shared ones.
 */
export function useCurrentUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;

    async function load() {
      try {
        const { data } = await getSupabaseBrowserClient().auth.getUser();
        if (!cancelled) setUserId(data.user?.id ?? null);
      } catch {
        if (!cancelled) setUserId(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return userId;
}