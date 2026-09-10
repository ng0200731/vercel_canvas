import { NextResponse } from "next/server";

import { getCurrentAdminAccess } from "@/lib/admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Admin-only: map every user id to an { email, display_name } for the Creator
 * columns in the Projects / Customers / Suppliers / Products lists. Emails live
 * in auth.users (not exposed to PostgREST), so this uses the service-role client.
 */
export async function GET() {
  const { isAdmin } = await getCurrentAdminAccess();
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = getSupabaseServiceClient();
  const { data: authUsers, error: authError } = await service.auth.admin.listUsers();
  if (authError) throw authError;

  const { data: profiles, error: profilesError } = await service
    .from("profiles")
    .select("id, display_name");
  if (profilesError) throw profilesError;

  const displayNameByUser = new Map((profiles ?? []).map((p) => [p.id, p.display_name ?? ""]));

  const creators: Record<string, { email: string; display_name: string }> = {};
  for (const user of authUsers?.users ?? []) {
    creators[user.id] = {
      email: user.email ?? "",
      display_name: displayNameByUser.get(user.id) ?? "",
    };
  }

  return NextResponse.json({ creators });
}
