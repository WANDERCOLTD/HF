# HF Documentation Index

Complete guide to all HF documentation.

---

## Getting Started

| Document | Description | Audience |
|----------|-------------|----------|
| [README.md](../README.md) | Project overview, philosophy, BDD-first approach | Everyone |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Browser-only workflow for contributing | Contributors |
| [CODEBASE-OVERVIEW.md](CODEBASE-OVERVIEW.md) | **Codebase structure, key files, common tasks** | Developers, AI assistants |
| [DEV_ENV.md](DEV_ENV.md) | Local development setup (Mac) | Developers |
| [DEPLOYMENT-ENVIRONMENTS.md](DEPLOYMENT-ENVIRONMENTS.md) | **Complete multi-environment deployment guide** | DevOps, Deployment |
| [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md) | **Step-by-step deployment checklist** | DevOps, Claude guidance |

---

## API Documentation

| Document | Description | Audience |
|----------|-------------|----------|
| [API-INTERNAL.md](API-INTERNAL.md) | **Complete internal API reference (151+ endpoints)** | HF Developers |
| [API-PUBLIC.md](API-PUBLIC.md) | **Public API guide for clients (self-hosted & cloud)** | External Clients, Partners |

---

## Architecture & Design

| Document | Description |
|----------|-------------|
| [01-system-description.md](01-system-description.md) | High-level system overview |
| [02-business-context.md](02-business-context.md) | Business requirements and context |
| [03-architecture/ARC-002-logical-architecture.md](03-architecture/ARC-002-logical-architecture.md) | Logical architecture |
| [ARCHITECTURE.md](../apps/admin/ARCHITECTURE.md) | **Comprehensive system architecture** (pipelines, memory, reward loop, DB schema) |
| [Admin ARCHITECTURE.md](../apps/admin/docs/ARCHITECTURE.md) | Admin app architecture (pipelines, playbooks, specs) |
| [DATA-DRIVEN-ARCHITECTURE.md](../apps/admin/docs/DATA-DRIVEN-ARCHITECTURE.md) | Data-driven spec system |
| [CONTENT-PIPELINE.md](CONTENT-PIPELINE.md) | **Classification taxonomy + data flow** (5-pillar canon) |
| [PIPELINE.md](PIPELINE.md) | **7-stage post-call adaptive loop** — stage table, ordering invariant, runner map, landmines (5-pillar canon) |

---

## AI System

| Document | Description |
|----------|-------------|
| [AI-ASSISTANT-SYSTEM.md](../apps/admin/docs/AI-ASSISTANT-SYSTEM.md) | Unified AI assistant architecture |
| [AI-ASSISTANT-SEARCH.md](../apps/admin/docs/AI-ASSISTANT-SEARCH.md) | Search functionality in AI assistant |
| [AI-MODEL-TRACKING.md](../apps/admin/docs/AI-MODEL-TRACKING.md) | AI model usage tracking |
| [FLASH-SIDEBAR-INTEGRATION.md](../apps/admin/docs/FLASH-SIDEBAR-INTEGRATION.md) | Flash sidebar for task tracking |
| [AI-CONFIG.md](../apps/admin/docs/AI-CONFIG.md) | AI configuration guide |
| [UNIFIED-ASSISTANT.md](../apps/admin/docs/UNIFIED-ASSISTANT.md) | Unified AI assistant component |

---

## Behavior & Parameters

| Document | Description |
|----------|-------------|
| [04-behaviour/PRS-001-personality-model.md](04-behaviour/PRS-001-personality-model.md) | Personality measurement model |
| [04-behaviour/PAR-001-parameters-and-metrics.md](04-behaviour/PAR-001-parameters-and-metrics.md) | Parameter definitions and metrics |
| [04-behaviour/QS-001-quality-scorecard.md](04-behaviour/QS-001-quality-scorecard.md) | Quality scoring system |
| [04-behaviour/RWD-001-reward-policy.md](04-behaviour/RWD-001-reward-policy.md) | Reward computation policy |
| [04-behaviour/user-preferences.md](04-behaviour/user-preferences.md) | User preference system |
| [SPARKLINES.md](../apps/admin/SPARKLINES.md) | Sparkline visualization for parameter trends |

---

## Data & Memory

| Document | Description |
|----------|-------------|
| [05-data/MEM-001-memory-taxonomy.md](05-data/MEM-001-memory-taxonomy.md) | Memory categorization system |
| [taxonomy/prompt-slugs.md](../apps/admin/docs/taxonomy/prompt-slugs.md) | Prompt slug taxonomy |
| [PROMPT_SLUG_TAXONOMY.md](../apps/admin/PROMPT_SLUG_TAXONOMY.md) | Prompt slug taxonomy reference |

---

## Testing & Quality

| Document | Description |
|----------|-------------|
| [acceptance/BDD-001-feature-map.md](acceptance/BDD-001-feature-map.md) | BDD feature mapping |
| [TESTING.md](../apps/admin/TESTING.md) | Test strategy and commands |
| [PLAYGROUND-GUIDE.md](../apps/admin/docs/PLAYGROUND-GUIDE.md) | Playground testing guide |
| [PROMPT-COVERAGE-ANALYSIS.md](../apps/admin/docs/PROMPT-COVERAGE-ANALYSIS.md) | Prompt coverage analysis |
| [QM-PROMPT-COVERAGE-ANALYSIS.md](../apps/admin/docs/QM-PROMPT-COVERAGE-ANALYSIS.md) | Quality metrics coverage |
| [SPEC-FORMAT.md](../apps/admin/docs-archive/bdd-specs/SPEC-FORMAT.md) | BDD spec file format reference |

---

## Development Guides

| Document | Description |
|----------|-------------|
| [SCRIPTS.md](../apps/admin/SCRIPTS.md) | Available npm scripts and utilities |
| [REGISTRY-MIGRATION.md](../apps/admin/docs/REGISTRY-MIGRATION.md) | Registry migration guide |
| [ADMIN_USER_GUIDE.md](../apps/admin/ADMIN_USER_GUIDE.md) | Admin UI user guide |
| [WORKING-AGREEMENT.md](../WORKING-AGREEMENT.md) | Team working agreement |

---

## Specs & Analysis

| Document | Description |
|----------|-------------|
| [ANALYSIS_SPECS.md](../apps/admin/ANALYSIS_SPECS.md) | Analysis spec system overview |

---

## Planning & TODO

| Document | Description |
|----------|-------------|
| [PLAN-Traits.md](../apps/admin/docs/PLAN-Traits.md) | Traits feature planning |
| [PLAN-general-import-wizard.md](../apps/admin/docs/PLAN-general-import-wizard.md) | Import wizard planning |
| [TODO-ticket-email-notifications.md](../apps/admin/docs/TODO-ticket-email-notifications.md) | Ticket notifications TODO |

---

## Decisions (ADRs)

| Document | Description |
|----------|-------------|
| [adr/ADR-001-runtime-and-db.md](adr/ADR-001-runtime-and-db.md) | Runtime and database decisions |

---

## Quick Lookup

### I want to...

**...deploy to a cloud server** → [DEPLOYMENT-ENVIRONMENTS.md](DEPLOYMENT-ENVIRONMENTS.md)

**...set up local development** → [DEV_ENV.md](DEV_ENV.md)

**...understand the system architecture** → [ARCHITECTURE.md](../apps/admin/ARCHITECTURE.md)

**...understand admin app architecture** → [Admin ARCHITECTURE.md](../apps/admin/docs/ARCHITECTURE.md)

**...understand how AI assistants work** → [AI-ASSISTANT-SYSTEM.md](../apps/admin/docs/AI-ASSISTANT-SYSTEM.md)

**...understand the pipeline** → [ARCHITECTURE.md - Analysis Pipeline](../apps/admin/docs/ARCHITECTURE.md#analysis-pipeline)

**...understand parameters** → [PAR-001-parameters-and-metrics.md](04-behaviour/PAR-001-parameters-and-metrics.md)

**...test changes** → [PLAYGROUND-GUIDE.md](../apps/admin/docs/PLAYGROUND-GUIDE.md)

**...understand data model** → [prisma/schema.prisma](../apps/admin/prisma/schema.prisma)

**...see all API endpoints (internal)** → [API-INTERNAL.md](API-INTERNAL.md)

**...integrate with HF as a client** → [API-PUBLIC.md](API-PUBLIC.md)

**...run scripts** → [SCRIPTS.md](../apps/admin/SCRIPTS.md)

---

## External Resources

- **Notion**: Planning and meeting notes *(link not in repo)*
- **Backlog**: Exported to `backlog/` directory
- **BDD Features**: `bdd/features/` directory

---

**Last Updated**: 2026-02-11
