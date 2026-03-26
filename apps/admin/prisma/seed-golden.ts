/**
 * Golden Path Seed
 *
 * Creates a clean, realistic dataset for golden path demos:
 *   1. Aardvark Academy (school) — 1 course, 1 class, 4 students
 *   2. Apex Consulting (corporate) — 1 training plan, 1 team, 6 employees
 *   3. Companion (community) — 2 programmes, 1 community, 6 members
 *   4. Bright Path Training (training) — 12 courses, 1 cohort, 8 participants
 *   5. Momentum Coaching (coaching) — 2 coaching plans, 1 group, 6 clients
 *   6. St. Aidan's Community Health (healthcare) — 2 care plans, 1 team, 6 patients
 *   7. City, St George's, University of London (university) — 1 module, 1 seminar group, 6 students
 *
 * ENRICHMENT: ~50% of learners get "lived data" (calls, scores, memories,
 * personality profiles, goals, targets, onboarding). The rest are "new"
 * (enrolled but not yet called). This creates realistic empty vs populated states.
 *
 * Each institution gets an EDUCATOR login (hff2026) so terminology resolves correctly.
 * Additional RBAC demo users: admin@hff.com (ADMIN), viewer@hff.com (VIEWER).
 * All entities tagged with "golden-" externalId prefix for idempotent cleanup.
 *
 * Non-PROD only — refuses to run when NEXT_PUBLIC_APP_ENV=LIVE.
 *
 * Usage:
 *   SEED_PROFILE=golden npx tsx prisma/seed-full.ts --reset
 *   npx tsx prisma/seed-golden.ts          # standalone
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const DEMO_PASSWORD = "hff2026";
const TAG = "golden-";

// ══════════════════════════════════════════════════════════
// DATA DEFINITIONS
// ══════════════════════════════════════════════════════════

interface InstitutionDef {
  slug: string;
  name: string;
  typeSlug: string;
  primaryColor: string;
  secondaryColor: string;
  welcomeMessage: string;
  login: { email: string; name: string };
  domain: DomainDef;
}

interface SubjectDef {
  slug: string;
  name: string;
  description: string;
  teachingProfile?: string;
  teachingOverrides?: Record<string, unknown>;
}

interface DomainDef {
  slug: string;
  name: string;
  description: string;
  kind?: "INSTITUTION" | "COMMUNITY";
  subjects?: SubjectDef[];
  groups?: GroupDef[];
  playbooks: PlaybookDef[];
  cohorts: CohortDef[];
}

interface GroupDef {
  slug: string;
  name: string;
  groupType: "DEPARTMENT" | "YEAR_GROUP" | "DIVISION" | "TRACK" | "CUSTOM";
  styleNotes?: string;
  playbookSlugs?: string[]; // which playbooks belong to this group
}

interface PlaybookDef {
  slug: string;
  name: string;
  description: string;
}

interface CohortDef {
  name: string;
  teacher: { name: string; email: string };
  members: string[]; // learner names
}

/** Collected during institution loop, passed to enrichment */
interface LearnerRecord {
  id: string;
  name: string;
  externalId: string;
  typeSlug: string;
  domainId: string;
  playbookIds: string[];
  isActive: boolean;
}

// ── Persona labels per institution type ──
const PERSONA_LABELS: Record<string, string> = {
  school: "tutor",
  corporate: "coach",
  community: "companion",
  coaching: "executive coach",
  healthcare: "care companion",
  training: "trainer",
  university: "tutor",
};

const INSTITUTIONS: InstitutionDef[] = [
  // ── 1. School ──────────────────────────────────────────
  {
    slug: "aardvark-academy",
    name: "Aardvark Academy",
    typeSlug: "school",
    primaryColor: "#166534",
    secondaryColor: "#ca8a04",
    welcomeMessage: "Welcome to Aardvark Academy! Our AI tutors help every student build confidence and understanding.",
    login: { email: "school@hff.com", name: "Sarah Thompson" },
    domain: {
      slug: "aardvark-academy",
      name: "Aardvark Academy",
      description: "Primary school with focus on literacy and numeracy across Key Stage 2.",
      subjects: [
        { slug: "golden-english-ks2", name: "Year 5 English", description: "Key Stage 2 English — reading comprehension, creative writing, and grammar for Year 5.", teachingProfile: "comprehension-led", teachingOverrides: { teachingFocus: "Teach transferable comprehension techniques — skimming, scanning, inference, PEE paragraphs, question-type recognition. Use the class texts as practice material, not as the goal. Students should leave with a reusable framework for attacking any comprehension question." } },
        { slug: "golden-maths-ks2", name: "Year 5 Mathematics", description: "Key Stage 2 Mathematics — number, fractions, geometry, and problem-solving for Year 5.", teachingProfile: "practice-led" },
      ],
      groups: [
        {
          slug: "english-dept",
          name: "English",
          groupType: "DEPARTMENT",
          styleNotes: "Expressive, discussion-led, creative and analytical thinking. Encourage reading for pleasure.",
          playbookSlugs: [],
        },
        {
          slug: "maths-dept",
          name: "Mathematics",
          groupType: "DEPARTMENT",
          styleNotes: "Logical reasoning, step-by-step problem solving. Use concrete examples before abstract concepts.",
          playbookSlugs: ["golden-year5-maths"],
        },
      ],
      playbooks: [
        { slug: "golden-year5-maths", name: "Year 5 Maths", description: "Number, fractions, geometry, and problem-solving for Year 5 students." },
      ],
      cohorts: [
        {
          name: "Class 5B",
          teacher: { name: "Mr. David Clarke", email: "d.clarke@aardvark.sch.uk" },
          members: ["Aaron Brown", "Aaliyah Martinez", "Aanya Ali", "Aarav O'Connor"],
        },
      ],
    },
  },

  // ── 2. Corporate ───────────────────────────────────────
  {
    slug: "apex-consulting",
    name: "Apex Consulting",
    typeSlug: "corporate",
    primaryColor: "#1e3a5f",
    secondaryColor: "#0d9488",
    welcomeMessage: "Welcome to Apex Consulting's learning platform. Develop your leadership skills with AI-powered coaching.",
    login: { email: "corporate@hff.com", name: "Rachel Foster" },
    domain: {
      slug: "apex-consulting",
      name: "Apex Consulting",
      description: "Professional development and leadership coaching for mid-level managers.",
      subjects: [
        { slug: "golden-leadership-mgmt", name: "Leadership & Management", description: "Professional leadership and management development for senior and mid-level managers.", teachingProfile: "coaching-led" },
      ],
      playbooks: [
        { slug: "golden-leadership", name: "Leadership Essentials", description: "Core leadership principles, vision setting, and team motivation for aspiring managers." },
      ],
      cohorts: [
        {
          name: "Engineering Team",
          teacher: { name: "Rachel Foster", email: "r.foster@apex.co.uk" },
          members: ["Sarah Mitchell", "David Kim", "James Okonkwo", "Lisa Chen", "Marcus Reid", "Tom Eriksson"],
        },
      ],
    },
  },

  // ── 3. Community Hub ───────────────────────────────────
  {
    slug: "companion-hub",
    name: "Companion",
    typeSlug: "community",
    primaryColor: "#6366f1",
    secondaryColor: "#a5b4fc",
    welcomeMessage: "Welcome to Companion — your peer support community for wellbeing and life skills.",
    login: { email: "community@hff.com", name: "Maya Rodriguez" },
    domain: {
      slug: "companion-hub",
      name: "Companion Hub",
      kind: "COMMUNITY" as const,
      description: "A peer-support community for wellbeing and life skills development.",
      subjects: [
        { slug: "golden-wellbeing", name: "Wellbeing & Life Skills", description: "Peer support for emotional wellbeing, resilience, self-care, and practical life skills.", teachingProfile: "discussion-led" },
      ],
      playbooks: [
        { slug: "golden-wellbeing-circle", name: "Wellbeing Circle", description: "Peer support for emotional wellbeing, resilience, and self-care strategies." },
        { slug: "golden-life-skills-lab", name: "Life Skills Lab", description: "Practical skills for daily life — budgeting, cooking, time management, and digital literacy." },
      ],
      cohorts: [
        {
          name: "Founding Members",
          teacher: { name: "Maya Rodriguez", email: "maya@companion.test" },
          members: ["Jordan Lee", "Priya Sharma", "Tyler Brooks", "Amara Osei", "Finn Gallagher", "Lucia Vega"],
        },
      ],
    },
  },

  // ── 4. Training Company ────────────────────────────────
  {
    slug: "bright-path-training",
    name: "Bright Path Training",
    typeSlug: "training",
    primaryColor: "#7c3aed",
    secondaryColor: "#f59e0b",
    welcomeMessage: "Welcome to Bright Path Training! Access our full catalogue of professional development courses.",
    login: { email: "training@hff.com", name: "Hannah Blake" },
    domain: {
      slug: "bright-path-training",
      name: "Bright Path Training",
      description: "Professional development provider offering 12+ courses across leadership, communication, and management skills.",
      subjects: [
        { slug: "golden-prof-development", name: "Professional Development", description: "Broad professional development spanning leadership, communication, and workplace management skills.", teachingProfile: "coaching-led" },
      ],
      groups: [
        {
          slug: "leadership-track",
          name: "Leadership",
          groupType: "TRACK",
          styleNotes: "Encourage self-reflection, use real workplace scenarios, challenge assumptions constructively.",
          playbookSlugs: ["golden-leadership-fund", "golden-team-building", "golden-coaching-ment", "golden-change-mgmt"],
        },
        {
          slug: "communication-track",
          name: "Communication",
          groupType: "TRACK",
          styleNotes: "Model clear communication in every interaction, use active listening techniques, give constructive feedback examples.",
          playbookSlugs: ["golden-comms-mastery", "golden-presentations", "golden-conflict-res", "golden-customer-svc"],
        },
      ],
      playbooks: [
        { slug: "golden-leadership-fund", name: "Leadership Fundamentals", description: "Core leadership principles, vision setting, and team motivation for new and aspiring managers." },
        { slug: "golden-comms-mastery", name: "Communication Mastery", description: "Effective verbal and written communication, active listening, and persuasive presentation skills." },
        { slug: "golden-project-mgmt", name: "Project Management Essentials", description: "Planning, execution, and delivery of projects using agile and traditional methodologies." },
        { slug: "golden-sales-skills", name: "Sales Skills Bootcamp", description: "Consultative selling, objection handling, pipeline management, and closing techniques." },
        { slug: "golden-customer-svc", name: "Customer Service Excellence", description: "Building customer relationships, handling complaints, and delivering exceptional service experiences." },
        { slug: "golden-team-building", name: "Team Building & Collaboration", description: "Cross-functional collaboration, trust building, and high-performance team dynamics." },
        { slug: "golden-time-mgmt", name: "Time Management & Productivity", description: "Prioritisation frameworks, focus techniques, and personal productivity systems." },
        { slug: "golden-conflict-res", name: "Conflict Resolution", description: "Navigating workplace disagreements, mediation skills, and constructive feedback delivery." },
        { slug: "golden-presentations", name: "Presentation Skills", description: "Structuring compelling presentations, storytelling techniques, and confident public speaking." },
        { slug: "golden-coaching-ment", name: "Coaching & Mentoring", description: "Developing others through structured coaching conversations and mentoring relationships." },
        { slug: "golden-change-mgmt", name: "Change Management", description: "Leading organisational change, stakeholder engagement, and overcoming resistance to transformation." },
        { slug: "golden-emotional-int", name: "Emotional Intelligence at Work", description: "Self-awareness, empathy, social skills, and emotional regulation in professional settings." },
      ],
      cohorts: [
        {
          name: "Q1 2026 Cohort",
          teacher: { name: "Hannah Blake", email: "h.blake@brightpath.co.uk" },
          members: ["Tom Eriksson", "Priya Sharma", "Daniel Armstrong", "Fatima Noor", "Chris Palmer", "Yuki Tanaka", "Ben Crawford", "Olivia Hayes"],
        },
      ],
    },
  },

  // ── 5. Coaching Practice ───────────────────────────────
  {
    slug: "momentum-coaching",
    name: "Momentum Coaching Practice",
    typeSlug: "coaching",
    primaryColor: "#0f4c81",
    secondaryColor: "#f97316",
    welcomeMessage: "Welcome to Momentum Coaching. Your journey to professional growth starts with a conversation.",
    login: { email: "coaching@hff.com", name: "Alex Brennan" },
    domain: {
      slug: "momentum-coaching",
      name: "Momentum Coaching Practice",
      description: "Executive and life coaching practice specialising in career transitions, leadership development, and personal growth.",
      subjects: [
        { slug: "golden-exec-coaching", name: "Executive Coaching", description: "Executive and life coaching for career transitions, leadership development, and personal growth.", teachingProfile: "coaching-led" },
      ],
      groups: [
        {
          slug: "exec-track",
          name: "Executive",
          groupType: "TRACK",
          styleNotes: "Direct, outcome-focused. Use powerful questions. Challenge comfortably.",
          playbookSlugs: ["golden-exec-leadership"],
        },
        {
          slug: "career-track",
          name: "Career",
          groupType: "TRACK",
          styleNotes: "Exploratory, values-driven. Help clients articulate what matters most.",
          playbookSlugs: ["golden-career-transitions"],
        },
      ],
      playbooks: [
        { slug: "golden-career-transitions", name: "Career Transitions", description: "Guided coaching for professionals navigating career changes, new roles, and professional identity shifts." },
        { slug: "golden-exec-leadership", name: "Executive Leadership", description: "Senior leadership coaching covering strategic thinking, stakeholder influence, and executive presence." },
      ],
      cohorts: [
        {
          name: "Q1 Clients",
          teacher: { name: "Alex Brennan", email: "alex@momentumcoaching.test" },
          members: ["James Fletcher", "Nadia Okonkwo", "Simon Park", "Rachel Moore", "Daniel Torres", "Ingrid Larsen"],
        },
      ],
    },
  },

  // ── 6. Healthcare ──────────────────────────────────────
  {
    slug: "st-aidans-health",
    name: "St. Aidan's Community Health",
    typeSlug: "healthcare",
    primaryColor: "#065f46",
    secondaryColor: "#7c3aed",
    welcomeMessage: "Welcome to St. Aidan's Community Health programme. We're here to support your wellbeing journey.",
    login: { email: "health@hff.com", name: "Dr. Fatima Malik" },
    domain: {
      slug: "st-aidans-health",
      name: "St. Aidan's Community Health",
      description: "Community health programme supporting patients with chronic condition management, medication adherence, and healthy lifestyle coaching.",
      subjects: [
        { slug: "golden-health-wellbeing", name: "Health & Wellbeing", description: "Community health coaching for chronic condition management, medication adherence, and healthy lifestyle habits.", teachingProfile: "coaching-led" },
      ],
      groups: [
        {
          slug: "chronic-unit",
          name: "Chronic Conditions",
          groupType: "DEPARTMENT",
          styleNotes: "Empathetic, patient-led. Celebrate small wins. Never judge non-adherence.",
          playbookSlugs: ["golden-chronic-mgmt"],
        },
        {
          slug: "lifestyle-unit",
          name: "Lifestyle",
          groupType: "DEPARTMENT",
          styleNotes: "Motivational, practical. Focus on sustainable habits, not perfection.",
          playbookSlugs: ["golden-lifestyle-coaching"],
        },
      ],
      playbooks: [
        { slug: "golden-chronic-mgmt", name: "Chronic Condition Management", description: "Supporting patients to understand and manage long-term conditions including diabetes, hypertension, and COPD." },
        { slug: "golden-lifestyle-coaching", name: "Healthy Lifestyle Coaching", description: "Practical guidance on nutrition, physical activity, sleep hygiene, and stress reduction for better health outcomes." },
      ],
      cohorts: [
        {
          name: "Community Patients",
          teacher: { name: "Dr. Fatima Malik", email: "f.malik@st-aidans.nhs.test" },
          members: ["Patricia Walsh", "Mohammed Akhtar", "Rita Fernandez", "George Osei", "Sandra Kowalski", "Colin Burrows"],
        },
      ],
    },
  },

  // ── 7. University ────────────────────────────────────────
  {
    slug: "city-university",
    name: "City, St George's, University of London",
    typeSlug: "university",
    primaryColor: "#c8102e",
    secondaryColor: "#1d1d1b",
    welcomeMessage: "Welcome to City, St George's — where academic excellence meets AI-powered learning.",
    login: { email: "city@hff.com", name: "Dr. Elena Vasquez" },
    domain: {
      slug: "city-university",
      name: "City, St George's, University of London",
      description: "Psychology department — undergraduate and postgraduate teaching in clinical, cognitive, and developmental psychology.",
      subjects: [
        { slug: "golden-psychology", name: "Psychology", description: "Undergraduate and postgraduate psychology — clinical, cognitive, developmental, and social psychology.", teachingProfile: "comprehension-led" },
      ],
      groups: [
        {
          slug: "psychology-dept",
          name: "Psychology",
          groupType: "DEPARTMENT",
          styleNotes: "Evidence-based, Socratic questioning, encourage critical evaluation of research. Link theory to real-world application.",
          playbookSlugs: ["golden-conflict-psychology"],
        },
      ],
      playbooks: [
        { slug: "golden-conflict-psychology", name: "Conflict Psychology", description: "Theories of interpersonal and intergroup conflict — cognitive biases, escalation dynamics, mediation frameworks, and applied resolution strategies." },
      ],
      cohorts: [
        {
          name: "BSc Psychology Year 2",
          teacher: { name: "Dr. Elena Vasquez", email: "e.vasquez@city.ac.uk" },
          members: ["Amira Hassan", "Jake Morrison", "Chloe Ng", "Ravi Patel", "Sophie Laurent", "Kwame Asante"],
        },
      ],
    },
  },
];

// ── Default onboarding flow phases (inlined from fallback-settings.ts) ──
const DEFAULT_FLOW_PHASES = [
  { phase: "greeting", label: "Greeting & welcome" },
  { phase: "rapport", label: "Build rapport" },
  { phase: "assessment", label: "Quick assessment" },
  { phase: "teaching", label: "Teaching interaction" },
  { phase: "summary", label: "Session summary" },
];

// ══════════════════════════════════════════════════════════
// TRANSCRIPT TEMPLATES (3 per institution type)
// ══════════════════════════════════════════════════════════

const TRANSCRIPTS: Record<string, string[]> = {
  school: [
    `AI: Good morning, {{name}}! Today we're going to work on reading comprehension. I've got a really interesting passage about the rainforest. Ready?\nUser: Yeah, I like animals so that sounds good.\nAI: Perfect! Here's the first paragraph. Read it carefully and tell me what the main idea is.\nUser: It's about how animals in the rainforest depend on each other?\nAI: Exactly right! That's called an ecosystem. Can you find a specific example from the text?\nUser: The bit about the toucan eating berries and then spreading the seeds?\nAI: Brilliant! That's a great example of how animals help plants reproduce. What word in the text describes this relationship?\nUser: Symbiotic?\nAI: Well done! You're really getting the hang of finding key vocabulary in context.`,
    `AI: Hi {{name}}! Let's practise some maths today. We're going to work on fractions. What do you already know about adding fractions?\nUser: You need the same bottom number... the denominator?\nAI: That's right! When the denominators are the same, we can add the numerators. What about when they're different?\nUser: I think you have to make them the same first? Like find a common number?\nAI: Spot on! Let's try this: what's 1/3 + 1/4?\nUser: Um... 12 is a common number for both. So... 4/12 + 3/12 = 7/12?\nAI: That's perfect! You found the lowest common denominator and converted both fractions correctly. How are you feeling about that?\nUser: Actually quite good! It makes more sense when you explain it step by step.`,
    `AI: Welcome back, {{name}}! Today we're going to do some creative writing. I'd like you to write the opening paragraph of a story set in space. What ideas come to mind?\nUser: Maybe something about an astronaut who finds a strange signal?\nAI: Ooh, I love that idea! Think about your senses — what would the astronaut see, hear, and feel? That'll make your opening really vivid.\nUser: The lights on the dashboard are flickering and there's a low humming sound that wasn't there before?\nAI: That's fantastic sensory detail! Now turn that into a sentence. Remember, strong openings often start with action.\nUser: "Captain Reyes gripped the armrest as the dashboard lights flickered red, and a low hum filled the cockpit."\nAI: What a brilliant opening sentence! You've created tension immediately. The reader wants to know what happens next.`,
  ],
  corporate: [
    `AI: Good morning, {{name}}. Last session we talked about delegation. How has it been going this week?\nUser: I tried delegating the quarterly report to Sarah, but I ended up checking on it three times.\nAI: That's actually progress — you delegated it. The checking is natural at first. What were you worried about?\nUser: Honestly? That it wouldn't be up to my standard.\nAI: And what happened when you saw Sarah's work?\nUser: It was different from how I'd do it, but actually caught some things I might have missed.\nAI: That's a powerful insight. Different doesn't mean worse. What would you do differently next time?\nUser: Maybe set clearer expectations upfront instead of hovering.\nAI: Excellent. Clear expectations plus trust — that's the delegation sweet spot. Let's practise that framework.`,
    `AI: {{name}}, today let's focus on giving feedback to your team. Tell me about a recent situation where you needed to give difficult feedback.\nUser: One of my direct reports keeps missing deadlines. I've been avoiding the conversation.\nAI: What's holding you back from having it?\nUser: I don't want to demotivate them. They're talented but disorganised.\nAI: That concern shows good emotional intelligence. Let's use the SBI framework — Situation, Behaviour, Impact. Can you describe the situation?\nUser: Last Tuesday, the client deck was due and it arrived two hours late.\nAI: Good. Now the behaviour — what specifically did they do or not do?\nUser: They didn't flag that they were running behind. I only found out when the client asked.\nAI: And the impact?\nUser: We looked unprepared and I had to apologise to the client.\nAI: Perfect. Now you have a clear, non-judgmental framework. Would you like to role-play the conversation?`,
    `AI: Welcome back, {{name}}. Today's topic is stakeholder management. Who are your key stakeholders right now?\nUser: My boss, the product team, and the VP of Sales who keeps asking for features.\nAI: Let's map their priorities. What does each one care about most?\nUser: My boss wants delivery on time. Product wants quality. Sales wants everything yesterday.\nAI: Classic tension triangle. When these priorities conflict, how do you decide?\nUser: Usually whoever shouts loudest gets attention. I know that's not great.\nAI: At least you're honest about it! A stakeholder matrix can help — influence vs. interest. Where would you place the VP of Sales?\nUser: High influence, high interest. So I need to manage them closely.\nAI: Exactly. And what's one thing you could do this week to build that relationship proactively?`,
  ],
  community: [
    `AI: Hey {{name}}, welcome back. How have things been since we last spoke?\nUser: Up and down, honestly. Work's been really stressful.\nAI: I'm sorry to hear that. What's been the hardest part?\nUser: Just feeling like I can never switch off. Even at home I'm thinking about work.\nAI: That boundary between work and home is one of the hardest things to manage. What does "switching off" look like for you ideally?\nUser: Being able to sit with my family without checking emails.\nAI: That's a really clear picture. Have you tried any strategies for that?\nUser: I tried leaving my phone in another room but kept going to get it.\nAI: The pull is strong! What if we set a smaller goal first — like 30 minutes phone-free after dinner?\nUser: That actually sounds doable.`,
    `AI: Hi {{name}}! Today we're going to talk about budgeting — one of the most practical life skills there is. How do you currently manage your money?\nUser: Not very well, to be honest. I kind of just spend until it runs out.\nAI: No judgement at all — that's more common than you'd think. Do you know roughly how much you spend each month?\nUser: Maybe £1,500? I'm not sure.\nAI: Let's find out. The first step is tracking for just one week. Write down every single thing you spend. Sound manageable?\nUser: Yeah, I can do a week.\nAI: Great. When you have that data, we can spot patterns together. Most people are surprised by what they find.\nUser: I bet it's takeaways for me.\nAI: Ha! Well, let's find out. No assumptions — just data. We'll review it next time.`,
    `AI: {{name}}, last time you mentioned wanting to feel more confident in social situations. How has that been?\nUser: I went to that community event like we discussed. It was terrifying.\nAI: But you went! That takes courage. What happened?\nUser: I stood by the drinks table for about ten minutes. Then someone came and talked to me about the music.\nAI: And how was that conversation?\nUser: Actually okay. We talked for about twenty minutes about bands we like.\nAI: That's wonderful. You didn't have to force it — it happened naturally. What did you learn from that?\nUser: Maybe I don't need to approach people. I just need to be somewhere approachable.\nAI: That's a really wise observation. Being present and open is its own kind of confidence.`,
  ],
  training: [
    `AI: Welcome, {{name}}! Today's session is on presentation skills. Have you given many presentations at work?\nUser: A few, but I always get really nervous and rush through my slides.\nAI: Nerves are completely normal — even experienced presenters get them. Let's work on pacing first. What happens when you rush?\nUser: I forget things and the audience looks confused.\nAI: Right. Here's a technique: the power pause. After each key point, stop for three seconds. It feels like forever, but the audience processes the information.\nUser: Three seconds? That sounds like a long time.\nAI: It does, doesn't it? Let's practise. Tell me your opening line for your next presentation.\nUser: "Today I'm going to walk you through our Q1 results and what they mean for our strategy."\nAI: Good content. Now say it again, and pause for three seconds after "Q1 results".\nUser: "Today I'm going to walk you through our Q1 results... and what they mean for our strategy."\nAI: Did you feel the difference? That pause added weight to what came next.`,
    `AI: {{name}}, today we're covering conflict resolution. Think of a recent workplace disagreement you observed or were part of.\nUser: Two of my colleagues disagreed about how to handle a client complaint. It got quite heated.\nAI: What was the core issue underneath the argument?\nUser: I think one wanted to keep the client happy at all costs, and the other wanted to stick to policy.\nAI: Classic values conflict — flexibility vs. consistency. Both are valid. When you see that, what could you do as a mediator?\nUser: Ask each person to explain their reasoning?\nAI: That's a great start. The key is to separate the person from the position. Make them feel heard before problem-solving. What question could you ask?\nUser: "Help me understand why this approach matters to you?"\nAI: Perfect. That question invites explanation without judgement. You'd be a natural mediator.`,
    `AI: Hi {{name}}! Ready for today's session on time management?\nUser: Definitely. I feel like I'm always busy but never actually getting the important things done.\nAI: That's the urgency trap — urgent tasks crowd out important ones. Do you know the Eisenhower Matrix?\nUser: The four-quadrant thing? Urgent vs. important?\nAI: That's the one. Let's apply it. What's on your to-do list today?\nUser: Reply to emails, prepare the board report, fix a bug in the dashboard, and have a 1:1 with my junior.\nAI: Great list. Which of those is important but not urgent?\nUser: The board report. It's due Friday but I keep putting it off.\nAI: Classic quadrant 2. And what's urgent but not important?\nUser: Probably the emails. They feel urgent but most can wait.\nAI: So if you blocked two hours this morning for the board report — no emails — how would that change your day?\nUser: I'd actually feel like I accomplished something meaningful.`,
  ],
  coaching: [
    `AI: {{name}}, welcome back. Last time we set your 90-day goal around the new role. How has the first week been?\nUser: Harder than I expected. The stakeholder dynamics are more political than my last company.\nAI: That's a really common pattern in senior transitions. Tell me more — what's the specific dynamic catching you off guard?\nUser: My peer in Product seems to want to own the roadmap entirely. I feel like I'm being sidelined before I've even started.\nAI: And what do you want from this situation ideally?\nUser: Collaborative ownership. I don't want the territory — I want the outcomes.\nAI: That's a powerful reframe. What would it look like to make your first move from that position?\nUser: Invite her to co-present the Q2 strategy rather than competing for it.\nAI: I love that. What's the earliest you could make that happen?\nUser: I could suggest it at tomorrow's planning meeting.`,
    `AI: {{name}}, today I want to explore something deeper. You mentioned feeling stuck — like you're successful on paper but unfulfilled. What does that look like day to day?\nUser: I get through my work, hit my targets, but at the end of the day I feel... empty?\nAI: When was the last time you felt genuinely energised by your work?\nUser: Honestly? About three years ago, when I was leading that community project.\nAI: What was different about it?\nUser: I was building something that mattered. It wasn't just about the numbers.\nAI: So purpose and impact are core drivers for you. That's important self-knowledge. How does your current role connect to those values?\nUser: It doesn't, really. It's all optimisation and cost-cutting.\nAI: If you could redesign your role to include more of what energises you — even 20% — what would that look like?\nUser: Maybe I could lead our new sustainability initiative. Nobody's picked it up yet.`,
    `AI: Good to see you, {{name}}. What would make today's session most useful?\nUser: I need to work on my confidence. I've been offered a board presentation slot and I'm terrified.\nAI: Terrified how? What's the worst-case scenario in your mind?\nUser: That they'll ask a question I can't answer and I'll look incompetent.\nAI: Has that happened before — being asked something you couldn't answer?\nUser: Sure, plenty of times.\nAI: And what happened? Were you fired? Laughed at?\nUser: No... I usually said I'd follow up and then sent the answer later.\nAI: So your track record is 100% recovery. That's not incompetence — that's professionalism. What would it feel like to trust that pattern?\nUser: I guess... I'd be less worried about being perfect and more focused on being useful.\nAI: "Less perfect, more useful." Can we make that your mantra for the presentation?`,
  ],
  healthcare: [
    `AI: Hello {{name}}, how are you feeling today? Let's check in on how things have been going with your blood pressure management.\nUser: Not great, to be honest. I keep forgetting to take my tablets in the morning.\nAI: That's really common — you're not alone in that. What's your morning routine like?\nUser: I get up, make tea, read the news, then rush out to work.\nAI: What if we linked the tablet to something you already do? Like right next to the kettle?\nUser: I never thought of that. Put the tablets by the tea bags?\nAI: Exactly — it's called habit stacking. You attach the new habit to one you already have. Would you be willing to try that this week?\nUser: Yeah, that sounds simple enough.\nAI: Perfect. And no pressure if you forget a day — just pick it up again. How has the low-salt diet been going?`,
    `AI: {{name}}, welcome back. Today I'd like to talk about physical activity. Last time you mentioned wanting to be more active. How has that been?\nUser: I've been walking the dog more, but nothing beyond that.\nAI: Walking the dog counts! How far do you usually go?\nUser: About twenty minutes around the park.\nAI: That's great — the NHS recommends 150 minutes of moderate activity per week. Twenty minutes five times a week gets you to 100. You're two-thirds of the way there already.\nUser: Really? I thought it had to be the gym or running.\nAI: Not at all. Brisk walking is one of the best things you can do. Would you be open to making one of those walks a little longer — say thirty minutes?\nUser: I could do that on weekends when I'm not rushing.\nAI: Perfect plan. And how's your energy been? Sometimes people notice they sleep better once they're more active.`,
    `AI: Hi {{name}}. How has your week been with the diabetes management plan we discussed?\nUser: Mixed. I've been good with checking my blood sugar but the diet part is hard.\nAI: Let's focus on what's going well first — regular monitoring is a huge achievement. What made that easier?\nUser: The alarm on my phone. I just do it when it goes off.\nAI: Brilliant. Now, what's the hardest part of the dietary changes?\nUser: Evenings. After dinner I always want something sweet.\nAI: That craving is really normal, especially while your body adjusts. What sweet things do you currently reach for?\nUser: Biscuits, mostly. Or chocolate.\nAI: What if we found a swap rather than cutting it out entirely? Some people find berries with a spoon of yoghurt hits the spot.\nUser: I do like raspberries actually.\nAI: That's a great option — low sugar, high fibre. Would you be willing to try raspberries and yoghurt for three evenings this week and see how it feels?`,
  ],
  university: [
    `AI: Hi {{name}}, welcome to your tutorial. Today we're looking at cognitive biases in conflict situations. Have you done the reading on Kahneman and Tversky?\nUser: Yeah, the prospect theory paper. I found it quite dense though.\nAI: It is dense — that's normal. Let's break it down. What's the core insight about how people evaluate losses versus gains?\nUser: That losses feel about twice as bad as equivalent gains feel good?\nAI: Exactly — loss aversion. Now, how might that play out in a conflict between two people negotiating?\nUser: If one side frames something as a loss, the other side would fight harder to avoid it than they'd fight to get an equivalent gain?\nAI: That's a really sharp application. Can you think of a real-world example?\nUser: Maybe in divorce mediation? If you frame keeping the house as avoiding a loss rather than making a gain...\nAI: Brilliant. You've just identified one of the key tools in conflict resolution — reframing. That's exactly how mediators use this research.`,
    `AI: {{name}}, let's pick up where we left off on intergroup conflict. Last week we covered Sherif's Robbers Cave experiment. What was the key finding?\nUser: That competition for resources creates hostility between groups, even when the groups are basically identical.\nAI: Good. And how did they reduce the hostility?\nUser: Superordinate goals — tasks that needed both groups to cooperate.\nAI: Right. Now here's the critical thinking question: what are the limitations of that study?\nUser: It was all boys, same age, same background. And it was the 1950s.\nAI: Those are valid methodological critiques. What about ecological validity?\nUser: I suppose real conflicts aren't created in a week at a summer camp. There's history, power imbalances, identity...\nAI: Excellent. You're moving from description to evaluation — that's the jump from a 2:1 to a first-class answer. What theory addresses those deeper structural factors?\nUser: Social identity theory? Tajfel?\nAI: Exactly. Let's connect those two frameworks.`,
    `AI: Welcome back, {{name}}. Today's topic is de-escalation strategies. Before we get into the theory, tell me about a conflict you've observed recently.\nUser: My flatmates had a massive argument about cleaning. It escalated really quickly.\nAI: Perfect example. Walk me through the escalation — what happened step by step?\nUser: One person made a passive-aggressive comment about dishes. The other got defensive. Then it became about who does more around the flat.\nAI: You've just described the classic escalation spiral from Pruitt and Rubin. Notice how it shifted from a specific issue to a broader grievance?\nUser: Yeah, suddenly it wasn't about dishes anymore.\nAI: That's called "issue expansion" — one of the key escalation mechanisms. What could have interrupted the spiral early on?\nUser: If the first person had stated the issue directly instead of being passive-aggressive?\nAI: That maps to what Deutsch calls "constructive confrontation." Direct, specific, and focused on behaviour rather than character. How would you phrase it?\nUser: Something like "the dishes from last night are still there — could you do them today?"\nAI: Perfect. Specific, present-tense, actionable. That's de-escalation in practice.`,
  ],
};

// ══════════════════════════════════════════════════════════
// ENRICHMENT DATA TEMPLATES
// ══════════════════════════════════════════════════════════

/** Memory templates per institution type */
const MEMORY_TEMPLATES: Record<string, Array<{ category: "FACT" | "PREFERENCE" | "TOPIC" | "CONTEXT"; key: string; valueFn: (name: string) => string }>> = {
  school: [
    { category: "FACT", key: "year_group", valueFn: () => "Year 5" },
    { category: "FACT", key: "school", valueFn: () => "Aardvark Academy" },
    { category: "PREFERENCE", key: "learning_style", valueFn: (n) => `${n} prefers visual explanations with diagrams` },
    { category: "PREFERENCE", key: "pace", valueFn: () => "Likes time to think before answering" },
    { category: "TOPIC", key: "current_focus", valueFn: () => "Reading comprehension and inference skills" },
    { category: "TOPIC", key: "strength", valueFn: (n) => `${n} is strong at creative writing` },
  ],
  corporate: [
    { category: "FACT", key: "role", valueFn: () => "Senior Manager, Engineering" },
    { category: "FACT", key: "experience", valueFn: () => "8 years in leadership roles" },
    { category: "PREFERENCE", key: "coaching_style", valueFn: () => "Prefers data-driven frameworks and measurable outcomes" },
    { category: "PREFERENCE", key: "feedback", valueFn: () => "Responds well to direct, specific feedback" },
    { category: "TOPIC", key: "current_focus", valueFn: () => "Delegation and team empowerment" },
  ],
  community: [
    { category: "FACT", key: "background", valueFn: () => "Working professional, lives alone" },
    { category: "FACT", key: "joined", valueFn: () => "Founding member since January 2026" },
    { category: "PREFERENCE", key: "approach", valueFn: () => "Prefers reflective, non-directive conversations" },
    { category: "TOPIC", key: "focus", valueFn: () => "Work-life balance and stress management" },
    { category: "TOPIC", key: "interest", valueFn: (n) => `${n} wants to build confidence in social situations` },
  ],
  training: [
    { category: "FACT", key: "role", valueFn: () => "Team Lead, Operations" },
    { category: "FACT", key: "enrolled_courses", valueFn: () => "Leadership Fundamentals + Communication Mastery" },
    { category: "PREFERENCE", key: "learning_style", valueFn: () => "Learns best through role-play and practice" },
    { category: "PREFERENCE", key: "schedule", valueFn: () => "Prefers morning sessions, 25-minute maximum" },
    { category: "TOPIC", key: "focus", valueFn: () => "Presentation skills and giving feedback" },
  ],
  coaching: [
    { category: "FACT", key: "role", valueFn: () => "VP Engineering, recently promoted" },
    { category: "FACT", key: "goal", valueFn: () => "Successful transition into senior leadership" },
    { category: "PREFERENCE", key: "coaching_style", valueFn: () => "Responds to powerful questions over advice" },
    { category: "PREFERENCE", key: "values", valueFn: (n) => `${n} values authenticity and collaboration over hierarchy` },
    { category: "TOPIC", key: "focus", valueFn: () => "Stakeholder management and executive presence" },
  ],
  healthcare: [
    { category: "FACT", key: "condition", valueFn: () => "Type 2 diabetes, diagnosed 2023" },
    { category: "FACT", key: "medication", valueFn: () => "Metformin 500mg twice daily" },
    { category: "PREFERENCE", key: "approach", valueFn: () => "Prefers practical, small-step goals" },
    { category: "PREFERENCE", key: "motivation", valueFn: (n) => `${n} is motivated by family — wants to stay active for grandchildren` },
    { category: "TOPIC", key: "focus", valueFn: () => "Blood sugar management and dietary changes" },
  ],
  university: [
    { category: "FACT", key: "programme", valueFn: () => "BSc Psychology, Year 2" },
    { category: "FACT", key: "background", valueFn: () => "Strong A-level results, first-generation university student" },
    { category: "PREFERENCE", key: "learning_style", valueFn: () => "Prefers connecting theory to real-world examples" },
    { category: "PREFERENCE", key: "assessment", valueFn: (n) => `${n} finds essay structure challenging but excels at critical evaluation` },
    { category: "TOPIC", key: "focus", valueFn: () => "Conflict psychology and cognitive biases" },
  ],
};

/** Goal templates per institution type */
const GOAL_TEMPLATES: Record<string, Array<{ name: string; description: string }>> = {
  school: [
    { name: "Reading Comprehension Mastery", description: "Achieve confident, independent inference and deduction from age-appropriate texts." },
    { name: "Maths Confidence", description: "Build fluency with fractions, decimals, and problem-solving strategies." },
  ],
  corporate: [
    { name: "Delegation Excellence", description: "Successfully delegate key deliverables with clear expectations and trust." },
    { name: "Stakeholder Communication", description: "Build effective relationships with cross-functional stakeholders." },
  ],
  community: [
    { name: "Wellbeing Habits", description: "Establish consistent self-care routines for stress management and emotional resilience." },
    { name: "Social Confidence", description: "Feel comfortable initiating conversations in community settings." },
  ],
  training: [
    { name: "Presentation Confidence", description: "Deliver clear, engaging presentations with effective pacing and audience awareness." },
    { name: "Conflict Resolution Skills", description: "Navigate disagreements constructively using structured mediation frameworks." },
  ],
  coaching: [
    { name: "Leadership Transition", description: "Successfully establish credibility and influence in the new senior role within 90 days." },
    { name: "Work-Life Integration", description: "Create sustainable boundaries that protect personal energy and family time." },
  ],
  healthcare: [
    { name: "Medication Adherence", description: "Take prescribed medication consistently using habit-stacking strategies." },
    { name: "Active Lifestyle", description: "Achieve 150 minutes of moderate physical activity per week through enjoyable activities." },
  ],
  university: [
    { name: "Critical Evaluation", description: "Consistently evaluate research methodology and theoretical claims at first-class level." },
    { name: "Essay Argumentation", description: "Structure coherent, evidence-based arguments linking theory to applied examples." },
  ],
};

// ══════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════

export async function main(externalPrisma?: PrismaClient, opts?: { skipCleanup?: boolean }): Promise<void> {
  // PROD guard
  const env = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV;
  if (env === "LIVE" || env === "production") {
    console.log("  ⛔ Skipping golden seed — PROD environment detected");
    return;
  }

  const prisma = externalPrisma || new PrismaClient();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log("\n  🌟 Seeding Golden Path data...\n");

  // ── 1. Cleanup existing golden data (FK-safe order) ────
  // Skip when running as part of a larger seed (e.g. full profile) to avoid
  // wiping data created by earlier steps.
  if (!opts?.skipCleanup) {
    await cleanup(prisma);
  }

  // ── 2. Create institutions, domains, playbooks, cohorts ─
  let totalPlaybooks = 0;
  let totalGroups = 0;
  let totalCohorts = 0;
  let totalTeachers = 0;
  let totalLearners = 0;
  let totalSubjects = 0;
  const allLearners: LearnerRecord[] = [];

  for (const inst of INSTITUTIONS) {
    console.log(`  ── ${inst.name} (${inst.typeSlug}) ──`);

    // Find institution type
    const instType = await prisma.institutionType.findUnique({
      where: { slug: inst.typeSlug },
    });
    if (!instType) {
      console.warn(`  ⚠ Institution type "${inst.typeSlug}" not found — skipping`);
      continue;
    }

    // Create institution
    const institution = await prisma.institution.upsert({
      where: { slug: inst.slug },
      update: {
        name: inst.name,
        typeId: instType.id,
        primaryColor: inst.primaryColor,
        secondaryColor: inst.secondaryColor,
        welcomeMessage: inst.welcomeMessage,
      },
      create: {
        name: inst.name,
        slug: inst.slug,
        typeId: instType.id,
        primaryColor: inst.primaryColor,
        secondaryColor: inst.secondaryColor,
        welcomeMessage: inst.welcomeMessage,
      },
    });
    console.log(`    + Institution: ${institution.name}`);

    // Create domain
    const domain = await prisma.domain.upsert({
      where: { slug: inst.domain.slug },
      update: {
        name: inst.domain.name,
        description: inst.domain.description,
        institutionId: institution.id,
        isActive: true,
        ...(inst.domain.kind ? { kind: inst.domain.kind } : {}),
      },
      create: {
        slug: inst.domain.slug,
        name: inst.domain.name,
        description: inst.domain.description,
        isActive: true,
        institutionId: institution.id,
        ...(inst.domain.kind ? { kind: inst.domain.kind } : {}),
      },
    });
    console.log(`    + Domain: ${domain.name}`);

    // Create Subjects + SubjectDomain links
    if (inst.domain.subjects && inst.domain.subjects.length > 0) {
      for (const subjectDef of inst.domain.subjects) {
        const subject = await prisma.subject.upsert({
          where: { slug: subjectDef.slug },
          update: { name: subjectDef.name, description: subjectDef.description, isActive: true, teachingProfile: subjectDef.teachingProfile ?? null, ...(subjectDef.teachingOverrides ? { teachingOverrides: subjectDef.teachingOverrides as any } : {}) },
          create: {
            slug: subjectDef.slug,
            name: subjectDef.name,
            description: subjectDef.description,
            defaultTrustLevel: "EXPERT_CURATED",
            isActive: true,
            teachingProfile: subjectDef.teachingProfile ?? null,
            ...(subjectDef.teachingOverrides ? { teachingOverrides: subjectDef.teachingOverrides as any } : {}),
          },
        });
        await prisma.subjectDomain.upsert({
          where: { subjectId_domainId: { subjectId: subject.id, domainId: domain.id } },
          update: {},
          create: { subjectId: subject.id, domainId: domain.id },
        });
        totalSubjects++;
        console.log(`      + Subject: ${subject.name}`);
      }
    }

    // Create PlaybookGroups (departments/tracks)
    const playbookSlugToGroupId = new Map<string, string>();

    if (inst.domain.groups) {
      for (let g = 0; g < inst.domain.groups.length; g++) {
        const groupDef = inst.domain.groups[g];
        const group = await prisma.playbookGroup.upsert({
          where: {
            domainId_slug: { domainId: domain.id, slug: groupDef.slug },
          },
          update: {
            name: groupDef.name,
            groupType: groupDef.groupType,
            identityOverride: groupDef.styleNotes
              ? { toneSliders: {}, styleNotes: groupDef.styleNotes }
              : undefined,
            sortOrder: g,
            isActive: true,
          },
          create: {
            domainId: domain.id,
            slug: groupDef.slug,
            name: groupDef.name,
            groupType: groupDef.groupType,
            identityOverride: groupDef.styleNotes
              ? { toneSliders: {}, styleNotes: groupDef.styleNotes }
              : undefined,
            sortOrder: g,
            isActive: true,
          },
        });
        for (const pbSlug of groupDef.playbookSlugs || []) {
          playbookSlugToGroupId.set(pbSlug, group.id);
        }
        console.log(`    + Group: ${group.name} (${groupDef.groupType})`);
        totalGroups++;
      }
    }

    // Create identity spec — use type-appropriate archetype
    const archetypeSlug = instType.defaultArchetypeSlug || "TUT-001";
    const personaLabel = PERSONA_LABELS[inst.typeSlug] || "tutor";
    const identitySlug = `${domain.slug}-identity`;

    const identitySpec = await prisma.analysisSpec.upsert({
      where: { slug: identitySlug },
      update: {
        name: `${domain.name} Identity`,
        extendsAgent: archetypeSlug,
        isActive: true,
      },
      create: {
        slug: identitySlug,
        name: `${domain.name} Identity`,
        description: `Domain overlay for ${domain.name} — extends the base ${personaLabel} archetype.`,
        outputType: "COMPOSE",
        specRole: "IDENTITY",
        specType: "DOMAIN",
        domain: "identity",
        scope: "DOMAIN",
        isActive: true,
        isDirty: false,
        isDeletable: true,
        extendsAgent: archetypeSlug,
        config: {
          parameters: [
            {
              id: "tutor_role",
              name: "Domain Role Override",
              section: "identity",
              config: {
                roleStatement: `You are a friendly, patient ${personaLabel} specializing in ${domain.name}. You adapt to each learner's pace and style while maintaining high standards for understanding.`,
                primaryGoal: `Help learners build genuine understanding of ${domain.name}`,
              },
            },
          ],
        },
        triggers: {
          create: [
            {
              given: `A ${domain.name} session`,
              when: "The system needs to establish agent identity and tone",
              then: `A consistent, domain-appropriate ${personaLabel} personality is presented`,
              name: "Identity establishment",
              sortOrder: 0,
            },
          ],
        },
      },
    });

    // All system specs enabled EXCEPT unused archetype identities
    const systemSpecs = await prisma.analysisSpec.findMany({
      where: { specType: "SYSTEM", isActive: true },
      select: { id: true, slug: true, specRole: true },
    });
    const disabledIds = new Set<string>(
      systemSpecs
        .filter((s) => s.specRole === "IDENTITY" && s.slug !== archetypeSlug)
        .map((s) => s.id)
    );
    const systemSpecToggles: Record<string, { isEnabled: boolean }> = {};
    for (const ss of systemSpecs) {
      systemSpecToggles[ss.id] = { isEnabled: !disabledIds.has(ss.id) };
    }

    // Create playbooks (idempotent — reuse existing by name+domain)
    const playbooks: Array<{ id: string; name: string }> = [];

    for (let i = 0; i < inst.domain.playbooks.length; i++) {
      const pbDef = inst.domain.playbooks[i];

      let playbook = await prisma.playbook.findFirst({
        where: { domainId: domain.id, name: pbDef.name },
      });

      if (!playbook) {
        playbook = await prisma.playbook.create({
          data: {
            name: pbDef.name,
            description: pbDef.description,
            domainId: domain.id,
            groupId: playbookSlugToGroupId.get(pbDef.slug) || undefined,
            status: "PUBLISHED",
            version: "1.0",
            publishedAt: new Date(),
            validationPassed: true,
            measureSpecCount: 0,
            learnSpecCount: 0,
            adaptSpecCount: 0,
            parameterCount: 0,
            config: { systemSpecToggles },
          },
        });

        // Link identity spec to playbook (only for new playbooks)
        await prisma.playbookItem.create({
          data: {
            playbookId: playbook.id,
            itemType: "SPEC",
            specId: identitySpec.id,
            sortOrder: 0,
            isEnabled: true,
          },
        });

        console.log(`    + Playbook: ${playbook.name} (created)`);
      } else {
        console.log(`    = Playbook: ${playbook.name} (exists)`);
      }

      playbooks.push({ id: playbook.id, name: playbook.name });
    }
    totalPlaybooks += playbooks.length;

    // Configure onboarding on domain
    await prisma.domain.update({
      where: { id: domain.id },
      data: {
        onboardingIdentitySpecId: identitySpec.id,
        onboardingFlowPhases: DEFAULT_FLOW_PHASES,
      },
    });

    // Create cohorts, teachers, and learners
    let learnerIndex = 0;
    for (const cohortDef of inst.domain.cohorts) {
      // Create teacher caller first (needed as cohort owner)
      const teacherExternalId = `${TAG}teacher-${inst.slug}-${slugify(cohortDef.name)}`;
      const teacherCaller = await prisma.caller.upsert({
        where: { externalId: teacherExternalId },
        update: {
          name: cohortDef.teacher.name,
          email: cohortDef.teacher.email,
          role: "TEACHER",
          domainId: domain.id,
        },
        create: {
          name: cohortDef.teacher.name,
          email: cohortDef.teacher.email,
          externalId: teacherExternalId,
          role: "TEACHER",
          domainId: domain.id,
        },
      });
      totalTeachers++;

      // Create cohort group (upsert by name + domainId)
      let cohort = await prisma.cohortGroup.findFirst({
        where: { name: cohortDef.name, domainId: domain.id },
      });
      if (!cohort) {
        cohort = await prisma.cohortGroup.create({
          data: {
            name: cohortDef.name,
            domainId: domain.id,
            ownerId: teacherCaller.id,
            institutionId: institution.id,
            maxMembers: 50,
            isActive: true,
          },
        });
      }
      console.log(`    + Cohort: ${cohort.name} (${cohortDef.members.length} members)`);
      totalCohorts++;

      // Create learner callers
      for (const memberName of cohortDef.members) {
        const learnerExternalId = `${TAG}learner-${inst.slug}-${slugify(memberName)}`;
        const learner = await prisma.caller.upsert({
          where: { externalId: learnerExternalId },
          update: {
            name: memberName,
            role: "LEARNER",
            domainId: domain.id,
            cohortGroupId: cohort.id,
          },
          create: {
            name: memberName,
            externalId: learnerExternalId,
            role: "LEARNER",
            domainId: domain.id,
            cohortGroupId: cohort.id,
          },
        });
        totalLearners++;

        // Multi-cohort membership (join table)
        await prisma.callerCohortMembership.upsert({
          where: {
            callerId_cohortGroupId: {
              callerId: learner.id,
              cohortGroupId: cohort.id,
            },
          },
          update: {},
          create: {
            callerId: learner.id,
            cohortGroupId: cohort.id,
            role: "MEMBER",
          },
        });

        // Enroll in all playbooks for this domain
        for (const pb of playbooks) {
          await prisma.callerPlaybook.upsert({
            where: { callerId_playbookId: { callerId: learner.id, playbookId: pb.id } },
            update: { status: "ACTIVE" },
            create: {
              callerId: learner.id,
              playbookId: pb.id,
              status: "ACTIVE",
              enrolledBy: "golden-seed",
            },
          });
        }

        // Collect for enrichment — even index = active
        allLearners.push({
          id: learner.id,
          name: memberName,
          externalId: learner.externalId || "",
          typeSlug: inst.typeSlug,
          domainId: domain.id,
          playbookIds: playbooks.map((p) => p.id),
          isActive: learnerIndex % 2 === 0,
        });
        learnerIndex++;
      }

      // Link cohort to playbooks
      for (const pb of playbooks) {
        await prisma.cohortPlaybook.upsert({
          where: { cohortGroupId_playbookId: { cohortGroupId: cohort.id, playbookId: pb.id } },
          update: {},
          create: {
            cohortGroupId: cohort.id,
            playbookId: pb.id,
            assignedBy: "golden-seed",
          },
        });
      }
    }

    // Create EDUCATOR login for this institution
    await prisma.user.upsert({
      where: { email: inst.login.email },
      update: {
        name: inst.login.name,
        passwordHash,
        role: "EDUCATOR",
        isActive: true,
        institutionId: institution.id,
      },
      create: {
        email: inst.login.email,
        name: inst.login.name,
        passwordHash,
        role: "EDUCATOR",
        isActive: true,
        institutionId: institution.id,
      },
    });
    console.log(`    + Login: ${inst.login.email}`);
    console.log("");
  }

  // ── 3. Create RBAC demo users (not institution-scoped) ─
  await prisma.user.upsert({
    where: { email: "admin@hff.com" },
    update: { name: "Admin User", role: "ADMIN", passwordHash, isActive: true },
    create: { email: "admin@hff.com", name: "Admin User", role: "ADMIN", passwordHash, isActive: true },
  });
  console.log("  + RBAC: admin@hff.com (ADMIN)");

  await prisma.user.upsert({
    where: { email: "viewer@hff.com" },
    update: { name: "Demo Viewer", role: "VIEWER", passwordHash, isActive: true },
    create: { email: "viewer@hff.com", name: "Demo Viewer", role: "VIEWER", passwordHash, isActive: true },
  });
  console.log("  + RBAC: viewer@hff.com (VIEWER)");

  // ── Link SUPERADMIN to City University ──────────────────
  // SUPERADMIN needs institutionId so get-started-v5 loads with full context
  // (wizard greeting, domain, Reset Demo button). The cleanup step clears this
  // on every seed run so we always restore it here.
  const cityUni = await prisma.institution.findUnique({
    where: { slug: "city-university" },
    select: { id: true },
  });
  if (cityUni) {
    await prisma.user.updateMany({
      where: { role: "SUPERADMIN" },
      data: { institutionId: cityUni.id },
    });
    console.log("  + SUPERADMIN linked to City University (for demo flow)");
  }
  console.log("");

  // ── 4. Enrich learners with lived data ─────────────────
  console.log("  ── Enriching learners with lived data ──\n");
  const stats = await enrichLearners(prisma, allLearners);

  // ── Summary ────────────────────────────────────────────
  console.log("  ─────────────────────────────────────────────");
  console.log(`  ✓ Golden Path seed complete`);
  console.log(`    Institutions:    ${INSTITUTIONS.length}`);
  console.log(`    Domains:         ${INSTITUTIONS.length}`);
  console.log(`    Subjects:        ${totalSubjects}`);
  console.log(`    Groups:          ${totalGroups}`);
  console.log(`    Playbooks:       ${totalPlaybooks}`);
  console.log(`    Cohorts:         ${totalCohorts}`);
  console.log(`    Teachers:        ${totalTeachers}`);
  console.log(`    Learners:        ${totalLearners} (${stats.activeLearners} active, ${totalLearners - stats.activeLearners} new)`);
  console.log(`    Calls:           ${stats.calls}`);
  console.log(`    Call scores:     ${stats.scores}`);
  console.log(`    Memories:        ${stats.memories}`);
  console.log(`    Personalities:   ${stats.personalities}`);
  console.log(`    Goals:           ${stats.goals}`);
  console.log(`    Targets:         ${stats.targets}`);
  console.log(`    Onboarding:      ${stats.onboarding}`);
  console.log(`    Logins:          ${INSTITUTIONS.length + 2} (${INSTITUTIONS.length} EDUCATOR + ADMIN + VIEWER)`);
  console.log("");

  if (!externalPrisma) {
    await prisma.$disconnect();
  }
}

// ══════════════════════════════════════════════════════════
// ENRICHMENT
// ══════════════════════════════════════════════════════════

interface EnrichmentStats {
  activeLearners: number;
  calls: number;
  scores: number;
  memories: number;
  personalities: number;
  goals: number;
  targets: number;
  onboarding: number;
}

async function enrichLearners(
  prisma: PrismaClient,
  learners: LearnerRecord[]
): Promise<EnrichmentStats> {
  const stats: EnrichmentStats = {
    activeLearners: 0,
    calls: 0,
    scores: 0,
    memories: 0,
    personalities: 0,
    goals: 0,
    targets: 0,
    onboarding: 0,
  };

  // Look up real parameter IDs from the DB (FK-safe)
  const allParams = await prisma.parameter.findMany({
    select: { parameterId: true },
    take: 20,
  });
  const paramIds = allParams.map((p) => p.parameterId);
  if (paramIds.length === 0) {
    console.log("    ⚠ No parameters found — skipping scores/targets enrichment");
  }

  for (let i = 0; i < learners.length; i++) {
    const learner = learners[i];

    // Everyone gets goals
    const goalCount = await createGoals(prisma, learner);
    stats.goals += goalCount;

    if (!learner.isActive) continue;

    stats.activeLearners++;

    // Active learners get the full cascade
    const callIds = await createCalls(prisma, learner, i);
    stats.calls += callIds.length;

    if (paramIds.length > 0) {
      const scoreCount = await createScores(prisma, learner.id, callIds, i, paramIds);
      stats.scores += scoreCount;
    }

    const memCount = await createMemories(prisma, learner);
    stats.memories += memCount;

    await createPersonality(prisma, learner.id, i);
    stats.personalities++;

    await createOnboarding(prisma, learner.id, learner.domainId, callIds[0]);
    stats.onboarding++;

    if (paramIds.length > 0) {
      const targetCount = await createTargets(prisma, learner.id, i, paramIds);
      stats.targets += targetCount;
    }
  }

  console.log(`    Enriched ${stats.activeLearners} active learners`);
  return stats;
}

// ── Calls ────────────────────────────────────────────────

async function createCalls(
  prisma: PrismaClient,
  learner: LearnerRecord,
  seed: number
): Promise<string[]> {
  const templates = TRANSCRIPTS[learner.typeSlug] || TRANSCRIPTS.school;
  const callCount = 3 + (seed % 3); // 3-5 calls
  const callIds: string[] = [];

  for (let c = 0; c < callCount; c++) {
    const template = templates[c % templates.length];
    const transcript = template.replace(/\{\{name\}\}/g, learner.name.split(" ")[0]);
    const daysBack = 45 - Math.floor((c / callCount) * 42); // spread over 45 days, most recent ~3 days ago

    const call = await prisma.call.create({
      data: {
        source: "golden-seed",
        externalId: `${TAG}call-${learner.externalId}-${c}`,
        callerId: learner.id,
        transcript,
        callSequence: c + 1,
        createdAt: daysAgo(daysBack),
        endedAt: daysAgo(daysBack, 25), // 25 mins after start
      },
    });
    callIds.push(call.id);
  }

  return callIds;
}

// ── Scores ───────────────────────────────────────────────

async function createScores(
  prisma: PrismaClient,
  callerId: string,
  callIds: string[],
  seed: number,
  paramIds: string[]
): Promise<number> {
  let count = 0;

  for (let c = 0; c < callIds.length; c++) {
    const paramsPerCall = Math.min(2 + (c % 2), paramIds.length); // 2-3 params per call
    const usedParams = new Set<string>();

    for (let p = 0; p < paramsPerCall; p++) {
      const paramIdx = (c * 3 + p + seed) % paramIds.length;
      const parameterId = paramIds[paramIdx];

      // Skip if already used for this call (unique constraint on callId+parameterId)
      if (usedParams.has(parameterId)) continue;
      usedParams.add(parameterId);

      const score = 0.35 + seededFloat(seed + c * 100 + p) * 0.55; // 0.35–0.90

      try {
        await prisma.callScore.create({
          data: {
            callId: callIds[c],
            callerId,
            parameterId,
            score,
            confidence: 0.6 + seededFloat(seed + c + p * 7) * 0.3, // 0.6–0.9
            evidence: [`Observed in session ${c + 1}`],
            reasoning: "Assessed from conversational indicators",
            scoredBy: "golden-seed",
          },
        });
        count++;
      } catch {
        // Skip on unique constraint violation
      }
    }
  }

  return count;
}

// ── Memories ─────────────────────────────────────────────

async function createMemories(
  prisma: PrismaClient,
  learner: LearnerRecord
): Promise<number> {
  const templates = MEMORY_TEMPLATES[learner.typeSlug] || MEMORY_TEMPLATES.school;
  let count = 0;

  for (const tmpl of templates) {
    await prisma.callerMemory.create({
      data: {
        callerId: learner.id,
        category: tmpl.category,
        source: "EXTRACTED",
        key: tmpl.key,
        value: tmpl.valueFn(learner.name.split(" ")[0]),
        confidence: 0.75 + seededFloat(count * 17) * 0.2, // 0.75–0.95
        extractedBy: "golden-seed",
      },
    });
    count++;
  }

  // Create memory summary
  const facts = templates.filter((t) => t.category === "FACT");
  const prefs = templates.filter((t) => t.category === "PREFERENCE");
  const topics = templates.filter((t) => t.category === "TOPIC");
  const firstName = learner.name.split(" ")[0];

  await prisma.callerMemorySummary.upsert({
    where: { callerId: learner.id },
    update: {},
    create: {
      callerId: learner.id,
      factCount: facts.length,
      preferenceCount: prefs.length,
      eventCount: 0,
      topicCount: topics.length,
      keyFacts: facts.map((f) => ({ key: f.key, value: f.valueFn(firstName), confidence: 0.9 })),
      topTopics: topics.map((t) => ({ topic: t.valueFn(firstName), frequency: 3, lastMentioned: new Date().toISOString() })),
      preferences: Object.fromEntries(prefs.map((p) => [p.key, p.valueFn(firstName)])),
      lastMemoryAt: new Date(),
      lastAggregatedAt: new Date(),
    },
  });

  return count;
}

// ── Personality Profile ──────────────────────────────────

async function createPersonality(
  prisma: PrismaClient,
  callerId: string,
  seed: number
): Promise<void> {
  await prisma.callerPersonalityProfile.upsert({
    where: { callerId },
    update: {},
    create: {
      callerId,
      parameterValues: {
        "B5-O": 0.5 + seededFloat(seed * 11) * 0.4,       // 0.50–0.90
        "B5-C": 0.4 + seededFloat(seed * 13) * 0.5,       // 0.40–0.90
        "B5-E": 0.3 + seededFloat(seed * 17) * 0.5,       // 0.30–0.80
        "B5-A": 0.5 + seededFloat(seed * 19) * 0.4,       // 0.50–0.90
        "B5-N": 0.15 + seededFloat(seed * 23) * 0.45,     // 0.15–0.60
        "VARK-VISUAL": 0.3 + seededFloat(seed * 29) * 0.6,
        "VARK-AUDITORY": 0.3 + seededFloat(seed * 31) * 0.6,
        "VARK-READWRITE": 0.3 + seededFloat(seed * 37) * 0.6,
        "VARK-KINESTHETIC": 0.3 + seededFloat(seed * 41) * 0.6,
      },
      callsUsed: 3 + (seed % 3),
      specsUsed: 2,
      lastUpdatedAt: new Date(),
    },
  });
}

// ── Goals ────────────────────────────────────────────────

async function createGoals(
  prisma: PrismaClient,
  learner: LearnerRecord
): Promise<number> {
  const templates = GOAL_TEMPLATES[learner.typeSlug] || GOAL_TEMPLATES.school;
  let count = 0;

  for (let g = 0; g < templates.length; g++) {
    const tmpl = templates[g];
    const progress = learner.isActive
      ? 0.2 + seededFloat(g * 7 + learner.id.charCodeAt(0)) * 0.6 // 0.20–0.80 for active
      : 0; // 0 for new learners

    await prisma.goal.create({
      data: {
        callerId: learner.id,
        type: "LEARN",
        name: tmpl.name,
        description: tmpl.description,
        status: progress >= 0.75 ? "COMPLETED" : "ACTIVE",
        progress,
        priority: g + 1,
        playbookId: learner.playbookIds[g % learner.playbookIds.length] || undefined,
        startedAt: daysAgo(60),
        targetDate: daysFromNow(120),
      },
    });
    count++;
  }

  return count;
}

// ── Onboarding Session ───────────────────────────────────

async function createOnboarding(
  prisma: PrismaClient,
  callerId: string,
  domainId: string,
  firstCallId: string
): Promise<void> {
  await prisma.onboardingSession.upsert({
    where: { callerId_domainId: { callerId, domainId } },
    update: {},
    create: {
      callerId,
      domainId,
      currentPhase: "summary",
      // Schema expects Array of {phase, completedAt, duration}
      completedPhases: DEFAULT_FLOW_PHASES.map((p, i) => ({
        phase: p.phase,
        completedAt: daysAgo(45 - i * 4).toISOString(),
        duration: 180 + i * 30, // seconds
      })),
      isComplete: true,
      wasSkipped: false,
      firstCallId: firstCallId,
      discoveredGoals: 2,
      completedAt: daysAgo(40),
    },
  });
}

// ── Caller Targets ───────────────────────────────────────

async function createTargets(
  prisma: PrismaClient,
  callerId: string,
  seed: number,
  paramIds: string[]
): Promise<number> {
  // Pick up to 3 real parameter IDs for this caller's targets
  const targetCount = Math.min(3, paramIds.length);
  let count = 0;

  for (let t = 0; t < targetCount; t++) {
    const paramIdx = (seed * 7 + t * 13) % paramIds.length;
    const parameterId = paramIds[paramIdx];

    try {
      await prisma.callerTarget.create({
        data: {
          callerId,
          parameterId,
          targetValue: 0.6 + seededFloat(seed * 43 + t) * 0.25, // 0.60–0.85
          callsUsed: 2 + (seed % 3),
          confidence: 0.5 + seededFloat(seed * 47 + t) * 0.4, // 0.50–0.90
          decayHalfLife: 7.0,
          lastUpdatedAt: daysAgo(5),
        },
      });
      count++;
    } catch {
      // Skip on unique constraint violation
    }
  }

  return count;
}

// ══════════════════════════════════════════════════════════
// CLEANUP
// ══════════════════════════════════════════════════════════

async function cleanup(prisma: PrismaClient): Promise<void> {
  // Nuclear cleanup: wipe ALL entity data for golden profile.
  // FK-safe order: leaf tables first, then parents.

  const tables = [
    // Enrichment leaf tables (depend on Call or Caller)
    "callScore",
    "callTarget",
    "behaviorMeasurement",
    "rewardScore",
    "personalityObservation",
    "callerTarget",
    "callerMemorySummary",
    "callerMemory",
    "callerPersonalityProfile",
    "conversationArtifact",
    "callAction",
    "callMessage",
    // onboardingSession BEFORE call — firstCallId → Call.id has no onDelete (RESTRICT)
    "onboardingSession",
    "call",
    // Enrollment and cohort join tables
    "callerPlaybook",
    "cohortPlaybook",
    "goal",
    // Content tables
    "invite",
    "channelConfig",
    "subjectSource",
    "contentVocabulary",
    "contentQuestion",
    "contentAssertion",
    "contentSource",
    "subjectDomain",
    "subject",
    "mediaAsset",
    "userTask",
    "userPersonality",
  ];

  for (const table of tables) {
    try {
      // @ts-ignore — dynamic table access
      const count = await prisma[table].count();
      if (count > 0) {
        // @ts-ignore
        await prisma[table].deleteMany();
      }
    } catch {
      // Table might not exist in this schema version
    }
  }

  // Delete multi-cohort memberships before disconnecting legacy FK
  await prisma.callerCohortMembership.deleteMany();

  // Disconnect callers from cohort groups before deleting cohorts
  await prisma.caller.updateMany({
    where: { cohortGroupId: { not: null } },
    data: { cohortGroupId: null },
  });

  // Delete all cohort groups
  await prisma.cohortGroup.deleteMany();

  // Clear Call.usedPromptId → ComposedPrompt before deleting composed prompts
  // (circular: ComposedPrompt.callerId → Caller, Call.usedPromptId → ComposedPrompt)
  await prisma.call.updateMany({ where: { usedPromptId: { not: null } }, data: { usedPromptId: null } });
  await prisma.composedPrompt.deleteMany();

  // Delete all callers (seed-clean may have missed some)
  await prisma.caller.deleteMany();

  // Delete all playbook items, then playbooks, then groups
  await prisma.playbookItem.deleteMany();
  await prisma.playbook.deleteMany();
  try { await prisma.playbookGroup.deleteMany(); } catch { /* table may not exist yet */ }

  // Delete domain-scoped identity specs (DOMAIN type)
  await prisma.analysisSpec.deleteMany({
    where: { specType: "DOMAIN" },
  });

  // Delete all domains
  await prisma.domain.deleteMany();

  // Delete non-admin users BEFORE institutions — User.institutionId → Institution.id
  // has no onDelete, so deleting institutions while users reference them would fail.
  await prisma.user.deleteMany({
    where: { role: { not: "SUPERADMIN" } },
  });

  // Clear institutionId on any remaining SUPERADMIN users so institution delete succeeds
  await prisma.user.updateMany({
    where: { institutionId: { not: null } },
    data: { institutionId: null },
  });

  // Delete all institutions
  await prisma.institution.deleteMany();

  console.log("  🧹 Cleaned all entity data (keeping specs + admin users)\n");
}

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Deterministic float 0.0–1.0 from an integer seed */
function seededFloat(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Date N days ago */
function daysAgo(days: number, extraMinutes = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  if (extraMinutes) d.setMinutes(d.getMinutes() + extraMinutes);
  return d;
}

/** Date N days from now */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// Direct execution
if (require.main === module) {
  main().catch((e) => {
    console.error("Golden seed failed:", e);
    process.exit(1);
  });
}
