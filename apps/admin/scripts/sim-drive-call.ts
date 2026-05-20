/**
 * Programmatic SIM call driver — runs a multi-turn IELTS practice session
 * end-to-end without the browser UI.
 *
 * Two modes:
 *
 * Pre-canned messages:
 *   npx tsx scripts/sim-drive-call.ts <callerId> "<label>" "<msg1>" "<msg2>" ...
 *
 * AI persona mode (--persona drives the learner side via test-harness.caller):
 *   npx tsx scripts/sim-drive-call.ts --persona="Polish receptionist, B2 English, nervous but keen" --turns=8 <callerId> "<label>"
 *
 * Optional `--module=<slug>` sets Call.requestedModuleId (pre-call module
 * pick, #242 Slice 2):
 *   npx tsx scripts/sim-drive-call.ts --module=part2 --persona=... --turns=6 <callerId> "Call 2 — Part 2"
 *
 * Steps:
 *   1. Fetch latest ComposedPrompt for caller
 *   2. Create Call row (with requestedModuleId if --module given)
 *   3. Turn loop:
 *        - In persona mode: AI plays the learner given the persona + history
 *        - In pre-canned mode: read next message from CLI
 *        - Tutor (system AI with composed prompt) responds
 *        - Persist both as CallMessages
 *   4. Mark Call ended (transcript with User:/Assistant: prefixes)
 *   5. Fire pipeline (currently blocked by middleware secret — UI workaround)
 */

// Load env files in Next.js precedence order BEFORE importing config:
//   1. .env.local  (highest — overrides everything in dev)
//   2. .env        (base)
// Next.js dev server auto-loads .env.local + .env. Plain tsx doesn't load
// any env file, AND `dotenv/config` (the easy way) only loads .env — not
// .env.local. When the two files contain DIFFERENT INTERNAL_API_SECRET
// values (as on hf-dev 2026-05-19), the SIM script ends up sending the
// `.env` secret while the dev server validates against the `.env.local`
// secret → mismatch → middleware redirects to /login → SIM gets HTML.
//
// Use `dotenv.config({path, override})` so .env.local wins, mirroring
// Next.js behaviour. (Pipeline-fire failure observed in SIM run on
// course e5f379ed.)
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local", override: true });
loadDotenv({ path: ".env" });
import { prisma } from "@/lib/prisma";
import { getConfiguredMeteredAICompletion } from "@/lib/metering";
import { config } from "@/lib/config";
import {
  resolveCurriculumIdForPlaybook,
  resolveModuleByLogicalId,
} from "@/lib/curriculum/resolve-module";

interface Args {
  callerId: string;
  label: string;
  moduleSlug?: string;
  persona?: string;
  maxTurns: number;
  messages: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let moduleSlug: string | undefined;
  let persona: string | undefined;
  let maxTurns = 6;
  const positional: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--module=")) moduleSlug = a.slice("--module=".length);
    else if (a.startsWith("--persona=")) persona = a.slice("--persona=".length);
    else if (a.startsWith("--turns=")) maxTurns = parseInt(a.slice("--turns=".length), 10) || 6;
    else positional.push(a);
  }
  if (positional.length < 2) {
    console.error("Usage: sim-drive-call.ts [--module=<slug>] [--persona=<text> --turns=<N>] <callerId> <label> [<msg1> ...]");
    process.exit(1);
  }
  const [callerId, label, ...messages] = positional;
  if (!persona && messages.length === 0) {
    console.error("Need either --persona=... or one or more pre-canned messages.");
    process.exit(1);
  }
  return { callerId, label, moduleSlug, persona, maxTurns, messages };
}

function extractPromptText(p: unknown): string {
  if (typeof p === "string") return p;
  if (p && typeof p === "object") {
    const obj = p as Record<string, unknown>;
    if (typeof obj.fullText === "string") return obj.fullText;
    if (typeof obj.text === "string") return obj.text;
    return JSON.stringify(p);
  }
  return String(p);
}

async function main() {
  const { callerId, label, moduleSlug, persona, maxTurns, messages } = parseArgs();
  const startedAt = new Date();

  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { id: true, name: true },
  });
  if (!caller) {
    console.error(`No caller ${callerId}`);
    process.exit(1);
  }
  const cp = await prisma.callerPlaybook.findFirst({
    where: { callerId },
    select: { playbookId: true },
  });
  if (!cp) {
    console.error(`No playbook linked to caller ${callerId}`);
    process.exit(1);
  }
  const playbookId = cp.playbookId;

  console.log(`\n=== SIM: ${label} → ${caller.name} (${caller.id.slice(0, 8)}) ===`);
  if (moduleSlug) console.log(`Pre-call module pick: ${moduleSlug}`);

  // 1. Fetch latest composed prompt
  const composed = await prisma.composedPrompt.findFirst({
    where: { callerId },
    orderBy: { composedAt: "desc" },
    select: { id: true, llmPrompt: true, composedAt: true, status: true },
  });
  if (!composed) {
    console.error("No composed prompt yet — start a call from the UI first to seed one.");
    process.exit(1);
  }
  const promptText = extractPromptText(composed.llmPrompt);
  console.log(`Using prompt ${composed.id.slice(0, 8)} (${promptText.length} chars, ${composed.status})`);

  // 2. Resolve --module slug → CurriculumModule.id (#491 Slice 1.1 parity).
  //    The pipeline route looks up `Call.curriculumModuleId` for module-
  //    aware composition; without this resolution the SIM-created call
  //    leaves the FK null and module-scoped instructions never reach the
  //    composed prompt (2026-05-19 SIM run, course e5f379ed). Mirrors what
  //    the VAPI / normal call-create path does in production.
  let curriculumModuleId: string | null = null;
  if (moduleSlug) {
    const curriculumId = await resolveCurriculumIdForPlaybook(playbookId);
    if (!curriculumId) {
      console.warn(`[sim-drive] playbook ${playbookId} has no curriculum — leaving curriculumModuleId null`);
    } else {
      const resolved = await resolveModuleByLogicalId(curriculumId, moduleSlug);
      if (!resolved) {
        console.warn(`[sim-drive] module slug "${moduleSlug}" not found in curriculum ${curriculumId.slice(0, 8)} — leaving curriculumModuleId null`);
      } else {
        curriculumModuleId = resolved.id;
        console.log(`Resolved module "${moduleSlug}" → CurriculumModule ${curriculumModuleId.slice(0, 8)}`);
      }
    }
  }

  // 3. Create Call row.
  // #556: mirror the production /api/callers/[callerId]/calls path —
  // compute callSequence from the caller's last call so sim-created rows
  // get proper #1, #2, #3 ordering. Without this they all land with
  // callSequence=null, breaking compose-next-prompt's previous-call
  // context (compose-next-prompt.ts:732) and any UI/report that orders
  // by sequence.
  const lastCall = await prisma.call.findFirst({
    where: { callerId },
    orderBy: { callSequence: "desc" },
    select: { callSequence: true },
  });
  const callSequence = (lastCall?.callSequence ?? 0) + 1;

  const call = await prisma.call.create({
    data: {
      source: "sim",
      transcript: "",
      callSequence,
      caller: { connect: { id: callerId } },
      playbook: { connect: { id: playbookId } },
      usedPrompt: { connect: { id: composed.id } },
      ...(moduleSlug ? { requestedModuleId: moduleSlug } : {}),
      ...(curriculumModuleId ? { curriculumModule: { connect: { id: curriculumModuleId } } } : {}),
    },
    select: { id: true },
  });
  console.log(`Created call ${call.id.slice(0, 8)} (#${callSequence})`);

  // Conversation accumulator
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Persona prompt for AI-driven learner side
  const personaSystem = persona
    ? `You are roleplaying as an IELTS Speaking learner with this profile: ${persona}

Speak naturally as that learner. Mistakes are OK — that's the point. Use B1/B2-level English with occasional small errors (article drops, wrong tense, simple word choices). Keep replies short: 1-3 sentences. Don't be too eager — you're a real person, sometimes terse, occasionally off-topic. Never break character. Never mention you're an AI or that this is a test. If the tutor asks something hard, you can hesitate ("erm...", "let me think...") or admit you don't know.

End the conversation naturally when the tutor signals the session is winding down, OR when you've spoken enough (5+ turns). To end, say something like "Thanks, I think that's enough for today" or "I have to go now". Otherwise stay engaged.`
    : null;

  // Decide turn count
  const turnCount = persona ? maxTurns : messages.length;

  // 3. Drive each turn
  for (let i = 0; i < turnCount; i++) {
    let userMsg: string;

    if (persona && personaSystem) {
      // AI plays the learner
      const learnerMessages = [
        { role: "system" as const, content: personaSystem },
        // Flip roles for the learner persona — tutor becomes "user" from the persona's POV
        ...history.map((h) => ({
          role: h.role === "assistant" ? ("user" as const) : ("assistant" as const),
          content: h.content,
        })),
      ];
      // First turn: persona needs an opening cue
      if (history.length === 0) {
        learnerMessages.push({
          role: "user",
          content: "[Tutor greets you and asks an opening question. Reply as yourself.]",
        });
      }
      const learnerRes = await getConfiguredMeteredAICompletion(
        {
          callPoint: "test-harness.caller",
          messages: learnerMessages,
          maxRetries: 1,
        },
        { sourceOp: "sim-drive-persona", callerId, callId: call.id }
      );
      userMsg = learnerRes.content.trim();
      // Detect natural conversation end signal
      if (/\b(thanks?\s+(?:that'?s\s+)?(?:enough|all|it)|have to go|gotta go|see you|bye for now|that'?s enough for today)\b/i.test(userMsg) && i >= 3) {
        console.log(`\n--- User → ${userMsg.slice(0, 100)}${userMsg.length > 100 ? "..." : ""}`);
        await prisma.callMessage.create({ data: { callId: call.id, role: "user", content: userMsg } });
        history.push({ role: "user", content: userMsg });
        // Let the tutor have the last word
        const closingMessages = [
          { role: "system" as const, content: promptText },
          ...history.map((h) => ({ role: h.role, content: h.content })),
        ];
        const closing = await getConfiguredMeteredAICompletion(
          { callPoint: "test-harness.system", messages: closingMessages, maxRetries: 1 },
          { sourceOp: "sim-drive", callerId, callId: call.id }
        );
        const closeReply = closing.content.trim();
        console.log(`Tutor → ${closeReply.slice(0, 200)}${closeReply.length > 200 ? "..." : ""}`);
        await prisma.callMessage.create({ data: { callId: call.id, role: "assistant", content: closeReply } });
        history.push({ role: "assistant", content: closeReply });
        break;
      }
    } else {
      userMsg = messages[i];
    }

    console.log(`\n--- User → ${userMsg.slice(0, 100)}${userMsg.length > 100 ? "..." : ""}`);
    await prisma.callMessage.create({ data: { callId: call.id, role: "user", content: userMsg } });
    history.push({ role: "user", content: userMsg });

    // Tutor reply
    const aiMessages = [
      { role: "system" as const, content: promptText },
      ...history.map((h) => ({ role: h.role, content: h.content })),
    ];
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "test-harness.system",
        messages: aiMessages,
        maxRetries: 1,
      },
      { sourceOp: "sim-drive", callerId, callId: call.id }
    );
    const tutorReply = result.content.trim();
    console.log(`Tutor → ${tutorReply.slice(0, 200)}${tutorReply.length > 200 ? "..." : ""}`);
    await prisma.callMessage.create({ data: { callId: call.id, role: "assistant", content: tutorReply } });
    history.push({ role: "assistant", content: tutorReply });
  }

  // 4. Update Call with full transcript text
  // Use "User:" / "Assistant:" prefixes — CallsPromptsTab's parseTranscript()
  // splits on these exact strings to render the transcript card.
  const fullTranscript = history
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
  await prisma.call.update({
    where: { id: call.id },
    data: { transcript: fullTranscript, endedAt: new Date() },
  });
  console.log(`\nCall transcript written (${fullTranscript.length} chars).`);

  // 5. Fire pipeline
  console.log(`\nFiring pipeline (mode=prompt) ...`);
  const pipelineRes = await fetch(`http://localhost:3000/api/calls/${call.id}/pipeline`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": config.security.internalApiSecret,
    },
    body: JSON.stringify({ callerId, mode: "prompt" }),
  });
  const pipelineBody = await pipelineRes.text();
  if (!pipelineRes.ok) {
    console.error(`Pipeline failed (${pipelineRes.status}): ${pipelineBody.slice(0, 500)}`);
  } else {
    try {
      const j = JSON.parse(pipelineBody);
      console.log(`Pipeline OK in ${j.duration}ms. data=${JSON.stringify(j.data || {}).slice(0, 300)}`);
    } catch {
      console.log(`Pipeline OK (non-JSON): ${pipelineBody.slice(0, 200)}`);
    }
  }

  const endedAt = new Date();
  console.log(`\n=== Done in ${Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)}s ===`);
  console.log(`callId: ${call.id}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[sim-drive] crash:", err);
  process.exit(1);
});
