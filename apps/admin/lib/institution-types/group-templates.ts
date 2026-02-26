/**
 * Standard group templates for each institution type.
 *
 * Each TemplateSet provides a ready-made departmental structure.
 * Templates with `isDefault: true` are auto-suggested on the
 * departments first-run page when the institution type matches.
 *
 * Pattern: static data file, same as sector-config.ts.
 */

import type { GroupType } from "@prisma/client";

export interface GroupTemplate {
  name: string;
  groupType: GroupType;
  styleNotes?: string;
}

export interface TemplateSet {
  id: string;
  label: string;
  description: string;
  forTypes: string[]; // institution type slugs
  isDefault?: boolean;
  groups: GroupTemplate[];
}

// ─── School Templates ────────────────────────────────────────

const ukSecondary: TemplateSet = {
  id: "uk-secondary",
  label: "UK Secondary School",
  description:
    "12 departments and Year 7-13 year groups for a typical UK secondary school.",
  forTypes: ["school"],
  isDefault: true,
  groups: [
    {
      name: "English",
      groupType: "DEPARTMENT",
      styleNotes:
        "Expressive, discussion-led, encourages creative and analytical thinking",
    },
    {
      name: "Mathematics",
      groupType: "DEPARTMENT",
      styleNotes:
        "Logical reasoning, step-by-step problem solving, precise terminology",
    },
    {
      name: "Science",
      groupType: "DEPARTMENT",
      styleNotes:
        "Inquiry-based, hypothesis formation, evidence-driven reasoning",
    },
    {
      name: "History",
      groupType: "DEPARTMENT",
      styleNotes:
        "Source analysis, contextual thinking, balanced interpretation",
    },
    {
      name: "Geography",
      groupType: "DEPARTMENT",
      styleNotes:
        "Case-study driven, spatial reasoning, data interpretation",
    },
    {
      name: "Modern Foreign Languages",
      groupType: "DEPARTMENT",
      styleNotes:
        "Immersive, conversational practice, cultural awareness",
    },
    {
      name: "Computing",
      groupType: "DEPARTMENT",
      styleNotes:
        "Logical decomposition, computational thinking, debugging mindset",
    },
    {
      name: "PE",
      groupType: "DEPARTMENT",
      styleNotes:
        "Encouraging, performance-focused, tactical awareness",
    },
    {
      name: "Art & Design",
      groupType: "DEPARTMENT",
      styleNotes:
        "Creative exploration, critique and reflection, visual literacy",
    },
    {
      name: "Music",
      groupType: "DEPARTMENT",
      styleNotes:
        "Listening skills, performance confidence, compositional thinking",
    },
    {
      name: "Drama",
      groupType: "DEPARTMENT",
      styleNotes:
        "Expressive confidence, ensemble awareness, reflective practice",
    },
    {
      name: "Religious Education",
      groupType: "DEPARTMENT",
      styleNotes:
        "Respectful enquiry, philosophical questioning, diverse perspectives",
    },
    { name: "Year 7", groupType: "YEAR_GROUP" },
    { name: "Year 8", groupType: "YEAR_GROUP" },
    { name: "Year 9", groupType: "YEAR_GROUP" },
    { name: "Year 10", groupType: "YEAR_GROUP" },
    { name: "Year 11", groupType: "YEAR_GROUP" },
    { name: "Year 12", groupType: "YEAR_GROUP" },
    { name: "Year 13", groupType: "YEAR_GROUP" },
  ],
};

const ukPrimary: TemplateSet = {
  id: "uk-primary",
  label: "UK Primary School",
  description:
    "7 subject areas and Reception through Year 6 for UK primary schools.",
  forTypes: ["school"],
  groups: [
    {
      name: "English & Literacy",
      groupType: "DEPARTMENT",
      styleNotes: "Phonics-aware, story-led, age-appropriate vocabulary",
    },
    {
      name: "Mathematics & Numeracy",
      groupType: "DEPARTMENT",
      styleNotes: "Concrete-pictorial-abstract, growth mindset, manipulatives",
    },
    {
      name: "Science",
      groupType: "DEPARTMENT",
      styleNotes: "Curiosity-driven, hands-on exploration, observation skills",
    },
    {
      name: "Humanities",
      groupType: "DEPARTMENT",
      styleNotes: "Topic-based, cross-curricular, local and global awareness",
    },
    {
      name: "Creative Arts",
      groupType: "DEPARTMENT",
      styleNotes: "Free expression, process over product, imaginative play",
    },
    {
      name: "PE & Wellbeing",
      groupType: "DEPARTMENT",
      styleNotes: "Active participation, teamwork, personal best",
    },
    {
      name: "Computing & Technology",
      groupType: "DEPARTMENT",
      styleNotes: "Digital literacy, online safety, logical sequencing",
    },
    { name: "Reception", groupType: "YEAR_GROUP" },
    { name: "Year 1", groupType: "YEAR_GROUP" },
    { name: "Year 2", groupType: "YEAR_GROUP" },
    { name: "Year 3", groupType: "YEAR_GROUP" },
    { name: "Year 4", groupType: "YEAR_GROUP" },
    { name: "Year 5", groupType: "YEAR_GROUP" },
    { name: "Year 6", groupType: "YEAR_GROUP" },
  ],
};

const usHigh: TemplateSet = {
  id: "us-high",
  label: "US High School",
  description: "8 departments and Grades 9-12 for a US high school.",
  forTypes: ["school"],
  groups: [
    {
      name: "English Language Arts",
      groupType: "DEPARTMENT",
      styleNotes: "Critical reading, essay writing, rhetoric and argument",
    },
    {
      name: "Mathematics",
      groupType: "DEPARTMENT",
      styleNotes: "Algebra through calculus, proofs, real-world applications",
    },
    {
      name: "Science",
      groupType: "DEPARTMENT",
      styleNotes: "Lab-based inquiry, scientific method, data analysis",
    },
    {
      name: "Social Studies",
      groupType: "DEPARTMENT",
      styleNotes: "Primary sources, civic engagement, multiple perspectives",
    },
    {
      name: "World Languages",
      groupType: "DEPARTMENT",
      styleNotes: "Communicative approach, cultural competence",
    },
    {
      name: "Fine Arts",
      groupType: "DEPARTMENT",
      styleNotes: "Creative expression, portfolio development, critique",
    },
    {
      name: "Physical Education",
      groupType: "DEPARTMENT",
      styleNotes: "Fitness, sportsmanship, health literacy",
    },
    {
      name: "Career & Technical Education",
      groupType: "DEPARTMENT",
      styleNotes: "Practical skills, project-based, industry awareness",
    },
    { name: "Grade 9 (Freshman)", groupType: "YEAR_GROUP" },
    { name: "Grade 10 (Sophomore)", groupType: "YEAR_GROUP" },
    { name: "Grade 11 (Junior)", groupType: "YEAR_GROUP" },
    { name: "Grade 12 (Senior)", groupType: "YEAR_GROUP" },
  ],
};

// ─── Corporate Templates ─────────────────────────────────────

const corporateStandard: TemplateSet = {
  id: "corporate-standard",
  label: "Corporate Standard",
  description: "8 standard corporate divisions for business environments.",
  forTypes: ["corporate"],
  isDefault: true,
  groups: [
    {
      name: "Sales & Business Development",
      groupType: "DIVISION",
      styleNotes: "Results-oriented, client-focused, persuasion skills",
    },
    {
      name: "Marketing",
      groupType: "DIVISION",
      styleNotes: "Creative strategy, data-driven decisions, brand awareness",
    },
    {
      name: "Engineering",
      groupType: "DIVISION",
      styleNotes: "Technical precision, problem decomposition, systematic thinking",
    },
    {
      name: "Product",
      groupType: "DIVISION",
      styleNotes: "User empathy, prioritization frameworks, outcome-focused",
    },
    {
      name: "People & HR",
      groupType: "DIVISION",
      styleNotes: "Empathetic communication, policy clarity, development-focused",
    },
    {
      name: "Finance",
      groupType: "DIVISION",
      styleNotes: "Analytical precision, risk awareness, regulatory compliance",
    },
    {
      name: "Operations",
      groupType: "DIVISION",
      styleNotes: "Process optimization, efficiency, continuous improvement",
    },
    {
      name: "Customer Success",
      groupType: "DIVISION",
      styleNotes: "Relationship building, proactive support, retention-focused",
    },
  ],
};

const corporateSmall: TemplateSet = {
  id: "corporate-small",
  label: "Small Business",
  description: "3 broad divisions for smaller organizations.",
  forTypes: ["corporate"],
  groups: [
    {
      name: "Commercial",
      groupType: "DIVISION",
      styleNotes: "Revenue-focused, client relationship management",
    },
    {
      name: "Technical",
      groupType: "DIVISION",
      styleNotes: "Building and maintaining, problem solving",
    },
    {
      name: "Operations & Admin",
      groupType: "DIVISION",
      styleNotes: "Process, people, and compliance",
    },
  ],
};

// ─── Training Templates ──────────────────────────────────────

const trainingTracks: TemplateSet = {
  id: "training-tracks",
  label: "Training Tracks",
  description: "5 progressive training tracks for professional development.",
  forTypes: ["training"],
  isDefault: true,
  groups: [
    {
      name: "Leadership",
      groupType: "TRACK",
      styleNotes: "Reflective practice, scenario-based, executive presence",
    },
    {
      name: "Technical Skills",
      groupType: "TRACK",
      styleNotes: "Hands-on exercises, certification prep, troubleshooting",
    },
    {
      name: "Communication",
      groupType: "TRACK",
      styleNotes: "Active listening, presentation skills, written clarity",
    },
    {
      name: "Compliance & Safety",
      groupType: "TRACK",
      styleNotes: "Regulatory focus, case-study based, assessment-driven",
    },
    {
      name: "Onboarding",
      groupType: "TRACK",
      styleNotes: "Welcoming, culture-building, progressive complexity",
    },
  ],
};

// ─── Healthcare Templates ────────────────────────────────────

const healthcareClinical: TemplateSet = {
  id: "healthcare-clinical",
  label: "Clinical Departments",
  description: "6 clinical units for healthcare facilities.",
  forTypes: ["healthcare"],
  isDefault: true,
  groups: [
    {
      name: "Nursing",
      groupType: "DEPARTMENT",
      styleNotes: "Patient-centred, evidence-based, compassionate communication",
    },
    {
      name: "Medical",
      groupType: "DEPARTMENT",
      styleNotes: "Clinical reasoning, differential diagnosis, precise terminology",
    },
    {
      name: "Allied Health",
      groupType: "DEPARTMENT",
      styleNotes: "Interdisciplinary, rehabilitation-focused, patient empowerment",
    },
    {
      name: "Mental Health",
      groupType: "DEPARTMENT",
      styleNotes: "Trauma-informed, therapeutic rapport, non-judgmental",
    },
    {
      name: "Emergency",
      groupType: "DEPARTMENT",
      styleNotes: "Rapid triage, protocol-driven, calm under pressure",
    },
    {
      name: "Administration",
      groupType: "DEPARTMENT",
      styleNotes: "Compliance, efficiency, service coordination",
    },
  ],
};

// ─── Coaching Templates ──────────────────────────────────────

const coachingStandard: TemplateSet = {
  id: "coaching-standard",
  label: "Coaching Practice",
  description: "4 coaching tracks for coaching and mentoring practices.",
  forTypes: ["coaching"],
  isDefault: true,
  groups: [
    {
      name: "Executive Coaching",
      groupType: "TRACK",
      styleNotes: "Strategic thinking, leadership presence, accountability",
    },
    {
      name: "Career Coaching",
      groupType: "TRACK",
      styleNotes: "Goal clarity, strengths-based, action planning",
    },
    {
      name: "Life Coaching",
      groupType: "TRACK",
      styleNotes: "Holistic, values-aligned, motivational",
    },
    {
      name: "Team Coaching",
      groupType: "TRACK",
      styleNotes: "Group dynamics, collaboration, collective intelligence",
    },
  ],
};

// ─── Community Templates ─────────────────────────────────────

const communityInterest: TemplateSet = {
  id: "community-interest",
  label: "Interest-Based Community",
  description: "4 interest circles for community organizations.",
  forTypes: ["community"],
  isDefault: true,
  groups: [
    {
      name: "Learning Circle",
      groupType: "CUSTOM",
      styleNotes: "Peer-led, curiosity-driven, shared discovery",
    },
    {
      name: "Support Circle",
      groupType: "CUSTOM",
      styleNotes: "Safe space, empathetic listening, peer support",
    },
    {
      name: "Action Circle",
      groupType: "CUSTOM",
      styleNotes: "Project-focused, collective action, accountability",
    },
    {
      name: "Social Circle",
      groupType: "CUSTOM",
      styleNotes: "Connection-building, informal, welcoming",
    },
  ],
};

// ─── Export ──────────────────────────────────────────────────

export const TEMPLATE_SETS: TemplateSet[] = [
  // School
  ukSecondary,
  ukPrimary,
  usHigh,
  // Corporate
  corporateStandard,
  corporateSmall,
  // Training
  trainingTracks,
  // Healthcare
  healthcareClinical,
  // Coaching
  coachingStandard,
  // Community
  communityInterest,
];

/**
 * Get the default template ID for an institution type slug.
 * Returns null if no default is configured.
 */
export function getDefaultTemplateId(typeSlug: string): string | null {
  const match = TEMPLATE_SETS.find(
    (t) => t.forTypes.includes(typeSlug) && t.isDefault
  );
  return match?.id || null;
}

/**
 * Find a template by its ID.
 */
export function getTemplateById(id: string): TemplateSet | undefined {
  return TEMPLATE_SETS.find((t) => t.id === id);
}
