"use client";

import { WizardShell } from "@/components/wizards/WizardShell";
import type { WizardConfig, StepRenderProps, DoneContentItem } from "@/components/wizards/types";
import { IdentityStep } from "./_components/steps/IdentityStep";
import { BrandingStep } from "./_components/steps/BrandingStep";
import { WelcomeStep } from "./_components/steps/WelcomeStep";
import { TerminologyStep } from "./_components/steps/TerminologyStep";
import { DefaultsStep } from "./_components/steps/DefaultsStep";
import { LaunchStep } from "./_components/steps/LaunchStep";
import type { ComponentType } from "react";

type S = ComponentType<StepRenderProps>;

const config: WizardConfig = {
  flowId: "institution-setup",
  wizardName: "institution",
  returnPath: "/x/institutions",
  cancelLabel: "Institutions",
  steps: [
    {
      id: "identity",
      label: "Institution",
      activeLabel: "Tell us about your institution",
      component: IdentityStep as S,
      summaryLabel: "Institution",
      summary: (getData) => {
        const name = getData<string>("institutionName");
        const slug = getData<string>("typeSlug");
        return `${name ?? "Unnamed"}${slug ? ` · ${slug}` : ""}`;
      },
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const name = getData<string>("institutionName");
        if (name) items.push({ label: "Name", value: name });
        const slug = getData<string>("typeSlug");
        if (slug) items.push({ label: "Type", value: slug.charAt(0).toUpperCase() + slug.slice(1) });
        const url = getData<string>("websiteUrl");
        if (url) items.push({ label: "Website", value: url });
        return items;
      },
    },
    {
      id: "branding",
      label: "Branding",
      activeLabel: "Make it yours",
      component: BrandingStep as S,
      summaryLabel: "Branding",
      summary: (getData) => (getData<string>("primaryColor") ? "Custom branding" : "Default"),
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const logo = getData<string>("logoUrl");
        if (logo) items.push({ label: "Logo", value: "Custom logo set" });
        const primary = getData<string>("primaryColor");
        if (primary) items.push({ label: "Primary colour", value: primary });
        const secondary = getData<string>("secondaryColor");
        if (secondary) items.push({ label: "Secondary colour", value: secondary });
        if (items.length === 0) items.push({ label: "Branding", value: "Default (no custom branding)" });
        return items;
      },
    },
    {
      id: "welcome",
      label: "Welcome",
      activeLabel: "Welcome message",
      component: WelcomeStep as S,
      summaryLabel: "Welcome",
      summary: (getData) => {
        const m = getData<string>("welcomeMessage");
        return m ? `${m.slice(0, 40)}${m.length > 40 ? "…" : ""}` : "Default";
      },
      doneContent: (getData) => {
        const msg = getData<string>("welcomeMessage");
        if (msg) return [{ label: "Welcome", value: msg.length > 80 ? msg.slice(0, 80) + "\u2026" : msg }];
        return [{ label: "Welcome", value: "Default welcome message" }];
      },
    },
    {
      id: "terminology",
      label: "Terminology",
      activeLabel: "Reviewing terminology",
      component: TerminologyStep as S,
      summaryLabel: "Terminology",
      summary: (getData) => `${getData<string>("typeSlug") ?? "Default"} preset`,
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const overrides = getData<Record<string, string>>("terminologyOverrides");
        if (overrides) {
          const labels: Record<string, string> = {
            domain: "Institution", playbook: "Course", caller: "Learner",
            instructor: "Instructor", session: "Session",
          };
          for (const [key, val] of Object.entries(overrides)) {
            if (val) items.push({ label: labels[key] || key, value: val });
          }
        }
        if (items.length === 0) items.push({ label: "Terminology", value: "Type defaults" });
        return items;
      },
    },
    {
      id: "defaults",
      label: "Defaults",
      activeLabel: "Course defaults",
      component: DefaultsStep as S,
      summaryLabel: "Defaults",
      summary: (getData) => {
        const d = getData<Record<string, unknown>>("lessonPlanDefaults");
        if (!d) return "System defaults";
        const parts: string[] = [];
        if (d.sessionCount) parts.push(`${d.sessionCount} sessions`);
        if (d.durationMins) parts.push(`${d.durationMins} min`);
        if (d.emphasis) parts.push(d.emphasis as string);
        return parts.length > 0 ? parts.join(" · ") : "System defaults";
      },
      doneContent: (getData) => {
        const d = getData<Record<string, unknown>>("lessonPlanDefaults");
        if (!d) return [{ label: "Defaults", value: "System defaults (no overrides)" }];
        const items: DoneContentItem[] = [];
        if (d.sessionCount) items.push({ label: "Sessions", value: String(d.sessionCount) });
        if (d.durationMins) items.push({ label: "Duration", value: `${d.durationMins} min` });
        if (d.emphasis) items.push({ label: "Emphasis", value: d.emphasis as string });
        if (d.assessments) items.push({ label: "Assessments", value: d.assessments as string });
        if (d.lessonPlanModel) items.push({ label: "Model", value: d.lessonPlanModel as string });
        if (items.length === 0) items.push({ label: "Defaults", value: "System defaults" });
        return items;
      },
    },
    {
      id: "launch",
      label: "Launch",
      activeLabel: "Creating institution",
      component: LaunchStep as S,
    },
  ],
};

export default function InstitutionNewPage() {
  return <WizardShell config={config} />;
}
