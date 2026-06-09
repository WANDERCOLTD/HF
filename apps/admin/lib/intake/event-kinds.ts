// HF custom event kinds.
//
// `@tallyseal/core` exposes `customEventKind(name)` for host-defined
// event kinds that aren't in `SYSTEM_EVENT_KINDS`. Runtime does NOT
// reject unknown `event.kind` values at write-time (the constant is
// for exhaustive TS dispatch only — see Tallyseal Ask 3 reply
// 2026-06-08), but using the branded helper guarantees:
//
//   1. `isSystemEventKind(kind) === false` — so kind dispatchers know
//      to route to a custom projection registry.
//   2. Type-level distinctness from `SystemEventKind` — accidental
//      passes to a function expecting only system kinds fail at
//      compile time.
//   3. A single canonical source for the kind string so renames stay
//      consistent across writer + reader code.
//
// Slice 1 (#1342, FailureLog) and Slice 2 (#1343, SessionEvent) of
// epic #1338 own these constants. Slice 0's Session schema (#1341)
// does not depend on them — Session is a Prisma model, not an event.

import { customEventKind } from "@tallyseal/core";
import type { CustomEventKind } from "@tallyseal/core";

/**
 * Failure log event. Recorded when a sim/voice/intake session fails
 * before producing a transcript. Owned by Slice 1 (#1342).
 */
export const FAILURE_LOG: CustomEventKind = customEventKind("FailureLog");

/**
 * Generic session event for Slice 2 onwards. Wraps session-lifecycle
 * transitions (started, ended, abandoned) for the chained event log.
 */
export const SESSION_EVENT: CustomEventKind = customEventKind("SessionEvent");
