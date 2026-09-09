"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type RecoveryState = "checking" | "ready" | "invalid";

export function ResetPasswordForm() {
  const router = useRouter();
  const [state, setState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function verify() {
      try {
        const supabase = getSupabaseBrowserClient();
        // @supabase/ssr exchanges the recovery code/token during client init;
        // getUser() confirms a valid, unexpired recovery session is present.
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();
        if (cancelled) return;
        setState(!error && user ? "ready" : "invalid");
      } catch {
        if (!cancelled) setState("invalid");
      }
    }
    void verify();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.auth.signOut();
    toast.success("Password updated. Please sign in with your new password.");
    router.push("/login");
  }

  if (state === "checking") {
    return <p className="text-muted-foreground py-8 text-center text-sm">Checking link…</p>;
  }

  if (state === "invalid") {
    return (
      <p className="text-destructive rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-6 text-center text-sm">
        This password reset link is invalid or has expired. Request a new one from the admin.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          required
          autoComplete="new-password"
          autoFocus
          className="h-10"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          type="password"
          required
          autoComplete="new-password"
          className="h-10"
          placeholder="Re-enter your new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading} className="h-10 w-full">
        {loading ? "Updating…" : "Set new password"}
      </Button>
    </form>
  );
}
