/**
 * @api GET /api/callers/:callerId/learning-trajectory
 * @visibility public
 * @scope callers:read
 * @auth session
 * @tags callers, learning, measurement
 * @description Returns learning trajectory for a caller. The shape adapts to
 *   the kind of progression data the caller actually has:
 *   - `kind: "skills"` — per-parameter score trajectory for non-knowledge
 *     teaching profiles (comprehension-led, discussion-led, coaching-led).
 *   - `kind: "module-mastery"` — module-by-module mastery for courses that
 *     score against an authored module catalogue (IELTS Speaking, etc.).
 *     Returned when the skills path is empty AND the caller has
 *     `CallerModuleProgress` rows for the enrolled playbook.
 *   - `null` — caller has no learning evidence yet (no scores, no module
 *     progress, no LO mastery).
 *
 *   #953 — added the module-mastery branch so IELTS-style courses no longer
 *   show an empty "Learning Trajectory" card despite having real
 *   per-module mastery and per-LO attribute data.
 * @pathParam callerId string - The caller ID
 * @response 200 { ok: true, data: SkillsTrajectory | ModuleMasteryTrajectory | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, isAuthError } from "@/lib/permissions";

const PROFILE_LABELS: Record<string, string> = {
  "comprehension-led": "Comprehension Skills",
  "discussion-led": "Discussion Skills",
  "coaching-led": "Coaching Progress",
};

const PROFILE_PREFIXES: Record<string, string> = {
  "comprehension-led": "COMP_",
  "discussion-led": "DISC_",
  "coaching-led": "COACH_",
};

const AGG_SCOPES: Record<string, string> = {
  "comprehension-led": "COMP-AGG-001",
  "discussion-led": "DISC-AGG-001",
  "coaching-led": "COACH-AGG-001",
};

// Shape of the per-LO mastery attribute key. The slug between
// `lo_mastery:` and the LO ref is the module slug — used by the module-
// mastery branch to attribute LO scores to their module.
const LO_MASTERY_KEY_RE = /:lo_mastery:([^:]+):([^:]+)$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callerId: string }> },
): Promise<NextResponse> {
  const auth = await requireAuth("VIEWER");
  if (isAuthError(auth)) return auth.error;

  const { callerId } = await params;

  // Resolve teaching profile + playbook context: caller → enrollment →
  // playbook → subject. We pull the playbook id + name as well so the
  // module-mastery branch (below) can render the course name.
  const enrollment = await prisma.callerPlaybook.findFirst({
    where: { callerId, status: "ACTIVE" },
    select: {
      playbookId: true,
      playbook: {
        select: {
          name: true,
          config: true,
          subjects: {
            select: { subject: { select: { teachingProfile: true } } },
            take: 1,
          },
        },
      },
    },
  });

  const profile = enrollment?.playbook?.subjects?.[0]?.subject?.teachingProfile;
  const playbookId = enrollment?.playbookId ?? null;
  const playbookName = enrollment?.playbook?.name ?? null;
  const playbookConfig =
    (enrollment?.playbook?.config as Record<string, unknown> | null) ?? null;

  // ── Branch 1: skills trajectory (existing path) ──
  // Only fires for the three named profiles that have a matching
  // parameter prefix + aggregator spec.
  if (profile && PROFILE_PREFIXES[profile]) {
    const prefix = PROFILE_PREFIXES[profile];
    const aggScope = AGG_SCOPES[profile];

    const scores = await prisma.callScore.findMany({
      where: {
        call: { callerId },
        parameter: { parameterId: { startsWith: prefix } },
      },
      select: {
        score: true,
        createdAt: true,
        parameter: { select: { parameterId: true, name: true } },
        call: { select: { createdAt: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });

    if (scores.length > 0) {
      const paramMap = new Map<
        string,
        { name: string; scores: number[]; callDates: string[] }
      >();
      for (const s of scores) {
        const pid = s.parameter.parameterId;
        if (!paramMap.has(pid)) {
          paramMap.set(pid, { name: s.parameter.name, scores: [], callDates: [] });
        }
        const entry = paramMap.get(pid)!;
        entry.scores.push(s.score);
        entry.callDates.push(s.call.createdAt.toISOString().split("T")[0]);
      }

      const parameters = Array.from(paramMap.entries()).map(
        ([parameterId, data]) => ({
          parameterId,
          name: data.name,
          scores: data.scores,
          latest: data.scores[data.scores.length - 1],
          callDates: data.callDates,
        }),
      );

      const competencyAttr = await prisma.callerAttribute.findFirst({
        where: { callerId, scope: aggScope, key: "competency_level" },
        select: { stringValue: true },
      });

      const checkpoints = await prisma.callerAttribute.findMany({
        where: { callerId, scope: "CHECKPOINT" },
        select: { key: true, stringValue: true, numberValue: true },
        orderBy: { key: "asc" },
      });

      return NextResponse.json({
        ok: true,
        data: {
          kind: "skills" as const,
          profile,
          profileLabel: PROFILE_LABELS[profile] ?? profile,
          competencyLevel: competencyAttr?.stringValue ?? null,
          parameters,
          checkpoints: checkpoints.map((cp) => ({
            key: cp.key,
            status: cp.stringValue ?? "PENDING",
            score: cp.numberValue,
          })),
        },
      });
    }
    // Skills path matched the profile but produced zero rows — fall
    // through to module-mastery in case the course actually scores there.
  }

  // ── Branch 2: module-mastery trajectory (#953) ──
  // Fires when the skills path is empty / not applicable AND the caller
  // has CallerModuleProgress rows. Common for courses whose authored
  // module catalogue (config.modules) drives scoring (IELTS Speaking,
  // language exam prep, etc.).
  if (playbookId) {
    const moduleProgress = await prisma.callerModuleProgress.findMany({
      where: { callerId },
      select: {
        moduleId: true,
        status: true,
        mastery: true,
        callCount: true,
        startedAt: true,
        completedAt: true,
        updatedAt: true,
        module: { select: { id: true, slug: true, label: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Authored-module labels from playbook config so we can match the
    // module catalogue's order even when CallerModuleProgress rows came
    // in out of sequence.
    const authoredModules =
      Array.isArray(playbookConfig?.modules)
        ? (playbookConfig?.modules as Array<{ id: string; label?: string }>)
        : [];
    const orderBySlug = new Map<string, number>(
      authoredModules.map((m, i) => [m.id, i]),
    );

    if (moduleProgress.length > 0) {
      // Roll up per-LO mastery from CallerAttribute so each module entry
      // can surface a list of LO scores (the IELTS-equivalent of the
      // skills branch's parameters).
      const masteryAttrs = await prisma.callerAttribute.findMany({
        where: {
          callerId,
          key: { contains: ":lo_mastery:" },
          validUntil: null,
        },
        select: { key: true, numberValue: true, updatedAt: true },
      });
      const losByModuleSlug = new Map<
        string,
        Array<{ loRef: string; mastery: number; updatedAt: string }>
      >();
      for (const a of masteryAttrs) {
        const match = a.key.match(LO_MASTERY_KEY_RE);
        if (!match) continue;
        const moduleSlug = match[1];
        const loRef = match[2];
        if (!losByModuleSlug.has(moduleSlug)) losByModuleSlug.set(moduleSlug, []);
        losByModuleSlug.get(moduleSlug)!.push({
          loRef,
          mastery: a.numberValue ?? 0,
          updatedAt: a.updatedAt.toISOString(),
        });
      }

      const modules = moduleProgress
        .map((mp) => {
          const slug = mp.module?.slug ?? null;
          const los = slug ? losByModuleSlug.get(slug) ?? [] : [];
          return {
            moduleId: mp.module?.id ?? mp.moduleId,
            slug,
            label: mp.module?.label ?? slug ?? mp.moduleId.slice(0, 8),
            status: mp.status,
            mastery: mp.mastery,
            callCount: mp.callCount,
            startedAt: mp.startedAt?.toISOString() ?? null,
            completedAt: mp.completedAt?.toISOString() ?? null,
            updatedAt: mp.updatedAt.toISOString(),
            learningOutcomes: los.sort((a, b) => a.loRef.localeCompare(b.loRef)),
          };
        })
        .sort((a, b) => {
          // Authored-module order first; then alpha by slug for anything
          // off-catalogue (shouldn't happen, but defensive).
          const oa = a.slug ? orderBySlug.get(a.slug) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
          const ob = b.slug ? orderBySlug.get(b.slug) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
          if (oa !== ob) return oa - ob;
          return (a.slug ?? "").localeCompare(b.slug ?? "");
        });

      return NextResponse.json({
        ok: true,
        data: {
          kind: "module-mastery" as const,
          playbookId,
          playbookName,
          modules,
        },
      });
    }
  }

  // No data path applies.
  return NextResponse.json({ ok: true, data: null });
}
