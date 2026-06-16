/**
 * Journey controls barrel — Phase 1 of epic #1675.
 *
 * Phase 2+ imports `JourneyField` only; the 13 primitives are dispatched
 * internally. Direct imports of primitives are allowed for tests + for
 * niche Inspector renderers that need a custom shell (rare — use the
 * default `JourneyField` shell whenever possible).
 */

export { JourneyField, type JourneyFieldProps } from "./JourneyField";
export { JourneyToggle } from "./JourneyToggle";
export { JourneyText } from "./JourneyText";
export { JourneyNumber } from "./JourneyNumber";
export { JourneySlider } from "./JourneySlider";
export { JourneySelect } from "./JourneySelect";
export { JourneyMultiSelect } from "./JourneyMultiSelect";
export { JourneyDuration } from "./JourneyDuration";
export { JourneyJsonFallback } from "./JourneyJsonFallback";
export { JourneyPhases } from "./JourneyPhases";
export { JourneyTargets } from "./JourneyTargets";
export { JourneyBanding } from "./JourneyBanding";
export { JourneyVoicePicker } from "./JourneyVoicePicker";
export { JourneyStop } from "./JourneyStop";
export { JourneyMinTarget } from "./JourneyMinTarget";
export { JourneyArrayEditor } from "./JourneyArrayEditor";
