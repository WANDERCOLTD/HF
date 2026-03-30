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
  data: z.record(z.unknown()).optional(),
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
  setupData: z.record(z.unknown()).optional(),
});
