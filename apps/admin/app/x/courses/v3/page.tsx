"use client";

/**
 * Course Builder v3 — Single progressive screen.
 *
 * Replaces multi-step wizards with a single screen where the teacher
 * types a course name, clicks Build, and edits everything inline while
 * AI fills in suggestions in the background.
 */

import { useSearchParams } from "next/navigation";
import { WizardShell } from "@/components/wizards/WizardShell";
import type { WizardConfig, StepRenderProps } from "@/components/wizards/types";
import { CourseBuilderStep } from "../_components/steps/CourseBuilderStep";
import type { ComponentType } from "react";

type S = ComponentType<StepRenderProps>;

const config: WizardConfig = {
  flowId: "course-create-v3",
  wizardName: "course",
  returnPath: "/x/courses",
  cancelLabel: "Courses",
  taskType: "course_setup",
  steps: [
    {
      id: "create",
      label: "New Course",
      activeLabel: "Creating your course",
      component: CourseBuilderStep as S,
    },
  ],
};

export default function CourseBuilderV3Page() {
  const searchParams = useSearchParams();
  const domainId = searchParams.get("domainId") ?? undefined;
  const initialData = domainId ? { domainId } : undefined;
  return <WizardShell config={config} initialData={initialData} />;
}
