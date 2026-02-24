"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useStepFlow } from "@/contexts/StepFlowContext";
import { useWizardResume } from "@/hooks/useWizardResume";
import { WizardResumeBanner } from "@/components/shared/WizardResumeBanner";
import ContentSourceWizard, { CONTENT_STEPS } from "./_components/ContentSourceWizard";
import ContentSourcesLibrary from "./_components/ContentSourcesLibrary";

async function loadWizardSteps() {
  try {
    const response = await fetch("/api/wizard-steps?wizard=content-source");
    const data = await response.json();
    if (data.ok && data.steps && data.steps.length > 0) {
      return data.steps.map((step: any) => ({
        id: step.id,
        label: step.label,
        activeLabel: step.activeLabel,
      }));
    }
  } catch (err) {
    console.warn("[ContentSourcesPage] Failed to load spec steps, using defaults", err);
  }
  return CONTENT_STEPS;
}

export default function ContentSourcesPage() {
  const [viewMode, setViewMode] = useState<"wizard" | "library">("library");
  const searchParams = useSearchParams();
  const { state, isActive, startFlow } = useStepFlow();
  const { pendingTask, isLoading: resumeLoading } = useWizardResume("content_wizard");

  // Accept hierarchy context from search params (when launched from course > subject)
  const hierarchyCourseId = searchParams.get("courseId");
  const hierarchySubjectId = searchParams.get("subjectId");
  const hierarchyReturnPath = hierarchyCourseId && hierarchySubjectId
    ? `/x/courses/${hierarchyCourseId}/subjects/${hierarchySubjectId}`
    : "/x/content-sources";

  const showWizard = isActive && state?.flowId === "content-sources";

  // If flow is already active on mount (e.g. sessionStorage restore), show wizard
  useEffect(() => {
    if (showWizard) setViewMode("wizard");
  }, [showWizard]);

  const handleNewContentSource = async () => {
    const stepsToUse = await loadWizardSteps();

    // Create a UserTask for DB-backed wizard persistence
    let taskId: string | undefined;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: "content_wizard",
          currentStep: 0,
          context: {
            _wizardStep: 0,
            ...(hierarchyCourseId && { courseId: hierarchyCourseId }),
            ...(hierarchySubjectId && { subjectId: hierarchySubjectId }),
          },
        }),
      });
      const data = await res.json();
      if (data.ok) taskId = data.taskId;
    } catch {
      // Continue without DB persistence — sessionStorage still works
    }

    startFlow({
      flowId: "content-sources",
      steps: stepsToUse,
      returnPath: hierarchyReturnPath,
      taskType: "content_wizard",
      taskId,
    });
    setViewMode("wizard");
  };

  const handleResumeContentSource = async () => {
    if (!pendingTask) return;
    const stepsToUse = await loadWizardSteps();
    const ctx = pendingTask.context || {};

    // Use hierarchy return path if context has courseId, else fall back
    const resumeReturnPath = ctx.courseId && ctx.subjectId
      ? `/x/courses/${ctx.courseId}/subjects/${ctx.subjectId}`
      : hierarchyReturnPath;

    startFlow({
      flowId: "content-sources",
      steps: stepsToUse,
      returnPath: resumeReturnPath,
      taskType: "content_wizard",
      taskId: pendingTask.id,
      initialData: ctx,
      initialStep: ctx._wizardStep ?? 0,
    });
    setViewMode("wizard");
  };

  const handleDiscardResume = async () => {
    if (pendingTask) {
      try {
        await fetch(`/api/tasks?taskId=${pendingTask.id}`, { method: "DELETE" });
      } catch { /* ignore */ }
    }
    await handleNewContentSource();
  };

  // Show resume banner if there's an unfinished wizard task and wizard isn't active
  if (!showWizard && !resumeLoading && pendingTask) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div style={{ paddingTop: 64 }}>
          <WizardResumeBanner
            task={pendingTask}
            onResume={handleResumeContentSource}
            onDiscard={handleDiscardResume}
            label="Materials"
          />
        </div>
      </div>
    );
  }

  if (showWizard) {
    return <ContentSourceWizard />;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 className="hf-page-title">Content Library</h1>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", marginTop: 4 }}>
            Manage all materials, upload documents, and review assertions.
          </p>
        </div>
        <button
          onClick={handleNewContentSource}
          className="hf-btn hf-btn-primary"
          style={{ whiteSpace: "nowrap" }}
        >
          New Material
        </button>
      </div>

      {/* Content */}
      <ContentSourcesLibrary />
    </div>
  );
}
