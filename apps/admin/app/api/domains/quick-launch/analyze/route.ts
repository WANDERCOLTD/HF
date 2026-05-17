import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { type AnalysisPreview } from "@/lib/domain/quick-launch";
import { generateIdentityFromAssertions } from "@/lib/domain/generate-identity";
import { suggestTeachingProfile } from "@/lib/content-trust/teaching-profiles";
import { startTaskTracking, updateTaskProgress } from "@/lib/ai/task-guidance";

/**
 * @api POST /api/domains/quick-launch/analyze
 * @visibility internal
 * @auth OPERATOR
 * @tags domains, quick-launch
 * @description Community Quick Launch setup.
 *   Creates domain + subject, generates identity from persona + goals.
 *   No file upload, no content extraction — Community is persona + onboarding only.
 *
 * @request application/json
 *   subjectName: string (required)
 *   persona: string (required)
 *   brief: string (optional)
 *   learningGoals: string[] (optional)
 *   toneTraits: string[] (optional)
 *   qualificationRef: string (optional)
 *   domainId: string (optional) — reuse existing domain
 *   kind: "INSTITUTION" | "COMMUNITY" (optional, defaults to "COMMUNITY")
 *   institutionId: string (optional) — link domain to institution
 *
 * @response 202 { ok, domainId, domainSlug, domainName, subjectId, identityConfig, taskId }
 */

export async function POST(req: NextRequest) {
  // Auth
  const authResult = await requireAuth("OPERATOR");
  if (isAuthError(authResult)) return authResult.error;
  const { session } = authResult;

  // Parse JSON body
  let body: {
    subjectName?: string;
    brief?: string;
    persona?: string;
    learningGoals?: string[];
    toneTraits?: string[];
    qualificationRef?: string;
    domainId?: string;
    kind?: string;
    institutionId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Expected JSON body" },
      { status: 400 }
    );
  }

  const {
    subjectName,
    brief,
    persona,
    learningGoals = [],
    toneTraits = [],
    qualificationRef,
    domainId: existingDomainId,
    kind = "COMMUNITY",
    institutionId: institutionIdRaw,
  } = body;

  // Validate required fields
  if (!subjectName?.trim()) {
    return NextResponse.json({ ok: false, error: "subjectName is required" }, { status: 400 });
  }
  if (!persona?.trim()) {
    return NextResponse.json({ ok: false, error: "persona is required" }, { status: 400 });
  }

  try {
    // ── Step 0: Resolve institution (from body, session, or create inline) ──

    let resolvedInstitutionId: string | null = null;

    if (institutionIdRaw?.startsWith("create:")) {
      // Inline institution creation: "create:Oakwood Academy"
      const instName = institutionIdRaw.slice(7).trim();
      if (instName) {
        const instSlug = instName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const existing = await prisma.institution.findFirst({ where: { slug: instSlug } });
        if (existing) {
          resolvedInstitutionId = existing.id;
        } else {
          const created = await prisma.institution.create({
            data: { name: instName, slug: instSlug },
          });
          resolvedInstitutionId = created.id;
        }
      }
    } else if (institutionIdRaw) {
      resolvedInstitutionId = institutionIdRaw;
    } else {
      resolvedInstitutionId = session.user.institutionId ?? null;
    }

    // Link user to institution if they had none
    if (resolvedInstitutionId && !session.user.institutionId) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { institutionId: resolvedInstitutionId },
      });
    }

    // ── Step 1: Resolve or create domain + subject ──

    let domain;
    if (existingDomainId) {
      domain = await prisma.domain.findUnique({ where: { id: existingDomainId } });
      if (!domain) {
        return NextResponse.json({ ok: false, error: "Domain not found" }, { status: 404 });
      }
    } else {
      const slug = subjectName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      domain = await prisma.domain.findFirst({ where: { slug } });
      if (!domain) {
        domain = await prisma.domain.create({
          data: {
            slug,
            name: subjectName.trim(),
            description: brief?.trim() || `Community for ${subjectName.trim()}`,
            kind: kind as any,
            isActive: true,
            institutionId: resolvedInstitutionId ?? undefined,
          },
        });
      } else if (domain.kind !== kind) {
        domain = await prisma.domain.update({
          where: { id: domain.id },
          data: { kind: kind as any },
        });
      }
    }

    const subjectSlug = subjectName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Subject.slug is @unique — findUnique reflects the schema invariant.
    let subject = await prisma.subject.findUnique({ where: { slug: subjectSlug } });
    if (!subject) {
      subject = await prisma.subject.create({
        data: {
          slug: subjectSlug,
          name: subjectName.trim(),
          qualificationRef: qualificationRef?.trim() || null,
          isActive: true,
          teachingProfile: suggestTeachingProfile(subjectName.trim()),
        },
      });
    }

    // Link subject to domain (idempotent)
    const existingLink = await prisma.subjectDomain.findFirst({
      where: { subjectId: subject.id, domainId: domain.id },
    });
    if (!existingLink) {
      await prisma.subjectDomain.create({
        data: { subjectId: subject.id, domainId: domain.id },
      });
    }

    // ── Step 2: Generate identity (no assertions — from goals + persona only) ──

    let identityConfig = null;
    try {
      const identityResult = await generateIdentityFromAssertions({
        subjectName: subjectName.trim(),
        persona: persona.trim(),
        learningGoals,
        toneTraits,
        assertions: [],
        maxSampleSize: 0,
      });
      if (identityResult.ok && identityResult.config) {
        identityConfig = identityResult.config;
      }
    } catch (err: any) {
      console.warn("[quick-launch:analyze] Identity generation failed:", err.message);
    }

    // ── Step 3: Create tracking task ──

    let taskId: string | null = null;
    try {
      taskId = await startTaskTracking(session.user.id, "quick_launch", {
        phase: "review",
        mode: "generate",
        input: {
          subjectName: subjectName.trim(),
          brief: brief?.trim() || undefined,
          persona: persona.trim(),
          learningGoals,
          toneTraits,
          qualificationRef: qualificationRef?.trim() || undefined,
        },
        domainId: domain.id,
        subjectId: subject.id,
      });
    } catch (err) {
      console.warn("[quick-launch:analyze] Failed to create task:", err);
    }

    // Save preview to task
    if (taskId) {
      const preview: AnalysisPreview = {
        domainId: domain.id,
        domainSlug: domain.slug,
        domainName: domain.name,
        subjectId: subject.id,
        sourceId: null as any,
        assertionCount: 0,
        assertionSummary: {},
        identityConfig,
        warnings: [],
      };
      try {
        await updateTaskProgress(taskId, {
          currentStep: 3,
          context: {
            phase: "review",
            preview,
            input: {
              subjectName: subjectName.trim(),
              brief: brief?.trim() || undefined,
              persona: persona.trim(),
              learningGoals,
              toneTraits,
            },
          },
        });
      } catch (err) {
        console.error(`[quick-launch:analyze] Failed to save task preview:`, err);
      }
    }

    return NextResponse.json(
      {
        ok: true,
        domainId: domain.id,
        domainSlug: domain.slug,
        domainName: domain.name,
        subjectId: subject.id,
        identityConfig,
        taskId,
      },
      { status: 202 }
    );
  } catch (error: any) {
    console.error("[quick-launch:analyze] Setup error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Quick Launch setup failed" },
      { status: 500 }
    );
  }
}
