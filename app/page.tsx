import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { DemoBanner } from "@/components/demo-banner";
import { WorkspaceShell } from "@/components/welcome/workspace-shell";
import { getCurrentAdminAccess } from "@/lib/admin";
import { isSupabaseConfigured, isXiangsuConfigured } from "@/lib/env";
import { getGenerationUsage } from "@/lib/generation-usage";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  let email: string | null = null;
  let isAdmin = false;
  let accessLevel: 1 | 3 | null = null;
  let generationsLeft: number | null = null;

  if (isSupabaseConfigured) {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    email = user?.email ?? null;
    if (!user) redirect("/login");
    const { isAdmin: adminAccess, accessLevel: level } = await getCurrentAdminAccess();
    isAdmin = adminAccess;
    accessLevel = level;
    if (user && !isAdmin) {
      // Count via the authoritative service-role path (same as enforcement and
      // the admin panel) so the header matches the real record.
      const { remaining } = await getGenerationUsage(user.id);
      generationsLeft = remaining;
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader
        email={email}
        isAdmin={isAdmin}
        authEnabled={isSupabaseConfigured}
        generationsLeft={generationsLeft}
      />
      <DemoBanner />
      <div className="flex flex-1 flex-col">
        <WorkspaceShell
          isSupabaseConfigured={isSupabaseConfigured}
          isImageGenerationConfigured={isXiangsuConfigured}
          isAdmin={isAdmin}
          initialTab={accessLevel === 1 ? "canvas" : undefined}
        />
      </div>
    </div>
  );
}
