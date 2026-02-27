"use client";

/**
 * Course Create Wizard v2 — 7-step flow with dedicated Plan Settings step.
 *
 * Changes from /x/courses/new:
 * - Plan Settings is a separate step (teacher configures before generation)
 * - Lesson Plan step auto-generates on mount (no intents phase)
 * - Unified terminology across all steps
 */

import { useSearchParams } from "next/navigation";
import { WizardShell } from "@/components/wizards/WizardShell";
import type { WizardConfig, StepRenderProps, DoneContentItem } from "@/components/wizards/types";
import { getLessonPlanModel } from "@/lib/lesson-plan/models";
import { IntentStep } from "../_components/steps/IntentStep";
import { ContentStep } from "../_components/steps/ContentStep";
import { PlanSettingsStep } from "../_components/steps/PlanSettingsStep";
import { LessonPlanStep } from "../_components/steps/LessonPlanStep";
import { CourseConfigStep } from "../_components/steps/CourseConfigStep";
import { StudentsStep } from "../_components/steps/StudentsStep";
import { CourseDoneStep } from "../_components/steps/CourseDoneStep";
import type { ComponentType } from "react";

type S = ComponentType<StepRenderProps>;

const PATTERN_LABELS: Record<string, string> = {
  directive: "Directive", socratic: "Socratic", advisory: "Advisory",
  coaching: "Coaching", companion: "Companion", reflective: "Reflective",
  facilitation: "Facilitation", open: "Open",
};

const config: WizardConfig = {
  flowId: "course-create-v2",
  wizardName: "course",
  returnPath: "/x/courses",
  cancelLabel: "Courses",
  taskType: "course_setup",
  steps: [
    // ── Step 1: Course ──────────────────────────────────
    {
      id: "intent",
      label: "Course",
      activeLabel: "Setting up course",
      component: IntentStep as S,
      summaryLabel: "Course",
      summary: (getData) => getData<string>("courseName") || "Unnamed course",
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const name = getData<string>("courseName");
        if (name) items.push({ label: "Course", value: name });
        const patternName = getData<string>("interactionPatternName");
        const pattern = getData<string>("interactionPattern");
        if (patternName || pattern) items.push({ label: "Teaching style", value: patternName || PATTERN_LABELS[pattern!] || pattern! });
        const outcomes = getData<string[]>("learningOutcomes");
        if (outcomes?.length) items.push({ label: "Outcomes", value: outcomes.join("; ") });
        return items;
      },
    },
    // ── Step 2: Content ─────────────────────────────────
    {
      id: "content",
      label: "Content",
      activeLabel: "Adding content",
      component: ContentStep as S,
      summaryLabel: "Content",
      summary: (getData) => {
        const p = getData<string>("interactionPattern");
        const name = getData<string>("courseName");
        return p ? `${name ? `${name} \u00b7 ` : ""}${PATTERN_LABELS[p] ?? p}` : "Content uploaded";
      },
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const mode = getData<string>("contentMode");
        if (mode === "skip") {
          items.push({ label: "Content", value: "Skipped \u2014 AI will generate from outcomes" });
        } else if (mode === "pack") {
          const subjects = getData<{ name: string }[]>("packSubjects") ?? [];
          const count = getData<number>("packSourceCount") ?? 0;
          if (count) items.push({ label: "Files", value: `${count} file${count !== 1 ? "s" : ""} uploaded` });
          if (subjects.length) items.push({ label: "Subjects", value: subjects.map(s => s.name).join(", ") });
          const totals = getData<{ assertions: number; questions: number; vocabulary: number; images: number }>("extractionTotals");
          if (totals?.images) items.push({ label: "Images", value: `${totals.images} extracted` });
        } else if (mode === "existing-course") {
          items.push({ label: "Content", value: "Linked to existing course" });
        }
        return items;
      },
    },
    // ── Step 3: Plan Settings (NEW) ─────────────────────
    {
      id: "plan-settings",
      label: "Plan Settings",
      activeLabel: "Configuring plan",
      component: PlanSettingsStep as S,
      summaryLabel: "Plan Settings",
      summary: (getData) => {
        const intents = getData<{ sessionCount: number; durationMins: number; emphasis: string }>("planIntents");
        if (!intents) return "Not configured";
        const emphLabel = intents.emphasis === "breadth" ? "breadth" : intents.emphasis === "depth" ? "depth" : "balanced";
        return `${intents.sessionCount} sessions \u00b7 ${intents.durationMins} min \u00b7 ${emphLabel}`;
      },
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const intents = getData<{ sessionCount: number; durationMins: number; emphasis: string; assessments: string; lessonPlanModel?: string }>("planIntents");
        if (intents) {
          items.push({ label: "Sessions", value: `${intents.sessionCount}` });
          items.push({ label: "Duration", value: `${intents.durationMins} min per session` });
          const emph = intents.emphasis;
          items.push({ label: "Emphasis", value: emph.charAt(0).toUpperCase() + emph.slice(1) });
          const assess = intents.assessments;
          items.push({ label: "Assessments", value: assess.charAt(0).toUpperCase() + assess.slice(1) });
          if (intents.lessonPlanModel) {
            items.push({ label: "Teaching model", value: getLessonPlanModel(intents.lessonPlanModel).label });
          }
        }
        return items;
      },
    },
    // ── Step 4: Lesson Plan ─────────────────────────────
    {
      id: "lesson-plan",
      label: "Lesson Plan",
      activeLabel: "Building lesson plan",
      component: LessonPlanStep as S,
      summaryLabel: "Lesson Plan",
      summary: (getData) => {
        const plan = getData<{ sessions?: unknown[] }>("lessonPlan");
        const n = plan?.sessions?.length ?? 0;
        return n > 0 ? `${n} session${n === 1 ? "" : "s"}` : "Plan generated";
      },
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const plan = getData<{ type: string }[]>("lessonPlan");
        if (plan?.length) {
          items.push({ label: "Sessions", value: `${plan.length} session${plan.length !== 1 ? "s" : ""}` });
          const typeCounts: Record<string, number> = {};
          for (const e of plan) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
          const breakdown = Object.entries(typeCounts).map(([t, c]) => `${c} ${t}`).join(", ");
          if (breakdown) items.push({ label: "Breakdown", value: breakdown });
        }
        return items;
      },
    },
    // ── Step 5: First Call ───────────────────────────────
    {
      id: "first-call",
      label: "First Call",
      activeLabel: "Configuring first call",
      component: CourseConfigStep as S,
      summaryLabel: "First Call",
      summary: () => "Configured",
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const welcome = getData<string>("welcomeMessage");
        if (welcome) items.push({ label: "Greeting", value: welcome.length > 60 ? welcome.slice(0, 60) + "\u2026" : welcome });
        const phases = getData<{ phase: string }[]>("flowPhases") ?? [];
        if (phases.length) items.push({ label: "Call flow", value: phases.map(p => p.phase).join(" \u2192 ") });
        const pills = getData<{ label: string }[]>("tunerPills") ?? [];
        if (pills.length) items.push({ label: "Behaviour", value: pills.map(p => p.label).join(", ") });
        if (items.length === 0) items.push({ label: "Setup", value: "Default configuration" });
        return items;
      },
    },
    // ── Step 6: Students ────────────────────────────────
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
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const cohorts = getData<string[]>("cohortGroupIds") ?? [];
        const callers = getData<string[]>("selectedCallerIds") ?? [];
        const emails = (getData<string[]>("studentEmails") ?? []).filter(Boolean);
        if (cohorts.length) items.push({ label: "Groups", value: `${cohorts.length} cohort${cohorts.length !== 1 ? "s" : ""}` });
        if (callers.length) items.push({ label: "Individuals", value: `${callers.length} student${callers.length !== 1 ? "s" : ""}` });
        if (emails.length) items.push({ label: "Email invites", value: `${emails.length} email${emails.length !== 1 ? "s" : ""}` });
        if (items.length === 0) items.push({ label: "Students", value: "None added yet \u2014 add later" });
        return items;
      },
    },
    // ── Step 7: Launch ──────────────────────────────────
    {
      id: "launch",
      label: "Launch",
      activeLabel: "Launching course",
      component: CourseDoneStep as S,
    },
  ],
};

export default function CourseCreatePage() {
  const searchParams = useSearchParams();
  const domainId = searchParams.get("domainId") ?? undefined;
  const initialData = domainId ? { domainId } : undefined;
  return <WizardShell config={config} initialData={initialData} />;
}
