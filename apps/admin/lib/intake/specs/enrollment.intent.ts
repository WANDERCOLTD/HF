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
  ageBand,
  AGE_BAND_VALUES,
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

// AGE_BAND_VALUES is re-exported from @tallyseal/regulations-gdpr via
// the boundary facade. Identical tuple shape to the prior local
// AGE_RANGE_VALUES — kept the `ageRange` field name to avoid
// disturbing existing data, but bound to the canonical regulation
// value set so ageBand.adultOnly accepts it without coercion.
const CONTACT_METHOD_VALUES = ["email", "in-app"] as const;

/**
 * Field keys the learner must NEVER see + the AI must NEVER set —
 * set by code paths (URL token, bootstrap resolution, derived from
 * other fields). Single source of truth: imported by the chat route
 * (excludes from the AI `update-setup` tool) and the chat UI
 * (filters the IntentForm + ValuesPanel).
 */
export const INTERNAL_FIELDS = [
  "processesArt9",
  "art9Exemption",
  "classroomToken",
  "classroomName",
] as const;

/**
 * Field keys that must be captured before this intent's `readiness()`
 * gate returns true. SINGLE SOURCE OF TRUTH — `readiness()` below
 * iterates this list, and `specToSystemPrompt()` in spec-tools.ts
 * reads it to frame the prompt's required/optional split.
 *
 * Add a new required field: append the key here and add the field
 * declaration below. Nothing else to edit — the chat prompt, the
 * readiness gate, and (after #1129) the recap UI all derive from this.
 *
 * When the CRUD surface lands, this list is what an admin toggles
 * "required" on in the field editor.
 */
export const REQUIRED_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "ageRange",
] as const;

// Adult-learner basic email pattern. NOT RFC-5322 complete — we use a
// pragmatic check matching the join form's existing behaviour. Real
// validation happens server-side via deliverability check (deferred).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// E.164-ish phone pattern — optional `+`, 7–15 digits. The join route
// already strips spaces/dashes/parens via the same normalisation as
// `/api/join/[token]:140-143`, so the pattern here is the post-strip
// shape. Permissive on purpose; deliverability check is deferred to
// the SMS provider when slice B of #1101 lands.
const PHONE_PATTERN = /^\+?\d{7,15}$/;

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

    // Optional but actively asked — phone enables Call Me sessions (PSTN
    // outbound dial from the sim) without the mid-call JIT capture, and
    // is a prerequisite for the SMS channel of #1101 (first-call PIN by
    // SMS, currently stubbed). Skipping is fine — Call Me falls back to
    // the JIT prompt and PIN still delivers by email.
    phone: field
      .string()
      .optional()
      .label({ en: "Phone number" })
      .askHint({
        en: "What's a good phone number for Call Me sessions? Optional — leave blank if you don't want SMS or phone calls.",
      })
      .validates((v) => typeof v !== "string" || PHONE_PATTERN.test(v.replace(/[\s\-()]/g, ""))),

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
      .enum(AGE_BAND_VALUES)
      .required()
      .label({ en: "Age range" })
      .askHint({ en: "Roughly what age band are you in? (You can say 'prefer not to say'.)" }),

    // ── Internal — Art 9 gate machinery ───────────────────────────
    // Populated by the spec's reducer / AI tool layer (not user input)
    // when `accessibilityNote` is non-empty.
    processesArt9: field.boolean().optional().defaultValue(false),
    art9Exemption: field.string().optional(),

    // ── Course routing (Option B from PR-993 thread) ──────────────
    // classroomToken comes from the URL path (/intake/enrollment-crawcus/[token]).
    // Bootstrap resolves it via /api/join/:token and writes classroomName.
    // Enrolment without a token is permitted (platform-level demo) — the
    // enrollment.classroom-resolved Contract is post-condition and only
    // fires when classroomToken is set.
    classroomToken: field.string().optional(),
    classroomName: field.string().optional(),
  },

  readiness: (ctx: unknown) => {
    const { has } = ctx as { has: (...keys: string[]) => boolean };
    return has(...REQUIRED_FIELDS);
  },

  contracts: {
    pre: [
      // 1. GDPR Art 13 — privacy notice must be delivered before any
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

      // 2. EU AI Act Art 50(1) — AI-interaction disclosure must be
      //    delivered before any AI-mediated turn fires.
      aiInteractionDisclosure({
        disclosureRequirementId: ART50_REQUIREMENT_ID,
      }),
    ],

    invariants: [
      // 3. Adult-only — snapshot must never contain ageRange === 'under-18'.
      //    Regulation-pack factory (regulations-gdpr 0.3.x ageBand.adultOnly)
      //    replaces the prior home-grown enrollment.adult-only contract:
      //    same semantic, plus regulation-pack provenance + held as an
      //    invariant rather than a pre-condition (so a post-capture write
      //    of 'under-18' cannot slip past). Permits 'prefer-not-to-say'
      //    as defensible adult-only posture. Spread because adultOnly()
      //    returns Contract[] (sibling factories return a single Contract
      //    — inconsistency tracked for tallyseal feedback).
      ...ageBand.adultOnly({ ageBandField: "ageRange" }),

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

      // 4a. phone format invariant — when phone is supplied, it must
      //     normalise to a 7–15-digit E.164-ish shape. Same audit chain
      //     as email; absent phone is permitted (field is optional).
      defineContract({
        id: "enrollment.phone.format-valid",
        description: { en: "Phone field, when supplied, must match basic E.164 pattern after stripping separators." },
        predicate: ({ value }) => {
          const p = value<string>("phone");
          if (p === undefined || p === "") return true;
          return PHONE_PATTERN.test(p.replace(/[\s\-()]/g, ""));
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

      // 7. Classroom-resolved — IF classroomToken is set, a
      //    ClassroomResolved custom event must exist on the log
      //    (proves the token was validated via /api/join/:token).
      defineContract({
        id: "enrollment.classroom-resolved",
        description: {
          en: "If classroomToken is set, the token must have been validated and a ClassroomResolved event written.",
        },
        predicate: ({ value, eventsOfKind }) => {
          const token = value<string>("classroomToken");
          if (!token) return true; // platform-level demo path
          const resolved = eventsOfKind("ClassroomResolved" as never);
          return resolved.some((e) => {
            const payload = e.payload as { classroomToken?: string } | undefined;
            return payload?.classroomToken === token;
          });
        },
      }),
    ],
  },
});
