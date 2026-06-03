---
paths:
  - "docs/feedback/tallyseal/**/*.md"
  - "memory/handoff-tallyseal-*.md"
  - "memory/hf-feedback-*.md"
---

# Tallyseal feedback authoring rules (HF side)

> **Purpose.** Make load-bearing properties of HF → tallyseal feedback docs non-skippable. Tallyseal preaches contract-enforced invariants; HF should follow the same discipline when writing feedback that will land in `tallyseal/docs/notebook/08-design-partner/`.
>
> **Mirror.** Authoritative copy lives in tallyseal at `docs/notebook/08-design-partner/CHECKLIST.md`. HF mirror exists so a Claude Code session running in `/Users/paulwander/projects/HF/` gets the discipline auto-loaded when drafting feedback (paths-scoped frontmatter above).
>
> **Provenance.** Derived from the v1 → v2 gap analysis of `tallyseal/docs/notebook/08-design-partner/hf-feedback-spec-authoring-ui-20260603.md` § Addendum 2026-06-03, where the verifier (A7) was omitted from v1 despite the heads-up doc being in session context.

## When to use

Before publishing any new HF feedback doc bound for tallyseal. Triggers on edits to:

- `docs/feedback/tallyseal/**/*.md` (forward-staging path)
- `memory/handoff-tallyseal-*.md`
- `memory/hf-feedback-*.md` (if HF chooses to draft locally before pushing to tallyseal)
- Any direct edit to `/Users/paulwander/projects/tallyseal/docs/notebook/08-design-partner/hf-feedback-*.md`

## The four contracts — every doc passes all four

### Contract 1 — Primitive coverage

The doc MUST address each of the 14 CRAWCUS primitives, with one of: a covering section, a cross-reference, or an explicit `N/A because…`.

The 14 primitives:

- [ ] Spec (IntentSpec / CrawcusSpec) — `lib/intake/specs/*.intent.ts`
- [ ] Event — kind set HF emits via `appendEvent()`
- [ ] Suggestion — proposed → accepted / edited / rejected (HF tray pattern #878)
- [ ] Projection — snapshot HF reads from `session.values`
- [ ] Contract — pre / invariant / post predicates
- [ ] Disclosure — Art 13 (HF: `gdpr.art13.privacy-notice`), Art 50
- [ ] Consent — Art 9 explicit, opt-in toggles, withdrawal path
- [ ] HumanOversight — Art 14, Suggestion-lifecycle countersign
- [ ] Warrant — actor authority proof
- [ ] Lineage — provenance through `EventAIProvenance` → ToolCall → ProjectionCommit → downstream Prisma write
- [ ] AuditBundle — `composeAuditBundle()` + DSSE envelope
- [ ] ToolDefinition — Items 12/13 (HF: `specToUpdateSetupTool()`)
- [ ] ToolCall — actual call instances
- [ ] Verifier — `crawcus-verify` CLI (TKT-VERIFIER-1a, in build 2026-06-03)

Silent omission = contract fail.

### Contract 2 — Trust triangle

Any doc proposing a deploy / distribution / publish path MUST address all three sides:

- [ ] **Author** — who creates the artefact, with what authority (Warrant)
- [ ] **Deploy** — how it reaches HF runtime (registry / PR / vendored tarball)
- [ ] **Verify** — how a third party (HF compliance, auditor, regulator) proves what was deployed, offline, without contacting tallyseal

Author + Deploy without Verify = "trust tallyseal." Doc fails.

This is the contract whose violation produced the v1 verifier miss in `hf-feedback-spec-authoring-ui-20260603.md`. A4 covered Author + Deploy; Verify (A7) was missing.

### Contract 3 — NFR citation

Any new event kind, contract predicate, or surface MUST cite which NFR(s) it satisfies. The load-bearing NFRs:

- **NFR D5** — *"any third party can verify without contacting Tallyseal"*
- **NFR L1** — *"doesn't-lie — the bundle cannot be authored to mislead a verifier"*
- **NFR S** series — data-sovereignty (admin never holds HF intent data; HF Prisma never crosses to tallyseal admin)

A new event kind without an NFR row reads as decorative.

### Contract 4 — In-flight ticket cross-reference

At session start, before drafting, the author MUST:

- [ ] Enumerate every in-flight tallyseal ticket. Run:
      ```sh
      ls -t /Users/paulwander/projects/tallyseal/docs/notebook/09-operating/hf-*-heads-up-*.md 2>/dev/null
      ls -t /Users/paulwander/projects/tallyseal/.changeset/tkt-* 2>/dev/null
      ```
- [ ] For any new event type / package / contract the doc proposes, identify which ticket's scope must grow to cover it
- [ ] If no in-flight ticket exists, the doc proposes a new one

Failure mode this prevents: a tallyseal ticket is mid-build, the HF session has the heads-up in context, and treats "no HF action this week" as "ignore for this doc." That's the verifier-miss failure mode. **Read every heads-up doc as forward-binding on any new event types you propose**, not as an inbox notification.

## Self-check block — paste into every new feedback doc

Required closing block. A doc without it = not ready to publish.

```markdown
## Pre-publish checklist (HF → tallyseal feedback)

- [ ] Contract 1 (primitive coverage): all 14 CRAWCUS primitives addressed or marked N/A with reason
- [ ] Contract 2 (trust triangle): Author + Deploy + Verify all addressed (or N/A justified — note: rare)
- [ ] Contract 3 (NFR citation): every new event kind / contract / surface cites an NFR
- [ ] Contract 4 (in-flight ticket): in-flight tallyseal tickets enumerated; new event types routed
- [ ] Addendum section: gaps discovered during drafting recorded for next revision
```

## How this rule interacts with HF's other discipline

This rule does NOT replace HF's `ai-to-db-guard.md`, `api-conventions.md`, etc. Those guard HF code. This rule guards HF *feedback writing*. Both fire in their own scope.

Note the symmetry: tallyseal protects its build with `08-design-partner/CHECKLIST.md`; HF protects its feedback authoring with this file. Each side runs the same four contracts. Drift between the two files is a sign one side has changed the discipline; bring them back in sync.

## Update procedure

When the four contracts change (new CRAWCUS primitive added; NFR catalogue grows; a new failure-mode is discovered):

1. Update `tallyseal/docs/notebook/08-design-partner/CHECKLIST.md` first (authoritative).
2. Mirror the change here.
3. Note both files in the change commit message so a reviewer can verify they stayed in sync.

If the two files disagree, **tallyseal is authoritative**. HF mirror catches up.

## References

- Tallyseal authoritative copy: `/Users/paulwander/projects/tallyseal/docs/notebook/08-design-partner/CHECKLIST.md`
- v1 → v2 gap analysis that motivated this: `tallyseal/docs/notebook/08-design-partner/hf-feedback-spec-authoring-ui-20260603.md` § Addendum 2026-06-03
- 14 CRAWCUS primitives: `tallyseal/docs/notebook/00-canon/architecture-primitives.md`
- NFR catalogue: `tallyseal/docs/notebook/07-engineering/nfrs.md`
- In-flight verifier ticket (the one v1 missed): `tallyseal/docs/notebook/09-operating/hf-tkt-verifier-1a-heads-up-20260603.md`
