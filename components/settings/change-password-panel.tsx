"use client";

import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPassword } from "./user-management-actions";
import { SettingsPanelHeader } from "./settings-panel-header";

export function ChangePasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      toast.success("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <SettingsPanelHeader
        eyebrow="Settings"
        title="User"
        description="Change your account password."
        action={
          <span className="bg-primary/10 text-primary flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold">
            <KeyRound className="size-3.5" />
            Your account
          </span>
        }
      />

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="bg-card flex max-w-md flex-col gap-4 rounded-lg border p-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            required
            autoComplete="current-password"
            className="h-9"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            className="h-9"
            placeholder="At least 6 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy || !currentPassword || newPassword.length < 6}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}
