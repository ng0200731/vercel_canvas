import { isSupabaseConfigured } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type AdminAccess = {
  accessLevel: 1 | 3 | null;
  isAdmin: boolean;
};

/** Read the current user's access level from the server-side profile. */
export async function getCurrentAdminAccess(): Promise<AdminAccess> {
  if (!isSupabaseConfigured) {
    return { accessLevel: null, isAdmin: false };
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { accessLevel: null, isAdmin: false };
  }

  const { data } = await supabase
    .from("profiles")
    .select("access_level")
    .eq("id", user.id)
    .maybeSingle();

  const accessLevel = data?.access_level === 3 ? 3 : data?.access_level === 1 ? 1 : null;
  return { accessLevel, isAdmin: accessLevel === 3 };
}
