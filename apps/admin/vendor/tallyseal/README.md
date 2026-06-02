# vendor/tallyseal/

This folder vendors `@tallyseal/*` packages as npm-installable tarballs.

## Why vendor?

| | |
|---|---|
| **HF package manager** | npm (`package-lock.json` at root) |
| **Tallyseal package manager** | pnpm (workspace monorepo) |
| **Tallyseal publish status** | All `@tallyseal/*` packages `"private": true` (B1.3 spending freeze; no public npm) |

The three constraints together rule out pnpm-workspace-link (would require switching HF to pnpm — out of scope), public npm install (private packages), and `npm link` (deprecated, fragile cross-machine).

**Vendoring via tarball is the only path that doesn't switch HF's tooling.**

## What's in here

9 `.tgz` files — `pnpm pack` output from `/Users/paulwander/projects/tallyseal/packages/*`. `pnpm pack` rewrites `workspace:*` references to concrete version numbers in each tarball's `package.json`. Total size ~400 KB.

| Tarball | Role |
|---|---|
| `tallyseal-crawcus-spec-X.Y.Z.tgz` | Open-standard spec types (foundation) |
| `tallyseal-crawcus-tck-X.Y.Z.tgz` | Test Compatibility Kit (CI runs against this) |
| `tallyseal-core-X.Y.Z.tgz` | Runtime: `defineCrawcusSpec`, `writeEvent`, `composeAuditBundle`, PII tokenisation |
| `tallyseal-react-X.Y.Z.tgz` | React hooks layer (transitive via react-assistant-ui) |
| `tallyseal-regulations-gdpr-X.Y.Z.tgz` | `minorConsent` (Art 8), `specialCategoryProhibition` (Art 22/9) |
| `tallyseal-regulations-eu-ai-act-X.Y.Z.tgz` | `humanOversight` (Art 14), `aiInteractionDisclosure` (Art 50) |
| `tallyseal-prisma-adapter-X.Y.Z.tgz` | Event store backed by HF's existing Postgres + `applyMigrations()` |
| `tallyseal-ai-anthropic-X.Y.Z.tgz` | AIPort adapter wrapping `@anthropic-ai/sdk` (C5: SDK types never leak) |
| `tallyseal-react-assistant-ui-X.Y.Z.tgz` | UI: 7 components (composite, banner, suggestion rail, intent form, readiness gate, activity tray, tool-call approval) |

## Dependency graph (topological install order)

```
crawcus-spec ──┬─→ core ──┬─→ ai-anthropic
               │          ├─→ prisma-adapter
               │          ├─→ regulations-gdpr
               │          ├─→ regulations-eu-ai-act
               │          └─→ react ──→ react-assistant-ui ←┐
               │                                            │
               └────────────────────────────────────────────┘
crawcus-tck (independent — no @tallyseal deps)
```

The install MUST be a single `npm install` command listing all tarballs as args — npm resolves transitive `@tallyseal/*` deps from the install args rather than hitting the public registry.

## Re-vendoring

Whenever tallyseal bumps a version (or HF adds a new `@tallyseal/*` consumer):

```sh
./scripts/vendor-tallyseal.sh
```

The script cleans this folder, re-packs from the local tallyseal monorepo, and re-installs. Commit the resulting tarball + `package.json` + `package-lock.json` changes.

## Boundary discipline

ALL `@tallyseal/*` imports in HF go through `apps/admin/lib/intake/tallyseal/*` (the boundary facade). NEVER import from `@tallyseal/*` directly in feature code. Per the CLAUDE.md C5 discipline: `@anthropic-ai/sdk` types must not leak — go through `createAnthropicAdapter()`.

## Why commit the tarballs?

They're 400 KB total. Committing them means:

- Reproducible builds across machines, CI, hf-dev VM
- HF's CI doesn't need tallyseal checked out
- Auditable record of which tallyseal versions HF actually consumed (matched against tallyseal's CHANGELOG + git history)

The alternative (build tarballs on the fly during CI) requires CI access to the tallyseal repo, which adds infrastructure and removes the audit trail.

## Reference

- Sister project: `/Users/paulwander/projects/tallyseal`
- ADR: `docs/decisions/2026-06-02-v6-wizard-on-crawcusspec.md` § "Versioning + sync strategy"
- Tallyseal handoff: `tallyseal/docs/notebook/09-operating/sprint-c-handoff.md`
- HF-side feedback to tallyseal: `tallyseal/docs/notebook/08-design-partner/hf-feedback-sprint-c-scoping.md`
