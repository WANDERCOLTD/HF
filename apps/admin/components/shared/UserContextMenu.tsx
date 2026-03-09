"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  LogOut,
  Sun,
  Moon,
  Monitor,
  ChevronRight,
  User,
  Settings2,
  VenetianMask,
  Search,
  Loader2,
  Bug,
  Radio,
  Brain,
  GraduationCap,
  BookOpen,
  Building2,
  RotateCcw,
  FileX,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useMasquerade } from "@/contexts/MasqueradeContext";
import { useDomainScope } from "@/contexts/DomainScopeContext";
import { UserAvatar, ROLE_COLORS } from "./UserAvatar";

interface UserContextMenuProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  unreadCount?: number;
  masqueradeOptions?: {
    isRealAdmin: boolean;
  };
}

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: "Super Admin",
  ADMIN: "Admin",
  OPERATOR: "Operator",
  EDUCATOR: "Educator",
  SUPER_TESTER: "Super Tester",
  TESTER: "Tester",
  DEMO: "Demo",
  VIEWER: "Viewer",
};

const ROLE_LEVEL: Record<string, number> = {
  SUPERADMIN: 5,
  ADMIN: 4,
  OPERATOR: 3,
  SUPER_TESTER: 2,
  TESTER: 1,
  VIEWER: 1,
  DEMO: 0,
};

const BUG_REPORTER_KEY = "ui.bugReporter";
const WIZARD_THINKING_KEY = "wizard.thinking-enabled";
const WIZARD_FIELD_PICKER_KEY = "wizard.field-picker";

export function UserContextMenu({
  isOpen,
  onClose,
  anchorRef,
  masqueradeOptions,
}: UserContextMenuProps) {
  const { data: session } = useSession();
  const { preference: theme, setPreference: setTheme } = useTheme();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [stepInOpen, setStepInOpen] = useState(false);
  const [stepInSearch, setStepInSearch] = useState("");
  const [stepInRoleFilter, setStepInRoleFilter] = useState("");
  const [stepInUsers, setStepInUsers] = useState<{ id: string; email: string; name: string | null; displayName: string | null; role: string; assignedDomain?: { id: string; name: string } | null }[]>([]);
  const [stepInLoading, setStepInLoading] = useState(false);
  const [quickPickLoading, setQuickPickLoading] = useState<string>("");
  const stepInSearchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { isMasquerading, startMasquerade } = useMasquerade();
  const { setDomainScope } = useDomainScope();
  const [domains, setDomains] = useState<{ id: string; name: string; callerCount: number; playbookCount: number }[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // ── Quick Toggles ──
  const sessionRole = (session?.user?.role as string) || "";
  const roleLevel = ROLE_LEVEL[sessionRole] ?? 0;
  const isOperator = roleLevel >= 3;
  const isAdmin = roleLevel >= 4;

  // Bug reporter toggle (localStorage)
  const [bugReporterEnabled, setBugReporterEnabled] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem(BUG_REPORTER_KEY);
    if (stored !== null) setBugReporterEnabled(stored !== "false");
  }, []);

  // Wizard thinking toggle (localStorage)
  const [wizardThinkingEnabled, setWizardThinkingEnabled] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem(WIZARD_THINKING_KEY);
    if (stored !== null) setWizardThinkingEnabled(stored !== "false");
  }, []);

  // Wizard field picker toggle (localStorage)
  const [wizardFieldPickerEnabled, setWizardFieldPickerEnabled] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem(WIZARD_FIELD_PICKER_KEY);
    if (stored !== null) setWizardFieldPickerEnabled(stored !== "false");
  }, []);

  // Demo reset (SUPERADMIN only)
  const isSuperAdmin = sessionRole === "SUPERADMIN";
  const [demoResetState, setDemoResetState] = useState<"idle" | "confirm" | "running" | "done" | "error">("idle");
  const [demoResetResult, setDemoResetResult] = useState<{ callers: number; playbooks: number; cohorts: number } | null>(null);

  const handleDemoReset = useCallback(async () => {
    setDemoResetState("running");
    try {
      const res = await fetch("/api/admin/demo-reset-scoped", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setDemoResetResult(data.deleted);
        setDemoResetState("done");
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        setDemoResetState("error");
        setTimeout(() => setDemoResetState("idle"), 4000);
      }
    } catch {
      setDemoResetState("error");
      setTimeout(() => setDemoResetState("idle"), 4000);
    }
  }, []);

  // Content reset (SUPERADMIN only) — forces re-extraction on next upload
  const [contentResetState, setContentResetState] = useState<"idle" | "picking" | "confirm" | "running" | "done" | "error">("idle");
  const [contentResetCount, setContentResetCount] = useState(0);
  const [contentResetDomains, setContentResetDomains] = useState<{ id: string; name: string; sourceCount: number }[]>([]);
  const [contentResetDomain, setContentResetDomain] = useState<{ id: string; name: string } | null>(null);
  const [contentDomainsLoading, setContentDomainsLoading] = useState(false);

  const handleContentResetPick = useCallback(async () => {
    setContentResetState("picking");
    setContentDomainsLoading(true);
    try {
      const res = await fetch("/api/domains");
      if (res.ok) {
        const data = await res.json();
        setContentResetDomains(
          (data.domains || []).map((d: Record<string, unknown>) => ({
            id: d.id as string,
            name: d.name as string,
            sourceCount: (d.sourceCount ?? 0) as number,
          }))
        );
      }
    } finally {
      setContentDomainsLoading(false);
    }
  }, []);

  const handleContentReset = useCallback(async () => {
    if (!contentResetDomain) return;
    setContentResetState("running");
    try {
      const res = await fetch("/api/admin/demo-reset-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: contentResetDomain.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setContentResetCount(data.deleted.sources);
        setContentResetState("done");
        setTimeout(() => setContentResetState("idle"), 4000);
      } else {
        setContentResetState("error");
        setTimeout(() => setContentResetState("idle"), 4000);
      }
    } catch {
      setContentResetState("error");
      setTimeout(() => setContentResetState("idle"), 4000);
    }
  }, [contentResetDomain]);

  // Deep logging toggle (server-side, ADMIN+ only — fetch on menu open)
  const [deepLogging, setDeepLogging] = useState(false);
  useEffect(() => {
    if (!isAdmin || !isOpen) return;
    fetch("/api/admin/deep-logging")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setDeepLogging(data.enabled); })
      .catch(() => {});
  }, [isAdmin, isOpen]);

  const handleToggleBugReporter = useCallback(() => {
    const next = !bugReporterEnabled;
    setBugReporterEnabled(next);
    localStorage.setItem(BUG_REPORTER_KEY, String(next));
    window.dispatchEvent(
      new StorageEvent("storage", { key: BUG_REPORTER_KEY, newValue: String(next) })
    );
  }, [bugReporterEnabled]);

  const handleToggleWizardThinking = useCallback(() => {
    const next = !wizardThinkingEnabled;
    setWizardThinkingEnabled(next);
    localStorage.setItem(WIZARD_THINKING_KEY, String(next));
    window.dispatchEvent(
      new StorageEvent("storage", { key: WIZARD_THINKING_KEY, newValue: String(next) })
    );
  }, [wizardThinkingEnabled]);

  const handleToggleWizardFieldPicker = useCallback(() => {
    const next = !wizardFieldPickerEnabled;
    setWizardFieldPickerEnabled(next);
    localStorage.setItem(WIZARD_FIELD_PICKER_KEY, String(next));
    window.dispatchEvent(
      new StorageEvent("storage", { key: WIZARD_FIELD_PICKER_KEY, newValue: String(next) })
    );
  }, [wizardFieldPickerEnabled]);

  const handleToggleDeepLogging = useCallback(async () => {
    const newValue = !deepLogging;
    setDeepLogging(newValue);
    try {
      const res = await fetch("/api/admin/deep-logging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newValue }),
      });
      if (!res.ok) setDeepLogging(!newValue);
    } catch {
      setDeepLogging(!newValue);
    }
  }, [deepLogging]);

  // Fetch users for step-in picker
  const fetchStepInUsers = useCallback(async (q: string, roleFilter: string) => {
    setStepInLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      if (roleFilter) params.set("role", roleFilter);
      const qs = params.toString();
      const res = await fetch(`/api/admin/masquerade/users${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setStepInUsers(data.users || []);
      }
    } finally {
      setStepInLoading(false);
    }
  }, []);

  // Quick step-in by role: auto-pick if exactly 1 user, otherwise show filtered list
  const handleQuickStepIn = useCallback(async (role: "EDUCATOR" | "STUDENT") => {
    setQuickPickLoading(role);
    try {
      const res = await fetch(`/api/admin/masquerade/users?role=${role}`);
      if (!res.ok) return;
      const data = await res.json();
      const users = data.users || [];

      if (users.length === 1) {
        await startMasquerade(users[0].id);
        onClose();
      } else {
        setStepInRoleFilter(role);
        setStepInUsers(users);
      }
    } finally {
      setQuickPickLoading("");
    }
  }, [startMasquerade, onClose]);

  // Quick step-in: Domain — fetch domains list
  const handleDomainPick = useCallback(async () => {
    setStepInRoleFilter("DOMAIN");
    setDomainsLoading(true);
    try {
      const res = await fetch("/api/domains");
      if (res.ok) {
        const data = await res.json();
        setDomains(
          (data.domains || []).map((d: Record<string, unknown>) => ({
            id: d.id as string,
            name: d.name as string,
            callerCount: (d.callerCount ?? 0) as number,
            playbookCount: (d.playbookCount ?? 0) as number,
          }))
        );
      }
    } finally {
      setDomainsLoading(false);
    }
  }, []);

  // Fetch when step-in expands or search changes (skip in domain mode — domains are client-filtered)
  useEffect(() => {
    if (!stepInOpen || stepInRoleFilter === "DOMAIN") return;
    const timer = setTimeout(() => fetchStepInUsers(stepInSearch, stepInRoleFilter), 200);
    return () => clearTimeout(timer);
  }, [stepInOpen, stepInSearch, stepInRoleFilter, fetchStepInUsers]);

  // Auto-focus search when step-in expands
  useEffect(() => {
    if (stepInOpen) stepInSearchRef.current?.focus();
  }, [stepInOpen]);

  // Reset submenus when menu closes
  useEffect(() => {
    if (!isOpen) {
      setAppearanceOpen(false);
      setStepInOpen(false);
      setStepInSearch("");
      setStepInRoleFilter("");
      setStepInUsers([]);
      setDomains([]);
      setQuickPickLoading("");
      setDemoResetState("idle");
      setDemoResetResult(null);
      setContentResetState("idle");
      setContentResetCount(0);
      setContentResetDomains([]);
      setContentResetDomain(null);
    }
  }, [isOpen]);

  // Calculate fixed position from anchor button
  useEffect(() => {
    if (!isOpen || !anchorRef.current) {
      setPos(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [isOpen, anchorRef]);

  // Close on outside click / escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen || !session?.user || !pos) return null;

  const userName = session.user.name || session.user.email || "User";
  const userRole = session.user.role;
  const roleLabel = ROLE_LABELS[userRole] || userRole;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        style={{ background: "transparent" }}
      />

      {/* Menu popover — fixed position calculated from anchor button */}
      <div
        ref={menuRef}
        className="fixed z-50 w-72 rounded-xl border overflow-hidden"
        style={{
          background: "var(--surface-primary)",
          borderColor: "var(--border-default)",
          top: pos.top + 4,
          right: pos.right,
          boxShadow:
            "0 20px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04)",
        }}
      >
        {/* User header */}
        <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center gap-3">
            <UserAvatar
              name={userName}
              initials={session.user.avatarInitials}
              role={userRole}
              size={44}
            />
            <div className="flex-1 min-w-0">
              <div
                className="font-semibold text-sm truncate"
                style={{ color: "var(--text-primary)" }}
              >
                {userName}
              </div>
              <div
                className="text-xs truncate mt-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {roleLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Menu items */}
        <div className="p-2">
          {/* My Account */}
          <Link
            href="/x/account"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors hover:bg-[var(--hover-bg)]"
            style={{ color: "var(--text-primary)" }}
          >
            <User className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "var(--text-secondary)" }} />
            My Account
          </Link>

          {/* Settings */}
          <Link
            href="/x/settings"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors hover:bg-[var(--hover-bg)]"
            style={{ color: "var(--text-primary)" }}
          >
            <Settings2 className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "var(--text-secondary)" }} />
            Settings
          </Link>

          {/* Appearance submenu */}
          <div>
            <button
              onClick={() => setAppearanceOpen(!appearanceOpen)}
              className="w-full text-left flex items-center justify-between px-3 py-2.5 text-sm rounded-lg transition-colors hover:bg-[var(--hover-bg)]"
              style={{ color: "var(--text-primary)", border: "none", background: "transparent", cursor: "pointer" }}
            >
              <span className="flex items-center gap-3">
                <Sun className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "var(--text-secondary)" }} />
                Appearance
              </span>
              <ChevronRight
                className="w-3.5 h-3.5 flex-shrink-0 transition-transform"
                style={{
                  color: "var(--text-muted)",
                  transform: appearanceOpen ? "rotate(90deg)" : "rotate(0deg)",
                }}
              />
            </button>

            {/* Appearance submenu items */}
            {appearanceOpen && (
              <div className="mx-2 mb-1 p-1.5 rounded-lg bg-[var(--surface-secondary)]">
                {["light", "dark", "system"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setTheme(mode as "light" | "dark" | "system");
                      setAppearanceOpen(false);
                    }}
                    className="w-full text-left flex items-center gap-3 px-3 py-2 text-[13px] rounded-md transition-colors"
                    style={{
                      color:
                        theme === mode ? "var(--accent-primary)" : "var(--text-secondary)",
                      background:
                        theme === mode ? "var(--surface-primary)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: theme === mode ? 500 : 400,
                    }}
                  >
                    {mode === "light" && <Sun className="w-4 h-4" />}
                    {mode === "dark" && <Moon className="w-4 h-4" />}
                    {mode === "system" && <Monitor className="w-4 h-4" />}
                    <span className="capitalize">{mode === "system" ? "System" : mode}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Masquerade (if admin and not already masquerading) */}
          {masqueradeOptions?.isRealAdmin && !isMasquerading && (
            <div>
              <button
                onClick={() => setStepInOpen(!stepInOpen)}
                className="w-full text-left flex items-center justify-between px-3 py-2.5 text-sm rounded-lg transition-colors hover:bg-[var(--hover-bg)]"
                style={{ color: "var(--text-primary)", border: "none", background: "transparent", cursor: "pointer" }}
              >
                <span className="flex items-center gap-3">
                  <VenetianMask className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "var(--text-secondary)" }} />
                  Step In As…
                </span>
                <ChevronRight
                  className="w-3.5 h-3.5 flex-shrink-0 transition-transform"
                  style={{ color: "var(--text-muted)", transform: stepInOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                />
              </button>

              {stepInOpen && (
                <div className="mx-2 mb-1 p-2 rounded-lg bg-[var(--surface-secondary)]">
                  {/* Quick-pick: Teacher / Learner / Domain */}
                  <div className="flex gap-1.5 mb-2">
                    {([
                      { role: "EDUCATOR" as const, label: "Teacher", Icon: GraduationCap },
                      { role: "STUDENT" as const, label: "Learner", Icon: BookOpen },
                      { role: "DOMAIN" as const, label: "Domain", Icon: Building2 },
                    ]).map(({ role, label, Icon }) => (
                      <button
                        key={role}
                        onClick={() => role === "DOMAIN" ? handleDomainPick() : handleQuickStepIn(role)}
                        disabled={!!quickPickLoading}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-[13px] font-medium rounded-lg border transition-colors hover:bg-[var(--hover-bg)]"
                        style={{
                          borderColor: stepInRoleFilter === role ? "var(--accent-primary)" : "var(--border-default)",
                          background: stepInRoleFilter === role ? "var(--surface-primary)" : "transparent",
                          color: stepInRoleFilter === role ? "var(--accent-primary)" : "var(--text-primary)",
                          cursor: quickPickLoading ? "wait" : "pointer",
                        }}
                      >
                        {quickPickLoading === role
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Icon className="w-4 h-4" />
                        }
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Filter indicator */}
                  {stepInRoleFilter && (
                    <div className="flex items-center justify-between mb-2 px-1">
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        Showing {stepInRoleFilter === "EDUCATOR" ? "teachers" : stepInRoleFilter === "DOMAIN" ? "domains" : "learners"}
                      </span>
                      <button
                        onClick={() => { setStepInRoleFilter(""); setStepInSearch(""); }}
                        className="text-[11px] font-medium transition-colors hover:underline"
                        style={{ color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        Show all
                      </button>
                    </div>
                  )}

                  {/* Search input */}
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
                    <input
                      ref={stepInSearchRef}
                      type="text"
                      value={stepInSearch}
                      onChange={(e) => setStepInSearch(e.target.value)}
                      placeholder={stepInRoleFilter ? `Search ${stepInRoleFilter === "EDUCATOR" ? "teachers" : stepInRoleFilter === "DOMAIN" ? "domains" : "learners"}…` : "Search all users…"}
                      className="w-full rounded-md border pl-8 pr-3 py-2 text-[13px] outline-none transition-colors focus:border-[var(--accent-primary)]"
                      style={{
                        borderColor: "var(--border-default)",
                        background: "var(--surface-primary)",
                        color: "var(--text-primary)",
                      }}
                    />
                  </div>

                  {/* Domain list (when "Domain" filter is active) */}
                  {stepInRoleFilter === "DOMAIN" ? (
                    <div className="max-h-44 overflow-y-auto">
                      {domainsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--text-muted)" }} />
                        </div>
                      ) : domains.length === 0 ? (
                        <div className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                          No domains found
                        </div>
                      ) : (
                        domains
                          .filter((d) => !stepInSearch || d.name.toLowerCase().includes(stepInSearch.toLowerCase()))
                          .map((d) => (
                            <button
                              key={d.id}
                              onClick={() => {
                                setDomainScope(d.id, d.name);
                                onClose();
                              }}
                              className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 text-[13px] rounded-md transition-colors hover:bg-[var(--hover-bg)]"
                              style={{ color: "var(--text-primary)", border: "none", background: "transparent", cursor: "pointer" }}
                            >
                              <div
                                className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                                style={{ background: "var(--surface-secondary)" }}
                              >
                                <Building2 className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="truncate text-[13px]">{d.name}</div>
                                <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                                  {d.callerCount} learner{d.callerCount !== 1 ? "s" : ""} · {d.playbookCount} course{d.playbookCount !== 1 ? "s" : ""}
                                </div>
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  ) : (
                    /* User list */
                    <div className="max-h-44 overflow-y-auto">
                      {stepInLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--text-muted)" }} />
                        </div>
                      ) : stepInUsers.length === 0 ? (
                        <div className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                          {stepInRoleFilter
                            ? `No ${stepInRoleFilter === "EDUCATOR" ? "teachers" : "learners"} found`
                            : "No users found"}
                        </div>
                      ) : (
                        stepInUsers.map((u) => (
                          <button
                            key={u.id}
                            onClick={async () => {
                              await startMasquerade(u.id);
                              onClose();
                            }}
                            className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 text-[13px] rounded-md transition-colors hover:bg-[var(--hover-bg)]"
                            style={{ color: "var(--text-primary)", border: "none", background: "transparent", cursor: "pointer" }}
                          >
                            <UserAvatar name={u.displayName || u.name || u.email} role={u.role} size={24} />
                            <div className="flex-1 min-w-0">
                              <div className="truncate text-[13px]">{u.displayName || u.name || u.email}</div>
                              <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                                {ROLE_LABELS[u.role] || u.role}
                                {u.assignedDomain?.name && (
                                  <span> · {u.assignedDomain.name}</span>
                                )}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Toggles (OPERATOR+) */}
        {isOperator && (
          <>
            <div
              className="border-t mx-2"
              style={{ borderColor: "var(--border-subtle)" }}
            />
            <div className="px-2 pt-2 pb-1">
              <div
                className="px-3 pb-1 text-[11px] font-medium tracking-wide uppercase"
                style={{ color: "var(--text-muted)" }}
              >
                Quick Toggles
              </div>

              {/* Bug Reporter */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ color: "var(--text-primary)" }}
              >
                <span className="flex items-center gap-3 text-sm">
                  <Bug
                    className="w-[18px] h-[18px] flex-shrink-0"
                    style={{ color: "var(--text-secondary)" }}
                  />
                  Bug Reporter
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bugReporterEnabled}
                  className="hf-toggle-mini"
                  onClick={handleToggleBugReporter}
                  title={bugReporterEnabled ? "Bug reporter is ON" : "Bug reporter is OFF"}
                >
                  <div className="hf-toggle-mini-knob" />
                </button>
              </div>

              {/* Wizard Reasoning */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ color: "var(--text-primary)" }}
              >
                <span className="flex items-center gap-3 text-sm">
                  <Brain
                    className="w-[18px] h-[18px] flex-shrink-0"
                    style={{ color: "var(--text-secondary)" }}
                  />
                  Show Reasoning
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={wizardThinkingEnabled}
                  className="hf-toggle-mini"
                  onClick={handleToggleWizardThinking}
                  title={wizardThinkingEnabled ? "Reasoning display ON" : "Reasoning display OFF"}
                >
                  <div className="hf-toggle-mini-knob" />
                </button>
              </div>

              {/* Field Picker mode */}
              <div
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ color: "var(--text-primary)" }}
              >
                <span className="flex items-center gap-3 text-sm">
                  <BookOpen
                    className="w-[18px] h-[18px] flex-shrink-0"
                    style={{ color: "var(--text-secondary)" }}
                  />
                  Chat mode
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={wizardFieldPickerEnabled}
                  className="hf-toggle-mini"
                  onClick={handleToggleWizardFieldPicker}
                  title={wizardFieldPickerEnabled ? "Field picker ON" : "Field picker OFF"}
                >
                  <div className="hf-toggle-mini-knob" />
                </button>
              </div>

              {/* Deep Logging (ADMIN+ only) */}
              {isAdmin && (
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{ color: "var(--text-primary)" }}
                >
                  <span className="flex items-center gap-3 text-sm">
                    <Radio
                      className="w-[18px] h-[18px] flex-shrink-0"
                      style={{
                        color: deepLogging
                          ? "var(--status-error-text)"
                          : "var(--text-secondary)",
                      }}
                    />
                    Deep Logging
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={deepLogging}
                    className="hf-toggle-mini"
                    onClick={handleToggleDeepLogging}
                    title={
                      deepLogging
                        ? "Deep logging ON — capturing full AI prompts/responses"
                        : "Deep logging OFF"
                    }
                  >
                    <div className="hf-toggle-mini-knob" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Reset Demo (SUPERADMIN only) */}
        {isSuperAdmin && (
          <>
            <div className="border-t mx-2" style={{ borderColor: "var(--border-subtle)" }} />
            <div className="px-2 pt-2 pb-1">
              <div className="px-3 pb-1 text-[11px] font-medium tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                Demo
              </div>
              {demoResetState === "idle" && (
                <button
                  type="button"
                  onClick={() => setDemoResetState("confirm")}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors hover:bg-[var(--hover-bg)]"
                  style={{ color: "var(--text-primary)", border: "none", background: "transparent", cursor: "pointer" }}
                >
                  <RotateCcw className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "var(--text-secondary)" }} />
                  Reset Demo
                </button>
              )}
              {demoResetState === "confirm" && (
                <div className="px-3 py-2">
                  <div className="text-[13px] mb-2" style={{ color: "var(--text-secondary)" }}>Remove demo courses + callers?</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleDemoReset}
                      className="flex-1 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors"
                      style={{ background: "var(--status-error-bg)", color: "var(--status-error-text)", border: "none", cursor: "pointer" }}
                    >
                      Yes, reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setDemoResetState("idle")}
                      className="flex-1 px-3 py-1.5 text-[13px] rounded-md transition-colors hover:bg-[var(--hover-bg)]"
                      style={{ background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-default)", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {demoResetState === "running" && (
                <div className="flex items-center gap-2 px-3 py-2.5 text-sm" style={{ color: "var(--text-muted)" }}>
                  <Loader2 className="w-[18px] h-[18px] animate-spin flex-shrink-0" />
                  Resetting…
                </div>
              )}
              {demoResetState === "done" && demoResetResult && (
                <div className="px-3 py-2.5 text-[13px]" style={{ color: "var(--status-success-text)" }}>
                  Reset done — {demoResetResult.playbooks} course{demoResetResult.playbooks !== 1 ? "s" : ""} and {demoResetResult.callers} caller{demoResetResult.callers !== 1 ? "s" : ""} removed
                </div>
              )}
              {demoResetState === "error" && (
                <div className="px-3 py-2.5 text-[13px]" style={{ color: "var(--status-error-text)" }}>
                  Reset failed — check console
                </div>
              )}

              {/* Reset Content — domain picker → confirm → delete */}
              {contentResetState === "idle" && (
                <button
                  type="button"
                  onClick={handleContentResetPick}
                  className="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors hover:bg-[var(--hover-bg)]"
                  style={{ color: "var(--text-primary)", border: "none", background: "transparent", cursor: "pointer" }}
                >
                  <FileX className="w-[18px] h-[18px] flex-shrink-0" style={{ color: "var(--text-secondary)" }} />
                  Reset Content…
                </button>
              )}
              {contentResetState === "picking" && (
                <div className="mx-2 mb-1 p-2 rounded-lg bg-[var(--surface-secondary)]">
                  <div className="text-[11px] font-medium tracking-wide uppercase mb-1.5 px-1" style={{ color: "var(--text-muted)" }}>
                    Choose domain
                  </div>
                  {contentDomainsLoading ? (
                    <div className="flex items-center justify-center py-3">
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--text-muted)" }} />
                    </div>
                  ) : contentResetDomains.length === 0 ? (
                    <div className="py-2 text-center text-xs" style={{ color: "var(--text-muted)" }}>No domains</div>
                  ) : (
                    <div className="max-h-36 overflow-y-auto">
                      {contentResetDomains.map((d) => (
                        <button
                          key={d.id}
                          onClick={() => {
                            setContentResetDomain({ id: d.id, name: d.name });
                            setContentResetState("confirm");
                          }}
                          className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 text-[13px] rounded-md transition-colors hover:bg-[var(--hover-bg)]"
                          style={{ color: "var(--text-primary)", border: "none", background: "transparent", cursor: "pointer" }}
                        >
                          <Building2 className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                          <span className="truncate">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setContentResetState("idle")}
                    className="w-full mt-1 px-2.5 py-1.5 text-[11px] rounded-md transition-colors hover:bg-[var(--hover-bg)]"
                    style={{ color: "var(--text-muted)", background: "transparent", border: "none", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {contentResetState === "confirm" && contentResetDomain && (
                <div className="px-3 py-2">
                  <div className="text-[13px] mb-2" style={{ color: "var(--text-secondary)" }}>
                    Delete all content for <strong>{contentResetDomain.name}</strong>? Next upload will re-extract.
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleContentReset}
                      className="flex-1 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors"
                      style={{ background: "var(--status-warning-bg)", color: "var(--status-warning-text)", border: "none", cursor: "pointer" }}
                    >
                      Yes, reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setContentResetState("idle")}
                      className="flex-1 px-3 py-1.5 text-[13px] rounded-md transition-colors hover:bg-[var(--hover-bg)]"
                      style={{ background: "transparent", color: "var(--text-secondary)", border: "1px solid var(--border-default)", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {contentResetState === "running" && (
                <div className="flex items-center gap-2 px-3 py-2.5 text-sm" style={{ color: "var(--text-muted)" }}>
                  <Loader2 className="w-[18px] h-[18px] animate-spin flex-shrink-0" />
                  Clearing content…
                </div>
              )}
              {contentResetState === "done" && (
                <div className="px-3 py-2.5 text-[13px]" style={{ color: "var(--status-success-text)" }}>
                  Cleared {contentResetCount} source{contentResetCount !== 1 ? "s" : ""} from {contentResetDomain?.name} — next upload will re-extract
                </div>
              )}
              {contentResetState === "error" && (
                <div className="px-3 py-2.5 text-[13px]" style={{ color: "var(--status-error-text)" }}>
                  Content reset failed — check console
                </div>
              )}
            </div>
          </>
        )}

        {/* Divider */}
        <div
          className="border-t mx-2"
          style={{ borderColor: "var(--border-subtle)" }}
        />

        {/* Sign out */}
        <div className="p-2">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors hover:bg-[var(--hover-bg)]"
            style={{ color: "var(--text-secondary)", border: "none", background: "transparent", cursor: "pointer" }}
          >
            <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}
