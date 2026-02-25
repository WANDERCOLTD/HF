export interface CommunityMember {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  createdAt: string;
}

export interface CommunityConfig {
  communityKind?: 'TOPIC_BASED' | 'OPEN_CONNECTION';
  hubPattern?: string;
}

export interface CommunityDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  config: CommunityConfig | null;
  onboardingWelcome: string | null;
  onboardingIdentitySpecId: string | null;
  onboardingFlowPhases: unknown;
  onboardingDefaultTargets: unknown;
  memberCount: number;
  playbookCount: number;
  personaName: string;
  identitySpec: { id: string; slug: string; name: string } | null;
  identitySpecs: Array<{ id: string; slug: string; name: string }>;
  members: CommunityMember[];
}
