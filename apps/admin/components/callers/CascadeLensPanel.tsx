/**
 * CascadeLensPanel — voice cascade provenance card (issue #1348).
 *
 * Mounts inside the caller page's voice section, adjacent to
 * <VoiceProviderOverride>. Fetches GET /api/callers/[callerId]/cascade/voice
 * on mount, renders one row per cascadeable voice field with:
 *   - the resolved value (winning layer's value)
 *   - four layer pills: System / Provider / Domain / Course
 *   - the winning pill highlighted + clickable as a deep-link
 *   - non-winning pills dimmed; tooltip shows "not set" (present: false)
 *     or that layer's value (present: true but overridden by higher layer)
 *   - a lock icon on rows where LOCKED_KEYS includes the key
 *
 * Defaults to collapsed; header shows "Voice cascade · N layers · M fields".
 *
 * STUDENT/VIEWER render guard: API returns 403 for sub-OPERATOR roles,
 * but we also bail at render time so a STUDENT session doesn't see an
 * empty error banner.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { ROLE_LEVEL } from "@/lib/roles";
import type { UserRole } from "@prisma/client";
import "./cascade-lens-panel.css";

type Layer = "system" | "provider" | "domain" | "course";

interface CascadeLayerEntry {
  layer: Layer;
  value: unknown;
  present: boolean;
}

interface CascadeField {
  key: string;
  resolvedValue: unknown;
  winningSource: Layer;
  locked: boolean;
  chain: CascadeLayerEntry[];
}

interface VoiceCascadeExplanation {
  cascade: "voice";
  callerId: string;
  playbookId: string | null;
  courseId: string | null;
  providerId: string | null;
  resolvedAt: string;
  fields: CascadeField[];
}

const LAYER_LABELS: Record<Layer, string> = {
  system: "Sys",
  provider: "Prov",
  domain: "Dom",
  course: "Crs",
};

const LAYER_ORDER: Layer[] = ["system", "provider", "domain", "course"];

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || '""';
  if (Array.isArray(value)) {
    const joined = value.map((v) => String(v)).join(", ");
    return joined.length > 60 ? joined.slice(0, 57) + "…" : joined;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function deepLinkFor(
  layer: Layer,
  data: VoiceCascadeExplanation,
): string | null {
  switch (layer) {
    case "system":
      return "/x/settings/voice-providers";
    case "provider":
      // Suppress when providerId is null (operator setting drift). The
      // explainer falls back to synthetic schema in that case.
      return data.providerId
        ? `/x/settings/voice-providers/${data.providerId}`
        : null;
    case "domain":
      // TODO(#1348-followup): when /x/domains/[id]/voice ships, deep-link
      // to it here. For now fall back to the settings page so the
      // click isn't a dead end.
      console.warn(
        "[CascadeLensPanel] domain layer deep-link falls back to /x/settings/voice-providers — no /x/domains/[id]/voice editor exists yet (#1348 follow-up).",
      );
      return "/x/settings/voice-providers";
    case "course":
      return data.courseId ? `/x/courses/${data.courseId}?tab=design` : null;
    default:
      return null;
  }
}

interface PillProps {
  layer: Layer;
  entry: CascadeLayerEntry;
  isWinner: boolean;
  href: string | null;
}

function LayerPill({ layer, entry, isWinner, href }: PillProps) {
  const className = [
    "hf-cascade-pill",
    isWinner
      ? "hf-cascade-pill--active"
      : entry.present
        ? "hf-cascade-pill--dim"
        : "hf-cascade-pill--empty",
  ].join(" ");

  const title = isWinner
    ? `Winning: ${formatValue(entry.value)} — click to edit at this scope`
    : entry.present
      ? `${LAYER_LABELS[layer]}: ${formatValue(entry.value)} (overridden by higher layer)`
      : `${LAYER_LABELS[layer]}: not set`;

  const label = isWinner
    ? LAYER_LABELS[layer].toUpperCase()
    : LAYER_LABELS[layer].toLowerCase();

  if (isWinner && href) {
    return (
      <a className={className} href={href} title={title}>
        {label}
      </a>
    );
  }
  return (
    <span className={className} title={title}>
      {label}
    </span>
  );
}

export function CascadeLensPanel({ callerId }: { callerId: string }) {
  const { data: session } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<VoiceCascadeExplanation | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const userLevel = useMemo(() => {
    const role = session?.user?.role as UserRole | undefined;
    if (!role) return 0;
    return ROLE_LEVEL[role] ?? 0;
  }, [session?.user?.role]);
  const operatorOrBetter = userLevel >= ROLE_LEVEL.OPERATOR;

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/callers/${callerId}/cascade/voice`);
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setData(body.data as VoiceCascadeExplanation);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [callerId]);

  useEffect(() => {
    if (!operatorOrBetter) return;
    load();
  }, [load, operatorOrBetter]);

  // STUDENT / VIEWER / TESTER — render nothing so they don't see a
  // confusing empty error block. The API also 403s them.
  if (!operatorOrBetter) return null;

  const fieldCount = data?.fields.length ?? 0;

  return (
    <section className="hf-card hf-cascade-lens">
      <button
        type="button"
        className="hf-cascade-lens-toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="hf-cascade-lens-caret" aria-hidden="true">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="hf-cascade-lens-title">
          Voice cascade · 4 layers
          {fieldCount > 0 ? ` · ${fieldCount} fields` : ""}
        </span>
      </button>

      {expanded ? (
        <div className="hf-cascade-lens-body">
          {loading ? (
            <div className="hf-empty">
              <span className="hf-spinner" aria-label="Loading" /> Loading voice
              cascade&hellip;
            </div>
          ) : err ? (
            <div className="hf-banner hf-banner-error">{err}</div>
          ) : data ? (
            <ul className="hf-cascade-rows">
              {data.fields.map((field) => (
                <li
                  key={field.key}
                  className="hf-cascade-row"
                  data-locked={field.locked || undefined}
                >
                  <span className="hf-cascade-lock" aria-hidden="true">
                    {field.locked ? "🔒" : ""}
                  </span>
                  <span className="hf-cascade-key" title={field.key}>
                    {field.key}
                  </span>
                  <span
                    className="hf-cascade-value"
                    title={formatValue(field.resolvedValue)}
                  >
                    {formatValue(field.resolvedValue)}
                  </span>
                  <span className="hf-cascade-pills">
                    {LAYER_ORDER.map((layer) => {
                      const entry = field.chain.find((c) => c.layer === layer);
                      if (!entry) return null;
                      const isWinner = layer === field.winningSource;
                      return (
                        <LayerPill
                          key={layer}
                          layer={layer}
                          entry={entry}
                          isWinner={isWinner}
                          href={isWinner ? deepLinkFor(layer, data) : null}
                        />
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
