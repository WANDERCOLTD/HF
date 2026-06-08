"use client";

import { useEffect, useRef, useState } from "react";
import { TRIAGE, type CallerSummary } from "@/lib/callers";

/**
 * Fancy caller picker — a custom (non-native) dropdown: type to filter,
 * status dot per caller, call count, click-outside to close.
 */
export function CallerSelect({
  callers,
  selectedId,
  onSelect,
}: {
  callers: CallerSummary[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selected = callers.find((c) => c.id === selectedId) ?? callers[0];
  const filtered = callers.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  );

  if (!selected) {
    return (
      <div style={{ padding: "14px 16px", borderRadius: 14, border: "1px solid var(--border-default)", background: "var(--surface-secondary)", color: "var(--text-tertiary)", fontSize: 14 }}>
        Loading callers…
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderRadius: 14,
          border: `1px solid ${open ? "var(--band-high)" : "var(--border-default)"}`,
          background: "var(--surface-secondary)",
          color: "var(--text-primary)",
          cursor: "pointer",
          textAlign: "left",
          transition: "border-color 0.2s, box-shadow 0.2s",
          boxShadow: open ? "0 0 0 3px color-mix(in srgb, var(--band-high) 20%, transparent)" : "none",
        }}
      >
        <Dot color={TRIAGE[selected.triage].color} />
        <span style={{ flex: 1, fontWeight: 600 }}>{selected.name}</span>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {selected.totalCalls} calls
        </span>
        <span style={{ color: "var(--text-tertiary)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            zIndex: 20,
            background: "var(--surface-primary)",
            border: "1px solid var(--border-default)",
            borderRadius: 14,
            boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
            overflow: "hidden",
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search callers…"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "12px 16px",
              border: "none",
              borderBottom: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: 14,
              outline: "none",
            }}
          />
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {filtered.length === 0 && (
              <div style={{ padding: 16, fontSize: 13, color: "var(--text-tertiary)" }}>No matches</div>
            )}
            {filtered.map((c) => {
              const active = c.id === selected.id;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelect(c.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 16px",
                    border: "none",
                    background: active ? "var(--hover-bg)" : "transparent",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = active ? "var(--hover-bg)" : "transparent")}
                >
                  <Dot color={TRIAGE[c.triage].color} />
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-tertiary)" }}>{c.email}</span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.totalCalls} calls</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        boxShadow: `0 0 8px ${color}`,
      }}
    />
  );
}
