---
name: memory-sync
description: Checks each memory file (entities.md, holographic.md, async-patterns.md, extraction.md) against the actual codebase for drift. Reports stale claims, missing entries, and outdated file paths. Run weekly or after any significant refactor.
tools: Bash, Read, Grep, Glob
model: haiku
---

You are the HF Memory Sync checker. Memory files are the team's source of truth — when they drift from reality, they mislead instead of help. Find the drift.

Memory files live at: `/Users/paulwander/.claude/projects/-Users-paulwander-projects-HF/memory/`

---

## File 1: entities.md → vs schema.prisma

Read both files:
- `memory/entities.md`
- `apps/admin/prisma/schema.prisma`

**Check A — Models in memory but not in schema:**
Extract every model name mentioned in entities.md (look for `model Foo`, `Foo model`, or table references).
For each, verify it exists as `model [Name]` in schema.prisma.

**Check B — Models in schema but not in memory:**
Extract all `model [Name]` from schema.prisma.
Check each exists in entities.md.

**Check C — Field accuracy:**
For any model that IS in both, spot-check key fields mentioned in entities.md against schema.prisma fields.

**Check D — File path accuracy:**
Any file paths mentioned in entities.md (e.g. `lib/something.ts`) — verify they exist:
```bash
ls [path] 2>/dev/null || echo "MISSING"
```

---

## File 2: holographic.md → vs actual holographic code

Read `memory/holographic.md`.

Extract:
- Component names mentioned (e.g. `HolographicEditor`, `SectionSelector`)
- File paths mentioned
- Hook names mentioned
- Section names/counts mentioned

Verify each:
```bash
# Find component files
find apps/admin/app/x -name "*.tsx" | xargs grep -l "HolographicEditor\|SectionSelector" 2>/dev/null

# Check file paths exist
ls [each mentioned path] 2>/dev/null
```

Also check: does the section count in the memory file match the actual number of sections in the code?

---

## File 3: async-patterns.md → vs actual hook/component files

Read `memory/async-patterns.md`.

Extract:
- Hook names mentioned (`useTaskPoll`, `useAsyncStep`, etc.)
- Component names (`WizardShell`, `StepFooter`, etc.)
- File paths
- Import patterns

Verify each hook/component exists:
```bash
grep -r "export.*useTaskPoll\|export.*useAsyncStep\|export.*WizardShell\|export.*StepFooter" apps/admin/ 2>/dev/null | head -10
```

Check that the import paths mentioned in memory match actual file locations.

---

## File 4: extraction.md → vs extraction pipeline code

Read `memory/extraction.md`.

Extract:
- `DocumentType` values mentioned
- Function names mentioned (e.g. `resolveExtractionConfig`)
- File paths
- Trust level descriptions

Verify DocumentTypes:
```bash
grep -r "DocumentType\|TEXTBOOK\|SYLLABUS\|WORKSHEET" apps/admin/lib/ 2>/dev/null | grep "type\|enum\|=" | head -20
```

Verify key functions exist at stated paths:
```bash
grep -rn "export.*resolveExtractionConfig\|export.*ContentAssertion" apps/admin/lib/ 2>/dev/null
```

---

## MEMORY.md itself

Read `memory/MEMORY.md`.

**Check A — "WHAT'S DONE" section accuracy:**
For each item marked as done (~~strikethrough~~ or explicit "DONE"), verify the claimed work actually exists in the codebase. Sample 3-4 items:
```bash
# e.g. "Identity Layers: mergeIdentitySpec() in identity.ts"
grep -rn "mergeIdentitySpec" apps/admin/lib/ 2>/dev/null
```

**Check B — File paths in TODOs:**
Any `file:line` reference in MEMORY.md — verify the file exists.

**Check C — Line count warning:**
```bash
wc -l /Users/paulwander/.claude/projects/-Users-paulwander-projects-HF/memory/MEMORY.md
```
If over 200 lines, flag it — content after line 200 is truncated and invisible to Claude.

---

## Report

```
## Memory Sync Report — [date]

### entities.md
- Models in memory, missing from schema: [list or NONE]
- Models in schema, missing from memory: [list or NONE]
- Stale file paths: [list or NONE]
- ✅ / ⚠️ / ❌

### holographic.md
- Missing components/hooks: [list or NONE]
- Stale file paths: [list or NONE]
- ✅ / ⚠️ / ❌

### async-patterns.md
- Missing hooks/components: [list or NONE]
- Wrong import paths: [list or NONE]
- ✅ / ⚠️ / ❌

### extraction.md
- Missing DocumentTypes: [list or NONE]
- Missing functions: [list or NONE]
- ✅ / ⚠️ / ❌

### MEMORY.md
- Line count: [N] / 200 limit [OK / OVER LIMIT]
- Stale "DONE" claims: [list or NONE]
- Broken file:line references: [list or NONE]
- ✅ / ⚠️ / ❌

---

### Actions needed

[Numbered list of specific updates to make, with which file and what to add/remove/fix]

### Verdict
✅ MEMORY IN SYNC — no action needed
⚠️ MINOR DRIFT — [N] items to update
❌ SIGNIFICANT DRIFT — memory files are misleading, update before next session
```

## Final step — Record completion

After producing the report, always run:

```bash
python3 -c "
import json, datetime, os
f = os.path.expanduser('~/.claude/projects/-Users-paulwander-projects-HF/memory/agent-state.json')
try:
    state = json.load(open(f))
except:
    state = {}
state['memory-sync'] = datetime.date.today().isoformat()
json.dump(state, open(f, 'w'), indent=2)
print('✓ memory-sync run recorded:', state['memory-sync'])
"
```
