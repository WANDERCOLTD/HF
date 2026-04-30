/**
 * Wizard field hint content — structured contextual help for intent fields.
 *
 * Keyed by <wizard>.<field>. Every wizard intent field MUST have an entry here.
 * Used by <FieldHint> component (Gold UI pattern).
 */

import type { FieldHintContent } from "@/components/shared/FieldHint";

export const WIZARD_HINTS: Record<string, FieldHintContent> = {
  // ── Teach wizard ──────────────────────────────────────

  "teach.institution": {
    why: "Determines which course, content, and AI persona your session uses.",
    effect: "The AI loads all teaching materials and settings linked to this institution.",
    examples: ["Riverside Academy", "CII Training Centre", "My Test School"],
  },

  "teach.goal": {
    why: "Tells the AI what you want to achieve in this session.",
    effect: "The AI tailors its opening, questioning strategy, and success criteria to your goal.",
    examples: [
      "Teach fractions using real-world examples",
      "Revise photosynthesis before the exam",
      "Understand compound interest",
    ],
  },

  "teach.objectives": {
    why: "Specific outcomes you want the student to demonstrate by the end.",
    effect: "The AI checks these during the session and adapts if the student is struggling.",
    examples: [
      "Explain the water cycle in their own words",
      "Solve 3 fraction problems correctly",
      "Compare two historical events",
    ],
  },

  "course.learningStructure": {
    why: "Some courses follow a fixed syllabus; others are open-ended practice where each call should adapt to the learner.",
    effect: "Structured Sessions divides material into a sequenced plan you can review and edit. Continuous Learning puts everything in one programme and lets the system pick what to cover per call based on mastery.",
    examples: [
      "Structured — exam prep, textbook walk-through, cohort courses",
      "Continuous — drill/practice, open-ended tutoring, self-paced mastery",
    ],
  },

  "course.model": {
    why: "Different teaching models structure sessions differently — choosing one shapes how knowledge is sequenced, practiced, and assessed.",
    effect: "The AI distributes teaching points across sessions using the model's phase structure. Direct Instruction gives clear linear progression; 5E encourages exploration before explanation; Spiral revisits topics at increasing depth.",
    examples: [
      "Direct Instruction — maths, languages, sequential skills",
      "5E Inquiry — science, investigation-based topics",
      "Spiral — broad curricula with interconnected topics",
      "Mastery — skills where each step requires the previous",
      "Project-Based — vocational, creative, applied subjects",
    ],
  },

  "teach.content": {
    why: "Source materials give the AI accurate, trusted content to teach from.",
    effect: "The AI extracts teaching points and builds its knowledge base from these files.",
    examples: ["PDF syllabus", "Word lecture notes", "Slide deck", "Textbook chapter"],
  },

  "teach.plan": {
    why: "Controls how your content is broken into teachable sessions.",
    effect: "The AI generates a structured curriculum with learning outcomes per session.",
    examples: ["3 sessions of 30 min", "5 sessions breadth-first", "1 deep-dive session"],
  },

  "teach.persona": {
    why: "The persona matrix lets you fine-tune how your AI behaves along key dimensions.",
    effect: "Adjusts the AI's warmth, directiveness, and other traits — changes take effect on the next call.",
    examples: ["Warmer + less directive for anxious students", "More structured for exam prep"],
  },

  "teach.onboarding": {
    why: "Onboarding controls how the AI introduces itself and gathers initial context.",
    effect: "Sets the welcome message, conversation phases, and what the AI asks in the first call.",
    examples: ["Custom welcome message", "Skip discovery phase", "Add a learning-style check"],
  },

  "teach.promptPreview": {
    why: "Shows the exact system prompt the AI will receive — useful for debugging.",
    effect: "Read-only preview of the composed prompt including persona, content, and memory sections.",
    examples: ["Check that teaching points appear", "Verify persona instructions", "Confirm goals are included"],
  },

  // ── Course Setup wizard ───────────────────────────────

  "course.name": {
    why: "The course name becomes the title students see and the AI references.",
    effect: "Used to create the domain, label all materials, and greet students by course.",
    examples: ["High School Biology 101", "GCSE Maths Revision", "Leadership Essentials"],
  },

  "course.outcomes": {
    why: "Learning outcomes define what success looks like for this course.",
    effect: "The AI designs its curriculum, assessments, and session goals around these outcomes.",
    examples: [
      "Understand photosynthesis",
      "Explain cellular respiration",
      "Design experiments",
    ],
  },

  "course.persona": {
    why: "The persona sets the AI's teaching personality and communication style.",
    effect: "Controls warmth, formality, questioning approach, and how the AI introduces itself.",
    examples: ["Tutor (patient, structured)", "Coach (goal-driven)", "Socratic (questioning)"],
  },

  "course.physicalMaterials": {
    why: "Lets the tutor tell the student which page to open and confirm they're following.",
    effect: "The AI will reference specific pages during sessions and ask the student to confirm they are on the right page.",
    examples: ["CGP KS2 English, pages 12–45", "Edexcel GCSE Maths Revision Guide, Chapter 3"],
  },

  "course.teachingMode": {
    why: "Tells the AI what kind of content to emphasise and how to quiz the learner.",
    effect: "Recall = facts and quizzes. Comprehension = reading and discussion. Practice = worked examples. Syllabus = structured coverage.",
    examples: [
      "History → Recall (dates, events, key people)",
      "English Literature → Comprehension (passages, analysis)",
      "Maths → Practice (worked examples, exercises)",
      "Food Safety → Syllabus (structured coverage)",
    ],
  },

  "course.interactionPattern": {
    why: "Sets how the AI communicates — the relationship style, not just the topic.",
    effect: "Directive → explains and checks. Socratic → questions and provokes. Advisory → cites and scopes. Coaching → goal-focused. Companion → listens without agenda. Facilitation → coordinates and organises. Reflective → explores meaning. Open → follows the caller.",
    examples: [
      "History lesson → Directive",
      "Ethics seminar → Socratic",
      "Compliance training → Advisory",
      "Leadership programme → Coaching",
    ],
  },

  "course.audience": {
    why: "Tells the AI who the learners are — vocabulary, tone, encouragement, and pacing all adapt.",
    effect: "Primary = simple words, enthusiastic praise. Secondary = clear and relatable. Corporate = professional and efficient.",
    examples: [
      "Year 5 Maths → Primary (KS1-2)",
      "GCSE Biology → Secondary (KS3-4)",
      "Compliance training → Professional / Corporate",
      "Community art class → Adult Learner",
    ],
  },

  "course.content": {
    why: "Content gives the AI real subject matter to teach from.",
    effect: "Files are processed into teaching points that form the AI's knowledge base.",
    examples: ["Course pack (multiple files)", "Single PDF", "Text description of topics"],
  },

  "course.duration": {
    why: "Session length affects how deep each lesson can go.",
    effect: "Shorter sessions cover less per call; longer sessions allow deeper exploration.",
    examples: ["15 min (standard)", "30 min (extended)", "45 min (deep dive)"],
  },

  "course.emphasis": {
    why: "Controls whether the AI prioritises breadth or depth of coverage.",
    effect: "Breadth covers all topics at surface level first; depth goes deep before moving on.",
    examples: ["Breadth-first (survey all topics)", "Depth-first (master each)", "Balanced"],
  },

  "course.assessments": {
    why: "Determines whether and how the AI checks student understanding.",
    effect: "Formal adds dedicated assessment sessions; light weaves checks into lessons; none skips.",
    examples: ["Formal (quiz sessions)", "Light (in-lesson checks)", "None"],
  },

  "course.welcome": {
    why: "The welcome message is the first thing students hear when they call.",
    effect: "Sets the tone for the entire learning experience — friendly, professional, or custom.",
    examples: ["Hi! I'm your biology tutor...", "Welcome to Leadership Essentials..."],
  },

  "course.firstCallIntake": {
    why: "Each toggle controls one question the AI asks the learner on Call 1.",
    effect: "Independent — leave defaults on for new educators, switch off only what doesn't fit your course.",
    examples: [
      "Goals + About You on, Knowledge Check off — soft start, no quizzing",
      "All on with MCQ Knowledge Check — formal baseline before teaching",
      "All off — AI dives straight into the curriculum",
    ],
  },

  "course.callFlow": {
    why: "The call flow defines the structure of a student's first lesson.",
    effect: "Each phase guides the AI through a sequence — greeting, orientation, discovery, teaching, and wrap-up.",
    examples: [
      "Welcome (1-2 min) → Orient → Discover → Sample → Close",
      "Reorder phases to change how the AI structures the first call",
      "Remove phases you don't need or add custom ones",
    ],
  },

  "course.behavior": {
    why: "Behaviour tuning refines how your AI persona communicates.",
    effect: "Adjusts warmth, pacing, formality, and other traits within the chosen persona.",
    examples: [
      "\"warm, patient, challenges thinking\"",
      "\"formal and structured\"",
      "\"encouraging, uses humour\"",
    ],
  },

  "course.students": {
    why: "Enrolling students connects them to this course's content and AI tutor.",
    effect: "Students receive access and the AI tracks their individual progress across sessions.",
    examples: ["Add a class group", "Pick individuals", "Invite by email"],
  },

  // ── Institution Setup wizard ─────────────────────

  "institution.name": {
    why: "The institution name appears in the sidebar, status bar, and student join pages.",
    effect: "Sets the identity for all users and AI interactions under this institution.",
    examples: ["Riverside Academy", "CII London", "Greenfield Primary School"],
  },

  "institution.type": {
    why: "Determines how the AI behaves, what terminology is used, and the default teaching style.",
    effect: "School = patient tutor. Corporate = professional coach. Community = supportive companion.",
    examples: ["School", "Corporate", "Community", "Coaching"],
  },

  "institution.website": {
    why: "Auto-imports your school's logo, brand colours, and description — saves setup time.",
    effect: "Pre-fills branding fields from your website's metadata. Works best with well-structured sites.",
    examples: ["https://www.oakwoodprimary.co.uk", "https://training.company.com"],
  },

  "institution.logo": {
    why: "Your logo appears in the sidebar header and student-facing pages.",
    effect: "Replaces the default text with your visual brand mark.",
    examples: ["PNG or SVG URL", "200x200px minimum recommended"],
  },

  "institution.primaryColor": {
    why: "Your primary colour becomes the accent throughout the entire platform.",
    effect: "Buttons, active states, links, and highlights all use this colour.",
    examples: ["#166534 (green)", "#4f46e5 (indigo)", "#dc2626 (red)"],
  },

  "institution.welcome": {
    why: "The welcome message is what students see on their join page.",
    effect: "Sets the first impression for every new student joining this institution.",
    examples: [
      "Welcome to Greenfield Academy! Our AI tutors help every student build confidence.",
      "You're joining CII Training — let's get started.",
    ],
  },

  "institution.terminology": {
    why: "Controls how the platform labels concepts for your users.",
    effect: "Students might see 'Lesson' instead of 'Session', 'Class' instead of 'Cohort'.",
    examples: ["School preset: Student / Class / Teacher", "Corporate preset: Employee / Team / Trainer"],
  },

  // ── Community Setup wizard ────────────────────────

  "community.hubName": {
    why: "The hub name is how members will identify the community — it appears in every call.",
    effect: "The AI introduces itself as part of this hub and references it when orienting new members.",
    examples: ["Riverside Residents", "Over-60s Wellbeing Club", "Building Maintenance Hub"],
  },

  "community.hubDescription": {
    why: "The purpose statement shapes how the AI understands and serves this community.",
    effect: "The AI uses this to set context for every call — it influences tone, topics, and what the AI considers relevant.",
    examples: ["A community for elderly residents who want someone to talk to", "Housing association members with property queries", "Peer support for caregivers"],
  },

  "community.communityKind": {
    why: "Topic-based hubs organise conversations around specific subjects. Open-connection hubs let members talk freely.",
    effect: "Topic-based unlocks topic rows with per-topic AI patterns. Open-connection shows a single hub-level pattern.",
    examples: ["Building Maintenance, Social Events → Topic-based", "Companion calls, peer support → Open connection"],
  },

  "community.topicName": {
    why: "The topic name helps the AI understand what this conversation is about.",
    effect: "The AI uses the name to select the right interaction style and focus its knowledge retrieval.",
    examples: ["Building Maintenance", "Social Events", "Health & Wellbeing", "Financial Guidance"],
  },

  "community.hubPattern": {
    why: "The pattern controls how the AI engages — it's the conversational protocol, not just the topic.",
    effect: "Companion listens without agenda. Advisory answers from the docs. Coaching tracks goals. Socratic asks questions.",
    examples: ["Elderly companion → Just be there", "Maintenance line → Give clear answers", "Support group → Explore and reflect"],
  },

  // ── Onboarding / Domain onboarding ───────────────

  "onboard.welcomeMessage": {
    why: "This is the first thing the AI says to a new caller — it sets the tone for every session.",
    effect: "The AI delivers this message verbatim at the start of the first call before adapting to the caller.",
    examples: [
      "Welcome to your first lesson! I'm here to help you build confidence step by step.",
      "Hi there! I'm your biology tutor — what would you like to work on today?",
      "Hello, I'm ready to support your learning journey. Where would you like to start?",
    ],
  },

  "onboard.aiPersona": {
    why: "The persona controls the AI's voice, personality, and teaching style for this domain.",
    effect: "Different personas have different tones — a tutor explains patiently, a coach pushes for goals, a companion listens.",
    examples: ["TUT-001 (patient tutor)", "COACH-001 (goal-driven coach)", "COMPANION-001 (warm companion)"],
  },

  // ── Get Started wizard ──────────────────────────────

  "get-started.welcome": {
    why: "The welcome message is the first thing students hear — it sets the tone for the entire experience.",
    effect: "The AI delivers this message at the start of the first call before adapting to the learner.",
    examples: [
      "Welcome! I'm here to help you learn at your own pace.",
      "Hi there — let's get started on your biology journey!",
    ],
  },

  "get-started.sessions": {
    why: "More sessions means more time to cover your content in depth.",
    effect: "The AI distributes teaching points across this many sessions, adjusting depth per session.",
    examples: ["3 for a short revision course", "8 for a full module", "12 for a term-long programme"],
  },

  "get-started.duration": {
    why: "Session length affects how deep each lesson can go.",
    effect: "Shorter sessions cover less per call; longer sessions allow deeper exploration and practice.",
    examples: ["15 min (quick check-in)", "30 min (standard lesson)", "60 min (deep dive)"],
  },

  "get-started.planEmphasis": {
    why: "Controls whether the AI prioritises covering all topics or going deep on fewer.",
    effect: "Breadth covers all topics at surface level; depth goes deep before moving on; balanced mixes both.",
    examples: ["Breadth for revision courses", "Depth for mastery-focused modules", "Balanced for general teaching"],
  },

  "get-started.discipline": {
    why: "Helps the AI understand the subject area and tailor its approach.",
    effect: "Influences how the AI structures content, selects vocabulary, and aligns with domain conventions.",
    examples: ["Biology", "Food Safety", "English Literature", "Mathematics"],
  },

  "get-started.emphasis": {
    why: "Tells the AI what kind of content to emphasise and how to quiz the learner.",
    effect: "Recall = facts and quizzes. Comprehension = reading and discussion. Practice = worked examples. Syllabus = structured coverage.",
    examples: [
      "History → Recall (dates, events, key people)",
      "English Literature → Comprehension (passages, analysis)",
      "Maths → Practice (worked examples, exercises)",
    ],
  },

  "get-started.model": {
    why: "Different teaching models structure sessions differently — choosing one shapes how knowledge is sequenced.",
    effect: "Direct Instruction gives clear linear progression; 5E encourages exploration; Spiral revisits topics at increasing depth.",
    examples: [
      "Direct Instruction — maths, languages",
      "5E Inquiry — science, investigation-based",
      "Spiral — broad curricula with interconnected topics",
    ],
  },

  "get-started.tune": {
    why: "The personality sliders let you fine-tune how the AI communicates.",
    effect: "Adjusts warmth, directiveness, pace, and encouragement — changes take effect on the next call.",
    examples: ["Warmer + less directive for anxious students", "More structured for exam prep"],
  },
};
