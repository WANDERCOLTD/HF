// #1182 Phase 2b-prep — SpecDeployOutcome re-export.
//
// The type already exists in @tallyseal/admin-bridge@0.1.0
// (dist/index.d.ts:347-356). Re-exporting from a stable internal path
// so adapter code imports from one place — when @tallyseal/admin-editor
// ships (Tue 2026-06-09) it may import the same type, and the adapter
// doesn't need to change.
//
// The shape is GitHub-PR-deploy-flow specific (kind: 'ok' carries prUrl,
// prNumber, commitSha, bridgeAccessEventId). HF's V6 wizard publish is
// a DB state transition (DRAFT → PUBLISHED), no remote deploy — so the
// adapter synthesises a kind: 'ok' variant with stub values for the
// PR-specific fields. Tallyseal acknowledged host-synthesised outcomes
// as a valid contract (Sprint E follow-up reply, 2026-06-06).
//
// Do NOT redefine a parallel shape here — TL pass on #1182 flagged that
// as a tarball-day landmine.

export type { SpecDeployOutcome } from "@tallyseal/admin-bridge";
