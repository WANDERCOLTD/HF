# AI-to-DB Guard Pattern

## Rule: Never let AI output directly drive entity creation

When AI returns structured data that will be used to create, update, or delete database records, **always** insert a deterministic validation step between the AI response and the DB write.

```
AI proposes → Guard validates → Code executes
```

## When This Applies

Any code path where:
1. AI returns JSON/structured output (tool calls, classification, grouping, scoring)
2. That output determines **how many** records to create, **what type** of entity, or **which parent** to attach to
3. The code iterates the AI output and calls `prisma.*.create` / `update` / `delete`

## Required Checks

| AI decides | Guard must check |
|-----------|-----------------|
| How many entities to create | Max count cap (not just in prompt — enforce in code) |
| Entity type / classification | Whitelist validation with fallback |
| Parent-child relationships | FK exists in DB before write |
| Parameter/key names | Validate against known set from DB |
| Destructive operations (delete + rebuild) | Wrap in transaction, validate new data before deleting old |

## Pattern: Validate-then-write

```typescript
// BAD: AI output → direct DB write
for (const group of aiResult.groups) {
  await prisma.subject.create({ data: { name: group.name } });
}

// GOOD: AI output → validate → DB write
const { validated, fixes } = validateManifest(aiResult);
console.log(`[guard] Applied ${fixes.length} fix(es)`);
for (const group of validated.groups) {
  await prisma.subject.create({ data: { name: group.name } });
}
```

## Existing Guards

| Location | Guard | What it prevents |
|----------|-------|-----------------|
| `lib/content-trust/validate-manifest.ts` | `validateManifest()` | AI creating too many subjects, promoting pedagogy to subjects |
| Pipeline `callScore` | Numeric clamping `[0, 1]` | Score overflow |
| Pipeline `callTarget` | `validateTargets()` guardrail pass | Target value outside safe range |
| `generate-groups` | `validateGroupType()` whitelist | Invalid group type enum |

## Known Gaps (tech debt)

- `structure-assertions.ts`: deleteMany + rebuild without transaction — AI tree error = data loss
- `extract-curriculum.ts`: no max-module-count enforcement in code (only in prompt)
- Pipeline `parameterId`: FK constraint is only guard — no pre-filter against known params
- `callerMemory.create`: no count limit per call, no key/value length cap

## Escalation

If you're writing a new AI-to-DB path and can't add a structural guard, add a `// TODO(ai-guard):` comment explaining why and what the risk is. These are tracked by `broken-windows` agent.
