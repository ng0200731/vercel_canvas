"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ChevronDown,
  Copy,
  Gauge,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  createUser,
  deleteUser,
  sendUserPasswordReset,
  setUserActive,
  setUserGenerationLimit,
  setUserPassword,
} from "./user-management-actions";
import { SettingsPanelHeader } from "./settings-panel-header";

type UserRecord = {
  id: string;
  model: string;
  prompt: string;
  size: string | null;
  output_url: string;
  created_at: string;
};

type ManagedUser = {
  id: string;
  email: string;
  last_login_at: string | null;
  display_name: string;
  access_level: number;
  is_admin: boolean;
  active: boolean;
  used: number;
  remaining: number | null;
  limit: number | null;
  records: UserRecord[];
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function UserManagementPanel() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    | { id: string; action: "toggle" | "reset" | "delete" | "create" | "limit" | "password" }
    | null
  >(null);
  const isBusy = (id: string, action?: "toggle" | "reset" | "delete" | "create" | "limit" | "password") =>
    busy !== null && busy.id === id && (action === undefined || busy.action === action);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const creating = isBusy("new", "create");

  const [editing, setEditing] = useState<{ user: ManagedUser; kind: "limit" | "password" } | null>(null);
  const [allowanceInput, setAllowanceInput] = useState("");
  const [directPasswordInput, setDirectPasswordInput] = useState("");
  const [createdCredential, setCreatedCredential] = useState<{
    link: string;
    email: string;
    password: string;
    copied: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      try {
        const res = await fetch("/api/admin/users", { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { users?: ManagedUser[]; error?: string } | null;
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(body?.error ?? `Failed to load users (${res.status}).`);
        }
        setUsers(body?.users ?? []);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load users.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void initialLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { users?: ManagedUser[]; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `Failed to load users (${res.status}).`);
      setUsers(body?.users ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  async function toggleActive(user: ManagedUser) {
    setBusy({ id: user.id, action: "toggle" });
    try {
      await setUserActive(user.id, !user.active);
      toast.success(`${user.email} ${user.active ? "deactivated" : "reactivated"}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(user: ManagedUser) {
    setBusy({ id: user.id, action: "reset" });
    try {
      const result = await sendUserPasswordReset(user.id);
      toast.success(`Password recovery email sent to ${result.email}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send reset email.");
    } finally {
      setBusy(null);
    }
  }

  async function removeUser(user: ManagedUser) {
    setBusy({ id: user.id, action: "delete" });
    try {
      await deleteUser(user.id);
      toast.success(`${user.email} was deleted.`);
      if (expandedId === user.id) setExpandedId(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the account.");
    } finally {
      setBusy(null);
    }
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
      } catch {
        return false;
      }
    }
  }

  async function createAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy({ id: "new", action: "create" });
    try {
      const result = await createUser(newEmail, newPassword, newDisplayName);
      // Capture the credentials BEFORE clearing the form fields, then copy the
      // register link + email + password so the admin can paste them elsewhere.
      const email = newEmail;
      const password = newPassword;
      const link = `${window.location.origin}/login`;
      const block = `Register link\n${link}\n\nEmail\n${email}\n\nPassword\n${password}`;
      const copied = await copyText(block);
      setCreatedCredential({ link, email, password, copied });
      toast.success(
        copied
          ? `${result.email} created — credentials copied, ready to paste.`
          : `${result.email} created — ready to sign in.`,
      );
      setNewEmail("");
      setNewPassword("");
      setNewDisplayName("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the account.");
    } finally {
      setBusy(null);
    }
  }

  function openLimitDialog(user: ManagedUser) {
    setAllowanceInput(user.limit?.toString() ?? "");
    setEditing({ user, kind: "limit" });
  }

  function openPasswordDialog(user: ManagedUser) {
    setDirectPasswordInput("");
    setEditing({ user, kind: "password" });
  }

  async function submitLimit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing || editing.kind !== "limit") return;
    const parsed = Number(allowanceInput);
    setBusy({ id: editing.user.id, action: "limit" });
    try {
      await setUserGenerationLimit(editing.user.id, parsed);
      toast.success(`Allowance set for ${editing.user.email}.`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the allowance.");
    } finally {
      setBusy(null);
    }
  }

  async function submitDirectPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing || editing.kind !== "password") return;
    setBusy({ id: editing.user.id, action: "password" });
    try {
      await setUserPassword(editing.user.id, directPasswordInput);
      toast.success(`Password reset for ${editing.user.email}.`);
      setEditing(null);
      setDirectPasswordInput("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the password.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <SettingsPanelHeader
        eyebrow="Settings"
        title="Users"
        description="Manage registered accounts and their lifetime generation allowance."
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            disabled={loading}
          >
            <RefreshCw />
            Refresh
          </Button>
        }
      />

      <form
        onSubmit={(e) => void createAccount(e)}
        className="bg-card flex flex-col gap-3 rounded-lg border p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-52 flex-1 flex-col gap-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              required
              autoComplete="off"
              className="h-9"
              placeholder="user@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <div className="flex min-w-40 flex-col gap-1.5">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              required
              autoComplete="new-password"
              className="h-9"
              placeholder="At least 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="flex min-w-40 flex-1 flex-col gap-1.5">
            <Label htmlFor="new-display-name">Display name (optional)</Label>
            <Input
              id="new-display-name"
              type="text"
              autoComplete="off"
              className="h-9"
              placeholder="e.g. Alice"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={creating || busy !== null}
            className="h-9 shrink-0"
          >
            {creating ? "Creating…" : "Create account"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          The account is created immediately and can sign in — no confirmation email is sent.
        </p>
      </form>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
      ) : error ? (
        <p className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
          {error}
        </p>
      ) : !users || users.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No registered users yet.
        </p>
      ) : (
        <div className="bg-card flex flex-col overflow-hidden rounded-lg border shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground border-b text-xs font-medium tracking-wide uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Account
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Access
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Generations
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Last login
                  </th>
                  <th scope="col" className="w-36 px-4 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((user) => {
                  const expanded = expandedId === user.id;
                  return (
                    <Fragment key={user.id}>
                      <tr className="hover:bg-muted/35 transition-colors">
                        <td className="max-w-72 px-4 py-3 align-top">
                          <button
                            type="button"
                            className="focus-visible:ring-ring hover:text-primary rounded-sm text-left font-medium break-words outline-none focus-visible:ring-2"
                            onClick={() => setExpandedId(expanded ? null : user.id)}
                          >
                            {user.email}
                          </button>
                          {user.display_name ? (
                            <span className="text-muted-foreground mt-0.5 block text-xs">
                              {user.display_name}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {user.is_admin ? (
                            <Badge>Admin</Badge>
                          ) : (
                            <Badge variant="secondary">User</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {user.active ? (
                            <span className="text-emerald-600">Active</span>
                          ) : (
                            <span className="text-destructive">Inactive</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top tabular-nums">
                          {user.is_admin ? (
                            <span className="text-muted-foreground">Unlimited</span>
                          ) : (
                            <span>
                              {user.used} / {user.limit} used · {user.remaining} left
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top tabular-nums">
                          {user.last_login_at ? (
                            <span className="text-muted-foreground">{formatDate(user.last_login_at)}</span>
                          ) : (
                            <span className="text-muted-foreground">Never</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant={user.active ? "outline" : "default"}
                              disabled={busy !== null || user.is_admin}
                              title={
                                user.is_admin
                                  ? "Admin accounts cannot be deactivated."
                                  : undefined
                              }
                              onClick={() => void toggleActive(user)}
                            >
                              {isBusy(user.id, "toggle") ? "Saving…" : user.active ? "Deactivate" : "Activate"}
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Set generation allowance for ${user.email}`}
                              disabled={busy !== null || user.is_admin}
                              title={
                                user.is_admin
                                  ? "Admin accounts are unlimited."
                                  : "Set the number of generations"
                              }
                              onClick={() => openLimitDialog(user)}
                            >
                              <Gauge />
                            </Button>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Reset password for ${user.email}`}
                              disabled={busy !== null}
                              title="Reset password (set a new one directly)"
                              onClick={() => openPasswordDialog(user)}
                            >
                              <KeyRound />
                            </Button>
                            <ConfirmDialog
                              title="Send password reset email?"
                              description={`A password recovery link will be sent to ${user.email}. Their password will not be shown or changed here.`}
                              confirmLabel="Send email"
                              destructive={false}
                              onConfirm={() => resetPassword(user)}
                              trigger={
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Send password reset email to ${user.email}`}
                                  disabled={busy !== null}
                                  title="Send password reset email"
                                >
                                  <Mail />
                                </Button>
                              }
                            />
                            <ConfirmDialog
                              title="Delete account permanently?"
                              description={`This permanently deletes ${user.email}, their profile, projects, images, and generation records. This cannot be undone.`}
                              confirmLabel="Delete account"
                              onConfirm={() => removeUser(user)}
                              trigger={
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  aria-label={`Delete ${user.email}`}
                                  disabled={busy !== null || user.is_admin}
                                  title={user.is_admin ? "Admin accounts cannot be deleted." : "Delete account"}
                                >
                                  <Trash2 />
                                </Button>
                              }
                            />
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-expanded={expanded}
                              aria-label="Toggle generation records"
                              disabled={busy !== null}
                              onClick={() => setExpandedId(expanded ? null : user.id)}
                            >
                              <ChevronDown
                                className={cn("size-4 transition-transform", expanded && "rotate-180")}
                              />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr key={`${user.id}-records`}>
                          <td colSpan={6} className="bg-muted/20 px-4 py-3">
                            {user.records.length === 0 ? (
                              <p className="text-muted-foreground py-2 text-center text-xs">
                                No generations recorded.
                              </p>
                            ) : (
                              <ul className="flex flex-col gap-2">
                                {user.records.map((record) => (
                                  <li
                                    key={record.id}
                                    className="bg-background flex items-center gap-3 rounded-md border p-2"
                                  >
                                    {record.output_url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={record.output_url}
                                        alt={record.prompt}
                                        className="size-12 shrink-0 rounded object-cover"
                                      />
                                    ) : (
                                      <span className="bg-muted flex size-12 shrink-0 items-center justify-center rounded">
                                        <ShieldAlert className="text-muted-foreground size-4" />
                                      </span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">{record.prompt}</p>
                                      <p className="text-muted-foreground text-xs">
                                        {record.model}
                                        {record.size ? ` · ${record.size}` : ""} ·{" "}
                                        {formatDate(record.created_at)}
                                      </p>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing?.kind === "limit" ? (
          <DialogContent>
            <form onSubmit={(e) => void submitLimit(e)}>
              <DialogHeader>
                <DialogTitle>Set generation allowance</DialogTitle>
                <DialogDescription>
                  Set the lifetime allowance for {editing.user.email}. Their remaining count becomes
                  this allowance minus the generations they have already used (
                  {editing.user.used} used).
                </DialogDescription>
              </DialogHeader>
              <div className="my-4 flex flex-col gap-1.5">
                <Label htmlFor="allowance-input">Generation allowance</Label>
                <Input
                  id="allowance-input"
                  type="number"
                  min={0}
                  step={1}
                  required
                  inputMode="numeric"
                  autoFocus
                  value={allowanceInput}
                  onChange={(e) => setAllowanceInput(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                  disabled={busy !== null}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy !== null || !Number.isInteger(Number(allowanceInput))}
                >
                  {isBusy(editing.user.id, "limit") ? "Saving…" : "Set allowance"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : editing?.kind === "password" ? (
          <DialogContent>
            <form onSubmit={(e) => void submitDirectPassword(e)}>
              <DialogHeader>
                <DialogTitle>Reset password</DialogTitle>
                <DialogDescription>
                  Set a new password directly for {editing.user.email}. They will sign in with this
                  new password from now on.
                </DialogDescription>
              </DialogHeader>
              <div className="my-4 flex flex-col gap-1.5">
                <Label htmlFor="direct-password-input">New password</Label>
                <Input
                  id="direct-password-input"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  autoFocus
                  value={directPasswordInput}
                  onChange={(e) => setDirectPasswordInput(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                  disabled={busy !== null}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy !== null || directPasswordInput.length < 6}
                >
                  {isBusy(editing.user.id, "password") ? "Saving…" : "Set password"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    <Dialog
        open={createdCredential !== null}
        onOpenChange={(open) => !open && setCreatedCredential(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{createdCredential?.copied ? "Credentials copied" : "Account created"}</DialogTitle>
            <DialogDescription>
              {createdCredential?.copied
                ? "The register link and credentials were copied to your clipboard — paste them wherever you share logins."
                : "The account was created, but the clipboard was not available. Copy the details below."}
            </DialogDescription>
          </DialogHeader>
          {createdCredential ? (
            <div className="my-2 grid gap-2.5">
              <div className="bg-muted/40 flex flex-col gap-0.5 rounded-md border p-3">
                <span className="text-muted-foreground text-xs font-medium">Register link</span>
                <span className="text-sm break-all">{createdCredential.link}</span>
              </div>
              <div className="bg-muted/40 flex flex-col gap-0.5 rounded-md border p-3">
                <span className="text-muted-foreground text-xs font-medium">Email</span>
                <span className="text-sm break-all">{createdCredential.email}</span>
              </div>
              <div className="bg-muted/40 flex flex-col gap-0.5 rounded-md border p-3">
                <span className="text-muted-foreground text-xs font-medium">Password</span>
                <span className="text-sm break-all">{createdCredential.password}</span>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreatedCredential(null)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!createdCredential}
              onClick={() => {
                if (!createdCredential) return;
                void copyText(
                  `Register link\n${createdCredential.link}\n\nEmail\n${createdCredential.email}\n\nPassword\n${createdCredential.password}`,
                ).then(() => {
                  setCreatedCredential((current) => (current ? { ...current, copied: true } : current));
                  toast.success("Credentials copied.");
                });
              }}
            >
              <Copy />
              Copy again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
