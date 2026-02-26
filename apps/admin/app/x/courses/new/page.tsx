"use client";

import { useSearchParams } from "next/navigation";
import { WizardShell } from "@/components/wizards/WizardShell";
import type { WizardConfig, StepRenderProps } from "@/components/wizards/types";
import { IntentStep } from "../_components/steps/IntentStep";
import { ContentStep } from "../_components/steps/ContentStep";
import { LessonPlanStep } from "../_components/steps/LessonPlanStep";
import { CourseConfigStep } from "../_components/steps/CourseConfigStep";
import { StudentsStep } from "../_components/steps/StudentsStep";
import { CourseDoneStep } from "../_components/steps/CourseDoneStep";
import type { ComponentType } from "react";

// Course step components use StepProps (subset of StepRenderProps) — compatible via contravariance
type S = ComponentType<StepRenderProps>;

const PATTERN_LABELS: Record<string, string> = {
  directive: "Directive", socratic: "Socratic", advisory: "Advisory",
  coaching: "Coaching", companion: "Companion", reflective: "Reflective",
  facilitation: "Facilitation", open: "Open",
};

const config: WizardConfig = {
  flowId: "course-setup",
  wizardName: "course",
  returnPath: "/x/courses",
  cancelLabel: "Courses",
  taskType: "course_setup",
  steps: [
    {
      id: "intent",
      label: "Course Intent",
      activeLabel: "Setting intent",
      component: IntentStep as S,
      summaryLabel: "Course",
      summary: (getData) => getData<string>("courseName") || "Unnamed course",
    },
    {
      id: "content",
      label: "Content Upload",
      activeLabel: "Uploading content",
      component: ContentStep as S,
      summaryLabel: "Content",
      summary: (getData) => {
        const p = getData<string>("interactionPattern");
        const name = getData<string>("courseName");
        return p ? `${name ? `${name} · ` : ""}${PATTERN_LABELS[p] ?? p}` : "Content uploaded";
      },
    },
    {
      id: "lesson-plan",
      label: "Session Plan",
      activeLabel: "Building session plan",
      component: LessonPlanStep as S,
      summaryLabel: "Lessons",
      summary: (getData) => {
        const plan = getData<{ sessions?: unknown[] }>("lessonPlan");
        const n = plan?.sessions?.length ?? 0;
        return n > 0 ? `${n} session${n === 1 ? "" : "s"}` : "Plan generated";
      },
    },
    {
      id: "course-config",
      label: "Teaching Setup",
      activeLabel: "Configuring teaching",
      component: CourseConfigStep as S,
      summaryLabel: "Setup",
      summary: () => "Configured",
    },
    {
      id: "students",
      label: "Students",
      activeLabel: "Adding students",
      component: StudentsStep as S,
      summaryLabel: "Students",
      summary: (getData) => {
        const ids = getData<string[]>("selectedCallerIds") ?? [];
        const cohorts = getData<string[]>("cohortGroupIds") ?? [];
        if (cohorts.length > 0) return `${cohorts.length} cohort${cohorts.length === 1 ? "" : "s"}`;
        return ids.length === 0 ? "No students yet" : `${ids.length} student${ids.length === 1 ? "" : "s"}`;
      },
    },
    {
      id: "done",
      label: "Done",
      activeLabel: "Creating course",
      component: CourseDoneStep as S,
    },
  ],
};

export default function CourseNewPage() {
  const searchParams = useSearchParams();
  const domainId = searchParams.get("domainId") ?? undefined;
  const initialData = domainId ? { domainId } : undefined;
  return <WizardShell config={config} initialData={initialData} />;
}
