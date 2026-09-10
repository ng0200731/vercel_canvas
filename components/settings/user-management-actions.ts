"use server";

import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { getCurrentAdminAccess } from "@/lib/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** The canonical owner account can never be deleted. */
const PROTECTED_ADMIN_EMAIL = "eric.brilliant@gmail.com";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertUuid(userId: string) {
  if (!userId || !UUID_RE.test(userId)) {
    throw new Error("A valid user id is required.");
  }
}

/**
 * Admin-only: create a regular (level-1) account directly with an email and
 * password. `email_confirm: true` mints the account pre-confirmed, so no
 * confirmation email is sent and the user can sign in immediately.
 */
export async function createUser(email: string, password: string, displayName?: string) {
  const { isAdmin } = await getCurrentAdminAccess();
  if (!isAdmin) {
    throw new Error("Forbidden: only an admin can create accounts.");
  }

  const normalizedEmail = (email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) {
    throw new Error("Enter a valid email address.");
  }
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: displayName ? { display_name: displayName.trim() } : undefined,
  });

  if (error) {
    if (error.status === 422 || /already registered|already been registered/i.test(error.message)) {
      throw new Error("An account with that email already exists.");
    }
    throw new Error("Failed to create the account.");
  }

  revalidatePath("/");
  return { ok: true, email: normalizedEmail };
}

/**
 * Admin-only: toggle whether a user account is active. Uses the service-role
 * client (bypasses RLS) because the profiles RLS policy restricts writes to the
 * row owner; admin visibility is enforced here with getCurrentAdminAccess.
 */
export async function setUserActive(userId: string, active: boolean) {
  const { isAdmin } = await getCurrentAdminAccess();
  if (!isAdmin) {
    throw new Error("Forbidden: only an admin can deactivate accounts.");
  }
  if (!userId) {
    throw new Error("A user id is required.");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("profiles")
    .update({ active })
    .eq("id", userId);
  if (error) {
    throw new Error(`Failed to update account: ${error.message}`);
  }

  revalidatePath("/");
  return { ok: true, active };
}

/**
 * Admin-only: permanently delete a user's account (Auth + cascaded user data)
 * and their uploaded storage objects. Never deletes the current admin or the
 * canonical owner account.
 */
export async function deleteUser(userId: string) {
  const { isAdmin } = await getCurrentAdminAccess();
  if (!isAdmin) {
    throw new Error("Forbidden: only an admin can delete accounts.");
  }
  assertUuid(userId);

  const supabase = getSupabaseServiceClient();

  const server = await getSupabaseServerClient();
  const {
    data: { user: actor },
  } = await server.auth.getUser();
  if (actor?.id === userId) {
    throw new Error("You cannot delete the account you are signed in as.");
  }

  const { data: target, error: targetError } = await supabase.auth.admin.getUserById(userId);
  if (targetError || !target.user) {
    throw new Error("That account no longer exists.");
  }
  if (target.user.email?.toLowerCase() === PROTECTED_ADMIN_EMAIL) {
    throw new Error("The owner account cannot be deleted.");
  }

  // Storage objects are not removed by Auth/database cascades — clean them up.
  await removeUploadsFolder(supabase, userId);

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error("Failed to delete the account.");
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Admin-only: set a user's lifetime generation allowance to a specific number.
 * Remaining generations = target allowance − generations already used. The
 * service-role client bypasses RLS so admins can write any user's row.
 */
export async function setUserGenerationLimit(userId: string, generationLimit: number) {
  const { isAdmin } = await getCurrentAdminAccess();
  if (!isAdmin) {
    throw new Error("Forbidden: only an admin can change generation allowances.");
  }
  assertUuid(userId);
  if (!Number.isInteger(generationLimit) || generationLimit < 0) {
    throw new Error("Enter a whole number of 0 or more.");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("generation_allowance").upsert(
    { user_id: userId, generation_limit: generationLimit },
    { onConflict: "user_id" },
  );
  if (error) {
    throw new Error(`Failed to update the generation allowance: ${error.message}`);
  }

  revalidatePath("/");
  return { ok: true, generationLimit };
}

/**
 * Admin-only: set a user's password directly (not via an email link).
 */
export async function setUserPassword(userId: string, newPassword: string) {
  const { isAdmin } = await getCurrentAdminAccess();
  if (!isAdmin) {
    throw new Error("Forbidden: only an admin can reset passwords.");
  }
  assertUuid(userId);
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) {
    throw new Error(`Failed to reset the password: ${error.message}`);
  }

  revalidatePath("/");
  return { ok: true };
}

/**
 * Admin-only: send the user a password-recovery email. The email is resolved
 * server-side (never trusted from the client); no password is set or returned.
 */
export async function sendUserPasswordReset(userId: string) {
  const { isAdmin } = await getCurrentAdminAccess();
  if (!isAdmin) {
    throw new Error("Forbidden: only an admin can reset passwords.");
  }
  assertUuid(userId);

  const supabase = getSupabaseServiceClient();
  const { data: target, error: targetError } = await supabase.auth.admin.getUserById(userId);
  if (targetError || !target.user) {
    throw new Error("That account no longer exists.");
  }
  const email = target.user.email;
  if (!email) {
    throw new Error("That account has no email address to send a recovery link to.");
  }

  const redirectTo = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/reset-password`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) {
    throw new Error("Failed to send the password recovery email.");
  }

  return { ok: true, email };
}

async function removeUploadsFolder(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
): Promise<void> {
  const { data: objects, error: listError } = await supabase.storage
    .from("uploads")
    .list(userId, { limit: 1000 });
  if (listError) return; // Folder may not exist; nothing to remove.
  const paths = (objects ?? [])
    .filter((item) => !item.id) // skip "folder" markers
    .map((item) => `${userId}/${item.name}`);
  if (paths.length > 0) {
    await supabase.storage.from("uploads").remove(paths);
  }
}

/**
 * Any signed-in user: change their own password. The current password is
 * verified first (by re-signing in under the user's session), so a bad or
 * forgotten current password is rejected instead of silently overwriting it.
 */
export async function changeOwnPassword(currentPassword: string, newPassword: string) {
  if (!currentPassword) {
    throw new Error("Enter your current password.");
  }
  if (!newPassword || newPassword.length < 6) {
    throw new Error("New password must be at least 6 characters.");
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    throw new Error("You must be signed in to change your password.");
  }

  // Verify the current password by signing in with the session's email.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) {
    throw new Error("Your current password is incorrect.");
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    throw new Error(`Failed to change the password: ${updateError.message}`);
  }

  revalidatePath("/");
  return { ok: true };
}
