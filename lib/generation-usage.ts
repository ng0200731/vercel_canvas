import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type GenerationGuardResult =
  | { ok: true; userId: string; isAdmin: boolean }
  | { ok: false; status: 401 | 403 | 429; error: string; remaining?: number };

export async function authorizeGeneration(): Promise<GenerationGuardResult> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Authentication is required." };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("access_level, active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.active === false) {
    return { ok: false, status: 403, error: "This account has been deactivated." };
  }
  if (profile?.access_level === 3) return { ok: true, userId: user.id, isAdmin: true };

  const service = getSupabaseServiceClient();
  const [{ count, error: countError }, { data: allowance, error: allowanceError }] = await Promise.all([
    service.from("generation_records").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    service.from("generation_allowance").select("generation_limit").eq("user_id", user.id).maybeSingle(),
  ]);
  if (countError) throw countError;
  if (allowanceError) throw allowanceError;
  const limit = allowance?.generation_limit ?? 10;
  const remaining = Math.max(limit - (count ?? 0), 0);
  if (remaining === 0) {
    return { ok: false, status: 429, error: "Your lifetime generation allowance has been used up.", remaining: 0 };
  }
  return { ok: true, userId: user.id, isAdmin: false };
}

export async function consumeSuccessfulGeneration(input: {
  userId: string;
  model: string;
  prompt: string;
  size?: string;
  outputUrl: string;
}): Promise<{ allowed: boolean; remaining: number }> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service.rpc("consume_generation", {
    p_user_id: input.userId,
    p_model: input.model,
    p_prompt: input.prompt,
    p_size: input.size ?? null,
    p_output_url: input.outputUrl,
  });
  if (error) throw error;
  const result = (data ?? {}) as { allowed?: boolean; remaining?: number };
  return { allowed: result.allowed === true, remaining: result.remaining ?? 0 };
}
