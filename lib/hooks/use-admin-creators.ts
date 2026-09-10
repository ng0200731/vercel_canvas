"use client";

import { useEffect, useState } from "react";

export interface CreatorInfo {
  email: string;
  display_name: string;
}

/**
 * Fetch the admin-only id→{email, display_name} map used for Creator columns.
 * When `enabled` is false (e.g. the current user is not an admin), returns an
 * empty map and performs no request.
 */
export function useAdminCreators(enabled: boolean): Map<string, CreatorInfo> {
  const [creators, setCreators] = useState<Map<string, CreatorInfo>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/admin/creators", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { creators?: Record<string, CreatorInfo> }) => {
        if (cancelled || !body?.creators) return;
        setCreators(new Map(Object.entries(body.creators)));
      })
      .catch(() => {
        // Non-fatal: Creator column simply shows a dash.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return creators;
}
