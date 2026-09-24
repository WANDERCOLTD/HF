# Module Unlock Gate

> Modules declare `prerequisites` on `AuthoredModule` (a sibling-module
> gate). A STUDENT-tier learner must not ENTER a module whose prereqs
> are unmet. OPERATOR+ always bypasses (testers iterating on Mock must
> not be locked out — the gate is a STUDENT-only contract).
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md) (write-side
> validate-before-execute) and [`ai-read-grounding.md`](./ai-read-grounding.md)
> (chat-side verify-before-claim). This file holds the **learner-gate
> producer↔consumer pairing** discipline.
>
> Catalogued in
> [`docs/CHAIN-CONTRACTS.md#link-l10`](../../docs/CHAIN-CONTRACTS.md).
> Born of #1746 (the resolver) + #2318 (this rule + the FOH client-side
> render) + #2320 (deferred server-side enforcement + Lattice cluster).

## Rule

When you author a module that should be locked behind sibling modules:

1. **Declare prereqs on the AuthoredModule** at
   `Playbook.config.modules[i].prerequisites`. Two shapes accepted:
   - **String** (legacy): bare slug → "needs ≥ 1 COMPLETED attempt".
   - **`{moduleId, minCompletions}`** (count-based): "needs ≥ N
     COMPLETED attempts". The IELTS Mock pattern is
     `[{moduleId: "baseline", minCompletions: 1}, {moduleId: "part1",
     minCompletions: 2}, {moduleId: "part3", minCompletions: 2}]`.
2. **Route declarations through the canonical writer** —
   `lib/playbook/update-playbook-config.ts::updatePlaybookConfig`. Never
   `prisma.playbook.update({data: {config: ...}})` outside the chokepoint
   (that path bypasses the COMPOSE timestamp + cascade invalidation).
3. **Cross-validate prereq references** — the wizard's
   `lib/wizard/detect-authored-modules.ts:471` already fires
   `MODULE_PREREQUISITE_UNKNOWN` when a prereq points at a non-sibling.
   Re-running the wizard projection after declaring prereqs is a cheap
   discoverability win.

## Current consumer status

⚠️ **CONSUMER SPLIT — MT-essential CLIENT-side; full server-side
enforcement DEFERRED.**

| Surface | Status | Story |
|---|---|---|
| FOH client-side render (`apps/foh/app/page.tsx::computeUnlockState`) | ✅ live | #2318 |
| Admin SimProgressPanel (`AuthoredModulesPanel` / `LearnerModulePicker`) | partial — uses `prerequisiteSlugs` extractor for UI chips; full `isModuleUnlocked` not yet invoked | (pre-existing) |
| `app/api/callers/[callerId]/calls/route.ts` POST gate | ❌ deferred | #2320 |
| `app/api/student/progress/route.ts` batched check | ❌ deferred | #2320 |
| `eslint-rules/no-bare-call-create.mjs` `createSession` chokepoint require-unlock | ❌ deferred | #2320 |
| Bidirectional Coverage gate vitest | ❌ deferred | #2320 |
| Resolver `callCount`-as-completion fix (count only `status === "COMPLETED"`) | ❌ deferred | #2320 sub-slice 0 |

The producer-only debt is **explicit + time-bounded** by #2320. The
MT-essential CLIENT-side check defends against accidental URL access by
supervised prospects (~20–100 demo window); production-scale rollout
REQUIRES the deferred consumer to ship.

## When this applies

Any code path where:

1. You're declaring `prerequisites` on a new `AuthoredModule`, OR
2. You're authoring a new learner-facing surface that renders modules
   (must respect the lock state — either via `isModuleUnlocked` on the
   server, or by reading `prerequisites` + completion counts on the
   client and computing the gate locally), OR
3. You're adding a new code path that creates a Session
   (`createSession({kind: VOICE_CALL|SIM_CALL,...})`) — must invoke
   `isModuleUnlocked` before the create, OR carry a documented bypass
   comment.

## The canonical resolver

`apps/admin/lib/curriculum/check-module-unlock.ts::isModuleUnlocked`
is the single source of truth for the gate. Signature:

```typescript
isModuleUnlocked(prisma, {
  callerId,
  module,         // AuthoredModule whose unlock state is being checked
  playbookConfig, // Playbook.config for course-style + sibling modules
  callerRole,     // for the OPERATOR+ bypass
}) → Promise<{
  unlocked: boolean;
  reason: "role-bypass" | "no-prerequisites" | "continuous-course"
        | "all-prerequisites-met" | "prerequisites-unmet" | "module-id-unknown";
  missing?: Array<{moduleId, moduleLabel, required, actual}>;
}>
```

Behaviour:

- **`role-bypass`** — OPERATOR+ (level ≥ 3) ALWAYS reads back
  `{unlocked: true}`. Pinned by vitest.
- **`continuous-course`** — non-structured courses have no
  module-progress semantics; default-allow.
- **`no-prerequisites`** — empty/missing prereq list → allow.
- **`prerequisites-unmet`** — at least one prereq below `minCompletions`
  → `{unlocked: false, missing: [...]}`. UI surfaces this as "Complete
  X (N more) first".

## Bypass semantics

Three legitimate bypass paths:

| Bypass | When | Mechanism |
|---|---|---|
| **Role bypass** | OPERATOR+ session | `isModuleUnlocked` returns `{unlocked: true, reason: "role-bypass"}` |
| **Continuous-course bypass** | Course-style is `continuous` (not `structured`) | `isModuleUnlocked` short-circuits via `getCourseStyle` |
| **Per-site escape comment** (future, #2320) | A code path legitimately bypasses (e.g. drain scripts, admin reset routes, harness sim-runners) | `// hf-bypass-unlock: <reason>` comment on the line above `createSession` — caught by ESLint chokepoint |

Per-site escape is the LAST resort. Drain scripts + harness paths are
the legitimate cases; any new production code path adopting the bypass
needs a `Verified by` note explaining why.

## When NOT to apply

- **Continuous courses** — `getCourseStyle(playbookConfig) !==
  "structured"` short-circuits the gate. Continuous courses have no
  module-progress writes (#1252) and so no per-module unlock semantics.
- **OPERATOR+ surfaces** — admin browsing of any caller's modules
  should never see the gate fire (role-bypass).
- **Read-only inspection** — Inspector panels showing module
  configuration don't need to invoke the resolver; reading
  `prerequisites` directly from the playbook config is fine.

## Existing enforcement

| Location | Mechanism | What it prevents |
|---|---|---|
| `lib/curriculum/check-module-unlock.ts::isModuleUnlocked` (#1746) | The canonical resolver | Drift between consumer surfaces — every surface should call the same resolver |
| `lib/wizard/detect-authored-modules.ts:471` (cross-validation) | Wizard `MODULE_PREREQUISITE_UNKNOWN` warning | Prereqs that point at non-sibling modules |
| `apps/foh/app/page.tsx::computeUnlockState` (#2318) | Client-side render for MT | Locked-module attempts during supervised demos |
| `prisma/seed-ielts-course.ts` (#2318) | IELTS prereqs declared via `updatePlaybookConfig` | Drift between seed + the chokepoint writer (composeInputsUpdatedAt parity) |
| `docs/runbooks/RB-IELTS-MT-OPERATOR-PLAYBOOK.md` (#2318) | Pre-Mock-URL SQL verification | Operator emailing the Mock URL before prereqs are met |
| `lib/curriculum/check-module-unlock.ts:208-220` resolver `callCount` fix (#2320 deferred) | Counts only `status === "COMPLETED"` rows | `minCompletions: 2` passing on 1× COMPLETED + 1× IN_PROGRESS (the pre-existing over-count bug) |
| `eslint-rules/no-bare-call-create.mjs` extension (#2320 deferred) | Edit-time | New `createSession` sites bypassing the gate without a documented comment |
| `tests/lib/curriculum/module-unlock-coverage.test.ts` (#2320 deferred) | Bidirectional Coverage gate vitest | Modules declaring `prerequisites` with no consumer AND `createSession` sites with no gate |

## When adding a new code path that creates a Session

Author checklist — same PR or follow-on:

1. Resolve `playbookId` + `requestedModuleId` via the canonical helpers
   (`createCallEnteringPipeline` / `createSession`).
2. Load the playbook config + the AuthoredModule for the requested module.
3. Call `isModuleUnlocked({callerId, module, playbookConfig, callerRole})`.
4. On `unlocked: false`, return 403 `{ok: false, reason,
   missingRequirements}` to the caller — do NOT proceed to create the
   Session.
5. On `unlocked: true` (incl. `role-bypass`), proceed. AppLog
   `module.unlock.operator_bypass` on the bypass branch so operator
   sessions are auditable.

Until #2320 lands the ESLint chokepoint, this is author discipline.

## Risk acknowledgement (MT-essential window)

- **URL-hack bypass** — a curious prospect could deep-link
  `/sim?module=mock` and bypass the FOH lock UI. Low risk for the
  20–100 supervised prospect window; mitigated by the operator-side
  pre-Mock-URL SQL gate in `RB-IELTS-MT-OPERATOR-PLAYBOOK.md`.
- **No AppLog audit** of bypass attempts during MT → operator-side
  logging only.
- **Client-side `computeUnlockState` could drift** if the SEAM data
  shape changes → acceptable for MT; the deferred server-side
  enforcement (#2320) IS the structural backstop.

## Related

- [`lib/curriculum/check-module-unlock.ts`](../../apps/admin/lib/curriculum/check-module-unlock.ts) — the canonical resolver
- [`apps/foh/app/page.tsx`](../../apps/foh/app/page.tsx) — MT-essential client-side consumer
- [`prisma/seed-ielts-course.ts`](../../apps/admin/prisma/seed-ielts-course.ts) — IELTS prereq data declaration
- [`docs/CHAIN-CONTRACTS.md#link-l10`](../../docs/CHAIN-CONTRACTS.md) — the architectural contract row
- [`docs/runbooks/RB-IELTS-MT-OPERATOR-PLAYBOOK.md`](../../docs/runbooks/RB-IELTS-MT-OPERATOR-PLAYBOOK.md) — operator pre-Mock SQL gate
- [`.claude/rules/ai-to-db-guard.md`](./ai-to-db-guard.md) — sibling write-side discipline
- Story [#2318](https://github.com/WANDERCOLTD/HF/issues/2318) — this rule (MT-essential)
- Follow-on [#2320](https://github.com/WANDERCOLTD/HF/issues/2320) — server-side enforcement + Lattice cluster (Guard + Coverage + ESLint)
- Origin [#1746](https://github.com/WANDERCOLTD/HF/issues/1746) — the resolver
- Parent epic [#1700](https://github.com/WANDERCOLTD/HF/issues/1700) Theme 5 — module-unlock framing
