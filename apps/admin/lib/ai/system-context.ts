/**
 * System Context Provider for AI
 *
 * Provides centralized system knowledge that ALL AI calls should have access to.
 * This includes specs, parameters, active callers, recent activity, etc.
 *
 * Usage:
 *   const context = await getSystemContext(['specs', 'parameters']);
 *   const systemPrompt = injectContext(basePrompt, context);
 */

import { prisma } from "@/lib/prisma";

// ============================================================================
// CONTEXT TYPES
// ============================================================================

export interface SystemContextOptions {
  /** Which context modules to include */
  modules?: ContextModule[];
  /** Maximum items per module (to avoid context bloat) */
  limit?: number;
  /** Filter by domain (e.g., 'personality', 'memory') */
  domain?: string;
}

export type ContextModule =
  | "specs"           // Active analysis specs
  | "parameters"      // System parameters
  | "domains"         // Domain categories (with full details)
  | "callers"         // Recent/active callers
  | "activity"        // Recent system activity
  | "pipeline"        // Pipeline configuration
  | "knowledge"       // Knowledge base artifacts
  | "personas"        // Agent identity templates
  | "goals"           // Caller goals & progress
  | "targets"         // Behavioral targets
  | "playbooks"       // Active playbooks
  | "anchors"         // Scoring calibration examples
  | "contentSources"  // Content sources with trust levels
  | "subjects"        // Teaching subjects
  | "location";       // Page/route context (passed in)

export interface SystemContext {
  specs?: SpecContext[];
  parameters?: ParameterContext[];
  domains?: DomainContext[];
  callers?: CallerContext[];
  activity?: ActivityContext;
  pipeline?: PipelineContext;
  knowledge?: KnowledgeContext[];
  personas?: PersonaContext[];
  goals?: GoalContext[];
  targets?: TargetContext[];
  playbooks?: PlaybookContext[];
  anchors?: AnchorContext[];
  contentSources?: ContentSourceContext[];
  subjects?: SubjectContext[];
  location?: LocationContext;
}

interface SpecContext {
  id: string;
  slug: string;
  name: string;
  description?: string;
  type: string;
  role: string;
  output: string;
  domain?: string;
}

interface ParameterContext {
  id: string;
  name: string;
  domain: string;
  type: string;
  adjustable: boolean;
}

interface DomainContext {
  id: string;
  slug: string;
  name: string;
  description?: string;
  isDefault: boolean;
  hasPublishedPlaybook: boolean;
  callerCount: number;
  onboardingConfigured: boolean;
}

interface CallerContext {
  id: string;
  name: string | null;
  lastCallAt?: Date;
  totalCalls: number;
}

interface ActivityContext {
  recentCalls: number;
  activeSpecs: number;
  totalCallers: number;
}

interface PipelineContext {
  stages: string[];
  activeSpecsByStage: Record<string, number>;
}

interface KnowledgeContext {
  id: string;
  title: string;
  type: string; // 'curriculum', 'document', etc.
  domain?: string;
  chunkCount?: number;
}

interface PersonaContext {
  id: string;
  name: string;
  role: string;
  description?: string;
}

interface GoalContext {
  callerId: string;
  callerName: string | null;
  goalType: string;
  title: string;
  status: string;
  progress?: number;
}

interface TargetContext {
  parameterId: string;
  parameterName: string;
  level: string; // 'SYSTEM', 'PLAYBOOK', 'CALLER'
  targetValue: number;
}

interface PlaybookContext {
  id: string;
  name: string;
  isActive: boolean;
  itemCount: number;
}

interface AnchorContext {
  parameterId: string;
  parameterName: string;
  score: number;
  example: string;
  isGold: boolean;
}

interface ContentSourceContext {
  id: string;
  slug: string;
  name: string;
  trustLevel: string;
  assertionCount: number;
  publisherOrg?: string;
  accreditingBody?: string;
  qualificationRef?: string;
  isExpired: boolean;
}

interface SubjectContext {
  id: string;
  slug: string;
  name: string;
  qualificationRef?: string;
  domains: string[];
  sourceCount: number;
}

export interface LocationContext {
  page: string;           // Current page/route
  section?: string;       // Section within page
  entityType?: string;    // 'caller', 'spec', 'parameter', etc.
  entityId?: string;      // ID of entity being viewed
  action?: string;        // 'create', 'edit', 'view', etc.
  context?: Record<string, any>; // Arbitrary context data
}

// ============================================================================
// CONTEXT LOADERS
// ============================================================================

async function loadSpecsContext(
  limit = 50,
  domain?: string
): Promise<SpecContext[]> {
  const specs = await prisma.analysisSpec.findMany({
    where: {
      isActive: true,
      ...(domain && { domain }),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      specType: true,
      specRole: true,
      outputType: true,
      domain: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return specs.map((spec) => ({
    id: spec.id,
    slug: spec.slug,
    name: spec.name,
    description: spec.description?.substring(0, 150),
    type: spec.specType,
    role: spec.specRole,
    output: spec.outputType,
    domain: spec.domain || undefined,
  }));
}

async function loadParametersContext(
  limit = 100,
  domain?: string
): Promise<ParameterContext[]> {
  const params = await prisma.parameter.findMany({
    where: {
      ...(domain && { domainGroup: domain }),
    },
    select: {
      parameterId: true,
      name: true,
      domainGroup: true,
      parameterType: true,
      isAdjustable: true,
    },
    orderBy: { domainGroup: "asc" },
    take: limit,
  });

  return params.map((p) => ({
    id: p.parameterId,
    name: p.name,
    domain: p.domainGroup,
    type: p.parameterType,
    adjustable: p.isAdjustable,
  }));
}

async function loadDomainsContext(): Promise<DomainContext[]> {
  const domains = await prisma.domain.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { callers: true } },
      playbooks: {
        where: { status: "PUBLISHED" },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
    take: 30,
  });

  return domains.map((d) => ({
    id: d.id,
    slug: d.slug,
    name: d.name,
    description: d.description?.substring(0, 150) || undefined,
    isDefault: d.isDefault,
    hasPublishedPlaybook: d.playbooks.length > 0,
    callerCount: d._count.callers,
    onboardingConfigured: !!(d.onboardingIdentitySpecId && d.onboardingFlowPhases),
  }));
}

async function loadCallersContext(limit = 20): Promise<CallerContext[]> {
  const callers = await prisma.caller.findMany({
    select: {
      id: true,
      name: true,
      calls: {
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: {
        select: { calls: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return callers.map((c) => ({
    id: c.id,
    name: c.name ?? null,
    lastCallAt: c.calls[0]?.createdAt,
    totalCalls: c._count.calls,
  }));
}

async function loadActivityContext(): Promise<ActivityContext> {
  const [recentCalls, activeSpecs, totalCallers] = await Promise.all([
    prisma.call.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.analysisSpec.count({ where: { isActive: true } }),
    prisma.caller.count(),
  ]);

  return {
    recentCalls,
    activeSpecs,
    totalCallers,
  };
}

async function loadPipelineContext(): Promise<PipelineContext> {
  // Get active specs grouped by outputType
  const specsByOutput = await prisma.analysisSpec.groupBy({
    by: ["outputType"],
    where: { isActive: true },
    _count: true,
  });

  const activeSpecsByStage: Record<string, number> = {};
  specsByOutput.forEach((group) => {
    activeSpecsByStage[group.outputType] = group._count;
  });

  return {
    stages: ["MEASURE", "LEARN", "ADAPT", "COMPOSE", "AGGREGATE", "REWARD"],
    activeSpecsByStage,
  };
}

async function loadKnowledgeContext(): Promise<KnowledgeContext[]> {
  // KnowledgeArtifact model was removed from the schema — return empty until
  // a replacement knowledge model is introduced.
  return [];
}

async function loadPersonasContext(): Promise<PersonaContext[]> {
  // Personas are defined in specs with specRole = IDENTITY
  const identitySpecs = await prisma.analysisSpec.findMany({
    where: {
      isActive: true,
      specRole: "IDENTITY",
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
    },
    take: 10,
  });

  return identitySpecs.map((spec) => ({
    id: spec.id,
    name: spec.name,
    role: spec.slug,
    description: spec.description?.substring(0, 150),
  }));
}

async function loadGoalsContext(limit = 20): Promise<GoalContext[]> {
  const goals = await prisma.goal.findMany({
    where: {
      status: "ACTIVE",
    },
    select: {
      caller: {
        select: {
          id: true,
          name: true,
        },
      },
      type: true,
      name: true,
      status: true,
      progress: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return goals.map((g) => ({
    callerId: g.caller.id,
    callerName: g.caller.name ?? null,
    goalType: g.type,
    title: g.name,
    status: g.status,
    progress: g.progress || undefined,
  }));
}

async function loadTargetsContext(limit = 30): Promise<TargetContext[]> {
  const targets = await prisma.behaviorTarget.findMany({
    select: {
      parameter: {
        select: {
          parameterId: true,
          name: true,
        },
      },
      scope: true,
      targetValue: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return targets.map((t) => ({
    parameterId: t.parameter.parameterId,
    parameterName: t.parameter.name,
    level: t.scope,
    targetValue: t.targetValue,
  }));
}

async function loadPlaybooksContext(): Promise<PlaybookContext[]> {
  const playbooks = await prisma.playbook.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      _count: {
        select: { items: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return playbooks.map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.status === "PUBLISHED",
    itemCount: p._count.items,
  }));
}

async function loadAnchorsContext(limit = 30): Promise<AnchorContext[]> {
  const anchors = await prisma.parameterScoringAnchor.findMany({
    select: {
      parameter: {
        select: {
          parameterId: true,
          name: true,
        },
      },
      score: true,
      example: true,
      isGold: true,
    },
    where: {
      isGold: true, // Only load gold standard examples
    },
    orderBy: { score: "desc" },
    take: limit,
  });

  return anchors.map((a) => ({
    parameterId: a.parameter.parameterId,
    parameterName: a.parameter.name,
    score: a.score,
    example: a.example.substring(0, 100),
    isGold: a.isGold,
  }));
}

async function loadContentSourcesContext(limit = 50): Promise<ContentSourceContext[]> {
  const sources = await prisma.contentSource.findMany({
    where: { isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      trustLevel: true,
      publisherOrg: true,
      accreditingBody: true,
      accreditationRef: true,
      validUntil: true,
      _count: { select: { assertions: true } },
    },
    orderBy: { name: "asc" },
    take: limit,
  });

  return sources.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    trustLevel: s.trustLevel,
    assertionCount: s._count.assertions,
    publisherOrg: s.publisherOrg || undefined,
    accreditingBody: s.accreditingBody || undefined,
    qualificationRef: s.accreditationRef || undefined,
    isExpired: s.validUntil ? new Date(s.validUntil) < new Date() : false,
  }));
}

async function loadSubjectsContext(limit = 30): Promise<SubjectContext[]> {
  // Subject model may not be in generated client yet — gracefully handle
  try {
    const subjects = await (prisma as any).subject.findMany({
      where: { isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        qualificationRef: true,
        domains: {
          select: { domain: { select: { name: true } } },
        },
        sources: { select: { sourceId: true } },
      },
      orderBy: { name: "asc" },
      take: limit,
    });

    return subjects.map((s: any) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      qualificationRef: s.qualificationRef || undefined,
      domains: s.domains.map((d: any) => d.domain.name),
      sourceCount: s.sources.length,
    }));
  } catch {
    // Subject model not yet in generated client — return empty
    return [];
  }
}

// ============================================================================
// MAIN CONTEXT LOADER
// ============================================================================

/**
 * Load system context for AI calls.
 * Only loads requested modules to keep context size manageable.
 */
export async function getSystemContext(
  options: SystemContextOptions = {}
): Promise<SystemContext> {
  const { modules = ["specs"], limit = 50, domain } = options;

  const context: SystemContext = {};

  // Load requested modules in parallel
  const loaders: Promise<void>[] = [];

  if (modules.includes("specs")) {
    loaders.push(
      loadSpecsContext(limit, domain).then((data) => {
        context.specs = data;
      })
    );
  }

  if (modules.includes("parameters")) {
    loaders.push(
      loadParametersContext(limit, domain).then((data) => {
        context.parameters = data;
      })
    );
  }

  if (modules.includes("domains")) {
    loaders.push(
      loadDomainsContext().then((data) => {
        context.domains = data;
      })
    );
  }

  if (modules.includes("callers")) {
    loaders.push(
      loadCallersContext(20).then((data) => {
        context.callers = data;
      })
    );
  }

  if (modules.includes("activity")) {
    loaders.push(
      loadActivityContext().then((data) => {
        context.activity = data;
      })
    );
  }

  if (modules.includes("pipeline")) {
    loaders.push(
      loadPipelineContext().then((data) => {
        context.pipeline = data;
      })
    );
  }

  if (modules.includes("knowledge")) {
    loaders.push(
      loadKnowledgeContext().then((data) => {
        context.knowledge = data;
      })
    );
  }

  if (modules.includes("personas")) {
    loaders.push(
      loadPersonasContext().then((data) => {
        context.personas = data;
      })
    );
  }

  if (modules.includes("goals")) {
    loaders.push(
      loadGoalsContext(20).then((data) => {
        context.goals = data;
      })
    );
  }

  if (modules.includes("targets")) {
    loaders.push(
      loadTargetsContext(30).then((data) => {
        context.targets = data;
      })
    );
  }

  if (modules.includes("playbooks")) {
    loaders.push(
      loadPlaybooksContext().then((data) => {
        context.playbooks = data;
      })
    );
  }

  if (modules.includes("anchors")) {
    loaders.push(
      loadAnchorsContext(30).then((data) => {
        context.anchors = data;
      })
    );
  }

  if (modules.includes("contentSources")) {
    loaders.push(
      loadContentSourcesContext(limit).then((data) => {
        context.contentSources = data;
      })
    );
  }

  if (modules.includes("subjects")) {
    loaders.push(
      loadSubjectsContext(limit).then((data) => {
        context.subjects = data;
      })
    );
  }

  // Location context is passed in, not loaded
  // It will be set by the caller if needed

  await Promise.all(loaders);

  return context;
}

// ============================================================================
// CONTEXT INJECTION
// ============================================================================

/**
 * Inject system context into a prompt.
 * Replaces {systemContext} placeholder with formatted context.
 */
export function injectSystemContext(
  prompt: string,
  context: SystemContext
): string {
  let contextText = "\n## System Context\n\n";

  if (context.specs) {
    contextText += `### Active Specs (${context.specs.length})\n`;
    context.specs.forEach((spec) => {
      contextText += `- **${spec.name}** (${spec.slug})\n`;
      contextText += `  Type: ${spec.type} | Role: ${spec.role} | Output: ${spec.output}`;
      if (spec.domain) contextText += ` | Domain: ${spec.domain}`;
      contextText += "\n";
      if (spec.description) contextText += `  ${spec.description}\n`;
    });
    contextText += "\n";
  }

  if (context.parameters) {
    contextText += `### Parameters (${context.parameters.length})\n`;
    const byDomain = new Map<string, ParameterContext[]>();
    context.parameters.forEach((p) => {
      const list = byDomain.get(p.domain) || [];
      list.push(p);
      byDomain.set(p.domain, list);
    });
    byDomain.forEach((params, domain) => {
      contextText += `**${domain}**: ${params.map((p) => p.name).join(", ")}\n`;
    });
    contextText += "\n";
  }

  if (context.domains) {
    contextText += `### Domains (${context.domains.length})\n`;
    context.domains.forEach((d) => {
      contextText += `- **${d.name}** (${d.slug})`;
      if (d.isDefault) contextText += " [DEFAULT]";
      contextText += ` — ${d.callerCount} callers`;
      contextText += d.hasPublishedPlaybook ? ", published" : ", no playbook";
      contextText += d.onboardingConfigured ? ", onboarding ready" : "";
      contextText += "\n";
      if (d.description) contextText += `  ${d.description}\n`;
    });
    contextText += "\n";
  }

  if (context.activity) {
    contextText += `### Recent Activity\n`;
    contextText += `- Calls (24h): ${context.activity.recentCalls}\n`;
    contextText += `- Active Specs: ${context.activity.activeSpecs}\n`;
    contextText += `- Total Callers: ${context.activity.totalCallers}\n\n`;
  }

  if (context.pipeline) {
    contextText += `### Pipeline Stages\n`;
    context.pipeline.stages.forEach((stage) => {
      const count = context.pipeline!.activeSpecsByStage[stage] || 0;
      contextText += `- ${stage}: ${count} active specs\n`;
    });
    contextText += "\n";
  }

  if (context.knowledge) {
    contextText += `### Knowledge Base (${context.knowledge.length})\n`;
    context.knowledge.forEach((k) => {
      contextText += `- **${k.title}** (${k.type})`;
      if (k.domain) contextText += ` - ${k.domain}`;
      if (k.chunkCount) contextText += ` - ${k.chunkCount} chunks`;
      contextText += "\n";
    });
    contextText += "\n";
  }

  if (context.personas) {
    contextText += `### Agent Personas (${context.personas.length})\n`;
    context.personas.forEach((p) => {
      contextText += `- **${p.name}** (${p.role})\n`;
      if (p.description) contextText += `  ${p.description}\n`;
    });
    contextText += "\n";
  }

  if (context.goals) {
    contextText += `### Active Goals (${context.goals.length})\n`;
    const byType = new Map<string, GoalContext[]>();
    context.goals.forEach((g) => {
      const list = byType.get(g.goalType) || [];
      list.push(g);
      byType.set(g.goalType, list);
    });
    byType.forEach((goals, type) => {
      contextText += `**${type}**: ${goals.length} active\n`;
    });
    contextText += "\n";
  }

  if (context.targets) {
    contextText += `### Behavioral Targets (${context.targets.length})\n`;
    const byLevel = new Map<string, TargetContext[]>();
    context.targets.forEach((t) => {
      const list = byLevel.get(t.level) || [];
      list.push(t);
      byLevel.set(t.level, list);
    });
    byLevel.forEach((targets, level) => {
      contextText += `**${level}**: ${targets.map((t) => `${t.parameterName}=${t.targetValue}`).join(", ")}\n`;
    });
    contextText += "\n";
  }

  if (context.playbooks) {
    contextText += `### Playbooks (${context.playbooks.length})\n`;
    context.playbooks.forEach((p) => {
      contextText += `- ${p.name}: ${p.itemCount} items`;
      contextText += p.isActive ? " (active)\n" : " (inactive)\n";
    });
    contextText += "\n";
  }

  if (context.anchors) {
    contextText += `### Scoring Examples (${context.anchors.length} gold standards)\n`;
    const byParam = new Map<string, AnchorContext[]>();
    context.anchors.forEach((a) => {
      const list = byParam.get(a.parameterName) || [];
      list.push(a);
      byParam.set(a.parameterName, list);
    });
    byParam.forEach((anchors, param) => {
      contextText += `**${param}**: ${anchors.length} examples\n`;
    });
    contextText += "\n";
  }

  if (context.contentSources) {
    contextText += `### Content Sources (${context.contentSources.length})\n`;
    context.contentSources.forEach((s) => {
      contextText += `- **${s.name}** (${s.slug}) — Trust: ${s.trustLevel}`;
      if (s.publisherOrg) contextText += ` | Publisher: ${s.publisherOrg}`;
      if (s.accreditingBody) contextText += ` | Accredited: ${s.accreditingBody}`;
      if (s.qualificationRef) contextText += ` | Qual: ${s.qualificationRef}`;
      contextText += ` | ${s.assertionCount} assertions`;
      if (s.isExpired) contextText += " [EXPIRED]";
      contextText += "\n";
    });
    contextText += "\n";
  }

  if (context.subjects) {
    contextText += `### Subjects (${context.subjects.length})\n`;
    context.subjects.forEach((s) => {
      contextText += `- **${s.name}** (${s.slug})`;
      if (s.qualificationRef) contextText += ` — ${s.qualificationRef}`;
      if (s.domains.length > 0) contextText += ` | Domains: ${s.domains.join(", ")}`;
      contextText += ` | ${s.sourceCount} source(s)`;
      contextText += "\n";
    });
    contextText += "\n";
  }

  if (context.location) {
    contextText += `### Current Location\n`;
    contextText += `- Page: ${context.location.page}\n`;
    if (context.location.section) contextText += `- Section: ${context.location.section}\n`;
    if (context.location.entityType) contextText += `- Viewing: ${context.location.entityType}`;
    if (context.location.entityId) contextText += ` (${context.location.entityId})`;
    contextText += "\n";
    if (context.location.action) contextText += `- Action: ${context.location.action}\n`;
    contextText += "\n";
  }

  return prompt.replace("{systemContext}", contextText);
}

// ============================================================================
// PRESET CONFIGURATIONS
// ============================================================================

/**
 * Preset context configurations for common call points.
 */
export const CONTEXT_PRESETS: Record<string, SystemContextOptions> = {
  "spec.assistant": {
    modules: ["specs", "domains", "parameters", "anchors"],
    limit: 50,
  },
  "spec.view": {
    modules: ["specs", "parameters", "domains", "anchors", "pipeline"],
    limit: 50,
  },
  "pipeline.measure": {
    modules: ["specs", "parameters", "anchors"],
    limit: 30,
  },
  "pipeline.compose": {
    modules: ["specs", "parameters", "callers", "personas", "targets", "playbooks"],
    limit: 30,
  },
  "pipeline.adapt": {
    modules: ["specs", "parameters", "targets", "callers"],
    limit: 30,
  },
  "bdd.parse": {
    modules: ["specs", "parameters", "domains"],
    limit: 50,
  },
  "parameter.enrich": {
    modules: ["parameters", "domains", "knowledge", "anchors"],
    limit: 100,
  },
  "chat.stream": {
    modules: ["personas", "knowledge", "goals", "callers"],
    limit: 20,
  },
  "goal.suggest": {
    modules: ["goals", "knowledge", "callers", "domains"],
    limit: 30,
  },
  "workflow.classify": {
    modules: ["specs", "domains", "parameters", "playbooks", "personas", "callers", "contentSources", "subjects"],
    limit: 50,
  },
  "workflow.step": {
    modules: ["specs", "domains", "parameters", "playbooks", "contentSources"],
    limit: 30,
  },
  default: {
    modules: ["specs"],
    limit: 30,
  },
};

/**
 * Get system context using preset configuration for a call point.
 */
export async function getContextForCallPoint(
  callPoint: string
): Promise<SystemContext> {
  const preset = CONTEXT_PRESETS[callPoint] || CONTEXT_PRESETS.default;
  return getSystemContext(preset);
}
