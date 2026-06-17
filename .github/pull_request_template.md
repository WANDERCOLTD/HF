# Pull Request

## Summary
What changed and why? (2-5 lines)

## Related Issues / PRs
Link to related issues, PRs, or specs (if any).

## Files changed
List key files (or link to them).

## How to review
What should the reviewer look for?

## Checks
- [ ] I worked on a branch (not `main`)
- [ ] Tests pass (`npm test`)
- [ ] New API routes have `requireAuth()` + `@api` JSDoc annotation
- [ ] Architecture docs updated if applicable
- [ ] **Producer ↔ consumer pairing** — if I touched a transform in `lib/prompt/composition/transforms/` and added or modified a `directive: "…"` output field, the matching `parts.push(...)` consumer in `lib/prompt/composition/renderPromptSummary.ts` is present AND the file carries the `// @renderer-consumed-at lib/prompt/composition/renderPromptSummary.ts` sentinel comment. (Born of PR #1768 silently dropping 5 consumer pushes; enforced by `hf-compose/composition-directive-needs-renderer` ESLint rule + `tests/lib/prompt/composition/coverage-producer-consumer.test.ts` coverage vitest. See `.claude/rules/lattice-survey.md` §"Producer ↔ consumer pairing — deeper layer".)
