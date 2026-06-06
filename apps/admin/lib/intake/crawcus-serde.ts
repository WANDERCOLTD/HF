// #1182 Phase 2b-prep — IntakeSpec.body ↔ CrawcusSpec JSON serde.
//
// The Phase 2a IntakeSpec.body stores a JSON-serialisable representation
// of a spec — field descriptors, invariant descriptors, readiness-rule
// descriptors. It is NOT a literal runtime CrawcusSpec because that
// interface has `readiness: (ctx) => boolean` (a function), which JSON
// cannot represent.
//
// HF's intended materialisation flow (TBD at tarball-day integration):
//
//   IntakeSpec.body (JSON descriptors)
//     -> structural cast for editor display (this file)
//     -> hydrate into runtime CrawcusSpec when actually evaluated
//        (deferred until @tallyseal/admin-editor reveals what shape the
//        editor consumes — descriptor-only or runtime-callable)
//
// Until then this serde is a thin pair: cast on read, JSON.stringify on
// write. The contract test for spec-store-adapter exercises this round
// trip against the Phase 2a seed shape. When admin-editor lands and we
// learn whether the editor needs callable functions (readiness, custom
// reducers) or just inspects the descriptors, the hydration step lands
// here.
//
// Spec source of truth: lib/intake/spec-store.ts:9-11 (body shape doc).
// Type source: @tallyseal/crawcus-spec@0.11.0 dist/index.d.ts:2012.

import type { CrawcusSpec } from "@tallyseal/crawcus-spec";
import type { EditableSpec } from "@tallyseal/spec-emitter";
import type { Prisma } from "@prisma/client";

// SpecLiteralValue is not exported from @tallyseal/spec-emitter; access
// via indexed access on EditableSpec.key (which is typed as the same
// discriminated union).
type SpecLiteralValue = EditableSpec["key"];

/**
 * Deserialise a stored IntakeSpec body into a CrawcusSpec for editor
 * consumption. The body is structurally a CrawcusSpec descriptor; this
 * function casts it as such. Runtime function fields (readiness,
 * customReducer) are NOT hydrated here — calling them will throw or
 * return undefined-shaped results until tarball-day materialisation.
 */
export function deserialiseBody(body: Prisma.JsonValue | null): CrawcusSpec | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  // Structural cast. The body's `readiness` is a JSON descriptor (e.g.
  // `{ kind: "all-required" }`) not a function. The editor (TBD) either
  // inspects descriptors only or invokes a hydration helper. Tracking
  // for tarball-day integration.
  // TODO(phase-2b-integration): replace cast with materialisation once
  // @tallyseal/admin-editor reveals which CrawcusSpec fields are invoked
  // vs inspected. See #1182.
  return body as unknown as CrawcusSpec;
}

/**
 * Serialise a CrawcusSpec (or any editor-edited spec shape) into the
 * Prisma JSON value stored in IntakeSpec.body. CrawcusSpec is a
 * JSON-serialisable interface per the @tallyseal/crawcus-spec types
 * (function fields like `readiness` would NOT serialise; this serde
 * assumes the caller passes a descriptor-shaped value).
 *
 * Returns Prisma.JsonValue (the IntakeSpec.body declared column type)
 * to match the spec-store helpers' input shape; the cast to
 * InputJsonValue happens inside spec-store at the prisma.* boundary.
 */
export function serialiseSpec(spec: CrawcusSpec): Prisma.JsonValue {
  // JSON-stringify-then-parse forces structural fidelity: any function
  // properties on `spec` (readiness, customReducer) drop out, leaving
  // only the JSON descriptors. This protects the DB from accidentally
  // attempting to persist a non-serialisable value.
  return JSON.parse(JSON.stringify(spec)) as Prisma.JsonValue;
}

/**
 * #1140 Phase 2c — project an EditableSpec (parsed from source by
 * @tallyseal/spec-emitter) to the IntakeSpec.body JSON cache shape.
 *
 * The body shape is the list-page read surface: `fieldCount` reads
 * `Object.keys(body.fields).length` in spec-store.ts::toSummary.
 * EditableSpec carries `fields: readonly EditableField[]` (array
 * with `.name`); body carries `fields: Record<name, descriptor>`.
 * This helper bridges the two so saveSpecAction can re-derive the
 * cache on every save, keeping fieldCount + status / projection /
 * key / version coherent with the saved source.
 *
 * Contract details the editor doesn't structurally model (opaque
 * suffix, contracts, extraSpecProperties) are NOT projected into
 * the cache — the body is a read-cache for surface metadata, not
 * a hydrated runtime spec. The canonical source-of-truth remains
 * the `source` column.
 */
export function projectBodyFromEditable(
  spec: EditableSpec,
): Prisma.JsonValue {
  const fields: Record<string, Prisma.JsonValue> = {};
  for (const f of spec.fields) {
    const descriptor: Record<string, Prisma.JsonValue> = {
      type: f.base,
      required: f.required,
    };
    if (f.enumOptions !== undefined) {
      descriptor.enumSource = f.enumOptions.source;
    }
    fields[f.name] = descriptor;
  }
  return {
    key: literalToString(spec.key),
    version: spec.version,
    projection: literalToString(spec.projection),
    fields,
    contracts: { invariants: [] },
    readiness: {
      kind: spec.readiness.kind === "template" ? "all-required" : "opaque",
    },
  };
}

function literalToString(value: SpecLiteralValue): string {
  if (value.kind === "string") return value.value;
  if (value.kind === "identifier") return value.name;
  return value.source;
}
