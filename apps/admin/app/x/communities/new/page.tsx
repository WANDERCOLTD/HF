import { WizardShell } from "@/components/wizards/WizardShell";
import type { WizardConfig } from "@/components/wizards/types";
import { HubStep } from "./_steps/HubStep";
import { VibeStep } from "./_steps/VibeStep";
import { MembersStep } from "./_steps/MembersStep";
import { CommunityDoneStep } from "./_steps/CommunityDoneStep";

const config: WizardConfig = {
  flowId: "community-setup",
  wizardName: "community-setup",
  returnPath: "/x/communities",
  taskType: "community_setup",
  steps: [
    { id: "hub",     label: "Hub Identity",    activeLabel: "Setting identity",   component: HubStep },
    { id: "vibe",    label: "Topics & Pattern", activeLabel: "Configuring topics", component: VibeStep },
    { id: "members", label: "Members",          activeLabel: "Adding members",     component: MembersStep },
    { id: "done",    label: "Done",             activeLabel: "Creating hub",       component: CommunityDoneStep },
  ],
};

export default function CommunityNewPage() {
  return <WizardShell config={config} />;
}
