import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/welcome/workspace-shell";
import { isSupabaseConfigured, isXiangsuConfigured } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  if (isSupabaseConfigured) {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/login");
  }

  return (
    <WorkspaceShell
      isSupabaseConfigured={isSupabaseConfigured}
      isImageGenerationConfigured={isXiangsuConfigured}
    />
  );
}
