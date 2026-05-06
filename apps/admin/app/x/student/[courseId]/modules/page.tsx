"use client";

/**
 * /x/student/[courseId]/modules — learner-facing Module Picker (Slice 1).
 *
 * SIM-first mount per #242. Renders LearnerModulePicker live (with onSelect)
 * and lets a learner pick a module to drive the next session. Slice 2 will
 * thread the selected moduleId through the call-launch flow; Slice 1 only
 * confirms the pick and surfaces a "Starting session..." toast.
 *
 * Falls back silently when modulesAuthored !== true so legacy courses are
 * unaffected (decision #3, AC: courses without authored modules are hidden).
 */

import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { GraduationCap, ArrowLeft } from "lucide-react";
import type {
  AuthoredModule,
  ModuleDefaults,
  ModuleSource,
  ValidationWarning,
} from "@/lib/types/json-fields";
import { LearnerModulePicker } from "@/app/x/courses/[courseId]/_components/LearnerModulePicker";
import "@/app/x/courses/[courseId]/_components/authored-modules-panel.css";

interface ModulesPayload {
  ok: boolean;
  modulesAuthored: boolean | null;
  modules: AuthoredModule[];
  moduleDefaults: Partial<ModuleDefaults>;
  moduleSource: ModuleSource | null;
  validationWarnings: ValidationWarning[];
  hasErrors: boolean;
  lessonPlanMode: "structured" | "continuous" | null;
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
  const { courseId } = useParams<{ courseId: string }>();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo");

  const [data, setData] = useState<ModulesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingTerminal, setPendingTerminal] = useState<AuthoredModule | null>(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/courses/${courseId}/import-modules`);
        if (!res.ok) {
          if (!cancelled) setError(res.status === 404 ? "Course not found" : "Failed to load modules");
          return;
        }
        const json = (await res.json()) as ModulesPayload;
        if (!cancelled) setData(json);
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
  }, [courseId]);

  // Fall-through guard: course has no authored modules → bounce back.
  // `null` (never imported) and `false` (explicitly off) both hide the picker;
  // we distinguish them only in the console log so prod telemetry can tell them apart.
  useEffect(() => {
    if (loading || error || !data) return;
    if (data.modulesAuthored !== true) {
      console.info(
        "[picker] modulesAuthored=%s for course %s — silently bouncing",
        data.modulesAuthored,
        courseId,
      );
      router.replace(returnTo ?? "/x/sim");
    }
  }, [loading, error, data, returnTo, router, courseId]);

  const moduleById = useMemo(() => {
    const m = new Map<string, AuthoredModule>();
    if (data) data.modules.forEach((mod) => m.set(mod.id, mod));
    return m;
  }, [data]);

  const launchSelected = useCallback(
    (moduleId: string) => {
      // Slice 1 stub: log + toast. Slice 2 wires this into the call-launch flow.
      console.info("[picker] selected moduleId=%s for course=%s", moduleId, courseId);
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

  if (loading) return <PickerLoading />;

  if (error) {
    return (
      <div className="hf-card" style={{ margin: 24, padding: 24 }}>
        <p className="hf-text-muted">{error}</p>
      </div>
    );
  }

  // While the redirect effect runs, render nothing
  if (!data || data.modulesAuthored !== true) return null;

  return (
    <div className="learner-picker-page">
      <header
        className="hf-flex hf-items-center hf-gap-sm"
        style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-default)" }}
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
        <h1 className="hf-section-title" style={{ margin: 0 }}>
          Pick your module
        </h1>
      </header>

      <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
        <p className="hf-text-sm hf-text-muted" style={{ marginBottom: 16 }}>
          Choose what you want to practise. Recommendations are advisory — pick whatever helps you most.
        </p>

        <LearnerModulePicker
          modules={data.modules}
          lessonPlanMode={data.lessonPlanMode}
          onSelect={handleSelect}
        />

        {launching && (
          <div
            role="status"
            aria-live="polite"
            className="hf-banner"
            style={{ marginTop: 16 }}
          >
            Starting session…
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
