"use client";

/**
 * /x/student/[courseId]/modules — learner-facing Module Picker (Slice 1).
 *
 * SIM-first mount per #242. Renders LearnerModulePicker live (with onSelect)
 * and lets a learner pick a module to drive the next session. Slice 2 will
 * thread the selected moduleId through the call-launch flow; Slice 1 only
 * confirms the pick and surfaces a "Starting session..." toast.
 *
 * #495 Slice 4.1 — the picker works for BOTH authored AND AI-generated
 * courses. The API (`/api/courses/[courseId]/import-modules`) now falls
 * back to `Curriculum.modules[]` when `Playbook.config.modules` is empty,
 * so the previous `modulesAuthored !== true` bounce has been removed.
 * Courses with zero modules on either path show a "curriculum is being
 * prepared" empty state instead of bouncing.
 */

import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useParams, useRouter, useSearchParams, usePathname } from "next/navigation";
import { GraduationCap, ArrowLeft } from "lucide-react";
import type {
  AuthoredModule,
  ModuleDefaults,
  ModuleSource,
  ValidationWarning,
} from "@/lib/types/json-fields";
import { LearnerModulePicker } from "@/app/x/courses/[courseId]/_components/LearnerModulePicker";
import { useStudentCallerId } from "@/hooks/useStudentCallerId";
import "@/app/x/courses/[courseId]/_components/authored-modules-panel.css";

interface ModulesPayload {
  ok: boolean;
  modulesAuthored: boolean | null;
  modules: AuthoredModule[];
  /**
   * #495 Slice 4.1 — `"authored"` when modules came from PlaybookConfig,
   * `"generated"` when fallen back to Curriculum.modules[], `null` when
   * neither source has any modules yet.
   */
  source: "authored" | "generated" | null;
  moduleDefaults: Partial<ModuleDefaults>;
  moduleSource: ModuleSource | null;
  validationWarnings: ValidationWarning[];
  hasErrors: boolean;
  lessonPlanMode: "structured" | "continuous" | null;
  /**
   * #495 Slice 4.3 — id of the single module `recommendNextModule()`
   * suggests the learner attempt next. Null when no caller scope is
   * resolvable or every module is mastered. Threaded straight into the
   * picker so it can highlight the matching tile.
   */
  recommendedModuleId?: string | null;
  recommendedReason?: string | null;
  /**
   * #495 Slice 4.5 — course-level toggle: when `false` (default) the
   * picker shows a soft-warning modal on unmet prereqs; slice 4.6 will
   * hard-lock the tile when `true`.
   */
  strictPrerequisites?: boolean;
}

interface ProgressRow {
  moduleId: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  completedAt: string | null;
  module: { id: string; slug: string; title: string; sortOrder: number };
}

interface ProgressPayload {
  ok: boolean;
  progress: ProgressRow[];
}

export default function StudentModulePickerPage() {
  return (
    <Suspense fallback={<PickerLoading />}>
      <PickerContent />
    </Suspense>
  );
}

function PickerLoading() {
  return (
    <div className="hf-flex hf-items-center hf-justify-center" style={{ minHeight: 200, padding: 24 }}>
      <div className="hf-spinner" style={{ width: 28, height: 28 }} />
    </div>
  );
}

function PickerContent() {
  const router = useRouter();
  const pathname = usePathname();
  const { courseId } = useParams<{ courseId: string }>();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");
  const { isAdmin, hasSelection, buildUrl } = useStudentCallerId();

  const [data, setData] = useState<ModulesPayload | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingTerminal, setPendingTerminal] = useState<AuthoredModule | null>(null);
  const [launching, setLaunching] = useState(false);

  // #356: Admins must reach this page with ?callerId= in the URL. If it's
  // missing, redirect to the caller list so they can pick one and return.
  // (Actual students short-circuit hasSelection=true in the hook.)
  const needsCallerRedirect = isAdmin && !hasSelection;
  useEffect(() => {
    if (!needsCallerRedirect) return;
    const current = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
    router.replace(`/x/callers?returnTo=${encodeURIComponent(current)}`);
  }, [needsCallerRedirect, pathname, searchParams, router]);

  useEffect(() => {
    if (needsCallerRedirect) return;
    let cancelled = false;
    async function load() {
      try {
        const [modulesRes, progressRes] = await Promise.all([
          fetch(`/api/courses/${courseId}/import-modules`),
          // courseId scopes progress to this Playbook's curricula — prevents
          // module-slug collisions across the caller's other enrolments.
          fetch(buildUrl("/api/student/module-progress", { courseId })),
        ]);

        if (!modulesRes.ok) {
          if (!cancelled) setError(modulesRes.status === 404 ? "Course not found" : "Failed to load modules");
          return;
        }
        const modulesJson = (await modulesRes.json()) as ModulesPayload;

        // Progress is a soft dependency — picker still renders without it.
        let progressRows: ProgressRow[] = [];
        if (progressRes.ok) {
          try {
            const progressJson = (await progressRes.json()) as ProgressPayload;
            if (progressJson.ok) progressRows = progressJson.progress;
          } catch {
            // swallow — picker stays ungrouped if progress fetch malforms
          }
        }

        if (!cancelled) {
          setData(modulesJson);
          setProgress(progressRows);
        }
      } catch {
        if (!cancelled) setError("Failed to load modules");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [courseId, buildUrl, needsCallerRedirect]);

  // #495 Slice 4.1 — the previous `modulesAuthored !== true` bounce has
  // been removed. The API now returns modules from either Playbook.config
  // (authored path) or Curriculum.modules[] (AI-generated fallback), and
  // the picker renders for both. Zero modules → empty state below, not
  // a redirect, so the learner stays oriented on the course route.

  const moduleById = useMemo(() => {
    const m = new Map<string, AuthoredModule>();
    if (data) data.modules.forEach((mod) => m.set(mod.id, mod));
    return m;
  }, [data]);

  // Map progress rows (keyed by CurriculumModule.slug) to AuthoredModule.id sets.
  // The slug-vs-id match works when authored module ids equal curriculum module
  // slugs — the convention used in the v2.2 IELTS reference. Module IDs without
  // a matching CurriculumModule row simply have no progress yet (which is fine
  // until the dual-write path covers authored-module sources).
  const { completedIds, inProgressIds } = useMemo(() => {
    const completed: string[] = [];
    const inProgress: string[] = [];
    if (data) {
      const authoredIds = new Set(data.modules.map((m) => m.id));
      for (const row of progress) {
        const match = authoredIds.has(row.module.slug) ? row.module.slug : null;
        if (!match) continue;
        if (row.status === "COMPLETED") completed.push(match);
        else if (row.status === "IN_PROGRESS") inProgress.push(match);
      }
    }
    return { completedIds: completed, inProgressIds: inProgress };
  }, [data, progress]);

  const launchSelected = useCallback(
    (moduleId: string) => {
      // Status (2026-05-08):
      //   ✅ SIM path is wired end-to-end via #250 (compose-prompt + Call.requestedModuleId
      //      pickup #274 + tutor lockedModule narrative #266) — when returnTo points at
      //      /x/sim/[id] the picker rewrites the URL with ?requestedModuleId and SimChat
      //      forwards it on call init.
      //   ⏳ VAPI / real voice dial path: NOT YET wired. The picker still bounces back to
      //      a SIM session for voice scenarios; voice FOH integration would consume the
      //      same /api/student/module-status data and pass requestedModuleId to the dial.
      //      Tracked under #242 Slice 3 (in-chat picker — voice). Do not remove this
      //      comment until Slice 3 lands.
      console.info(
        "[picker] selected moduleId=%s for course=%s — SIM path active, VAPI dial deferred to #242 Slice 3",
        moduleId,
        courseId,
      );
      setLaunching(true);
      setTimeout(() => {
        setLaunching(false);
        if (returnTo) {
          const sep = returnTo.includes("?") ? "&" : "?";
          router.push(`${returnTo}${sep}requestedModuleId=${encodeURIComponent(moduleId)}`);
        } else {
          router.push(`/x/sim?requestedModuleId=${encodeURIComponent(moduleId)}`);
        }
      }, 600);
    },
    [courseId, returnTo, router],
  );

  const handleSelect = useCallback(
    (moduleId: string) => {
      const mod = moduleById.get(moduleId);
      if (!mod) return;
      if (mod.sessionTerminal) {
        setPendingTerminal(mod);
        return;
      }
      launchSelected(moduleId);
    },
    [moduleById, launchSelected],
  );

  const handleTerminalConfirm = useCallback(() => {
    if (!pendingTerminal) return;
    const id = pendingTerminal.id;
    setPendingTerminal(null);
    launchSelected(id);
  }, [pendingTerminal, launchSelected]);

  const handleTerminalCancel = useCallback(() => {
    setPendingTerminal(null);
  }, []);

  // #356: While the missing-callerId redirect effect runs, render nothing.
  if (needsCallerRedirect) return null;

  if (loading) return <PickerLoading />;

  if (error) {
    return (
      <div className="hf-card" style={{ margin: 24, padding: 24 }}>
        <p className="hf-text-muted">{error}</p>
      </div>
    );
  }

  // No data → nothing to render (load handler set `error` separately).
  if (!data) return null;

  // #495 Slice 4.1 — when both the authored path and the curriculum
  // fallback yield no modules, show a "curriculum is being prepared"
  // empty state. We previously bounced here, which left learners stuck
  // on AI-gen courses while generation was still completing.
  const hasModules = data.modules.length > 0;

  return (
    <div className="learner-picker-page">
      <header
        className="hf-flex hf-items-center hf-gap-sm learner-picker-page__header"
      >
        {returnTo && (
          <button
            type="button"
            className="hf-btn hf-btn-tertiary"
            onClick={() => router.push(returnTo)}
            aria-label="Back to session"
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        )}
        <GraduationCap size={18} className="hf-text-muted" aria-hidden="true" />
        <h1 className="hf-section-title learner-picker-page__title">
          Pick your module
        </h1>
      </header>

      <div className="learner-picker-page__body">
        {hasModules ? (
          <>
            <p className="hf-text-sm hf-text-muted learner-picker-page__intro">
              Choose what you want to practise. Recommendations are advisory — pick whatever helps you most.
            </p>

            <LearnerModulePicker
              modules={data.modules}
              lessonPlanMode={data.lessonPlanMode}
              completedModuleIds={completedIds}
              inProgressModuleIds={inProgressIds}
              onSelect={handleSelect}
              recommendedModuleId={data.recommendedModuleId ?? null}
              recommendedReason={data.recommendedReason ?? null}
              strictPrerequisites={data.strictPrerequisites ?? false}
            />

            {launching && (
              <div
                role="status"
                aria-live="polite"
                className="hf-banner learner-picker-page__banner"
              >
                <strong>Placeholder:</strong> VAPI call would start now —
                returning to the simulator with the selected module.
              </div>
            )}
          </>
        ) : (
          <div className="hf-empty learner-picker-page__empty" role="status" aria-live="polite">
            <p className="hf-text-sm hf-text-muted">
              Your curriculum is being prepared. Check back in a moment —
              modules will appear here once they're ready.
            </p>
          </div>
        )}
      </div>

      {pendingTerminal && (
        <ConfirmTerminalDialog
          module={pendingTerminal}
          onConfirm={handleTerminalConfirm}
          onCancel={handleTerminalCancel}
        />
      )}
    </div>
  );
}

function ConfirmTerminalDialog({
  module: mod,
  onConfirm,
  onCancel,
}: {
  module: AuthoredModule;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-terminal-title"
      className="learner-picker-page__dialog-backdrop"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--text-primary) 40%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        className="hf-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420, width: "90%", padding: 24 }}
      >
        <h2 id="picker-terminal-title" className="hf-section-title" style={{ marginTop: 0 }}>
          This module ends the session
        </h2>
        <p className="hf-text-sm hf-text-muted" style={{ marginBottom: 16 }}>
          <strong>{mod.label}</strong> ({mod.duration}) is a single-segment session — once you start it, the
          tutor will not move on to other modules in the same call.
        </p>
        <div className="hf-flex hf-gap-sm hf-justify-end">
          <button
            type="button"
            className="hf-btn hf-btn-secondary"
            onClick={onCancel}
            aria-label="Cancel — return to picker"
          >
            Cancel
          </button>
          <button
            type="button"
            className="hf-btn hf-btn-primary"
            onClick={onConfirm}
            aria-label={`Start ${mod.label} — this ends the session`}
          >
            Start anyway
          </button>
        </div>
      </div>
    </div>
  );
}
