"use client";

import React, { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMasquerade } from "@/contexts/MasqueradeContext";
import { useChatContext } from "@/contexts/ChatContext";
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";
import { HierarchyBreadcrumb } from "./HierarchyBreadcrumb";
import { UserAvatar } from "./UserAvatar";
import { UserContextMenu } from "./UserContextMenu";
import { VenetianMask, X, Search, Building2 } from "lucide-react";

// ── Search Trigger ───────────────────────────────────────

function SearchTrigger() {
  const { openPanel } = useChatContext();
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

  return (
    <button
      className="hf-topbar-search"
      onClick={openPanel}
      title={`Search or jump to... ${isMac ? "⌘K" : "Ctrl+K"}`}
      aria-label="Open search"
    >
      <Search size={14} />
      <span className="hf-topbar-search-label">Search...</span>
      <kbd className="hf-topbar-kbd">{isMac ? "⌘K" : "⌃K"}</kbd>
    </button>
  );
}

// ── Institution Chip ─────────────────────────────────────

function InstitutionChip() {
  const { data: session } = useSession();
  const [name, setName] = useState<string | null>(null);

  const institutionId = (session?.user as Record<string, unknown> | undefined)?.institutionId as
    | string
    | undefined;

  useEffect(() => {
    if (!institutionId) return;
    fetch(`/api/institutions/${institutionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.institution?.name) setName(data.institution.name);
        else if (data?.name) setName(data.name);
      })
      .catch(() => {});
  }, [institutionId]);

  if (!institutionId || !name) return null;

  return (
    <span className="hf-topbar-institution" title={name}>
      <Building2 size={12} />
      {name}
    </span>
  );
}

// ── Top Bar ──────────────────────────────────────────────

export function TopBar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [showMenu, setShowMenu] = useState(false);
  const { masquerade, isMasquerading, stopMasquerade } = useMasquerade();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const breadcrumbs = useBreadcrumbs();

  // Close menu on pathname change
  useEffect(() => {
    setShowMenu(false);
  }, [pathname]);

  const realRole = session?.user?.role as string | undefined;
  const realIsAdmin = realRole === "ADMIN" || realRole === "SUPERADMIN";

  if (!session?.user) return null;

  const masqueradeName = masquerade?.name || masquerade?.email || "Unknown";

  return (
    <header className="hf-topbar">
      {/* Left: breadcrumbs */}
      <div className="hf-topbar-left">
        <HierarchyBreadcrumb segments={breadcrumbs} />
      </div>

      {/* Center: search trigger */}
      <div className="hf-topbar-center">
        <SearchTrigger />
      </div>

      {/* Right: institution + masquerade + avatar */}
      <div className="hf-topbar-right">
        <InstitutionChip />

        {isMasquerading && masquerade && (
          <div
            role="status"
            aria-label={`Viewing as ${masqueradeName}`}
            className="hf-topbar-masquerade"
          >
            <VenetianMask size={14} />
            <span>
              Viewing as <strong>{masqueradeName}</strong> ({masquerade.role})
            </span>
            <button
              onClick={(e) => {
                e.preventDefault();
                stopMasquerade();
              }}
              className="hf-topbar-masquerade-exit"
              title="Exit masquerade"
              aria-label="Exit masquerade"
            >
              <X size={12} />
            </button>
          </div>
        )}

        <button
          ref={triggerRef}
          onClick={() => setShowMenu((v) => !v)}
          className="p-1 rounded-lg hover:bg-[var(--hover-bg)] transition-colors"
          title="Account"
          aria-label="Account menu"
        >
          <UserAvatar
            name={session.user.name || session.user.email || "?"}
            initials={session.user.avatarInitials}
            role={realRole}
            size={32}
          />
        </button>

        <UserContextMenu
          isOpen={showMenu}
          onClose={() => setShowMenu(false)}
          anchorRef={triggerRef}
          masqueradeOptions={realIsAdmin ? { isRealAdmin: true } : undefined}
        />
      </div>
    </header>
  );
}
