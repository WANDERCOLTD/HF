/**
 * Page-scoped help registry. Each route declares its title, about copy,
 * tab explanations, and chord bindings here. The Help Overlay (#686),
 * chord engine (#688), and tab hover-tooltips (#689) all read from this
 * single source.
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
        id: "intelligence",
        label: "Content",
        about: "Source files and the extracted assertions that drive what the AI teaches.",
        whenToUse: "When you want to add new material or check what the AI has actually learned from your uploads.",
      },
      {
        id: "design",
        label: "Design",
        about: "Welcome flow, session flow, mid-survey, and audience — the shape of how a learner experiences the course.",
        whenToUse: "When you want to change how sessions begin, what's asked partway through, or who the course is for.",
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
      "Everything about one learner: their journey position, recent calls and prompts, tuning overrides, what the AI knows about them, what they're working on, generated artifacts, and a live AI call surface.",
    tabs: [
      {
        id: "overview",
        label: "Overview",
        about: "At-a-glance summary — uplift, recent activity, and the next session.",
        whenToUse: "When you just want to see how this learner is doing without drilling in.",
      },
      {
        id: "uplift",
        label: "Uplift",
        about: "Score uplift over time — how much this learner has moved across the goals you're tracking.",
        whenToUse: "When you want concrete evidence of progress (or stagnation).",
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
        about: "Per-learner tuning overrides — chat with the AI to nudge how it behaves for this specific learner.",
        whenToUse: "When this learner needs something different from the cohort default (slower pace, gentler tone, etc.).",
      },
      {
        id: "how",
        label: "How",
        about: "Memories, traits, personality, and the slugs the AI uses to refer to this learner.",
        whenToUse: "When you want to see what the AI thinks it knows about the learner, or correct a wrong memory.",
      },
      {
        id: "what",
        label: "What",
        about: "Scores, behaviour history, goal progress, and exam-readiness signal.",
        whenToUse: "When you want to see numbers — current scores, change over time, exam predictions.",
      },
      {
        id: "artifacts",
        label: "Artifacts",
        about: "Generated artifacts — composed prompts, lesson plans, content packs produced for this learner.",
        whenToUse: "When you want to inspect or download something the system generated for this learner.",
      },
      {
        id: "ai-call",
        label: "AI Call",
        about: "Live AI call surface — start a session with this learner's exact prompt and persona right from this page.",
        whenToUse: "When you want to see what the learner sees, or test a tuning change end-to-end.",
      },
    ],
    chords: [
      { keys: "O", action: "callback", callbackId: "tab:overview", label: "Overview tab" },
      { keys: "U", action: "callback", callbackId: "tab:uplift", label: "Uplift tab" },
      { keys: "C", action: "callback", callbackId: "tab:calls-prompts", label: "Calls tab" },
      { keys: "T", action: "callback", callbackId: "tab:tune", label: "Tune tab" },
      { keys: "W", action: "callback", callbackId: "tab:how", label: "How tab (hoW — H is reserved as a chord prefix)" },
      { keys: "A", action: "callback", callbackId: "tab:what", label: "What tab (whAt)" },
      { keys: "R", action: "callback", callbackId: "tab:artifacts", label: "Artifacts tab (aRtifacts)" },
      { keys: "I", action: "callback", callbackId: "tab:ai-call", label: "AI Call tab (aI call)" },
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
