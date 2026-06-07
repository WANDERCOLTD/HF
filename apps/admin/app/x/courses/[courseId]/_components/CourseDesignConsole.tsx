"use client";

/**
 * Course Design Console — Slice 1 of epic #1263.
 *
 * Mounts the shared `<ConsoleShell>` (Slice 0) on the Course Design tab
 * with 12 lenses across three groups:
 *
 *   JOURNEY     (5, live in this slice)
 *     intake, onboarding, stops, offboarding, welcome
 *   BEHAVIOUR   (6, soon — Slice 2 absorbs them)
 *     call1Mode, firstCallTargets, tolerances, skillBanding, progressSignals, agentTunerNlp
 *   PREVIEW     (1, soon — Slice 3)
 *     preview
 *
 * `soon` lenses surface in the nav so educators see the full surface from
 * day one; clicking shows the shared "Coming soon" body with the blurb.
 *
 * URL state uses `?design_view=<id>` (distinct from Progress v2's `?view=`).
 *
 * Reads/writes: each lens mounts `<SessionFlowEditor activeSection="…">`
 * which already routes through `resolveSessionFlow` (dual-read fallback)
 * and `PUT /api/courses/:id/session-flow`. No parallel paths.
 *
 * Closes #1266.
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

type DesignLensId =
  // Journey (live)
  | "intake"
  | "onboarding"
  | "stops"
  | "offboarding"
  | "welcome"
  // Behaviour (soon — Slice 2)
  | "call1Mode"
  | "firstCallTargets"
  | "tolerances"
  | "skillBanding"
  | "progressSignals"
  | "agentTunerNlp"
  // Preview (soon — Slice 3)
  | "preview";

const DESIGN_LENS_ORDER: DesignLensId[] = [
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
  "preview",
];

interface LensProps {
  courseId: string;
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

const DESIGN_LENSES: Record<DesignLensId, ConsoleLensDef<LensProps>> = {
  // ── Journey ─────────────────────────────────────────────
  intake: {
    id: "intake",
    label: "Intake",
    iconNode: <GraduationCap size={ICON_SIZE} />,
    blurb: "Goals question, About You, Knowledge Check, AI Intro Call — what Call 1 asks the learner.",
    Component: makeJourneyLens("intake"),
  },
  onboarding: {
    id: "onboarding",
    label: "Onboarding",
    iconNode: <Sparkles size={ICON_SIZE} />,
    blurb: "First-call structural template — phases, durations, goals.",
    Component: makeJourneyLens("onboarding"),
  },
  stops: {
    id: "stops",
    label: "Session Stops",
    iconNode: <ClipboardCheck size={ICON_SIZE} />,
    blurb: "Pre-test / mid-test / post-test / NPS — the gated moments around teaching.",
    Component: makeJourneyLens("stops"),
  },
  offboarding: {
    id: "offboarding",
    label: "Offboarding",
    iconNode: <ThumbsUp size={ICON_SIZE} />,
    blurb: "End-of-course wrap-up phases.",
    Component: makeJourneyLens("offboarding"),
  },
  welcome: {
    id: "welcome",
    label: "Welcome message",
    iconNode: <MessageSquare size={ICON_SIZE} />,
    blurb: "First-line greeting the learner hears on call 1.",
    Component: makeJourneyLens("welcome"),
  },
  // ── Behaviour (Slice 2 — soon) ──────────────────────────
  call1Mode: {
    id: "call1Mode",
    label: "Call 1 Mode",
    iconNode: <Settings2 size={ICON_SIZE} />,
    blurb: "Onboarding / Teach Immediately / Baseline Assessment — what shape Call 1 takes.",
  },
  firstCallTargets: {
    id: "firstCallTargets",
    label: "First-call Targets",
    iconNode: <Target size={ICON_SIZE} />,
    blurb: "Per-course BEHAVIOR target overrides applied only to Call 1.",
  },
  tolerances: {
    id: "tolerances",
    label: "Tolerances",
    iconNode: <Gauge size={ICON_SIZE} />,
    blurb: "Course-default mastery threshold, retrieval cadence, memory decay.",
  },
  skillBanding: {
    id: "skillBanding",
    label: "Skill Banding",
    iconNode: <Award size={ICON_SIZE} />,
    blurb: "Per-course tier mapping override.",
  },
  progressSignals: {
    id: "progressSignals",
    label: "Progress Signals",
    iconNode: <Sliders size={ICON_SIZE} />,
    blurb: "Mid-call acknowledgement + structured offboarding summary.",
  },
  agentTunerNlp: {
    id: "agentTunerNlp",
    label: "Agent Tuner (NLP)",
    iconNode: <Compass size={ICON_SIZE} />,
    blurb: "Natural-language tuning of agent identity. Follow-on after Slice 2 ships.",
  },
  // ── Preview (Slice 3 — soon) ────────────────────────────
  preview: {
    id: "preview",
    label: "Preview",
    iconNode: <Eye size={ICON_SIZE} />,
    blurb: "See the chat-bubble flow + composed prompt the learner would experience on Call 1, with deep-links to fix gaps.",
  },
};

const DEFAULT_LENS: DesignLensId = "intake";

function isDesignLensId(value: string | null | undefined): value is DesignLensId {
  if (!value) return false;
  return (DESIGN_LENS_ORDER as string[]).includes(value);
}

const COMING_SOON_HELP = (
  <>
    Use the cards below the console until this lens ships. Live progress on
    epic <code>#1263</code>.
  </>
);

export interface CourseDesignConsoleProps {
  courseId: string;
}

export function CourseDesignConsole({
  courseId,
}: CourseDesignConsoleProps): React.ReactElement {
  const { view, setView } = useConsoleView<DesignLensId>({
    isValidId: isDesignLensId,
    defaultId: DEFAULT_LENS,
    paramName: "design_view",
    consoleId: "course-design",
  });

  return (
    <ConsoleShell<DesignLensId, LensProps>
      lensOrder={DESIGN_LENS_ORDER}
      lenses={DESIGN_LENSES}
      lensProps={{ courseId }}
      activeLensId={view}
      onLensChange={setView}
      ariaNavLabel="Course design lenses"
      idPrefix="hf-course-design"
      comingSoonHelpText={COMING_SOON_HELP}
    />
  );
}
