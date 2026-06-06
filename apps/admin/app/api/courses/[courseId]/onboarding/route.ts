import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { updatePlaybookConfig } from "@/lib/playbook/update-playbook-config";
import type {
  PlaybookConfig,
  OnboardingFlowPhases,
  OnboardingPhase,
} from "@/lib/types/json-fields";
import { getFlowPhasesFallback } from "@/lib/fallback-settings";
import { resolveSessionFlow } from "@/lib/session-flow/resolver";
import { config } from "@/lib/config";

/** UI-facing source attribution (#1196). Pre-#1196 this route returned
 *  `'fallback'` for INIT-001 defaults and the editor remapped it to
 *  `'domain'` — making operators think their institution had configured
 *  phases when in fact only the system defaults were showing. The new
 *  `'system'` label surfaces the truth. */
type ApiOnboardingSource = "course" | "domain" | "system" | "none";

/**
 * Map `resolveSessionFlow`'s internal source values → UI-facing source.
 *
 *   resolveSessionFlow returns │  UI source
 *   ───────────────────────────┼─────────────
 *   "new-shape"                │  'course'
 *   "playbook-legacy"          │  'course'
 *   "domain"                   │  'domain'
 *   "init001"                  │  'system'   ← was incorrectly 'fallback' → remapped to 'domain'
 */
function mapResolverSource(
  resolverSource: "new-shape" | "playbook-legacy" | "domain" | "init001",
): Exclude<ApiOnboardingSource, "none"> {
  switch (resolverSource) {
    case "new-shape":
    case "playbook-legacy":
      return "course";
    case "domain":
      return "domain";
    case "init001":
      return "system";
  }
}

/**
 * @api GET /api/courses/:courseId/onboarding
 * @visibility internal
 * @auth session
 * @tags courses, onboarding
 * @description Get resolved onboarding flow for a course. Cascade per #1196:
 *   `sessionFlow.onboarding` (new shape) → `config.onboardingFlowPhases`
 *   (legacy) → `domain.onboardingFlowPhases` → INIT-001 spec → SystemSetting
 *   defaults. Returns `source: "course" | "domain" | "system" | "none"` so
 *   the editor can show an accurate banner.
 * @pathParam courseId string - The playbook ID (course)
 * @response 200 { ok: true, source, phases, domainName, domainId, domainWelcome, personaName, media }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const authResult = await requireAuth("VIEWER");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId } = await params;

    const playbook = await prisma.playbook.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        config: true,
        domain: {
          select: {
            id: true,
            name: true,
            slug: true,
            onboardingFlowPhases: true,
            onboardingWelcome: true,
            onboardingIdentitySpec: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!playbook) {
      return NextResponse.json(
        { ok: false, error: "Course not found" },
        { status: 404 }
      );
    }

    // Fetch INIT-001 spec for the resolver's bottom cascade rung. WITHOUT
    // this, `resolveSessionFlow` silently returns `{phases: [], source:
    // "init001"}` even when domain phases exist — the resolver's logic is
    // correct, but `firstCallFlow` lookup needs the spec. Mirrors the
    // pattern at `SectionDataLoader.ts:1002-1023::onboardingSpec`.
    const onboardingSlug = config.specs.onboarding;
    const onboardingSpec = await prisma.analysisSpec.findFirst({
      where: {
        OR: [
          { slug: { contains: onboardingSlug.toLowerCase(), mode: "insensitive" } },
          { slug: { contains: "onboarding" } },
          { domain: "onboarding" },
        ],
        isActive: true,
      },
      select: { config: true },
    });

    const resolved = resolveSessionFlow({
      playbook: { config: playbook.config as PlaybookConfig | null },
      domain: playbook.domain ?? null,
      onboardingSpec: onboardingSpec
        ? {
            config: onboardingSpec.config as {
              firstCallFlow?: OnboardingFlowPhases;
            } | null,
          }
        : null,
    });

    let source: ApiOnboardingSource = mapResolverSource(resolved.source.onboarding);
    let resolvedPhases: OnboardingPhase[] = resolved.onboarding.phases ?? [];

    // SystemSetting bottom fallback: if the resolver returned init001 with
    // an empty phase array (no INIT-001 spec in DB), fall back to the
    // SystemSetting-backed defaults from `getFlowPhasesFallback`. Source
    // stays `'system'` either way.
    if (source === "system" && resolvedPhases.length === 0) {
      const fallback = await getFlowPhasesFallback();
      if (fallback?.phases?.length) {
        resolvedPhases = fallback.phases as OnboardingPhase[];
      }
    }

    // None: no phases AND no fallback content — keep the UI safe.
    if (resolvedPhases.length === 0 && source === "system") {
      source = "none";
    }

    // Load domain media for editor picker (SubjectDomain → Subject → SubjectMedia → MediaAsset)
    const media: Array<{ id: string; title: string | null; fileName: string; mimeType: string }> = [];
    if (playbook.domain) {
      const subjectMedia = await prisma.subjectMedia.findMany({
        where: {
          subject: {
            domains: { some: { domainId: playbook.domain.id } },
          },
        },
        select: {
          media: {
            select: { id: true, title: true, fileName: true, mimeType: true },
          },
        },
        take: 100,
      });
      const seen = new Set<string>();
      for (const sm of subjectMedia) {
        if (!seen.has(sm.media.id)) {
          seen.add(sm.media.id);
          media.push(sm.media);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      source,
      phases: resolvedPhases,
      domainId: playbook.domain?.id || null,
      domainName: playbook.domain?.name || null,
      domainWelcome: playbook.domain?.onboardingWelcome || null,
      personaName: playbook.domain?.onboardingIdentitySpec?.name?.replace(/ Identity$/i, '') || null,
      media,
    });
  } catch (error: unknown) {
    console.error("[course-onboarding-api] GET error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch course onboarding" },
      { status: 500 }
    );
  }
}

/**
 * @api PUT /api/courses/:courseId/onboarding
 * @visibility internal
 * @auth session (OPERATOR+)
 * @tags courses, onboarding
 * @description Set or clear course-level onboarding flow phase override. Pass null to reset to institution default.
 * @pathParam courseId string - The playbook ID (course)
 * @body onboardingFlowPhases object|null - Phase config or null to reset to domain default
 * @response 200 { ok: true }
 * @response 404 { ok: false, error: "Course not found" }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ courseId: string }> }
) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const { courseId } = await params;
    const body = await req.json();
    const { onboardingFlowPhases } = body as { onboardingFlowPhases: OnboardingFlowPhases | null };

    // #826 — central helper. `onboardingFlowPhases` is in
    // COMPOSE_AFFECTING_PLAYBOOK_CONFIG_KEYS, so a change bumps the
    // timestamp and downstream callers are marked stale.
    try {
      await updatePlaybookConfig(
        courseId,
        (cfg) => {
          if (onboardingFlowPhases === null) {
            delete cfg.onboardingFlowPhases;
          } else {
            cfg.onboardingFlowPhases = onboardingFlowPhases;
          }
          return cfg;
        },
        { reason: "course-onboarding PUT" },
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("not found")) {
        return NextResponse.json(
          { ok: false, error: "Course not found" },
          { status: 404 },
        );
      }
      throw err;
    }

    const action = onboardingFlowPhases === null ? "reset to domain default" : "set course override";
    console.log(`[course-onboarding-api] ${action} for course ${courseId}`);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[course-onboarding-api] PUT error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to update course onboarding" },
      { status: 500 }
    );
  }
}
