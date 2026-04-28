/**
 * Quick Launch — Spec-Driven Executor
 *
 * Loads QUICK-LAUNCH-001 ORCHESTRATE spec, iterates its declared steps,
 * and runs each via a step executor registry. Same pattern as PIPELINE-001
 * (stages) and DOMAIN-READY-001 (readiness checks).
 *
 * Adding/removing/reordering steps = edit the spec, zero code changes.
 * Tuning args (maxAssertions, maxSampleSize) = edit the spec, zero code changes.
 */

import { randomUUID } from "crypto";
import { prisma, db, type TxClient } from "@/lib/prisma";
import { config } from "@/lib/config";
import {
  extractText,
  extractAssertions,
  type ExtractedAssertion,
} from "@/lib/content-trust/extract-assertions";
import {
  generateIdentityFromAssertions,
  type GeneratedIdentityConfig,
} from "@/lib/domain/generate-identity";
import { scaffoldDomain } from "@/lib/domain/scaffold";
import { applyBehaviorTargets, applyCallerTargets } from "@/lib/domain/agent-tuning";
import { parseLoLine } from "@/lib/content-trust/validate-lo-linkage";
import { generateContentSpec, patchContentSpecForContract } from "@/lib/domain/generate-content-spec";
import { generateCurriculumFromGoals } from "@/lib/content-trust/extract-curriculum";
import { generateSkeletonCurriculum } from "@/lib/content-trust/generate-skeleton-curriculum";
import { startCurriculumEnrichment } from "@/lib/jobs/curriculum-enricher";
import { enrollCaller } from "@/lib/enrollment";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { loadComposeConfig, executeComposition, persistComposedPrompt } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import type { SpecConfig } from "@/lib/types/json-fields";
import type { ProgressEvent, ProgressCallback } from "./types";
export type { ProgressEvent, ProgressCallback };

// ── Types ──────────────────────────────────────────────

export interface LaunchStep {
  id: string;
  name: string;
  operation: string;
  order: number;
  onError: "abort" | "continue";
  progressMessage: string;
  args?: Record<string, any>;
}

export interface QuickLaunchInput {
  subjectName: string;
  brief?: string;
  persona: string;
  learningGoals: string[];
  toneTraits?: string[];
  file?: File;
  qualificationRef?: string;
  mode?: "upload" | "generate";
  domainId?: string; // Use existing domain instead of creating new one
  kind?: "INSTITUTION" | "COMMUNITY"; // Domain kind (defaults to INSTITUTION)
  institutionId?: string; // Link domain to an institution
  behaviorTargets?: Record<string, number>; // Matrix/pill-derived behavior targets → BehaviorTarget rows + onboardingDefaultTargets
  matrixPositions?: Record<string, { x: number; y: number }>; // UI metadata for round-trip matrix reconstruction
  groupId?: string; // Optional department/division/track grouping
}

export interface QuickLaunchResult {
  domainId: string;
  domainSlug: string;
  domainName: string;
  subjectId: string;
  sourceId?: string;
  callerId: string;
  callerName: string;
  identitySpecId?: string;
  contentSpecId?: string; // Deprecated (ADR-002) — use curriculumId
  curriculumId?: string;
  playbookId?: string;
  assertionCount: number;
  moduleCount: number;
  goalCount: number;
  warnings: string[];
  /** Document structure from segmentation (upload mode only) */
  documentStructure?: {
    isComposite: boolean;
    sections: DocumentStructureSection[];
  };
  /** Background curriculum enrichment task ID (skeleton mode) */
  enrichmentTaskId?: string;
  /** CohortGroup ID (created for COMMUNITY domains) */
  cohortGroupId?: string;
  /** Join token for community CohortGroup magic link */
  joinToken?: string;
}

/** Shared context accumulating results across steps */
interface LaunchContext {
  input: QuickLaunchInput;
  results: Partial<QuickLaunchResult> & { [key: string]: any };
  onProgress: ProgressCallback;
  userId: string;
  /** Transaction client — set during commit phase for atomic operations */
  tx?: TxClient;
}

type StepExecutor = (ctx: LaunchContext, step: LaunchStep) => Promise<void>;

// ── Spec Loader ────────────────────────────────────────

/**
 * Load launch steps from QUICK-LAUNCH-001 spec.
 * NO FALLBACKS — spec MUST exist in database.
 */
export async function loadLaunchSteps(): Promise<LaunchStep[]> {
  const spec = await prisma.analysisSpec.findFirst({
    where: {
      slug: { contains: "quick-launch-001", mode: "insensitive" },
      isActive: true,
    },
    select: { slug: true, config: true },
  });

  if (!spec) {
    throw new Error(
      'QUICK-LAUNCH-001 spec not found. Run "Import All" on /x/admin/spec-sync to import it.'
    );
  }

  const specConfig = spec.config as Record<string, any>;
  const params = specConfig?.parameters || [];
  const stepsParam = params.find((p: any) => p.id === "launch_steps");
  const steps = stepsParam?.config?.steps;

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error(
      `QUICK-LAUNCH-001 spec "${spec.slug}" has no steps configured. ` +
      "Check config.parameters[id=launch_steps].config.steps array."
    );
  }

  // Sort by order and cast
  return (steps as LaunchStep[]).sort((a, b) => a.order - b.order);
}

// ── Auto-generate goals ───────────────────────────────

/**
 * Generate learning goals from curriculum modules or AI when user didn't provide any.
 * Tries module-based extraction first (instant), falls back to AI.
 */
async function autoGenerateGoals(ctx: LaunchContext): Promise<string[]> {
  const { subjectName, persona, brief } = ctx.input;

  // Strategy 1: Derive from curriculum modules (instant, no AI call)
  if (ctx.results.curriculumId) {
    try {
      const modules = await prisma.curriculumModule.findMany({
        where: { curriculumId: ctx.results.curriculumId },
        select: { title: true },
        orderBy: { sortOrder: "asc" },
        take: 4,
      });
      if (modules.length >= 2) {
        return modules.map((m) => m.title);
      }
    } catch {
      // Fall through to AI
    }
  }

  // Strategy 2: AI-generated goals from subject + persona + brief
  try {
    // @ai-call quick-launch.auto-goals — Generate learning goals when user didn't provide any | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint: "quick-launch.auto-goals",
        messages: [
          {
            role: "system",
            content: `You are an expert at defining learning goals. Given a subject and teaching style, return 3 concise learning goals.\n\nReturn ONLY a JSON array of strings. Each goal should be 3-10 words, actionable, and specific.\nExample: ["Master algebraic equations", "Build inference skills", "Write creative responses confidently"]`,
          },
          {
            role: "user",
            content: `Subject: ${subjectName}\nStyle: ${persona}${brief ? `\nDescription: ${brief}` : ""}`,
          },
        ],
        temperature: 0.3,
        maxTokens: 200,
      },
      {
        sourceOp: "quick-launch:auto-goals",
        userId: ctx.userId,
        entityLabel: subjectName,
        wizardName: "Quick Launch",
        wizardStep: "Auto Goals",
      },
    );

    const text = (response.content || "").trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed: unknown = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        const goals = (parsed as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, 4);
        if (goals.length > 0) return goals;
      }
    }
  } catch (err: any) {
    console.warn("[quick-launch] Auto-goal generation failed:", err.message);
  }

  return [];
}

// ── Step Executor Registry ─────────────────────────────

const stepExecutors: Record<string, StepExecutor> = {
  /**
   * Step 1: Resolve or create Domain + Subject + link them.
   * If input.domainId is provided, uses that existing domain (new playbook in existing school).
   * Otherwise creates a new domain from subjectName (original behavior).
   */
  create_domain: async (ctx) => {
    const { subjectName, brief, qualificationRef, domainId: existingDomainId, kind, institutionId } = ctx.input;
    const p = db(ctx.tx);

    let domain;

    if (existingDomainId) {
      // Use existing domain — creating a new playbook (class) within it
      domain = await p.domain.findUnique({
        where: { id: existingDomainId },
      });
      if (!domain) {
        throw new Error(`Domain not found: ${existingDomainId}`);
      }
    } else {
      // Create or find domain from subject name (original behavior)
      const slug = subjectName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      domain = await p.domain.findFirst({ where: { slug } });
      if (!domain) {
        domain = await p.domain.create({
          data: {
            slug,
            name: subjectName,
            description: brief || `Quick-launched domain for ${subjectName}`,
            kind: (kind as any) || "INSTITUTION",
            isActive: true,
            institutionId: institutionId ?? undefined,
          },
        });
      }
    }

    // Create or find subject (always, even for existing domains)
    const subjectSlug = subjectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    let subject = await p.subject.findFirst({ where: { slug: subjectSlug } });
    if (!subject) {
      subject = await p.subject.create({
        data: {
          slug: subjectSlug,
          name: subjectName,
          qualificationRef: qualificationRef || null,
          isActive: true,
        },
      });
    }

    // Link subject to domain (idempotent)
    const existing = await p.subjectDomain.findFirst({
      where: { subjectId: subject.id, domainId: domain.id },
    });
    if (!existing) {
      await p.subjectDomain.create({
        data: { subjectId: subject.id, domainId: domain.id },
      });
    }

    ctx.results.domainId = domain.id;
    ctx.results.domainSlug = domain.slug;
    ctx.results.domainName = domain.name;
    ctx.results.subjectId = subject.id;
    ctx.results.subjectSlug = subject.slug;
    ctx.results.useExistingDomain = !!existingDomainId;
    ctx.results.warnings = [];
  },

  /**
   * Step 2: Extract teaching points from uploaded file
   * Skipped in generate mode (no file).
   */
  extract_content: async (ctx, step) => {
    const { file } = ctx.input;

    if (!file) {
      ctx.results.assertions = [];
      ctx.results.assertionCount = 0;
      return;
    }

    const maxAssertions = step.args?.maxAssertions ?? 500;

    // Extract text from document
    const { text, pages, fileType } = await extractText(file);
    if (!text.trim()) {
      throw new Error("Could not extract text from document — file may be empty or corrupted");
    }

    ctx.onProgress({
      phase: step.id,
      message: `Extracted ${text.length.toLocaleString()} characters from ${fileType}${pages ? ` (${pages} pages)` : ""}`,
    });

    // Run AI extraction with progress updates
    const result = await extractAssertions(text, {
      sourceSlug: ctx.results.subjectSlug || `quick-launch-${Date.now()}`,
      qualificationRef: ctx.input.qualificationRef,
      maxAssertions,
      onChunkDone: (chunkIndex, totalChunks, extractedSoFar) => {
        ctx.onProgress({
          phase: step.id,
          message: `Extracting... chunk ${chunkIndex + 1}/${totalChunks} (${extractedSoFar} points so far)`,
        });
      },
    });

    if (!result.ok) {
      throw new Error(result.error || "Assertion extraction failed");
    }

    ctx.results.assertions = result.assertions;
    ctx.results.assertionCount = result.assertions.length;
    ctx.results.warnings!.push(...result.warnings);

    ctx.onProgress({
      phase: step.id,
      message: `Extracted ${result.assertions.length} teaching points`,
    });
  },

  /**
   * Step 3: Save assertions to DB (ContentSource + SubjectSource + assertions)
   * Skipped in generate mode (no file/assertions).
   */
  save_assertions: async (ctx) => {
    const assertions: ExtractedAssertion[] = ctx.results.assertions || [];
    if (assertions.length === 0) {
      if (ctx.input.mode !== "generate") {
        ctx.results.warnings!.push("No assertions to save");
      }
      return;
    }

    const { file } = ctx.input;
    if (!file) return;
    const p = db(ctx.tx);
    const subjectId = ctx.results.subjectId!;
    const subjectSlug = ctx.results.subjectSlug || "quick-launch";

    // Generate source slug from filename
    const baseSlug = file.name
      .replace(/\.[^/.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const sourceSlug = `${subjectSlug}-${baseSlug}`;
    const displayName = file.name.replace(/\.[^/.]+$/, "");

    // Create ContentSource (handle slug conflict)
    let source;
    try {
      source = await p.contentSource.create({
        data: { slug: sourceSlug, name: displayName, trustLevel: "UNVERIFIED" },
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        source = await p.contentSource.create({
          data: { slug: `${sourceSlug}-${Date.now()}`, name: displayName, trustLevel: "UNVERIFIED" },
        });
      } else {
        throw err;
      }
    }

    // Attach to subject
    const existingLink = await p.subjectSource.findFirst({
      where: { subjectId, sourceId: source.id },
    });
    if (!existingLink) {
      await p.subjectSource.create({
        data: { subjectId, sourceId: source.id, tags: ["content"] },
      });
    }

    // Save assertions
    if (assertions.length > 0) {
      await p.contentAssertion.createMany({
        data: assertions.map((a) => ({
          sourceId: source.id,
          assertion: a.assertion,
          category: a.category,
          chapter: a.chapter || null,
          section: a.section || null,
          tags: a.tags,
          examRelevance: a.examRelevance ?? null,
          learningOutcomeRef: a.learningOutcomeRef || null,
          validUntil: a.validUntil ? new Date(a.validUntil) : null,
          taxYear: a.taxYear || null,
          contentHash: a.contentHash,
        })),
      });
    }

    ctx.results.sourceId = source.id;
  },

  /**
   * Step 4: Generate AI-tailored identity from assertions + persona + goals
   */
  generate_identity: async (ctx, step) => {
    const assertions: ExtractedAssertion[] = ctx.results.assertions || [];
    const maxSampleSize = step.args?.maxSampleSize ?? 60;

    // Load archetype from INIT-001 persona config and cache for scaffold_domain step
    const archetype = await loadPersonaArchetype(ctx.input.persona);
    ctx.results._archetypeSlug = archetype;

    const result = await generateIdentityFromAssertions({
      subjectName: ctx.input.subjectName,
      persona: ctx.input.persona,
      learningGoals: ctx.input.learningGoals,
      toneTraits: ctx.input.toneTraits,
      archetypeSlug: archetype || undefined,
      assertions: assertions.map((a) => ({
        assertion: a.assertion,
        category: a.category,
        chapter: a.chapter || null,
        tags: a.tags,
      })),
      maxSampleSize,
    });

    if (result.ok && result.config) {
      ctx.results.identityConfig = result.config;
    } else {
      ctx.results.warnings!.push(
        `Identity generation failed (${result.error || "unknown"}), using defaults`
      );
    }
  },

  /**
   * Step 5: Scaffold domain (identity spec, playbook, onboarding)
   * When using an existing domain, forceNewPlaybook creates a new playbook
   * alongside existing ones (new class in the same school).
   */
  scaffold_domain: async (ctx) => {
    const domainId = ctx.results.domainId!;
    const p = db(ctx.tx);
    const isCommunityAttach = ctx.input.kind === "COMMUNITY" && !!ctx.results.useExistingDomain;

    // Ensure domain kind is correct (defensive: analyze step sets it, but commit may override)
    if (ctx.input.kind) {
      await p.domain.update({
        where: { id: domainId },
        data: { kind: ctx.input.kind as any },
      });
    }

    if (isCommunityAttach) {
      // ── Community attach: reuse existing Playbook, skip scaffold ──
      // The community already has its domain, identity spec, and playbook.
      // We just need to find them so create_caller can enroll into them.
      const existingPlaybook = await p.playbook.findFirst({
        where: { domainId, status: "PUBLISHED" },
        select: { id: true },
        orderBy: { publishedAt: "desc" },
      });
      if (existingPlaybook) {
        ctx.results.playbookId = existingPlaybook.id;
      } else {
        ctx.results.warnings!.push("No published playbook found in existing community");
      }

      // Find existing identity spec for reference
      const existingIdentity = await p.analysisSpec.findFirst({
        where: { specType: "DOMAIN", specRole: "IDENTITY", isActive: true,
          playbookItems: { some: { playbook: { domainId } } } },
        select: { id: true },
      });
      if (existingIdentity) {
        ctx.results.identitySpecId = existingIdentity.id;
      }

      // Tuning deferred to create_caller step (CallerTarget, not BehaviorTarget)
      ctx.results._deferCallerTuning = true;
    } else {
      // ── New domain or EDU attach: full scaffold ──
      const flowPhases = await loadPersonaFlowPhases(ctx.input.persona);
      const archetype = ctx.results._archetypeSlug ?? await loadPersonaArchetype(ctx.input.persona);

      const scaffoldResult = await scaffoldDomain(domainId, {
        identityConfig: ctx.results.identityConfig || undefined,
        flowPhases: flowPhases || undefined,
        extendsAgent: archetype || undefined,
        forceNewPlaybook: !!ctx.results.useExistingDomain,
        playbookName: ctx.results.useExistingDomain ? ctx.input.subjectName : undefined,
        groupId: ctx.input.groupId || undefined,
      }, ctx.tx);

      if (scaffoldResult.identitySpec) {
        ctx.results.identitySpecId = scaffoldResult.identitySpec.id;
      }
      if (scaffoldResult.playbook) {
        ctx.results.playbookId = scaffoldResult.playbook.id;
      }
      ctx.results.warnings!.push(...scaffoldResult.skipped);

      // Apply behavior targets from matrix/pills if provided
      const targets = ctx.input.behaviorTargets;
      if (targets && Object.keys(targets).length > 0) {
        // Only update domain-level defaults for NEW domains.
        // When attaching to an existing domain, skip to avoid overwriting
        // onboardingDefaultTargets that affect existing callers' first calls.
        if (!ctx.results.useExistingDomain) {
          const targetPayload: Record<string, unknown> = {};
          for (const [paramId, value] of Object.entries(targets)) {
            targetPayload[paramId] = { value, confidence: 0.5 };
          }
          if (ctx.input.matrixPositions) {
            targetPayload._matrixPositions = ctx.input.matrixPositions;
          }
          await p.domain.update({
            where: { id: domainId },
            data: { onboardingDefaultTargets: targetPayload },
          });
        }

        // Apply as PLAYBOOK-scoped BehaviorTarget rows (always-active)
        if (ctx.results.playbookId) {
          const applied = await applyBehaviorTargets(ctx.results.playbookId, targets, 0.5, ctx.tx);
          if (applied > 0) {
            ctx.onProgress({
              phase: "scaffold_domain",
              message: `Applied ${applied} behavior targets`,
            });
          }
        }
      }
    }
  },

  /**
   * Step 6: Generate structured curriculum
   * Upload mode: from assertions via generateContentSpec()
   * Generate mode: from goals via generateCurriculumFromGoals()
   * + patch the CONTENT spec for CURRICULUM_PROGRESS_V1 contract compliance
   */
  generate_curriculum: async (ctx) => {
    const domainId = ctx.results.domainId!;
    const p = db(ctx.tx);

    // Try assertion-based generation first (upload mode)
    const result = await generateContentSpec(domainId, undefined, ctx.tx);

    ctx.results.moduleCount = result.moduleCount;
    if (result.moduleCount > 0) {
      // Curriculum was created by generateContentSpec — find its ID
      const cur = await p.curriculum.findFirst({
        where: { subject: { domains: { some: { domainId } } } },
        select: { id: true },
      });
      if (cur) ctx.results.curriculumId = cur.id;
      return;
    }

    // No assertions — use fast skeleton + async enrichment (generate mode)
    const { subjectName, persona, learningGoals, qualificationRef } = ctx.input;

    // Phase 1: Fast skeleton with Haiku (~3-5s)
    let skeleton = await generateSkeletonCurriculum(
      subjectName,
      persona,
      learningGoals,
      qualificationRef,
    );

    // Fallback: if skeleton fails, try synchronous full generation
    if (!skeleton.ok || skeleton.modules.length === 0) {
      console.warn("[quick-launch] Skeleton failed, falling back to full generation:", skeleton.error);
      const fullCurriculum = await generateCurriculumFromGoals(
        subjectName,
        persona,
        learningGoals,
        qualificationRef,
      );
      if (!fullCurriculum.ok || fullCurriculum.modules.length === 0) {
        ctx.results.moduleCount = 0;
        ctx.results.warnings!.push(
          fullCurriculum.error || "Curriculum generation produced no modules"
        );
        return;
      }
      // Use full curriculum directly (no enrichment needed)
      skeleton = {
        ok: true,
        name: fullCurriculum.name,
        description: fullCurriculum.description,
        modules: fullCurriculum.modules,
        warnings: fullCurriculum.warnings,
      };
    }

    // Create Curriculum + CurriculumModule records from skeleton (ADR-002)
    // No longer creates AnalysisSpec — curriculum data lives in DB models.
    const subjectId = ctx.results.subjectId;
    if (!subjectId) {
      ctx.results.warnings!.push("No subject — cannot create curriculum");
      return;
    }

    // Check idempotency — does a curriculum already exist for this subject?
    const existingCurriculum = await p.curriculum.findFirst({
      where: { subjectId },
      select: { id: true },
    });

    if (existingCurriculum) {
      ctx.results.curriculumId = existingCurriculum.id;
      ctx.results.moduleCount = 0;
      ctx.results.warnings!.push("Curriculum already exists");
      return;
    }

    const domain = await p.domain.findUnique({
      where: { id: domainId },
      select: { slug: true, name: true },
    });

    // #208: Create curriculum + modules in a single nested Prisma write.
    // Prisma wraps nested creates in an implicit transaction, so we never
    // commit a Curriculum row without its modules.
    const moduleData = skeleton.modules.map((mod: any, i: number) => ({
      slug: mod.slug || mod.id || `module-${i + 1}`,
      title: mod.title || mod.name || `Module ${i + 1}`,
      description: mod.description || null,
      sortOrder: mod.sortOrder ?? i,
      estimatedDurationMinutes: mod.estimatedDurationMinutes ?? null,
      learningObjectives: {
        // Use parseLoLine to handle the "LOn: description" string format produced by the
        // curriculum-extraction prompt. Falls back to (string-as-description, synthesised ref)
        // for legacy callers that pass raw descriptions, but rejects bare refs like "LO1".
        create: (mod.learningOutcomes || [])
          .map((lo: any, j: number) => {
            if (typeof lo === "string") {
              const parsed = parseLoLine(lo);
              if (parsed) return { ref: parsed.ref, description: parsed.description, sortOrder: j };
              // Bare ref like "LO1" — descriptionMatchesRef garbage. Reject.
              if (/^LO-?\d+$/i.test(lo.trim())) return null;
              // Plain description with no ref — synthesise a ref.
              return { ref: `LO${j + 1}`, description: lo, sortOrder: j };
            }
            if (lo && typeof lo === "object" && lo.description) {
              return { ref: lo.ref || `LO${j + 1}`, description: lo.description, sortOrder: j };
            }
            return null;
          })
          .filter((x: any): x is { ref: string; description: string; sortOrder: number } => x !== null),
      },
    }));

    const curriculum = await p.curriculum.create({
      data: {
        slug: `${domain!.slug}-curriculum`,
        name: skeleton.name || `${domain!.name} Curriculum`,
        description: skeleton.description || `AI-generated curriculum for ${domain!.name}`,
        subjectId,
        playbookId: ctx.results.playbookId ?? null,
        deliveryConfig: {},
        modules: { create: moduleData },
      },
    });

    ctx.results.curriculumId = curriculum.id;
    ctx.results.moduleCount = skeleton.modules.length;
  },

  /**
   * Step 7: Create test caller + Goals
   * Auto-generates goals from curriculum modules if none were provided.
   */
  create_caller: async (ctx) => {
    const domainId = ctx.results.domainId!;
    const { subjectName } = ctx.input;
    let { learningGoals } = ctx.input;
    const p = db(ctx.tx);
    const isCommunityAttach = ctx.input.kind === "COMMUNITY" && !!ctx.results.useExistingDomain;

    // Create test caller
    const caller = await p.caller.create({
      data: {
        name: `Test Caller — ${subjectName}`,
        domainId,
      },
    });

    ctx.results.callerId = caller.id;
    ctx.results.callerName = caller.name;

    // Auto-generate goals if none provided
    if (learningGoals.length === 0) {
      learningGoals = await autoGenerateGoals(ctx);
    }

    // Create Goal records for each learning goal
    for (const goalName of learningGoals) {
      await p.goal.create({
        data: {
          callerId: caller.id,
          type: "LEARN",
          name: goalName,
          priority: 5,
        },
      });
    }

    ctx.results.goalCount = learningGoals.length;

    // Enroll caller in playbook (existing or newly created)
    if (ctx.results.playbookId) {
      await enrollCaller(caller.id, ctx.results.playbookId, "quick-launch", ctx.tx);
    }

    if (isCommunityAttach) {
      // ── Community attach: join existing CohortGroup, apply per-caller tuning ──
      const existingCohort = await p.cohortGroup.findFirst({
        where: { domainId },
        select: { id: true, joinToken: true },
        orderBy: { createdAt: "desc" },
      });

      if (existingCohort) {
        // Enroll caller as member of existing cohort
        await p.callerCohortMembership.create({
          data: {
            callerId: caller.id,
            cohortGroupId: existingCohort.id,
          },
        });
        ctx.results.cohortGroupId = existingCohort.id;
        ctx.results.joinToken = existingCohort.joinToken ?? undefined;
      } else {
        ctx.results.warnings!.push("No CohortGroup found in existing community");
      }

      // Apply tuning as CallerTarget rows (per-caller, highest priority).
      // Does not affect existing community members.
      const targets = ctx.input.behaviorTargets;
      if (targets && Object.keys(targets).length > 0) {
        const applied = await applyCallerTargets(caller.id, targets, 0.5, ctx.tx);
        if (applied > 0) {
          ctx.onProgress({
            phase: "create_caller",
            message: `Applied ${applied} personal tuning targets`,
          });
        }
      }
    } else if (ctx.input.kind === "COMMUNITY" && ctx.results.playbookId) {
      // ── New community: create CohortGroup ──
      let facilitator = await p.caller.findFirst({
        where: { userId: ctx.userId, domainId, role: { in: ["TEACHER", "TUTOR"] } },
        select: { id: true },
      });
      if (!facilitator) {
        facilitator = await p.caller.create({
          data: {
            name: "Community Facilitator",
            role: "TEACHER",
            userId: ctx.userId,
            domainId,
            externalId: `facilitator-${ctx.userId}-${domainId}`,
          },
          select: { id: true },
        });
      }

      const joinToken = randomUUID().replace(/-/g, "").slice(0, 12);
      const cohort = await p.cohortGroup.create({
        data: {
          name: ctx.results.domainName || ctx.input.subjectName,
          description: ctx.input.brief || null,
          domainId,
          ownerId: facilitator.id,
          institutionId: ctx.input.institutionId ?? undefined,
          groupId: ctx.input.groupId || undefined,
          joinToken,
        },
      });

      // Link playbook to cohort
      await p.cohortPlaybook.create({
        data: {
          cohortGroupId: cohort.id,
          playbookId: ctx.results.playbookId,
          assignedBy: "quick-launch",
        },
      });

      // Enroll the test caller as a member of this cohort
      await p.callerCohortMembership.create({
        data: {
          callerId: caller.id,
          cohortGroupId: cohort.id,
        },
      });

      ctx.results.cohortGroupId = cohort.id;
      ctx.results.joinToken = joinToken;
    }
  },

  /**
   * Step 8: Compose the first prompt so the caller is ready-to-teach immediately.
   * Uses the same composition pipeline as POST /api/callers/:callerId/compose-prompt.
   */
  compose_prompt: async (ctx) => {
    const callerId = ctx.results.callerId;
    if (!callerId) {
      ctx.results.warnings!.push("No caller — prompt composition skipped");
      return;
    }

    const { fullSpecConfig, sections, specSlug } = await loadComposeConfig();
    const composition = await executeComposition(callerId, sections, fullSpecConfig);
    const promptSummary = renderPromptSummary(composition.llmPrompt);

    await persistComposedPrompt(composition, promptSummary, {
      callerId,
      triggerType: "quick-launch",
      composeSpecSlug: specSlug,
      specConfig: fullSpecConfig,
    }, ctx.tx);
  },
};

// ── Helpers ────────────────────────────────────────────

/**
 * Translate V4 wizard interactionPattern values to INIT-001 persona keys.
 *
 * The V4 wizard uses descriptive interaction patterns (socratic, directive, etc.)
 * but INIT-001 personas use agent-type keys (tutor, coach, companion, guide).
 * This mapping bridges the two vocabularies.
 *
 * Passes through raw INIT-001 keys unchanged for backward compatibility (V3, quick-launch).
 */
const INTERACTION_TO_PERSONA: Record<string, string> = {
  // V4 wizard interactionPattern → INIT-001 persona key
  socratic: "tutor",
  directive: "tutor",
  reflective: "tutor",
  open: "tutor",
  advisory: "coach",
  coaching: "coach",
  companion: "companion",
  facilitation: "guide",
  "conversational-guide": "conversational-guide",
};

export function resolvePersonaKey(interactionPatternOrPersona: string): string {
  return INTERACTION_TO_PERSONA[interactionPatternOrPersona] || interactionPatternOrPersona;
}

/**
 * Load persona-specific flow phases from INIT-001 spec.
 * Returns null if persona or spec not found (scaffold uses its own defaults).
 *
 * Exported for use by other wizards (e.g., course-setup.ts).
 */
export async function loadPersonaFlowPhases(persona: string): Promise<any | null> {
  const onboardingSlug = config.specs.onboarding.toLowerCase();

  const spec = await prisma.analysisSpec.findFirst({
    where: {
      OR: [
        { slug: { contains: onboardingSlug, mode: "insensitive" } },
        { slug: { contains: "onboarding" } },
        { domain: "onboarding" },
      ],
      isActive: true,
    },
    select: { config: true },
  });

  if (!spec?.config) return null;

  const specConfig = spec.config as SpecConfig;
  const resolvedKey = resolvePersonaKey(persona);
  const personaConfig = specConfig.personas?.[resolvedKey];
  return personaConfig?.firstCallFlow?.phases ? { phases: personaConfig.firstCallFlow.phases } : null;
}

/**
 * Load persona-specific archetype slug from INIT-001 spec.
 * Returns the identitySpec slug (e.g., "TUT-001", "COMPANION-001", "COACH-001")
 * or null if persona/spec not found (scaffold falls back to config.specs.defaultArchetype).
 *
 * Exported for use by other wizards (e.g., course-setup.ts).
 */
export async function loadPersonaArchetype(persona: string): Promise<string | null> {
  const onboardingSlug = config.specs.onboarding.toLowerCase();

  const spec = await prisma.analysisSpec.findFirst({
    where: {
      OR: [
        { slug: { contains: onboardingSlug, mode: "insensitive" } },
        { slug: { contains: "onboarding" } },
        { domain: "onboarding" },
      ],
      isActive: true,
    },
    select: { config: true },
  });

  if (!spec?.config) return null;

  const specConfig = spec.config as SpecConfig;
  const resolvedKey = resolvePersonaKey(persona);
  const personaConfig = specConfig.personas?.[resolvedKey];
  return personaConfig?.identitySpec || null;
}

/**
 * Load persona-specific welcome template from INIT-001 spec.
 * Returns null if persona or spec not found.
 *
 * Checks both `welcomeTemplates` (nested under personas) and
 * `styleWelcomeTemplates` (top-level, keyed by communication style).
 *
 * Exported for use by other wizards (e.g., course-setup.ts).
 */
export async function loadPersonaWelcomeTemplate(persona: string): Promise<string | null> {
  const onboardingSlug = config.specs.onboarding.toLowerCase();

  const spec = await prisma.analysisSpec.findFirst({
    where: {
      OR: [
        { slug: { contains: onboardingSlug, mode: "insensitive" } },
        { slug: { contains: "onboarding" } },
        { domain: "onboarding" },
      ],
      isActive: true,
    },
    select: { config: true },
  });

  if (!spec?.config) return null;

  const specConfig = spec.config as SpecConfig;
  const resolvedKey = resolvePersonaKey(persona);

  // Check persona-specific welcomeTemplate first, then top-level styleWelcomeTemplates
  const personaConfig = specConfig.personas?.[resolvedKey];
  if (personaConfig?.welcomeTemplate) return personaConfig.welcomeTemplate;

  const styleTemplates = (specConfig as any).styleWelcomeTemplates;
  if (styleTemplates?.[resolvedKey]) return styleTemplates[resolvedKey];

  // Fall back to the nested welcomeTemplates map on the welcome_quality parameter
  const welcomeParam = specConfig.parameters?.find?.((p: any) => p.id === "welcome_quality");
  const templates = welcomeParam?.config?.welcomeTemplates;
  if (templates?.[resolvedKey]) return templates[resolvedKey];

  return null;
}

// ── Main Executor ──────────────────────────────────────

/**
 * Execute Quick Launch — spec-driven orchestration.
 *
 * Loads steps from QUICK-LAUNCH-001, runs each via the executor registry,
 * respects per-step onError policy (abort vs continue).
 */
export async function quickLaunch(
  input: QuickLaunchInput,
  onProgress: ProgressCallback,
  userId: string,
): Promise<QuickLaunchResult> {
  const steps = await loadLaunchSteps();

  const ctx: LaunchContext = {
    input,
    results: { warnings: [] },
    onProgress,
    userId,
  };

  onProgress({
    phase: "init",
    message: `Starting Quick Launch (${steps.length} steps)...`,
    totalSteps: steps.length,
  });

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const executor = stepExecutors[step.operation];

    if (!executor) {
      const msg = `Unknown step operation: "${step.operation}" — check QUICK-LAUNCH-001 spec`;
      if (step.onError === "abort") throw new Error(msg);
      ctx.results.warnings!.push(msg);
      continue;
    }

    onProgress({
      phase: step.id,
      message: step.progressMessage,
      stepIndex: i,
      totalSteps: steps.length,
    });

    try {
      await executor(ctx, step);

      onProgress({
        phase: step.id,
        message: `${step.name} ✓`,
        stepIndex: i,
        totalSteps: steps.length,
      });
    } catch (err: any) {
      console.error(`[quick-launch] Step "${step.id}" failed:`, err.message);

      if (step.onError === "abort") {
        onProgress({
          phase: step.id,
          message: `Failed: ${err.message}`,
          stepIndex: i,
          totalSteps: steps.length,
        });
        throw err;
      }

      // "continue" — log warning and proceed
      ctx.results.warnings!.push(`${step.name}: ${err.message}`);
      onProgress({
        phase: step.id,
        message: `${step.name} — skipped (${err.message})`,
        stepIndex: i,
        totalSteps: steps.length,
      });
    }
  }

  onProgress({
    phase: "ready",
    message: "Quick Launch complete!",
    totalSteps: steps.length,
    detail: {
      domainId: ctx.results.domainId,
      callerId: ctx.results.callerId,
    },
  });

  return {
    domainId: ctx.results.domainId!,
    domainSlug: ctx.results.domainSlug!,
    domainName: ctx.results.domainName!,
    subjectId: ctx.results.subjectId!,
    callerId: ctx.results.callerId!,
    callerName: ctx.results.callerName!,
    identitySpecId: ctx.results.identitySpecId,
    contentSpecId: undefined, // Deprecated (ADR-002)
    playbookId: ctx.results.playbookId,
    assertionCount: ctx.results.assertionCount || 0,
    moduleCount: ctx.results.moduleCount || 0,
    goalCount: ctx.results.goalCount || 0,
    cohortGroupId: ctx.results.cohortGroupId,
    joinToken: ctx.results.joinToken,
    warnings: ctx.results.warnings || [],
  };
}

// ── Analysis Preview Types ──────────────────────────────

export interface AssertionSummary {
  categoryBreakdown: Record<string, number>;
  chapters: Array<{ name: string; count: number }>;
  sampleAssertions: Array<{ assertion: string; category: string; chapter?: string }>;
}

/** Lightweight section info from document segmentation */
export interface DocumentStructureSection {
  title: string;
  sectionType: string;
  pedagogicalRole: string;
  hasQuestions: boolean;
  hasAnswerKey: boolean;
}

export interface AnalysisPreview {
  domainId: string;
  domainSlug: string;
  domainName: string;
  subjectId: string;
  sourceId: string;
  assertionCount: number;
  assertionSummary: AssertionSummary | Record<string, never>;
  identityConfig: GeneratedIdentityConfig | null;
  warnings: string[];
  mode?: "upload" | "generate";
  /** Document structure from segmentation (upload mode only) */
  documentStructure?: {
    isComposite: boolean;
    sections: DocumentStructureSection[];
  };
}

export interface CommitOverrides {
  domainName?: string;
  domainSlug?: string;
  callerName?: string;
  learningGoals?: string[];
  identityConfig?: Partial<GeneratedIdentityConfig>;
}

// ── Assertion Summary ───────────────────────────────────

/**
 * Compute a summary of extracted assertions for the review UI.
 * Groups by category and chapter, picks representative samples.
 */
export function computeAssertionSummary(assertions: ExtractedAssertion[]): AssertionSummary {
  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const a of assertions) {
    categoryBreakdown[a.category] = (categoryBreakdown[a.category] || 0) + 1;
  }

  // Chapter breakdown
  const chapterMap = new Map<string, number>();
  for (const a of assertions) {
    const ch = a.chapter || "Uncategorized";
    chapterMap.set(ch, (chapterMap.get(ch) || 0) + 1);
  }
  const chapters = Array.from(chapterMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Sample assertions: pick ~2 from each top category (up to 10 total)
  const sampleAssertions: AssertionSummary["sampleAssertions"] = [];
  const topCategories = Object.entries(categoryBreakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cat]) => cat);

  for (const cat of topCategories) {
    const matching = assertions.filter((a) => a.category === cat);
    const picks = matching.slice(0, 2);
    for (const p of picks) {
      if (sampleAssertions.length >= 10) break;
      sampleAssertions.push({
        assertion: p.assertion,
        category: p.category,
        chapter: p.chapter || undefined,
      });
    }
  }

  return { categoryBreakdown, chapters, sampleAssertions };
}

// ── Analyze (Steps 1-4) ────────────────────────────────

/**
 * Run the analysis phase of Quick Launch (Steps 1-4).
 * Emits structured data events so the frontend can progressively populate the review UI.
 * Returns an AnalysisPreview with all data needed for the review screen.
 */
export async function quickLaunchAnalyze(
  input: QuickLaunchInput,
  onProgress: ProgressCallback,
): Promise<AnalysisPreview> {
  const steps = await loadLaunchSteps();
  // Only run analysis-phase steps — community mode skips content extraction
  const isCommunity = input.kind === "COMMUNITY";
  const analyzeOps = isCommunity
    ? ["create_domain", "generate_identity"]
    : ["create_domain", "extract_content", "save_assertions", "generate_identity"];
  const analyzeSteps = steps.filter((s) => analyzeOps.includes(s.operation));

  const ctx: LaunchContext = {
    input,
    results: { warnings: [] },
    onProgress,
  };

  onProgress({
    phase: "init",
    message: `Analyzing (${analyzeSteps.length} steps)...`,
    totalSteps: analyzeSteps.length,
  });

  for (let i = 0; i < analyzeSteps.length; i++) {
    const step = analyzeSteps[i];
    const executor = stepExecutors[step.operation];

    if (!executor) {
      const msg = `Unknown step operation: "${step.operation}"`;
      if (step.onError === "abort") throw new Error(msg);
      ctx.results.warnings!.push(msg);
      continue;
    }

    onProgress({
      phase: step.id,
      message: step.progressMessage,
      stepIndex: i,
      totalSteps: analyzeSteps.length,
    });

    try {
      await executor(ctx, step);

      // Emit structured data events after each step
      if (step.operation === "create_domain") {
        onProgress({
          phase: "domain_ready",
          message: `${step.name} ✓`,
          stepIndex: i,
          totalSteps: analyzeSteps.length,
          data: {
            domainId: ctx.results.domainId,
            domainSlug: ctx.results.domainSlug,
            domainName: ctx.results.domainName,
            subjectId: ctx.results.subjectId,
          },
        });
      } else if (step.operation === "extract_content") {
        const summary = computeAssertionSummary(ctx.results.assertions || []);
        onProgress({
          phase: "extraction_complete",
          message: `${step.name} ✓`,
          stepIndex: i,
          totalSteps: analyzeSteps.length,
          data: {
            assertionCount: ctx.results.assertionCount,
            assertionSummary: summary,
          },
        });
      } else if (step.operation === "save_assertions") {
        onProgress({
          phase: "assertions_saved",
          message: `${step.name} ✓`,
          stepIndex: i,
          totalSteps: analyzeSteps.length,
          data: { sourceId: ctx.results.sourceId },
        });
      } else if (step.operation === "generate_identity") {
        onProgress({
          phase: "identity_ready",
          message: `${step.name} ✓`,
          stepIndex: i,
          totalSteps: analyzeSteps.length,
          data: { identityConfig: ctx.results.identityConfig || null },
        });
      } else {
        onProgress({
          phase: step.id,
          message: `${step.name} ✓`,
          stepIndex: i,
          totalSteps: analyzeSteps.length,
        });
      }
    } catch (err: any) {
      console.error(`[quick-launch:analyze] Step "${step.id}" failed:`, err.message);

      if (step.onError === "abort") {
        onProgress({
          phase: step.id,
          message: `Failed: ${err.message}`,
          stepIndex: i,
          totalSteps: analyzeSteps.length,
        });
        throw err;
      }

      ctx.results.warnings!.push(`${step.name}: ${err.message}`);
      onProgress({
        phase: step.id,
        message: `${step.name} — skipped (${err.message})`,
        stepIndex: i,
        totalSteps: analyzeSteps.length,
      });
    }
  }

  const summary = computeAssertionSummary(ctx.results.assertions || []);

  const preview: AnalysisPreview = {
    domainId: ctx.results.domainId!,
    domainSlug: ctx.results.domainSlug!,
    domainName: ctx.results.domainName!,
    subjectId: ctx.results.subjectId!,
    sourceId: ctx.results.sourceId || "",
    assertionCount: ctx.results.assertionCount || 0,
    assertionSummary: summary,
    identityConfig: ctx.results.identityConfig || null,
    warnings: ctx.results.warnings || [],
  };

  onProgress({
    phase: "analysis_complete",
    message: "Analysis complete!",
    totalSteps: analyzeSteps.length,
    data: preview,
  });

  return preview;
}

// ── Commit (Steps 5-7 with overrides) ──────────────────

/**
 * Run the commit phase of Quick Launch (Steps 5-7) with user overrides.
 * Applies domain name/slug changes, identity config edits, caller name, and goal edits
 * before creating the scaffold, curriculum, and test caller.
 */
export async function quickLaunchCommit(
  domainId: string,
  preview: AnalysisPreview,
  overrides: CommitOverrides,
  input: QuickLaunchInput,
  onProgress: ProgressCallback,
  userId: string,
): Promise<QuickLaunchResult> {
  const effectiveDomainName = overrides.domainName || preview.domainName;
  const effectiveDomainSlug = overrides.domainSlug || preview.domainSlug;
  const effectiveIdentityConfig = preview.identityConfig
    ? { ...preview.identityConfig, ...overrides.identityConfig }
    : null;
  const effectiveGoals = overrides.learningGoals ?? input.learningGoals;
  const effectiveCallerName = overrides.callerName || `Test Caller — ${effectiveDomainName}`;

  const steps = await loadLaunchSteps();
  // Community mode skips curriculum generation — no content, no modules.
  // compose_prompt runs AFTER the transaction — it uses the default prisma
  // client which can't see uncommitted data inside $transaction().
  const isCommunity = input.kind === "COMMUNITY";
  const commitOps = isCommunity
    ? ["scaffold_domain", "create_caller"]
    : ["scaffold_domain", "generate_curriculum", "create_caller"];
  const commitSteps = steps.filter((s) => commitOps.includes(s.operation));

  onProgress({
    phase: "init",
    message: `Setting up ${isCommunity ? "community" : "course"} (${commitSteps.length + 1} steps)...`,
    totalSteps: commitSteps.length + 1,
  });

  // Run all commit steps inside a single transaction — all-or-nothing.
  // AI calls (curriculum generation, goal generation, prompt composition) run
  // inside the transaction; the 120s timeout gives 4× headroom for slow AI.
  const { result, deferredEnrichment } = await prisma.$transaction(async (tx) => {
    const ctx: LaunchContext = {
      input: { ...input, learningGoals: effectiveGoals },
      results: {
        domainId,
        domainSlug: effectiveDomainSlug,
        domainName: effectiveDomainName,
        subjectId: preview.subjectId,
        identityConfig: effectiveIdentityConfig,
        assertionCount: preview.assertionCount,
        documentStructure: preview.documentStructure,
        warnings: [],
      },
      onProgress,
      userId,
      tx,
    };

    // Apply domain overrides first
    if (overrides.domainName || overrides.domainSlug) {
      const updateData: Record<string, string> = {};
      if (overrides.domainName) updateData.name = overrides.domainName;
      if (overrides.domainSlug) updateData.slug = overrides.domainSlug;
      await db(tx).domain.update({ where: { id: domainId }, data: updateData });
    }

    for (let i = 0; i < commitSteps.length; i++) {
      const step = commitSteps[i];

      // For create_caller, inject the overridden caller name
      if (step.operation === "create_caller") {
        ctx.input = {
          ...ctx.input,
          subjectName: effectiveCallerName.replace(/^Test Caller — /, "") || ctx.input.subjectName,
        };
      }

      const executor = stepExecutors[step.operation];
      if (!executor) {
        const msg = `Unknown step operation: "${step.operation}"`;
        if (step.onError === "abort") throw new Error(msg);
        ctx.results.warnings!.push(msg);
        continue;
      }

      onProgress({
        phase: step.id,
        message: step.progressMessage,
        stepIndex: i,
        totalSteps: commitSteps.length,
      });

      try {
        await executor(ctx, step);
        onProgress({
          phase: step.id,
          message: `${step.name} ✓`,
          stepIndex: i,
          totalSteps: commitSteps.length,
        });
      } catch (err: any) {
        console.error(`[quick-launch:commit] Step "${step.id}" failed:`, err.message);
        if (step.onError === "abort") {
          onProgress({ phase: step.id, message: `Failed: ${err.message}`, stepIndex: i, totalSteps: commitSteps.length });
          throw err;
        }
        ctx.results.warnings!.push(`${step.name}: ${err.message}`);
        onProgress({ phase: step.id, message: `${step.name} — skipped (${err.message})`, stepIndex: i, totalSteps: commitSteps.length });
      }
    }

    // If caller name was overridden, update it directly
    if (overrides.callerName && ctx.results.callerId) {
      await db(tx).caller.update({
        where: { id: ctx.results.callerId },
        data: { name: overrides.callerName },
      });
      ctx.results.callerName = overrides.callerName;
    }

    const txResult: QuickLaunchResult = {
      domainId: ctx.results.domainId!,
      domainSlug: effectiveDomainSlug,
      domainName: effectiveDomainName,
      subjectId: preview.subjectId,
      sourceId: ctx.results.sourceId || preview.sourceId || undefined,
      callerId: ctx.results.callerId!,
      callerName: ctx.results.callerName || effectiveCallerName,
      identitySpecId: ctx.results.identitySpecId,
      contentSpecId: undefined, // Deprecated (ADR-002)
      playbookId: ctx.results.playbookId,
      assertionCount: preview.assertionCount,
      moduleCount: ctx.results.moduleCount || 0,
      goalCount: ctx.results.goalCount ?? effectiveGoals.length,
      enrichmentTaskId: ctx.results.enrichmentTaskId,
      cohortGroupId: ctx.results.cohortGroupId,
      joinToken: ctx.results.joinToken,
      warnings: ctx.results.warnings || [],
      documentStructure: preview.documentStructure,
    };

    return {
      result: txResult,
      deferredEnrichment: ctx.results._deferredEnrichment as
        | { specId: string; opts: any }
        | undefined,
    };
  }, { timeout: 120_000 });

  // Fire deferred enrichment AFTER transaction commits (reads committed data)
  if (deferredEnrichment) {
    startCurriculumEnrichment(deferredEnrichment.specId, deferredEnrichment.opts, userId)
      .then((taskId) => {
        if (taskId) result.enrichmentTaskId = taskId;
      })
      .catch((err) => console.warn("[quick-launch] Deferred enrichment failed:", err.message));
  }

  // Compose prompt AFTER transaction — executeComposition uses default prisma
  // client, so it needs committed data (caller, identity spec, etc.).
  // Non-fatal: matches QUICK-LAUNCH-001 spec ("onError": "continue").
  if (result.callerId) {
    try {
      onProgress({
        phase: "compose_prompt",
        message: "Composing first prompt...",
        stepIndex: commitSteps.length,
        totalSteps: commitSteps.length + 1,
      });
      const { fullSpecConfig, sections, specSlug } = await loadComposeConfig();
      const composition = await executeComposition(result.callerId, sections, fullSpecConfig);
      const promptSummary = renderPromptSummary(composition.llmPrompt);
      await persistComposedPrompt(composition, promptSummary, {
        callerId: result.callerId,
        triggerType: "quick-launch",
        composeSpecSlug: specSlug,
        specConfig: fullSpecConfig,
      });
      onProgress({
        phase: "compose_prompt",
        message: "Compose First Prompt \u2713",
        stepIndex: commitSteps.length,
        totalSteps: commitSteps.length + 1,
      });
    } catch (err: any) {
      console.error("[quick-launch] Post-tx prompt composition failed:", err.message);
      result.warnings = result.warnings || [];
      result.warnings.push(`Compose First Prompt: ${err.message}`);
    }
  }

  onProgress({
    phase: "complete",
    message: "Quick Launch complete!",
    detail: result as any,
  });

  return result;
}
