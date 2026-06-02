// Authoring API — used when writing a CrawcusSpec module.
//
// Each HF intake flow (e.g. lib/intake/specs/enrollment.intent.ts)
// imports these to declare its fields + contracts + compliance.

export {
  defineCrawcusSpec,
  defineContract,
  defineCompliance,
  field,
} from "@tallyseal/core";
