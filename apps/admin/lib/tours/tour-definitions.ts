/**
 * Tour Definitions
 *
 * Static tour content per user role. Each tour is 4-7 steps
 * covering the key features available to that role.
 *
 * Steps reference sidebar items by manifest ID (not href) so that
 * tours automatically follow sidebar changes.
 *
 * After the tour completes, a "What's Next?" card shows role-specific
 * action suggestions with glowing UI.
 */

export interface TourStep {
  id: string;
  title: string;
  description: string;
  /** Stable manifest item ID — resolved to href at runtime via manifest-resolver */
  manifestItem?: string;
  /** CSS selector for non-sidebar elements */
  elementSelector?: string;
  placement?: "top" | "bottom" | "left" | "right" | "center";
  /** Navigate to this page before showing the step */
  navigateTo?: string;
  nextLabel?: string;
}

export interface TourAction {
  label: string;
  description: string;
  icon: string;
  /** Navigate to this page when clicked */
  href?: string;
  /** If true, opens the AI assistant (Cmd+K) instead of navigating */
  openAssistant?: boolean;
}

export interface TourDefinition {
  id: string;
  role: string;
  name: string;
  icon: string;
  steps: TourStep[];
  /** Role-specific actions shown in the "What's Next?" card after tour completes */
  actions: TourAction[];
}

export const TOUR_DEFINITIONS: TourDefinition[] = [
  // ── ADMIN / SUPERADMIN ────────────────────────────────────────────
  {
    id: "admin-tour",
    role: "ADMIN",
    name: "Admin Tour",
    icon: "Shield",
    steps: [
      {
        id: "admin-welcome",
        title: "Welcome to HumanFirst",
        description: "This is your command centre. Let's walk through the key areas you'll use every day.",
        elementSelector: "[data-tour='welcome']",
        placement: "center",
      },
      {
        id: "admin-callers",
        title: "Callers",
        description: "Callers are the people your AI speaks with. View profiles, call history, and learning progress here.",
        manifestItem: "manage-callers",
      },
      {
        id: "admin-domains",
        title: "Domains",
        description: "Domains define what your AI teaches. Each domain has its own curriculum, subjects, and identity.",
        manifestItem: "domains",
      },
      {
        id: "admin-playbooks",
        title: "Subjects",
        description: "Subjects bundle specs and templates together. Publish a subject to activate it for a domain.",
        manifestItem: "playbooks",
      },
      {
        id: "admin-subjects",
        title: "Subjects",
        description: "Subjects hold teaching content. Upload sources, review assertions, and generate structured curricula.",
        manifestItem: "subjects",
      },
      {
        id: "admin-ai",
        title: "AI Config",
        description: "Fine-tune AI model settings, review errors, and monitor usage costs from here.",
        manifestItem: "ai-config",
      },
      {
        id: "admin-team",
        title: "Team",
        description: "Invite team members, assign roles, and manage access. You can also impersonate lower roles to test their experience.",
        manifestItem: "team",
      },
      {
        id: "admin-ai-assistant",
        title: "Your AI Assistant",
        description: "Press Cmd+K anytime to open your AI assistant. It can query your data, build curricula, update specs, and answer questions about your platform.",
        elementSelector: "button[title='Open AI Assistant (Cmd+K)']",
        placement: "left",
        nextLabel: "Finish",
      },
    ],
    actions: [
      { label: "Build a curriculum", description: "Ask your AI assistant to create teaching content", icon: "BookOpen", openAssistant: true },
      { label: "Explore domains", description: "See what your AI teaches", icon: "Globe", href: "/x/domains" },
      { label: "View callers", description: "See who's been learning", icon: "User", href: "/x/callers" },
      { label: "Invite your team", description: "Add team members and assign roles", icon: "Users", href: "/x/users" },
    ],
  },

  // ── EDUCATOR ──────────────────────────────────────────────────────
  {
    id: "educator-tour",
    role: "EDUCATOR",
    name: "Educator Tour",
    icon: "GraduationCap",
    steps: [
      {
        id: "edu-welcome",
        title: "Welcome to your school",
        description: "This is your school dashboard. Let's walk through the key features for managing your students.",
        elementSelector: "[data-tour='welcome']",
        placement: "center",
      },
      {
        id: "manage-cohorts",
        title: "Classrooms",
        description: "Create classrooms and organise students into learning groups.",
        manifestItem: "manage-cohorts",
      },
      {
        id: "manage-callers",
        title: "Students",
        description: "Track individual student progress, view their calls, and identify who needs attention.",
        manifestItem: "manage-callers",
      },
      {
        id: "edu-try",
        title: "Try It",
        description: "Experience an AI conversation yourself to understand what your students will encounter.",
        manifestItem: "edu-try",
      },
      {
        id: "edu-reports",
        title: "Reports",
        description: "View engagement analytics and performance reports across your classrooms.",
        manifestItem: "edu-reports",
      },
      {
        id: "edu-ai-assistant",
        title: "Your AI Assistant",
        description: "Press Cmd+K anytime to ask questions, get help, or explore your school data.",
        elementSelector: "button[title='Open AI Assistant (Cmd+K)']",
        placement: "left",
        nextLabel: "Finish",
      },
    ],
    actions: [
      { label: "Set up a classroom", description: "Create your first classroom", icon: "School", href: "/x/educator/classrooms" },
      { label: "Try a conversation", description: "Experience what your students will hear", icon: "PlayCircle", href: "/x/educator/try" },
      { label: "View your students", description: "See who's enrolled", icon: "User", href: "/x/educator/students" },
    ],
  },

  // ── STUDENT ───────────────────────────────────────────────────────
  {
    id: "student-tour",
    role: "STUDENT",
    name: "Student Tour",
    icon: "Backpack",
    steps: [
      {
        id: "stu-welcome",
        title: "Welcome!",
        description: "This is your learning hub. Let's take a quick look around.",
        elementSelector: "[data-tour='welcome']",
        placement: "center",
      },
      {
        id: "stu-progress",
        title: "My Progress",
        description: "Track your learning goals and see how your skills are developing over time.",
        manifestItem: "stu-progress",
      },
      {
        id: "stu-calls",
        title: "My Calls",
        description: "View past conversations and see what you learned from each one.",
        manifestItem: "stu-calls",
      },
      {
        id: "stu-stuff",
        title: "My Stuff",
        description: "Find notes, artefacts, and materials from your learning sessions.",
        manifestItem: "stu-stuff",
      },
      {
        id: "stu-teacher",
        title: "My Teacher",
        description: "Connect with your teacher and see class information.",
        manifestItem: "stu-teacher",
        nextLabel: "Finish",
      },
    ],
    actions: [
      { label: "Check my progress", description: "See how your skills are growing", icon: "TrendingUp", href: "/x/student/progress" },
      { label: "View my calls", description: "Revisit past conversations", icon: "Phone", href: "/x/student/calls" },
      { label: "Browse my stuff", description: "Find notes and materials", icon: "Backpack", href: "/x/student/stuff" },
    ],
  },

  // ── TESTER / SUPER_TESTER ─────────────────────────────────────────
  {
    id: "tester-tour",
    role: "TESTER",
    name: "Tester Tour",
    icon: "TestTube",
    steps: [
      {
        id: "test-welcome",
        title: "Welcome",
        description: "This is your testing dashboard. Here's how to run your first test conversation.",
        elementSelector: "[data-tour='welcome']",
        placement: "center",
      },
      {
        id: "test-sim",
        title: "Learn",
        description: "Start a learning session. You'll chat with the AI exactly as a real caller would.",
        manifestItem: "sim",
      },
      {
        id: "test-callers",
        title: "Test Callers",
        description: "View and manage your test caller profiles. Each caller has their own personality and memory.",
        manifestItem: "manage-callers",
      },
      {
        id: "test-analytics",
        title: "Analytics",
        description: "Review test results and performance metrics across domains.",
        manifestItem: "analytics",
      },
      {
        id: "test-ai-assistant",
        title: "Your AI Assistant",
        description: "Press Cmd+K anytime to ask questions about callers, domains, or test results.",
        elementSelector: "button[title='Open AI Assistant (Cmd+K)']",
        placement: "left",
        nextLabel: "Finish",
      },
    ],
    actions: [
      { label: "Start a session", description: "Start learning", icon: "MessageCircle", href: "/x/sim" },
      { label: "View test callers", description: "See caller profiles", icon: "User", href: "/x/callers" },
      { label: "Check analytics", description: "Review test results", icon: "TrendingUp", href: "/x/analytics" },
    ],
  },

  // ── DEMO ──────────────────────────────────────────────────────────
  {
    id: "demo-tour",
    role: "DEMO",
    name: "Demo Tour",
    icon: "Presentation",
    steps: [
      {
        id: "demo-welcome",
        title: "Welcome to HumanFirst",
        description: "Let's show you what adaptive AI conversations look like. This quick tour takes 30 seconds.",
        elementSelector: "[data-tour='welcome']",
        placement: "center",
      },
      {
        id: "demo-ql",
        title: "Community",
        description: "Create a community and start conversations with an AI companion.",
        manifestItem: "quick-launch",
      },
      {
        id: "demo-demos",
        title: "Demos",
        description: "Explore demo scenarios to see different conversation styles and teaching approaches.",
        manifestItem: "demos",
        nextLabel: "Finish",
      },
    ],
    actions: [
      { label: "Community", description: "Create a community now", icon: "Users", href: "/x/quick-launch" },
      { label: "Explore demos", description: "Try different scenarios", icon: "Presentation", href: "/x/demos" },
    ],
  },
];

/** Look up the tour for a given role. Falls back to ADMIN tour for SUPERADMIN. */
export function getTourForRole(role: string): TourDefinition | null {
  if (role === "SUPERADMIN") return TOUR_DEFINITIONS.find(t => t.role === "ADMIN") ?? null;
  if (role === "SUPER_TESTER") return TOUR_DEFINITIONS.find(t => t.role === "TESTER") ?? null;
  if (role === "VIEWER") return TOUR_DEFINITIONS.find(t => t.role === "TESTER") ?? null;
  if (role === "OPERATOR") return TOUR_DEFINITIONS.find(t => t.role === "ADMIN") ?? null;
  return TOUR_DEFINITIONS.find(t => t.role === role) ?? null;
}

// ── Dev-mode validation: check all manifestItem references resolve ──
if (process.env.NODE_ENV === "development") {
  import("./manifest-resolver").then(({ resolveManifestItem }) => {
    for (const tour of TOUR_DEFINITIONS) {
      for (const step of tour.steps) {
        if (step.manifestItem) {
          const resolved = resolveManifestItem(step.manifestItem, tour.role);
          if (!resolved) {
            console.warn(
              `[Tour] "${tour.id}" step "${step.id}" references unknown manifest item "${step.manifestItem}". ` +
              `Check sidebar-manifest.json for the correct id.`,
            );
          }
        }
      }
    }
  });
}
