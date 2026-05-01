/**
 * Session Flow resolver — single source of truth for "what stops and phases
 * apply to this learner's journey?"
 *
 * Reads the canonical `Playbook.config.sessionFlow` shape if present.
 * Falls back to legacy fields (`welcome` / `surveys` / `assessment` / `nps` /
 * `onboardingFlowPhases`) during the dual-read window. Phase 5 of epic #221
 * removes the legacy paths.
 *
 * Phase 1 (#216) only adds the resolver. Phase 2 (#217) wires it into
 * composition transforms behind the SESSION_FLOW_RESOLVER_ENABLED flag.
 *
 * @see docs/decisions/2026-04-29-session-flow-canonical-model.md
 */
import type {
  PlaybookConfig,
  SessionFlowConfig,
  SessionFlowResolved,
  IntakeConfig,
  JourneyStop,
  OnboardingFlowPhases,
  OffboardingConfig,
  NpsConfig,
} from "@/lib/types/json-fields";
import {
  DEFAULT_INTAKE_CONFIG,
  DEFAULT_OFFBOARDING_CONFIG,
  DEFAULT_NPS_CONFIG,
} from "@/lib/types/json-fields";
import { isPreSurveyEnabled } from "@/lib/learner/survey-config";

interface DomainLike {
  slug?: string | null;
  onboardingFlowPhases?: unknown;
  onboardingWelcome?: string | null;
}

interface PlaybookLike {
  name?: string | null;
  welcomeMessage?: string | null;
  config?: PlaybookConfig | null;
}

interface OnboardingSpecLike {
  config?: { firstCallFlow?: OnboardingFlowPhases } | null;
}

export interface ResolveSessionFlowInput {
  playbook: PlaybookLike | null | undefined;
  domain?: DomainLike | null;
  /** INIT-001 spec fallback for first-call structure */
  onboardingSpec?: OnboardingSpecLike | null;
}

/**
 * Resolve a complete SessionFlow for a course. Always returns a fully
 * populated shape — defaults applied at every layer.
 */
export function resolveSessionFlow(input: ResolveSessionFlowInput): SessionFlowResolved {
  const pbConfig: PlaybookConfig = (input.playbook?.config ?? {}) as PlaybookConfig;
  const sf: SessionFlowConfig = pbConfig.sessionFlow ?? {};

  const intake = resolveIntake(sf, pbConfig);
  const onboarding = resolveOnboarding(sf, pbConfig, input.domain, input.onboardingSpec);
  const stops = resolveStops(sf, pbConfig, intake.value);
  const offboarding = resolveOffboarding(sf, pbConfig);
  const welcomeMessage = resolveWelcomeMessage(input.playbook, input.domain);

  return {
    intake: intake.value,
    onboarding: onboarding.value,
    stops: stops.value,
    offboarding: offboarding.value,
    welcomeMessage: welcomeMessage.value,
    source: {
      intake: intake.source,
      onboarding: onboarding.source,
      stops: stops.source,
      offboarding: offboarding.source,
      welcomeMessage: welcomeMessage.source,
    },
  };
}

// ---------------------------------------------------------------------------
// Intake — controls what AI asks during onboarding
// New shape: sessionFlow.intake
// Legacy:    config.welcome (delegated to isPreSurveyEnabled for activation)
// ---------------------------------------------------------------------------

function resolveIntake(
  sf: SessionFlowConfig,
  pbConfig: PlaybookConfig,
): { value: IntakeConfig; source: SessionFlowResolved["source"]["intake"] } {
  if (sf.intake) {
    return { value: { ...DEFAULT_INTAKE_CONFIG, ...sf.intake }, source: "new-shape" };
  }
  const w = pbConfig.welcome;
  if (w) {
    return {
      value: {
        goals: { enabled: w.goals?.enabled ?? DEFAULT_INTAKE_CONFIG.goals.enabled },
        aboutYou: { enabled: w.aboutYou?.enabled ?? DEFAULT_INTAKE_CONFIG.aboutYou.enabled },
        knowledgeCheck: {
          enabled: w.knowledgeCheck?.enabled ?? DEFAULT_INTAKE_CONFIG.knowledgeCheck.enabled,
          deliveryMode: DEFAULT_INTAKE_CONFIG.knowledgeCheck.deliveryMode,
        },
        aiIntroCall: { enabled: w.aiIntroCall?.enabled ?? DEFAULT_INTAKE_CONFIG.aiIntroCall.enabled },
      },
      source: "legacy-welcome",
    };
  }
  return { value: { ...DEFAULT_INTAKE_CONFIG }, source: "defaults" };
}

// ---------------------------------------------------------------------------
// Onboarding — first-call structural template
// Priority: sessionFlow.onboarding > playbook.onboardingFlowPhases >
//           domain.onboardingFlowPhases > INIT-001 spec
// ---------------------------------------------------------------------------

/**
 * Normalize legacy onboardingFlowPhases values to the canonical
 * `{ phases: [...] }` shape. Legacy data stores the raw array on
 * Domain.onboardingFlowPhases (and occasionally on playbook config) — this
 * caused undefined-access crashes in SessionFlowEditor when the resolver
 * passed the raw array through unwrapped.
 *
 * Returns null when input is not coercible.
 */
function normalizeOnboardingFlowPhases(
  raw: unknown,
): OnboardingFlowPhases | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return { phases: raw as OnboardingFlowPhases["phases"] };
  }
  if (typeof raw === "object" && Array.isArray((raw as { phases?: unknown }).phases)) {
    return raw as OnboardingFlowPhases;
  }
  return null;
}

function resolveOnboarding(
  sf: SessionFlowConfig,
  pbConfig: PlaybookConfig,
  domain: DomainLike | null | undefined,
  onboardingSpec: OnboardingSpecLike | null | undefined,
): { value: OnboardingFlowPhases; source: SessionFlowResolved["source"]["onboarding"] } {
  // Truthy-object check (not phase-length) matches the legacy cascade
  // `playbookFlow || domainFlow || initFlow` in pedagogy.ts. Required for
  // byte-equal output during dual-read window.
  if (sf.onboarding) {
    return {
      value: { phases: sf.onboarding.phases ?? [] },
      source: "new-shape",
    };
  }
  const playbookNormalized = normalizeOnboardingFlowPhases(pbConfig.onboardingFlowPhases);
  if (playbookNormalized) {
    return { value: playbookNormalized, source: "playbook-legacy" };
  }
  const domainNormalized = normalizeOnboardingFlowPhases(domain?.onboardingFlowPhases);
  if (domainNormalized) {
    return { value: domainNormalized, source: "domain" };
  }
  const initFlow = normalizeOnboardingFlowPhases(onboardingSpec?.config?.firstCallFlow);
  if (initFlow) {
    return { value: initFlow, source: "init001" };
  }
  return { value: { phases: [] }, source: "init001" };
}

// ---------------------------------------------------------------------------
// Stops — pre-test, mid-test, post-test, NPS, etc.
// Three-source precedence for pre-test:
//   sessionFlow.stops > welcome.knowledgeCheck > assessment.preTest
// (Tech Lead review found pre-test is configurable in three places during
// dual-read; resolver enforces deterministic precedence.)
// ---------------------------------------------------------------------------

function resolveStops(
  sf: SessionFlowConfig,
  pbConfig: PlaybookConfig,
  intake: IntakeConfig,
): { value: JourneyStop[]; source: SessionFlowResolved["source"]["stops"] } {
  if (sf.stops?.length) {
    return { value: sf.stops, source: "new-shape" };
  }
  return { value: synthesizeStopsFromLegacy(pbConfig, intake), source: "synthesized-from-legacy" };
}

/**
 * Build a JourneyStop[] from legacy field shapes so transforms can read
 * one model regardless of source. Used only when sessionFlow.stops is empty.
 *
 * The resolved IntakeConfig is consulted so the Knowledge Check
 * deliveryMode (mcq | socratic) gates whether the MCQ pre-test stop
 * is created — Socratic-only courses skip the MCQ batch (#222).
 */
function synthesizeStopsFromLegacy(
  pbConfig: PlaybookConfig,
  intake: IntakeConfig,
): JourneyStop[] {
  const stops: JourneyStop[] = [];

  // Pre-test — three-source precedence after sessionFlow.stops:
  //   sessionFlow.intake > welcome.knowledgeCheck > assessment.preTest
  // (matches the legacy `welcomeKc ?? assessmentPre ?? false` semantics:
  // an explicit `false` from welcome is respected, not overridden by
  // legacy assessment.preTest.)
  // Knowledge Check deliveryMode (mcq | socratic) gates the MCQ batch.
  // Socratic mode means the probe lives in the in-call discovery phase,
  // not as a separate MCQ stop.
  const hasIntakeSource =
    pbConfig.sessionFlow?.intake !== undefined
    || pbConfig.welcome !== undefined;
  const preTestEnabled = hasIntakeSource
    ? intake.knowledgeCheck.enabled
    : (pbConfig.assessment?.preTest?.enabled ?? false);
  const deliveryMode = intake.knowledgeCheck.deliveryMode ?? "mcq";
  if (preTestEnabled && deliveryMode === "mcq") {
    const count = pbConfig.assessment?.preTest?.questionCount ?? 5;
    stops.push({
      id: "pre-test",
      kind: "assessment",
      trigger: { type: "after_session", index: 1 },
      delivery: { mode: "either" },
      payload: { source: "mcq-pool", count },
      enabled: true,
    });
  }

  // Post-test — pairs with pre-test for uplift measurement.
  const postTestEnabled = pbConfig.assessment?.postTest?.enabled
    ?? pbConfig.surveys?.post?.enabled
    ?? false;
  if (postTestEnabled) {
    stops.push({
      id: "post-test",
      kind: "assessment",
      trigger: { type: "course_complete" },
      delivery: { mode: "either" },
      payload: { source: "mcq-pool", count: 5 },
      enabled: true,
    });
  }

  // NPS — fires on mastery threshold or session count.
  const nps: NpsConfig = { ...DEFAULT_NPS_CONFIG, ...pbConfig.nps };
  if (nps.enabled) {
    stops.push({
      id: "nps",
      kind: "nps",
      trigger: nps.trigger === "session_count"
        ? { type: "session_count", count: nps.threshold }
        : { type: "mastery_reached", threshold: nps.threshold },
      delivery: { mode: "either" },
      enabled: true,
    });
  }

  return stops;
}

// ---------------------------------------------------------------------------
// Offboarding — end-of-course wrap-up.
// NOTE: Domain has no `offboarding` field — fallback chain skips domain.
// ---------------------------------------------------------------------------

function resolveOffboarding(
  sf: SessionFlowConfig,
  pbConfig: PlaybookConfig,
): { value: OffboardingConfig; source: SessionFlowResolved["source"]["offboarding"] } {
  if (sf.offboarding) {
    return { value: { ...DEFAULT_OFFBOARDING_CONFIG, ...sf.offboarding }, source: "new-shape" };
  }
  if (pbConfig.offboarding) {
    return { value: { ...DEFAULT_OFFBOARDING_CONFIG, ...pbConfig.offboarding }, source: "playbook-legacy" };
  }
  return { value: { ...DEFAULT_OFFBOARDING_CONFIG }, source: "defaults" };
}

// ---------------------------------------------------------------------------
// Welcome message — first-line greeting cascade.
// Priority: playbook.welcomeMessage > domain.onboardingWelcome > generic (null)
// ---------------------------------------------------------------------------

function resolveWelcomeMessage(
  playbook: PlaybookLike | null | undefined,
  domain: DomainLike | null | undefined,
): { value: string | null; source: SessionFlowResolved["source"]["welcomeMessage"] } {
  const pbMsg = playbook?.welcomeMessage ?? playbook?.config?.welcomeMessage;
  if (pbMsg) return { value: pbMsg, source: "playbook" };
  if (domain?.onboardingWelcome) return { value: domain.onboardingWelcome, source: "domain" };
  return { value: null, source: "generic" };
}

// ---------------------------------------------------------------------------
// Convenience — re-export isPreSurveyEnabled so callers have one import path.
// (Resolver does NOT re-implement the cascade; it delegates per #216 AC.)
// ---------------------------------------------------------------------------
export { isPreSurveyEnabled };
