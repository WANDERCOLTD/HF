/**
 * Demo Course Seed — Introduction to Psychology
 *
 * Creates a single, fully-populated course on the Abacus Academy domain
 * (created by seed-golden.ts). 5 learners at varied stages: completed,
 * in-progress, struggling, and new — so every UI tab looks rich in demos.
 *
 * Includes AI-generated pipeline data from demo-fixtures.json:
 * call scores, memories, personality profiles, composed prompts,
 * reward scores, call targets, and behavior measurements.
 * No pipeline re-runs needed after seeding.
 *
 * Depends on: seed-golden (creates institution + domain), seed-clean (specs)
 * Profiles: full only
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const TAG = "demo-psych-";

// ── Helpers ─────────────────────────────────────────────────

function seededRange(min: number, max: number, seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  return min + (Math.abs(hash) % 10000) / 10000 * (max - min);
}

function seededInt(min: number, max: number, seed: string): number {
  return Math.floor(seededRange(min, max + 0.99, seed));
}

function daysAgo(days: number, extraMinutes = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  if (extraMinutes) d.setMinutes(d.getMinutes() + extraMinutes);
  return d;
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ── Data Definitions ────────────────────────────────────────

const DOMAIN_SLUG = "abacus-academy";

const SUBJECT = {
  slug: `${TAG}intro-psychology`,
  name: "Introduction to Psychology",
  description: "An introductory course covering memory, social influence, attachment, and psychopathology for Year 12 students. AQA-aligned.",
  teachingProfile: "concept-led",
  teachingOverrides: {
    teachingFocus: "Build conceptual understanding through real-world examples and classic experiments. Use Socratic questioning to help students evaluate evidence and form their own conclusions.",
  },
};

const CONTENT_SOURCE = {
  slug: `${TAG}aqa-psych-spec`,
  name: "AQA Psychology AS-Level Teaching Guide",
  description: "Core teaching content for AQA AS-Level Psychology — key theories, research studies, and evaluation points across Memory, Social Influence, Attachment, and Psychopathology.",
  documentType: "TEXTBOOK" as const,
};

const COURSE_REF_SOURCE = {
  slug: `${TAG}intro-psych-course-ref`,
  name: "Introduction to Psychology — Course Reference",
  description: "Tutor configuration for the Intro to Psychology course — teaching approach, session flow, scaffolding techniques, skill framework, and assessment boundaries.",
  documentType: "COURSE_REFERENCE" as const,
};

const CURRICULUM = {
  slug: `${TAG}intro-psychology-curriculum`,
  name: "Introduction to Psychology — Year 12",
  description: "4-module introductory curriculum covering Memory, Social Influence, Attachment, and Psychopathology.",
};

const MODULES = [
  {
    slug: `${TAG}memory`,
    title: "Memory",
    description: "Multi-store model, working memory model, types of long-term memory, and eyewitness testimony.",
    sortOrder: 0,
    estimatedDurationMinutes: 45,
    learningObjectives: [
      { ref: "PSY-MEM-1", description: "Describe and evaluate the multi-store model of memory (Atkinson & Shiffrin)", sortOrder: 0 },
      { ref: "PSY-MEM-2", description: "Explain the working memory model (Baddeley & Hitch) and its components", sortOrder: 1 },
      { ref: "PSY-MEM-3", description: "Distinguish between episodic, semantic, and procedural long-term memory", sortOrder: 2 },
      { ref: "PSY-MEM-4", description: "Evaluate factors affecting eyewitness testimony (Loftus & Palmer)", sortOrder: 3 },
    ],
  },
  {
    slug: `${TAG}social-influence`,
    title: "Social Influence",
    description: "Conformity, obedience, minority influence, and social change.",
    sortOrder: 1,
    estimatedDurationMinutes: 45,
    learningObjectives: [
      { ref: "PSY-SOC-1", description: "Explain types of conformity (compliance, identification, internalisation) and Asch's research", sortOrder: 0 },
      { ref: "PSY-SOC-2", description: "Describe and evaluate Milgram's research on obedience, including situational variables", sortOrder: 1 },
      { ref: "PSY-SOC-3", description: "Explain how minority influence leads to social change (Moscovici)", sortOrder: 2 },
      { ref: "PSY-SOC-4", description: "Apply social influence concepts to real-world examples of social change", sortOrder: 3 },
    ],
  },
  {
    slug: `${TAG}attachment`,
    title: "Attachment",
    description: "Caregiver-infant interaction, Bowlby's theory, and types of attachment.",
    sortOrder: 2,
    estimatedDurationMinutes: 40,
    learningObjectives: [
      { ref: "PSY-ATT-1", description: "Describe caregiver-infant interactions including reciprocity and interactional synchrony", sortOrder: 0 },
      { ref: "PSY-ATT-2", description: "Outline and evaluate Bowlby's monotropic theory of attachment", sortOrder: 1 },
      { ref: "PSY-ATT-3", description: "Explain Ainsworth's types of attachment and the Strange Situation", sortOrder: 2 },
    ],
  },
  {
    slug: `${TAG}psychopathology`,
    title: "Psychopathology",
    description: "Defining abnormality, phobias, depression, and OCD.",
    sortOrder: 3,
    estimatedDurationMinutes: 40,
    learningObjectives: [
      { ref: "PSY-PSP-1", description: "Compare definitions of abnormality: statistical infrequency, deviation from social norms, failure to function, ideal mental health", sortOrder: 0 },
      { ref: "PSY-PSP-2", description: "Describe the behavioural, emotional, and cognitive characteristics of phobias", sortOrder: 1 },
      { ref: "PSY-PSP-3", description: "Explain biological and psychological explanations of depression and OCD", sortOrder: 2 },
    ],
  },
];

const ASSERTIONS = [
  // Memory module
  { assertion: "The multi-store model (Atkinson & Shiffrin, 1968) proposes three separate stores: sensory register, short-term memory, and long-term memory, each with different encoding, capacity, and duration.", category: "concept", chapter: "Memory", section: "Multi-store model", tags: ["memory", "MSM", "Atkinson-Shiffrin"], learningOutcomeRef: "PSY-MEM-1", topicSlug: "multi-store-model" },
  { assertion: "Short-term memory has a capacity of 7±2 items (Miller, 1956), duration of about 18-30 seconds without rehearsal, and primarily uses acoustic encoding.", category: "fact", chapter: "Memory", section: "Multi-store model", tags: ["STM", "capacity", "Miller"], learningOutcomeRef: "PSY-MEM-1", topicSlug: "multi-store-model" },
  { assertion: "The working memory model (Baddeley & Hitch, 1974) replaced the idea of a single STM store with four components: the central executive, phonological loop, visuo-spatial sketchpad, and episodic buffer.", category: "concept", chapter: "Memory", section: "Working memory", tags: ["working-memory", "Baddeley", "central-executive"], learningOutcomeRef: "PSY-MEM-2", topicSlug: "working-memory" },
  { assertion: "The phonological loop processes auditory information and has two sub-components: the phonological store (inner ear) and the articulatory control process (inner voice).", category: "process", chapter: "Memory", section: "Working memory", tags: ["phonological-loop", "working-memory"], learningOutcomeRef: "PSY-MEM-2", topicSlug: "working-memory" },
  { assertion: "Tulving (1985) proposed three types of LTM: episodic (personal events), semantic (general knowledge), and procedural (skills and actions).", category: "concept", chapter: "Memory", section: "Types of LTM", tags: ["LTM", "episodic", "semantic", "procedural", "Tulving"], learningOutcomeRef: "PSY-MEM-3", topicSlug: "types-of-ltm" },
  { assertion: "Loftus and Palmer (1974) demonstrated that leading questions can distort eyewitness testimony — participants who heard 'smashed' estimated higher speeds than those who heard 'contacted'.", category: "fact", chapter: "Memory", section: "Eyewitness testimony", tags: ["EWT", "Loftus", "leading-questions"], learningOutcomeRef: "PSY-MEM-4", topicSlug: "eyewitness-testimony" },

  // Social Influence module
  { assertion: "Asch (1951) found that 75% of participants conformed at least once when confederates gave obviously wrong answers about line lengths, demonstrating normative social influence.", category: "fact", chapter: "Social Influence", section: "Conformity", tags: ["Asch", "conformity", "normative"], learningOutcomeRef: "PSY-SOC-1", topicSlug: "conformity" },
  { assertion: "Conformity can be classified as compliance (public but not private change), identification (adoption of group role), or internalisation (genuine change in belief).", category: "concept", chapter: "Social Influence", section: "Types of conformity", tags: ["conformity", "compliance", "internalisation"], learningOutcomeRef: "PSY-SOC-1", topicSlug: "conformity" },
  { assertion: "Milgram (1963) found that 65% of participants administered the maximum 450V shock when instructed by an authority figure, revealing the power of legitimate authority and the agentic state.", category: "fact", chapter: "Social Influence", section: "Obedience", tags: ["Milgram", "obedience", "authority"], learningOutcomeRef: "PSY-SOC-2", topicSlug: "obedience" },
  { assertion: "Situational variables affecting obedience include proximity to the victim (reduced to 30% when in same room), location (reduced in run-down office), and uniform of authority figure.", category: "fact", chapter: "Social Influence", section: "Obedience variations", tags: ["Milgram", "situational-variables"], learningOutcomeRef: "PSY-SOC-2", topicSlug: "obedience" },
  { assertion: "Moscovici (1969) demonstrated that a consistent minority can influence majority opinion — a minority calling blue slides 'green' consistently caused 8.42% of majority participants to agree.", category: "fact", chapter: "Social Influence", section: "Minority influence", tags: ["Moscovici", "minority-influence", "consistency"], learningOutcomeRef: "PSY-SOC-3", topicSlug: "minority-influence" },

  // Attachment module
  { assertion: "Reciprocity refers to the mutual, responsive interaction between caregiver and infant, while interactional synchrony describes the coordinated, mirrored behaviour between them.", category: "concept", chapter: "Attachment", section: "Caregiver-infant interaction", tags: ["reciprocity", "synchrony", "caregiver-infant"], learningOutcomeRef: "PSY-ATT-1", topicSlug: "caregiver-infant" },
  { assertion: "Bowlby's monotropic theory proposes that attachment is innate, adaptive, and that infants form one primary attachment (monotropy) during a critical period, with an internal working model guiding future relationships.", category: "concept", chapter: "Attachment", section: "Bowlby's theory", tags: ["Bowlby", "monotropy", "internal-working-model"], learningOutcomeRef: "PSY-ATT-2", topicSlug: "bowlby-theory" },
  { assertion: "Ainsworth's Strange Situation (1970) identified three attachment types: secure (Type B, ~70%), insecure-avoidant (Type A, ~15%), and insecure-resistant (Type C, ~15%), based on reunion behaviour.", category: "fact", chapter: "Attachment", section: "Types of attachment", tags: ["Ainsworth", "Strange-Situation", "secure", "insecure"], learningOutcomeRef: "PSY-ATT-3", topicSlug: "attachment-types" },

  // Psychopathology module
  { assertion: "Statistical infrequency defines abnormality as behaviour that is statistically rare (>2 SDs from mean), but this fails to distinguish desirable vs undesirable rarity (e.g., high IQ).", category: "concept", chapter: "Psychopathology", section: "Defining abnormality", tags: ["abnormality", "statistical-infrequency"], learningOutcomeRef: "PSY-PSP-1", topicSlug: "defining-abnormality" },
  { assertion: "Failure to function adequately (Rosenhan & Seligman, 1989) judges abnormality by inability to cope with everyday life — including personal distress, maladaptive behaviour, and unpredictability.", category: "concept", chapter: "Psychopathology", section: "Defining abnormality", tags: ["abnormality", "failure-to-function"], learningOutcomeRef: "PSY-PSP-1", topicSlug: "defining-abnormality" },
  { assertion: "Phobias are characterised by persistent, excessive fear (emotional), avoidance behaviour (behavioural), and irrational beliefs about the feared stimulus (cognitive).", category: "concept", chapter: "Psychopathology", section: "Phobias", tags: ["phobias", "characteristics"], learningOutcomeRef: "PSY-PSP-2", topicSlug: "phobias" },
  { assertion: "The two-process model (Mowrer, 1947) explains phobias through classical conditioning (acquisition of fear) maintained by operant conditioning (avoidance is negatively reinforced).", category: "process", chapter: "Psychopathology", section: "Phobias", tags: ["phobias", "two-process-model", "Mowrer"], learningOutcomeRef: "PSY-PSP-2", topicSlug: "phobias" },
  { assertion: "Beck's cognitive theory of depression proposes that negative schemas and the cognitive triad (negative views of self, world, and future) maintain depressive thinking.", category: "concept", chapter: "Psychopathology", section: "Depression", tags: ["depression", "Beck", "cognitive-triad"], learningOutcomeRef: "PSY-PSP-3", topicSlug: "depression-ocd" },
];

// Course reference assertions (tutor instructions — instruction categories)
const COURSE_REF_ASSERTIONS = [
  { assertion: "Use Socratic questioning as the primary teaching method — ask questions that guide students to discover principles themselves. Direct explanation is a last resort.", category: "skill_framework", chapter: "Teaching Approach", section: "Core Principles" },
  { assertion: "Ground every concept in a landmark study. Never teach a theory without its foundational research — the method, the findings, and what they mean.", category: "skill_framework", chapter: "Teaching Approach", section: "Core Principles" },
  { assertion: "Build evaluation skills gradually: start by modelling AO3 points ('One strength of this study is...') then shift to asking students to generate their own evaluations.", category: "scaffolding_technique", chapter: "Teaching Approach", section: "Evaluation Skills" },
  { assertion: "Connect every concept to real life before introducing formal terminology. Ask 'Have you ever noticed...?' to activate prior experience.", category: "scaffolding_technique", chapter: "Teaching Approach", section: "Real-world Connection" },
  { assertion: "Call flow: Opening (~2 min) → Retrieval check (~2 min) → Core exchange (~8 min) → Stretch or consolidate (~2 min) → Close (~1 min). Total 12-15 minutes.", category: "session_flow", chapter: "Teaching Approach", section: "Call Structure" },
  { assertion: "Phase 1 (Foundation): Prioritise warmth and encouragement. Accept less precise terminology. Model evaluation rather than asking students to generate it. Focus on Memory as entry point.", category: "session_flow", chapter: "Course Phases", section: "Phase 1" },
  { assertion: "Phase 2 (Building Understanding): Increase Socratic challenge — ask 'why?' and 'how do you know?' more frequently. Begin interleaving retrieval checks from earlier topics.", category: "session_flow", chapter: "Course Phases", section: "Phase 2" },
  { assertion: "Phase 3 (Consolidation): Expect accurate terminology without prompting. Ask comparison questions across topics. Push for independent evaluation and AO1/AO3 answer structuring.", category: "session_flow", chapter: "Course Phases", section: "Phase 3" },
  { assertion: "Handle psychopathology sensitively — acknowledge that mental health is personal. Never push if the student is uncomfortable. Offer to focus on research methodology instead of disorders.", category: "edge_case", chapter: "Edge Cases", section: "Sensitive Content" },
  { assertion: "If a student consistently cannot recall material from previous calls, dedicate one full call to retrieval practice across all previously covered outcomes before introducing new content.", category: "edge_case", chapter: "Edge Cases", section: "Recall Failure" },
  { assertion: "Student talk ratio target: >40% of call duration. If the tutor is talking more than 60%, shift to more questions and shorter explanations.", category: "communication_rule", chapter: "Metrics", section: "Quality Signals" },
  { assertion: "Outcome progression rate target: 1-2 outcomes reaching mastery per 3 calls. If slower, check whether retrieval checks are taking too long or if scaffolding needs adjusting.", category: "communication_rule", chapter: "Metrics", section: "Quality Signals" },
  { assertion: "SKILL-01: Research Evaluation — ability to critically assess psychological research. Emerging: can name a study. Developing: identifies obvious limitations. Secure: independently weighs strengths against limitations.", category: "skill_description", chapter: "Skills Framework", section: "Research Evaluation" },
  { assertion: "SKILL-02: Psychological Terminology — accurate use of subject-specific vocabulary. Emerging: uses everyday language. Developing: uses terms when prompted. Secure: spontaneously uses correct terminology.", category: "skill_description", chapter: "Skills Framework", section: "Terminology" },
  { assertion: "SKILL-03: Application — ability to apply concepts to novel scenarios. Emerging: cannot connect theory to examples. Developing: applies concepts with scaffolding. Secure: independently generates novel examples.", category: "skill_description", chapter: "Skills Framework", section: "Application" },
];

// ── Learner Archetypes ──────────────────────────────────────

type Archetype = "completed" | "inProgress" | "struggling" | "newActive" | "newEmpty";

interface LearnerDef {
  name: string;
  email: string;
  archetype: Archetype;
  callCount: number;
  mastery: number;
  /** Which modules this learner has engaged with, with per-module mastery */
  moduleProgress: Record<string, { mastery: number; status: string; callCount: number }>;
}

const LEARNERS: LearnerDef[] = [
  // Star student — completed course, high mastery, full adaptive loop visible
  {
    name: "Emma Richardson",
    email: "emma.r@example.com",
    archetype: "completed",
    callCount: 6,
    mastery: 0.85,
    moduleProgress: {
      [`${TAG}memory`]: { mastery: 0.90, status: "COMPLETED", callCount: 2 },
      [`${TAG}social-influence`]: { mastery: 0.88, status: "COMPLETED", callCount: 2 },
      [`${TAG}attachment`]: { mastery: 0.82, status: "COMPLETED", callCount: 1 },
      [`${TAG}psychopathology`]: { mastery: 0.78, status: "COMPLETED", callCount: 1 },
    },
  },
  // Steady progress — mid-journey, scores improving
  {
    name: "Sophie Chen",
    email: "sophie.c@example.com",
    archetype: "inProgress",
    callCount: 4,
    mastery: 0.55,
    moduleProgress: {
      [`${TAG}memory`]: { mastery: 0.70, status: "COMPLETED", callCount: 2 },
      [`${TAG}social-influence`]: { mastery: 0.50, status: "IN_PROGRESS", callCount: 1 },
      [`${TAG}attachment`]: { mastery: 0.20, status: "IN_PROGRESS", callCount: 1 },
      [`${TAG}psychopathology`]: { mastery: 0.0, status: "NOT_STARTED", callCount: 0 },
    },
  },
  // Early stage — just getting started, few data points
  {
    name: "Liam Patel",
    email: "liam.p@example.com",
    archetype: "inProgress",
    callCount: 3,
    mastery: 0.35,
    moduleProgress: {
      [`${TAG}memory`]: { mastery: 0.45, status: "IN_PROGRESS", callCount: 2 },
      [`${TAG}social-influence`]: { mastery: 0.25, status: "IN_PROGRESS", callCount: 1 },
      [`${TAG}attachment`]: { mastery: 0.0, status: "NOT_STARTED", callCount: 0 },
      [`${TAG}psychopathology`]: { mastery: 0.0, status: "NOT_STARTED", callCount: 0 },
    },
  },
  // Struggling — needs attention, shows "at risk" signals
  {
    name: "Noah Garcia",
    email: "noah.g@example.com",
    archetype: "struggling",
    callCount: 2,
    mastery: 0.15,
    moduleProgress: {
      [`${TAG}memory`]: { mastery: 0.15, status: "IN_PROGRESS", callCount: 1 },
      [`${TAG}social-influence`]: { mastery: 0.10, status: "IN_PROGRESS", callCount: 1 },
      [`${TAG}attachment`]: { mastery: 0.0, status: "NOT_STARTED", callCount: 0 },
      [`${TAG}psychopathology`]: { mastery: 0.0, status: "NOT_STARTED", callCount: 0 },
    },
  },
  // Brand new — just had first call, shows onboarding state
  {
    name: "Isla Thompson",
    email: "isla.t@example.com",
    archetype: "newActive",
    callCount: 1,
    mastery: 0.0,
    moduleProgress: {},
  },
];

// ── Transcript Templates ────────────────────────────────────

const TRANSCRIPTS = [
  {
    module: `${TAG}memory`,
    loRefs: ["PSY-MEM-1"],
    params: ["engagement", "comprehension", "recall"],
    transcript: (name: string) =>
      `AI: Hi ${name}! Today I'd like to talk about how memory works. Have you come across the multi-store model before?\nUser: I think so — isn't it about short-term and long-term memory?\nAI: That's a great start! The multi-store model was proposed by Atkinson and Shiffrin in 1968. It suggests there are three separate stores. Can you think what the third one might be, besides STM and LTM?\nUser: Is it like... sensory memory?\nAI: Exactly right — the sensory register. It takes in information from our senses and holds it very briefly. What do you think happens to most of that information?\nUser: It probably just disappears if we don't pay attention to it?\nAI: Spot on. Only information we pay attention to moves into short-term memory. Now, Miller found that STM has a specific capacity — any idea what that might be?\nUser: Seven things? I remember hearing that.\nAI: Yes! Miller's magic number — 7 plus or minus 2 items. And without rehearsal, STM only lasts about 18-30 seconds. That's why revision techniques matter so much. What happens when we rehearse information enough?\nUser: It goes into long-term memory?\nAI: Exactly. Through elaborative rehearsal, information transfers to LTM, which has potentially unlimited capacity and duration. You're building a solid understanding here, ${name}.`,
  },
  {
    module: `${TAG}memory`,
    loRefs: ["PSY-MEM-2"],
    params: ["engagement", "comprehension", "recall"],
    transcript: (name: string) =>
      `AI: ${name}, last time we talked about the multi-store model. Today let's look at a more detailed model of short-term memory — the working memory model. Have you heard of Baddeley and Hitch?\nUser: Not really, no.\nAI: That's fine — they proposed this model in 1974. Instead of one simple STM store, they suggested we have a system with multiple components. The boss of the system is called the central executive. What do you think its job might be?\nUser: Controlling what we pay attention to?\nAI: Excellent thinking! The central executive directs attention and coordinates the other components. It's like a manager. One of those components is the phonological loop — it deals with auditory information. Ever noticed how you can 'hear' a song in your head?\nUser: Oh yeah, like when a song gets stuck!\nAI: Perfect example! That's your phonological loop at work. There's also the visuo-spatial sketchpad — can you guess what that handles?\nUser: Visual stuff? Like pictures in your mind?\nAI: Exactly — it processes visual and spatial information. Think of it as your mental whiteboard. The model also has an episodic buffer, added later by Baddeley, which integrates information from the other components with LTM. This model explains a lot that the multi-store model couldn't.`,
  },
  {
    module: `${TAG}memory`,
    loRefs: ["PSY-MEM-3"],
    params: ["engagement", "comprehension", "recall"],
    transcript: (name: string) =>
      `AI: Hello ${name}! Today we're exploring the different types of long-term memory. Tulving proposed that LTM isn't just one store — it's actually three. Can you remember any of them?\nUser: Umm... is one of them about personal memories?\nAI: Yes! That's episodic memory — memories of personal events and experiences, like your last birthday. They're time-stamped and often have emotional associations. What about a type of memory that's more about facts and knowledge?\nUser: Semantic memory?\nAI: Brilliant! Semantic memory stores our general knowledge — facts, concepts, meanings. Like knowing that Paris is the capital of France. And there's a third type that's quite different from both of those.\nUser: I'm not sure about the third one.\nAI: It's procedural memory — memory for skills and actions. Things like riding a bike or typing on a keyboard. The interesting thing is that procedural memories are often unconscious. Can you think of something you do automatically without thinking about it?\nUser: Tying my shoelaces! I don't even think about it.\nAI: Perfect example. And here's what's really fascinating — brain damage can affect one type while leaving others intact, which supports Tulving's idea that they really are separate systems.`,
  },
  {
    module: `${TAG}memory`,
    loRefs: ["PSY-MEM-4"],
    params: ["engagement", "comprehension", "recall"],
    transcript: (name: string) =>
      `AI: ${name}, today we're looking at eyewitness testimony — specifically how reliable our memories of events really are. Have you heard of Elizabeth Loftus?\nUser: I think she did experiments about car crashes?\nAI: That's right! Loftus and Palmer in 1974 showed participants a video of a car accident and then asked them to estimate the speed. The key was the verb used in the question. When they used 'smashed', what do you think happened to the speed estimates?\nUser: People probably said the cars were going faster?\nAI: Exactly. 'Smashed' produced an average estimate of 40.5 mph, while 'contacted' only produced 31.8 mph. Same video, different word, different memory. What does this tell us about the reliability of eyewitness testimony?\nUser: That the way you ask questions can change what people remember?\nAI: Precisely — these are called leading questions, and they can actually alter the memory itself, not just the report. Loftus called this the misinformation effect. In a follow-up study, participants asked about the cars 'smashing' were more likely to falsely report seeing broken glass. What implications does this have for criminal investigations?\nUser: Police need to be really careful how they word questions to witnesses.\nAI: Absolutely. This research has had a huge impact on how interviews are conducted. The cognitive interview technique was developed specifically to reduce these biases. Great critical thinking, ${name}.`,
  },
  {
    module: `${TAG}social-influence`,
    loRefs: ["PSY-SOC-1", "PSY-SOC-2"],
    params: ["engagement", "comprehension", "recall"],
    transcript: (name: string) =>
      `AI: Hi ${name}! Today we're diving into social influence — starting with conformity. Have you ever gone along with a group even when you thought they were wrong?\nUser: Definitely, like when everyone picks a restaurant I don't really want to go to.\nAI: That's a relatable example! Solomon Asch studied this in 1951. He had participants judge which line matched a standard, but the other 'participants' were actually confederates who gave wrong answers. What do you think happened?\nUser: Did people go along with the wrong answer?\nAI: Many did! 75% conformed at least once. But there are different types of conformity. Compliance is when you publicly agree but privately disagree — like your restaurant example. Internalisation is when you genuinely change your beliefs. Can you think of the difference?\nUser: So compliance is just going along with it, but internalisation is actually believing it?\nAI: Exactly. There's also identification — where you conform because you identify with a group role. Now, Milgram took this further with obedience. His famous 1963 experiment had participants deliver what they believed were electric shocks to another person. 65% went all the way to 450 volts. Why do you think people obeyed?\nUser: Because someone in authority told them to?\nAI: That's the key — legitimate authority. Milgram described an 'agentic state' where people see themselves as agents carrying out someone else's wishes rather than being personally responsible. It's a powerful and slightly unsettling finding.`,
  },
  {
    module: `${TAG}social-influence`,
    loRefs: ["PSY-SOC-3", "PSY-SOC-4"],
    params: ["engagement", "comprehension", "recall"],
    transcript: (name: string) =>
      `AI: ${name}, we've looked at how majorities influence individuals. But can a minority change the majority's mind? What do you think?\nUser: I guess so — like how civil rights movements started with small groups?\nAI: That's an excellent real-world connection. Moscovici investigated this experimentally in 1969. He had groups judge the colour of slides. When a minority consistently called blue slides 'green', about 8% of the majority agreed. The key word there is 'consistently'. Why do you think consistency matters?\nUser: Because if they keep changing their mind, no one would take them seriously?\nAI: Exactly. Moscovici identified consistency as one of the key factors, along with commitment and flexibility. A consistent minority makes people think 'maybe they have a point'. This is different from majority influence — it tends to cause private acceptance rather than just public compliance. Can you think of a historical example where a minority view became the majority?\nUser: The suffragettes? They were a minority who wanted women to vote.\nAI: Perfect example. They demonstrated consistency, commitment, and were willing to make sacrifices. Over time, this caused a snowball effect — more people reconsidered their views, and eventually the majority shifted. This process of social change follows a pattern: drawing attention, creating cognitive conflict, consistency over time, and the augmentation principle.`,
  },
  {
    module: `${TAG}attachment`,
    loRefs: ["PSY-ATT-1", "PSY-ATT-2", "PSY-ATT-3"],
    params: ["engagement", "comprehension", "recall"],
    transcript: (name: string) =>
      `AI: Today we're looking at attachment, ${name}. Let's start with how infants and caregivers interact. Have you noticed how babies and parents often mirror each other's expressions?\nUser: Yeah, like when a mum smiles and the baby smiles back?\nAI: Exactly — that's called interactional synchrony. And when the interaction is two-way, with both partners responding to each other, that's reciprocity. These early interactions are thought to be crucial for forming attachment bonds. Bowlby had a major theory about this. He proposed that attachment is innate — we're born with a biological drive to form attachments. Why might this be adaptive from an evolutionary perspective?\nUser: To keep the baby safe? If they're attached to someone, that person will protect them.\nAI: Spot on — it increases survival chances. Bowlby also proposed monotropy, the idea that infants form one primary attachment that's qualitatively different from others. This creates an 'internal working model' — a template for future relationships. If a child has a secure attachment, what kind of internal working model might they develop?\nUser: That relationships are safe and people can be trusted?\nAI: Exactly. Now, Ainsworth tested these ideas with her Strange Situation study in 1970. She observed how infants reacted to separation from and reunion with their caregiver. She identified three types: secure, insecure-avoidant, and insecure-resistant. About 70% were securely attached. What do you think secure attachment looks like?\nUser: The baby is upset when the mum leaves but happy when she comes back?\nAI: That's right — they show some distress at separation but are easily comforted on reunion. Avoidant infants show little distress and may ignore the caregiver on return, while resistant infants are very distressed and resist comfort. Brilliant understanding, ${name}.`,
  },
  {
    module: `${TAG}psychopathology`,
    loRefs: ["PSY-PSP-1", "PSY-PSP-2"],
    params: ["engagement", "comprehension", "recall"],
    transcript: (name: string) =>
      `AI: ${name}, today we're tackling a big question — what makes behaviour 'abnormal'? How would you define it?\nUser: Isn't it just behaviour that's different from normal?\nAI: That's one approach — statistical infrequency. If behaviour is more than 2 standard deviations from the mean, it's statistically rare. But can you see a problem with that definition?\nUser: Well... being really clever would be statistically rare too, and that's not a problem.\nAI: Brilliant insight! Statistical infrequency doesn't distinguish between desirable and undesirable rarity. That's a major limitation. Another approach is 'failure to function adequately' — judging abnormality by whether someone can cope with everyday life. Rosenhan and Seligman suggested looking at personal distress, maladaptive behaviour, and unpredictability. Why might this be a better approach?\nUser: Because it focuses on whether the person is actually struggling?\nAI: Yes, it considers the individual's experience. But even this has issues — who decides what 'adequate' functioning looks like? Let's shift to a specific disorder. Phobias are characterised by three components: emotional, behavioural, and cognitive. An excessive fear response, avoidance of the feared stimulus, and irrational beliefs about the danger. Mowrer explained phobias through his two-process model — classical conditioning creates the fear, and operant conditioning maintains it through avoidance. Can you explain why avoidance maintains the phobia?\nUser: Because if you avoid the thing, you never learn it's not actually dangerous?\nAI: Precisely — avoidance is negatively reinforced because it reduces anxiety, so the person never has the chance to learn the stimulus isn't actually harmful. That's really clear thinking.`,
  },
];

// Memory templates removed — all memories now loaded from demo-fixtures.json

// ── Goal Templates ──────────────────────────────────────────

function goalsForArchetype(archetype: Archetype): Array<{ type: string; name: string; description: string; status: string; progress: number; priority: number }> {
  switch (archetype) {
    case "completed":
      return [
        { type: "LEARN", name: "Master Memory & Social Influence", description: "Demonstrate understanding of all key studies and concepts in Memory and Social Influence modules", status: "COMPLETED", progress: 0.92, priority: 1 },
        { type: "LEARN", name: "Complete Attachment & Psychopathology", description: "Build understanding of attachment theory and definitions of abnormality", status: "COMPLETED", progress: 0.80, priority: 2 },
        { type: "ACHIEVE", name: "Develop evaluation skills", description: "Consistently evaluate research studies using methodological criteria (validity, reliability, ethics)", status: "ACTIVE", progress: 0.75, priority: 3 },
      ];
    case "inProgress":
      return [
        { type: "LEARN", name: "Master core Memory concepts", description: "Understand MSM, working memory, types of LTM, and EWT research", status: "ACTIVE", progress: 0.55, priority: 1 },
        { type: "LEARN", name: "Build Social Influence understanding", description: "Explain conformity, obedience, and minority influence with key studies", status: "ACTIVE", progress: 0.40, priority: 2 },
        { type: "ACHIEVE", name: "Improve exam technique", description: "Practice structuring AO1/AO3 answers for 12-mark and 16-mark questions", status: "ACTIVE", progress: 0.30, priority: 3 },
      ];
    case "struggling":
      return [
        { type: "LEARN", name: "Build foundational terminology", description: "Learn and correctly use key psychological terms across all modules", status: "ACTIVE", progress: 0.15, priority: 1 },
        { type: "ACHIEVE", name: "Engage with revision materials", description: "Complete guided revision activities and self-test on each topic", status: "ACTIVE", progress: 0.10, priority: 2 },
      ];
    case "newActive":
    case "newEmpty":
      return [
        { type: "LEARN", name: "Complete the Memory module", description: "Understand and recall key studies and concepts from the Memory topic", status: "ACTIVE", progress: 0.0, priority: 1 },
        { type: "ACHIEVE", name: "Build confidence with Psychology", description: "Develop comfort with psychological terminology and research evaluation", status: "ACTIVE", progress: 0.0, priority: 2 },
      ];
  }
}

// ── Main ────────────────────────────────────────────────────

export async function main(externalPrisma?: PrismaClient): Promise<void> {
  const env = process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV;
  if (env === "LIVE" || env === "production") {
    console.log("  ⛔ Skipping demo course seed — PROD environment detected");
    return;
  }

  const prisma = externalPrisma || new PrismaClient();

  try {
    // ── 1. Find Abacus Academy domain (created by seed-golden) ──
    const domain = await prisma.domain.findUnique({ where: { slug: DOMAIN_SLUG } });
    if (!domain) {
      console.error(`  ⚠ Domain "${DOMAIN_SLUG}" not found — run seed-golden first`);
      return;
    }
    console.log(`  Found domain: ${domain.name} (${domain.id})`);

    // ── 2. Cleanup previous demo-course data ──
    const existingCallers = await prisma.caller.findMany({
      where: { externalId: { startsWith: TAG } },
      select: { id: true },
    });
    const callerIds = existingCallers.map((c) => c.id);

    if (callerIds.length > 0) {
      // Find call IDs for FK cleanup
      const existingCalls = await prisma.call.findMany({
        where: { callerId: { in: callerIds } },
        select: { id: true },
      });
      const existingCallIds = existingCalls.map((c) => c.id);

      // Delete in FK-safe order
      await prisma.callerModuleProgress.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.composedPrompt.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.goal.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerMemory.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerMemorySummary.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerPersonalityProfile.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callScore.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.onboardingSession.deleteMany({ where: { callerId: { in: callerIds } } });
      // Pipeline output tables (FK to call)
      if (existingCallIds.length > 0) {
        await prisma.rewardScore.deleteMany({ where: { callId: { in: existingCallIds } } });
        await prisma.callTarget.deleteMany({ where: { callId: { in: existingCallIds } } });
        await prisma.behaviorMeasurement.deleteMany({ where: { callId: { in: existingCallIds } } });
      }
      await prisma.call.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerPlaybook.deleteMany({ where: { callerId: { in: callerIds } } });
      await prisma.callerCohortMembership.deleteMany({ where: { callerId: { in: callerIds } } });
      // Delete cohorts owned by demo callers (before deleting callers)
      await prisma.cohortPlaybook.deleteMany({ where: { cohortGroup: { ownerId: { in: callerIds } } } });
      await prisma.cohortGroup.deleteMany({ where: { ownerId: { in: callerIds } } });
      await prisma.caller.deleteMany({ where: { id: { in: callerIds } } });
      console.log(`  Cleaned up ${callerIds.length} previous demo callers`);
    }

    // Clean up demo-specific entities
    await prisma.contentAssertion.deleteMany({ where: { createdBy: "demo-course-seed" } });

    // ── 3. Create Subject ──
    const subject = await prisma.subject.upsert({
      where: { slug: SUBJECT.slug },
      update: { name: SUBJECT.name, description: SUBJECT.description },
      create: {
        slug: SUBJECT.slug,
        name: SUBJECT.name,
        description: SUBJECT.description,
        defaultTrustLevel: "EXPERT_CURATED",
        isActive: true,
        teachingProfile: SUBJECT.teachingProfile,
        teachingOverrides: SUBJECT.teachingOverrides as any,
      },
    });

    await prisma.subjectDomain.upsert({
      where: { subjectId_domainId: { subjectId: subject.id, domainId: domain.id } },
      update: {},
      create: { subjectId: subject.id, domainId: domain.id },
    });
    console.log(`  Subject: ${subject.name}`);

    // ── 4. Create Content Source ──
    let source = await prisma.contentSource.findFirst({ where: { name: CONTENT_SOURCE.name } });
    if (!source) {
      source = await prisma.contentSource.create({
        data: {
          slug: CONTENT_SOURCE.slug,
          name: CONTENT_SOURCE.name,
          description: CONTENT_SOURCE.description,
          documentType: CONTENT_SOURCE.documentType,
        },
      });
    }

    const subjectSource = await prisma.subjectSource.upsert({
      where: { subjectId_sourceId: { subjectId: subject.id, sourceId: source.id } },
      update: {},
      create: { subjectId: subject.id, sourceId: source.id },
    });

    // ── 5. Create Playbook ──
    let playbook = await prisma.playbook.findFirst({
      where: { domainId: domain.id, name: "Introduction to Psychology" },
    });

    if (!playbook) {
      playbook = await prisma.playbook.create({
        data: {
          name: "Introduction to Psychology",
          description: "Year 12 Introduction to Psychology — AQA-aligned course covering Memory, Social Influence, Attachment, and Psychopathology.",
          domainId: domain.id,
          status: "PUBLISHED",
          version: "1.0",
          publishedAt: new Date(),
          validationPassed: true,
          measureSpecCount: 0,
          learnSpecCount: 0,
          adaptSpecCount: 0,
          parameterCount: 0,
          config: {
            interactionPattern: "tutor",
            teachingMode: "socratic",
            subjectDiscipline: "Psychology",
            audience: "Year 12 (16-17 year olds)",
            sessionCount: 20,
            durationMins: 15,
            planEmphasis: "conceptual understanding and evaluation skills",
            welcome: {
              goals: { enabled: true },
              aboutYou: { enabled: true },
              knowledgeCheck: { enabled: true },
              aiIntroCall: { enabled: false },
            },
            nps: { enabled: true, trigger: "mastery", threshold: 80 },
            // surveys.pre.enabled is computed from welcome.* via isPreSurveyEnabled.
            // Only post is persisted (no welcome-side mirror for post yet).
            surveys: { post: { enabled: true } },
            assessment: { preTest: { enabled: true }, postTest: { enabled: true } },
            goals: [
              { type: "LEARN", name: "Master core psychological concepts", isDefault: true, priority: 1 },
              { type: "ACHIEVE", name: "Develop research evaluation skills", isDefault: true, priority: 2 },
              { type: "CHANGE", name: "Build confidence in essay writing", isDefault: true, priority: 3 },
            ],
          },
        },
      });
    }

    // Link subject to playbook
    await prisma.playbookSubject.upsert({
      where: { playbookId_subjectId: { playbookId: playbook.id, subjectId: subject.id } },
      update: {},
      create: { playbookId: playbook.id, subjectId: subject.id },
    });

    // Link content source to playbook (PlaybookSource)
    await prisma.playbookSource.upsert({
      where: { playbookId_sourceId: { playbookId: playbook.id, sourceId: source.id } },
      update: {},
      create: { playbookId: playbook.id, sourceId: source.id, tags: ["course-reference"] },
    });

    console.log(`  Playbook: ${playbook.name} (${playbook.id})`);

    // ── 6. Create Curriculum + Modules + LOs ──
    const curriculum = await prisma.curriculum.upsert({
      where: { slug: CURRICULUM.slug },
      update: { name: CURRICULUM.name, description: CURRICULUM.description },
      create: {
        slug: CURRICULUM.slug,
        name: CURRICULUM.name,
        description: CURRICULUM.description,
        subjectId: subject.id,
        playbookId: playbook.id,
        primarySourceId: source.id,
        trustLevel: "EXPERT_CURATED",
        deliveryConfig: {},
      },
    });

    const loRefToId = new Map<string, string>();
    const moduleSlugToId = new Map<string, string>();

    for (const modDef of MODULES) {
      const mod = await prisma.curriculumModule.upsert({
        where: { curriculumId_slug: { curriculumId: curriculum.id, slug: modDef.slug } },
        update: { title: modDef.title, description: modDef.description, sortOrder: modDef.sortOrder, estimatedDurationMinutes: modDef.estimatedDurationMinutes },
        create: {
          curriculumId: curriculum.id,
          slug: modDef.slug,
          title: modDef.title,
          description: modDef.description,
          sortOrder: modDef.sortOrder,
          estimatedDurationMinutes: modDef.estimatedDurationMinutes,
        },
      });
      moduleSlugToId.set(modDef.slug, mod.id);

      for (const loDef of modDef.learningObjectives) {
        const lo = await prisma.learningObjective.upsert({
          where: { moduleId_ref: { moduleId: mod.id, ref: loDef.ref } },
          update: { description: loDef.description, sortOrder: loDef.sortOrder },
          create: { moduleId: mod.id, ref: loDef.ref, description: loDef.description, sortOrder: loDef.sortOrder },
        });
        loRefToId.set(loDef.ref, lo.id);
      }
    }

    console.log(`  Curriculum: ${MODULES.length} modules, ${loRefToId.size} learning objectives`);

    // ── 7. Create Assertions ──
    const refToAssertionIds = new Map<string, string[]>();

    for (let i = 0; i < ASSERTIONS.length; i++) {
      const a = ASSERTIONS[i];
      const created = await prisma.contentAssertion.create({
        data: {
          sourceId: source.id,
          subjectSourceId: subjectSource.id,
          assertion: a.assertion,
          category: a.category,
          chapter: a.chapter,
          section: a.section,
          tags: a.tags,
          learningOutcomeRef: a.learningOutcomeRef,
          learningObjectiveId: loRefToId.get(a.learningOutcomeRef) ?? null,
          topicSlug: a.topicSlug,
          teachMethod: a.category === "process" ? "worked_example" : "recall_quiz",
          depth: 1,
          orderIndex: i,
          createdBy: "demo-course-seed",
        },
      });
      const existing = refToAssertionIds.get(a.learningOutcomeRef) ?? [];
      existing.push(created.id);
      refToAssertionIds.set(a.learningOutcomeRef, existing);
    }

    console.log(`  Teaching points: ${ASSERTIONS.length}`);

    // ── 7b. Create Course Reference Source + Assertions ──
    let courseRefSource = await prisma.contentSource.findFirst({ where: { slug: COURSE_REF_SOURCE.slug } });
    if (!courseRefSource) {
      courseRefSource = await prisma.contentSource.create({
        data: {
          slug: COURSE_REF_SOURCE.slug,
          name: COURSE_REF_SOURCE.name,
          description: COURSE_REF_SOURCE.description,
          documentType: COURSE_REF_SOURCE.documentType,
        },
      });
    }

    await prisma.subjectSource.upsert({
      where: { subjectId_sourceId: { subjectId: subject.id, sourceId: courseRefSource.id } },
      update: {},
      create: { subjectId: subject.id, sourceId: courseRefSource.id },
    });

    await prisma.playbookSource.upsert({
      where: { playbookId_sourceId: { playbookId: playbook.id, sourceId: courseRefSource.id } },
      update: {},
      create: { playbookId: playbook.id, sourceId: courseRefSource.id, tags: ["course-reference"] },
    });

    for (let i = 0; i < COURSE_REF_ASSERTIONS.length; i++) {
      const a = COURSE_REF_ASSERTIONS[i];
      await prisma.contentAssertion.create({
        data: {
          sourceId: courseRefSource.id,
          assertion: a.assertion,
          category: a.category,
          chapter: a.chapter,
          section: a.section,
          depth: 1,
          orderIndex: i,
          createdBy: "demo-course-seed",
        },
      });
    }

    console.log(`  Tutor instructions: ${COURSE_REF_ASSERTIONS.length}`);

    // ── 8. Build lesson plan ──
    const teachingEntries = [];
    let sessionNum = 1;

    // Pre-survey + onboarding
    teachingEntries.push({ session: sessionNum++, type: "pre_survey", label: "Pre-Survey", moduleId: null, moduleLabel: "", estimatedDurationMins: 2, isOptional: true, learningOutcomeRefs: [], assertionIds: [] });
    teachingEntries.push({ session: sessionNum++, type: "onboarding", label: "First Call", moduleId: null, moduleLabel: "", estimatedDurationMins: 10, isOptional: false, learningOutcomeRefs: [], assertionIds: [] });

    // Teaching sessions from modules
    for (const modDef of MODULES) {
      const modId = moduleSlugToId.get(modDef.slug)!;
      for (const lo of modDef.learningObjectives) {
        teachingEntries.push({
          session: sessionNum++,
          type: "teaching",
          label: lo.description.slice(0, 60),
          moduleId: modId,
          moduleLabel: modDef.title,
          estimatedDurationMins: 12,
          isOptional: false,
          learningOutcomeRefs: [lo.ref],
          assertionIds: refToAssertionIds.get(lo.ref) ?? [],
        });
      }
    }

    // Post-survey + offboarding
    teachingEntries.push({ session: sessionNum++, type: "offboarding", label: "Last Call", moduleId: null, moduleLabel: "", estimatedDurationMins: 10, isOptional: false, learningOutcomeRefs: [], assertionIds: [] });
    teachingEntries.push({ session: sessionNum++, type: "post_survey", label: "Post-Survey", moduleId: null, moduleLabel: "", estimatedDurationMins: 2, isOptional: true, learningOutcomeRefs: [], assertionIds: [] });

    await prisma.curriculum.update({
      where: { id: curriculum.id },
      data: {
        deliveryConfig: {
          lessonPlan: {
            estimatedSessions: teachingEntries.length,
            generatedAt: new Date().toISOString(),
            generatedFrom: "demo-course-seed",
            entries: teachingEntries,
          },
        },
      },
    });

    // ── 9. Create Teacher + Cohort ──
    const teacherExternalId = `${TAG}teacher-clarke`;
    const teacherCaller = await prisma.caller.upsert({
      where: { externalId: teacherExternalId },
      update: { name: "Mr. David Clarke", email: "d.clarke@abacus.academy", role: "TEACHER", domainId: domain.id },
      create: { name: "Mr. David Clarke", email: "d.clarke@abacus.academy", externalId: teacherExternalId, role: "TEACHER", domainId: domain.id },
    });

    // Find the institution for cohort
    const institution = await prisma.institution.findFirst({ where: { slug: DOMAIN_SLUG } });

    let cohort = await prisma.cohortGroup.findFirst({
      where: { name: "12A Psychology", domainId: domain.id },
    });

    if (!cohort) {
      cohort = await prisma.cohortGroup.create({
        data: {
          name: "12A Psychology",
          domainId: domain.id,
          ownerId: teacherCaller.id,
          institutionId: institution?.id,
          maxMembers: 30,
          isActive: true,
          joinToken: "psych12a",
        },
      });
    }

    // Link cohort to playbook
    await prisma.cohortPlaybook.upsert({
      where: { cohortGroupId_playbookId: { cohortGroupId: cohort.id, playbookId: playbook.id } },
      update: {},
      create: { cohortGroupId: cohort.id, playbookId: playbook.id, assignedBy: "demo-course-seed" },
    });

    console.log(`  Teacher: ${teacherCaller.name}, Cohort: ${cohort.name}`);

    // ── 10. Create Learners + Calls ──
    // Build parameter existence set for fixture validation
    const allParams = await prisma.parameter.findMany({ select: { parameterId: true } });
    const validParamIds = new Set(allParams.map((p) => p.parameterId).filter(Boolean));

    // Maps for fixture resolution
    const callerExtToId = new Map<string, string>();
    const callExtToId = new Map<string, string>();

    let totalCalls = 0;
    let totalGoals = 0;

    for (const learnerDef of LEARNERS) {
      const externalId = `${TAG}${slugify(learnerDef.name)}`;
      const learner = await prisma.caller.upsert({
        where: { externalId },
        update: { name: learnerDef.name, email: learnerDef.email, role: "LEARNER", domainId: domain.id },
        create: { name: learnerDef.name, email: learnerDef.email, externalId, role: "LEARNER", domainId: domain.id },
      });
      callerExtToId.set(externalId, learner.id);

      // Enroll in playbook
      await prisma.callerPlaybook.upsert({
        where: { callerId_playbookId: { callerId: learner.id, playbookId: playbook.id } },
        update: { status: "ACTIVE" },
        create: { callerId: learner.id, playbookId: playbook.id, status: "ACTIVE", enrolledBy: "demo-course-seed" },
      });

      // Add to cohort
      await prisma.callerCohortMembership.upsert({
        where: { callerId_cohortGroupId: { callerId: learner.id, cohortGroupId: cohort.id } },
        update: {},
        create: { callerId: learner.id, cohortGroupId: cohort.id, role: "MEMBER" },
      });

      // ── Calls ──
      const callIds: string[] = [];
      if (learnerDef.callCount > 0) {
        const firstName = learnerDef.name.split(" ")[0];

        for (let c = 0; c < learnerDef.callCount; c++) {
          const templateIndex = c % TRANSCRIPTS.length;
          const template = TRANSCRIPTS[templateIndex];
          const transcript = template.transcript(firstName);

          // Spread calls over 60 days, most recent ~2 days ago
          const dayOffset = Math.floor(60 - (c / learnerDef.callCount) * 58);
          const callDate = daysAgo(dayOffset, seededInt(0, 480, `${externalId}-min-${c}`));

          const endDate = new Date(callDate);
          endDate.setMinutes(endDate.getMinutes() + seededInt(8, 20, `${externalId}-dur-${c}`));

          const moduleSlug = template.module;
          const moduleId = moduleSlugToId.get(moduleSlug) ?? null;

          const call = await prisma.call.create({
            data: {
              source: "demo-course-seed",
              externalId: `${TAG}call-${slugify(learnerDef.name)}-${c + 1}`,
              callerId: learner.id,
              playbookId: playbook.id,
              curriculumModuleId: moduleId,
              transcript,
              callSequence: c + 1,
              createdAt: callDate,
              endedAt: endDate,
            },
          });
          const callExtId = `${TAG}call-${slugify(learnerDef.name)}-${c + 1}`;
          callExtToId.set(callExtId, call.id);
          callIds.push(call.id);
        }
        totalCalls += learnerDef.callCount;
      }

      // ── Goals ──
      const goals = goalsForArchetype(learnerDef.archetype);
      if (goals.length > 0) {
        const startedAt = daysAgo(60);
        const targetDate = daysFromNow(180);
        await prisma.goal.createMany({
          // Seed-time cast: goalsForArchetype() returns string discriminators that
          // map to Prisma's GoalType/GoalStatus enums at runtime. Cast each
          // payload to the generated input shape so tsc accepts the string→enum
          // narrowing without falling back to `any`. See issue #375.
          data: goals.map(
            (g) =>
              ({
                callerId: learner.id,
                playbookId: playbook.id,
                type: g.type,
                name: g.name,
                description: g.description,
                status: g.status,
                progress: g.progress,
                priority: g.priority,
                startedAt,
                targetDate,
                ...(g.status === "COMPLETED" ? { completedAt: daysAgo(5) } : {}),
              }) as Prisma.GoalCreateManyInput,
          ),
        });
        totalGoals += goals.length;
      }

      // ── Module Progress ──
      for (const [modSlug, progress] of Object.entries(learnerDef.moduleProgress)) {
        const modId = moduleSlugToId.get(modSlug);
        if (!modId) continue;

        await prisma.callerModuleProgress.upsert({
          where: { callerId_moduleId: { callerId: learner.id, moduleId: modId } },
          update: { mastery: progress.mastery, status: progress.status, callCount: progress.callCount },
          create: {
            callerId: learner.id,
            moduleId: modId,
            mastery: progress.mastery,
            status: progress.status,
            callCount: progress.callCount,
            ...(progress.status !== "NOT_STARTED" ? { startedAt: daysAgo(50) } : {}),
            ...(progress.status === "COMPLETED" ? { completedAt: daysAgo(7) } : {}),
          },
        });
      }

      // ── Onboarding Session ──
      if (learnerDef.archetype !== "newEmpty") {
        await prisma.onboardingSession.upsert({
          where: { callerId_domainId: { callerId: learner.id, domainId: domain.id } },
          update: {},
          create: {
            callerId: learner.id,
            domainId: domain.id,
            currentPhase: "close",
            completedPhases: [
              { phase: "welcome", completedAt: daysAgo(55).toISOString(), duration: 30 },
              { phase: "orient", completedAt: daysAgo(55).toISOString(), duration: 45 },
              { phase: "discover", completedAt: daysAgo(55).toISOString(), duration: 60 },
              { phase: "close", completedAt: daysAgo(55).toISOString(), duration: 20 },
            ],
            isComplete: true,
          },
        });
      }

      console.log(`    ${learnerDef.name} (${learnerDef.archetype}): ${learnerDef.callCount} calls`);
    }

    // ── 11. Load AI-generated pipeline fixtures ──
    const fixturesPath = path.join(__dirname, "demo-fixtures.json");
    if (!fs.existsSync(fixturesPath)) {
      console.log(`  ⚠ demo-fixtures.json not found — skipping pipeline data`);
    } else {
      const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf-8"));
      let fScores = 0, fMemories = 0, fPrompts = 0, fRewards = 0, fTargets = 0, fBehaviors = 0, fProfiles = 0, fSummaries = 0;

      // Helper: validate parameterId exists in DB
      const paramExists = (paramId: string): boolean => validParamIds.has(paramId);

      // Call Scores (537)
      if (fixtures.callScores?.length) {
        const batch = [];
        for (const s of fixtures.callScores) {
          const callId = callExtToId.get(s.callExt);
          const callerId = callerExtToId.get(s.callerExt);
          if (!callId || !callerId || !paramExists(s.param)) continue;
          batch.push({
            callId, callerId, parameterId: s.param as string,
            score: s.score, confidence: s.confidence,
            evidence: s.evidence, reasoning: s.reasoning, scoredBy: s.scoredBy,
          });
        }
        if (batch.length > 0) {
          await prisma.callScore.createMany({ data: batch });
          fScores = batch.length;
        }
      }

      // AI Memories (74)
      if (fixtures.aiMemories?.length) {
        const batch = [];
        for (const m of fixtures.aiMemories) {
          const callerId = callerExtToId.get(m.callerExt);
          if (!callerId) continue;
          batch.push({
            callerId, category: m.category, source: m.source,
            key: m.key, value: m.value, confidence: m.confidence,
            extractedBy: m.extractedBy,
          });
        }
        if (batch.length > 0) {
          await prisma.callerMemory.createMany({ data: batch });
          fMemories = batch.length;
        }
      }

      // Memory Summaries (5)
      if (fixtures.memorySummaries?.length) {
        for (const s of fixtures.memorySummaries) {
          const callerId = callerExtToId.get(s.callerExt);
          if (!callerId) continue;
          await prisma.callerMemorySummary.upsert({
            where: { callerId },
            update: {
              factCount: s.factCount, preferenceCount: s.preferenceCount,
              eventCount: s.eventCount, topicCount: s.topicCount,
              keyFacts: s.keyFacts, topTopics: s.topTopics, preferences: s.preferences,
              lastMemoryAt: new Date(), lastAggregatedAt: new Date(),
            },
            create: {
              callerId,
              factCount: s.factCount, preferenceCount: s.preferenceCount,
              eventCount: s.eventCount, topicCount: s.topicCount,
              keyFacts: s.keyFacts, topTopics: s.topTopics, preferences: s.preferences,
              lastMemoryAt: new Date(), lastAggregatedAt: new Date(),
            },
          });
          fSummaries++;
        }
      }

      // Personality Profiles (4 — enriched with 46 params each)
      if (fixtures.personalityProfiles?.length) {
        for (const p of fixtures.personalityProfiles) {
          const callerId = callerExtToId.get(p.callerExt);
          if (!callerId) continue;
          await prisma.callerPersonalityProfile.upsert({
            where: { callerId },
            update: { parameterValues: p.parameterValues, callsUsed: p.callsUsed, specsUsed: p.specsUsed, lastUpdatedAt: new Date() },
            create: { callerId, parameterValues: p.parameterValues, callsUsed: p.callsUsed, specsUsed: p.specsUsed, lastUpdatedAt: new Date() },
          });
          fProfiles++;
        }
      }

      // Composed Prompts (14 — includes full session prompts)
      if (fixtures.composedPrompts?.length) {
        for (const p of fixtures.composedPrompts) {
          const callerId = callerExtToId.get(p.callerExt);
          if (!callerId) continue;
          const triggerCallId = p.triggerCallExt ? callExtToId.get(p.triggerCallExt) ?? null : null;
          await prisma.composedPrompt.create({
            data: {
              callerId, playbookId: playbook.id,
              prompt: p.prompt, triggerType: p.triggerType,
              triggerCallId, model: p.model, status: p.status,
              composedAt: daysAgo(2),
            },
          });
          fPrompts++;
        }
      }

      // Reward Scores (12)
      if (fixtures.rewardScores?.length) {
        const batch = [];
        for (const r of fixtures.rewardScores) {
          const callId = callExtToId.get(r.callExt);
          if (!callId) continue;
          batch.push({
            callId,
            overallScore: r.overallScore as number,
            modelVersion: r.modelVersion as string,
            scoredBy: r.scoredBy as string | null,
            parameterDiffs: r.parameterDiffs ?? undefined,
            outcomeSignals: r.outcomeSignals ?? undefined,
            goalProgressScore: r.goalProgressScore ?? undefined,
          });
        }
        if (batch.length > 0) {
          await prisma.rewardScore.createMany({ data: batch });
          fRewards = batch.length;
        }
      }

      // Call Targets (427)
      if (fixtures.callTargets?.length) {
        const batch = [];
        for (const t of fixtures.callTargets) {
          const callId = callExtToId.get(t.callExt);
          if (!callId || !paramExists(t.param)) continue;
          batch.push({
            callId, parameterId: t.param as string,
            targetValue: t.targetValue as number,
            reasoning: t.reasoning as string | null,
          });
        }
        if (batch.length > 0) {
          await prisma.callTarget.createMany({ data: batch });
          fTargets = batch.length;
        }
      }

      // Behavior Measurements (552)
      if (fixtures.behaviorMeasurements?.length) {
        const batch = [];
        for (const b of fixtures.behaviorMeasurements) {
          const callId = callExtToId.get(b.callExt);
          if (!callId || !paramExists(b.param)) continue;
          batch.push({
            callId, parameterId: b.param as string,
            actualValue: b.actualValue as number,
            confidence: (b.confidence as number | null) ?? undefined,
            evidence: b.evidence as string[],
            measuredBy: b.measuredBy as string | null,
          });
        }
        if (batch.length > 0) {
          await prisma.behaviorMeasurement.createMany({ data: batch });
          fBehaviors = batch.length;
        }
      }

      console.log(`  Pipeline fixtures loaded:`);
      console.log(`     Scores:       ${fScores}`);
      console.log(`     Memories:     ${fMemories}`);
      console.log(`     Summaries:    ${fSummaries}`);
      console.log(`     Profiles:     ${fProfiles}`);
      console.log(`     Prompts:      ${fPrompts}`);
      console.log(`     Rewards:      ${fRewards}`);
      console.log(`     Targets:      ${fTargets}`);
      console.log(`     Behaviors:    ${fBehaviors}`);
    }

    // ── Summary ──
    console.log(`\n  ✅ Demo course seeded:`);
    console.log(`     Playbook:   Introduction to Psychology`);
    console.log(`     Curriculum: ${MODULES.length} modules, ${loRefToId.size} LOs, ${ASSERTIONS.length} assertions`);
    console.log(`     Learners:   ${LEARNERS.length}`);
    console.log(`     Calls:      ${totalCalls}`);
    console.log(`     Goals:      ${totalGoals}`);
  } finally {
    if (!externalPrisma) await prisma.$disconnect();
  }
}

// Allow standalone execution
if (require.main === module) {
  main().catch((e) => {
    console.error("Demo course seed failed:", e);
    process.exit(1);
  });
}
