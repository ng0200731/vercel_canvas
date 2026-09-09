"use client";

import { Layers3 } from "lucide-react";

import { signOut } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";

export function AppHeader({ email, authEnabled }: { email: string | null; authEnabled: boolean }) {
  return (
    <header className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b px-4 backdrop-blur">
      <span className="inline-flex h-10 items-center gap-2 px-2 text-sm font-semibold tracking-tight">
        <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md">
          <Layers3 className="size-4" />
        </span>
        Infinite Canvas
      </span>
      <div className="flex items-center gap-3">
        {authEnabled && email ? (
          <>
            <span className="text-muted-foreground hidden text-xs sm:inline">{email}</span>
            <form action={signOut}>
              <Button size="sm" variant="ghost" type="submit">
                Sign out
              </Button>
            </form>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">Demo mode</span>
        )}
      </div>
    </header>
  );
}
