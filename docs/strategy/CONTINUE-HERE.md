# Continue Here — TAM & GTM Doc Set

**Last touched:** 2026-06-07 by Paul + Claude
**Branch:** `chore/tam-docs-d4-citations`
**Status:** D1 + D2 at V0.2, D8 at V0.1, **D4 shipped V0.1** (CSV + MD + PDF, 72 rows). D3 / D5 still paused.

---

## What's done

| Code | Doc | Files | Status |
|---|---|---|---|
| D1 | Briefing Note (essay-style, paginated, glossary) | `D1-briefing-note.md` + `.pdf` | **V0.2** |
| D2 | Priority TAM Overview (paginated, glossary) | `D2-priority-tam.md` + `.pdf` | **V0.2** |
| D4 | Citation Sheet (72 rows: CSV + paginated MD + PDF) | `D4-citations.csv` + `.md` + `.pdf` | **V0.1** |
| D8 | Sales GTM Plan, Phase-1 Slice (Sector B / NMC band-7 / IRA) | `D8-sales-gtm-phase1.md` + `.pdf` | **V0.1** |

All three docs follow the locked spine: 5-level nomenclature (Sector → Wedge → Channel → Account → Cohort), 4-question priority frame, TAM = Sector / SAM = Channel / SOM = Account, V/E/T confidence flags, 7-sector portfolio (A–G), and the final-page glossary.

**Formatting standards now codified:**
- A4 page, 22 mm × 20 mm margins
- Page numbers ("Page X of Y") bottom centre
- Doc code bottom left, "Internal — Confidential" bottom right
- Page-break before major sections in 7pp+ docs
- Glossary always on its own page at the end
- Every acronym used in the doc appears in its glossary

## What's locked (the spine — do not re-debate)

1. **Nomenclature:** 5 levels — Sector → Wedge → Channel → Account → Cohort
2. **Sizing map:** TAM = Sector | SAM = Channel | SOM = Account
3. **Confidence flags:** [V] verified · [E] estimate · [T] TBD
4. **Numbers:** always WW + UK; `-` where unknown
5. **Sector list:** 7 sectors A–G (B and G locked as P1)
6. **Phase-1 commitment:** Sector B / NMC speaking-band-7 wedge / IRA channel
7. **IELTS probe success criteria:** 3 hypotheses, all must pass
8. **Doc set:** D1 (briefing) · D2 (priority TAM) · D3 (full analysis) · D4 (citations) · D5 (entity lists) · D6 (TAM picture slide) · D7 (nomenclature wiki) · D8 (sales GTM plan)
9. **Pagination + glossary** standard applies to every published doc

## What's paused (resume in this order)

### Next: D5 — Entity Lists (Google Sheet, multi-tab)

**Tabs:**

1. `IRAs` — 330 from NHS Employers Code-of-Practice list (top 13 named from D8 §3 + tail)
2. `Healthcare regulators` — 9 UK statutory bodies (from D2 §4.2)
3. `Publishers` — 7 UK-HQ EFL publishers
4. `Pathway providers` — 7–9 UK pathway operators
5. `Test owners` — 5 (IELTS partners × 3, OET, PTE, DET, TOEFL)
6. `CPD bodies` — ~30 UK CPD-mandated bodies
7. `NHS Trusts (overseas-recruiting)` — top 30 by activity

Columns per row: name · type · website · primary_contact_role · linkedin · status (Pipeline / Active / Lapsed) · last_touch · owner

### After D5: D3 — Full TAM & GTM Analysis (25–35 pp)

Sections to write:

1. Executive summary (pyramid-lift of D2)
2. Methodology + nomenclature (lift D7)
3. Each Sector A–G — full deep-dive (replicate D2 §4 structure for each)
4. Channel taxonomy — comprehensive
5. CPD meta-sector — body-by-body
6. IRA outreach plan — full version (parallel to D8)
7. IELTS probe design — full
8. Phase 2 / 3 / 4 forward planning
9. Risk register — full
10. WW expansion thesis (US / EU / APAC follow-on)
11. Citation appendix (links to D4)
12. Entity appendix (links to D5)
13. Glossary

### Other paused work (lower priority)

- **D6** — render the ASCII TAM picture as a designed slide. Content is in D1 + D2.
- **D7** — paste nomenclature standard into team wiki. Content is in D2 §2 + chat history.

## Outstanding research (the verification week, before any investor share)

Five ESTIMATEs to convert to VERIFIED:

| # | Estimate | How to verify | Effort |
|---|---|---|---|
| 1 | First-attempt healthcare-IELTS pass rate ~30–40% | Pull IELTS Partners disaggregated data by occupation; OET published band distribution | 2 days |
| 2 | Per-candidate English-prep spend £1–2.5 k | 5–10 IRA exec interviews | 1 week |
| 3 | IRA market share Top-5 ~50% | Companies House revenue for all 330 IRAs + FOI'd top-30 NHS Trust IRA contracts | 1 week |
| 4 | OSCE-prep TAM £40–60 m | NMC OSCE candidate × commercial OSCE-prep provider price points | 2 days |
| 5 | NHS overseas-nurse net spend ~£200 m / yr (NAO is gross) | FOI NHSE Workforce Training & Education programme accounts | 2 weeks |

## How to regenerate the PDFs

From the strategy directory:

```bash
cd docs/strategy
for f in D1-briefing-note D2-priority-tam D4-citations D8-sales-gtm-phase1; do
  pandoc $f.md -o $f.pdf --pdf-engine=weasyprint --standalone
done
```

## How to resume

```
git checkout chore/tam-docs-d4-citations      # or merge to main first
cat docs/strategy/CONTINUE-HERE.md
```

Then prompt: *"Resume the TAM doc set. Start with D5 (entity lists — IRAs tab populated from NHS Employers Code-of-Practice list)."*

## Branch hygiene

This branch (`chore/tam-docs-d4-citations`) is doc-only. No code, no schema, no Prisma, no API. Safe to merge to main once board-approved. After merge, open a new branch for D3 / D5 work to keep concerns separated.
