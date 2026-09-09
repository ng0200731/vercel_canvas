import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { DemoBanner } from "@/components/demo-banner";
import { WorkspaceShell } from "@/components/welcome/workspace-shell";
import { getCurrentAdminAccess } from "@/lib/admin";
import { isSupabaseConfigured, isXiangsuConfigured } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  let email: string | null = null;
  let isAdmin = false;

  if (isSupabaseConfigured) {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    email = user?.email ?? null;
    if (!user) redirect("/login");
    isAdmin = (await getCurrentAdminAccess()).isAdmin;
  }

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader email={email} isAdmin={isAdmin} authEnabled={isSupabaseConfigured} />
      <DemoBanner />
      <div className="flex flex-1 flex-col">
        <WorkspaceShell
          isSupabaseConfigured={isSupabaseConfigured}
          isImageGenerationConfigured={isXiangsuConfigured}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}
