import { NextResponse } from "next/server";

import { getCurrentAdminAccess } from "@/lib/admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ProfileRow = {
  id: string;
  display_name: string | null;
  access_level: number;
  active: boolean;
};

type RecordRow = {
  id: string;
  user_id: string;
  model: string;
  prompt: string;
  size: string | null;
  output_url: string;
  created_at: string;
};

export async function GET() {
  const { isAdmin } = await getCurrentAdminAccess();
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = getSupabaseServiceClient();
  // Emails live in auth.users, not profiles. Use the Auth admin API (service role)
  // for the address list, then join profile metadata + generation usage.
  const { data: authUsers, error: authError } = await service.auth.admin.listUsers();
  if (authError) throw authError;
  const emailByUser = new Map(
    (authUsers?.users ?? []).map((u) => [u.id, u.email ?? ""]),
  );

  const [
    { data: profiles, error: profilesError },
    { data: allowances, error: allowancesError },
    { data: records, error: recordsError },
  ] = await Promise.all([
    service.from("profiles").select("id, display_name, access_level, active").order("created_at", { ascending: true }),
    service.from("generation_allowance").select("user_id, generation_limit"),
    service.from("generation_records").select("id, user_id, model, prompt, size, output_url, created_at").order("created_at", { ascending: false }),
  ]);
  if (profilesError || allowancesError || recordsError) {
    return NextResponse.json(
      { error: profilesError?.message ?? allowancesError?.message ?? recordsError?.message ?? "Failed to load users." },
      { status: 500 },
    );
  }

  const allowanceByUser = new Map((allowances ?? []).map((a) => [a.user_id, a.generation_limit]));
  const recordsByUser = new Map<string, RecordRow[]>();
  for (const record of records ?? []) {
    const list = recordsByUser.get(record.user_id) ?? [];
    list.push(record);
    recordsByUser.set(record.user_id, list);
  }

  const users = (profiles ?? []).map((profile: ProfileRow) => {
    const used = (recordsByUser.get(profile.id) ?? []).length;
    const limit = allowanceByUser.get(profile.id) ?? 10;
    const isAdminUser = profile.access_level === 3;
    return {
      id: profile.id,
      email: emailByUser.get(profile.id) ?? "",
      display_name: profile.display_name ?? "",
      access_level: profile.access_level,
      is_admin: isAdminUser,
      active: profile.active,
      used,
      remaining: isAdminUser ? null : Math.max(limit - used, 0),
      limit: isAdminUser ? null : limit,
      records: (recordsByUser.get(profile.id) ?? []).map((r) => ({
        id: r.id,
        model: r.model,
        prompt: r.prompt,
        size: r.size,
        output_url: r.output_url,
        created_at: r.created_at,
      })),
    };
  });

  return NextResponse.json({ users });
}