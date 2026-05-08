/**
 * resolve-current-module.ts
 *
 * Single resolver for "which module is this caller working on right now?".
 * Used by both the EXTRACT pipeline (to score mastery against the right
 * module after a call) and the COMPOSE side (to lock the prompt's
 * `nextModule` to the same anchor).
 *
 * Consolidates five legacy paths that had drifted across two call sites:
 *   1. Picker override        — `requestedModuleId` from the call
 *   2. Authored fallback      — `Playbook.config.modules` + `CallerModuleProgress`
 *   3. CONTENT-spec items     — playbook items with `specRole=CONTENT` (deprecated)
 *   4. notableInfo.modules    — `Curriculum.notableInfo.modules` (deprecated)
 *   5. Subject curriculum     — domain → subject → curriculum (deprecated)
 *
 * Outcome resolution:
 *   `learningOutcomes` is always resolved to statement text (via
 *   `Playbook.config.outcomes` for authored, or `LearningObjective.description`
 *   for DB modules). Raw refs are preserved on `outcomeRefs` so consumers
 *   that need FK lookups (`teaching-content.ts`) still work.
 *
 * Closes #284, #288. Replaces inline logic at:
 *   - apps/admin/app/api/calls/[callId]/pipeline/route.ts:loadCurrentModuleContext
 *   - apps/admin/lib/prompt/composition/transforms/modules.ts:lockedModule block
 */

import { prisma } from "@/lib/prisma";
import { getCurriculumProgress } from "@/lib/curriculum/track-progress";
import { ContractRegistry } from "@/lib/contracts/registry";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";

export type ResolvedModuleSource =
  | "picker"
  | "authored-prev-call"
  | "authored-first-incomplete"
  | "authored-first"
  | "content-spec"
  | "playbook-curriculum"
  | "subject-curriculum";

export interface ResolvedModule {
  /** Which path produced this resolution — useful for logs and tests. */
  source: ResolvedModuleSource;
  /** Stable key for `getCurriculumProgress` and curriculum-scoped attrs. */
  specSlug: string;
  /** Authored module `id` OR `CurriculumModule.slug`. */
  moduleId: string;
  moduleName: string;
  /**
   * Resolved statement text — what the AI should see. Refs that fail
   * resolution fall back to the raw ref string with a warn log.
   */
  learningOutcomes: string[];
  /** Raw outcome refs (e.g. "OUT-01") — needed by teaching-content FK lookup. */
  outcomeRefs: string[];
  masteryThreshold: number;
  /** All sibling module ids in the same curriculum, in order. */
  allModuleIds: string[];
  /**
   * True when this caller has any prior progress on this curriculum
   * (`CallerModuleProgress.callCount > 0` OR a `lo_mastery` attr exists).
   * Used by pedagogy.ts to gate retrieval/review instructions so first-time
   * learners don't get hallucinated "review of baseline work" openers.
   */
  hasPriorMastery: boolean;
  /** Optional fields some COMPOSE consumers expect. */
  prerequisites?: string[];
  content?: Record<string, unknown>;
  description?: string | null;
}

export interface ResolveOpts {
  /** Picker selection from the current Call.requestedModuleId. */
  requestedModuleId?: string | null;
  /** Fallback playbookId from the call record itself (for SIM testers without enrollment). */
  callPlaybookId?: string | null;
  /** Lightweight logger — accepts info/warn so the call sites can plug in their own. */
  log?: { info: (msg: string, data?: unknown) => void; warn: (msg: string, data?: unknown) => void };
  /**
   * Optional preloaded caller domainId, used only by the legacy SubjectDomain
   * path (5). When omitted that path is skipped.
   */
  callerDomainId?: string | null;
}

const NO_LOG = { info: () => {}, warn: () => {} };

interface AuthoredModuleShape {
  id?: string;
  label?: string;
  outcomesPrimary?: unknown;
  prerequisites?: unknown;
  content?: Record<string, unknown>;
  position?: number;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveOutcomeText(
  refs: string[],
  outcomes: Record<string, string>,
  log: NonNullable<ResolveOpts["log"]>,
  moduleId: string,
): string[] {
  const known = Object.keys(outcomes).length > 0;
  if (!known) return refs;
  const resolved: string[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const text = outcomes[ref];
    if (text) resolved.push(text);
    else {
      missing.push(ref);
      resolved.push(ref); // Fall back to ref so AI still sees something.
    }
  }
  if (missing.length > 0) {
    log.warn(
      `Module ${moduleId}: ${missing.length} unknown outcome ref(s) — kept as bare refs`,
      { missing },
    );
  }
  return resolved;
}

async function computeHasPriorMastery(
  callerId: string,
  curriculumId: string | null,
  specSlug: string,
): Promise<boolean> {
  if (curriculumId) {
    const cmp = await prisma.callerModuleProgress.findFirst({
      where: { callerId, callCount: { gt: 0 }, module: { curriculumId } },
      select: { id: true },
    });
    if (cmp) return true;
  }
  // Fallback: any LO mastery attribute under this curriculum's spec key prefix.
  try {
    const progress = await getCurriculumProgress(callerId, specSlug);
    return Object.keys(progress.modulesMastery).length > 0
      || Object.keys(progress.loMastery).length > 0;
  } catch {
    return false;
  }
}

export async function resolveCurrentModule(
  callerId: string,
  opts: ResolveOpts = {},
): Promise<ResolvedModule | null> {
  const log = opts.log ?? NO_LOG;
  let resolvedPlaybookId = await resolvePlaybookId(callerId);
  if (!resolvedPlaybookId && opts.callPlaybookId) {
    log.info("No enrollment; using call.playbookId as fallback", {
      callPlaybookId: opts.callPlaybookId,
    });
    resolvedPlaybookId = opts.callPlaybookId;
  }
  if (!resolvedPlaybookId) return null;

  const pb = await prisma.playbook.findUnique({
    where: { id: resolvedPlaybookId },
    select: {
      name: true,
      config: true,
      curricula: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, slug: true },
      },
      items: {
        where: {
          itemType: "SPEC",
          isEnabled: true,
          spec: { specRole: "CONTENT", isActive: true },
        },
        select: {
          spec: { select: { slug: true, config: true } },
        },
      },
    },
  });

  const cfg = (pb?.config ?? {}) as Record<string, any>;
  const authored: AuthoredModuleShape[] = Array.isArray(cfg.modules) ? cfg.modules : [];
  const knownOutcomes: Record<string, string> =
    cfg.outcomes && typeof cfg.outcomes === "object" && !Array.isArray(cfg.outcomes)
      ? (cfg.outcomes as Record<string, string>)
      : {};
  const fallbackSpecSlug = `playbook-${resolvedPlaybookId.slice(0, 8)}-modules`;
  const primaryCurriculum = pb?.curricula[0] ?? null;

  function buildAuthored(
    chosen: AuthoredModuleShape,
    source: Extract<ResolvedModuleSource, `picker` | `authored-${string}`>,
    hasPrior: boolean,
  ): ResolvedModule {
    const rawRefs: string[] = Array.isArray(chosen.outcomesPrimary)
      ? (chosen.outcomesPrimary as string[]).filter((s): s is string => typeof s === "string")
      : [];
    const learningOutcomes = resolveOutcomeText(rawRefs, knownOutcomes, log, chosen.id ?? "(unknown)");
    const specSlug = primaryCurriculum?.slug ?? fallbackSpecSlug;
    log.info(`Module context resolved (${source})`, {
      moduleId: chosen.id,
      specSlug,
      loCount: learningOutcomes.length,
      droppedRefs: rawRefs.length - learningOutcomes.filter((t, i) => t !== rawRefs[i]).length,
    });
    return {
      source,
      specSlug,
      moduleId: chosen.id ?? "(unknown)",
      moduleName: chosen.label || chosen.id || "(unknown)",
      learningOutcomes,
      outcomeRefs: rawRefs,
      masteryThreshold: 0.7,
      allModuleIds: authored.map((m) => m.id).filter((id): id is string => typeof id === "string"),
      hasPriorMastery: hasPrior,
      prerequisites: Array.isArray(chosen.prerequisites)
        ? (chosen.prerequisites as string[])
        : undefined,
      content: chosen.content,
    };
  }

  // ── Path 1: picker override ─────────────────────────
  if (opts.requestedModuleId) {
    const match = authored.find((m) => m.id === opts.requestedModuleId);
    if (match) {
      const hasPrior = await computeHasPriorMastery(
        callerId,
        primaryCurriculum?.id ?? null,
        primaryCurriculum?.slug ?? fallbackSpecSlug,
      );
      return buildAuthored(match, "picker", hasPrior);
    }
    log.warn("requestedModuleId not in Playbook.config.modules — falling through", {
      requestedModuleId: opts.requestedModuleId,
      playbookId: resolvedPlaybookId,
    });
  }

  // ── Path 2: authored fallback (no picker) ───────────
  if (cfg.modulesAuthored === true && authored.length > 0) {
    const curriculumId = primaryCurriculum?.id ?? null;
    let chosen: AuthoredModuleShape | null = null;
    let source: Extract<ResolvedModuleSource, `authored-${string}`> = "authored-first-incomplete";

    if (curriculumId) {
      const prevCall = await prisma.call.findFirst({
        where: { callerId, curriculumModuleId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { curriculumModuleId: true },
      });
      if (prevCall?.curriculumModuleId) {
        const prevMod = await prisma.curriculumModule.findUnique({
          where: { id: prevCall.curriculumModuleId },
          select: { slug: true, curriculumId: true },
        });
        if (prevMod && prevMod.curriculumId === curriculumId) {
          const candidate = authored.find((m) => m.id === prevMod.slug) ?? null;
          if (candidate) {
            const completed = await prisma.callerModuleProgress.findFirst({
              where: {
                callerId,
                moduleId: prevCall.curriculumModuleId,
                status: "COMPLETED",
              },
              select: { id: true },
            });
            if (!completed) {
              chosen = candidate;
              source = "authored-prev-call";
            }
          }
        }
      }

      if (!chosen) {
        const completedRows = await prisma.callerModuleProgress.findMany({
          where: { callerId, status: "COMPLETED", module: { curriculumId } },
          select: { module: { select: { slug: true } } },
        });
        const completedSlugs = new Set(completedRows.map((r) => r.module.slug));
        const ordered = [...authored].sort(
          (a, b) => (a.position ?? 0) - (b.position ?? 0),
        );
        chosen = ordered.find((m) => m.id && !completedSlugs.has(m.id)) ?? null;
        source = "authored-first-incomplete";
      }
    }

    if (!chosen) {
      chosen = authored[0] ?? null;
      source = "authored-first";
    }

    if (chosen?.id) {
      const hasPrior = await computeHasPriorMastery(
        callerId,
        primaryCurriculum?.id ?? null,
        primaryCurriculum?.slug ?? fallbackSpecSlug,
      );
      return buildAuthored(chosen, source, hasPrior);
    }
  }

  // ── Legacy Path 3: CONTENT-role spec items ──────────
  if (pb?.items?.length) {
    for (const item of pb.items) {
      const spec = item.spec;
      if (!spec) continue;
      const specCfg = spec.config as Record<string, any> | null;
      if (!specCfg) continue;
      const modules = specCfg.modules || specCfg.curriculum?.modules || [];
      if (!Array.isArray(modules) || modules.length === 0) continue;

      const progress = await getCurriculumProgress(callerId, spec.slug);
      const currentModuleId = progress.currentModuleId || modules[0]?.id || modules[0]?.slug;
      const currentModule = modules.find((m: any) => (m.id || m.slug) === currentModuleId) || modules[0];
      if (!currentModule) continue;

      const rawRefs: string[] = Array.isArray(currentModule.learningOutcomes)
        ? (currentModule.learningOutcomes as string[])
        : [];
      log.warn("Resolved via legacy CONTENT-spec path — verify if this course still needs it", {
        playbookId: resolvedPlaybookId,
        playbookName: pb?.name,
        specSlug: spec.slug,
        moduleId: currentModule.id || currentModule.slug,
      });

      const hasPrior = await computeHasPriorMastery(
        callerId,
        primaryCurriculum?.id ?? null,
        spec.slug,
      );
      return {
        source: "content-spec",
        specSlug: spec.slug,
        moduleId: currentModule.id || currentModule.slug,
        moduleName: currentModule.name || currentModule.title || currentModule.id,
        learningOutcomes: rawRefs,
        outcomeRefs: rawRefs,
        masteryThreshold: specCfg.metadata?.curriculum?.masteryThreshold ?? 0.7,
        allModuleIds: modules.map((m: any) => m.id || m.slug),
        hasPriorMastery: hasPrior,
        prerequisites: Array.isArray(currentModule.prerequisites)
          ? currentModule.prerequisites
          : undefined,
        content: currentModule.content,
        description: asString(currentModule.description),
      };
    }
  }

  // ── Legacy Path 4: Curriculum.notableInfo.modules ───
  if (resolvedPlaybookId) {
    const pbCurriculum = await prisma.curriculum.findFirst({
      where: { playbookId: resolvedPlaybookId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, slug: true, notableInfo: true },
    });
    if (pbCurriculum?.notableInfo) {
      const rawModules = (pbCurriculum.notableInfo as Record<string, any>)?.modules;
      if (Array.isArray(rawModules) && rawModules.length > 0) {
        const progress = await getCurriculumProgress(callerId, pbCurriculum.slug);
        const currentModuleId = progress.currentModuleId || rawModules[0]?.id;
        const currentModule = rawModules.find((m: any) => m.id === currentModuleId) || rawModules[0];
        if (currentModule) {
          log.warn("Resolved via legacy notableInfo.modules path — verify if this course still needs it", {
            playbookId: resolvedPlaybookId,
            playbookName: pb?.name,
            specSlug: pbCurriculum.slug,
            moduleId: currentModule.id,
          });
          const rawRefs: string[] = Array.isArray(currentModule.learningOutcomes)
            ? (currentModule.learningOutcomes as string[])
            : [];
          const hasPrior = await computeHasPriorMastery(
            callerId,
            pbCurriculum.id,
            pbCurriculum.slug,
          );
          return {
            source: "playbook-curriculum",
            specSlug: pbCurriculum.slug,
            moduleId: currentModule.id,
            moduleName: currentModule.name || currentModule.title || currentModule.id,
            learningOutcomes: rawRefs,
            outcomeRefs: rawRefs,
            masteryThreshold: 0.7,
            allModuleIds: rawModules.map((m: any) => m.id),
            hasPriorMastery: hasPrior,
            prerequisites: Array.isArray(currentModule.prerequisites)
              ? currentModule.prerequisites
              : undefined,
            content: currentModule.content,
            description: asString(currentModule.description),
          };
        }
      }
    }
  }

  // ── Legacy Path 5: SubjectDomain ────────────────────
  if (opts.callerDomainId) {
    const subjectDomains = await prisma.subjectDomain.findMany({
      where: { domainId: opts.callerDomainId },
      include: {
        subject: {
          include: {
            curricula: {
              orderBy: { updatedAt: "desc" },
              take: 1,
              select: { id: true, slug: true, notableInfo: true },
            },
          },
        },
      },
    });

    for (const sd of subjectDomains) {
      const curriculum = sd.subject.curricula[0];
      if (!curriculum?.notableInfo) continue;
      const rawModules = (curriculum.notableInfo as Record<string, any>)?.modules;
      if (!Array.isArray(rawModules) || rawModules.length === 0) continue;

      const progress = await getCurriculumProgress(callerId, curriculum.slug);
      const currentModuleId = progress.currentModuleId || rawModules[0]?.id;
      const currentModule = rawModules.find((m: any) => m.id === currentModuleId) || rawModules[0];
      if (!currentModule) continue;

      log.warn("Resolved via legacy SubjectDomain curriculum path — verify if this course still needs it", {
        domainId: opts.callerDomainId,
        specSlug: curriculum.slug,
        moduleId: currentModule.id,
      });

      const rawRefs: string[] = Array.isArray(currentModule.learningOutcomes)
        ? (currentModule.learningOutcomes as string[])
        : [];
      const masteryThreshold =
        (await ContractRegistry.getThresholds("CURRICULUM_PROGRESS_V1"))?.masteryComplete ?? 0.7;
      const hasPrior = await computeHasPriorMastery(
        callerId,
        curriculum.id,
        curriculum.slug,
      );
      return {
        source: "subject-curriculum",
        specSlug: curriculum.slug,
        moduleId: currentModule.id,
        moduleName: currentModule.title || currentModule.name || currentModule.id,
        learningOutcomes: rawRefs,
        outcomeRefs: rawRefs,
        masteryThreshold,
        allModuleIds: rawModules.map((m: any) => m.id),
        hasPriorMastery: hasPrior,
        prerequisites: Array.isArray(currentModule.prerequisites)
          ? currentModule.prerequisites
          : undefined,
        content: currentModule.content,
        description: asString(currentModule.description),
      };
    }
  }

  return null;
}
