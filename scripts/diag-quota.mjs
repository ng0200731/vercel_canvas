// Read-only diagnostic: compare true generation usage (service role) vs
// what the header's RLS-scoped path would show.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "https://iknleatjuxewioxujuxr.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}
const svc = createClient(url, key, { auth: { persistSession: false } });

// 1. Authoritative state (bypasses RLS, same as admin panel + generation-usage)
const { data: allowances, error: aErr } = await svc
  .from("generation_allowance")
  .select("user_id, generation_limit, updated_at");
const { data: records, error: rErr } = await svc
  .from("generation_records")
  .select("id, user_id, model, created_at")
  .order("created_at", { ascending: false });

if (aErr || rErr) {
  console.error("query error", aErr ?? rErr);
  process.exit(1);
}

console.log("=== generation_allowance (true) ===");
console.table(allowances ?? []);
console.log("=== generation_records: count per user_id (true) ===");
const byUser = {};
for (const r of records ?? []) byUser[r.user_id] = (byUser[r.user_id] ?? 0) + 1;
console.table(byUser);

// 2. Simulate the header path (RLS) for an anon user -> what does auth.uid()=null yield
const anon = createClient(url, "sb_publishable_KenPHU5Rao_CE_nYEkXcOw_9sUu7eRV", {
  auth: { persistSession: false },
});
const { count, error: cErr } = await anon
  .from("generation_records")
  .select("id", { count: "exact", head: true });
console.log("\nRLS count for anon (no session):", count, "err:", cErr?.message);
