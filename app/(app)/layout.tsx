import { AppHeader } from "@/components/app-header";
import { DemoBanner } from "@/components/demo-banner";
import { getCurrentAdminAccess } from "@/lib/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let email: string | null = null;
  let isAdmin = false;

  if (isSupabaseConfigured) {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
    isAdmin = (await getCurrentAdminAccess()).isAdmin;
  }

  return (
    <div className="flex min-h-full flex-col">
      <AppHeader email={email} isAdmin={isAdmin} authEnabled={isSupabaseConfigured} />
      <DemoBanner />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
