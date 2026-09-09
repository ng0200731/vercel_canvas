import { isSupabaseConfigured } from "@/lib/env";
import { DemoAuthNotice } from "@/components/auth/demo-auth-notice";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "Reset password — Canvas" };

export default function ResetPasswordPage() {
  if (!isSupabaseConfigured) {
    return <DemoAuthNotice />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="text-muted-foreground text-sm">Choose a new password to sign in</p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
