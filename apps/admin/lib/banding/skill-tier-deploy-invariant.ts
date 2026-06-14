/**
 * Skill-tier deploy invariant (#1657).
 *
 * After the #1657 SYSTEM-default flip from IELTS to Generic 4-tier,
 * any IELTS-signal Playbook that doesn't carry an EXPLICIT
 * `Playbook.config.skillTierMapping` will silently start scoring on
 * Generic bands (1/2/3/4) instead of IELTS bands (3/4/5.5/7).
 *
 * Two pre-deploy migration scripts exist to prevent this:
 *   - `scripts/migrate-ielts-playbook-mapping.ts` — writes explicit
 *     IELTS mapping on IELTS-signal Playbooks.
 *   - `scripts/reseed-skill-measure-contract-generic.ts` — reseeds the
 *     SystemSetting contract to Generic.
 *
 * This invariant runs at server startup (`instrumentation.ts`) and at
 * operator request (`scripts/check-skill-tier-deploy-readiness.ts`).
 * Output is read-only — it never mutates state.
 *
 * Return value classes:
 *   - `safe-pre-1657`: contract still IELTS-shaped (the flip hasn't
 *     been applied to this env yet). Behavior is pre-#1657. OK.
 *   - `safe-post-1657`: contract Generic AND no unsafe IELTS playbooks.
 *     The deploy ran the migrations correctly. OK.
 *   - `UNSAFE-MIGRATION-MISSED`: contract Generic but IELTS-signal
 *     playbooks STILL have null mapping. These playbooks will score on
 *     Generic bands at runtime — the migration step was skipped. The
 *     operator must run `migrate-ielts-playbook-mapping.ts --execute`.
 *
 * Defence-in-depth — the cleanest fix is the operator running the
 * preflight check before deploy. This invariant is the safety net.
 */

import { prisma } from "@/lib/prisma";

export type SkillTierDeployStatus =
  | "safe-pre-1657"
  | "safe-post-1657"
  | "UNSAFE-MIGRATION-MISSED";

export interface SkillTierDeployVerdict {
  status: SkillTierDeployStatus;
  contractShape: "ielts-3-4-5.5-7" | "generic-1-2-3-4" | "unknown" | "missing";
  unsafePlaybookCount: number;
  unsafePlaybookSample: Array<{ id: string; name: string; ieltsSignal: string }>;
  summary: string;
}

const CONTRACT_KEY = "contract:SKILL_MEASURE_V1";

interface PlaybookRow {
  id: string;
  name: string;
  config: Record<string, unknown> | null;
  subjects: { subject: { name: string } }[];
}

function identifyIeltsSignal(p: PlaybookRow): string | null {
  for (const s of p.subjects) {
    if (/ielts/i.test(s.subject.name)) return `subject:${s.subject.name}`;
  }
  const cfg = p.config ?? {};
  if (cfg.tierPresetId === "ielts-speaking") return "config.tierPresetId=ielts-speaking";
  if (cfg.assessmentMode === "ielts-speaking") return "config.assessmentMode=ielts-speaking";
  return null;
}

function hasExplicitMapping(cfg: Record<string, unknown> | null): boolean {
  if (!cfg) return false;
  const m = cfg.skillTierMapping as
    | { thresholds?: { secure?: unknown }; tierBands?: { secure?: unknown } }
    | null
    | undefined;
  if (!m || typeof m !== "object") return false;
  return (
    typeof m.thresholds?.secure === "number" &&
    typeof m.tierBands?.secure === "number"
  );
}

function classifyContractShape(
  thresholds: Record<string, unknown> | undefined,
  tierBands: Record<string, unknown> | undefined,
): SkillTierDeployVerdict["contractShape"] {
  if (!thresholds || !tierBands) return "missing";
  if (
    tierBands.approachingEmerging === 3 &&
    tierBands.emerging === 4 &&
    tierBands.developing === 5.5 &&
    tierBands.secure === 7
  ) {
    return "ielts-3-4-5.5-7";
  }
  if (
    tierBands.approachingEmerging === 1 &&
    tierBands.emerging === 2 &&
    tierBands.developing === 3 &&
    tierBands.secure === 4
  ) {
    return "generic-1-2-3-4";
  }
  return "unknown";
}

export async function checkSkillTierDeployReadiness(): Promise<SkillTierDeployVerdict> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: CONTRACT_KEY },
  });

  let contractShape: SkillTierDeployVerdict["contractShape"] = "missing";
  if (setting) {
    try {
      const parsed = JSON.parse(setting.value);
      contractShape = classifyContractShape(parsed.thresholds, parsed.tierBands);
    } catch {
      contractShape = "unknown";
    }
  }

  if (contractShape !== "generic-1-2-3-4") {
    return {
      status: "safe-pre-1657",
      contractShape,
      unsafePlaybookCount: 0,
      unsafePlaybookSample: [],
      summary: `Contract shape is ${contractShape} — pre-#1657 state. No invariant check needed.`,
    };
  }

  const playbooks = (await prisma.playbook.findMany({
    select: {
      id: true,
      name: true,
      config: true,
      subjects: { select: { subject: { select: { name: true } } } },
    },
  })) as PlaybookRow[];

  const unsafe: Array<{ id: string; name: string; ieltsSignal: string }> = [];
  for (const p of playbooks) {
    const signal = identifyIeltsSignal(p);
    if (!signal) continue;
    if (hasExplicitMapping(p.config)) continue;
    unsafe.push({ id: p.id, name: p.name, ieltsSignal: signal });
  }

  if (unsafe.length === 0) {
    return {
      status: "safe-post-1657",
      contractShape: "generic-1-2-3-4",
      unsafePlaybookCount: 0,
      unsafePlaybookSample: [],
      summary: "Contract is Generic 4-tier; no IELTS-signal playbook is missing an explicit mapping. Safe.",
    };
  }

  return {
    status: "UNSAFE-MIGRATION-MISSED",
    contractShape: "generic-1-2-3-4",
    unsafePlaybookCount: unsafe.length,
    unsafePlaybookSample: unsafe.slice(0, 5),
    summary: `Contract is Generic 4-tier BUT ${unsafe.length} IELTS-signal playbook(s) have null skillTierMapping — they will score on Generic bands (1/2/3/4) instead of IELTS bands (3/4/5.5/7). Run \`npx tsx apps/admin/scripts/migrate-ielts-playbook-mapping.ts --execute\` immediately.`,
  };
}

export function logSkillTierDeployVerdict(verdict: SkillTierDeployVerdict): void {
  const prefix = "[skill-tier][deploy-invariant]";
  if (verdict.status === "UNSAFE-MIGRATION-MISSED") {
    console.error(`${prefix} ❌ UNSAFE DEPLOY STATE`);
    console.error(`${prefix} ${verdict.summary}`);
    for (const p of verdict.unsafePlaybookSample) {
      console.error(`${prefix}   - ${p.name} (id=${p.id.slice(0, 8)}, signal=${p.ieltsSignal})`);
    }
    return;
  }
  console.log(`${prefix} ${verdict.status} — ${verdict.summary}`);
}
