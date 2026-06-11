/**
 * Voice Flow lens (#1478) — 13th lens on the Course Design Console.
 *
 * Renders a vertical flowchart of how a voice call will work for this
 * course, with cascade-bound voice settings shown as numbered nodes.
 * Each editable row carries an origin pill (System / Provider / Domain /
 * Course) sourced from the existing 4-layer voice cascade.
 *
 * Slice 1: read-only diagram. ✏️ buttons are present but no-op.
 * Slice 2 wires HFDrawer + the exported <FieldRow> for the edit
 * round-trip via PATCH /api/playbooks/[id]/voice-config.
 *
 * Reads the cascade via the existing
 *   GET /api/playbooks/[playbookId]/voice-config
 * (same wrapper VoiceConfigSection uses). Does NOT call
 * loadResolvedVoiceConfig directly — that's server-only.
 *
 * The lens consumes `courseId` but the URL+route are keyed by
 * `playbookId`. `playbookId === courseId` in this codebase (Tolerances
 * lens at CourseDesignConsole.tsx:127 uses the same identity); the
 * identity is asserted at the fetch boundary below.
 */

"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Pencil, Phone, BarChart3 } from "lucide-react";
import {
  sourceBadge,
  fieldMeta,
  FieldRow,
  type ResolvedField,
  type SchemaField,
} from "@/components/voice/VoiceConfigSection";
import { HFDrawer } from "@/components/shared/HFDrawer";

/* ── Hardcoded exclusion ─────────────────────────────────
   `fillerInjectionEnabled` is declared in the VAPI provider schema at
   lib/voice/providers/vapi/index.ts:614 but explicitly no-op'd at line
   307 because VAPI rejects it with HTTP 400 (incident #1382, 2026-06-09).
   Editing it does NOT reach live calls. Rendering it as editable would
   mislead educators, so the lens excludes it silently — no "coming
   soon" copy, no placeholder. */
const EXCLUDED_KEYS: ReadonlySet<string> = new Set(["fillerInjectionEnabled"]);

interface VoicePayload {
  ok: boolean;
  enabledProviderSlug: string;
  enabledProviderId?: string | null;
  resolved: {
    provider: ResolvedField<string>;
    model: ResolvedField<string | null>;
    fields: Record<string, ResolvedField>;
  };
  allowedKeys: string[];
  schemaFields: SchemaField[];
  courseOverrides?: Record<string, unknown>;
}

interface NodeRowDef {
  /** Cascade key this row reads from. */
  key: string;
  /** Override the schema-resolved label (for re-narration). */
  labelOverride?: string;
  /** Subtitle copy below the label. */
  subtitle?: string;
}

interface NodeDef {
  /** DOM id stem — used for aria-labelledby. */
  id: string;
  /** Visual marker rendered in the gutter (number, icon, or emoji). */
  marker: React.ReactNode;
  /** Node title rendered in the header strip. */
  title: string;
  /** Optional helper copy under the title. */
  subtitle?: string;
  /** Cascade-bound rows rendered inside this node, in order. When
   *  empty, the node renders as a label-only step (Pickup / Post-call). */
  rows: NodeRowDef[];
  /** When provided, this node is hidden if `enabledProviderSlug !==
   *  requireProvider`. The "During the call" + transcriber-endpointing
   *  rows are VAPI-specific. */
  requireProvider?: string;
}

const NODES: NodeDef[] = [
  {
    id: "pickup",
    marker: <Phone size={18} aria-hidden="true" />,
    title: "Pickup",
    subtitle: "The learner answers the call.",
    rows: [],
  },
  {
    id: "voiceProvider",
    marker: "①",
    title: "Voice Provider",
    subtitle: "TTS engine your tutor speaks through.",
    rows: [
      {
        key: "voiceProvider",
        labelOverride: "Voice engine",
        subtitle: "Deepgram, OpenAI, ElevenLabs, …",
      },
    ],
  },
  {
    id: "selectedVoice",
    marker: "②",
    title: "Selected Voice",
    subtitle: "The specific voice the tutor uses.",
    rows: [
      {
        key: "voiceId",
        labelOverride: "Voice ID",
      },
    ],
  },
  {
    id: "transcriber",
    marker: "③",
    title: "Transcriber",
    subtitle:
      "Converts the learner's spoken words into text so the tutor can understand them.",
    rows: [
      {
        key: "transcriber",
        labelOverride: "Engine",
      },
      {
        key: "transcriberEndpointingMs",
        labelOverride: "Endpointing (ms)",
        subtitle: "How long of a silence counts as 'end of turn'.",
      },
    ],
    requireProvider: "vapi",
  },
  {
    id: "duringCall",
    marker: "④",
    title: "During the call",
    subtitle:
      "Live behaviours that change how the call sounds and stops.",
    rows: [
      {
        key: "transcriptStreamEnabled",
        labelOverride: "Live transcript stream",
        subtitle:
          "Show the learner the running transcript while they speak.",
      },
      {
        key: "voicemailDetectionEnabled",
        labelOverride: "Voicemail detection",
        subtitle: "End the call early if an answering machine is detected.",
      },
      {
        key: "maxCostPerCallUsd",
        labelOverride: "Cost cap (USD / call)",
        subtitle: "Hard ceiling on cost. Empty = no cap.",
      },
    ],
  },
  {
    id: "endOfCall",
    marker: "⑤",
    title: "End of call",
    subtitle: "What runs after the learner hangs up.",
    rows: [
      {
        key: "autoPipeline",
        labelOverride: "Auto-run pipeline",
        subtitle:
          "Run the post-call analysis pipeline (memories, traits, target adapts) automatically.",
      },
    ],
  },
  {
    id: "postCall",
    marker: <BarChart3 size={18} aria-hidden="true" />,
    title: "Post-call summary",
    subtitle: "Educator dashboards + learner trajectory update.",
    rows: [],
  },
];

interface VoiceFlowLensProps {
  /** Course id from the Console — equal to the Playbook id used by
   *  the cascade routes. Identity asserted at fetch boundary. */
  courseId: string;
  /** Called after a successful save / reset so the Course Design
   *  Console's staleness banner can re-fetch (#1478 Amendment A). */
  onComposeInputChange?: () => void;
}

/* Roles that may PATCH /api/playbooks/[id]/voice-config (the route
   enforces OPERATOR at route.ts:97). Mirrored client-side so the ✏️
   button is visibly disabled for under-privileged sessions instead of
   firing a silent 403 (#1478 Amendment C). */
const OPERATOR_ROLES: ReadonlySet<string> = new Set([
  "OPERATOR",
  "EDUCATOR",
  "ADMIN",
  "SUPERADMIN",
]);

export function VoiceFlowLens({
  courseId,
  onComposeInputChange,
}: VoiceFlowLensProps): React.ReactElement {
  const [data, setData] = useState<VoicePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const session = useSession();
  const role = (session.data?.user as { role?: string } | undefined)?.role ?? "";
  const canEdit = useMemo(() => OPERATOR_ROLES.has(role), [role]);

  // `courseId` is the Playbook id at the route level — same identity
  // the Tolerances lens uses (CourseDesignConsole.tsx:127).
  const playbookId = courseId;

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/playbooks/${playbookId}/voice-config`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as VoicePayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [playbookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (key: string, value: unknown): Promise<void> => {
      if (!canEdit) return;
      setBusyKey(key);
      setError(null);
      try {
        const res = await fetch(`/api/playbooks/${playbookId}/voice-config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        await load();
        setSavedFlash(key);
        setTimeout(() => {
          setSavedFlash((cur) => (cur === key ? null : cur));
        }, 1500);
        // #1478 Amendment A — tell the console the cascade changed so
        // the staleness banner can re-fetch.
        onComposeInputChange?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyKey(null);
      }
    },
    [canEdit, playbookId, load, onComposeInputChange],
  );

  const reset = useCallback(
    (key: string): Promise<void> => persist(key, null),
    [persist],
  );

  if (loading && !data) {
    return <VoiceFlowSkeleton />;
  }

  if (error) {
    return (
      <div className="hf-banner hf-banner-error">
        <strong>We couldn&rsquo;t load the voice settings for this course.</strong>
        <span className="hf-text-muted hf-text-xs hf-voice-flow-error-detail">
          {" "}({error})
        </span>{" "}
        <button
          type="button"
          className="hf-btn hf-btn-secondary hf-voice-flow-retry"
          onClick={() => void load()}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <VoiceFlowSkeleton />;
  }

  const isVapi = data.enabledProviderSlug === "vapi";

  return (
    <div className="hf-voice-flow">
      <header className="hf-voice-flow-intro">
        <div className="hf-text-muted hf-text-sm">
          Settings inherit from the system default unless overridden here.
          Edit any field to set a course-specific value. Clear it (↺ Reset)
          to go back to the inherited default.
        </div>
      </header>

      <ol
        className="hf-voice-flow-nodes"
        aria-label="Call lifecycle voice configuration"
      >
        {NODES.map((node, idx) => {
          const isHidden = Boolean(
            node.requireProvider && node.requireProvider !== data.enabledProviderSlug,
          );

          if (isHidden) {
            return (
              <VoiceFlowNonVapiPlaceholder
                key={node.id}
                node={node}
                provider={data.enabledProviderSlug}
                isLast={idx === NODES.length - 1}
              />
            );
          }

          // Filter out excluded + unknown rows.
          const visibleRows = node.rows.filter(
            (row) =>
              !EXCLUDED_KEYS.has(row.key) &&
              data.resolved.fields[row.key] !== undefined,
          );

          return (
            <li
              key={node.id}
              className="hf-voice-flow-node"
              aria-labelledby={`hf-voice-flow-${node.id}-title`}
            >
              <div className="hf-voice-flow-marker" aria-hidden="true">
                {node.marker}
              </div>
              <div className="hf-voice-flow-body">
                <div className="hf-voice-flow-node-head">
                  <h3
                    id={`hf-voice-flow-${node.id}-title`}
                    className="hf-voice-flow-node-title"
                  >
                    {node.title}
                  </h3>
                  {node.subtitle && (
                    <p className="hf-voice-flow-node-subtitle">
                      {node.subtitle}
                    </p>
                  )}
                </div>

                {visibleRows.length > 0 && (
                  <div className="hf-voice-flow-rows">
                    {visibleRows.map((row) => (
                      <VoiceFlowRow
                        key={row.key}
                        row={row}
                        resolved={data.resolved.fields[row.key]!}
                        schemaFields={data.schemaFields}
                        canEdit={canEdit}
                        justSaved={savedFlash === row.key}
                        onEdit={() => setDrawerKey(row.key)}
                      />
                    ))}
                  </div>
                )}

                {isVapi && node.id === "duringCall" && visibleRows.length === 0 && (
                  <div className="hf-voice-flow-empty hf-text-muted hf-text-sm">
                    No cascade-bound during-call fields surfaced for this
                    provider.
                  </div>
                )}
              </div>
              {idx < NODES.length - 1 && (
                <span className="hf-voice-flow-connector" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      <VoiceFlowEditDrawer
        drawerKey={drawerKey}
        data={data}
        busyKey={busyKey}
        savedFlash={savedFlash}
        onClose={() => setDrawerKey(null)}
        onSave={persist}
        onReset={reset}
      />
    </div>
  );
}

interface VoiceFlowEditDrawerProps {
  drawerKey: string | null;
  data: VoicePayload;
  busyKey: string | null;
  savedFlash: string | null;
  onClose: () => void;
  onSave: (key: string, value: unknown) => Promise<void>;
  onReset: (key: string) => Promise<void>;
}

function VoiceFlowEditDrawer({
  drawerKey,
  data,
  busyKey,
  savedFlash,
  onClose,
  onSave,
  onReset,
}: VoiceFlowEditDrawerProps): React.ReactElement {
  const key = drawerKey ?? "";
  const resolved = key ? data.resolved.fields[key] : undefined;
  const meta = key ? fieldMeta(key, data.schemaFields) : null;
  const courseOverrides = data.courseOverrides ?? {};
  const isThisLayer = key !== "" && Object.prototype.hasOwnProperty.call(courseOverrides, key);
  const open = drawerKey !== null && resolved !== undefined && meta !== null;

  return (
    <HFDrawer
      open={open}
      onClose={onClose}
      title={meta?.label ?? "Edit cascade key"}
      description="Edit one cascade-bound voice setting. Save persists at the course layer; Reset clears the override and falls back through System → Provider → Domain → Course."
      width={520}
    >
      {open && resolved && meta && (
        <div className="hf-voice-flow-drawer-body">
          <FieldRow
            meta={meta}
            resolved={resolved}
            scope="course"
            isThisLayer={isThisLayer}
            busyKey={busyKey}
            savedFlash={savedFlash}
            onSave={async (k, v) => {
              await onSave(k, v);
            }}
            onReset={async (k) => {
              await onReset(k);
            }}
            voiceCatalog={undefined}
            currentVoiceProvider={
              (data.resolved.fields.voiceProvider?.value as string | undefined) ?? null
            }
            enabledProviderId={data.enabledProviderId ?? null}
          />
        </div>
      )}
    </HFDrawer>
  );
}

interface VoiceFlowRowProps {
  row: NodeRowDef;
  resolved: ResolvedField;
  schemaFields: SchemaField[];
  canEdit: boolean;
  justSaved: boolean;
  onEdit: () => void;
}

function VoiceFlowRow({
  row,
  resolved,
  schemaFields,
  canEdit,
  justSaved,
  onEdit,
}: VoiceFlowRowProps): React.ReactElement {
  const meta = fieldMeta(row.key, schemaFields);
  const label = row.labelOverride ?? meta.label;
  const value = formatValue(resolved.value, meta.type);

  return (
    <div
      className={`hf-voice-flow-row${justSaved ? " hf-glow-active" : ""}`}
      data-key={row.key}
    >
      <div className="hf-voice-flow-row-label">
        <span className="hf-voice-flow-row-name">{label}</span>
        {row.subtitle && (
          <span className="hf-voice-flow-row-help hf-text-muted hf-text-xs">
            {row.subtitle}
          </span>
        )}
      </div>
      <div className="hf-voice-flow-row-value">
        <span className="hf-voice-flow-row-value-text">{value}</span>
        {sourceBadge(resolved.source, "course")}
        <button
          type="button"
          className="hf-btn hf-btn-secondary hf-voice-flow-edit"
          aria-label={`Edit ${label}`}
          title={
            canEdit
              ? "Edit this setting"
              : "Only admins can edit this — contact your administrator."
          }
          disabled={!canEdit}
          onClick={onEdit}
        >
          <Pencil size={12} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface VoiceFlowNonVapiPlaceholderProps {
  node: NodeDef;
  provider: string;
  isLast: boolean;
}

function VoiceFlowNonVapiPlaceholder({
  node,
  provider,
  isLast,
}: VoiceFlowNonVapiPlaceholderProps): React.ReactElement {
  return (
    <li
      className="hf-voice-flow-node hf-voice-flow-node-disabled"
      aria-labelledby={`hf-voice-flow-${node.id}-title`}
    >
      <div className="hf-voice-flow-marker" aria-hidden="true">
        {node.marker}
      </div>
      <div className="hf-voice-flow-body">
        <div className="hf-voice-flow-node-head">
          <h3
            id={`hf-voice-flow-${node.id}-title`}
            className="hf-voice-flow-node-title"
          >
            {node.title}
          </h3>
        </div>
        <div className="hf-voice-flow-placeholder hf-text-muted hf-text-sm">
          ⊘ Not configurable for <strong>{provider}</strong> — see provider
          settings → Voice tab
        </div>
      </div>
      {!isLast && (
        <span className="hf-voice-flow-connector" aria-hidden="true" />
      )}
    </li>
  );
}

function VoiceFlowSkeleton(): React.ReactElement {
  return (
    <div className="hf-voice-flow hf-voice-flow-skeleton" aria-busy="true">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="hf-voice-flow-skeleton-row" />
      ))}
    </div>
  );
}

function formatValue(value: unknown, type: SchemaField["type"]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
