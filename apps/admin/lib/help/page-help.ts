/**
 * Page-scoped help registry. Each route declares its title, about copy,
 * tab explanations, and chord bindings here. The Help Overlay (#686),
 * chord engine (#688), tab hover-tooltips (#689), and DATA-mode AI
 * assistant catalogue (#812) all read from this single source.
 *
 * Letter mapping rule for chord `keys`:
 *   - First letter of the tab label is preferred
 *   - On collision, pick the next memorable letter (not next-alphabet)
 *   - Settings is always `T` (mnemonic: tuning)
 *   - Avoid prefixes `H` and `G` for second-letter assignments
 *
 * Collision note: Course detail uses `O` for Goals (gOals, because G is a
 * chord prefix), which would collide with Overview=`O` on Learner detail —
 * but they live on different routes so no runtime conflict. Document any
 * future cross-page collision in the page's entry comment.
 *
 * Freshness rule (#810):
 *   When shipping a new tab OR a new named section (a `<CollapsibleCard>`
 *   on a tabbed page) on any route covered by this registry, add the entry
 *   here in the SAME PR. Felt Progress (#779/#780/#784/#790/#795 →
 *   epic #808) is the canonical example of what happens when you don't:
 *   the section shipped, the Help modal didn't know, and the AI assistant
 *   answered "I don't see that section" when users asked about it.
 *
 *   `tests/lib/page-help.test.ts` enforces this for the Design tab by
 *   parsing `CourseDesignTab.tsx` and asserting every `<CollapsibleCard
 *   title="X">` has a matching entry in `tabs.find(design).sections[]`.
 *   Mirror the test for new tabbed pages that grow named sections.
 */

export interface PageHelp {
  /** Route pattern. Literal pathname for exact match, RegExp for parameterised routes, or `{ prefix }` for prefix match. */
  match: string | RegExp | { prefix: string };
  /** Shown in the overlay header. */
  title: string;
  /** 1–3 sentences. What this page is for. */
  about: string;
  /** Optional tour id from lib/tours/tour-definitions.ts. */
  tourId?: string;
  /** Per-tab explanations. Omit for pages with no tabs. */
  tabs?: TabHelp[];
  /** Page-scoped chords. The chord engine prepends H or G. */
  chords?: ChordBinding[];
}

export interface TabHelp {
  /** Stable id; matches the tab system on the page (URL ?tab=, useState, pathname). */
  id: string;
  /** Human-readable label as it appears in the tab strip. */
  label: string;
  /** What's in this tab. */
  about: string;
  /** Optional secondary line. */
  whenToUse?: string;
  /** When true, hide from VIEWER/STUDENT/TESTER (only show to OPERATOR+). */
  requiresOperator?: boolean;
  /**
   * Named sections inside the tab — usually `<CollapsibleCard title="X">`
   * blocks. Populated only when the tab grows non-trivial sub-features the
   * AI assistant and Help modal need to know about. The freshness test
   * (#810) parses the source TSX and fails CI if a new card ships without
   * a matching entry here.
   */
  sections?: SectionHelp[];
}

export interface SectionHelp {
  /**
   * MUST match the `<CollapsibleCard title="...">` string in the source
   * exactly — the freshness test compares titles by exact equality.
   */
  title: string;
  /** 1–2 sentences. What this section is for in plain English. */
  about: string;
}

export interface ChordBinding {
  /** Single letter A–Z. Capital. */
  keys: string;
  action: "navigate" | "callback";
  /** Required when action === "navigate". */
  href?: string;
  /** Required when action === "callback". Convention: "tab:<id>" → setActiveTab(id). The chord engine (#688) resolves callbacks via per-page registration. */
  callbackId?: string;
  /** Shown in the overlay's "Shortcuts — on this page" section. */
  label: string;
  /** When true, hide from VIEWER/STUDENT/TESTER (only show to OPERATOR+). */
  requiresOperator?: boolean;
}

/**
 * Registry. Add new pages here. Keep entries grouped by domain.
 */
export const PAGE_HELP_REGISTRY: readonly PageHelp[] = [
  // ── Wizard ───────────────────────────────────────────────────────────
  {
    match: "/x/get-started-v5",
    title: "Build Course",
    about:
      "Conversational wizard for designing a course. The AI interviews you about your audience, content, and goals, then composes the spec the rest of the system runs on. You can leave and resume — progress is saved at each turn.",
    tourId: "educator-tour",
    // V5 is conversational, not tabbed — no tabs array. Page actions only.
    chords: [
      { keys: "C", action: "navigate", href: "/x/courses", label: "Exit to Courses" },
    ],
  },

  // ── Courses ──────────────────────────────────────────────────────────
  {
    match: "/x/courses",
    title: "Courses",
    about:
      "All courses in this institution. Each course bundles a content set, a journey design, and the learners enrolled in it.",
    chords: [
      { keys: "N", action: "navigate", href: "/x/courses/new", label: "New course" },
      { keys: "W", action: "navigate", href: "/x/get-started-v5", label: "Open wizard (Build Course)" },
    ],
  },
  {
    // Match /x/courses/{id} only — exclude /x/courses/{new,create,v3} so
    // those routes fall through to the placeholder rather than misclaim
    // "Course detail" help.
    match: /^\/x\/courses\/(?!new(?:\/|$)|create(?:\/|$)|v3(?:\/|$))[^/]+/,
    title: "Course detail",
    about:
      "Everything about one course: the content that drives sessions, the design of the journey, the curriculum's module structure, the learners enrolled, the proof points teachers track, and the goals callers work toward.",
    tabs: [
      {
        id: "teaching",
        label: "Teaching",
        about:
          "How the tutor behaves on every call — style, visuals, stall handling, in-call feedback.",
        whenToUse:
          "When you want to retune how the AI tutor sounds and acts across every call (not just one moment).",
      },
      {
        id: "scoring",
        label: "Scoring",
        about:
          "Math + sequencing — banding, EMA, cadence, max calls per day.",
        whenToUse:
          "When you want to adjust how scores are computed, banded, or paced between calls.",
      },
      {
        id: "modules",
        label: "Modules",
        about:
          "Per-module settings for structured courses — cue cards, prep timers, completion gates.",
        whenToUse:
          "When you want to retune a specific module's behaviour without affecting the rest of the course.",
      },
      {
        id: "intelligence",
        label: "Content",
        about: "Source files and the extracted assertions that drive what the AI teaches.",
        whenToUse: "When you want to add new material or check what the AI has actually learned from your uploads.",
      },
      {
        id: "design",
        label: "Design",
        about: "Welcome flow, session flow, Progress Signals acknowledgements, first-session behaviour, tolerances, and skill banding — the shape of how a learner experiences the course. Tolerances cover the mastery threshold (how high a learner has to score before the AI moves on), retrieval cadence (how often the AI fires recall questions), and memory decay scale (how fast prior-call memories fade).",
        whenToUse: "When you want to change how sessions begin, what's acknowledged mid-call, how Call 1 behaves differently from later calls, who the course is for, or how strict the AI is about mastery before advancing.",
        sections: [
          {
            title: "Session Flow",
            about: "Canonical session-flow editor — before / during / after phases, intake, NPS, welcome. Absorbed from the retired Session Flow tab.",
          },
          {
            title: "Progress Signals",
            about: "Mid-call acknowledgement cues + structured offboarding summary. Lets the AI say 'here's what we covered today' before hanging up so learners feel forward motion. Internally referred to as the Felt Progress epic (#779, #780, #784, #790, #795).",
          },
          {
            title: "Call 1 / First Session",
            about: "First-session-only behaviour: firstCallMode preset, behaviour-target overrides for the opening call, and a course-ref preview of what the AI will say.",
          },
          {
            title: "Tolerances",
            about: "Course-default Mastery Threshold (how high a learner scores before the AI advances), Retrieval Cadence Override (how often recall questions fire), and Memory Decay Scale (how fast prior-call memories fade). The per-learner Mastery Threshold override lives in PromptTunerSidebar on the caller page.",
          },
          {
            title: "Skill Banding",
            about: "Per-course tier-mapping override for skill scoring. Lets a course use a stricter or gentler banding curve than the system default.",
          },
        ],
      },
      {
        id: "curriculum",
        label: "Curriculum",
        about: "Module and learning-objective structure. Reorder, add, or rewrite modules and their LOs.",
        whenToUse: "When you want to change the order learners progress through, or rename a module.",
      },
      {
        id: "learners",
        label: "Learners",
        about: "Enrolled learners, invitations, and per-learner progress at a glance.",
        whenToUse: "When you want to invite, remove, or pick a specific learner to drill into.",
      },
      {
        id: "proof",
        label: "Proof Points",
        about: "Evidence the AI gathers about whether learners are mastering the material — call-by-call scoring across modules.",
        whenToUse: "When you want to see cohort-level mastery trends or spot stuck learners.",
      },
      {
        id: "goals",
        label: "Goals",
        about: "The goals the course is steering callers toward and how progress is measured.",
        whenToUse: "When you want to retune what the AI is trying to achieve with each caller.",
      },
      {
        id: "skills",
        label: "Skills",
        about: "Skills Framework Inspector (beta) — the structural rubric your course measures learners against. Each row is a Skill; each cell is a Tier in that skill's scheme; the educator's target tier carries a ★ marker. Cold→hot colours and glyphs are consistent with the Cohort heatmap and the per-learner Attainment view.",
        whenToUse: "When you want to inspect the rubric the AI tutor scores against, see how each tier is described, and (later) drill into who in the cohort has reached which tier.",
        requiresOperator: true,
      },
      {
        id: "voice",
        label: "Voice",
        about: "TTS engine, voice ID, transcriber, silence timeout, max duration, and other per-course voice overrides. Cascades from System → Provider → Domain → Course.",
        whenToUse: "When you want a different voice for this course, or you need to tighten cost caps, silence timeouts, or recording behaviour for a specific cohort.",
        requiresOperator: true,
      },
      {
        id: "settings",
        label: "Settings",
        about: "Scheduling, AI model selection, soft-delete, and other course-level configuration.",
        whenToUse: "When you need to change the schedule, swap the AI model, or archive the course.",
        requiresOperator: true,
      },
    ],
    chords: [
      { keys: "C", action: "callback", callbackId: "tab:intelligence", label: "Content tab" },
      { keys: "D", action: "callback", callbackId: "tab:design", label: "Design tab" },
      { keys: "U", action: "callback", callbackId: "tab:curriculum", label: "Curriculum tab (cUrriculum)" },
      { keys: "E", action: "callback", callbackId: "tab:learners", label: "Learners tab (Enrolled)" },
      { keys: "P", action: "callback", callbackId: "tab:proof", label: "Proof Points tab" },
      { keys: "O", action: "callback", callbackId: "tab:goals", label: "Goals tab (gOals — G is reserved as a chord prefix)" },
      { keys: "V", action: "callback", callbackId: "tab:voice", label: "Voice tab", requiresOperator: true },
      { keys: "T", action: "callback", callbackId: "tab:settings", label: "Settings tab", requiresOperator: true },
    ],
  },

  // ── Learners ─────────────────────────────────────────────────────────
  {
    match: "/x/callers",
    title: "Learners",
    about:
      "All learners across all courses in this institution. Each learner has their own memory, journey progress, and call history. Learners are added by inviting them into a specific course.",
    chords: [
      { keys: "C", action: "navigate", href: "/x/courses", label: "Go to Courses (to invite a learner)" },
    ],
  },
  {
    match: /^\/x\/callers\/[^/]+/,
    title: "Learner detail",
    about:
      "Everything about one learner: a 30-second overview, recent calls and prompts, tuning overrides, progress + scores, uplift proof points, the session flow, profile memories + traits, and a live AI call surface.",
    tabs: [
      {
        id: "overview-v2",
        label: "Overview",
        about: "30-second educator read — At a Glance, Mock Results, Focus areas, Who they are, Recent Calls, Achievements, Trust footer.",
        whenToUse: "When you just want to see how this learner is doing without drilling in. The default landing tab.",
      },
      {
        id: "calls-prompts",
        label: "Calls",
        about: "Every call this learner has had, with the transcript and the composed prompt that was used for each.",
        whenToUse: "When you want to debug why the AI said what it said, or replay a session.",
      },
      {
        id: "tune",
        label: "Tune",
        about: "Per-learner tuning overrides. Two surfaces: (1) the EQ-style sidebar with behaviour-target dials (warmth, challenge, etc.), an Approach picker (style/audience/mode), and a per-learner mastery threshold slider; (2) the Cmd+K Tuning chat for guided nudges. Saves at learner scope only affect this caller; saves at course scope cascade to everyone enrolled.",
        whenToUse: "When this learner needs something different from the cohort default — slower pace, gentler tone, a lower or higher mastery bar before advancing.",
      },
      {
        id: "progress-v2",
        label: "Progress",
        about: "Operating console with a left-hand menu — Overview, Parameters, Adaptation, Modules, Goals, Topics, Exam readiness, Plan, Trajectory. Active lens lives in ?view=.",
        whenToUse: "When you want to drill into scores, goals, module mastery, exam readiness or the session plan.",
      },
      {
        id: "attainment",
        label: "Attainment",
        about: "Unified per-learner attainment view across skill EMA bands, LO mastery, module mastery, and goal progress — same cold→hot colours and glyphs as the cohort heatmap. Click any skill row to see the most recent evidence the AI tutor cited.",
        whenToUse: "When you want a single coherent answer to 'where is this learner right now?' across all four mastery stores. STUDENT-visible for own data.",
      },
      {
        id: "adaptations",
        label: "Adaptations",
        about: "Per-learner change log — what the engine adapted (CallerTarget overrides vs playbook default), why (REWARD-stage rationale + Goal evidence trail), and what the next call's adaptation will be (goalAdaptationGuidance LOW/MID/HIGH preview). OPERATOR+ only — the change log is operator-private, not learner-facing.",
        whenToUse: "When you want to audit what the engine has done for this learner since enrolment, or preview what it will adapt next call.",
      },
      {
        id: "uplift-v2",
        label: "Uplift",
        about: "Learner proof report — Hero rings, How we adapted (EQ), Skill chart + radar, Module heatmap, Goals achieved, Score trends, Topics covered, Engagement. Printable.",
        whenToUse: "When you want concrete evidence of progress (or stagnation) to share with the learner.",
      },
      {
        id: "session-flow",
        label: "Session Flow",
        about: "Per-session flow for this learner — what the AI will lead with, mid-call signals, end-of-call wrap.",
        whenToUse: "When you want to inspect or tune the flow this learner will see in their next session.",
      },
      {
        id: "how",
        label: "Profile",
        about: "Memories, traits, personality, and the template-variable slugs (`{scores.X}`, `{memories.X}`) the AI sees when composing the prompt.",
        whenToUse: "When you want to see what the AI thinks it knows about the learner, or correct a wrong memory.",
      },
      {
        id: "ai-call",
        label: "Call",
        about: "Live AI call surface — start a session with this learner's exact prompt and persona right from this page.",
        whenToUse: "When you want to see what the learner sees, or test a tuning change end-to-end.",
      },
    ],
    // Chord prefix is H (or G for global). Unique second letter per visible
    // tab — first-letter where free, mnemonic where collided:
    //   O Overview · C Calls · T Tune · P Progress · U Uplift ·
    //   S Session Flow · R pRofile · A cAll
    chords: [
      { keys: "O", action: "callback", callbackId: "tab:overview-v2", label: "Overview tab" },
      { keys: "C", action: "callback", callbackId: "tab:calls-prompts", label: "Calls tab" },
      { keys: "T", action: "callback", callbackId: "tab:tune", label: "Tune tab" },
      { keys: "P", action: "callback", callbackId: "tab:progress-v2", label: "Progress tab" },
      { keys: "U", action: "callback", callbackId: "tab:uplift-v2", label: "Uplift tab" },
      { keys: "S", action: "callback", callbackId: "tab:session-flow", label: "Session Flow tab" },
      { keys: "R", action: "callback", callbackId: "tab:how", label: "Profile tab (pRofile — P is Progress)" },
      { keys: "A", action: "callback", callbackId: "tab:ai-call", label: "Call tab (cAll)" },
    ],
  },

  // ── Help bank ────────────────────────────────────────────────────────
  {
    match: "/x/help/glossary",
    title: "Glossary — Skills, LOs, TPs, Mastery",
    about:
      "Canonical vocabulary across course design, skill measurement, and learner progress. Open this when you're unsure whether a label means Skill vs LO vs Mastery vs Skill Score — every term maps to its DB shape and example. Maintained in `docs/glossary-skills-mastery.md`; this page reflects the current branch.",
    chords: [
      { keys: "C", action: "navigate", href: "/x/courses", label: "Back to Courses" },
    ],
  },
];

/**
 * Global chord bindings — work on every page regardless of which PageHelp
 * matches. The chord engine merges these with the page's `chords` (page
 * wins on key collision, so e.g. on Course detail `H L` still goes to the
 * Learners tab, not the global Learners index).
 *
 * Listed verbatim in the Help Overlay's "Shortcuts — global" block.
 */
export const GLOBAL_CHORDS: readonly ChordBinding[] = [
  { keys: "H", action: "navigate", href: "/x", label: "Home" },
  { keys: "C", action: "navigate", href: "/x/courses", label: "Courses" },
  { keys: "L", action: "navigate", href: "/x/callers", label: "Learners" },
  { keys: "D", action: "navigate", href: "/x/data-dictionary", label: "Data dictionary" },
  { keys: "S", action: "navigate", href: "/x/specs", label: "Specs" },
];

/**
 * Get the chord bindings active on a given path — page-specific bindings
 * win over globals on key collision (e.g. on Course detail `H L` switches
 * to the Learners tab; everywhere else `H L` goes to /x/callers).
 */
export function getEffectiveChords(pathname: string): ChordBinding[] {
  const page = getPageHelp(pathname);
  const pageChords = page?.chords ?? [];
  const pageKeys = new Set(pageChords.map((c) => c.keys.toUpperCase()));
  const merged: ChordBinding[] = [...pageChords];
  for (const g of GLOBAL_CHORDS) {
    if (!pageKeys.has(g.keys.toUpperCase())) {
      merged.push(g);
    }
  }
  return merged;
}

/**
 * Match a pathname against the registry. Exact match wins over prefix
 * match wins over RegExp match.
 */
export function getPageHelp(pathname: string): PageHelp | undefined {
  for (const entry of PAGE_HELP_REGISTRY) {
    if (typeof entry.match === "string" && entry.match === pathname) return entry;
  }
  for (const entry of PAGE_HELP_REGISTRY) {
    if (typeof entry.match === "object" && "prefix" in entry.match) {
      if (pathname.startsWith(entry.match.prefix)) return entry;
    }
  }
  for (const entry of PAGE_HELP_REGISTRY) {
    if (entry.match instanceof RegExp && entry.match.test(pathname)) return entry;
  }
  return undefined;
}

/**
 * Returns true when the role can see operator-only items (tabs / chords
 * with `requiresOperator: true`). Mirrors the runtime check at
 * apps/admin/app/x/courses/[courseId]/page.tsx:158.
 */
export function canSeeOperatorOnly(role: string | undefined | null): boolean {
  if (!role) return false;
  return role === "OPERATOR" || role === "EDUCATOR" || role === "ADMIN" || role === "SUPERADMIN";
}
