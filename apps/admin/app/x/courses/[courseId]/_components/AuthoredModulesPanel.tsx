"use client";

/**
 * AuthoredModulesPanel — Module Catalogue read-only view + re-import action.
 *
 * Renders inside the Curriculum tab. Lives alongside the derived-curriculum
 * scorecard but is visually distinct because it covers a different concept:
 * author-declared modules from a Course Reference document, persisted on
 * `Playbook.config.modules`. The derived `CurriculumModule` data continues
 * to render below via `CurriculumHealthTabs`.
 *
 * PR3 of 4 for #236. Read-only + re-import only — per-row inline editing
 * is deferred to PR3.5 (or absorbed into the wizard step PR).
 */

import { useState, useEffect, useCallback } from "react";
import {
  Layers,
  AlertTriangle,
  CheckCircle2,
  Upload,
  Eye,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Pencil,
  Mic,
  AlertOctagon,
  Target,
  Link as LinkIcon,
} from "lucide-react";
import type {
  AuthoredModule,
  ModuleDefaults,
  ModuleSource,
  ValidationWarning,
} from "@/lib/types/json-fields";
import { ImportModulesDialog } from "./ImportModulesDialog";
import { LearnerModulePicker } from "./LearnerModulePicker";
import "./authored-modules-panel.css";

interface LoAudienceInfo {
  learnerVisible: boolean;
  systemRole: string;
  performanceStatement: string | null;
  humanOverridden: boolean;
}

interface AuthoredModulesState {
  modulesAuthored: boolean | null;
  modules: AuthoredModule[];
  moduleDefaults: Partial<ModuleDefaults>;
  moduleSource: ModuleSource | null;
  moduleSourceRef: { docId: string; version: string } | null;
  validationWarnings: ValidationWarning[];
  hasErrors: boolean;
  lessonPlanMode: "structured" | "continuous" | null;
  /** Outcome statements parsed from `**OUT-NN: <statement>.**` headings (#258). */
  outcomes: Record<string, string>;
  /**
   * #281 Slice 3b: per-module MCQ count. Drives the "no learner-facing
   * content" banner — modules with 0 here have nothing for the pre-test
   * to draw from, so the tutor falls back to conversational discovery.
   * Empty object = endpoint pre-#281 (banner suppressed for safety).
   */
  mcqCountsByModule: Record<string, number>;
  /**
   * #317 — audience-split per outcome ref. Drives the [hidden:
   * ASSESSOR_RUBRIC] / etc. badges next to each LO. Empty object means
   * either the classifier hasn't run yet or the API is pre-#317.
   */
  loAudienceByRef: Record<string, LoAudienceInfo>;
}

interface AuthoredModulesPanelProps {
  courseId: string;
  isOperator: boolean;
  /**
   * Fires whenever the panel learns the value of `modulesAuthored` from the
   * server (after fetch / re-import). Used by the parent CurriculumTab to
   * hide the derived/regen view when authored modules are in play. `null` =
   * never imported, `false` = explicitly opted out, `true` = authored modules
   * are the source of truth for this course.
   */
  onModulesAuthoredChange?: (value: boolean | null) => void;
}

const EMPTY_STATE: AuthoredModulesState = {
  modulesAuthored: null,
  modules: [],
  moduleDefaults: {},
  moduleSource: null,
  moduleSourceRef: null,
  outcomes: {},
  validationWarnings: [],
  hasErrors: false,
  lessonPlanMode: null,
  mcqCountsByModule: {},
  loAudienceByRef: {},
};

export function AuthoredModulesPanel({
  courseId,
  isOperator,
  onModulesAuthoredChange,
}: AuthoredModulesPanelProps) {
  const [state, setState] = useState<AuthoredModulesState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/import-modules`);
      if (!res.ok) {
        throw new Error(`Failed to load authored modules (status ${res.status})`);
      }
      const data = (await res.json()) as { ok: boolean } & AuthoredModulesState;
      setState({
        modulesAuthored: data.modulesAuthored,
        modules: data.modules,
        moduleDefaults: data.moduleDefaults,
        moduleSource: data.moduleSource,
        moduleSourceRef: data.moduleSourceRef,
        outcomes: data.outcomes ?? {},
        validationWarnings: data.validationWarnings,
        hasErrors: data.hasErrors,
        lessonPlanMode: data.lessonPlanMode,
        mcqCountsByModule: data.mcqCountsByModule ?? {},
        loAudienceByRef: (data as unknown as { loAudienceByRef?: Record<string, LoAudienceInfo> })
          .loAudienceByRef ?? {},
      });
      onModulesAuthoredChange?.(data.modulesAuthored);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [courseId, onModulesAuthoredChange]);

  useEffect(() => {
    load();
  }, [load]);

  const handleImported = useCallback(() => {
    setDialogOpen(false);
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="hf-card hf-mb-lg">
        <div className="hf-spinner" />
      </div>
    );
  }

  return (
    <div className="hf-card hf-mb-lg authored-modules-panel">
      <div className="hf-flex hf-items-center hf-gap-sm hf-mb-md">
        <Layers size={16} className="hf-text-muted" />
        <span className="hf-section-title authored-modules-panel__title">
          Authored Modules
        </span>
        <span className="hf-text-xs hf-text-muted">
          {state.moduleSource === "authored"
            ? "From Course Reference"
            : state.moduleSource === "derived"
              ? "Author opted out — using derived"
              : "Not yet imported"}
        </span>
        {isOperator && state.modules.length > 0 && (
          <button
            type="button"
            className="hf-btn hf-btn-secondary authored-modules-panel__action"
            onClick={() => setDialogOpen(true)}
          >
            <Upload size={14} />
            Re-import
          </button>
        )}
      </div>

      {error && <div className="hf-banner hf-banner-error hf-mb-md">{error}</div>}

      {state.modulesAuthored === null && state.modules.length === 0 && (
        <EmptyState onImport={() => setDialogOpen(true)} canImport={isOperator} />
      )}

      {state.modules.length > 0 && (
        <>
          <CatalogueTable
            modules={state.modules}
            outcomes={state.outcomes}
            mcqCountsByModule={state.mcqCountsByModule}
            loAudienceByRef={state.loAudienceByRef}
          />
          <StatusStrip
            warnings={state.validationWarnings}
            hasErrors={state.hasErrors}
          />
          {Object.keys(state.moduleDefaults).length > 0 && (
            <ModuleDefaultsRow defaults={state.moduleDefaults} />
          )}
          {state.validationWarnings.length > 0 && (
            <ValidationList warnings={state.validationWarnings} />
          )}
          <LearnerPickerPreview
            modules={state.modules}
            lessonPlanMode={state.lessonPlanMode}
          />
          {state.moduleSourceRef && (
            <p className="hf-text-xs hf-text-muted hf-mt-sm">
              Source: doc {state.moduleSourceRef.docId} (v{state.moduleSourceRef.version})
            </p>
          )}
        </>
      )}

      {state.modulesAuthored === false && state.modules.length === 0 && (
        <p className="hf-text-sm hf-text-muted">
          The Course Reference declared <code>Modules authored: No</code>. The
          system will derive modules from the Outcome Graph at runtime.
        </p>
      )}

      {dialogOpen && isOperator && (
        <ImportModulesDialog
          courseId={courseId}
          onClose={() => setDialogOpen(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────

function EmptyState({
  onImport,
  canImport,
}: {
  onImport: () => void;
  canImport: boolean;
}) {
  return (
    <div className="hf-empty">
      <p className="hf-text-sm hf-text-muted">
        No authored modules for this course. Paste your Course Reference
        markdown to import the Module Catalogue. Without authored modules,
        the system will derive modules from your Outcome Graph at runtime.
      </p>
      {canImport && (
        <button
          type="button"
          className="hf-btn hf-btn-primary hf-mt-md"
          onClick={onImport}
        >
          Import from Course Reference
        </button>
      )}
    </div>
  );
}

// ── Catalogue table (expandable rows) ──────────────────────────────

function CatalogueTable({
  modules,
  outcomes,
  mcqCountsByModule,
  loAudienceByRef,
}: {
  modules: AuthoredModule[];
  outcomes: Record<string, string>;
  mcqCountsByModule: Record<string, number>;
  loAudienceByRef: Record<string, LoAudienceInfo>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="authored-modules-table-wrap">
      <table className="authored-modules-table">
        <thead>
          <tr>
            <th aria-label="Expand" />
            <th>ID</th>
            <th>Label</th>
            <th>Mode</th>
            <th>Duration</th>
            <th>Frequency</th>
            <th>Terminal</th>
            <th>Picker</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => {
            const isExpanded = expandedId === m.id;
            const mcqCount = mcqCountsByModule[m.id] ?? 0;
            return (
              <CatalogueRow
                key={m.id}
                module={m}
                outcomes={outcomes}
                isExpanded={isExpanded}
                onToggle={() => toggle(m.id)}
                mcqCount={mcqCount}
                loAudienceByRef={loAudienceByRef}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CatalogueRow({
  module: m,
  outcomes,
  isExpanded,
  onToggle,
  mcqCount,
  loAudienceByRef,
}: {
  module: AuthoredModule;
  outcomes: Record<string, string>;
  isExpanded: boolean;
  onToggle: () => void;
  loAudienceByRef: Record<string, LoAudienceInfo>;
  /** #281 Slice 3b: number of ContentQuestion rows whose learningOutcomeRef ∈ this module's outcomesPrimary. 0 = render the "no learner-facing content" banner inside ModuleDetail. */
  mcqCount: number;
}) {
  return (
    <>
      <tr
        className="authored-modules-table__row authored-modules-table__row--clickable"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <td className="authored-modules-table__center">
          {isExpanded ? (
            <ChevronDown size={14} className="hf-text-muted" aria-hidden="true" />
          ) : (
            <ChevronRight size={14} className="hf-text-muted" aria-hidden="true" />
          )}
        </td>
        <td>
          <code>{m.id}</code>
        </td>
        <td>{m.label}</td>
        <td>
          <ModePill mode={m.mode} />
        </td>
        <td>{m.duration}</td>
        <td>
          <FrequencyPill frequency={m.frequency} />
        </td>
        <td className="authored-modules-table__center">
          {m.sessionTerminal ? (
            <span className="hf-badge hf-badge-xs hf-badge-warning">Ends session</span>
          ) : (
            <span className="hf-text-muted">—</span>
          )}
        </td>
        <td className="authored-modules-table__center">
          {m.learnerSelectable ? (
            <span className="hf-badge hf-badge-xs hf-badge-success">Visible</span>
          ) : (
            <span className="hf-badge hf-badge-xs hf-badge-muted">Hidden</span>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="authored-modules-table__detail-row">
          <td colSpan={8} className="authored-modules-table__detail-cell">
            <ModuleDetail module={m} outcomes={outcomes} mcqCount={mcqCount} loAudienceByRef={loAudienceByRef} />
          </td>
        </tr>
      )}
    </>
  );
}

function ModePill({ mode }: { mode: AuthoredModule["mode"] }) {
  const Icon =
    mode === "examiner" ? GraduationCap : mode === "mixed" ? Layers : Pencil;
  const tone =
    mode === "examiner"
      ? "hf-badge-info"
      : mode === "mixed"
        ? "hf-badge-accent"
        : "hf-badge-muted";
  return (
    <span className={`hf-badge hf-badge-xs ${tone}`}>
      <Icon size={10} aria-hidden="true" />
      {mode}
    </span>
  );
}

function FrequencyPill({ frequency }: { frequency: AuthoredModule["frequency"] }) {
  const tone =
    frequency === "once"
      ? "hf-badge-warning"
      : frequency === "cooldown"
        ? "hf-badge-info"
        : "hf-badge-muted";
  return (
    <span className={`hf-badge hf-badge-xs ${tone}`}>{frequency}</span>
  );
}

function ModuleDetail({
  module: m,
  outcomes,
  mcqCount,
  loAudienceByRef,
}: {
  module: AuthoredModule;
  outcomes: Record<string, string>;
  /** #281 Slice 3b: 0 → render "no learner-facing content" banner. */
  mcqCount: number;
  /** #317 — audience-split per outcome ref so we can render hidden badges. */
  loAudienceByRef: Record<string, LoAudienceInfo>;
}) {
  // Tally so we can show a "X hidden from learners" summary on the section header.
  const hiddenRefs = m.outcomesPrimary.filter((ref) => {
    const info = loAudienceByRef[ref];
    return info && !info.learnerVisible;
  });
  return (
    <div className="authored-modules-detail">
      {/* #281 Slice 3b: surface insufficient-content state for this module.
          Educator only sees this when a module's outcomes have zero MCQs —
          tells them why pre-tests aren't firing and what to upload to fix it. */}
      {mcqCount === 0 && (m.outcomesPrimary?.length ?? 0) > 0 && (
        <div
          role="status"
          className="hf-banner hf-banner-info hf-flex hf-items-center hf-gap-8"
          style={{ marginBottom: 12 }}
        >
          <AlertOctagon size={14} aria-hidden="true" />
          <span>
            <strong>No learner-facing content for this module yet.</strong>{" "}
            The pre-test will be skipped and the tutor will fall back to conversational discovery.
            Upload student-facing material (sample answers, vocabulary, practice cue cards,
            reading passages) to populate MCQs.
          </span>
        </div>
      )}
      {/* Top metadata strip */}
      <div className="authored-modules-detail__strip">
        {m.position != null && (
          <span className="hf-badge hf-badge-sm hf-badge-muted">
            Position {m.position}
          </span>
        )}
        <span className="hf-badge hf-badge-sm hf-badge-muted">
          <Target size={11} aria-hidden="true" /> Scoring: {m.scoringFired}
        </span>
        {m.voiceBandReadout && (
          <span className="hf-badge hf-badge-sm hf-badge-info">
            <Mic size={11} aria-hidden="true" /> Spoken bands
          </span>
        )}
      </div>

      <div className="authored-modules-detail__grid">
        {/* Outcomes (primary) */}
        <section className="authored-modules-detail__section">
          <h4 className="authored-modules-detail__section-title">
            Primary outcomes
            {hiddenRefs.length > 0 && (
              <span
                className="hf-badge hf-badge-xs hf-badge-muted"
                style={{ marginLeft: 8 }}
                title="LOs flagged by the audience classifier as system-only — assessor / item-generator / score-explainer content the learner doesn't study directly."
              >
                {hiddenRefs.length} hidden from learners
              </span>
            )}
          </h4>
          {m.outcomesPrimary.length === 0 ? (
            <p className="hf-text-sm hf-text-muted">None declared.</p>
          ) : (
            <ul className="authored-modules-detail__list">
              {m.outcomesPrimary.map((id) => {
                const statement = outcomes[id];
                const audience = loAudienceByRef[id];
                return (
                  <li key={id} className="authored-modules-detail__list-item">
                    <code className="authored-modules-detail__outcome-id">{id}</code>
                    {statement && (
                      <span className="authored-modules-detail__outcome-text">
                        {statement}
                      </span>
                    )}
                    {audience && <LoAudienceBadge audience={audience} />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Prerequisites */}
        <section className="authored-modules-detail__section">
          <h4 className="authored-modules-detail__section-title">
            Prerequisites
          </h4>
          {m.prerequisites.length === 0 ? (
            <p className="hf-text-sm hf-text-muted">None — open from session 1.</p>
          ) : (
            <div className="authored-modules-detail__chips">
              {m.prerequisites.map((id) => (
                <span
                  key={id}
                  className="hf-badge hf-badge-sm hf-badge-muted"
                  title="Advisory only — picker shows 'Recommended after' but does not gate"
                >
                  {id}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Content source */}
        {m.contentSourceRef && (
          <section className="authored-modules-detail__section">
            <h4 className="authored-modules-detail__section-title">
              Content source
            </h4>
            <p className="hf-text-sm">
              <LinkIcon size={11} aria-hidden="true" className="hf-text-muted" />{" "}
              {m.contentSourceRef}
            </p>
          </section>
        )}
      </div>

      {/* Behaviour notes — derived from flags */}
      {(m.sessionTerminal || m.frequency === "once") && (
        <div className="authored-modules-detail__note">
          <AlertOctagon size={12} aria-hidden="true" className="hf-text-muted" />
          <span className="hf-text-xs hf-text-muted">
            {m.sessionTerminal && m.frequency === "once"
              ? "Single-session module that ends the call when started. Disappears from the picker after completion."
              : m.sessionTerminal
                ? "Starting this module ends the current session — picker will show a confirm dialog."
                : "Single-session module — disappears from the picker after completion."}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Status strip ───────────────────────────────────────────────────

function StatusStrip({
  warnings,
  hasErrors,
}: {
  warnings: ValidationWarning[];
  hasErrors: boolean;
}) {
  const errorCount = warnings.filter((w) => w.severity === "error").length;
  const warnCount = warnings.filter((w) => w.severity === "warning").length;
  const ready = !hasErrors && warnCount === 0;

  return (
    <div className="authored-modules-status">
      {ready ? (
        <CheckCircle2
          size={14}
          className="authored-modules-status__icon authored-modules-status__icon--ok"
          aria-hidden="true"
        />
      ) : (
        <AlertTriangle
          size={14}
          className="authored-modules-status__icon authored-modules-status__icon--warn"
          aria-hidden="true"
        />
      )}
      <span className="hf-text-xs">
        {errorCount} error{errorCount === 1 ? "" : "s"} · {warnCount} warning
        {warnCount === 1 ? "" : "s"}
        {ready && " · Production publish ready"}
        {!ready && hasErrors && " · Production publish blocked"}
      </span>
    </div>
  );
}

// ── Module Defaults row ────────────────────────────────────────────

function ModuleDefaultsRow({ defaults }: { defaults: Partial<ModuleDefaults> }) {
  const entries = Object.entries(defaults).filter(([, v]) => v != null);
  if (entries.length === 0) return null;
  return (
    <div className="authored-modules-defaults">
      <span className="hf-text-xs hf-text-muted authored-modules-defaults__label">
        Defaults
      </span>
      <span className="hf-text-xs">
        {entries.map(([k, v], i) => (
          <span key={k}>
            {i > 0 && <span className="authored-modules-defaults__sep"> · </span>}
            <span className="authored-modules-defaults__key">{k}</span>{" "}
            <span className="authored-modules-defaults__val">{String(v)}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

// ── Validation list ────────────────────────────────────────────────

function ValidationList({ warnings }: { warnings: ValidationWarning[] }) {
  return (
    <ul className="authored-modules-warnings">
      {warnings.map((w, i) => (
        <li
          key={`${w.code}-${w.path ?? "_"}-${i}`}
          className={
            w.severity === "error"
              ? "authored-modules-warnings__item authored-modules-warnings__item--error"
              : "authored-modules-warnings__item authored-modules-warnings__item--warn"
          }
        >
          <span className="authored-modules-warnings__code">{w.code}</span>
          <span className="authored-modules-warnings__msg">{w.message}</span>
          {w.path && (
            <code className="authored-modules-warnings__path">{w.path}</code>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Learner picker preview ────────────────────────────────────────

function LearnerPickerPreview({
  modules,
  lessonPlanMode,
}: {
  modules: AuthoredModule[];
  lessonPlanMode: "structured" | "continuous" | null;
}) {
  return (
    <div className="authored-modules-preview">
      <div className="hf-flex hf-items-center hf-gap-sm authored-modules-preview__header">
        <Eye size={14} className="hf-text-muted" />
        <span className="hf-section-title authored-modules-preview__title">
          Learner Picker Preview
        </span>
        <span className="hf-text-xs hf-text-muted">
          {lessonPlanMode === "structured"
            ? "Sequenced rail (structured course)"
            : "Free-pick tiles (continuous course)"}
        </span>
      </div>
      <p className="hf-text-xs hf-text-muted authored-modules-preview__caption">
        This is what learners will see when the picker is wired into the
        student portal. Read-only here.
      </p>
      <LearnerModulePicker modules={modules} lessonPlanMode={lessonPlanMode} />
    </div>
  );
}

// ── #317 — LO audience badge ──────────────────────────────────
//
// Renders next to each outcome ref to communicate why some LOs are not on
// the learner curriculum page. Badge maps systemRole → tone:
//   ASSESSOR_RUBRIC      → muted "rubric" (assessor-only)
//   ITEM_GENERATOR_SPEC  → info "item gen"
//   SCORE_EXPLAINER      → muted "score explainer"
//   NONE / learner-visible → success "learner" (only when classified)
// `humanOverridden=true` adds a 🔒 affix so reviewers know not to re-classify.
function LoAudienceBadge({ audience }: { audience: LoAudienceInfo }) {
  if (audience.learnerVisible && audience.systemRole === "NONE") {
    return (
      <span
        className="hf-badge hf-badge-xs hf-badge-success"
        style={{ marginLeft: 8 }}
        title={
          (audience.performanceStatement
            ? `Learner-facing. Performance statement: "${audience.performanceStatement}"`
            : "Learner-facing teaching point.") +
          (audience.humanOverridden ? " (Human-reviewed.)" : "")
        }
      >
        learner{audience.humanOverridden ? " 🔒" : ""}
      </span>
    );
  }
  const role = audience.systemRole;
  const tone =
    role === "ITEM_GENERATOR_SPEC" ? "hf-badge-info" : "hf-badge-muted";
  const label =
    role === "ASSESSOR_RUBRIC"
      ? "hidden · rubric"
      : role === "ITEM_GENERATOR_SPEC"
      ? "hidden · item gen"
      : role === "SCORE_EXPLAINER"
      ? "hidden · score explainer"
      : "hidden";
  const tooltip =
    role === "ASSESSOR_RUBRIC"
      ? "Hidden from learners. Surfaces in the assessor's grading prompt as rubric criteria."
      : role === "ITEM_GENERATOR_SPEC"
      ? "Hidden from learners. Used by the question generator as a boundary spec."
      : role === "SCORE_EXPLAINER"
      ? 'Hidden from learners. Surfaces only in the "How is this calculated?" tooltip on the score reveal.'
      : "Hidden from learners.";
  return (
    <span
      className={`hf-badge hf-badge-xs ${tone}`}
      style={{ marginLeft: 8 }}
      title={tooltip + (audience.humanOverridden ? " (Human-reviewed.)" : "")}
    >
      {label}{audience.humanOverridden ? " 🔒" : ""}
    </span>
  );
}
