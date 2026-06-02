// HF Phase 1 enrolment intake — adult-learner adaptation of the
// tallyseal Sprint C handoff schema.
//
// Mirrors HF's existing 3-field join form (firstName / lastName / email
// at app/join/[token]/page.tsx) plus 6 optional fields covering the
// distinct shape taxonomy (string/boolean/enum, personal/none/sensitive,
// typed/defaulted/options) — see GitHub issue #993 § "Phase 1 — Spec
// taxonomy probe (locked scope)" for the full rationale.
//
// V5 wizard untouched. This is a parallel surface at
// /intake/enrollment-crawcus.

import {
  defineCrawcusSpec,
  defineContract,
  field,
  // GDPR
  specialCategoryProhibition,
  // EU AI Act
  humanOversight,
  aiInteractionDisclosure,
  type CrawcusSpec,
  type IntentKey,
  type ProjectionName,
  type Locale,
} from "../tallyseal";

// ── Shared identifiers ─────────────────────────────────────────────
const INTAKE_KEY = "EnrollmentIntake" as IntentKey;
const PROJECTION = "IntakeApplication" as ProjectionName;

const ART13_REQUIREMENT_ID = "gdpr.art13.privacy-notice";
const ART50_REQUIREMENT_ID = "eu-ai-act.art50.ai-interaction-disclosure";

const AGE_RANGE_VALUES = [
  "under-18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65-plus",
  "prefer-not-to-say",
] as const;

const CONTACT_METHOD_VALUES = ["email", "in-app"] as const;

// Adult-learner basic email pattern. NOT RFC-5322 complete — we use a
// pragmatic check matching the join form's existing behaviour. Real
// validation happens server-side via deliverability check (deferred).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Spec ───────────────────────────────────────────────────────────
export const EnrollmentIntake: CrawcusSpec = defineCrawcusSpec({
  key: INTAKE_KEY,
  projection: PROJECTION,
  version: 1,
  classification: "standard",
  i18nDefault: "en" as Locale,

  fields: {
    // ── Required (mirrors existing join form) ─────────────────────
    firstName: field
      .string()
      .required()
      .label({ en: "First name" })
      .askHint({ en: "What's your first name?" }),

    lastName: field
      .string()
      .required()
      .label({ en: "Last name" })
      .askHint({ en: "And your last name?" }),

    email: field
      .string()
      .required()
      .label({ en: "Email" })
      .askHint({ en: "What email should we use for this enrolment?" })
      .validates((v) => typeof v === "string" && EMAIL_PATTERN.test(v)),

    // ── Optional — one per distinct shape ─────────────────────────
    displayName: field
      .string()
      .optional()
      .label({ en: "Display name" })
      .askHint({ en: "Anything else we should call you?" }),

    timezone: field
      .string()
      .optional()
      .label({ en: "Timezone" })
      .askHint({ en: "What timezone are you in?" })
      .defaultValue(() => {
        try {
          return new Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
        } catch {
          return "Etc/UTC";
        }
      }),

    preferredContactMethod: field
      .enum(CONTACT_METHOD_VALUES)
      .optional()
      .label({ en: "Preferred contact method" })
      .askHint({ en: "How should we reach you?" }),

    marketingOptIn: field
      .boolean()
      .optional()
      .label({ en: "Marketing opt-in" })
      .askHint({ en: "Want occasional product updates? (Optional, no spam.)" })
      .defaultValue(false),

    accessibilityNote: field
      .string()
      .optional()
      .label({ en: "Accessibility note" })
      .askHint({
        en: "Anything we can do to make this course work better for you? (Optional)",
      }),

    ageRange: field
      .enum(AGE_RANGE_VALUES)
      .optional()
      .label({ en: "Age range" })
      .askHint({ en: "Roughly what age band are you in?" }),

    // ── Internal — Art 9 gate machinery ───────────────────────────
    // Populated by the spec's reducer / AI tool layer (not user input)
    // when `accessibilityNote` is non-empty.
    processesArt9: field.boolean().optional().defaultValue(false),
    art9Exemption: field.string().optional(),
  },

  readiness: (ctx: unknown) => {
    const { has } = ctx as { has: (...keys: string[]) => boolean };
    return has("firstName", "lastName", "email");
  },

  contracts: {
    pre: [
      // 1. Adult-only — rejects under-18 selection. Provides Phase 1
      //    rejection-path coverage; emits ContractViolation event.
      defineContract({
        id: "enrollment.adult-only",
        description: {
          en: "Enrolment is restricted to learners 18 and over. Selecting 'under-18' rejects the application before commit.",
        },
        predicate: ({ value }) => {
          const age = value<string>("ageRange");
          return age !== "under-18";
        },
      }),

      // 2. GDPR Art 13 — privacy notice must be delivered before any
      //    field-capturing turn fires.
      defineContract({
        id: "enrollment.pre.privacy-notice-delivered",
        description: {
          en: "GDPR Article 13 privacy notice must be delivered to the data subject before any field is captured.",
        },
        predicate: ({ eventsOfKind }) => {
          const delivered = eventsOfKind("DisclosureDelivered");
          return delivered.some((e) => {
            const payload = e.payload as { requirementId?: string } | undefined;
            return payload?.requirementId === ART13_REQUIREMENT_ID;
          });
        },
      }),

      // 3. EU AI Act Art 50(1) — AI-interaction disclosure must be
      //    delivered before any AI-mediated turn fires.
      aiInteractionDisclosure({
        disclosureRequirementId: ART50_REQUIREMENT_ID,
      }),
    ],

    invariants: [
      // 4. email format invariant — distinct from .validates() because
      //    it is named, citable, and recorded as a ContractEvaluationResult.
      defineContract({
        id: "enrollment.email.format-valid",
        description: { en: "Email field must match basic RFC-5322-lite pattern." },
        predicate: ({ value }) => {
          const e = value<string>("email");
          return e === undefined || EMAIL_PATTERN.test(e);
        },
      }),

      // 5. GDPR Art 22 / Art 9 — special-category processing only with
      //    explicit consent. accessibilityNote being populated flips
      //    processesArt9 to true; consent must populate art9Exemption.
      specialCategoryProhibition({
        processesSpecialCategoryField: "processesArt9",
        art9ExemptionField: "art9Exemption",
        permittedArt9Exemptions: ["art9-2-a"], // explicit consent only
      }),
    ],

    post: [
      // 6. EU AI Act Art 14 — human oversight required at commit.
      //    Tallyseal's Suggestion-lifecycle (accept/edit/reject) IS the
      //    Art 14 implementation; the post-Contract asserts oversight
      //    happened on the AI-mediated events.
      humanOversight(),
    ],
  },
});
