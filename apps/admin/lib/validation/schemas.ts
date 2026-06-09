/**
 * Shared Zod schemas for API input validation.
 * Used by public-facing routes (invite, join, auth) to validate request bodies.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Reusable atoms
// ---------------------------------------------------------------------------

export const emailSchema = z.string().email("Invalid email address").max(254).trim().toLowerCase();
export const nameSchema = z.string().min(1, "Name is required").max(100).trim();
export const tokenSchema = z.string().min(1, "Token is required").max(256);

/**
 * GDPR age-band enum. Source of truth: `AGE_BAND_VALUES` from
 * `@tallyseal/regulations-gdpr` (re-exported via `@/lib/intake/tallyseal`).
 * Inlined here to keep `lib/validation/` free of intake/tallyseal coupling.
 * Keep in sync if the upstream tuple changes.
 */
const AGE_BAND_VALUES = [
  "under-18",
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65-plus",
  "prefer-not-to-say",
] as const;
export const ageBandSchema = z.enum(AGE_BAND_VALUES);

// ---------------------------------------------------------------------------
// Route-specific schemas
// ---------------------------------------------------------------------------

/** POST /api/invite/accept */
export const inviteAcceptSchema = z.object({
  token: tokenSchema,
  firstName: nameSchema,
  lastName: nameSchema,
});

/** POST /api/join/[token] */
export const joinPostSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  /**
   * Age band declared at intake. Propagated to `CallerAttribute` keyed
   * `intake.ageRange` (scope `GLOBAL`) so the adult-only declaration
   * has a persisted compliance trail post-handoff. `under-18` is the
   * `ageBand.adultOnly()` rejected value — the intake spec gate
   * (`isReady()` in `/api/intake/chat`) blocks it before the user
   * reaches this endpoint; the route handler still defensively rejects
   * it here against URL tampering. See #1036.
   */
  ageRange: ageBandSchema.optional(),
  /** Enroll in a specific course (playbook) instead of all cohort playbooks */
  playbookId: z.string().uuid().optional(),
  /** Skip onboarding wizard + surveys — go straight to teaching */
  skipOnboarding: z.boolean().optional(),
  /**
   * Optional learner phone number captured during enrollment. Required
   * by the PSTN dial-out "Call me" path (the AnyVoice [Call me] button
   * uses VAPI to ring this number). Stored on `Caller.phone` in E.164.
   * If absent the SimChat just-in-time prompt captures it at click-time.
   */
  phone: z.string().trim().min(7).max(20).optional(),
  /**
   * Optional intent id from the in-flight intake-chat session
   * (`intent-<uuid>` shape). Used by the join handler to link the
   * resulting `Session(kind=ENROLLMENT)` row back to the IntakeEvent
   * hash chain (Slice 2 / #1343). When absent the join still succeeds —
   * the legacy three-field join form has no `intentId`.
   */
  intentId: z.string().trim().min(1).max(80).optional(),
});

/** POST /api/auth/login (superadmin token auth) */
export const authLoginSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

/** POST /api/auth/forgot-password */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/** POST /api/auth/reset-password */
export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

const entityBreadcrumbSchema = z.object({
  type: z.string(),
  id: z.string(),
  label: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** POST /api/chat */
export const chatRequestSchema = z.object({
  message: z.string().min(1, "Message is required").max(50_000),
  mode: z.enum(["DATA", "CALL", "BUG", "WIZARD", "COURSE_REF"]),
  entityContext: z.array(entityBreadcrumbSchema).default([]),
  conversationHistory: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })).default([]),
  isCommand: z.boolean().optional(),
  engine: z.string().optional(),
  callId: z.string().optional(),
  bugContext: z.object({
    url: z.string(),
    errors: z.array(z.object({
      message: z.string(),
      source: z.string().optional(),
      timestamp: z.number(),
      status: z.number().optional(),
      stack: z.string().optional(),
      url: z.string().optional(),
    })),
    browser: z.string(),
    viewport: z.string(),
    timestamp: z.number(),
  }).optional(),
  setupData: z.record(z.string(), z.unknown()).optional(),
  // #727 v1 — UUID of an open feedback Ticket the Assistant should discuss.
  // Loader applies an institution-scope guard before injecting ticket content.
  discussionTicketId: z.string().uuid().optional(),
  tuningScope: z.enum(["LEARNER", "PLAYBOOK"]).optional(),
});
