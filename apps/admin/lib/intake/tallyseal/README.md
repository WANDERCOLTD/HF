# lib/intake/tallyseal — boundary facade

The **single import surface** for every `@tallyseal/*` package in HF.

## Discipline

| Rule | Why |
|---|---|
| HF code imports from `@/lib/intake/tallyseal`, **never directly from `@tallyseal/*`** | Refactors touch one file; tallyseal renames surface in one diff |
| **Never** re-export `@anthropic-ai/sdk` types | C5 LOCKED — SDK types must not leak into compliance code. Use `createAnthropicAdapter` only. |
| **Never** add HF-specific helpers here | Those live in `lib/intake/hf-adapter/*`. This facade is a thin re-export only. |
| Bump pinned tallyseal version → re-run `scripts/vendor-tallyseal.sh` → review TypeScript diffs in this folder | Single review surface for upgrade decisions |

## Structure

| File | Re-exports |
|---|---|
| `index.ts` | Barrel — single entry for HF code |
| `types.ts` | Types only: `CrawcusSpec`, `Contract`, `FieldSpec`, `Intent`, `Event`, `ComplianceManifest`, etc. |
| `builders.ts` | Authoring API: `defineCrawcusSpec`, `defineContract`, `defineCompliance`, `field` |
| `runtime.ts` | Runtime helpers: `canonicalJSON`, `computeContentHash`, `verifyChain`, `evaluateContracts`, `evaluateGraph`, `checkReadiness` |
| `regulations.ts` | Contract factories from `@tallyseal/regulations-gdpr` + `@tallyseal/regulations-eu-ai-act` |
| `ui.ts` | React components from `@tallyseal/react-assistant-ui` |
| `ai.ts` | `createAnthropicAdapter` + pricing constants (NOT the Anthropic SDK itself) |

`@tallyseal/prisma-adapter` (event store + `applyMigrations`) is wired later under `lib/intake/hf-adapter/event-store.ts` once the storage decision lands (AC #3). That wiring is NOT part of this facade — it's a concrete HF-side binding.

## Importing

```ts
// in HF feature code
import {
  defineCrawcusSpec,
  field,
  TallysealAssistantUI,
  createAnthropicAdapter,
  humanOversight,
  specialCategoryProhibition,
} from "@/lib/intake/tallyseal";
```

That's the only allowed import path. Any direct `@tallyseal/*` or `@anthropic-ai/sdk` import outside this folder fails CI (grep-enforced).

## Reference

- Phase 1 scope: GitHub issue #993
- ADR: `docs/decisions/2026-06-02-v6-wizard-on-crawcusspec.md` § "Versioning + sync strategy"
- Vendor: `apps/admin/vendor/tallyseal/README.md`
