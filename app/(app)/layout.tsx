import { AppHeader } from "@/components/app-header";
import { DemoBanner } from "@/components/demo-banner";
import { getCurrentAdminAccess } from "@/lib/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let email: string | null = null;
  let isAdmin = false;
  let generationsLeft: number | null = null;

  if (isSupabaseConfigured) {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? null;
    isAdmin = (await getCurrentAdminAccess()).isAdmin;
    if (user && !isAdmin) {
      const [{ count }, { data: allowance }] = await Promise.all([
        supabase
          .from("generation_records")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
        supabase
          .from("generation_allowance")
          .select("generation_limit")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      generationsLeft = Math.max((allowance?.generation_limit ?? 10) - (count ?? 0), 0);
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
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
