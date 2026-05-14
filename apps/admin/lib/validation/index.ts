/**
 * Validation helpers for API route handlers.
 * Mirrors the requireAuth()/isAuthError() pattern.
 *
 * Usage:
 *   const v = validateBody(inviteAcceptSchema, body);
 *   if (!v.ok) return v.error;
 *   const { token, firstName, lastName } = v.data;
 */

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

type ValidationSuccess<T> = { ok: true; data: T };
type ValidationFailure = { ok: false; error: NextResponse };

// Use a generic Schema parameter so the inferred output type flows through to
// the caller. Zod 4 deprecated `ZodSchema<T>` — `z.ZodType` carries both input
// and output types, and `z.infer<S>` reliably extracts the parsed shape.
export function validateBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
): ValidationSuccess<z.infer<S>> | ValidationFailure {
  try {
    const data = schema.parse(body) as z.infer<S>;
    return { ok: true, data };
  } catch (err) {
    if (err instanceof ZodError) {
      return {
        ok: false,
        error: NextResponse.json(
          {
            ok: false,
            error: "Invalid request",
            details: err.issues.map((e) => e.message),
          },
          { status: 400 },
        ),
      };
    }
    throw err;
  }
}

export function validateQuery<S extends z.ZodType>(
  schema: S,
  params: Record<string, string | null>,
): ValidationSuccess<z.infer<S>> | ValidationFailure {
  // Convert null values to undefined for Zod
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    cleaned[key] = value ?? undefined;
  }
  return validateBody(schema, cleaned);
}

// Re-export schemas for convenience
export * from "./schemas";
