# HF Admin Architecture

<!-- @doc-source model:Domain,Caller,Call,Playbook,AnalysisSpec,Parameter -->
<!-- @doc-source model:CallScore,CallerMemory,CallerPersonalityProfile -->
<!-- @doc-source file:apps/admin/lib/pipeline/config.ts,apps/admin/lib/ops/pipeline-run.ts -->
<!-- @doc-source file:apps/admin/app/api/calls/[callId]/pipeline/route.ts -->
<!-- @doc-source route:/api/calls/:callId/pipeline -->

> **See also**: [HF System Architecture](../ARCHITECTURE.md) for the comprehensive system-wide architecture (pipeline stages, memory system, reward loop, database schema, API reference, UI pages).

This document describes the core architecture of the HF Admin application, focusing on the analysis pipeline and how components connect.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Data Flow](#data-flow)
3. [BDD Lab Pipeline](#bdd-lab-pipeline)
4. [Analysis Pipeline](#analysis-pipeline)
5. [Key Models](#key-models)

---

## Core Concepts

### Domain
A **Domain** represents a category of callers (e.g., "tutor", "support", "sales"). Each domain can have its own playbook defining what analysis runs.

### Caller
A **Caller** is a person who interacts with the system. Each caller belongs to exactly one Domain.

### Playbook
A **Playbook** is a curated collection of AnalysisSpecs that defines what analysis to run for a Domain. Only one playbook per domain can be `PUBLISHED` at a time.

### AnalysisSpec
An **AnalysisSpec** defines a single analysis operation:
- **MEASURE**: Scores caller parameters (personality, engagement, etc.) → `CallScore`
- **LEARN**: Extracts memories/facts from transcripts → `CallerMemory`
- **MEASURE_AGENT**: Measures agent behavior quality → `BehaviorMeasurement`
- **AGGREGATE**: Combines scores into personality profiles → `CallerPersonality`

### Parameter
A **Parameter** is a measurable dimension (e.g., "B5-O" for Openness, "engagement", "empathy_rate").

### Spec Scope
The `scope` field (stored in `AnalysisSpec.scope`) determines **when** a spec runs in the pipeline:

| Scope | When it Runs | Examples |
|-------|--------------|----------|
| **SYSTEM** | Always enabled for all playbooks | Memory extraction, OCEAN personality, guardrails |
| **DOMAIN** | Configured per playbook via PlaybookItems | Knowledge assessments, domain-specific metrics |

**Note:** Currently, all SYSTEM specs are always enabled for all playbooks. Per-playbook toggling of SYSTEM specs is not yet implemented (see TODO.md).

### CallTarget vs CallerTarget
- **CallTarget**: Per-call computed targets (output of ADAPT specs)
- **CallerTarget**: Aggregated caller-level targets (moving average for prompt composition)

---

## Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              BDD LAB                                      │
│                                                                          │
│   Upload XML → Validate → Compile → BDDFeatureSet → ACTIVATE            │
│                                                         │                │
└─────────────────────────────────────────────────────────┼────────────────┘
                                                          │
                              ┌────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          PRODUCTION LAYER                                 │
│                                                                          │
│   Parameter ◄─────┐                                                      │
│                   │                                                      │
│   AnalysisSpec ◄──┼── Created by activation                             │
│       │           │                                                      │
│       ├── Triggers (when to run)                                         │
│       └── Actions (what to do)                                           │
│                   │                                                      │
│   PromptSlug ◄────┘                                                      │
│                                                                          │
└─────────────────────────────────────────────────────────┬────────────────┘
                                                          │
                              ┌────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           PLAYBOOK LAYER                                  │
│                                                                          │
│   Domain ──► Playbook (PUBLISHED) ──► PlaybookItems ──► DOMAIN Specs    │
│      │                                                                   │
│      └──► Caller                                     + SYSTEM Specs      │
│                                                       (always included)  │
└─────────────────────────────────────────────────────────┬────────────────┘
                                                          │
                              ┌────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         ANALYSIS PIPELINE                                 │
│                                                                          │
│   POST /api/calls/[callId]/pipeline                                      │
│       │                                                                  │
│       ├── 1. Get caller's domain                                         │
│       ├── 2. Find PUBLISHED playbook for domain                          │
│       ├── 3. Extract specs from PlaybookItems                            │
│       ├── 4. Run MEASURE specs → CallScore                               │
│       ├── 5. Run LEARN specs → CallerMemory                              │
│       ├── 6. Run MEASURE_AGENT specs → BehaviorMeasurement               │
│       ├── 7. Compute Reward → RewardScore                                │
│       ├── 8. Compute Adapt → Delta scores                                │
│       └── 9. Aggregate Personality → CallerPersonality                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## BDD Lab Pipeline

The BDD Lab allows defining analysis specifications using BDD-style XML files.

### Upload → Validate → Compile → Activate

1. **Upload** (`/api/lab/uploads`)
   - Accept XML file (BDD story, parameter definitions, or hybrid)
   - Store as `BDDUpload` with raw content

2. **Validate** (`/api/lab/uploads/validate-ai`)
   - AI parses and validates XML structure
   - Checks for required fields, valid enums
   - Returns validation status and parsed content

3. **Compile** (`/api/lab/uploads/compile-ai`)
   - Transforms validated content into `BDDFeatureSet`
   - Extracts parameters, triggers, actions, learn specs
   - Stores compiled JSON in `compiledDefinitions`

4. **Activate** (`/api/lab/features/[id]/activate`)
   - Converts `BDDFeatureSet` into production records:
     - `Parameter` records (with scoring anchors)
     - `AnalysisSpec` records (MEASURE or LEARN type)
     - `AnalysisTrigger` records (with Gherkin conditions)
     - `AnalysisAction` records (what each spec does)
     - `PromptSlug` records (for personality-driven prompts)
   - Sets `isActive = true` on created specs

### File Types

| Type | Purpose | Contains |
|------|---------|----------|
| BDD Story | Define behaviors | Gherkin scenarios, acceptance criteria |
| Parameter Definition | Define measurements | Parameters, scoring anchors, interpretation |
| Hybrid | Both | Combined story + parameter definitions |

---

## Analysis Pipeline

### Endpoint
`POST /api/calls/[callId]/pipeline`

### Request Body
```json
{
  "callerId": "uuid",
  "mode": "prep" | "prompt",
  "engine": "mock" | "claude" | "openai"
}
```

### Modes

**prep**: Run all analysis steps, store results
- MEASURE caller parameters
- LEARN (extract memories)
- MEASURE_AGENT (evaluate agent)
- Compute reward score
- Compute adapt deltas
- Aggregate personality

**prompt**: Run prep + compose final prompt for next call

### Spec Selection (Playbook-Aware)

The pipeline selects specs based on the caller's domain via `getPlaybookSpecs()`:

```typescript
// In route.ts
async function getPlaybookSpecs(callerId, outputTypes, log) {
  // 1. Get caller's domain
  const caller = await prisma.caller.findUnique({ where: { id: callerId } });

  // 2. Find PUBLISHED playbook for domain
  const playbook = await prisma.playbook.findFirst({
    where: { domainId: caller.domainId, status: "PUBLISHED" },
    include: { items: { where: { itemType: "SPEC", isEnabled: true } } }
  });

  // 3. Return specs from playbook (or fallback to all active)
  if (!playbook) return { specs: allActiveSpecs, fallback: true };
  return { specs: playbook.items.map(i => i.spec), fallback: false };
}
```

**Fallback Behavior**: If no published playbook exists for the domain, the pipeline falls back to running all active specs globally (with a warning in logs).

### Pipeline by Spec Type (Target Architecture)

```
Call N arrives
     │
     ▼
┌─────────────────────────────────────┐
│  1. SYSTEM specs (always run)       │
│     - Memory extraction → CallerMemory
│     - Personality → CallScore       │
│     - Baseline targets → CallTarget │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  2. DOMAIN specs (from playbook)    │
│     - Domain-specific → CallScore   │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  3. ADAPT specs                     │
│     - Personalized targets          │
│     → CallTarget (overwrites)       │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  4. SUPERVISE specs                 │
│     - Validate/refine targets       │
│     → CallTarget (final)            │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  5. Aggregate                       │
│     CallTarget → CallerTarget       │
│     (moving average)                │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│  6. MEASURE_AGENT                   │
│     Compare agent vs CallTarget     │
│     → BehaviorMeasurement           │
└─────────────────────────────────────┘
     │
     ▼
Compose prompt for Call N+1
(using CallerTarget)
```

### Output Tables

| Analysis Type | Output Table | Key Fields |
|---------------|--------------|------------|
| MEASURE | CallScore | callId, parameterId, score, confidence |
| LEARN | CallerMemory | callerId, category, key, value, evidence |
| ADAPT | CallTarget | callId, parameterId, targetValue, reasoning |
| AGGREGATE (targets) | CallerTarget | callerId, parameterId, targetValue |
| MEASURE_AGENT | BehaviorMeasurement | callId, parameterId, actualValue |
| REWARD | RewardScore | callId, overallScore, parameterDiffs |
| AGGREGATE (personality) | CallerPersonality | callerId, openness, conscientiousness, ... |

---

## Key Models

### AnalysisSpec

```prisma
model AnalysisSpec {
  id          String            @id
  slug        String            @unique
  name        String
  outputType  AnalysisOutputType  // MEASURE, LEARN, MEASURE_AGENT, AGGREGATE
  scope       SpecificationScope  // SYSTEM, DOMAIN, SEGMENT, CALLER
  isActive    Boolean
  isDirty     Boolean           // Needs recompilation

  triggers    AnalysisTrigger[]
  playbooks   PlaybookItem[]    // Which playbooks include this spec
}
```

### Playbook

```prisma
model Playbook {
  id          String
  name        String
  domainId    String            // Which domain this playbook is for
  domain      Domain
  status      PlaybookStatus    // DRAFT, PUBLISHED, ARCHIVED
  items       PlaybookItem[]    // Specs and templates in this playbook
}
```

### PlaybookItem

```prisma
model PlaybookItem {
  id          String
  playbookId  String
  itemType    PlaybookItemType  // SPEC, PROMPT_TEMPLATE
  specId      String?           // If itemType = SPEC
  sortOrder   Int               // Execution order
  isEnabled   Boolean
}
```

---

## Prompt Composition Pipeline

The `CompositionExecutor` orchestrates prompt assembly for each call via a declarative, spec-driven pipeline defined in COMP-001.

### How It Works

```
COMP-001 spec sections[]
    ↓
CompositionExecutor.executeComposition()
    ↓
1. Load all data in parallel (SectionDataLoader)
2. Resolve identity/content/voice specs
3. Compute shared state (modules, session flow)
4. Topological sort sections by dependsOn
5. For each section:
   a. Check activation condition
   b. Resolve data source
   c. Apply transform(s) — single or chained
   d. Store output in context
6. Assemble final llmPrompt JSON
```

### Transform Chains

Each section's `transform` field supports three forms:

| Form | Example | Behavior |
|------|---------|----------|
| `null` | `"transform": null` | Pass raw data through |
| `string` | `"transform": "mapPersonalityTraits"` | Single transform |
| `string[]` | `"transform": ["deduplicateMemories", "scoreMemoryRelevance", "groupMemoriesByCategory"]` | Chained pipeline — output of each feeds the next |

**Execution model**: Array transforms run sequentially. Each transform receives the previous transform's output as `rawData`. If any transform in the chain is unknown, the chain breaks with an error log.

**Code**: `CompositionExecutor.ts:100-118`

### Memory Processing Sub-Flow

The `memories` section uses a 3-stage transform chain:

```
MemoryData[]
    ↓
[1] deduplicateMemories
    Deduplicate by normalized key (category:key_name)
    Keeps highest-confidence entry per key
    Output: MemoryData[] (deduplicated)
    ↓
[2] scoreMemoryRelevance
    Compute contextual relevance via keyword overlap
    Blend with confidence: score = α·confidence + (1-α)·relevance
    α (relevanceAlpha) comes from COMP-001 memory_section.config
    Sort descending by combined score
    Output: ScoredMemory[] (with relevance + combinedScore)
    ↓
[3] groupMemoriesByCategory
    Group into byCategory (limited by memoriesPerCategory)
    Build all[] (top 20) and _deduplicated (full list)
    Output: { totalCount, byCategory, all, _deduplicated }
```

**Relevance scoring algorithm** (`computeMemoryRelevance`):
1. Tokenize session context (current module, next module, upcoming topics, learner goals) into keywords (3+ chars, lowercased)
2. Tokenize memory content (`key + value`) into keywords
3. Overlap score = `min(1, matches / min(memoryTokens.length, 3))`
4. Add per-category boost from `categoryRelevanceWeights` (e.g., CONTEXT: 0.15, TOPIC: 0.10)
5. Cap at 1.0

**Alpha blending** (`relevanceAlpha` from COMP-001):
- `α = 1.0` → pure confidence ordering (legacy behavior)
- `α = 0.0` → pure relevance ordering
- `α = 0.6` (default) → 60% confidence + 40% relevance

**Backward compatibility**: The legacy monolithic `deduplicateAndGroupMemories` transform is still registered. Specs using the single-string form still work.

### Narrative Memory Framing

Memories are rendered as natural-language sentences in the instructions section using spec-driven templates from COMP-001 `memory_section.config.narrativeTemplates`.

**Template resolution**:
1. Look up memory key (normalized to snake_case) in `narrativeTemplates`
2. If found, use template with `{value}` substitution (e.g., `"location" → "They live in {value}"`)
3. If not found, use `genericNarrativeTemplate` with `{key}` and `{value}` (default: `"Their {key} is {value}"`)

**Example output**:
```
What you know about this caller: They live in London. They work as a teacher.
Their hobby is gardening. Reference these details naturally in conversation.
```

**Code**: `transforms/instructions.ts:narrativeFrame()`

### Registered Transforms

| Transform | Input | Output | Used By |
|-----------|-------|--------|---------|
| `deduplicateMemories` | `MemoryData[]` | `MemoryData[]` | memories chain |
| `scoreMemoryRelevance` | `MemoryData[]` | `ScoredMemory[]` | memories chain |
| `groupMemoriesByCategory` | `MemoryData[]` | `{ totalCount, byCategory, all, _deduplicated }` | memories chain |
| `deduplicateAndGroupMemories` | `MemoryData[]` | same as above (legacy) | backward compat |
| `mapPersonalityTraits` | `PersonalityData` | `{ traits }` | personality |
| `mergeAndGroupTargets` | `{ behaviorTargets, callerTargets }` | `{ totalCount, byDomain, all }` | behavior_targets |
| `computeCallHistory` | `{ recentCalls, callCount }` | `{ totalCalls, mostRecent, recent }` | call_history |
| `computeModuleProgress` | `AssembledContext` | curriculum progress | curriculum |
| `computeInstructions` | `AssembledContext` | instructions object | instructions |
| `computeSessionPedagogy` | `AssembledContext` | pedagogy object | instructions_pedagogy |
| `computeVoiceGuidance` | `AssembledContext` | voice guidance | instructions_voice |
| `computeQuickStart` | `AssembledContext` | quick start summary | _quickStart |
| `computePreamble` | `AssembledContext` | preamble + rules | _preamble |
| `extractIdentitySpec` | `AssembledContext` | identity config | identity |
| `computeTrustContext` | `AssembledContext` | trust context | contentTrust |
| `narrativeFrame` | `memories[]` | narrative string | used within computeInstructions |

---

## Adaptation Pipeline (ADAPT Specs)

ADAPT specs evaluate learner profiles and measured scores to compute personalized behavior targets.

### Flex Condition Operators

Conditions in adaptation rules support 7 operators:

| Operator | Field | Example | Description |
|----------|-------|---------|-------------|
| `eq` | `value` | `{ "profileKey": "learningStyle", "value": "visual" }` | Exact match (default when `operator` is omitted) |
| `gt` | `threshold` | `{ "profileKey": "engagement_score", "operator": "gt", "threshold": 0.7 }` | Greater than |
| `gte` | `threshold` | `{ "profileKey": "confidence", "operator": "gte", "threshold": 0.6 }` | Greater than or equal |
| `lt` | `threshold` | `{ "profileKey": "error_rate", "operator": "lt", "threshold": 0.3 }` | Less than |
| `lte` | `threshold` | `{ "profileKey": "score", "operator": "lte", "threshold": 0.5 }` | Less than or equal |
| `between` | `range` | `{ "profileKey": "score", "operator": "between", "range": { "min": 0.3, "max": 0.7 } }` | Inclusive range [min, max] |
| `in` | `values` | `{ "profileKey": "style", "operator": "in", "values": ["visual", "kinesthetic"] }` | Value in set |

### Data Sources

Conditions can read from two data sources:

| Source | Field | Description |
|--------|-------|-------------|
| `learnerProfile` (default) | `dataSource: "learnerProfile"` | Reads from `CallerLearnerProfile` (string values: `learningStyle`, `pacePreference`, etc.) |
| `parameterValues` | `dataSource: "parameterValues"` | Reads from `CallerPersonalityProfile.parameterValues` (numeric scores from MEASURE specs) |

### Adjustment Methods

| Method | Field | Description |
|--------|-------|-------------|
| `set` | `value` | Set target to absolute value |
| `increase` | `delta` | Add delta to current value (capped at 1.0) |
| `decrease` | `delta` | Subtract delta from current value (floored at 0.0) |

**Confidence**: Read from spec `config.defaultAdaptConfidence` (not hardcoded).

**Code**: `lib/pipeline/adapt-runner.ts`

---

## Configuration

### Memory Categories

| Category | Description | Example |
|----------|-------------|---------|
| FACT | Immutable facts | "lives in London" |
| PREFERENCE | Caller preferences | "prefers email" |
| EVENT | Time-bound events | "meeting on Friday" |
| TOPIC | Topics discussed | "interested in pricing" |
| RELATIONSHIP | People mentioned | "works with John" |
| CONTEXT | Situational context | "traveling next week" |

### Personality Aggregation

The `system-personality-aggregate` spec configures how personality is computed:

```json
{
  "traitMapping": {
    "B5-O": "openness",
    "B5-C": "conscientiousness",
    "B5-E": "extraversion",
    "B5-A": "agreeableness",
    "B5-N": "neuroticism"
  },
  "halfLifeDays": 30,
  "defaultConfidence": 0.7
}
```

---

## API Reference

### BDD Lab

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/lab/uploads` | POST | Upload BDD file |
| `/api/lab/uploads/validate-ai` | POST | Validate with AI |
| `/api/lab/uploads/compile-ai` | POST | Compile to FeatureSet |
| `/api/lab/features/[id]/activate` | POST | Activate/deactivate specs |

### Playbooks

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/playbooks` | GET, POST | List/create playbooks |
| `/api/playbooks/[id]` | GET, PATCH | Get/update playbook |
| `/api/playbooks/[id]/publish` | POST | Publish playbook |
| `/api/playbooks/[id]/items` | GET, POST | Manage playbook items |

### Analysis

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/calls/[callId]/pipeline` | POST | Run full analysis pipeline |
| `/api/analysis/run` | POST | Run specific specs manually |
| `/api/callers/[id]/compose-prompt` | POST | Compose prompt for caller |

---

## Pipeline LLM Integration

The pipeline ops (`personality-analyze.ts`, `measure-agent.ts`, `memory-extract.ts`) use real LLM calls with graceful fallback to mock scoring on failure.

### Call Pattern

```
Pipeline Op → getConfiguredMeteredAICompletion() → LLM Provider
                    ↓ (on failure)
              mockScore() fallback + logAIInteraction(outcome: "failure")
```

- **LLM by default**: `mock = false` in all ops. Use `--mock` CLI flag to opt into mock scoring.
- **Configurable engine**: Each spec's `config.llmConfig.engine` determines the model (e.g., `"claude"`, `"openai"`).
- **Pipeline gates**: `getPipelineGates()` provides transcript length gating and confidence caps.
- **JSON recovery**: `recoverBrokenJson()` handles malformed LLM output before parsing.
- **Fire-and-forget failure logging**: All catch blocks log to `AIInteractionLog` via dynamic `import()` without breaking the fallback chain.

### Pipeline Ops

| Op | File | callPoint | What it does |
|----|------|-----------|-------------|
| Personality Analyze | `lib/ops/personality-analyze.ts` | `pipeline.personality_score` | Score caller parameters from transcript |
| Measure Agent | `lib/ops/measure-agent.ts` | `pipeline.score_agent` | Score agent behavior quality |
| Memory Extract | `lib/ops/memory-extract.ts` | `pipeline.memory_extract` | Extract key-value memories from transcript |
| Pipeline Run | `lib/ops/pipeline-run.ts` | — | Orchestrates all ops in sequence |

---

## AI Error Monitor

Tracks pipeline LLM failures and provides real-time visibility for sysadmins.

### Data Flow

```
Pipeline catch block
    ↓
logAIInteraction(outcome: "failure") → AIInteractionLog table
    ↓
getRecentFailures() / getFailureStats() queries
    ↓
GET /api/ai/errors → AI Error Dashboard (/x/ai-errors)
```

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/errors` | GET | Failure data + stats. Params: `hours`, `limit`, `callPoint` |

### Dashboard (`/x/ai-errors`)

- **Stats cards**: Total failures, failure rate, total interactions
- **Alert banner**: Red warning when any pipeline call point exceeds 20% failure rate (min 5 interactions)
- **Call point breakdown**: Per-call-point failure rate table
- **Recent failures**: Scrollable list with expand-to-detail, auto-refresh every 30s
- **Time range**: 1h / 6h / 24h / 7d selector

### Key Functions (`lib/ai/knowledge-accumulation.ts`)

| Function | Purpose |
|----------|---------|
| `getRecentFailures(options)` | Query recent failures by time window and call point |
| `getFailureStats(hours)` | Compute failure rate per call point with alert threshold |

---

## AI Knowledge & Learning

Logs all AI interactions, extracts patterns, and builds confidence scores for system-wide learning.

### Data Flow

```
AI endpoint call → logAIInteraction() → AIInteractionLog
                                           ↓
                                    extractPatterns() → AILearnedPattern
                                           ↓
                                    AI Knowledge Dashboard (/x/ai-knowledge)
```

### Pattern Learning

- Logs all AI interactions to `AIInteractionLog` table
- After 3+ similar occurrences, extracts patterns with starting confidence 0.3
- Confidence increases by 0.05 per additional occurrence
- Stores in `AILearnedPattern` table with examples

### Dashboard (`/x/ai-knowledge`)

- Total AI interactions logged
- Success rate across all call points
- Top call points by interaction count
- Learned patterns with confidence scores
- Filtering by call point and minimum confidence

---

## Metering

Tracks AI API usage, costs, and rate limiting across all LLM calls.

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/metering/events` | GET | List metering events |
| `/api/metering/rates` | GET | Current rate limits |
| `/api/metering/summary` | GET | Usage summary and costs |

### Dashboard (`/x/metering`)

- Token usage tracking (input/output)
- Cost breakdown by model and call point
- Rate limit status

### Integration

All LLM calls go through `getConfiguredMeteredAICompletion()` which automatically:
1. Checks rate limits
2. Routes to configured engine
3. Records token usage and costs
4. Logs interaction for knowledge accumulation

---

## Changelog

- **2026-02-11**: Added AI Error Monitor, AI Knowledge/Learning, Metering, and Pipeline LLM Integration documentation. Removed 501 dead-end routes. Fixed pipeline-run.ts mock default (mock=false). Eliminated hardcoded onboarding fallbacks (now loads from spec file).
- **2026-02-11**: Pipeline Hardening — Added transform chain support (array transforms), memory relevance scoring with alpha blending, narrative memory framing with spec-driven templates, LLM memory extraction, flex condition operators (7 ops) for ADAPT specs.
- **2026-01-29**: Added SpecType enum (SYSTEM/DOMAIN/ADAPT/SUPERVISE) and dynamic target system (CallTarget, CallerTarget). BehaviorTarget deprecated in favor of spec-computed targets.
- **2026-01-29**: Made pipeline playbook-aware. Specs are now selected based on caller's domain → published playbook.
