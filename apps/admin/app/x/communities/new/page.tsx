"use client";

import { WizardShell } from "@/components/wizards/WizardShell";
import type { WizardConfig, DoneContentItem } from "@/components/wizards/types";
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
  wizardName: "community",
  returnPath: "/x/communities",
  cancelLabel: "Communities",
  taskType: "community_setup",
  steps: [
    {
      id: "hub", label: "Hub Identity", activeLabel: "Setting identity", component: HubStep,
      summaryLabel: "Hub",
      summary: (getData) => getData<string>("hubName") || "Unnamed hub",
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const name = getData<string>("hubName");
        if (name) items.push({ label: "Hub name", value: name });
        const desc = getData<string>("hubDescription");
        if (desc) items.push({ label: "Description", value: desc.length > 80 ? desc.slice(0, 80) + "\u2026" : desc });
        const kind = getData<string>("communityKind");
        if (kind) items.push({ label: "Type", value: kind === "TOPIC_BASED" ? "Topic-based" : "Open connection" });
        return items;
      },
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
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const kind = getData<string>("communityKind");
        if (kind === "TOPIC_BASED") {
          const topics = getData<{ name: string; pattern: string }[]>("topics") ?? [];
          if (topics.length) {
            items.push({ label: "Topics", value: `${topics.length} topic${topics.length !== 1 ? "s" : ""}` });
            for (const t of topics.slice(0, 5)) {
              items.push({ label: t.name, value: VIBE_LABELS[t.pattern] ?? t.pattern });
            }
            if (topics.length > 5) items.push({ label: "", value: `+${topics.length - 5} more` });
          }
        } else {
          const pattern = getData<string>("hubPattern");
          if (pattern) items.push({ label: "AI style", value: VIBE_LABELS[pattern] ?? pattern });
        }
        return items;
      },
    },
    {
      id: "members", label: "Members", activeLabel: "Adding members", component: MembersStep,
      summaryLabel: "Members",
      summary: (getData) => {
        const n = (getData<unknown[]>("memberCallerDetails") ?? []).length;
        return n === 0 ? "No members yet" : `${n} member${n === 1 ? "" : "s"}`;
      },
      doneContent: (getData) => {
        const items: DoneContentItem[] = [];
        const details = getData<{ name: string | null; email: string | null }[]>("memberCallerDetails") ?? [];
        if (details.length) {
          items.push({ label: "Members", value: `${details.length} member${details.length !== 1 ? "s" : ""}` });
          const names = details.slice(0, 5).map(d => d.name || d.email || "Unknown").join(", ");
          items.push({ label: "Added", value: details.length > 5 ? `${names}, +${details.length - 5} more` : names });
        } else {
          items.push({ label: "Members", value: "None \u2014 share join link after creation" });
        }
        return items;
      },
    },
    { id: "done", label: "Done", activeLabel: "Creating hub", component: CommunityDoneStep },
  ],
};

export default function CommunityNewPage() {
  return <WizardShell config={config} />;
}
