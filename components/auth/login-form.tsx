"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function isEmailNotConfirmed(error: { message: string; code?: string }): boolean {
  return error.code === "email_not_confirmed" || /not confirmed/i.test(error.message);
}

export function LoginForm({ redirectTo = "/" }: { redirectTo?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUnconfirmed(false);
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setLoading(false);
      if (isEmailNotConfirmed(error)) {
        setUnconfirmed(true);
        toast.error("This account isn't confirmed yet.");
      } else {
        toast.error(error.message);
      }
      return;
    }

    // Deactivated accounts must not proceed even though Supabase accepts the
    // password. Read our own profile (RLS permits it) and force a sign-out.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles")
      .select("active")
      .eq("id", user?.id ?? "")
      .maybeSingle();

    setLoading(false);
    if (profile?.active === false) {
      await supabase.auth.signOut();
      toast.error("This account has been deactivated.");
      return;
    }

    toast.success("Signed in");
    router.push(redirectTo);
    router.refresh();
  }

  async function resendConfirmation() {
    setResending(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Confirmation email sent to ${email}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          className="h-10"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-10"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading} className="h-10 w-full">
        {loading ? "Signing in..." : "Sign in"}
      </Button>
      {unconfirmed ? (
        <div className="flex flex-col gap-2">
          <p className="text-destructive text-center text-xs">
            Before you can sign in, confirm your email. Didn&apos;t get the link?
          </p>
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full"
            disabled={resending}
            onClick={resendConfirmation}
          >
            {resending ? "Sending…" : "Resend confirmation email"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
