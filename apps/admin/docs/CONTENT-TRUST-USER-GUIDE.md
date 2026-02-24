# Content Trust & Source Authority — User Guide

> Ensuring your AI tutor teaches from verified, authoritative sources — not hallucinations.

---

## What Is Content Trust?

When AI tutors teach regulated qualifications (e.g. CII Diploma R01–R06, Food Safety Level 2), the difference between *"the AI thinks pensions work like this"* and *"the CII R04 syllabus says this"* has real consequences — exam failure, mis-selling, or regulatory sanctions.

The Content Trust system solves this by:

- **Classifying content** by provenance and authority (6 trust levels)
- **Tracing every teaching point** back to its authoritative source
- **Weighting learner progress** by content trust (certification readiness vs general understanding)
- **Flagging stale content** (tax thresholds change every April, syllabi update annually)
- **Making the AI cite sources** and refuse to hallucinate

---

## Trust Levels at a Glance

| Level | Name | Example | Weight | Colour |
|-------|------|---------|--------|--------|
| **L5** | Regulatory Standard | CII R04 syllabus, FCA Handbook | 1.00 | Gold |
| **L4** | Accredited Material | CII-approved study text (BFT/ActEd) | 0.95 | Silver |
| **L3** | Published Reference | Academic textbook, peer-reviewed journal | 0.80 | Blue |
| **L2** | Expert Curated | Content by a qualified IFA/instructor | 0.60 | Green |
| **L1** | AI Assisted | AI-generated, human-reviewed | 0.30 | Orange |
| **L0** | Unverified | Unreviewed submissions, user notes | 0.05 | Red |

**Key rules:**
- All content starts at L0 (Unverified)
- Content can only be promoted upward through human verification
- Demotions require admin action with a logged reason
- The AI never auto-promotes content

---

## Pages & Navigation

The Content Trust system adds two pages under **Configure** in the sidebar, plus integrations on existing pages:

| Sidebar Item | Page | Purpose |
|---|---|---|
| **Materials** | `/x/content-sources` | Register and manage authoritative materials |
| **Review** | `/x/content-review` | Verify content trust levels and import documents |
| *(existing)* Specs | `/x/specs` | Freshness alert banner for expiring materials |
| *(existing)* Caller detail | Callers > [Caller] | Trust-weighted certification progress bars |

---

## 1. Materials — Registering Authoritative Material

**Navigate to:** Configure > Materials

This is your registry of authoritative materials — the books, syllabi, handbooks, and documents that your AI tutor is permitted to teach from.

### Viewing Materials

The page displays a table of all registered materials with:

- **Material** — Name, slug (unique identifier), and authors
- **Trust Level** — Colour-coded badge (L0–L5)
- **Qualification** — Qualification reference and accreditation details
- **Publisher** — Publishing organisation and accrediting body
- **Validity** — Freshness indicator showing days until expiry
- **Assertions** — Count of teaching points extracted from this source

### Filtering & Searching

- **Trust Level dropdown** — Filter materials by a specific trust level
- **Search box** — Search by name, slug, qualification ref, or publisher
- **Result count** — Shows how many materials match your filters

### Adding a New Material

Click **Add Material** to open the creation form:

| Field | Description | Example |
|---|---|---|
| Slug | Unique identifier (lowercase, hyphens) | `cii-r04-syllabus-2025` |
| Name | Display name | CII R04 Syllabus 2025/26 |
| Trust Level | Initial trust classification | Regulatory Standard (L5) |
| Publisher | Publishing organisation | Chartered Insurance Institute |
| Accrediting Body | Body that accredits this material | CII |
| Qualification Ref | Qualification code | R04 |
| Authors | Comma-separated author list | — |
| ISBN | Book ISBN (if applicable) | 978-1-XXXXX |
| Edition | Edition number | 2025 |
| Publication Year | Year published | 2025 |
| Valid From | Date this source becomes effective | 2025-09-01 |
| Valid Until | Date this source expires | 2026-08-31 |

**Validity dates are critical for regulated content.** Tax thresholds, syllabus content, and regulatory rules change on specific dates. Setting `Valid Until` ensures you get alerts before content goes stale.

### Freshness Indicators

Sources display colour-coded freshness:

- **Green** — "Valid until [date]" — more than 60 days remaining
- **Orange** — "Expires in Xd" — 60 days or fewer remaining
- **Red** — "Expired X days ago" — past expiry date

---

## 2. Content Review — Verifying & Promoting Content

**Navigate to:** Configure > Review

The review queue is where you verify content quality and promote sources through trust levels.

### Summary Cards

Three cards at the top show your review workload:

- **Needs Review** — Count of L0/L1 sources awaiting verification (red if > 0)
- **Expired/Expiring** — Count of sources past or near their validity date (orange if > 0)
- **Total Sources** — Total registered sources

### Tabs

#### Needs Review (L0/L1)

Shows all sources at trust levels L0 (Unverified) or L1 (AI Assisted). These are sources that need a human reviewer to verify their accuracy and promote them.

Each source shows:
- Name, trust badge, and freshness indicator
- Metadata: slug, publisher, qualification, assertion count
- **Review** button to open the promotion modal

#### Expired/Expiring

Shows sources that have expired or will expire within 60 days. These need attention — either update the validity dates (if the content is still current) or replace with updated material.

#### Import Document

Upload documents to extract teaching points automatically. See [Importing Documents](#3-importing-documents) below.

#### All Sources

Complete list of all registered sources for reference.

### Promoting a Source (Review Modal)

Click **Review** on any source to open the promotion modal:

1. **Review the source details** — name, slug, current trust level, publisher, freshness
2. **Select the new trust level** — the next level up is suggested, but you can choose any higher level
3. **Write verification notes** (required) — explain *why* this trust level is appropriate
   - Good: *"Verified against CII R04 syllabus 2025/26. All learning outcomes cross-referenced. Published by CII directly."*
   - Bad: *"Looks fine"*
4. Click **Update Trust Level**

**What happens:**
- The source is promoted to the new trust level
- All assertions linked to this source inherit the new trust level
- An audit trail records who verified it, when, and why
- The direction (PROMOTED or DEMOTED) is logged with the old and new levels

---

## 3. Importing Documents

**Navigate to:** Configure > Review > Import Document tab

The import feature lets you upload a document (PDF, text, markdown, or JSON) and use AI to extract atomic teaching points (assertions) from it.

### Step-by-Step

1. **Select a material** — Choose which registered material this document belongs to from the dropdown
2. **Upload a file** — Drag or select a file (supported: `.pdf`, `.txt`, `.md`, `.json`)
3. **Preview extraction** — Click **Preview Extraction** to run AI analysis without saving anything
4. **Review the results** — Each extracted assertion shows:
   - **Category badge** — fact, definition, threshold, rule, process, or example
   - **Chapter/Section** — Where in the document this was found
   - **Exam relevance** — AI-estimated likelihood of appearing in an exam (green if 70%+)
   - **Assertion text** — The actual teaching point
   - **Tags** — Keywords for classification
5. **Import** — If the preview looks good, click **Import X Assertions** to save them to the database

### Assertion Categories

| Category | What It Captures | Example |
|---|---|---|
| **Fact** | A specific factual statement | "The ISA allowance is £20,000" |
| **Definition** | A term definition | "An annuity is a series of regular payments" |
| **Threshold** | A numeric limit or boundary | "Higher rate tax starts at £50,270" |
| **Rule** | A regulatory or procedural rule | "Advisors must check affordability before recommending" |
| **Process** | A step in a procedure | "Step 3: Calculate the net relevant earnings" |
| **Example** | An illustrative example | "If a client earns £80,000..." |

### Deduplication

The system automatically prevents duplicate assertions:
- Each assertion gets a content hash based on its text
- On import, assertions that already exist for this source are skipped
- The import result shows how many duplicates were skipped

### Tips for Best Results

- **Shorter, focused documents** produce better results than entire textbooks
- Use **Focus Chapters** (via the API) to target specific sections of large documents
- **Preview first** — always preview before importing to catch extraction errors
- **PDF quality matters** — scanned PDFs with poor OCR will produce poor results
- After importing, review assertions on the source detail view and remove any inaccurate ones

---

## 4. Freshness Alerts on the Specs Page

**Navigate to:** Configure > Specs

If any materials are expired or expiring soon, a banner appears at the top of the Specs page:

- **Red banner** — "X expired materials need updating" — content has passed its validity date and may contain outdated information (e.g. last year's tax rates)
- **Orange banner** — "X materials expiring soon" — content will expire within 60 days

Click **Manage materials** to go directly to the Materials page.

**Why this is here:** Specs drive the AI tutor's behaviour. If the materials backing those specs are stale, the AI may teach outdated material. This banner ensures you see freshness issues where they matter most.

---

## 5. Trust-Weighted Progress on Caller Pages

**Navigate to:** Data > Callers > [Select a caller]

In the caller detail view, the **Certification Progress** section shows dual-track progress for each active curriculum:

### Two Progress Bars

- **Certification Readiness** (green bar) — Only measures mastery of L3+ content (Published Reference or higher). This answers: *"Is this learner ready for the exam?"*
- **General Understanding** (purple bar) — Measures mastery across all content regardless of trust level. This answers: *"How well does this learner understand the subject generally?"*

### Why Two Tracks?

A learner might score 85% on general understanding (they've absorbed supplementary material, AI-generated quizzes, etc.) but only 68% on certification readiness (they haven't yet mastered the specific syllabus content that appears on the exam). The dual-track system makes this gap visible.

### Module Breakdown

Click **Module breakdown** to expand a per-module view showing:

- **Module ID** — The module or learning outcome reference
- **Trust level badge** — The trust level of the content for this module
- **Mastery %** — Colour-coded: green (80%+), orange (50–79%), muted (<50%)
- **Certification eligible** — Checkmark if this module counts toward certification (L3+), minus sign if not

### Summary Line

Below the progress bars: *"X of Y modules count toward certification (L3+)"*

This tells you at a glance how much of the curriculum is backed by authoritative sources vs supplementary material.

---

## Typical Workflows

### Setting Up a New Qualification (e.g. CII R04)

1. **Register the primary source** — Go to Sources, add the CII R04 Syllabus as L5 (Regulatory Standard) with validity dates matching the syllabus year
2. **Register secondary sources** — Add approved study texts (e.g. BFT R04 Study Text) as L4 (Accredited Material)
3. **Import content** — Go to Review > Import Document, select the source, upload the PDF, preview, then import
4. **Create the curriculum spec** — Link the content to a CURRICULUM spec with `sourceAuthority` referencing these sources
5. **Verify** — Spot-check a sample of extracted assertions against the original document

### Annual Content Refresh (e.g. New Tax Year)

1. **Check freshness alerts** — Visit Specs page, note any red/orange banners
2. **Register updated source** — Add the new edition/year as a new ContentSource
3. **Link supersession** — The old source can be marked as superseded by the new one
4. **Import updated content** — Upload the new document, import assertions
5. **Update validity** — Ensure the new source has correct Valid From/Until dates
6. **Review** — Verify any changed thresholds or rules

### Reviewing Unverified Content

1. **Visit the Review page** — Check the "Needs Review" tab
2. **For each source**, assess:
   - Is this from a known, reputable publisher?
   - Has it been cross-referenced against the qualification syllabus?
   - Are the extracted assertions accurate?
3. **Promote** — Select the appropriate trust level and document your reasoning
4. **Monitor** — The source's assertions now carry the promoted trust level and will be weighted accordingly in learner progress

---

## FAQ

**Q: What happens if I don't set a Valid Until date?**
A: The source is treated as perpetually valid. This is fine for timeless content but dangerous for regulated material with annual updates (tax rates, syllabus changes).

**Q: Can I demote a source's trust level?**
A: Yes, but it requires admin privileges and you must provide a reason. Demotions are logged in the audit trail.

**Q: Does promoting a source automatically promote its assertions?**
A: Yes. Individual assertions inherit their trust level from their parent source (unless overridden). Promoting a source from L0 to L4 means all its assertions are now treated as L4.

**Q: What's the difference between Sources and Specs?**
A: A **Source** is a real-world document (book, syllabus, handbook). A **Spec** is a system configuration that tells the AI how to behave. Specs *reference* Sources via `sourceAuthority` to establish what the AI is allowed to teach.

**Q: How does the AI use trust levels?**
A: During prompt composition, the AI receives a reference card of trusted facts from L3+ sources. It's instructed to cite these sources, refuse to invent information, and flag anything outside its verified materials. Post-call supervision scores whether the AI actually did this.

**Q: Can I import the same document twice?**
A: Yes, but duplicates are automatically skipped. Each assertion has a content hash — if it already exists for that source, it won't be re-imported.

---

## Glossary

| Term | Definition |
|---|---|
| **Material** | A registered authoritative document (book, syllabus, handbook) |
| **Content Assertion** | A single, atomic teaching point extracted from a material |
| **Trust Level** | A classification (L0–L5) indicating the authority and reliability of a material |
| **Certification Readiness** | Learner progress measured only against L3+ (authoritative) content |
| **General Understanding** | Learner progress across all content regardless of trust level |
| **Freshness** | Whether a material is still within its validity period |
| **Content Hash** | A unique fingerprint of an assertion's text, used for deduplication |
| **Source Authority** | The `sourceAuthority` section in a spec that links curriculum content to registered materials |

---

*Last updated: February 2026*
