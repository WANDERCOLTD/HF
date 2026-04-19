/**
 * System Initialization Checker
 *
 * Runs 10 parallel checks to verify the system is properly configured.
 * Used by both the API endpoint (GET /api/system/ini) and the Cmd+K AI tool.
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

// ============================================================
// Types
// ============================================================

export type CheckStatus = "pass" | "warn" | "fail";
export type RagStatus = "green" | "amber" | "red";

export interface IniCheck {
  status: CheckStatus;
  label: string;
  message: string;
  severity: "critical" | "recommended" | "optional";
  remediation?: string;
  detail?: unknown;
}

export interface IniResult {
  ok: true;
  status: RagStatus;
  summary: { pass: number; warn: number; fail: number; total: number };
  checks: Record<string, IniCheck>;
  timestamp: string;
}

// ============================================================
// Main entry point
// ============================================================

export async function runIniChecks(): Promise<IniResult> {
  const settled = await Promise.allSettled([
    checkEnvVars(),
    checkDbConnectivity(),
    checkCanonicalSpecs(),
    checkDomains(),
    checkContracts(),
    checkAdminUser(),
    checkParameters(),
    checkAIServices(),
    checkVAPI(),
    checkStorage(),
  ]);

  const keys = [
    "env_vars",
    "database",
    "canonical_specs",
    "domains",
    "contracts",
    "admin_user",
    "parameters",
    "ai_services",
    "vapi",
    "storage",
  ];

  const checks: Record<string, IniCheck> = {};
  for (let i = 0; i < keys.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      checks[keys[i]] = result.value;
    } else {
      checks[keys[i]] = {
        status: "fail",
        label: keys[i],
        severity: "critical",
        message: `Check threw: ${result.reason?.message || "unknown error"}`,
      };
    }
  }

  const counts = { pass: 0, warn: 0, fail: 0 };
  // Only critical/recommended issues drive the top-level RAG indicator.
  // Optional warns (VAPI, storage) show in detail but don't degrade status.
  const ragCounts = { fail: 0, warn: 0 };
  for (const check of Object.values(checks)) {
    counts[check.status]++;
    if (check.status !== "pass" && check.severity !== "optional") {
      ragCounts[check.status]++;
    }
  }

  const ragStatus: RagStatus =
    ragCounts.fail > 0 ? "red" : ragCounts.warn > 0 ? "amber" : "green";

  return {
    ok: true,
    status: ragStatus,
    summary: { ...counts, total: counts.pass + counts.warn + counts.fail },
    checks,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================
// Individual checks
// ============================================================

async function checkEnvVars(): Promise<IniCheck> {
  const required: { name: string; present: boolean }[] = [
    { name: "DATABASE_URL", present: !!process.env.DATABASE_URL },
    { name: "HF_SUPERADMIN_TOKEN", present: !!process.env.HF_SUPERADMIN_TOKEN },
    { name: "AUTH_SECRET", present: !!process.env.AUTH_SECRET },
    { name: "NEXTAUTH_URL", present: !!process.env.NEXTAUTH_URL },
  ];

  if (process.env.NODE_ENV === "production") {
    required.push({
      name: "INTERNAL_API_SECRET",
      present: !!process.env.INTERNAL_API_SECRET,
    });
  }

  const missing = required.filter((r) => !r.present).map((r) => r.name);

  if (missing.length > 0) {
    return {
      status: "fail",
      label: "Environment Variables",
      severity: "critical",
      message: `Missing: ${missing.join(", ")}`,
      remediation:
        "Set the missing variables in .env.local (dev) or Cloud Run env (prod). See .env.example.",
      detail: required.map((r) => ({ name: r.name, set: r.present })),
    };
  }

  return {
    status: "pass",
    label: "Environment Variables",
    severity: "critical",
    message: `All ${required.length} required env vars are set`,
  };
}

async function checkDbConnectivity(): Promise<IniCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: "pass",
      label: "Database Connectivity",
      severity: "critical",
      message: "Connected — SELECT 1 succeeded",
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message.slice(0, 120) : "unknown error";
    return {
      status: "fail",
      label: "Database Connectivity",
      severity: "critical",
      message: `Connection failed: ${message}`,
      remediation:
        "Check DATABASE_URL, ensure PostgreSQL is running and accessible.",
    };
  }
}

async function checkCanonicalSpecs(): Promise<IniCheck> {
  const requiredSlugs = [
    { slug: config.specs.onboarding, label: "Onboarding" },
    { slug: config.specs.pipeline, label: "Pipeline" },
    { slug: config.specs.pipelineFallback, label: "Pipeline Fallback" },
    { slug: config.specs.compose, label: "Compose" },
    { slug: config.specs.contentExtract, label: "Content Extract" },
  ];

  const [specs, voiceSpec] = await Promise.all([
    prisma.analysisSpec.findMany({
      where: { slug: { in: requiredSlugs.map((s) => s.slug) } },
      select: { slug: true, isActive: true },
    }),
    prisma.analysisSpec.findFirst({
      where: {
        slug: { contains: config.specs.voicePattern, mode: "insensitive" },
        isActive: true,
      },
      select: { slug: true },
    }),
  ]);

  const found = new Map(specs.map((s) => [s.slug, s]));
  const issues: string[] = [];

  for (const { slug, label } of requiredSlugs) {
    const spec = found.get(slug);
    if (!spec) {
      issues.push(`${label} (${slug}): MISSING`);
    } else if (!spec.isActive) {
      issues.push(`${label} (${slug}): exists but inactive`);
    }
  }

  if (!voiceSpec) {
    issues.push(
      `Voice (pattern: "${config.specs.voicePattern}"): no matching active spec`
    );
  }

  if (issues.length > 0) {
    return {
      status: "fail",
      label: "Canonical Specs",
      severity: "critical",
      message: `${issues.length} spec issue(s)`,
      remediation:
        "Run `npm run db:seed` to seed missing specs, or activate them in the Specs UI.",
      detail: issues,
    };
  }

  return {
    status: "pass",
    label: "Canonical Specs",
    severity: "critical",
    message: "All 6 canonical specs present and active",
  };
}

async function checkDomains(): Promise<IniCheck> {
  const [domainCount, defaultDomain] = await Promise.all([
    prisma.domain.count({ where: { isActive: true } }),
    prisma.domain.findFirst({
      where: { isDefault: true },
      select: { name: true, slug: true },
    }),
  ]);

  if (domainCount === 0) {
    return {
      status: "fail",
      label: "Domains",
      severity: "recommended",
      message: "No active domains exist",
      remediation:
        "Create at least one domain via the Domains UI or run `npx tsx prisma/seed-domains.ts`.",
    };
  }

  if (!defaultDomain) {
    return {
      status: "warn",
      label: "Domains",
      severity: "recommended",
      message: `${domainCount} active domain(s) but no default domain set`,
      remediation:
        "Mark one domain as default in the Domains UI so new callers have a home.",
    };
  }

  return {
    status: "pass",
    label: "Domains",
    severity: "recommended",
    message: `${domainCount} active domain(s), default: "${defaultDomain.name}"`,
  };
}

async function checkContracts(): Promise<IniCheck> {
  const requiredContracts = [
    "CURRICULUM_PROGRESS_V1",
    "LEARNER_PROFILE_V1",
    "CONTENT_TRUST_V1",
  ];

  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: requiredContracts.map((c) => `contract:${c}`) } },
    select: { key: true },
  });

  const foundKeys = new Set(
    settings.map((s) => s.key.replace("contract:", ""))
  );
  const missing = requiredContracts.filter((c) => !foundKeys.has(c));

  if (missing.length > 0) {
    return {
      status: "fail",
      label: "Data Contracts",
      severity: "recommended",
      message: `Missing: ${missing.join(", ")}`,
      remediation:
        "Run `npm run db:seed` to load contracts from docs-archive/bdd-specs/contracts/.",
    };
  }

  return {
    status: "pass",
    label: "Data Contracts",
    severity: "recommended",
    message: `All ${requiredContracts.length} required contracts loaded`,
  };
}

async function checkAdminUser(): Promise<IniCheck> {
  const adminCount = await prisma.user.count({
    where: { role: { in: ["SUPERADMIN", "ADMIN"] } },
  });

  if (adminCount === 0) {
    return {
      status: "fail",
      label: "Admin User",
      severity: "critical",
      message: "No admin or superadmin users exist",
      remediation:
        "Create an admin user via the CLI (`npm run ctl user:create`) or seed script.",
    };
  }

  return {
    status: "pass",
    label: "Admin User",
    severity: "critical",
    message: `${adminCount} admin/superadmin user(s)`,
  };
}

async function checkParameters(): Promise<IniCheck> {
  const paramCount = await prisma.parameter.count();

  if (paramCount === 0) {
    return {
      status: "fail",
      label: "Parameters",
      severity: "critical",
      message: "No parameters defined — scoring and composition will not work",
      remediation: "Run `npm run db:seed` to import parameters from seed data.",
    };
  }

  return {
    status: "pass",
    label: "Parameters",
    severity: "critical",
    message: `${paramCount} parameters defined`,
  };
}

async function checkAIServices(): Promise<IniCheck> {
  const openaiConfigured = config.ai.openai.isConfigured;
  const claudeConfigured = config.ai.claude.isConfigured;

  if (!openaiConfigured && !claudeConfigured) {
    return {
      status: "fail",
      label: "AI Services",
      severity: "recommended",
      message: "Neither OpenAI nor Anthropic API key is set",
      remediation: "Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local.",
    };
  }

  const providers: string[] = [];
  if (openaiConfigured) providers.push(`OpenAI (${config.ai.openai.model})`);
  if (claudeConfigured) providers.push(`Anthropic (${config.ai.claude.model})`);

  return {
    status: "pass",
    label: "AI Services",
    severity: "recommended",
    message: `Configured: ${providers.join(", ")}`,
  };
}

async function checkVAPI(): Promise<IniCheck> {
  const apiKeySet = !!config.vapi.apiKey;
  const webhookSecretSet = !!config.vapi.webhookSecret;

  if (!apiKeySet && !webhookSecretSet) {
    return {
      status: "warn",
      label: "VAPI Integration",
      severity: "optional",
      message:
        "VAPI not configured (VAPI_API_KEY and VAPI_WEBHOOK_SECRET both missing)",
      remediation:
        "Set VAPI_API_KEY and VAPI_WEBHOOK_SECRET if voice calls are needed.",
    };
  }

  const issues: string[] = [];
  if (!apiKeySet) issues.push("VAPI_API_KEY missing");
  if (!webhookSecretSet) issues.push("VAPI_WEBHOOK_SECRET missing");

  if (issues.length > 0) {
    return {
      status: "warn",
      label: "VAPI Integration",
      severity: "optional",
      message: `Partial: ${issues.join(", ")}`,
      remediation:
        "Set both VAPI_API_KEY and VAPI_WEBHOOK_SECRET for full voice integration.",
    };
  }

  return {
    status: "pass",
    label: "VAPI Integration",
    severity: "optional",
    message: "Both VAPI_API_KEY and VAPI_WEBHOOK_SECRET are set",
  };
}

async function checkStorage(): Promise<IniCheck> {
  const backend = config.storage.backend;

  if (backend === "local") {
    return {
      status: "pass",
      label: "Storage",
      severity: "optional",
      message: `Backend: local (path: ${config.storage.localPath})`,
    };
  }

  const bucket = config.storage.gcsBucket;
  if (bucket === "hf-admin-prod-media" && !process.env.STORAGE_GCS_BUCKET) {
    return {
      status: "warn",
      label: "Storage",
      severity: "optional",
      message: `Backend: gcs, bucket: "${bucket}" (using default — verify this is correct)`,
      remediation: "Set STORAGE_GCS_BUCKET to your project's bucket name.",
    };
  }

  return {
    status: "pass",
    label: "Storage",
    severity: "optional",
    message: `Backend: gcs, bucket: "${bucket}"`,
  };
}
