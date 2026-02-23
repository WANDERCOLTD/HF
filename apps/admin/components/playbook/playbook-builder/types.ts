// Shared types for PlaybookBuilder and its sub-components

export type ScoringAnchor = {
  id: string;
  score: number;
  example: string;
  rationale: string | null;
  positiveSignals: string[];
  negativeSignals: string[];
  isGold: boolean;
};

export type ParameterInfo = {
  parameterId: string;
  name: string;
  definition?: string;
  scaleType: string;
  interpretationHigh?: string;
  interpretationLow?: string;
  scoringAnchors: ScoringAnchor[];
};

export type AnalysisAction = {
  id: string;
  description: string;
  weight: number;
  parameterId: string | null;
  parameter: ParameterInfo | null;
  learnCategory: string | null;
  learnKeyPrefix: string | null;
  learnKeyHint: string | null;
};

export type AnalysisTrigger = {
  id: string;
  name: string | null;
  given: string;
  when: string;
  then: string;
  actions: AnalysisAction[];
};

export type SpecDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: "CALLER" | "DOMAIN" | "SYSTEM";
  specType: "SYSTEM" | "DOMAIN";
  outputType: "LEARN" | "MEASURE" | "ADAPT" | "COMPOSE" | "MEASURE_AGENT" | "AGGREGATE" | "REWARD" | "SUPERVISE";
  specRole: "ORCHESTRATE" | "EXTRACT" | "SYNTHESISE" | "CONSTRAIN" | "OBSERVE" | "IDENTITY" | "CONTENT" | "VOICE" | "MEASURE" | "ADAPT" | "REWARD" | "GUARDRAIL" | "BOOTSTRAP";
  domain: string | null;
  priority: number;
  isActive: boolean;
  version: string;
  promptTemplate?: string | null;
  triggers?: AnalysisTrigger[];
  _count?: { triggers: number };
};

export type Spec = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: "CALLER" | "DOMAIN" | "SYSTEM";
  specType: "SYSTEM" | "DOMAIN";
  outputType: "LEARN" | "MEASURE" | "ADAPT" | "COMPOSE" | "MEASURE_AGENT" | "AGGREGATE" | "REWARD" | "SUPERVISE";
  specRole: "ORCHESTRATE" | "EXTRACT" | "SYNTHESISE" | "CONSTRAIN" | "OBSERVE" | "IDENTITY" | "CONTENT" | "VOICE" | "MEASURE" | "ADAPT" | "REWARD" | "GUARDRAIL" | "BOOTSTRAP";
  domain: string | null;
  priority: number;
  isActive?: boolean;
  config?: Record<string, any> | null;
  _count?: { triggers: number };
};

export type PromptTemplateItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  version?: string;
};

export type PlaybookItem = {
  id: string;
  itemType: "SPEC" | "PROMPT_TEMPLATE";
  specId: string | null;
  promptTemplateId: string | null;
  spec: Spec | null;
  promptTemplate: PromptTemplateItem | null;
  isEnabled: boolean;
  sortOrder: number;
};

export type Domain = {
  id: string;
  slug: string;
  name: string;
};

export type Agent = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  scope: "SYSTEM" | "DOMAIN";
};

export type Curriculum = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
};

export type PlaybookSystemSpec = {
  id: string;
  specId: string;
  isEnabled: boolean;
  configOverride: any | null;
  spec: Spec;
};

export type Playbook = {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: string;
  publishedAt: string | null;
  domain: Domain;
  agent: Agent | null;
  curriculum: Curriculum | null;
  items: PlaybookItem[];
  systemSpecs: PlaybookSystemSpec[];
  _count: { items: number };
};

export type AvailableItems = {
  callerSpecs: Spec[]; // Deprecated - always empty, kept for API compatibility
  domainSpecs: Spec[];
  systemSpecs: Spec[];
  promptTemplates: PromptTemplateItem[];
};

export type BehaviorParameter = {
  parameterId: string;
  name: string;
  definition: string | null;
  domainGroup: string | null;
  systemValue: number | null;
  systemSource: string | null;
  playbookValue: number | null;
  playbookTargetId: string | null;
  effectiveValue: number;
  effectiveScope: string;
};

export type TargetsData = {
  parameters: BehaviorParameter[];
  counts: {
    total: number;
    withPlaybookOverride: number;
    withSystemDefault: number;
  };
};

export type PlaybookBuilderProps = {
  playbookId: string;
  routePrefix?: string;
};

// Triggers tab types
export type TriggerAction = {
  id: string;
  description: string;
  weight: number;
  parameterId: string | null;
  parameterName: string | null;
  learnCategory: string | null;
  learnKeyPrefix: string | null;
  learnKeyHint: string | null;
};

export type TriggerItem = {
  id: string;
  name: string | null;
  given: string;
  when: string;
  then: string;
  actions: TriggerAction[];
};

export type TriggerSpec = {
  specId: string;
  specSlug: string;
  specName: string;
  specType: string;
  outputType: string;
  triggers: TriggerItem[];
};

export type TriggerCategory = {
  outputType: string;
  icon: string;
  description: string;
  specs: TriggerSpec[];
};

export type TriggersData = {
  categories: TriggerCategory[];
  counts: {
    specs: number;
    triggers: number;
    actions: number;
    outputTypes: number;
  };
};
