# AI-Read Grounding Pattern

> AI proposes a factual claim → grounding tool MUST be called → only then state the fact.
>
> Sibling to [`ai-to-db-guard.md`](./ai-to-db-guard.md): that file holds the WRITE-side validate-before-execute pattern; this one holds the READ-side verify-before-claim pattern. #1444 shipped the contract; #1458 made it durable; #1447 audits the remaining AI surfaces.

## Rule: Never let AI assert facts about specific entities without a tool-call grounding in the same turn

When AI returns natural-language text that names a specific entity (a caller, course, voice, goal, etc.) and asserts something about it, **always** require a grounding tool call in the same turn — the model demonstrably looked up the data, not inferred it from page-context or a system overview.

```
AI proposes claim → Grounding tool called → Only then assert
```

## When This Applies

Any code path where:
1. AI returns natural-language text (chat reply, assistant response, narration)
2. That text mentions a specific entity by name (caller name, course title, voice id, etc.)
3. The text asserts an attribute / state / relationship about the entity (enrollment, voice config, progress, goal completion, parameter scores)

Most acutely: DATA / COURSE_MANAGE / BUG mode in `app/api/chat/route.ts` and the sibling `assistant.*` route at `app/api/ai/assistant/route.ts`. Pipeline analysis routes and content-trust extraction routes share the risk class but aren't intercepted yet (#1447 epic).

## Required Checks

| AI claims | Guard must check |
|-----------|------------------|
| Caller's course / enrollment | `get_caller_detail` tool-called in same turn |
| Caller's voice config | `get_caller_detail` or `get_voice_config` tool-called |
| Caller's progress / mastery / completion | `get_caller_detail` tool-called |
| Caller's goal achievement | `get_caller_detail` tool-called |
| Caller's parameter scores | `get_caller_detail` tool-called |
| File paths cited (BUG mode) | `fs.existsSync` check on the path |

The set of grounding tools is intentionally tight — every entry is a tool that returns caller-specific data the model can legitimately quote. Add to `GROUNDING_TOOL_NAMES` in `factual-grounding-intercept.ts` only when a new tool returns directly-quotable learner-scoped state.

## Pattern: Verify-then-claim

```typescript
// BAD: AI text → direct emit
const reply = await callModel({ system, messages });
return new Response(reply.text);

// GOOD: AI text → verify grounding → emit (or replace)
const reply = await callModel({ system, messages });
const intercept = detectUngroundedLearnerClaim({
  assistantText: reply.text,
  toolUsesInTurn: reply.toolUses,
});
if (intercept.blocked) {
  log(`[grounding] ${intercept.reason}`);
  return new Response(intercept.replacementText);
}
return new Response(reply.text);
```

For BUG mode add the sibling `detectFabricatedFilePaths` check against the same response.

## Existing Guards

| Location | Guard | What it prevents |
|----------|-------|------------------|
| `app/api/chat/factual-grounding-intercept.ts` | `detectUngroundedLearnerClaim` (6 patterns: voice / enrollment / goal-completion / progress / score + caller-name-token gate) + `detectFabricatedFilePaths` (fs.existsSync against `apps/admin/<path>:<line>?` citations) | DATA / COURSE_MANAGE / BUG / assistant.* asserting learner-scoped facts (enrollment, voice fallback, progress %, goal achievement, parameter scores) or BUG-mode file citations that don't exist on disk. Pinned by `tests/api/chat-factual-grounding.test.ts` (40/40). |
| `lib/chat/page-context.ts` + `lib/chat/system-prompts.ts` | Snapshot blocks self-label as "the COURSE the operator is viewing — NOT any caller's enrollment"; `getSystemOverview()` carries the same disclaimer | Model inferring a specific learner's state from a course-scoped snapshot or the catalogue overview (the 2026-06-10 Bertie fingerprint). |
| `lib/chat/system-prompts.ts::DATA_SYSTEM_PROMPT` | "Learner-scoped facts grounding contract" section — model is told it MUST call a grounding tool before asserting any learner-scoped claim, with the `get_caller_detail` / `get_voice_config` template phrasing baked in | Prompt-level signpost; the intercept (above) is the structural backstop. |

## Known Gaps (tech debt)

- **Streaming branches across all modes** — the intercept only runs in the non-streaming tool-loop branch. Streaming requires buffering the chunk stream before emitting, which the BUG branch already does (small responses) but the CALL streaming branches still don't. (#1447 epic, Slice A.)
- **`assistant.*` route streaming** — same shape as the chat-route streaming gap. The non-streaming branch is wired; the streaming branch is not.
- **Pipeline analysis routes** — `runSpecDrivenPipeline` paths (EXTRACT, AGGREGATE, REWARD, ADAPT, SUPERVISE) emit AI-derived data into `Call.analysis*` and `CallerAttribute`. No structural grounding contract today; the `@ai-call` source-span audit (#1447 Slice B) is the prereq.
- **Content-trust extraction routes** — `lib/content-trust/extract-*` paths produce ContentAssertions from PDF/MD source. They WRITE through `validateManifest()` (ai-to-db-guard side) but the natural-language narration in their responses isn't intercepted. Same shape as the pipeline gap.
- **Other Class A routes not yet audited** — #1447 audit will enumerate. When a new chat-shaped route lands, classify it before merge (see checklist below).

## Escalation

If you're writing a new AI-read surface and can't add structural grounding, add a `// TODO(ai-read-guard):` comment explaining why and what the risk is. These are tracked by `broken-windows` agent and surface in `arch-checker` reports.

## When adding a new `@ai-call` annotation

Author checklist — must be satisfied before merge (or a TODO comment must explain why each unsatisfied item is acceptable):

1. **Classify the surface by risk** — pick one of A / B / C / D / E / F:
   - **A** — READ chat (DATA / COURSE_MANAGE / BUG / assistant.*) returning natural-language text that may mention a specific entity
   - **B** — Transcript analysis (pipeline EXTRACT / AGGREGATE / REWARD / ADAPT / SUPERVISE) producing AI-derived structured data
   - **C** — Generation draft (curriculum / lesson plan / module rebuild)
   - **D** — Source extraction (content-trust ContentAssertion writes from PDF/MD)
   - **E** — Roleplay (voice provider, learner-facing call narration)
   - **F** — Classification (group-type whitelisting, parameter routing)
2. **For Class A / B / D:** confirm a grounding contract exists in the system prompt for the surface — model is explicitly told it MUST call a grounding tool before asserting facts about a specific entity.
3. **For Class A:** confirm a post-response intercept catches the relevant claim shape — extend `detectUngroundedLearnerClaim` patterns if needed, or document why the existing patterns cover this surface.
4. **For Class A:** add a vitest that pins the intercept (mirrors `tests/api/chat-factual-grounding.test.ts`) AND a promptfoo eval (under `evals/`) that pins the model behaviour on a representative fingerprint.
5. **Document the surface** in this file's "Existing Guards" table OR add a `// TODO(ai-read-guard):` comment at the call site with rationale.

`arch-checker` (see `.claude/agents/arch-checker.md` Check G) enforces 1–5 against changed files containing a NEW `@ai-call` annotation. The build doesn't fail without it — the agent flags it for human review at PR time.
