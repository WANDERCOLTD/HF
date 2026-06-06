// #1194 Phase 2b — SpecDeployOutcome re-export.
//
// Source switched from @tallyseal/admin-bridge to @tallyseal/admin-editor
// per the latter's sovereignty rationale (admin-editor/dist/index.d.ts:919-929):
// hosts implementing SpecStore should not transitively pull admin-bridge
// just to import this type. The two shapes are structurally identical —
// see TL pass on #1194 — so existing adapter code is byte-equivalent.
//
// Shape remains GitHub-PR-deploy-flow specific (kind: 'ok' carries prUrl,
// prNumber, commitSha, bridgeAccessEventId). HF's V6 wizard publish is
// a DB state transition (DRAFT → PUBLISHED), no remote deploy — the
// adapter synthesises a kind: 'ok' variant with stub PR-specific values.
// Tallyseal acknowledged host-synthesised outcomes as valid contract
// (Sprint E follow-up reply, 2026-06-06). The long-term cleanup is
// TKT-ADMIN-EDITOR-DEPLOY-OUTCOME-HOST-ONLY (tallyseal-side follow-up).

export type { SpecDeployOutcome } from "@tallyseal/admin-editor";
