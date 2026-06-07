---
title: "D5 — Entity Lists"
subtitle: "The named accounts, regulators, publishers, pathway operators, test owners, CPD bodies and Trusts behind the HFF strategy"
author: "Paul Wander"
date: "7 June 2026"
version: "0.1"
---

<style>
  @page {
    size: A4;
    margin: 22mm 20mm 22mm 20mm;
    @bottom-center {
      content: "Page " counter(page) " of " counter(pages);
      font-size: 8pt; color: #94a3b8;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    @bottom-left {
      content: "HFF Strategy — D5";
      font-size: 8pt; color: #94a3b8;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
    @bottom-right {
      content: "Internal — Confidential";
      font-size: 8pt; color: #94a3b8;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }
  }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; line-height: 1.55; font-size: 11pt; }
  h1 { color: #0f172a; border-bottom: 3px solid #2563eb; padding-bottom: 8px; font-size: 22pt; margin-top: 0; }
  h2 { color: #1e3a5f; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 24px; font-size: 14pt; page-break-after: avoid; }
  h3 { color: #334155; margin-top: 18px; font-size: 12pt; page-break-after: avoid; }
  h4 { color: #475569; margin-top: 14px; font-size: 11pt; page-break-after: avoid; }
  p { margin: 8px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9pt; page-break-inside: avoid; }
  th, td { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; color: #0f172a; font-weight: 600; }
  code, pre { font-family: 'Menlo', monospace; font-size: 9pt; background: #f8fafc; }
  pre { padding: 10px; border-left: 3px solid #2563eb; page-break-inside: avoid; }
  blockquote { border-left: 3px solid #2563eb; padding-left: 12px; color: #334155; margin: 12px 0; }
  .meta { font-size: 9.5pt; color: #64748b; margin-top: -8px; margin-bottom: 16px; }
  .page-break { page-break-before: always; }
  .glossary { font-size: 9.5pt; }
  .glossary dt { font-weight: 600; color: #1e3a5f; }
  .glossary dd { margin: 0 0 4px 16px; }
  h2.section-break { page-break-before: always; }
  td.id { font-family: 'Menlo', monospace; font-size: 8.5pt; color: #1e3a5f; }
</style>

::: meta
**Status:** Internal — Sales + Commercial + Leadership   |   **Owner:** Paul Wander   |   **Reads with:** D1 (briefing), D2 (priority TAM), D4 (citations), D8 (sales GTM plan).
:::

## 1. Purpose

D5 is the **canonical entity directory** behind every named organisation that appears in the HFF strategy set. One row per organisation, organised into 7 tabs by entity type.

The canonical store is the sister file `D5-entities.csv`. This document is the **printable read-through** of that file — same schema, same row order, designed for board / advisor / investor reading where the live sheet isn't appropriate.

## 2. Schema

| Column | Type | Example | Notes |
|---|---|---|---|
| `tab` | enum | `IRAs` | One of: IRAs / Regulators / Publishers / Pathways / TestOwners / CPD / NHSTrusts |
| `entity_id` | text | `B.IRA.yourworld` | Stable key matching `D4-citations.csv` references where applicable. `<sector>.<area>.<short>`. |
| `name` | text | Yourworld Healthcare | Canonical organisation name. |
| `type` | text | IRA — overseas nurse placement | Sub-type within the tab. |
| `website` | url | https://… | Org homepage. `–` if not yet logged. |
| `primary_contact_role` | text | Head of International Recruitment | Title to address outbound to. |
| `linkedin` | url | https://linkedin.com/… | Named individual's profile (added when identified). `–` until then. |
| `status` | enum | Pipeline | One of: Pipeline / Active / Lapsed / Phase-2 / Future-OEM / –. |
| `last_touch` | date | – | YYYY-MM-DD of last meaningful interaction. |
| `owner` | text | Paul | HFF teammate accountable for the relationship. |
| `notes` | text | Tier 1 lead… | Source attribution, tier, or context. |

**Status values** (locked across all tabs):

- **Pipeline** — In active outbound. Not yet engaged.
- **Active** — Engaged — discovery, demo, pilot, or paid.
- **Phase-2** — Held back for Phase 2 (post-first-case-study). Not contacted yet.
- **Future-OEM** — Long-horizon partner (publisher, pathway operator, test owner). Not Phase-1 channel.
- **Lapsed** — Contacted but cold. Re-evaluate in next cycle.
- **–** — Not applicable (e.g. tail rows representing many small entities).

<h2 class="section-break">3. Summary by tab</h2>

| Tab | Rows | Phase | Notes |
|---|---|---|---|
| IRAs | 14 | **P1 (commit)** | 5 Tier-1 + 8 Tier-2 + 1 tail-row representing the remaining ~317 on the NHS Employers Code-of-Practice list. |
| Regulators | 9 | **P1 (commit, all 9 served by Sector B)** | The 9 UK statutory health-and-care regulators from D2 §4.2. |
| Publishers | 7 | P2 (future-OEM) | UK-HQ EFL/ELT publishers. Sector A Y2+ targets. |
| Pathways | 7 | P2 (future-OEM) | UK pathway operators. Sector C Y2+ targets. |
| Test Owners | 7 | P0/P2 | 3 IELTS partners + OET (CBLA) + PTE + DET + TOEFL. |
| CPD bodies | 23 | **P1 parallel (Sector G)** | 3 health-regulator overlaps + 20 chartered/professional bodies. Plus 1 tail-row for ~10 further bodies. |
| NHS Trusts | 11 | P2 (Phase-2 channel) | Top 10 named teaching trusts + 1 tail-row representing the remaining ~207. |
| **Total** | **78** | – | – |

<h2 class="section-break">4. Tab — IRAs (Phase-1 commit)</h2>

Sourced from the **NHS Employers Code-of-Practice "Ethical Recruiters" list** (~330 agencies, public, refreshed quarterly). All HFF outbound for Phase 1 flows through this tab.

### Tier 1 — Phase-1 outbound (D8 §3.1)

| `entity_id` | Name | Sub-type | Status | Notes |
|---|---|---|---|---|
| `B.IRA.yourworld` | Yourworld Healthcare | Overseas nurse placement | Pipeline | Largest UK IRA by nurse volume. |
| `B.IRA.hcl` | HCL Workforce Solutions | Nurse + AHP | Pipeline | Bundles English + OSCE; tech-curious. |
| `B.IRA.sanctuary` | Sanctuary Personnel | Nursing + social work | Pipeline | Wide AHP + social-work flow → adjacency proof. |
| `B.IRA.greenstaff` | Greenstaff Medical | Overseas nurse | Pipeline | Heavy India / Philippines pipeline. |
| `B.IRA.globe_locums` | Globe Locums | AHP-heavy | Pipeline | HCPC adjacency proof. |

### Tier 2 — Phase-1 mid (D8 §3.2)

| `entity_id` | Name | Sub-type | Status | Notes |
|---|---|---|---|---|
| `B.IRA.bwa` | BWA Medical | Mid-sized nurse | Pipeline | Agile; willing to pilot. |
| `B.IRA.pulse` | Pulse (BNF Group) | Diversified | Pipeline | Financial discipline. |
| `B.IRA.mediplacements` | Mediplacements | Filipino pipeline | Pipeline | Strong Filipino pipeline. |
| `B.IRA.trinity` | Trinity Group | Mid-tier | Pipeline | Ops-led. |
| `B.IRA.reed_health` | Reed Health | Brand-strong mid-tier | Pipeline | Brand recognition. |
| `B.IRA.compass` | Compass Associates | Specialist segments | Pipeline | – |
| `B.IRA.healthcare21` | HealthCare 21 | Mid-tier nurse + AHP | Pipeline | – |
| `B.IRA.mediserve` | Mediserve UK | Compliance-disciplined | Pipeline | – |

### Tier 3 — Phase-2 long-tail

| `entity_id` | Name | Sub-type | Status | Notes |
|---|---|---|---|---|
| `B.IRA.tail_317` | Tail (~317 remaining agencies) | Long-tail | Pipeline | Pull full Code-of-Practice list; seed individually during verification window. |

<h2 class="section-break">5. Tab — Regulators (Phase-1 served, all 9)</h2>

The 9 UK statutory health-and-care regulators. Sourced from D2 §4.2. Every one represents the licence-to-register gate for one or more Sector B sub-cohorts.

| `entity_id` | Name | Sub-type | UK registrants | Notes |
|---|---|---|---|---|
| `B.reg.nmc` | NMC | Nurses + midwives + nursing associates | 826 k | D4 `B.NMC.register_total`. 22–26 k intl joiners / yr. |
| `B.reg.gmc` | GMC | Doctors | 334 k | 14–16 k intl joiners / yr (PLAB ~3 k). |
| `B.reg.hcpc` | HCPC | 15 AHPs | 340 k | 5–7 k intl joiners / yr. |
| `B.reg.gphc` | GPhC | Pharmacists | 70 k | 1–2 k intl joiners / yr. |
| `B.reg.gdc` | GDC | Dentists | 120 k | 1–2 k intl joiners / yr. |
| `B.reg.swe` | SWE | Social workers | 100 k | 2–4 k intl joiners / yr. |
| `B.reg.goc` | GOC | Opticians + optometrists | (smaller body) | Part of ~40 k smaller-body total. |
| `B.reg.gosc` | GOsC | Osteopaths | (smaller body) | Part of ~40 k smaller-body total. |
| `B.reg.gcc` | GCC | Chiropractors | (smaller body) | Part of ~40 k smaller-body total. |

<h2 class="section-break">6. Tab — Publishers (Future-OEM, Sector A Y2+)</h2>

UK-HQ EFL / ELT publishers. Sector A unlock per D2 §10 ("Sector A Publisher OEM credibility — Cambridge UP&A / Macmillan — triggered after first 2 IRA case studies published").

| `entity_id` | Name | Sub-type | Status | Notes |
|---|---|---|---|---|
| `A.pub.cup_assess` | Cambridge University Press & Assessment (Cambridge UP&A) | Publisher + IELTS partner + EFL/ELT | Future-OEM | Also IELTS test owner partner — cross-listed in Test Owners. |
| `A.pub.oup` | Oxford University Press (OUP) | EFL/ELT | Future-OEM | UK-HQ EFL publisher. |
| `A.pub.pearson` | Pearson Education | EFL/ELT + PTE test owner | Future-OEM | Cross-listed in Test Owners. |
| `A.pub.macmillan` | Macmillan Education | EFL/ELT | Future-OEM | UK-HQ. Sector A Y2 target. |
| `A.pub.collins` | Collins (HarperCollins) | EFL/ELT | Future-OEM | HarperCollins Education. |
| `A.pub.hodder` | Hodder Education | EFL/ELT | Future-OEM | UK-HQ educational publisher. |
| `A.pub.garnet` | Garnet Education | EAP / EFL | Future-OEM | Pathway-aligned. |

<h2 class="section-break">7. Tab — Pathway providers (Future-OEM, Sector C Y2+)</h2>

UK pathway / pre-sessional / foundation operators. Sector C P2 unlock per D2 §3.

| `entity_id` | Name | Sub-type | Status | Notes |
|---|---|---|---|---|
| `C.path.into` | INTO University Partnerships | Pre-sessional + foundation | Future-OEM | UK-HQ. |
| `C.path.kaplan_ipw` | Kaplan International Pathways | Foundation + pre-sessional | Future-OEM | – |
| `C.path.study_group` | Study Group | International student progression | Future-OEM | – |
| `C.path.navitas` | Navitas UK | Pre-sessional + foundation | Future-OEM | UK arm of Australian-HQ group. |
| `C.path.oxford_intl` | Oxford International Education Group | Pre-sessional + summer school | Future-OEM | UK-HQ. |
| `C.path.ceg` | Cambridge Education Group (CEG / ONCAMPUS) | Foundation + diploma | Future-OEM | UK-HQ. ONCAMPUS brand. |
| `C.path.qa_he` | QA Higher Education | Partner-campus operator | Future-OEM | UK-HQ. |

<h2 class="section-break">8. Tab — Test Owners</h2>

The 3 IELTS partners plus the major competing tests. Sector A P0 (probe surface).

| `entity_id` | Name | Sub-type | Status | Notes |
|---|---|---|---|---|
| `A.test.british_council` | British Council | IELTS partner (administration + GT) | Future-OEM | Administers IELTS in 100+ countries. |
| `A.test.idp` | IDP IELTS | IELTS partner (admin + Academic) | Future-OEM | Australian-HQ but UK-active. |
| `A.test.cambridge_ielts` | Cambridge UP&A (IELTS arm) | IELTS partner (test design + ownership) | Future-OEM | Also Publisher. |
| `A.test.cbla` | Cambridge Boxhill Language Assessment (CBLA) | OET test owner | Future-OEM | Direct Sector B adjacency. |
| `A.test.pearson_pte` | Pearson (PTE Academic) | PTE | Future-OEM | Also Publisher. |
| `A.test.duolingo` | Duolingo (DET) | DET | – | US-HQ. UK-active. Lower price point. |
| `A.test.ets` | Educational Testing Service (ETS) | TOEFL | – | US-HQ. **TOEFL not accepted by NMC** — tertiary priority for Sector B. |

<h2 class="section-break">9. Tab — CPD bodies (Sector G P1 parallel)</h2>

UK CPD-mandated bodies running parallel to the Sector B commitment. 23 named + 1 tail row.

### Cross-listed health regulators (also Regulators tab)

| `entity_id` | Name | Sub-type | Notes |
|---|---|---|---|
| `B.cpd.nmc` | NMC revalidation | Health regulator-mandated CPD | Cross-listed. |
| `B.cpd.gmc` | GMC revalidation | Health regulator-mandated CPD | Cross-listed. |
| `B.cpd.hcpc` | HCPC re-registration CPD | Health regulator-mandated CPD | Cross-listed. |

### Accountancy

| `entity_id` | Name | Sub-type | Notes |
|---|---|---|---|
| `G.cpd.icaew` | ICAEW | Chartered body | ~150 k UK members. |
| `G.cpd.acca` | ACCA | Chartered body | ~250 k UK + global. Also a Sector D exam owner. |
| `G.cpd.cima` | CIMA | Chartered body | Part of AICPA-CIMA. |
| `G.cpd.cipfa` | CIPFA | Chartered body | Public-sector finance. |

### Legal

| `entity_id` | Name | Sub-type | Notes |
|---|---|---|---|
| `G.cpd.sra` | Solicitors Regulation Authority (SRA) | Legal regulator | SQE is also Sector D one-shot. |
| `G.cpd.bsb` | Bar Standards Board (BSB) | Legal regulator | Barrister training + CPD. |

### Architecture

| `entity_id` | Name | Sub-type | Notes |
|---|---|---|---|
| `G.cpd.riba` | Royal Institute of British Architects (RIBA) | Chartered body | – |
| `G.cpd.arb` | Architects Registration Board (ARB) | Regulator | – |

### Engineering

| `entity_id` | Name | Sub-type | Notes |
|---|---|---|---|
| `G.cpd.iet` | Institution of Engineering and Technology (IET) | Chartered body | ~150 k members. |
| `G.cpd.ice` | Institution of Civil Engineers (ICE) | Chartered body | – |
| `G.cpd.imeche` | Institution of Mechanical Engineers (IMechE) | Chartered body | – |
| `G.cpd.icheme` | Institution of Chemical Engineers (IChemE) | Chartered body | – |

### Cross-discipline professional bodies

| `entity_id` | Name | Sub-type | Notes |
|---|---|---|---|
| `G.cpd.cipd` | Chartered Institute of Personnel and Development (CIPD) | HR | ~150 k members. Highest leverage for L&D content. |
| `G.cpd.cim` | Chartered Institute of Marketing (CIM) | Marketing | – |
| `G.cpd.rics` | Royal Institution of Chartered Surveyors (RICS) | Surveying | – |
| `G.cpd.iosh` | Institution of Occupational Safety and Health (IOSH) | Safety chartered body | Bridges to NEBOSH. |
| `G.cpd.nebosh` | NEBOSH | Safety qualification + CPD | Sector G safety wedge target (D2 §10). |
| `G.cpd.bps` | British Psychological Society (BPS) | Psychology | – |

### Medical royal colleges

| `entity_id` | Name | Sub-type | Notes |
|---|---|---|---|
| `G.cpd.rcn` | Royal College of Nursing (RCN) | Nursing professional body | Cross-listed Sector B. |
| `G.cpd.rcp` | Royal College of Physicians (RCP) | Medical royal college | – |
| `G.cpd.rcgp` | Royal College of General Practitioners (RCGP) | Medical royal college | – |
| `G.cpd.rcs` | Royal College of Surgeons of England (RCS) | Medical royal college | – |

### Tail

| `entity_id` | Name | Sub-type | Notes |
|---|---|---|---|
| `G.cpd.tail_10` | Tail (~10 further bodies) | Long-tail | Smaller royal colleges + niche chartered bodies. Identify during verification window. |

<h2 class="section-break">10. Tab — NHS Trusts (Phase-2)</h2>

Top 10 teaching trusts named for Phase-2 channel entry (D8 §3.4 + D2 §6.4). Held back from Phase 1.

| `entity_id` | Name | Sub-type | Status | Notes |
|---|---|---|---|---|
| `B.trust.barts` | Barts Health NHS Trust | Teaching + overseas-recruiting | Phase-2 | D8 §3.4 named lead. London. |
| `B.trust.imperial` | Imperial College Healthcare NHS Trust | Teaching | Phase-2 | D8 §3.4 named lead. London. |
| `B.trust.manchester` | Manchester University NHS Foundation Trust | Teaching | Phase-2 | D8 §3.4 named lead. Largest acute trust by activity. |
| `B.trust.gstt` | Guy's and St Thomas' NHS Foundation Trust | Teaching | Phase-2 | London. |
| `B.trust.kch` | King's College Hospital NHS Foundation Trust | Teaching | Phase-2 | London. |
| `B.trust.uclh` | University College London Hospitals NHS Foundation Trust | Teaching | Phase-2 | London. |
| `B.trust.rfl` | Royal Free London NHS Foundation Trust | Teaching | Phase-2 | London. |
| `B.trust.cuh` | Cambridge University Hospitals NHS Foundation Trust | Teaching | Phase-2 | East of England. |
| `B.trust.ouh` | Oxford University Hospitals NHS Foundation Trust | Teaching | Phase-2 | South-Central. |
| `B.trust.sth` | Sheffield Teaching Hospitals NHS Foundation Trust | Teaching | Phase-2 | Yorkshire. |
| `B.trust.tail_207` | Tail (~207 remaining Trusts) | Long-tail | Phase-2 | 217 Trusts total. Rank remaining by overseas-nurse activity using NHSE workforce data. |

<h2 class="section-break">11. Outstanding work (V0.2 backlog)</h2>

| Area | Action | Effort |
|---|---|---|
| IRAs Tier 3 | Pull full NHS Employers Code-of-Practice list and seed all ~317 remaining agencies | 1 day (web scrape + clean) |
| LinkedIn enrichment | Identify and log named individuals for each Tier-1/2 IRA contact role | 2 days |
| Status discipline | First contacted-date / last-touch field discipline as soon as outbound starts | Per-touch |
| CPD tail | Identify the ~10 further UK CPD-mandated bodies | 0.5 day |
| NHS Trust ranking | Rank remaining 207 Trusts by overseas-nurse intake using NHSE workforce data | 1 week (FOI + analysis) |
| `linkedin` column | Replace all `–` once individuals named | Per-individual |
| Contact roles | Each row currently lists role; replace with `Firstname Lastname / Title` as people are identified | Per-individual |

## 12. How to regenerate the PDF

From the strategy directory:

```bash
cd docs/strategy
pandoc D5-entities.md -o D5-entities.pdf --pdf-engine=weasyprint --standalone
```

To re-import the CSV into Sheets: File → Import → `D5-entities.csv` → Replace current sheet. Then build a Filter View per `tab` column for the Google-Sheet-multi-tab experience.

<div class="page-break"></div>

## Appendix A — Doc index

| Code | Title | Status |
|---|---|---|
| D1 | Briefing Note | Shipped V0.2 |
| D2 | Priority TAM Overview | Shipped V0.2 |
| D3 | Full TAM & GTM Analysis | Paused |
| D4 | Citation Sheet | Shipped V0.1 |
| **D5** | **Entity Lists (this doc + CSV)** | **Shipped V0.1** |
| D6 | TAM Picture | Embedded in D1 / D2 |
| D7 | Nomenclature Standard | Embedded in D2 §2 |
| D8 | Sales GTM Plan — Phase-1 Slice | Shipped V0.1 |

<div class="page-break"></div>

## Glossary

<dl class="glossary">
<dt>ACCA</dt><dd>Association of Chartered Certified Accountants</dd>
<dt>AHP</dt><dd>Allied Health Professional</dd>
<dt>AICPA</dt><dd>American Institute of Certified Public Accountants</dd>
<dt>ARB</dt><dd>Architects Registration Board</dd>
<dt>BNF</dt><dd>BNF Group (parent of Pulse IRA)</dd>
<dt>BPS</dt><dd>British Psychological Society</dd>
<dt>BSB</dt><dd>Bar Standards Board</dd>
<dt>BWA</dt><dd>BWA Medical (IRA)</dd>
<dt>CBLA</dt><dd>Cambridge Boxhill Language Assessment (OET owner)</dd>
<dt>CEG</dt><dd>Cambridge Education Group</dd>
<dt>CIM</dt><dd>Chartered Institute of Marketing</dd>
<dt>CIMA</dt><dd>Chartered Institute of Management Accountants</dd>
<dt>CIPD</dt><dd>Chartered Institute of Personnel and Development</dd>
<dt>CIPFA</dt><dd>Chartered Institute of Public Finance and Accountancy</dd>
<dt>CPD</dt><dd>Continuing Professional Development</dd>
<dt>D1 – D8</dt><dd>HFF strategy document codes (see Appendix A)</dd>
<dt>DET</dt><dd>Duolingo English Test</dd>
<dt>EAP</dt><dd>English for Academic Purposes</dd>
<dt>EFL</dt><dd>English as a Foreign Language</dd>
<dt>ELT</dt><dd>English Language Teaching</dd>
<dt>ETS</dt><dd>Educational Testing Service (TOEFL owner)</dd>
<dt>FT</dt><dd>NHS Foundation Trust</dd>
<dt>GCC</dt><dd>General Chiropractic Council</dd>
<dt>GDC</dt><dd>General Dental Council</dd>
<dt>GMC</dt><dd>General Medical Council</dd>
<dt>GOC</dt><dd>General Optical Council</dd>
<dt>GOsC</dt><dd>General Osteopathic Council</dd>
<dt>GPhC</dt><dd>General Pharmaceutical Council</dd>
<dt>GT</dt><dd>General Training (IELTS variant)</dd>
<dt>HCL</dt><dd>HCL Workforce Solutions (IRA)</dd>
<dt>HCPC</dt><dd>Health and Care Professions Council</dd>
<dt>HFF</dt><dd>Human First Foundation</dd>
<dt>HR</dt><dd>Human Resources</dd>
<dt>ICAEW</dt><dd>Institute of Chartered Accountants in England and Wales</dd>
<dt>ICE</dt><dd>Institution of Civil Engineers</dd>
<dt>IChemE</dt><dd>Institution of Chemical Engineers</dd>
<dt>IDP</dt><dd>IDP IELTS (IELTS partner)</dd>
<dt>IELTS</dt><dd>International English Language Testing System</dd>
<dt>IET</dt><dd>Institution of Engineering and Technology</dd>
<dt>IMechE</dt><dd>Institution of Mechanical Engineers</dd>
<dt>INTO</dt><dd>INTO University Partnerships</dd>
<dt>IOSH</dt><dd>Institution of Occupational Safety and Health</dd>
<dt>IRA</dt><dd>International Recruitment Agency</dd>
<dt>L&amp;D</dt><dd>Learning and Development</dd>
<dt>NEBOSH</dt><dd>National Examination Board in Occupational Safety and Health</dd>
<dt>NHS</dt><dd>National Health Service</dd>
<dt>NHSE</dt><dd>NHS England</dd>
<dt>NMC</dt><dd>Nursing and Midwifery Council</dd>
<dt>OEM</dt><dd>Original Equipment Manufacturer (publisher embedding HFF inside their branded product)</dd>
<dt>OET</dt><dd>Occupational English Test</dd>
<dt>ONCAMPUS</dt><dd>CEG's foundation-pathway brand</dd>
<dt>OSCE</dt><dd>Objective Structured Clinical Examination</dd>
<dt>OUP</dt><dd>Oxford University Press</dd>
<dt>P0 – P5</dt><dd>HFF Priority codes</dd>
<dt>PLAB</dt><dd>Professional and Linguistic Assessments Board</dd>
<dt>PTE</dt><dd>Pearson Test of English</dd>
<dt>QA HE</dt><dd>QA Higher Education</dd>
<dt>RCGP</dt><dd>Royal College of General Practitioners</dd>
<dt>RCN</dt><dd>Royal College of Nursing</dd>
<dt>RCP</dt><dd>Royal College of Physicians</dd>
<dt>RCS</dt><dd>Royal College of Surgeons of England</dd>
<dt>RIBA</dt><dd>Royal Institute of British Architects</dd>
<dt>RICS</dt><dd>Royal Institution of Chartered Surveyors</dd>
<dt>Sector A – G</dt><dd>HFF Sector codes (A = Adult Language Cert; B = Health &amp; Care Pro Registration; C = University-Bound Journey; D = Regulated Pro Exams one-shot; E = Corporate Compliance Training; F = K-12 Mainstream; G = CPD Meta-sector)</dd>
<dt>SQE</dt><dd>Solicitors Qualifying Examination</dd>
<dt>SRA</dt><dd>Solicitors Regulation Authority</dd>
<dt>SWE</dt><dd>Social Work England</dd>
<dt>Tier 1 / 2 / 3</dt><dd>D8 account-prioritisation tiers</dd>
<dt>TOEFL</dt><dd>Test of English as a Foreign Language</dd>
<dt>UK-HQ</dt><dd>Headquartered in the United Kingdom</dd>
<dt>UP&amp;A</dt><dd>Cambridge University Press &amp; Assessment</dd>
</dl>
