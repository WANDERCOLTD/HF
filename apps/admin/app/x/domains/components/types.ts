// Shared types for domains page components

export type InstitutionTypeInfo = {
  id: string;
  slug: string;
  name: string;
  defaultArchetypeSlug?: string | null;
};

export type InstitutionInfo = {
  id: string;
  name: string;
  type?: InstitutionTypeInfo | null;
};

export type DomainListItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  callerCount: number;
  playbookCount: number;
  publishedPlaybook: {
    id: string;
    name: string;
    version: string;
    publishedAt: string;
  } | null;
  institution?: InstitutionInfo | null;
};

export type Caller = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  createdAt: string;
  _count: { calls: number };
};

export type Playbook = {
  id: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: string;
  sortOrder: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  domain?: { id: string; name: string };
  _count?: { items: number; enrollments?: number };
};

export type SubjectSourceItem = {
  id: string;
  tags: string[];
  sortOrder: number;
  source: {
    id: string;
    slug: string;
    name: string;
    trustLevel: string;
    documentType?: string;
    _count: { assertions: number };
  };
};

export type SubjectItem = {
  subject: {
    id: string;
    slug: string;
    name: string;
    qualificationRef?: string | null;
    sources: SubjectSourceItem[];
    _count: { sources: number };
  };
};

export type DomainDetail = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  callers: Caller[];
  playbooks: Playbook[];
  subjects?: SubjectItem[];
  institution?: InstitutionInfo | null;
  onboardingWelcome?: string | null;
  onboardingIdentitySpec?: {
    id: string;
    slug: string;
    name: string;
  } | null;
  onboardingFlowPhases?: any;
  onboardingDefaultTargets?: any;
  lessonPlanDefaults?: Record<string, unknown> | null;
  _count: {
    callers: number;
    playbooks: number;
    subjects?: number;
  };
};
