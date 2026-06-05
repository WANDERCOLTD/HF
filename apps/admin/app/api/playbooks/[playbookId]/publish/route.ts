import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

type ValidationError = {
  itemId?: string;
  error: string;
  severity: "error" | "warning";
};

/**
 * @api POST /api/playbooks/:playbookId/publish
 * @visibility public
 * @scope playbooks:write
 * @auth session
 * @tags playbooks
 * @description Validates and publishes a playbook. Runs validation checks (items exist,
 *   specs are active, no duplicate parameters, correct ordering). Archives any previously
 *   published playbook for the same domain.
 * @pathParam playbookId string - Playbook UUID (must be DRAFT)
 * @response 200 { ok: true, playbook: Playbook, validationErrors: [...], validationPassed: true, stats: {...} }
 * @response 400 { ok: false, error: "Playbook is already published" }
 * @response 404 { ok: false, error: "Playbook not found" }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ playbookId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { playbookId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: playbookId },
      include: {
        domain: true,
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            spec: {
              include: {
                triggers: {
                  include: {
                    actions: true,
                  },
                },
              },
            },
            promptTemplate: true,
          },
        },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Playbook not found" },
        { status: 404 }
      );
    }

    if (playbook.status === "PUBLISHED") {
      return NextResponse.json(
        { ok: false, error: "Playbook is already published" },
        { status: 400 }
      );
    }

    // === VALIDATION ===
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // 1. Must have at least one item
    if (playbook.items.length === 0) {
      errors.push({
        error: "Playbook must have at least one item",
        severity: "error",
      });
    }

    // 2. Should have a prompt template (warning)
    const hasPromptTemplate = playbook.items.some(
      (item) => item.itemType === "PROMPT_TEMPLATE" && item.promptTemplate
    );
    if (!hasPromptTemplate) {
      warnings.push({
        error: "Playbook has no prompt template - no final prompt will be generated",
        severity: "warning",
      });
    }

    // 3. Check for duplicate parameters across specs
    const parameterIds = new Set<string>();
    const duplicateParams: string[] = [];

    for (const item of playbook.items) {
      if (item.spec) {
        for (const trigger of item.spec.triggers) {
          for (const action of trigger.actions) {
            if (action.parameterId) {
              if (parameterIds.has(action.parameterId)) {
                duplicateParams.push(action.parameterId);
              } else {
                parameterIds.add(action.parameterId);
              }
            }
          }
        }
      }
    }

    if (duplicateParams.length > 0) {
      warnings.push({
        error: `Duplicate parameters detected: ${[...new Set(duplicateParams)].join(", ")}. Later specs will override earlier results.`,
        severity: "warning",
      });
    }

    // 4. Check item order (MEASURE/LEARN/ADAPT should come before PROMPT_TEMPLATE)
    let foundPromptTemplate = false;
    for (const item of playbook.items) {
      if (item.itemType === "PROMPT_TEMPLATE") {
        foundPromptTemplate = true;
      } else if (foundPromptTemplate && item.itemType === "SPEC") {
        warnings.push({
          itemId: item.id,
          error: "Spec found after prompt template - specs should come before templates",
          severity: "warning",
        });
      }
    }

    // 5. Check all referenced specs are active
    for (const item of playbook.items) {
      if (item.spec && !item.spec.isActive) {
        errors.push({
          itemId: item.id,
          error: `Spec "${item.spec.name}" is inactive`,
          severity: "error",
        });
      }
      if (item.promptTemplate && !item.promptTemplate.isActive) {
        errors.push({
          itemId: item.id,
          error: `Prompt template "${item.promptTemplate.name}" is inactive`,
          severity: "error",
        });
      }
    }

    // 6. Check for specs with no actions
    for (const item of playbook.items) {
      if (item.spec) {
        const totalActions = item.spec.triggers.reduce(
          (sum, t) => sum + t.actions.length,
          0
        );
        if (totalActions === 0) {
          warnings.push({
            itemId: item.id,
            error: `Spec "${item.spec.name}" has no actions defined`,
            severity: "warning",
          });
        }
      }
    }

    // 7. #1117 follow-up — LO ref robustness gate.
    //
    // When the Playbook is linked (via PlaybookCurriculum, #1034) to a
    // Curriculum that has first-class LearningObjective rows, all refs must:
    //   (a) NOT match the placeholder pattern /^LO\d+$/  — the AI ignores
    //       these and `validateLoScores` rejects them at the write boundary,
    //       so per-LO mastery would silently never land.
    //   (b) be GLOBALLY unique across all modules in the Curriculum — the
    //       readiness rollup dedupes by loRef across sibling Curricula, so
    //       cross-module ref collisions silently merge unrelated LOs.
    //
    // Hard gate (error) — operator must rename refs to a module-scoped
    // scheme like "{moduleSlug}-LO{N}" before the Playbook can publish.
    {
      const links = await prisma.playbookCurriculum.findMany({
        where: { playbookId },
        select: { curriculumId: true },
      });
      const curriculumIds = links.map((l) => l.curriculumId);
      if (curriculumIds.length > 0) {
        const los = await prisma.learningObjective.findMany({
          where: { module: { curriculumId: { in: curriculumIds } } },
          select: { ref: true },
        });
        const PLACEHOLDER = /^LO\d+$/;
        const placeholderRefs: string[] = [];
        const refCounts = new Map<string, number>();
        for (const lo of los) {
          if (PLACEHOLDER.test(lo.ref)) placeholderRefs.push(lo.ref);
          refCounts.set(lo.ref, (refCounts.get(lo.ref) ?? 0) + 1);
        }
        if (placeholderRefs.length > 0) {
          const sample = [...new Set(placeholderRefs)].slice(0, 5).join(", ");
          errors.push({
            error: `${placeholderRefs.length} learning objective ref(s) match the placeholder pattern /^LO\\d+$/ (e.g. ${sample}). These are silently rejected at the write boundary and per-LO mastery will never land. Rename to a module-scoped scheme such as "{moduleSlug}-LO{N}" before publishing. (#1117)`,
            severity: "error",
          });
        }
        const duplicateRefs = [...refCounts.entries()]
          .filter(([, n]) => n > 1)
          .map(([ref]) => ref);
        if (duplicateRefs.length > 0) {
          const sample = duplicateRefs.slice(0, 5).join(", ");
          errors.push({
            error: `${duplicateRefs.length} learning objective ref(s) are duplicated across modules in the linked Curriculum (e.g. ${sample}). The readiness rollup dedupes by ref so duplicates silently merge unrelated LOs. Rename to a module-scoped scheme such as "{moduleSlug}-LO{N}" before publishing. (#1117)`,
            severity: "error",
          });
        }
      }
    }

    // Compute stats
    const specsByType = {
      MEASURE: 0,
      LEARN: 0,
      ADAPT: 0,
      MEASURE_AGENT: 0,
    };

    for (const item of playbook.items) {
      if (item.spec) {
        const outputType = item.spec.outputType as keyof typeof specsByType;
        if (outputType in specsByType) {
          specsByType[outputType]++;
        }
      }
    }

    const allErrors = [...errors, ...warnings];
    const validationPassed = errors.length === 0;

    // If validation fails with errors, don't publish
    if (!validationPassed) {
      return NextResponse.json({
        ok: false,
        error: "Validation failed",
        validationErrors: allErrors,
        validationPassed: false,
      });
    }

    // === PUBLISH ===
    // Archive any existing published playbook for this domain
    await prisma.playbook.updateMany({
      where: {
        domainId: playbook.domainId,
        status: "PUBLISHED",
        id: { not: playbookId },
      },
      data: {
        status: "ARCHIVED",
      },
    });

    // Publish this playbook
    const published = await prisma.playbook.update({
      where: { id: playbookId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        validationErrors: allErrors.length > 0 ? allErrors : undefined,
        validationPassed: true,
        measureSpecCount: specsByType.MEASURE + specsByType.MEASURE_AGENT,
        learnSpecCount: specsByType.LEARN,
        adaptSpecCount: specsByType.ADAPT,
        parameterCount: parameterIds.size,
      },
      include: {
        domain: {
          select: { id: true, slug: true, name: true },
        },
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            spec: {
              select: {
                id: true,
                slug: true,
                name: true,
                scope: true,
                outputType: true,
              },
            },
            promptTemplate: {
              select: {
                id: true,
                slug: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      ok: true,
      playbook: published,
      validationErrors: allErrors,
      validationPassed: true,
      stats: {
        measureSpecCount: specsByType.MEASURE + specsByType.MEASURE_AGENT,
        learnSpecCount: specsByType.LEARN,
        adaptSpecCount: specsByType.ADAPT,
        parameterCount: parameterIds.size,
      },
    });
  } catch (error: any) {
    console.error("Error publishing playbook:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to publish playbook" },
      { status: 500 }
    );
  }
}
