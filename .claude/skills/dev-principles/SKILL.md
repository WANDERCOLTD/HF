---
name: dev-principles
description: Engineering principles and build discipline. Use when writing new features, planning implementations, choosing libraries, or writing tests. Auto-triggers on feature work, test creation, and architectural decisions.
allowed-tools: Read, Grep, Glob
---

# Dev Principles

> Reusable engineering philosophy for all projects.

## Core Principles

1. **Zero hardcoding** — Runtime values from config or DB. Magic strings are bugs.
2. **DB is source of truth** — Config files are seed data. After import, the database wins.
3. **Dynamic parameters** — Add capability by activating config, not writing code.
4. **Test what matters** — Units for business logic, E2E for user-facing flows.
5. **Honest tests** — Mock only at system boundaries (DB, external APIs). Never mock the unit under test, never stub internal functions, never fabricate request/response shapes.
6. **No dead tests** — No `test.skip` or `test.todo` in committed code. Fix it or delete it.
7. **Test every route** — Every API route must have a corresponding test. CI enforces this.
8. **E2E every feature** — Every new user-facing page or feature must have at least a smoke-level E2E spec: page loads, key elements visible, primary user flow works.
9. **Document every API** — All routes listed in a central API doc (route, method, auth, purpose). No undocumented endpoints.
10. **Reuse before building** — Before writing any new feature, identify existing shared modules. If shared infra exists but doesn't quite fit, extend it. Never copy-paste-diverge.
11. **Robustness over velocity** — Every user-facing flow must handle errors, loading states, and edge cases from day one. Error boundaries, retry logic, graceful degradation, and state recovery ship with the feature — not as follow-up tasks.
12. **Intent-Led UX** — All UI surfaces organized around user intent (what they want to accomplish), never internal structures. Hide implementation complexity.
13. **AI call registry** — All AI calls go through metered wrappers. A central doc lists every call site, purpose, and model used.

## Build Discipline

Before writing any code for a new feature, answer these questions:

1. **What existing shared modules will I reuse?** (List them explicitly)
2. **What's missing from shared infra that this feature needs?** (Extend shared first)
3. **What are the failure modes?** (API errors, partial state, timeouts, invalid input)
4. **How does the user recover from each failure?** (Error messages, retry, rollback)

If the answer to #1 is "nothing" for a feature that resembles existing features — **stop and consolidate first**.

## Multi-Step Wizard Pattern

All multi-step wizards must follow these rules:

- Use a **shared step/phase state manager** — no raw `useState` for step tracking
- Use a **shared async task poller** for API calls that create background tasks
- Use a **shared error boundary pattern** — never inline try/catch with ad-hoc error UI
- **Session persistence** — wizard state must survive page refresh
- **Every step must have**: loading state, error state with recovery action, success state
- Start from the shared backbone, not from scratch. If backbone doesn't support your use case, extend it.

## Testing Philosophy

- Mock only at system boundaries: DB, external APIs, navigation
- Never mock the unit under test
- Never stub internal library functions to force a code path
- Never fabricate request/response shapes that diverge from real API contracts
- Integration tests require a running server
- E2E: use shared fixtures and page objects, follow existing spec patterns

## Libraries First

Before writing utility code, search npm for a battle-tested package. Hand-rolled parsing, retry logic, formatting, and validation are bugs waiting to happen.

| Pattern | Use this | NOT hand-rolled |
|---------|----------|-----------------|
| JSON repair (LLM output) | `jsonrepair` | Custom regex repair cascades |
| Retry with backoff | `p-retry` | Manual for-loop + sleep |
| Concurrency limiting | `p-limit` | Custom queue/semaphore |
| Slug generation | `slugify` | Custom regex replace chains |
| Duration formatting | `ms` / `pretty-ms` | Manual ms-to-string |
| CSV parsing | `papaparse` | Custom split/regex |
| Fuzzy search | `fuse.js` / `fuzzysort` | Custom Levenshtein |
| Cron parsing | `croner` | Custom cron regex |

Workflow: (1) Identify the pattern, (2) `npm search` or ask for a library, (3) check weekly downloads + maintenance, (4) install and use. If no good library exists, write custom code with a `// No suitable npm package as of YYYY-MM` comment.
