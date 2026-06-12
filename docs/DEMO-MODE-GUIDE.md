# Demo Mode — operator guide

> Two surfaces, one icon (🎬). Both live in the Course Design Console.
> One drives a live demo; the other rehearses what to say while it runs.

Demo Mode is **two separate features that happen to share a name**:

| Surface | What it is | Where it lives | When to use |
|---|---|---|---|
| **Demo chat tab** (🎬 Demo) | A scoped 5-tool chat palette — your remote control during a live demo | Cmd+K → Assistant panel → **🎬 Demo** tab | While a prospect is watching, to tweak the course and see the change on the next call within ~30s |
| **Demo annotations** (🎬 Add demo note) | Presenter sticky notes attached to specific bubbles in the Preview transcript | Course Design Console → **Preview** lens → click "🎬 Add demo note" under any bubble | Before the demo, to rehearse what you'll say at each moment of Call 1 |

They are **independent**. You can use either without the other. The shared 🎬 clapperboard icon is the visual signal that something is "for the demo, not for the learner".

---

## Surface 1 — the Demo chat tab (🎬)

### What it is

When you open Cmd+K → the Assistant panel and switch to the **🎬 Demo** tab, the AI assistant flips into a "demo operator" stance:

- **Narrow tool surface** — five tools only (listed below). No course-creation, no caller lookup, no spec editing. The route enforces this structurally via the `DEMO_TOOLS` filter in `app/api/chat/route.ts`.
- **Scoped to demo callers** — writes only fan out to callers with `CallerPlaybook.policyMode='demo'` (the test-admin escape-hatch callers, never real learners).
- **Two-sentence answers** — the prompt instructs the model to skip prose. Tool results carry the truth; you carry the intent.

### The five tools

| Tool | Min role | What it does | When to say it |
|---|---|---|---|
| `test_voice` | SUPER_TESTER+ | Plays a short TTS sample of the course's current voice config | "Let me hear how Aura Asteria sounds saying the welcome" |
| `dry_run_prompt` | SUPER_TESTER+ | Composes the prompt that would fire on the next call, **without** persisting a Call or ComposedPrompt | "What would the prompt look like for the next call?" |
| `apply_demo_preset` | OPERATOR+ | Sets the four "good demo defaults" in one batch (see below) | "Make this course demo-ready" |
| `precompose_for_fresh_learner` | OPERATOR+ | Pre-warms a demo caller's prompt so the next live call starts instantly | "Get Bertie ready for the next demo call" |
| `open_sim` | VIEWER+ | Returns a navigation hint → `/x/sim/<callerId>` | "Let's jump into the chat" |

### The four "good demo defaults" (`apply_demo_preset`)

| Knob | Set to | Why |
|---|---|---|
| `firstCallMode` | `teach_immediately` | Skip onboarding fluff — get to the teaching fast |
| `welcome.aboutYou.enabled` | `false` | Skip the pre-call survey |
| `welcome.aiIntroCall.enabled` | `false` | Skip the AI intro call |
| `BEH-RESPONSE-LEN` | `0.2` | Short, punchy AI responses (good for a watching audience) |

The preset writes course-level config inline (`updatePlaybookConfig` with `fanoutScope: 'none'`) then surfaces the batch in the **pending-changes tray** with `aiSuggested: true`. You can click **Recompose this learner** to rebuild a specific demo caller's prompt now, or dismiss — the next call from any learner picks up the change automatically.

### The demo loop

```
tweak  →  precompose_for_fresh_learner  →  open_sim  →  call  →  see the change
(apply_demo_preset
 or dry_run_prompt)
```

Two sentences in, change visible on the next call. That's the whole point.

### Rules of honesty (built into the prompt)

1. The AI **never** claims it applied / changed / pre-composed anything unless the matching tool call returned `ok: true` in the same turn.
2. The AI **never** fans out to production learners. Writes are bounded to the demo set.
3. The AI **never** proposes tools outside the five above. If you ask for something else (e.g. "add a new module"), it points you at the Course Design Console.

---

## Surface 2 — Demo annotations (🎬 sticky notes on Preview bubbles)

### What it is

The Course Design Console's **Preview** lens shows Call 1 as a WhatsApp-style chat transcript — every line the AI will say, every survey card, every onboarding step, every divider, in order. Each bubble can carry a **demo annotation**: a presenter note for *you*, the operator, to read off while running the demo.

Annotations are stored in `Playbook.config.demoScript.annotations[]`, keyed by `bubbleRef`. They are:

- **Operator-only metadata.** Never reach the learner. Never appear in the composed prompt. Never affect scoring.
- **Not a compose input.** `demoScript` is in the `NEVER-COMPOSE` set — editing notes does not invalidate any learner's prompt cache.

### How to add / edit / delete a note

| Action | Click |
|---|---|
| Edit the prompt for this bubble | **The bubble itself** (clicks open the lens editor — Edit Greeting, Edit Onboarding, etc.) |
| Add a demo note | **🎬 Add demo note** link directly underneath the bubble |
| Edit an existing note | **🎬 Edit demo note** link, or click the saved sticky note that appears below the bubble |
| Delete | Sticky-note editor → Delete button |

**Hierarchy:** the bubble is the primary click target because editing the prompt is the educator's main job. The 🎬 demo note is one click deeper because it's a presenter aid, not a course feature.

### What you can put in a note

The annotation editor (slide-in from the right) has three fields:

| Field | Type | Purpose |
|---|---|---|
| **Presenter note** | textarea, ≤4000 chars | What you'll say while this bubble is on screen. Free text. |
| **Mark as wow moment** | checkbox | Flips the saved sticky note to the gold-bordered ★ variant — a visual marker for the highlight of the demo |
| **Dwell duration** | optional integer (seconds) | How long you plan to linger on this bubble. Currently informational only — drives no timer or auto-advance |

### Why notes appear "prefilled" when you re-open them

Re-opening an existing annotation pre-loads its saved values (`presenterNote`, `isWowMoment`, `durationSecOnStep`) into the editor. That's **not** a template — it's just the note you (or a colleague) saved earlier. The empty placeholder *"What to say while this bubble is on screen…"* disappears as soon as you start typing.

The **bubble text itself** ("Hi, welcome to your AI Tutoring Experience.") is the **script the AI will actually say** to the learner — it's pulled from the course's welcome / onboarding / module config, not from the annotation. That's why every bubble has text in it before you've added any notes: the bubbles are showing the live prompt; the notes are your sidecar.

### What "WOW moment" means

Marking a note as a wow moment changes nothing functionally — it only changes the **visual** of the saved sticky note (gold border + ★ icon) so you can spot the highlight at a glance while skimming Preview. Use it for the one or two beats of Call 1 that you want a prospect to remember (the personalised callback, the voice quality, the recall question that "just knew"). It's a scanning aid, not a behaviour switch.

### Hiding annotations when you're not running the demo

Open Cmd+K → switch to the 🎬 **Demo** tab → click the **Eye** button in the chat panel header.

- Eye **on** (default): every saved annotation + sticky note renders under its bubble.
- Eye **off**: bubbles render clean, no presenter notes visible. The 🎬 "Add demo note" affordance is still clickable so you can keep editing — clicking it re-opens the editor.

The toggle is per-user, persisted in localStorage; nothing is deleted. Use **off** when reviewing the course as a teacher (you want to see the learner's view, no presenter clutter). Use **on** when prepping for or running the demo (you want your script visible).

---

## Cmd+K cheat sheet

| Goal | Keystrokes |
|---|---|
| Open the Assistant panel | `Cmd+K` |
| Switch to Demo chat (🎬) | `Cmd+K` → click **🎬 Demo** tab |
| Hide / show all demo annotations on Preview | `Cmd+K` → Demo tab → **Eye / EyeOff** button in panel header |
| See the Call 1 transcript with annotations | Navigate to `/x/courses/<id>?tab=design` (Preview is the default lens) |
| Add a presenter note to a specific bubble | Preview lens → 🎬 Add demo note under the bubble |
| Apply the four good-demo defaults | Demo chat → "make this course demo-ready" (calls `apply_demo_preset`) |
| Hear the voice | Demo chat → "play the welcome" (calls `test_voice`) |
| Pre-warm a demo caller before showing the prospect | Demo chat → "get \<caller name\> ready" (calls `precompose_for_fresh_learner`) |

---

## Where this lives in the code

| Surface | File |
|---|---|
| Demo chat system prompt + 5 tools | `apps/admin/lib/chat/demo-system-prompt.ts` |
| Demo chat tool registry | `apps/admin/lib/chat/admin-tools.ts` (`DEMO_TOOLS` filter) |
| Demo chat route branch | `apps/admin/app/api/chat/route.ts` |
| Demo chat tab icon (🎬) | `apps/admin/contexts/ChatContext.tsx` (`MODE_CONFIG.DEMO`) |
| Eye/EyeOff annotation-visibility toggle | `apps/admin/components/chat/ChatPanel.tsx` header + `ChatContext.demoAnnotationsVisible` |
| Preview lens — bubble + annotation UI | `apps/admin/app/x/courses/[courseId]/_components/PreviewLens.tsx` |
| Annotation persistence (REST) | `apps/admin/app/api/courses/[courseId]/demo-script/route.ts` |
| Annotation persistence (DB) | `Playbook.config.demoScript.annotations[]` (JSON column) |
