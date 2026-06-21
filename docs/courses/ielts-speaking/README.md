# IELTS Speaking Practice — Content Sources

Five content sources backing the **IELTS Speaking Practice** playbook (1 PROD playbook). These files implement Sources 1–5 of the IELTS v2.3 Course Reference (`apps/admin/lib/wizard/__tests__/fixtures/course-reference-ielts-v2.3.md` §Content Sources).

| Source | File | Format | Module ref | Setting ref | Items |
|---|---|---|---|---|---|
| 1 — Part 1 topic library | `source-1-part1-topic-library.md` | topic-pool | `part1` | `moduleTopicPool` | 52 frames |
| 2 — Part 2 cue card bank | `source-2-cue-card-bank.md` | cueCardBank | `part2` | `moduleCueCardPool` | 88 cards |
| 3 — Part 3 theme library | `source-3-part3-theme-library.md` | theme-pool | `part3` | `moduleTopicPool` | 13 themes / 64 sets |
| 4 — Baseline topic pool | `source-4-baseline-topic-pool.md` | cueCardBank | `baseline` | `moduleCueCardPool` | 10 cards (curated subset of Source 2) |
| 5 — Mock Exam topic pool | `source-5-mock-topic-pool.md` | cueCardBank | `mock` | `moduleCueCardPool` | 30 cards (larger curated subset of Source 2) |

## Why Sources 4 and 5 exist as standalone files

Per v2.3 §Source 4 — Baseline Assessment topic pool: *"A small, separate pool … Keeping this pool separate prevents Baseline content from being practised before the student takes their Baseline."*

Per v2.3 §Source 5 — Mock Exam topic pool: *"A larger, separate pool … Mock Exam scenarios … constructed to be representative of real test difficulty."*

The v2.3 Sources 9 + 10 alternative path (Mock + Baseline REUSE Source 2 wholesale) was authored as a stop-gap — `selectPinnedCardForModule` returning `null` is the partner-blocker that Source 9/10 patched. Sources 4 and 5 here implement the intended `## Modules` content-source refs from §Source 4 / §Source 5, giving the runtime separate pools so Baseline content isn't visible during Part 2 practice.

## Parser compatibility

All files match the markdown conventions parsed by `apps/admin/lib/wizard/parse-source-content.ts`:

- **`cueCardBank`** (`### Card N — Topic` + `> You should say:` + `>   bullet` lines) — Sources 2, 4, 5
- **`topic-pool`** (`## Frame N — Topic` + numbered question list) — Source 1
- **`theme-pool`** (`## Theme: X` parent + `### Set N — Topic` children + numbered question list) — Source 3

## Follow-on operator action

1. Upload each of the 5 sources via the wizard's Source Upload flow for the IELTS Speaking Practice playbook.
2. The wizard's Extract pass produces `ContentSource` + `ContentAssertion` (+ `ContentQuestion` for cue-card / topic-pool formats).
3. `PlaybookSource` links are created automatically as part of the upload.
4. Re-project the IELTS Speaking Practice playbook's module config to switch from name-based `contentSourceRef` to slug-based `cueCardPool` / `topicPool` refs (S3 of #2167, separate PR).

## Provenance

Cue-card / topic / theme content is HFF-authored in the style of published IELTS Part 1, Part 2, and Part 3 frames (Cambridge IELTS volumes 1–19). No copyrighted Cambridge exam material is reproduced. Source files mirror the `docs/external/ielts/ielts-speaking/Upload Docs/` authored corpus.

## Related

- Story: [#2167](https://github.com/WANDERCOLTD/HF/issues/2167)
- Epic: [#2166](https://github.com/WANDERCOLTD/HF/issues/2166) — source-ref Coverage gate
- v2.3 Course Reference: `apps/admin/lib/wizard/__tests__/fixtures/course-reference-ielts-v2.3.md`
- Parser: `apps/admin/lib/wizard/parse-source-content.ts`
- Runtime consumer: `apps/admin/lib/voice/select-pinned-card.ts::selectPinnedCardForModule`
