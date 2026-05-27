# ADR: PendingChangesTray operates under Model A (write-immediate, notification-feed) semantics

**Date:** 2026-05-26
**Status:** Accepted
**Deciders:** Paul W, AI debugging session
**Related:** [#854 — PendingChangesTray foundation](https://github.com/WANDERCOLTD/HF/issues/854), [#909 — Authoring-side read parity epic](https://github.com/WANDERCOLTD/HF/issues/909), [#910 — this ADR + chain-contract guard](https://github.com/WANDERCOLTD/HF/issues/910), [`docs/CHAIN-CONTRACTS.md` Link A2](../CHAIN-CONTRACTS.md)

## Context

The `PendingChangesTray` (epic #854) accumulates compose-affecting settings edits as a user moves across surfaces — `PromptTunerSidebar`, Course Design tabs, Cmd+K palette, wizard chat, AI tool executors. From a casual reading of the UI ("Save & apply" button + "Discard all" button) it looks like a staging buffer: edits are held, then committed in a batch.

That is **not** what the tray does. Every surface writes to the DB at push time. The tray is a **unified visualisation across surfaces + the gate for the recompose decision**. Two pieces of evidence pin this down in code today:

1. `app/api/recompose/apply/route.ts` header comment, lines 4–8:
   > "The tray accumulates compose-affecting settings edits across surfaces. Underlying writes happen at push time (each surface writes immediately — this is the simplified v1 model documented in the epic body). The tray's Save & apply button calls THIS endpoint to act on the toggle decisions."
2. `hooks/use-pending-changes-tray.tsx:264-266`:
   ```typescript
   const clear = useCallback(() => {
     setEntries([]);
   }, []);
   ```
   `clear()` removes visualisation entries from React state. There is no DB call, no compensating write, no undo path. The "Discard all" label was a UX contract violation — it promised rollback that has never existed.

Surfaced 2026-05-26 during a debugging session for the dual-fetch bug behind epic #909. The label honesty problem and the read-parity problem are siblings: both come from authoring surfaces communicating a model of the system that doesn't match the code.

This ADR fixes the labels and the underlying confusion before the next AI surface or per-row CTA gets added under the old (wrong) mental model.

## Decision

**The PendingChangesTray operates under Model A — write-immediate, notification-feed semantics.**

- Every surface that pushes to the tray has *already written to the DB* by the time the tray entry appears.
- The tray is a **unified cross-surface visualisation** of pending compose-affecting writes, and the **gate for the recompose decision** (Toggle 1 = per-caller recompose, Toggle 2 = cohort fan-out).
- The tray is **not** a staging buffer. There is no two-phase commit. There is no rollback.

### Consequence — label honesty

- "Save & apply" and "Discard all" are **forbidden** as tray button labels. They promise behaviour the code does not implement.
- Per-row dismiss (`remove(id)`) clears visualisation only — DB state is unchanged. The dismiss control must say what it does (e.g. "Hide" / "Acknowledge"), not what it doesn't.
- The recompose-trigger button must say what it does. Acceptable forms: "Recompose now", split CTAs ("Recompose this learner" + "Recompose cohort"), or any phrasing that does not imply "your edits will land if you click this".
- Audit row `PENDING_CHANGES_APPLIED` is written when the recompose-trigger button fires regardless of which toggles are on — the audit captures the decision to recompose (or not), not the decision to write (writes already happened).

### Consequence — AI tool ergonomics

Tray entries pushed by AI tool executors carry `aiSuggested: true` and follow the same write-immediate semantics. The AI's write has already landed by the time the human sees the tray row; the human review gate is the recompose decision, not the write decision. This matches the existing AI-safety guard at `app/api/recompose/apply/route.ts:125-126` which rejects `aiSuggested + toggleAll` — the guard works at the recompose-trigger layer, where the human decision actually happens.

## Alternatives considered

**Model B — stage-first, tray buffers changes until Save & apply.** The tray would hold pending changes in memory (or in a draft table) and writes would land only when the user clicked Save & apply. "Discard all" would fire a rollback. Rejected for four reasons:

1. **AI tool ergonomics.** Every AI tool call would have to become two-stage (propose → ack), and the tool's return value would have to surface a tray ID rather than the resulting entity. The compose-stamping helpers (`update-playbook-config.ts`, `update-domain-config.ts`, `update-analysis-spec-config.ts`, `write-target.ts`, `bump-timestamp.ts`) would all need a "staging" variant. The blast radius is the entire AI write surface — Cmd+K (33 tools), wizard (10 tools), course-ref (5 tools).
2. **Compose preview.** Educators trigger compose previews from inside the editor surfaces today. Under Model B, the preview would need staged-write awareness — it would either show a stale prompt (if it reads committed state) or have to merge in the staged edits at compose time. That's a new contract on the compose pipeline that doesn't pay for itself.
3. **API contracts.** `recompose-preview` and `staleness` API contracts assume DB consistency. Both would need a "pending changes" parameter, and every consumer would have to assemble it.
4. **Cost vs benefit.** The actual UX gain from Model B over Model A is "the labels are honest". Label honesty is achievable in Model A with a one-line rename. Model B is a multi-week refactor for the same outcome.

If a future contributor wants Model B, they must **supersede this ADR** with an explicit migration plan covering all four points above. Do not chip away at it incrementally — partial Model B is worse than either pure model.

## Enforcement

- **Chain-contracts row** — `docs/CHAIN-CONTRACTS.md` Link A2 extension states the label-honesty invariant.
- **Arch-checker check** — `.claude/agents/arch-checker.md` (Check F documents the cascade-read antipattern; the tray-label invariant is enforced via the chain-contracts row + code review).
- **Audit counter** — none. Label honesty is verified at review time. The structural invariants under it (tray push must set `aiSuggested`, runtime `aiSuggested + toggleAll` rejection, ESLint `hf-recompose/no-ai-fanout-all`) already have their own enforcement layers (`.claude/rules/ai-to-db-guard.md`).
- **Reviewer checklist** — any PR touching `PendingChangesTray.tsx` or `use-pending-changes-tray.tsx` is reviewed against this ADR. The label-rename pass itself lands in #912 (PR 3 of epic #909).

## Out of scope

- Renaming the existing button labels — that lands in #912 (PR 3 of epic #909), not this ADR.
- Migrating the tray to Model B — explicitly rejected above.
- Schema changes — none. The tray is a React state container with sessionStorage persistence (`hooks/use-pending-changes-tray.tsx`), not a DB table.

## Consequences

**Positive:**
- New AI surfaces and new tray push sites inherit the right mental model from day one.
- The label-honesty PR (#912) has a clear authority to cite at review time.
- The "AI wrote without my permission" failure mode is correctly framed as "the recompose-trigger button is where the human gate lives", not "writes are staged".

**Negative:**
- Educators who have built a mental model of "Save & apply = commit" will need a one-time recalibration when the labels change in #912. Mitigated by accompanying release note + tooltip.
- The "I want to undo" use case is not supported by the tray. If demand surfaces, the right answer is a row-level audit + revert mechanism (separate epic), not a tray-level rollback. Documented here so the next person doesn't reach for the tray.

## References

- `hooks/use-pending-changes-tray.tsx` — Model A is implemented as a React state container + per-key reducer; `clear()` is `setEntries([])`.
- `app/api/recompose/apply/route.ts` — file header explicitly documents Model A ("Underlying writes happen at push time").
- `docs/CHAIN-CONTRACTS.md` — Link A2 (existing tray contract) + Link A2 extension (label honesty, added by #910).
- `.claude/rules/ai-to-db-guard.md` — "Pending-changes tray + apply route" guard row covers the five-layer AI-safety defence; this ADR sits underneath it as the architectural rationale.
- `.claude/agents/arch-checker.md` — Check F (added by #910) covers the sibling read-parity antipattern.
