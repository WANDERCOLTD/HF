/**
 * Document Skeleton Templates
 *
 * 3 reusable authoring templates for content creation. These define the ideal
 * structure of documents that educators upload or generate for their courses.
 *
 * Use cases:
 *   1. Content wizard — "Start from template" with pre-filled structure
 *   2. AI generation — structural prompt for Claude to generate consistent documents
 *
 * These are authoring templates, NOT runtime constructs. Documents still get
 * extracted normally regardless of whether they started from a skeleton.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type DocumentSkeletonType = "READING_PASSAGE" | "QUESTION_BANK" | "COURSE_REFERENCE";

export interface SkeletonField {
  /** JSON path key */
  key: string;
  /** Human-readable label */
  label: string;
  /** Data type hint */
  type: "string" | "number" | "string[]" | "object" | "object[]";
  /** Example value for the template */
  example?: string | number | string[] | null;
  /** Whether this field is required */
  required?: boolean;
  /** Nested fields (for object/object[] types) */
  children?: SkeletonField[];
}

export interface DocumentSkeleton {
  type: DocumentSkeletonType;
  label: string;
  description: string;
  icon: string;
  /** The structural template as a nested field definition */
  fields: SkeletonField[];
  /** A blank JSON object matching the skeleton structure (for pre-filling forms) */
  blankTemplate: Record<string, unknown>;
}

// ── Skeleton Definitions ─────────────────────────────────────────────────────

const READING_PASSAGE_SKELETON: DocumentSkeleton = {
  type: "READING_PASSAGE",
  label: "Reading Passage",
  description: "Fiction, non-fiction, or descriptive text for close reading and comprehension work.",
  icon: "book-open",
  fields: [
    { key: "metadata.title", label: "Title", type: "string", example: "There Is No One Left", required: true },
    { key: "metadata.author", label: "Author", type: "string", example: "Frances Hodgson Burnett" },
    { key: "metadata.source", label: "Source", type: "string", example: "The Secret Garden, Chapter I" },
    { key: "metadata.wordCount", label: "Word count", type: "number", example: 491 },
    { key: "metadata.textType", label: "Text type", type: "string", example: "Fiction" },
    { key: "metadata.difficulty", label: "Difficulty", type: "string", example: "standard" },
    { key: "metadata.recommendedSession", label: "Recommended session", type: "string", example: "Session 1" },
    { key: "metadata.primarySkills", label: "Primary skills", type: "string[]", example: ["retrieval", "inference", "vocabulary"] },
    { key: "passage", label: "Passage text", type: "string", required: true },
  ],
  blankTemplate: {
    metadata: {
      title: "",
      author: "",
      source: "",
      wordCount: null,
      textType: "",
      difficulty: "",
      recommendedSession: "",
      primarySkills: [],
    },
    passage: "",
  },
};

const QUESTION_BANK_SKELETON: DocumentSkeleton = {
  type: "QUESTION_BANK",
  label: "Question Bank",
  description: "Skill-mapped questions with tiered responses and tutor moves for guided assessment.",
  icon: "help-circle",
  fields: [
    { key: "metadata.passageTitle", label: "Passage title", type: "string", example: "There Is No One Left", required: true },
    { key: "metadata.recommendedSession", label: "Recommended session", type: "string", example: "Session 1 (Baseline & Rapport)" },
    { key: "metadata.sessionObjective", label: "Session objective", type: "string", example: "Baseline assessment via comfortable content" },
    { key: "metadata.recommendedSequence", label: "Recommended skill sequence", type: "string[]", example: ["retrieval", "inference", "vocabulary", "language_effect"] },
    {
      key: "skills", label: "Skills", type: "object[]", children: [
        { key: "skillId", label: "Skill ID", type: "string", example: "SKILL-01", required: true },
        { key: "skillName", label: "Skill name", type: "string", example: "Retrieval", required: true },
        { key: "skillDescription", label: "Skill description", type: "string", example: "Locating explicit information in the text" },
        { key: "sessionRole", label: "Session role", type: "string", example: "warm-up" },
        {
          key: "questions", label: "Questions", type: "object[]", children: [
            { key: "id", label: "Question ID", type: "string", example: "1.1", required: true },
            { key: "tutorAsks", label: "Tutor asks", type: "string", example: "Where was Mary living at the start of the story?", required: true },
            { key: "followUp", label: "Follow-up prompt", type: "string" },
            { key: "textReference", label: "Text reference", type: "string", example: "Paragraph 1, line 3" },
            {
              key: "responses", label: "Tiered responses", type: "object", children: [
                {
                  key: "emerging", label: "Emerging", type: "object", children: [
                    { key: "example", label: "Student response", type: "string" },
                    { key: "tutorMove", label: "Tutor move", type: "string" },
                  ],
                },
                {
                  key: "developing", label: "Developing", type: "object", children: [
                    { key: "example", label: "Student response", type: "string" },
                    { key: "tutorMove", label: "Tutor move", type: "string" },
                  ],
                },
                {
                  key: "secure", label: "Secure", type: "object", children: [
                    { key: "example", label: "Student response", type: "string" },
                    { key: "tutorMove", label: "Tutor move", type: "string" },
                  ],
                },
              ],
            },
            { key: "assessmentNote", label: "Assessment note", type: "string" },
          ],
        },
      ],
    },
  ],
  blankTemplate: {
    metadata: {
      passageTitle: "",
      recommendedSession: "",
      sessionObjective: "",
      recommendedSequence: [],
    },
    skills: [
      {
        skillId: "",
        skillName: "",
        skillDescription: "",
        sessionRole: "",
        questions: [
          {
            id: "",
            tutorAsks: "",
            followUp: "",
            textReference: "",
            responses: {
              emerging: { example: "", tutorMove: "" },
              developing: { example: "", tutorMove: "" },
              secure: { example: "", tutorMove: "" },
            },
            assessmentNote: "",
          },
        ],
      },
    ],
  },
};

const COURSE_REFERENCE_SKELETON: DocumentSkeleton = {
  type: "COURSE_REFERENCE",
  label: "Course Reference",
  description: "Teaching methodology, skills framework, phases, and edge cases for a complete course.",
  icon: "clipboard-list",
  fields: [
    { key: "courseOverview.subject", label: "Subject", type: "string", example: "English reading comprehension", required: true },
    { key: "courseOverview.examContext", label: "Exam context", type: "string", example: "11+ selective school entrance exams" },
    { key: "courseOverview.studentAge", label: "Student age", type: "string", example: "9-11 (Year 5-6)" },
    { key: "courseOverview.delivery", label: "Delivery method", type: "string", example: "Voice call (12-15 minutes)" },
    { key: "courseOverview.courseLength", label: "Course length", type: "string", example: "12 sessions" },
    { key: "courseOverview.prerequisite", label: "Prerequisites", type: "string" },
    { key: "courseOverview.coreProposition", label: "Core proposition", type: "string", example: "A voice-based AI tutor that develops reading comprehension through Socratic questioning." },
    {
      key: "learningOutcomes.skillOutcomes", label: "Skill outcomes", type: "object[]", children: [
        { key: "id", label: "Outcome ID", type: "string", required: true },
        { key: "description", label: "Description", type: "string", required: true },
      ],
    },
    {
      key: "learningOutcomes.readinessOutcomes", label: "Readiness outcomes", type: "object[]", children: [
        { key: "id", label: "Outcome ID", type: "string", required: true },
        { key: "description", label: "Description", type: "string", required: true },
      ],
    },
    { key: "learningOutcomes.progressIndicators", label: "Progress indicators", type: "string" },
    {
      key: "skillsFramework", label: "Skills framework", type: "object[]", children: [
        { key: "id", label: "Skill ID", type: "string", example: "SKILL-01", required: true },
        { key: "name", label: "Skill name", type: "string", example: "Retrieval", required: true },
        { key: "description", label: "Description", type: "string" },
        {
          key: "tiers", label: "Proficiency tiers", type: "object", children: [
            { key: "emerging", label: "Emerging", type: "string" },
            { key: "developing", label: "Developing", type: "string" },
            { key: "secure", label: "Secure", type: "string" },
          ],
        },
      ],
    },
    { key: "skillDependencies", label: "Skill dependencies", type: "string[]", example: ["Inference depends on Retrieval"] },
    { key: "teachingApproach.corePrinciples", label: "Core principles", type: "string[]", example: ["Teach through questioning, not explanation"] },
    {
      key: "teachingApproach.sessionStructure.phases", label: "Session phases", type: "object[]", children: [
        { key: "name", label: "Phase name", type: "string", required: true },
        { key: "duration", label: "Duration", type: "string" },
        { key: "description", label: "Description", type: "string" },
      ],
    },
    {
      key: "teachingApproach.techniquesBySkill", label: "Techniques by skill", type: "object[]", children: [
        { key: "skillId", label: "Skill ID", type: "string" },
        { key: "technique", label: "Technique", type: "string" },
      ],
    },
    {
      key: "coursePhases", label: "Course phases", type: "object[]", children: [
        { key: "name", label: "Phase name", type: "string", required: true },
        { key: "sessions", label: "Sessions", type: "string", example: "1-3" },
        { key: "goal", label: "Goal", type: "string" },
        { key: "tutorBehaviour", label: "Tutor behaviour", type: "string[]" },
        { key: "skillFocusPerSession", label: "Skill focus per session", type: "string[]" },
        { key: "exitCriteria", label: "Exit criteria", type: "string[]" },
      ],
    },
    {
      key: "edgeCases", label: "Edge cases", type: "object[]", children: [
        { key: "scenario", label: "Scenario", type: "string" },
        { key: "response", label: "Response", type: "string" },
      ],
    },
    {
      key: "communicationRules", label: "Communication rules", type: "object", children: [
        {
          key: "toStudent", label: "To student", type: "object", children: [
            { key: "tone", label: "Tone", type: "string" },
            { key: "frequency", label: "Frequency", type: "string" },
          ],
        },
        {
          key: "toParent", label: "To parent", type: "object", children: [
            { key: "tone", label: "Tone", type: "string" },
            { key: "frequency", label: "Frequency", type: "string" },
            { key: "contentFormula", label: "Content formula", type: "string" },
          ],
        },
      ],
    },
    { key: "assessmentBoundaries", label: "Assessment boundaries", type: "string[]" },
    { key: "metrics", label: "Quality metrics", type: "string[]" },
  ],
  blankTemplate: {
    courseOverview: {
      subject: "",
      examContext: "",
      studentAge: "",
      delivery: "",
      courseLength: "",
      prerequisite: "",
      coreProposition: "",
    },
    learningOutcomes: {
      skillOutcomes: [],
      readinessOutcomes: [],
      progressIndicators: "",
    },
    skillsFramework: [],
    skillDependencies: [],
    teachingApproach: {
      corePrinciples: [],
      sessionStructure: { phases: [] },
      techniquesBySkill: [],
    },
    coursePhases: [],
    edgeCases: [],
    communicationRules: {
      toStudent: { tone: "", frequency: "" },
      toParent: { tone: "", frequency: "", contentFormula: "" },
    },
    assessmentBoundaries: [],
    metrics: [],
  },
};

// ── Exports ──────────────────────────────────────────────────────────────────

export const DOCUMENT_SKELETONS: Record<DocumentSkeletonType, DocumentSkeleton> = {
  READING_PASSAGE: READING_PASSAGE_SKELETON,
  QUESTION_BANK: QUESTION_BANK_SKELETON,
  COURSE_REFERENCE: COURSE_REFERENCE_SKELETON,
};
