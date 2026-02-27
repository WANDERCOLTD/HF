# Plan: TP ↔ Session Assignment Editor

> **Current:** AI assigns TPs to sessions via learningOutcomeRefs, badge shows count only.
> **Goal:** Educators see per-session TP lists and can drag/move TPs between sessions.

---

## Understanding

### How It Works Today

1. **Lesson plan** is stored as JSON in `Curriculum.deliveryConfig.lessonPlan.entries[]`
2. Each `LessonPlanEntry` has `learningOutcomeRefs[]` and `assertionCount` (a number), but **no `assertionIds[]`**
3. At **runtime**, `teaching-content.ts` transform filters `ContentAssertion` rows by matching session `learningOutcomeRefs` — indirect, no explicit TP-session binding
4. **LessonPlanStep** in the wizard shows session cards with SortableList for reorder, click-to-edit label/type, TP count badge — but never shows actual TPs
5. **Course detail page** (`/x/courses/[courseId]`) has a Content tab grouped by teachMethod — no per-session view

### Key Constraint

TPs only exist when content was uploaded and extracted. Goals-only courses have no assertions to show. So the TP-session editor only activates when `contentMode === "pack"` and assertions are in the DB.

---

## Data Model Change

**No Prisma migration.** The lesson plan is JSON inside `deliveryConfig`.

Add optional `assertionIds` to `LessonPlanEntry`:

```ts
// In LessonPlanStep types + route types
interface LessonPlanEntry {
  session: number;
  type: string;
  moduleId: string | null;
  moduleLabel: string;
  label: string;
  // ... existing fields ...
  assertionIds?: string[];  // NEW: explicit TP-to-session binding
}
```

**Backward compatible:** if `assertionIds` is absent, runtime falls back to `learningOutcomeRef` matching (existing behaviour).

---

## API

### New: `GET /api/curricula/:curriculumId/session-assertions`

Returns assertions grouped by session number, using the lesson plan's `assertionIds` (if set) or `learningOutcomeRefs` (fallback).

```
Response: {
  ok: true,
  sessions: {
    [sessionNumber: number]: {
      session: number,
      label: string,
      type: string,
      assertions: Array<{
        id: string,
        assertion: string,       // truncated to ~120 chars
        category: string,
        teachMethod: string | null,
        learningOutcomeRef: string | null,
        topicSlug: string | null,
        depth: number | null,
      }>
    }
  },
  unassigned: Array<...>,  // TPs that don't match any session
  total: number,
}
```

**Logic:**
1. Load lesson plan from `deliveryConfig`
2. Load all `ContentAssertion` for the curriculum's subject (`PlaybookSubject` -> `SubjectSource` -> `ContentAssertion`)
3. For each session entry:
   - If `assertionIds` exists -> use those (explicit binding)
   - Else -> match via `learningOutcomeRefs` (existing logic from `teaching-content.ts`)
4. Collect unmatched assertions into `unassigned`

**Auth:** `requireAuth("VIEWER")`

### Existing: `PUT /api/curricula/:curriculumId/lesson-plan`

Already accepts entries. Just needs to pass through `assertionIds` in the save logic (currently strips unknown fields — update the map function).

---

## UI: LessonPlanStep (Wizard) — Phase 1

### When TPs Are Available

Only when `contentMode === "pack"` AND assertions exist for the linked subject. The step already detects this (shows Knowledge Map when content is available). Add a fetch to `/api/curricula/:curriculumId/session-assertions` after the plan is generated and `curriculumId` is set.

### Session Card Expansion

Currently, clicking a session card's chevron expands **phases** (Hook, Direct Instruction, etc.). Add a second expandable section below phases: **Teaching Points**.

```
+---------------------------------------------------------+
| grip  3  book Introduce  Temperature Control  8 TPs  >  |
|                                                          |
|   +- Phases ----------------------------------------+   |
|   | Hook (3m) . Key Concepts (12m) . Check (5m)     |   |
|   +--------------------------------------------------+   |
|                                                          |
|   +- Teaching Points --------------------------------+   |
|   |  fact   The danger zone is 8-63C          [S v]  |   |
|   |  rule   Food must reach 75C core temp     [S v]  |   |
|   |  fact   Bacteria double every 20 minutes  [S v]  |   |
|   |  defn   Cross-contamination: transfer...  [S v]  |   |
|   |  proc   4-stage cooling process           [S v]  |   |
|   |                            + 3 more              |   |
|   +--------------------------------------------------+   |
+---------------------------------------------------------+
```

### `[S v]` — Move-to-Session Dropdown

Each TP row has a small session picker dropdown:
- Lists all sessions by number + short label
- Selecting a different session moves the TP
- Updates `assertionIds` on both source and target entries
- Live update — no separate save needed (writes to wizard data bag)

### Unassigned TPs Section

Below the session list, if any TPs don't belong to a session:

```
+- Unassigned Teaching Points -----------------  3 TPs -+
|  fact   Organic certification requires annual...      |
|  rule   Allergen labelling (Natasha's Law)            |
|  defn   HACCP: Hazard Analysis and Critical...        |
|                                                       |
|  [Auto-assign]                                        |
+-------------------------------------------------------+
```

**Auto-assign** button: assigns to the session whose `learningOutcomeRefs` best match the TP's `learningOutcomeRef` (deterministic, no AI call needed).

### States

| State | What shows |
|-------|-----------|
| No content (goals-only) | TP section hidden entirely |
| Content uploaded, extraction in progress | "Teaching points loading..." shimmer |
| Content extracted, TPs available | Full TP list per session |
| Empty session (no TPs match) | "No teaching points assigned" with subtle hint |
| All TPs assigned | Unassigned section hidden |

---

## UI: Course Detail Page — Phase 2 (New "Lessons" Tab)

### Tab Addition

Add a **Lessons** tab to the existing `DraggableTabs` on the course detail page, between Content and Classrooms.

### Layout

```
+-----------------------------------------------------------+
| Overview  Content  Lessons  Classrooms  Students  Settings|
+-----------------------------------------------------------+
|                                                            |
|  12 sessions . Direct Instruction           [Edit Plan]    |
|                                                            |
|  +- 1 . Onboarding . Welcome & Background ----------+     |
|  |  (no teaching points -- onboarding session)       |     |
|  +---------------------------------------------------+     |
|                                                            |
|  +- 2 . Introduce . Temperature Control --- 8 TPs v -+    |
|  |                                                    |    |
|  |  fact  The danger zone is 8-63C            [> v]   |    |
|  |  rule  Food must reach 75C core temp       [> v]   |    |
|  |  fact  Bacteria double every 20 minutes    [> v]   |    |
|  |  defn  Cross-contamination: transfer...    [> v]   |    |
|  |  + 4 more                                          |    |
|  +----------------------------------------------------+    |
|                                                            |
|  +- 3 . Introduce . Food Storage --------- 12 TPs v -+    |
|  |  ...                                               |    |
|  +----------------------------------------------------+    |
|                                                            |
|  +- Unassigned ----------------------------- 3 TPs ---+    |
|  |  ...                              [Auto-assign]    |    |
|  +----------------------------------------------------+    |
|                                                            |
|  [Save Changes]                                            |
+-----------------------------------------------------------+
```

### Interactions

- Accordion of sessions — click header to expand/collapse TP list
- Each TP row has `[> v]` move-to-session dropdown (same `SessionTPList` component as wizard)
- "Save Changes" button calls `PUT /api/curricula/:curriculumId/lesson-plan`
- "Edit Plan" button navigates to the course wizard lesson plan step (or opens inline editor)

### Drag-and-Drop (Phase 2b — after move-dropdown works)

- TP rows become draggable (native HTML5 DnD, consistent with SortableList)
- Session headers are drop zones — highlight on hover
- Visual: drag ghost shows category chip + truncated text
- On drop: move TP from source session to target session
- No new dependency — native HTML5 DnD matches existing SortableList pattern

### Empty State (No Lesson Plan)

```
+---------------------------------------------------+
|            book                                    |
|   No lesson plan yet                               |
|                                                    |
|   Generate a lesson plan from your content          |
|   to see sessions and teaching point assignments.   |
|                                                    |
|   [Generate Plan]                                  |
+---------------------------------------------------+
```

---

## Runtime Integration — Phase 3

### Prompt Composition Update

In `teaching-content.ts`, add a higher priority check for explicit `assertionIds`:

```ts
// NEW: Priority 0 -- explicit assertion IDs (educator-curated)
const sessionAssertionIds = context.sharedState?.lessonPlanEntry?.assertionIds;
if (sessionAssertionIds?.length) {
  const explicit = allAssertions.filter(a => sessionAssertionIds.includes(a.id));
  if (explicit.length > 0) assertions = explicit;
}

// Existing: Priority 1 -- session LO refs (AI-assigned, fallback)
const sessionLORefs = context.sharedState?.lessonPlanEntry?.learningOutcomeRefs;
// ...
```

~5-line change in one file. Fully backward compatible.

---

## Shared Component: `SessionTPList`

Extract a reusable component used by both wizard and course detail:

```ts
// components/shared/SessionTPList.tsx

type SessionTPListProps = {
  sessionNumber: number;
  assertions: TPItem[];
  sessions: { session: number; label: string }[];  // for move dropdown
  onMove: (assertionId: string, toSession: number) => void;
  maxVisible?: number;  // default 5, "show more" expands
  readonly?: boolean;
};
```

Renders:
- Category chip (fact/rule/defn/proc/exmpl) with colour from existing category config
- Truncated assertion text (~100 chars)
- TeachMethod badge (if set) — reuses existing `TEACH_METHOD_CONFIG` icons
- Move-to-session dropdown `[S v]` (hidden in readonly mode)

---

## CSS

New classes in `globals.css`:

```css
.hf-tp-row          /* TP list item: flex row, hover highlight */
.hf-tp-category     /* Category chip: small pill with colour */
.hf-tp-text         /* Assertion text: truncated, flex-1 */
.hf-tp-method       /* TeachMethod badge: small, muted */
.hf-tp-move         /* Move dropdown trigger: compact select */
.hf-tp-section      /* TP section within session card */
.hf-tp-unassigned   /* Unassigned section at bottom */
```

---

## File Changes

| File | Change |
|------|--------|
| `lib/lesson-plan/types.ts` | Add `assertionIds?: string[]` to `EnhancedLessonPlanEntry` |
| `app/api/curricula/[curriculumId]/session-assertions/route.ts` | **NEW** — GET endpoint |
| `app/api/curricula/[curriculumId]/lesson-plan/route.ts` | Pass through `assertionIds` in PUT save |
| `app/api/courses/generate-plan/route.ts` | Add `assertionIds` to LessonPlanEntry type |
| `components/shared/SessionTPList.tsx` | **NEW** — reusable TP list with move |
| `app/x/courses/components/steps/LessonPlanStep.tsx` | Fetch session assertions, expand TPs in cards, move dropdown |
| `app/x/courses/[courseId]/page.tsx` | Add "Lessons" tab with session-TP view |
| `lib/prompt/composition/transforms/teaching-content.ts` | Prefer `assertionIds` over LO-ref matching |
| `app/globals.css` | New `hf-tp-*` classes |

---

## Implementation Order

1. **Types** — Add `assertionIds` to `EnhancedLessonPlanEntry` type
2. **API** — `GET /api/curricula/:id/session-assertions` endpoint
3. **API** — Update PUT to persist `assertionIds`
4. **CSS** — Add `hf-tp-*` classes to globals.css
5. **Component** — `SessionTPList` shared component
6. **Wizard** — Integrate into LessonPlanStep (expand + move)
7. **Course Detail** — Add Lessons tab
8. **Runtime** — Update teaching-content transform
9. **DnD** — (Optional Phase 2b) Add cross-session drag

---

## Plan Guards

1. **Dead-ends:** PASS — assertionIds flow from UI -> API -> JSON storage -> runtime prompt composition
2. **Forever spinners:** PASS — session-assertions fetch has loading/error/empty states per session + global
3. **API dead ends:** PASS — new GET called by LessonPlanStep + Lessons tab; PUT already has callers
4. **Routes good:** PASS — new route uses `requireAuth("VIEWER")` for GET
5. **Escape routes:** PASS — move dropdown is dismissible, expand/collapse is toggle, no modals
6. **Gold UI:** PASS — uses `hf-*` classes, category chips use existing pattern, no inline hex
7. **Missing await:** Will verify during implementation
8. **Hardcoded slugs:** N/A — no spec slugs involved
9. **TDZ shadows:** Will verify during implementation
10. **Pipeline integrity:** PASS — teaching-content transform is the only pipeline touchpoint; existing LO-ref path preserved as fallback
11. **Seed / Migration:** PASS — no schema change (JSON field), no migration needed. Ready for `/vm-cp`
12. **API docs:** Will annotate new route with `@api` JSDoc
13. **Orphan cleanup:** Will verify during implementation

---

## Deploy

Ready for **`/vm-cp`** (no migration needed).
