"use client";

/**
 * Course Design Console — Slices 1+2+3 of epic #1263.
 *
 * Mounts the shared `<ConsoleShell>` (Slice 0) with 12 lenses across
 * three groups:
 *
 *   JOURNEY     intake, onboarding, stops, offboarding, welcome
 *   BEHAVIOUR   call1Mode, firstCallTargets, tolerances, skillBanding,
 *               progressSignals, agentTunerNlp
 *   PREVIEW     preview
 *
 * Journey lenses (Slice 1) — `<SessionFlowEditor activeSection="…">` scoped.
 * Behaviour lenses (Slice 2) — wrap existing components that previously
 *   lived as CollapsibleCards on the Design tab. Card duplication removed.
 * Preview lens (Slice 3) — `<PreviewLens>` with lazy compose + Educator
 *   + Engineer views.
 *
 * URL state uses `?design_view=<id>` (distinct from Progress v2's `?view=`).
 *
 * Reads/writes for Journey lenses route through GET/PUT
 * `/api/courses/:id/session-flow`. Behaviour lenses keep their existing
 * routes (no new write paths introduced by the absorption).
 *
 * Closes #1267 + #1268. Refs epic #1263.
 */

import React from "react";
import {
  GraduationCap,
  Sparkles,
  ClipboardCheck,
  ThumbsUp,
  MessageSquare,
  Settings2,
  Target,
  Gauge,
  Award,
  Sliders,
  Compass,
  Eye,
  Workflow,
} from "lucide-react";
import {
  ConsoleShell,
  useConsoleView,
  type ConsoleLensDef,
} from "@/components/shared/console-shell";
import {
  SessionFlowEditor,
  type SessionFlowLens,
} from "@/components/session-flow/SessionFlowEditor";
import { FirstSessionSettings } from "@/components/course-design/FirstSessionSettings";
import { FeltProgressSettings } from "@/components/course-design/FeltProgressSettings";
import { TolerancesSettings } from "@/components/course-design/TolerancesSettings";
import { BandingPicker } from "@/components/shared/BandingPicker";
import { PreviewLens } from "./PreviewLens";
import { VoiceFlowLens } from "./VoiceFlowLens";
import "./voice-flow-lens.css";
import { StalePromptPillForCourse } from "@/components/callers/caller-detail/StalePromptPillForCourse";
import type { PlaybookConfig } from "@/lib/types/json-fields";

type DesignLensId =
  | "preview"
  | "intake"
  | "onboarding"
  | "stops"
  | "offboarding"
  | "welcome"
  | "call1Mode"
  | "firstCallTargets"
  | "tolerances"
  | "skillBanding"
  | "progressSignals"
  | "agentTunerNlp"
  | "voiceFlow";

/** Preview moved to the top of the nav (2026-06-07) — it's now the
 *  canonical landing surface: educator sees the full call walkthrough,
 *  clicks any bubble to edit in a sidetray. Default lens is `preview`. */
const DESIGN_LENS_ORDER: DesignLensId[] = [
  "preview",
  "intake",
  "onboarding",
  "stops",
  "offboarding",
  "welcome",
  "call1Mode",
  "firstCallTargets",
  "tolerances",
  "skillBanding",
  "progressSignals",
  "agentTunerNlp",
  "voiceFlow",
];

interface LensProps {
  courseId: string;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
}

const ICON_SIZE = 14;

/** Journey-lens body — `<SessionFlowEditor>` scoped to one section. */
function makeJourneyLens(section: SessionFlowLens): React.ComponentType<LensProps> {
  const Lens: React.FC<LensProps> = ({ courseId }) => (
    <SessionFlowEditor courseId={courseId} activeSection={section} />
  );
  Lens.displayName = `JourneyLens(${section})`;
  return Lens;
}

/* ── Behaviour lens wrappers (Slice 2) ─────────────────────
   Each wrapper threads `courseId` + `playbookConfig` into the existing
   component. The components themselves are unchanged — the lens is a
   thin host. */

const Call1ModeLens: React.FC<LensProps> = ({ courseId, playbookConfig }) => (
  <FirstSessionSettings courseId={courseId} playbookConfig={playbookConfig} />
);
Call1ModeLens.displayName = "Call1ModeLens";

const FirstCallTargetsLens: React.FC<LensProps> = ({ courseId, playbookConfig }) => (
  <FirstSessionSettings courseId={courseId} playbookConfig={playbookConfig} />
);
FirstCallTargetsLens.displayName = "FirstCallTargetsLens";

const TolerancesLens: React.FC<LensProps> = ({ courseId, playbookConfig }) => (
  <TolerancesSettings
    courseId={courseId}
    playbookId={courseId}
    playbookConfig={playbookConfig}
  />
);
TolerancesLens.displayName = "TolerancesLens";

const SkillBandingLens: React.FC<LensProps> = ({ courseId, playbookConfig }) => {
  const skillTierMapping = (playbookConfig as PlaybookConfig | null | undefined)?.skillTierMapping;
  return <BandingPicker courseId={courseId} current={skillTierMapping} />;
};
SkillBandingLens.displayName = "SkillBandingLens";

const ProgressSignalsLens: React.FC<LensProps> = ({ courseId, playbookConfig }) => (
  <FeltProgressSettings courseId={courseId} playbookConfig={playbookConfig} />
);
ProgressSignalsLens.displayName = "ProgressSignalsLens";

const PreviewLensWrap: React.FC<LensProps> = ({ courseId }) => (
  <PreviewLens courseId={courseId} />
);
PreviewLensWrap.displayName = "PreviewLensWrap";

const VoiceFlowLensWrap: React.FC<LensProps> = ({ courseId }) => (
  <VoiceFlowLens courseId={courseId} />
);
VoiceFlowLensWrap.displayName = "VoiceFlowLensWrap";

const DESIGN_LENSES: Record<DesignLensId, ConsoleLensDef<LensProps>> = {
  // #1316 — Number the JOURNEY lenses ① ② ③ ④ ⑤ so the operator sees the
  // learner-journey sequence at a glance from the LH-nav. Labels-only
  // change; lens order in DESIGN_LENS_ORDER already encodes the sequence.
  intake: {
    id: "intake",
    label: "① Intake",
    iconNode: <GraduationCap size={ICON_SIZE} />,
    blurb: "Goals question, About You, Knowledge Check, AI Intro Call — what Call 1 asks the learner.",
    Component: makeJourneyLens("intake"),
  },
  onboarding: {
    id: "onboarding",
    label: "② Onboarding",
    iconNode: <Sparkles size={ICON_SIZE} />,
    blurb: "First-call structural template — phases, durations, goals.",
    Component: makeJourneyLens("onboarding"),
  },
  stops: {
    id: "stops",
    label: "③ Session Stops",
    iconNode: <ClipboardCheck size={ICON_SIZE} />,
    blurb: "Pre-test / mid-test / post-test / NPS — the gated moments around teaching.",
    Component: makeJourneyLens("stops"),
  },
  offboarding: {
    id: "offboarding",
    label: "④ Offboarding",
    iconNode: <ThumbsUp size={ICON_SIZE} />,
    blurb: "End-of-course wrap-up phases.",
    Component: makeJourneyLens("offboarding"),
  },
  // #1316 — Renamed "Welcome message" → "Course opening line" to
  // disambiguate from the Domain-level Domain.onboardingWelcome which
  // operators were also seeing labelled as "Welcome message".
  welcome: {
    id: "welcome",
    label: "⑤ Course opening line",
    iconNode: <MessageSquare size={ICON_SIZE} />,
    blurb: "First-line greeting the learner hears on call 1. Overrides the Domain greeting.",
    Component: makeJourneyLens("welcome"),
  },
  call1Mode: {
    id: "call1Mode",
    label: "Call 1 Mode",
    iconNode: <Settings2 size={ICON_SIZE} />,
    blurb: "Onboarding / Teach Immediately / Baseline Assessment — the overall shape of Call 1.",
    Component: Call1ModeLens,
  },
  firstCallTargets: {
    id: "firstCallTargets",
    label: "First-call Targets",
    iconNode: <Target size={ICON_SIZE} />,
    blurb: "Per-course BEHAVIOR target overrides applied only to Call 1.",
    Component: FirstCallTargetsLens,
  },
  tolerances: {
    id: "tolerances",
    label: "Tolerances",
    iconNode: <Gauge size={ICON_SIZE} />,
    blurb: "Course-default mastery threshold, retrieval cadence, memory decay.",
    Component: TolerancesLens,
  },
  skillBanding: {
    id: "skillBanding",
    label: "Skill Banding",
    iconNode: <Award size={ICON_SIZE} />,
    blurb: "Per-course tier mapping override.",
    Component: SkillBandingLens,
  },
  progressSignals: {
    id: "progressSignals",
    label: "Progress Signals",
    iconNode: <Sliders size={ICON_SIZE} />,
    blurb: "Mid-call acknowledgement + structured offboarding summary.",
    Component: ProgressSignalsLens,
  },
  agentTunerNlp: {
    id: "agentTunerNlp",
    label: "Agent Tuner (NLP)",
    iconNode: <Compass size={ICON_SIZE} />,
    blurb: "Natural-language tuning of agent identity. Follow-on story (#1276).",
  },
  preview: {
    id: "preview",
    label: "Preview",
    iconNode: <Eye size={ICON_SIZE} />,
    blurb: "Educator view + Engineer view of what Call 1 will look like.",
    Component: PreviewLensWrap,
  },
  voiceFlow: {
    id: "voiceFlow",
    label: "Voice Flow",
    iconNode: <Workflow size={ICON_SIZE} />,
    blurb: "Flowchart of cascade-bound voice settings — provider, voice, transcriber, during-the-call behaviours.",
    Component: VoiceFlowLensWrap,
  },
};

const DEFAULT_LENS: DesignLensId = "preview";

function isDesignLensId(value: string | null | undefined): value is DesignLensId {
  if (!value) return false;
  return (DESIGN_LENS_ORDER as string[]).includes(value);
}

const COMING_SOON_HELP = (
  <>Follow-on story: <code>#1276</code>.</>
);

export interface CourseDesignConsoleProps {
  courseId: string;
  playbookConfig?: PlaybookConfig | Record<string, unknown> | null;
}

export function CourseDesignConsole({
  courseId,
  playbookConfig,
}: CourseDesignConsoleProps): React.ReactElement {
  const { view, setView } = useConsoleView<DesignLensId>({
    isValidId: isDesignLensId,
    defaultId: DEFAULT_LENS,
    paramName: "design_view",
    consoleId: "course-design",
  });

  return (
    <>
      <ConsoleShell<DesignLensId, LensProps>
        lensOrder={DESIGN_LENS_ORDER}
        lenses={DESIGN_LENSES}
        lensProps={{ courseId, playbookConfig }}
        activeLensId={view}
        onLensChange={setView}
        ariaNavLabel="Course design lenses"
        idPrefix="hf-course-design"
        comingSoonHelpText={COMING_SOON_HELP}
        // #1429 — staleness aggregate above the lens nav. Self-hides
        // when no demo callers on this course have a stale prompt.
        headerBanner={<StalePromptPillForCourse courseId={courseId} />}
      />
    </>
  );
}
