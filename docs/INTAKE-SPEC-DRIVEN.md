# Intake is Spec-Driven — How to Add a Field

> **TL;DR:** Edit `apps/admin/lib/intake/specs/enrollment.intent.ts`. Nothing else. If you find yourself editing the chat prompt, the recap UI, or the URL builder to add a field, **stop** — you're recreating a bug that took two PRs to find and fix.

## The principle

The Tallyseal-driven intake exists so that a single declaration of what a learner is asked drives:

| Surface | What it derives |
|---|---|
| The AI chat prompt | Which fields, in what order, required vs optional, what enum options, what to do on decline |
| The `update-setup` tool definition | Field keys + JSON schema for AI tool calls |
| The Tallyseal audit chain | What gets captured, what gets disclosed, what gets retained |
| The `/intake/done` recap UI | Which captured values to show + their labels |
| The URL hand-off to `/join/[token]` | What gets propagated to HF's join flow |
| Readiness gate (`spec.readiness()`) | What must be captured before commit |

All of the above read from one source: `EnrollmentIntake` in `apps/admin/lib/intake/specs/enrollment.intent.ts`.

This matters because the **CRUD surface coming next** will let admins add fields by clicking buttons. That UI writes spec field definitions to a database. Every consumer downstream MUST read from the spec — otherwise admin-added fields silently fail in the chat, fail to appear on the recap, fail to propagate to the join flow.

## How to add a field (the right way)

1. Open `apps/admin/lib/intake/specs/enrollment.intent.ts`
2. Add the field declaration in the `fields:` block. Use the existing pattern:

   ```typescript
   myNewField: field
     .string()                                     // or .enum([...]) / .boolean() / .number()
     .optional()                                   // or .required()
     .label({ en: "Human-readable label" })        // shown on recap
     .askHint({ en: "What does the AI ask?" })     // shown in chat
     .validates((v) => /* optional format check */)
   ```

3. If the field is **required**, append its key to `REQUIRED_FIELDS`:

   ```typescript
   export const REQUIRED_FIELDS = [
     "firstName",
     "lastName",
     "email",
     "ageRange",
     "myNewField",   // ← add here
   ] as const;
   ```

   That's it. The `readiness()` function and the chat prompt's "Capture N required values" framing both update automatically.

4. If the field is **internal** (set by code, never shown to the AI or learner), append it to `INTERNAL_FIELDS` instead.

5. Done. No other files need editing. The chat prompt, the recap UI, the URL builder, and the join POST body all derive from the spec.

## How NOT to add a field (the wrong way that keeps biting us)

❌ **DO NOT** edit `app/api/intake/chat/route.ts::SYSTEM_PROMPT` to mention the new field.
❌ **DO NOT** edit `components/intake/IntakeDoneClient.tsx::VALUES_DISPLAY` to add the new key.
❌ **DO NOT** edit `components/intake/IntakeDoneClient.tsx::buildContinueUrl` to `params.set()` the new field.
❌ **DO NOT** edit `app/join/[token]/page.tsx` POST body to spread `searchParams.get("yourField")`.

If any of these surfaces don't pick up your new field automatically, the bug is in the **generator** for that surface — not in your spec change. Fix the generator (so it stays spec-driven for the next person too).

## Audit trail of the original mistake

| PR | What happened | What should have happened |
|---|---|---|
| #1124 | Added `phone` field to spec + 3 parallel hand-edits (chat prompt, recap, URL builder) | Spec change only |
| #1126 | Fixed chat prompt by hand-curating phone-specific decline rules + bumping prompt version manually | Prompt + version both spec-derived |
| **#1129 (this doc)** | Refactored: `specToSystemPrompt(spec)` generates the prompt; `deriveValuesDisplay()` derives the recap; `buildContinueUrl` iterates spec fields; `INTAKE_PROMPT_VERSION` derives from `spec.version` | — |

## Files that own the generation

| Generator | Lives at | Consumers |
|---|---|---|
| `specToSystemPrompt(spec, opts)` | `lib/intake/spec-tools.ts` | `app/api/intake/chat/route.ts` |
| `specToUpdateSetupTool(spec, opts)` | `lib/intake/spec-tools.ts` (pre-existing) | `app/api/intake/chat/route.ts` |
| `deriveValuesDisplay()` | `components/intake/IntakeDoneClient.tsx` (local — small enough not to hoist) | itself |
| `buildContinueUrl(token, values)` | `components/intake/IntakeDoneClient.tsx` | itself |

Tests live in `apps/admin/tests/lib/intake-spec-to-system-prompt.test.ts` — they verify a new spec field automatically appears in the generated prompt without any other change.

## Known remaining drift (next stories)

- `app/join/[token]/page.tsx` — POST body still hand-picks fields. Should iterate all spec keys. Not blocking but should be cleaned up.
- `lib/email.ts::sendIdentityPinEmail` — copy is hardcoded, not driven by `system-settings` like magic-link / invite / password-reset emails are. PIN email copy should join the same template-settings surface.
- Caller `preferredContactMethod` channel choice is hardcoded to `"email"` in `lib/identity/issue-pin.ts`. Should derive from the spec field of the same name on the projection / Caller.

These are tracked separately. None of them should be patched by hand-edit when the time comes — fix the generator.
