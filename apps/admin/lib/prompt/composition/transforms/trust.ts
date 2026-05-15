/**
 * Content Trust & Source Authority Transform
 *
 * Builds trust context for the LLM prompt:
 * 1. Reads sourceAuthority from the active CONTENT spec
 * 2. Generates CONTENT AUTHORITY header with source declarations
 * 3. Builds reference card for current module's content
 * 4. Checks freshness / validity of content
 *
 * Contract: CONTENT_TRUST_V1
 */

import { registerTransform } from "../TransformRegistry";
import type { AssembledContext } from "../types";
import { getTrustSettings, TRUST_DEFAULTS } from "@/lib/system-settings";

// Trust level display labels and weights (from CONTENT_TRUST_V1 contract)
// Defaults here, overridden at runtime by getTrustSettings()
const TRUST_LEVELS: Record<string, { label: string; weight: number; level: number }> = {
  REGULATORY_STANDARD: { label: "Regulatory Standard", weight: TRUST_DEFAULTS.weightL5Regulatory, level: 5 },
  ACCREDITED_MATERIAL: { label: "Accredited Material", weight: TRUST_DEFAULTS.weightL4Accredited, level: 4 },
  PUBLISHED_REFERENCE: { label: "Published Reference", weight: TRUST_DEFAULTS.weightL3Published, level: 3 },
  EXPERT_CURATED: { label: "Expert Curated", weight: TRUST_DEFAULTS.weightL2Expert, level: 2 },
  AI_ASSISTED: { label: "AI Assisted", weight: TRUST_DEFAULTS.weightL1AiAssisted, level: 1 },
  UNVERIFIED: { label: "Unverified", weight: TRUST_DEFAULTS.weightL0Unverified, level: 0 },
};

async function loadTrustWeights() {
  const s = await getTrustSettings();
  TRUST_LEVELS.REGULATORY_STANDARD.weight = s.weightL5Regulatory;
  TRUST_LEVELS.ACCREDITED_MATERIAL.weight = s.weightL4Accredited;
  TRUST_LEVELS.PUBLISHED_REFERENCE.weight = s.weightL3Published;
  TRUST_LEVELS.EXPERT_CURATED.weight = s.weightL2Expert;
  TRUST_LEVELS.AI_ASSISTED.weight = s.weightL1AiAssisted;
  TRUST_LEVELS.UNVERIFIED.weight = s.weightL0Unverified;
}

// Preload trust weights from system settings on module import.
// Uses cached 30s TTL — defaults apply until loaded.
loadTrustWeights().catch((e) => console.warn("[trust] Failed to preload trust weights, using defaults:", e));

interface SourceRef {
  sourceSlug: string;
  ref: string;
  trustLevel: string;
}

interface SourceDeclaration {
  slug: string;
  name: string;
  trustLevel: string;
  publisherOrg?: string;
  authors?: string[];
  edition?: string;
  publicationYear?: number;
  qualificationRef?: string;
  moduleCoverage?: string[];
}

interface FreshnessWarning {
  message: string;
  severity: "expired" | "expiring" | "info";
}

/**
 * Check if a date string is expired or expiring soon.
 */
function checkFreshness(validUntil: string | undefined, warningDays: number = 60): FreshnessWarning | null {
  if (!validUntil) return null;
  const expiry = new Date(validUntil);
  const now = new Date();
  const daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    return { message: `Content expired ${Math.abs(daysUntilExpiry)} days ago (${validUntil})`, severity: "expired" };
  }
  if (daysUntilExpiry <= warningDays) {
    return { message: `Content expires in ${daysUntilExpiry} days (${validUntil})`, severity: "expiring" };
  }
  return null;
}

/**
 * Build reference card for the current module from its sourceRefs and content.
 */
function buildReferenceCard(
  currentModule: any,
  sourceAuthority: any,
): { card: string; sourceRefs: SourceRef[] } | null {
  if (!currentModule) return null;

  const moduleContent = currentModule.content || currentModule;
  const sourceRefs: SourceRef[] = moduleContent.sourceRefs || currentModule.sourceRefs || [];

  if (sourceRefs.length === 0) return null;

  const lines: string[] = [];
  lines.push(`REFERENCE CARD (${currentModule.name || currentModule.title || currentModule.id}):`);

  // Add source attributions for this module
  for (const ref of sourceRefs) {
    const trustInfo = TRUST_LEVELS[ref.trustLevel];
    const label = trustInfo ? `[${trustInfo.label}]` : `[${ref.trustLevel}]`;
    lines.push(`  Source: ${ref.sourceSlug} ${label} — ${ref.ref}`);
  }

  return { card: lines.join("\n"), sourceRefs };
}

/**
 * Build the trust rules section for the prompt.
 */
function buildTrustRules(primarySource: SourceDeclaration | null): string {
  if (!primarySource) return "";

  const sourceName = primarySource.name || primarySource.slug;
  return [
    "TRUST RULES:",
    `1. ONLY teach facts from your certified sources. When stating specific figures, cite the source.`,
    `2. If asked about something NOT in your materials, say: "That's outside what I can verify from the ${sourceName}. I'd recommend checking the official source directly."`,
    `3. NEVER invent statistics, thresholds, or regulatory details.`,
    `4. If content may be outdated, flag it: "This information may have been updated — always verify current figures."`,
  ].join("\n");
}

/**
 * Main trust transform — registered as "computeTrustContext".
 *
 * Reads sourceAuthority from the content spec and builds the trust
 * context section for the LLM prompt.
 */
registerTransform("computeTrustContext", (
  _rawData: any,
  context: AssembledContext,
) => {
  // Build trust context from subject-based sources (primary path after ADR-002)
  const subjectData = context.loadedData.subjectSources;
  if (subjectData?.subjects?.length) {
    return buildSubjectTrustContext(subjectData);
  }
  return {
    hasTrustData: false,
    trustLevel: null,
    primarySource: null,
    secondarySources: [],
    contentAuthority: null,
    trustRules: null,
    referenceCard: null,
    freshnessWarnings: [],
  };
});

// ------------------------------------------------------------------
// Subject-based trust context (fallback when no spec sourceAuthority)
// ------------------------------------------------------------------

/**
 * Build trust context from subject-based sources.
 * Used when a domain has subjects linked but no CONTENT spec with sourceAuthority.
 */
function buildSubjectTrustContext(subjectData: { subjects: any[] }) {
  const authorityLines: string[] = [];
  const freshnessWarnings: FreshnessWarning[] = [];
  let primarySource: SourceDeclaration | null = null;
  const secondarySources: SourceDeclaration[] = [];

  authorityLines.push("## CONTENT AUTHORITY\n");

  for (const subject of subjectData.subjects) {
    authorityLines.push(`SUBJECT: ${subject.name}`);
    if (subject.qualificationRef) {
      authorityLines.push(`  Qualification: ${subject.qualificationRef}`);
    }

    // Find syllabus-tagged sources (highest authority) and content sources
    const syllabusSources = subject.sources.filter((s: any) => s.tags?.includes("syllabus"));
    const contentSources = subject.sources.filter((s: any) => !s.tags?.includes("syllabus"));

    for (const syllabus of syllabusSources) {
      const trustInfo = TRUST_LEVELS[syllabus.trustLevel];
      const label = trustInfo ? trustInfo.label.toUpperCase() : syllabus.trustLevel;
      authorityLines.push(`  PRIMARY SOURCE: ${syllabus.name} [${label}]`);
      if (syllabus.publisherOrg) authorityLines.push(`    Publisher: ${syllabus.publisherOrg}`);
      if (syllabus.accreditingBody) authorityLines.push(`    Accrediting Body: ${syllabus.accreditingBody}`);

      if (!primarySource) {
        primarySource = {
          slug: syllabus.slug,
          name: syllabus.name,
          trustLevel: syllabus.trustLevel,
          publisherOrg: syllabus.publisherOrg,
          qualificationRef: syllabus.qualificationRef,
        };
      }

      // Check freshness
      const w = checkFreshness(syllabus.validUntil?.toISOString?.() || syllabus.validUntil);
      if (w) freshnessWarnings.push({ ...w, message: `"${syllabus.name}": ${w.message}` });
    }

    for (const src of contentSources) {
      const trustInfo = TRUST_LEVELS[src.trustLevel];
      const label = trustInfo ? trustInfo.label.toUpperCase() : src.trustLevel;
      const tagLabel = (src.tags || []).map((t: string) => t.toUpperCase()).join("/") || "CONTENT";
      authorityLines.push(`  ${tagLabel}: ${src.name} [${label}]`);

      secondarySources.push({
        slug: src.slug,
        name: src.name,
        trustLevel: src.trustLevel,
        publisherOrg: src.publisherOrg,
        qualificationRef: src.qualificationRef,
      });

      const w = checkFreshness(src.validUntil?.toISOString?.() || src.validUntil);
      if (w) freshnessWarnings.push({ ...w, message: `"${src.name}": ${w.message}` });
    }

    // Include curriculum modules summary if available.
    //
    // Source-of-truth precedence (mirrors #364):
    //   1. Relational CurriculumModule rows (populated by the projection
    //      layer, #338). The loader now hydrates these on
    //      subject.curriculum.modules.
    //   2. Legacy Curriculum.notableInfo.modules JSON blob — kept as a
    //      fallback for seed-only / pre-projection courses.
    //
    // Without (1), every projection-created course silently dropped this
    // CURRICULUM block from the AI's CONTENT AUTHORITY section.
    const relationalModules =
      (subject.curriculum as { modules?: Array<{ id: string; slug: string; title: string; learningObjectives: Array<{ ref: string; description: string | null }> }> } | null)?.modules ?? [];
    if (relationalModules.length > 0) {
      authorityLines.push(`\n  CURRICULUM (${relationalModules.length} modules):`);
      for (const mod of relationalModules) {
        authorityLines.push(`    ${mod.slug || mod.id}: ${mod.title}`);
        const los = mod.learningObjectives;
        if (los.length > 0) {
          for (const lo of los.slice(0, 3)) {
            authorityLines.push(`      - ${lo.description || lo.ref}`);
          }
          if (los.length > 3) {
            authorityLines.push(`      ... and ${los.length - 3} more`);
          }
        }
      }
    } else if (subject.curriculum?.notableInfo?.modules) {
      const modules = subject.curriculum.notableInfo.modules;
      authorityLines.push(`\n  CURRICULUM (${modules.length} modules):`);
      for (const mod of modules) {
        authorityLines.push(`    ${mod.id}: ${mod.title}`);
        if (mod.learningOutcomes?.length) {
          for (const lo of mod.learningOutcomes.slice(0, 3)) {
            authorityLines.push(`      - ${lo}`);
          }
          if (mod.learningOutcomes.length > 3) {
            authorityLines.push(`      ... and ${mod.learningOutcomes.length - 3} more`);
          }
        }
      }
    }

    authorityLines.push(""); // blank line between subjects
  }

  // Add freshness warnings
  if (freshnessWarnings.length > 0) {
    authorityLines.push("VALIDITY WARNINGS:");
    for (const w of freshnessWarnings) {
      const icon = w.severity === "expired" ? "EXPIRED" : "EXPIRING";
      authorityLines.push(`  [${icon}] ${w.message}`);
    }
  }

  const trustRules = buildTrustRules(primarySource);
  const contentAuthority = authorityLines.join("\n");

  return {
    hasTrustData: true,
    trustLevel: primarySource?.trustLevel || subjectData.subjects[0]?.defaultTrustLevel || null,
    primarySource,
    secondarySources,
    contentAuthority,
    trustRules,
    referenceCard: null,
    referenceSourceRefs: [],
    freshnessWarnings,
  };
}
