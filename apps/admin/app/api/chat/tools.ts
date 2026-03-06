/**
 * Chat API Tool Definitions and Handlers
 *
 * Tools available to the AI during sim chat conversations.
 * The share_content tool allows the AI to proactively share teaching materials.
 */

import { prisma } from "@/lib/prisma";
import type { AITool, AIToolUse } from "@/lib/ai/client";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { isStudentVisibleDefault } from "@/lib/doc-type-icons";

// =====================================================
// TOOL DEFINITIONS
// =====================================================

export const CHAT_TOOLS: AITool[] = [
  {
    name: "share_content",
    description:
      "Share a teaching document, image, or audio file with the learner during the conversation. " +
      "Use this when referencing visual materials, comprehension passages, diagrams, worksheets, or exercises. " +
      "The content will appear inline in the chat for the learner to view.",
    input_schema: {
      type: "object",
      properties: {
        media_id: {
          type: "string",
          description: "ID of the media asset to share (from the available teaching materials list)",
        },
        context: {
          type: "string",
          description: "Brief message to show alongside the content (e.g. 'Here is the passage we will work through')",
        },
      },
      required: ["media_id"],
    },
  },
];

// =====================================================
// TOOL HANDLERS
// =====================================================

export interface ToolContext {
  callerId: string;
  callId: string;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Execute a tool call and return the result.
 */
export async function executeToolCall(
  toolUse: AIToolUse,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (toolUse.name) {
    case "share_content":
      return handleShareContent(toolUse, ctx);
    default:
      return {
        tool_use_id: toolUse.id,
        content: `Unknown tool: ${toolUse.name}`,
        is_error: true,
      };
  }
}

async function handleShareContent(
  toolUse: AIToolUse,
  ctx: ToolContext
): Promise<ToolResult> {
  const { media_id, context } = toolUse.input as { media_id: string; context?: string };

  // Validate media exists
  const media = await prisma.mediaAsset.findUnique({
    where: { id: media_id },
    select: { id: true, fileName: true, title: true, mimeType: true },
  });

  if (!media) {
    return {
      tool_use_id: toolUse.id,
      content: `Media asset "${media_id}" not found. Share a different resource or continue without it.`,
      is_error: true,
    };
  }

  // Create a CallMessage with media attachment
  await prisma.callMessage.create({
    data: {
      callId: ctx.callId,
      role: "assistant",
      content: context || media.title || media.fileName,
      mediaId: media.id,
    },
  });

  return {
    tool_use_id: toolUse.id,
    content: `Successfully shared "${media.title || media.fileName}" (${media.mimeType}) with the learner. It will appear as an image/document in their chat. Continue the conversation naturally — reference the content you just shared.`,
  };
}

// =====================================================
// CONTENT CATALOG FOR SYSTEM PROMPT
// =====================================================

/**
 * Build a list of available teaching materials for the system prompt.
 * Loaded from the caller's domain subjects.
 *
 * For first calls, annotates media with phase assignments from the domain's
 * onboardingFlowPhases config (phases[].content[].mediaId).
 */
export async function buildContentCatalog(callerId: string, callId?: string): Promise<string | null> {
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: {
      domainId: true,
      domain: {
        select: {
          onboardingFlowPhases: true,
          subjects: { select: { subjectId: true } },
        },
      },
    },
  });

  if (!caller?.domain) return null;

  // Resolve course-scoped subjects (playbook → PlaybookSubject, domain fallback)
  let subjectIds: string[];
  const playbookId = await resolvePlaybookId(callerId);
  if (playbookId) {
    const playbookSubjects = await prisma.playbookSubject.findMany({
      where: { playbookId },
      select: { subjectId: true },
    });
    // Fall back to domain-wide if no PlaybookSubject records
    subjectIds = playbookSubjects.length > 0
      ? playbookSubjects.map((ps) => ps.subjectId)
      : caller.domain.subjects.map((s) => s.subjectId);
  } else {
    subjectIds = caller.domain.subjects.map((s) => s.subjectId);
  }
  if (subjectIds.length === 0) return null;

  const items = await prisma.subjectMedia.findMany({
    where: { subjectId: { in: subjectIds } },
    include: {
      media: {
        select: {
          id: true, fileName: true, mimeType: true, title: true, description: true, tags: true,
          source: { select: { documentType: true } },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
    take: 30,
  });

  if (items.length === 0) return null;

  // Check if this is a first call in the domain (no onboarding session or incomplete)
  let isFirstCallInDomain = false;
  if (caller.domainId) {
    const onboardingSession = await prisma.onboardingSession.findUnique({
      where: { callerId_domainId: { callerId, domainId: caller.domainId } },
      select: { isComplete: true },
    });
    isFirstCallInDomain = !onboardingSession || !onboardingSession.isComplete;
  }

  // Build phase→mediaId mapping from onboarding flow config
  const phaseMediaMap = new Map<string, { phase: string; instruction?: string }>();
  if (isFirstCallInDomain && caller.domain.onboardingFlowPhases) {
    const flowConfig = caller.domain.onboardingFlowPhases as { phases?: Array<{ phase: string; content?: Array<{ mediaId: string; instruction?: string }> }> };
    for (const phase of flowConfig.phases || []) {
      for (const ref of phase.content || []) {
        phaseMediaMap.set(ref.mediaId, { phase: phase.phase, instruction: ref.instruction });
      }
    }
  }

  // Auto-annotate: for first calls with no explicit phase wiring, auto-assign
  // student-visible media (passages, worksheets, etc.) to the first content phase.
  // This ensures the AI shares materials proactively even when the educator didn't
  // manually wire mediaIds into flow phases (e.g. wizard-created courses).
  if (isFirstCallInDomain && phaseMediaMap.size === 0) {
    // Find the first content-bearing phase name (or fall back to "first-topic")
    const flowConfig = caller.domain.onboardingFlowPhases as { phases?: Array<{ phase: string }> } | null;
    const contentPhase = flowConfig?.phases?.find(
      (p) => /topic|teach|content|practice|reading/i.test(p.phase),
    );
    const phaseName = contentPhase?.phase || "first-topic";

    for (const item of items) {
      const docType = item.media.source?.documentType;
      if (docType && isStudentVisibleDefault(docType)) {
        phaseMediaMap.set(item.media.id, {
          phase: phaseName,
          instruction: "Share this with the learner when introducing the topic",
        });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (seen.has(i.media.id)) return false;
    seen.add(i.media.id);
    return true;
  });

  // Batch-load assertion context for each media item
  const mediaIds = unique.map((i) => i.media.id);
  const [assertionLinks, alreadySharedIds] = await Promise.all([
    mediaIds.length > 0
      ? prisma.assertionMedia.groupBy({
          by: ["mediaId"],
          where: { mediaId: { in: mediaIds } },
          _count: { assertionId: true },
        })
      : Promise.resolve([]),
    // Check which media has already been shared in this call (prevents re-sharing)
    callId
      ? prisma.callMessage.findMany({
          where: { callId, mediaId: { not: null } },
          select: { mediaId: true },
        }).then((msgs) => new Set(msgs.map((m) => m.mediaId!)))
      : Promise.resolve(new Set<string>()),
  ]);
  const assertionCountMap = new Map(
    assertionLinks.map((al) => [al.mediaId, al._count.assertionId]),
  );

  const lines = unique.map((item) => {
    const m = item.media;
    const typeLabel = m.mimeType.startsWith("image/") ? "Image" : m.mimeType === "application/pdf" ? "PDF" : m.mimeType.startsWith("audio/") ? "Audio" : "File";
    const desc = m.description ? ` — ${m.description.slice(0, 80)}` : "";
    const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
    const phaseRef = phaseMediaMap.get(m.id);
    const phaseHint = phaseRef ? ` | SHARE DURING: "${phaseRef.phase}" phase${phaseRef.instruction ? ` — ${phaseRef.instruction}` : ""}` : "";
    const refCount = assertionCountMap.get(m.id);
    const refHint = refCount ? ` (Referenced by ${refCount} teaching point${refCount > 1 ? "s" : ""})` : "";
    const shared = alreadySharedIds.has(m.id) ? " ✓ ALREADY SHARED" : "";
    return `- "${m.title || m.fileName}" (ID: ${m.id}) — ${typeLabel}${refHint}${desc}${tags}${phaseHint}${shared}`;
  });

  let instructions = "When discussing content that has a visual component (passage, diagram, worksheet), share it proactively using share_content. After sharing, reference the content naturally (e.g. \"Take a look at the passage I just sent you\").\n\nIMPORTANT: Never re-share content already sent to the learner. Items marked \"ALREADY SHARED\" must NOT be shared again — just reference them naturally.";

  if (phaseMediaMap.size > 0) {
    instructions += "\n\nItems marked with \"SHARE DURING\" are assigned to specific onboarding phases. Share them at the indicated point in the session flow.";
  }

  return `\n## Available Teaching Materials\nYou can share these with the learner using the share_content tool:\n${lines.join("\n")}\n\n${instructions}`;
}
