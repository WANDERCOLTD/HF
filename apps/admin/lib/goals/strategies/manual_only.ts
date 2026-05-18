/**
 * manual_only strategy (#444).
 *
 * Terminal "not yet measured" state for goals without any auto-measurement
 * path (caller-expressed ACHIEVE / CHANGE / SUPPORT / CREATE goals with no
 * ref, no contentSpec, not isAssessmentTarget).
 *
 * Returns null (no progress change). The UI is expected to surface an
 * "awaiting evidence — attach a SKILL or LO to make measurable" banner
 * for these goals. This replaces the old engagement-heuristic path
 * (transcript-length + keyword bonus) which created the 35%-with-zero-
 * mastery noise documented on Soren Guzmán's caller page.
 *
 * The wizard's validateCourseStrategies guard ensures every Goal in a
 * playbook has a non-null progressStrategy before the course can be
 * marked Ready, so the only goals that hit manual_only at runtime are
 * deliberately-not-measured ones.
 */

import { registerStrategy } from "./registry";
import type { StrategyFn } from "./types";

const manualOnlyStrategy: StrategyFn = async () => null;

registerStrategy("manual_only", manualOnlyStrategy);
