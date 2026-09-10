"use client";

import type { CreatorInfo } from "@/lib/hooks/use-admin-creators";

/**
 * Renders an account's creator info (email + display name) for a list row, or a
 * muted dash when the owner is unknown (e.g. not an admin, or a deleted user).
 */
export function CreatorCell({
  creators,
  userId,
}: {
  creators: ReadonlyMap<string, CreatorInfo>;
  userId?: string | null;
}) {
  const creator = userId ? creators.get(userId) : undefined;
  if (!creator) {
    return <span className="text-muted-foreground">—</span>;
  }
  const showName =
    Boolean(creator.display_name) && creator.display_name !== creator.email;
  return (
    <div className="leading-snug">
      <span className="break-words text-xs">{creator.email || "Unknown"}</span>
      {showName ? (
        <span className="text-muted-foreground block text-xs">{creator.display_name}</span>
      ) : null}
    </div>
  );
}