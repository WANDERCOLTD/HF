"use client";

import { WizardShell } from "@/components/wizards/WizardShell";
import type { WizardConfig } from "@/components/wizards/types";
import { HubStep } from "./_steps/HubStep";
import { VibeStep } from "./_steps/VibeStep";
import { MembersStep } from "./_steps/MembersStep";
import { CommunityDoneStep } from "./_steps/CommunityDoneStep";

const VIBE_LABELS: Record<string, string> = {
  companion: "Just be there", advisory: "Give clear answers",
  coaching: "Help them take action", socratic: "Guide their thinking",
  facilitation: "Help them organise", reflective: "Explore and reflect", open: "Follow their lead",
};

const config: WizardConfig = {
  flowId: "community-setup",
  wizardName: "community-setup",
  returnPath: "/x/communities",
  cancelLabel: "Communities",
  taskType: "community_setup",
  steps: [
    {
      id: "hub", label: "Hub Identity", activeLabel: "Setting identity", component: HubStep,
      summaryLabel: "Hub",
      summary: (getData) => getData<string>("hubName") || "Unnamed hub",
    },
    {
      id: "vibe", label: "Topics & Pattern", activeLabel: "Configuring topics", component: VibeStep,
      summaryLabel: "Vibe",
      summary: (getData) => {
        if (getData<string>("communityKind") === "TOPIC_BASED") {
          const n = (getData<unknown[]>("topics") ?? []).length;
          return `${n} topic${n === 1 ? "" : "s"}`;
        }
        const p = getData<string>("hubPattern");
        return p ? (VIBE_LABELS[p] ?? p) : "Pattern configured";
      },
    },
    {
      id: "members", label: "Members", activeLabel: "Adding members", component: MembersStep,
      summaryLabel: "Members",
      summary: (getData) => {
        const n = (getData<unknown[]>("memberCallerDetails") ?? []).length;
        return n === 0 ? "No members yet" : `${n} member${n === 1 ? "" : "s"}`;
      },
    },
    { id: "done", label: "Done", activeLabel: "Creating hub", component: CommunityDoneStep },
  ],
};

export default function CommunityNewPage() {
  return <WizardShell config={config} />;
}
