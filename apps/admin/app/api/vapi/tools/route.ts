import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyVapiRequest } from "@/lib/vapi/auth";
import { getActivitiesConfig } from "@/lib/fallback-settings";
import { resolveChannel } from "@/lib/channels/router";
import { dispatchMedia } from "@/lib/channels/dispatch";
import { getPublicMediaUrl } from "@/app/api/media/[id]/public/route";

export const runtime = "nodejs";

/**
 * @api POST /api/vapi/tools
 * @visibility public
 * @scope vapi:tools
 * @auth webhook-secret
 * @tags vapi, tools, calls
 * @description VAPI Custom Tools endpoint. Called when the voice AI decides
 *   to use a tool mid-conversation (e.g., lookup_teaching_point, check_mastery,
 *   record_observation, get_practice_question).
 *
 *   Request format: { message: { type: "tool-calls", toolCallList: [...], call: {...} } }
 *   Response format: { results: [{ toolCallId, result }] }
 *
 *   Ref: https://docs.vapi.ai/tools/custom-tools
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const authError = verifyVapiRequest(request, rawBody);
    if (authError) return authError;

    const body = JSON.parse(rawBody);
    const toolCalls =
      body.message?.toolCallList ||
      body.toolCallList ||
      [];

    const customerPhone =
      body.message?.call?.customer?.number ||
      body.call?.customer?.number;

    // Resolve caller
    let callerId: string | null = null;
    if (customerPhone) {
      const caller = await prisma.caller.findFirst({
        where: { phone: customerPhone.replace(/\s+/g, "") },
        select: { id: true },
      });
      callerId = caller?.id || null;
    }

    const results = [];

    for (const toolCall of toolCalls) {
      const funcName =
        toolCall.function?.name ||
        toolCall.functionCall?.name ||
        toolCall.name;
      const params =
        toolCall.function?.arguments ||
        toolCall.functionCall?.parameters ||
        toolCall.parameters ||
        {};
      const toolCallId = toolCall.id || toolCall.toolCallId;

      // Parse arguments if string
      const args = typeof params === "string" ? JSON.parse(params) : params;

      let result: any;

      switch (funcName) {
        case "lookup_teaching_point":
          result = await handleLookupTeachingPoint(args, callerId);
          break;

        case "check_mastery":
          result = await handleCheckMastery(args, callerId);
          break;

        case "record_observation":
          result = await handleRecordObservation(args, callerId);
          break;

        case "get_practice_question":
          result = await handleGetPracticeQuestion(args, callerId);
          break;

        case "get_next_module":
          result = await handleGetNextModule(args, callerId);
          break;

        case "log_activity_result":
          result = await handleLogActivityResult(args, callerId);
          break;

        case "send_text_to_caller":
          result = await handleSendTextToCaller(args, callerId, customerPhone);
          break;

        case "request_artifact":
          result = await handleRequestArtifact(args, callerId);
          break;

        case "share_content":
          result = await handleShareContent(args, callerId, customerPhone);
          break;

        default:
          result = { error: `Unknown tool: ${funcName}` };
      }

      results.push({ toolCallId, result });
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    console.error("[vapi/tools] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Tool execution failed" },
      { status: 500 },
    );
  }
}

/**
 * Look up teaching content by topic keyword.
 */
async function handleLookupTeachingPoint(
  args: { topic: string; limit?: number },
  callerId: string | null,
) {
  const { topic, limit = 3 } = args;
  if (!topic) return { error: "topic is required" };

  const words = topic
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const assertions = await prisma.contentAssertion.findMany({
    where: {
      OR: [
        ...words.slice(0, 5).map((w) => ({
          assertion: { contains: w, mode: "insensitive" as const },
        })),
        { tags: { hasSome: words } },
      ],
    },
    take: limit,
    orderBy: { examRelevance: "desc" },
    include: {
      source: { select: { name: true } },
    },
  });

  if (assertions.length === 0) {
    return { found: false, message: `No teaching content found for "${topic}"` };
  }

  return {
    found: true,
    count: assertions.length,
    points: assertions.map((a) => ({
      content: a.assertion,
      category: a.category,
      chapter: a.chapter,
      source: a.source.name,
      examRelevance: a.examRelevance,
    })),
  };
}

/**
 * Check if a caller has mastered a specific module/concept.
 */
async function handleCheckMastery(
  args: { module: string },
  callerId: string | null,
) {
  const { module } = args;
  if (!callerId) return { error: "Cannot check mastery — caller not identified" };
  if (!module) return { error: "module is required" };

  // Look for mastery attributes
  const slug = module.toLowerCase().replace(/\s+/g, "_");
  const attributes = await prisma.callerAttribute.findMany({
    where: {
      callerId,
      OR: [
        { key: { startsWith: `mastery_${slug}` } },
        { key: { contains: slug } },
      ],
    },
  });

  if (attributes.length === 0) {
    return {
      mastered: false,
      score: null,
      message: `No mastery data found for "${module}". The caller may not have studied this yet.`,
    };
  }

  const masteryAttr = attributes.find((a) => a.key.startsWith("mastery_"));
  const score = masteryAttr?.numberValue || null;

  return {
    mastered: score !== null && score >= 0.7,
    score,
    module,
    message: score !== null
      ? score >= 0.7
        ? `Caller has mastered "${module}" (score: ${Math.round(score * 100)}%)`
        : `Caller is still learning "${module}" (score: ${Math.round(score * 100)}%)`
      : `Mastery data exists but no numeric score for "${module}"`,
  };
}

/**
 * Record an observation about the caller in real-time.
 */
async function handleRecordObservation(
  args: { key: string; value: string; category?: string },
  callerId: string | null,
) {
  if (!callerId) return { error: "Cannot record observation — caller not identified" };
  if (!args.key || !args.value) return { error: "key and value are required" };

  const category = args.category || "CONTEXT";

  await prisma.callerMemory.create({
    data: {
      callerId,
      key: args.key,
      value: args.value,
      category: category as any, // MemoryCategory enum: FACT, PREFERENCE, EVENT, TOPIC, RELATIONSHIP, CONTEXT
      confidence: 0.7, // Mid-call observations get moderate confidence
      source: "STATED", // Closest match — caller stated this during the call
      context: "Recorded by voice AI tool during active call",
    },
  });

  return {
    recorded: true,
    message: `Observation recorded: ${args.key} = ${args.value}`,
  };
}

/**
 * Get a practice question for the current topic.
 */
async function handleGetPracticeQuestion(
  args: { topic: string },
  callerId: string | null,
) {
  const { topic } = args;
  if (!topic) return { error: "topic is required" };

  // Look for assertions with category "example" or high exam relevance
  const words = topic
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const assertions = await prisma.contentAssertion.findMany({
    where: {
      OR: [
        ...words.slice(0, 5).map((w) => ({
          assertion: { contains: w, mode: "insensitive" as const },
        })),
        { tags: { hasSome: words } },
      ],
      examRelevance: { gte: 0.5 },
    },
    take: 3,
    orderBy: { examRelevance: "desc" },
    include: {
      source: { select: { name: true } },
    },
  });

  if (assertions.length === 0) {
    return {
      found: false,
      suggestion: `No exam-relevant content found for "${topic}". Ask the caller to explain the concept in their own words.`,
    };
  }

  // Use the assertion as basis for a practice question
  const chosen = assertions[0];
  return {
    found: true,
    basedOn: {
      content: chosen.assertion,
      source: chosen.source.name,
      chapter: chosen.chapter,
    },
    suggestion: `Based on this key point: "${chosen.assertion}" — ask the caller to explain this concept or apply it to a scenario.`,
  };
}

/**
 * Get the next module the caller should study.
 */
async function handleGetNextModule(
  args: Record<string, any>,
  callerId: string | null,
) {
  if (!callerId) return { error: "Cannot determine next module — caller not identified" };

  // Get the active ComposedPrompt which has curriculum state
  const prompt = await prisma.composedPrompt.findFirst({
    where: { callerId, status: "active" },
    orderBy: { composedAt: "desc" },
    select: { llmPrompt: true },
  });

  if (!prompt?.llmPrompt) {
    return { error: "No active prompt found — cannot determine curriculum position" };
  }

  const llm = prompt.llmPrompt as any;
  const curr = llm.curriculum;

  if (!curr?.modules?.length) {
    return { error: "No curriculum modules found in the active prompt" };
  }

  const inProgress = curr.modules.find((m: any) => m.status === "in_progress");
  const next = curr.nextModule;

  return {
    currentModule: inProgress
      ? { name: inProgress.name, description: inProgress.description }
      : null,
    nextModule: next
      ? { name: next.name, description: next.description }
      : null,
    progress: `${curr.completedCount || 0}/${curr.totalModules || 0} modules completed`,
  };
}

/**
 * Log the result of an interactive activity (pop quiz, MCQ, scenario, etc.).
 * Creates a CallerMemory and optionally updates CallerAttribute for tracking.
 */
async function handleLogActivityResult(
  args: {
    activity_id: string;
    outcome: "correct" | "incorrect" | "partial" | "completed" | "skipped";
    topic?: string;
    notes?: string;
  },
  callerId: string | null,
) {
  if (!callerId) return { error: "Cannot log activity — caller not identified" };
  if (!args.activity_id || !args.outcome) return { error: "activity_id and outcome are required" };

  // Store as a memory so the pipeline can extract it
  await prisma.callerMemory.create({
    data: {
      callerId,
      key: `activity_${args.activity_id}`,
      value: `${args.outcome}${args.topic ? ` on ${args.topic}` : ""}${args.notes ? ` — ${args.notes}` : ""}`,
      category: "CONTEXT",
      confidence: 0.9,
      source: "STATED",
      context: `Activity ${args.activity_id} result logged by voice AI during active call`,
    },
  });

  // Also store as a structured attribute for analytics
  const attrKey = `last_activity_${args.activity_id}`;
  const attrScope = "caller";
  await prisma.callerAttribute.upsert({
    where: {
      callerId_key_scope: { callerId, key: attrKey, scope: attrScope },
    },
    create: {
      callerId,
      key: attrKey,
      scope: attrScope,
      valueType: "JSON",
      jsonValue: {
        outcome: args.outcome,
        topic: args.topic || null,
        notes: args.notes || null,
        timestamp: new Date().toISOString(),
      },
      confidence: 0.9,
    },
    update: {
      jsonValue: {
        outcome: args.outcome,
        topic: args.topic || null,
        notes: args.notes || null,
        timestamp: new Date().toISOString(),
      },
    },
  });

  return {
    logged: true,
    message: `Activity ${args.activity_id} result logged: ${args.outcome}`,
  };
}

/**
 * Send a text message (SMS) to the caller during or after a call.
 * Used for MCQs, reflection prompts, follow-up resources, etc.
 *
 * Provider is controlled by SystemSetting `fallback:activities.config`:
 *   - "stub"     — Logs intent, records memory, no actual delivery (default)
 *   - "twilio"   — Sends via Twilio SMS API
 *   - "vapi-sms" — Sends via VAPI's built-in SMS (future)
 *
 * Switching provider = change the setting. Zero code changes.
 */
async function handleSendTextToCaller(
  args: { message: string; purpose?: string },
  callerId: string | null,
  customerPhone: string | null,
) {
  if (!callerId) return { error: "Cannot send text — caller not identified" };
  if (!args.message) return { error: "message is required" };
  if (!customerPhone) return { error: "No phone number available for this caller" };

  const activitiesConfig = await getActivitiesConfig();

  if (!activitiesConfig.enabled) {
    return { sent: false, reason: "Activities are disabled in system settings" };
  }

  // Log the text message as a memory (for pipeline tracking — always, regardless of provider)
  await prisma.callerMemory.create({
    data: {
      callerId,
      key: `text_sent_${args.purpose || "general"}`,
      value: args.message.substring(0, 500),
      category: "CONTEXT",
      confidence: 1.0,
      source: "STATED",
      context: `Text message sent to caller during active call (purpose: ${args.purpose || "general"}, provider: ${activitiesConfig.textProvider})`,
    },
  });

  // Dispatch to provider
  switch (activitiesConfig.textProvider) {
    case "twilio": {
      const delivered = await sendViaTwilio(
        customerPhone,
        args.message,
        activitiesConfig.twilio,
      );
      return delivered
        ? { sent: true, message: `SMS sent to ${customerPhone}`, provider: "twilio" }
        : { sent: false, message: "Twilio delivery failed — check logs", provider: "twilio" };
    }

    case "vapi-sms":
      // Future: VAPI's built-in SMS capability
      console.log(`[vapi/tools] vapi-sms: not yet implemented, falling back to stub`);
      return {
        sent: true,
        message: `Text message queued for ${customerPhone}`,
        provider: "vapi-sms",
        note: "VAPI SMS integration pending",
      };

    case "stub":
    default:
      console.log(`[vapi/tools] send_text_to_caller [stub]: ${customerPhone} — ${args.message.substring(0, 100)}...`);
      return {
        sent: true,
        message: `Text message logged for ${customerPhone}`,
        provider: "stub",
        note: "Stub mode — message logged but not delivered. Change textProvider in Settings to enable delivery.",
      };
  }
}

/**
 * Send SMS via Twilio REST API.
 * Reads credentials from config or env vars.
 */
async function sendViaTwilio(
  to: string,
  body: string,
  twilioConfig?: { fromNumber: string; accountSid?: string; authToken?: string },
): Promise<boolean> {
  const accountSid = twilioConfig?.accountSid || process.env.TWILIO_ACCOUNT_SID;
  const authToken = twilioConfig?.authToken || process.env.TWILIO_AUTH_TOKEN;
  const from = twilioConfig?.fromNumber || process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.error("[vapi/tools] Twilio: missing credentials (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)");
    return false;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });

    if (!res.ok) {
      console.error(`[vapi/tools] Twilio error (${res.status})`);
      return false;
    }

    const data = await res.json();
    console.log(`[vapi/tools] Twilio SMS sent: ${data.sid}`);
    return true;
  } catch (err: any) {
    console.error("[vapi/tools] Twilio exception:", err.message);
    return false;
  }
}

/**
 * Request an artifact be created for the caller after the call ends.
 * Creates a CallAction that the pipeline picks up during EXTRACT.
 */
async function handleRequestArtifact(
  args: { type: string; title: string; content: string; reason?: string },
  callerId: string | null,
) {
  if (!callerId) return { error: "Cannot request artifact — caller not identified" };
  if (!args.type || !args.title || !args.content) {
    return { error: "type, title, and content are required" };
  }

  const typeMap: Record<string, string> = {
    SUMMARY: "TASK",
    KEY_FACT: "TASK",
    FORMULA: "TASK",
    EXERCISE: "HOMEWORK",
    RESOURCE_LINK: "SEND_MEDIA",
    STUDY_NOTE: "TASK",
    REMINDER: "REMINDER",
    MEDIA: "SEND_MEDIA",
  };

  const actionType = typeMap[args.type.toUpperCase()] || "TASK";

  const action = await prisma.callAction.create({
    data: {
      callerId,
      type: actionType as any,
      title: args.title.slice(0, 200),
      description: args.content,
      assignee: "AGENT",
      status: "PENDING",
      priority: "MEDIUM",
      source: "EXTRACTED",
      confidence: 0.8,
      notes: JSON.stringify({
        artifactType: args.type.toUpperCase(),
        reason: args.reason || null,
        requestedDuringCall: true,
      }),
    },
  });

  return {
    success: true,
    actionId: action.id,
    message: `Artifact request recorded: "${args.title}" (type: ${args.type}). Will be delivered after the call.`,
  };
}

/**
 * Share visual content (image, diagram, PDF) with the caller.
 *
 * Two delivery paths:
 * - Sim: creates a CallMessage with mediaId (rendered inline by SimChat)
 * - VAPI voice: routes through channel system (WhatsApp MMS, SMS+link)
 *
 * The AI's voice prompt lists available visual aids with media IDs.
 * This tool lets the AI push any of those to the caller mid-conversation.
 */
async function handleShareContent(
  args: { media_id: string; caption?: string; context?: string },
  callerId: string | null,
  customerPhone: string | null,
): Promise<Record<string, unknown>> {
  if (!callerId) return { error: "Cannot share content — caller not identified" };
  if (!args.media_id) return { error: "media_id is required" };

  // Load media asset
  const media = await prisma.mediaAsset.findUnique({
    where: { id: args.media_id },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      title: true,
      captionText: true,
      storageKey: true,
      storageType: true,
    },
  });

  if (!media) {
    return { error: `Media asset not found: ${args.media_id}` };
  }

  // Find active call for this caller (most recent non-ended call)
  const activeCall = await prisma.call.findFirst({
    where: { callerId, endedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, externalId: true },
  });

  const isVapiCall = !!activeCall?.externalId;
  const caption = args.caption || media.captionText || media.title || media.fileName;

  // ── SIM PATH ──
  // Sim calls don't have an externalId (VAPI call ID).
  // Create a CallMessage with mediaId so SimChat renders it inline.
  if (!isVapiCall && activeCall) {
    await prisma.callMessage.create({
      data: {
        callId: activeCall.id,
        role: "assistant",
        content: caption,
        mediaId: media.id,
      },
    });

    return {
      shared: true,
      channel: "sim",
      rendered: "inline",
      message: `Shared "${caption}" inline in the chat`,
    };
  }

  // ── VAPI VOICE PATH ──
  // Route through the channel system to the caller's phone.
  if (!customerPhone) {
    // No phone number — queue as artifact for post-call delivery
    if (activeCall) {
      await prisma.conversationArtifact.create({
        data: {
          callId: activeCall.id,
          callerId,
          type: "MEDIA",
          title: caption,
          content: args.context || `Visual aid: ${caption}`,
          mediaId: media.id,
          status: "PENDING",
          channel: "sim",
          confidence: 1.0,
        },
      });
    }
    return {
      shared: false,
      queued: true,
      message: "No phone number available — content queued for post-call delivery",
    };
  }

  // Resolve caller's domain for channel config
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });

  const channel = await resolveChannel(caller?.domainId || null, customerPhone);

  // Generate a public URL for the media (external channels need this)
  const publicUrl = await getPublicMediaUrl(
    media.id,
    media.storageKey,
    media.storageType,
    86400, // 24-hour expiry
  );

  const result = await dispatchMedia(
    channel,
    {
      mediaId: media.id,
      publicUrl,
      mimeType: media.mimeType,
      fileName: media.fileName,
      caption,
      title: media.title || undefined,
    },
    customerPhone,
  );

  // Record as ConversationArtifact for tracking
  if (activeCall) {
    await prisma.conversationArtifact.create({
      data: {
        callId: activeCall.id,
        callerId,
        type: "MEDIA",
        title: caption,
        content: args.context || `Visual aid shared via ${result.channel}: ${caption}`,
        mediaId: media.id,
        status: result.sent ? "SENT" : "FAILED",
        channel: result.channel,
        externalMessageId: result.externalMessageId || null,
        deliveredAt: result.sent ? new Date() : null,
        confidence: 1.0,
      },
    });
  }

  if (result.sent) {
    const channelLabel = result.channel === "whatsapp" ? "WhatsApp" : "SMS";
    return {
      shared: true,
      channel: result.channel,
      provider: result.provider,
      message: `Sent "${caption}" to caller's phone via ${channelLabel}. Tell them to check their messages.`,
    };
  }

  return {
    shared: false,
    error: result.error,
    message: `Could not send content via ${result.channel}: ${result.error}. Describe the content verbally instead.`,
  };
}

/**
 * Maps tool function name → VoiceCallSettings property key.
 * Used by assistant-request to filter tools based on settings.
 */
export const TOOL_SETTING_KEYS: Record<string, keyof import("@/lib/system-settings").VoiceCallSettings> = {
  lookup_teaching_point: "toolLookupTeachingPoint",
  check_mastery: "toolCheckMastery",
  record_observation: "toolRecordObservation",
  get_practice_question: "toolGetPracticeQuestion",
  get_next_module: "toolGetNextModule",
  log_activity_result: "toolLogActivityResult",
  send_text_to_caller: "toolSendText",
  request_artifact: "toolRequestArtifact",
  share_content: "toolShareContent",
};

/**
 * Tool definitions for voice assistant configuration.
 * These are included in the assistant-request response.
 */
export const VAPI_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "lookup_teaching_point",
      description:
        "Look up specific teaching content or facts about a topic. Use when the caller asks about a specific concept, rule, threshold, or definition.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic or concept to look up",
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default 3)",
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_mastery",
      description:
        "Check if the caller has mastered a specific module or concept. Use before deciding whether to teach new material or review.",
      parameters: {
        type: "object",
        properties: {
          module: {
            type: "string",
            description: "The module or concept name to check",
          },
        },
        required: ["module"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_observation",
      description:
        "Record an important observation about the caller during the conversation. Use when the caller reveals something significant about their knowledge, preferences, or situation.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "Short key for the observation (e.g., 'prefers_examples', 'nervous_about_exam')",
          },
          value: {
            type: "string",
            description: "The observation value/detail",
          },
          category: {
            type: "string",
            enum: ["FACT", "PREFERENCE", "TOPIC", "CONTEXT", "RELATIONSHIP"],
            description: "Category of the observation (default: CONTEXT)",
          },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_practice_question",
      description:
        "Get a practice question or scenario for the current topic. Use when transitioning to practice or assessment.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic to get a practice question for",
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_next_module",
      description:
        "Find out what the next module or topic is in the caller's curriculum. Use when the current topic is mastered and you need to move on.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_activity_result",
      description:
        "Log the result of an interactive activity (pop quiz, MCQ, scenario, teach-back, etc.). Call this after completing any structured activity to track the outcome.",
      parameters: {
        type: "object",
        properties: {
          activity_id: {
            type: "string",
            description: "The activity type ID (e.g., 'pop_quiz', 'mcq_voice', 'scenario', 'teach_back', 'rapid_fire')",
          },
          outcome: {
            type: "string",
            enum: ["correct", "incorrect", "partial", "completed", "skipped"],
            description: "The outcome of the activity",
          },
          topic: {
            type: "string",
            description: "The topic or concept the activity was about",
          },
          notes: {
            type: "string",
            description: "Brief notes on how the caller performed (e.g., 'got 4/5 in rapid fire', 'struggled with distinction between X and Y')",
          },
        },
        required: ["activity_id", "outcome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_text_to_caller",
      description:
        "Send a text message (SMS) to the caller. Use for multiple-choice questions with complex options, reflection prompts, follow-up resources, or anything better read than heard.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The text message content to send. Format with line breaks for readability.",
          },
          purpose: {
            type: "string",
            enum: ["mcq", "reflection", "resource", "recap", "practice"],
            description: "The purpose of the text message",
          },
        },
        required: ["message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_artifact",
      description:
        "Request that a study artifact be sent to the caller after the call. Use when you want to share a summary, formula, exercise, study note, or resource with the learner. The artifact will be delivered after the call ends.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["SUMMARY", "KEY_FACT", "FORMULA", "EXERCISE", "RESOURCE_LINK", "STUDY_NOTE", "REMINDER", "MEDIA"],
            description: "The type of artifact to send",
          },
          title: {
            type: "string",
            description: "A short descriptive title for the artifact (max 60 chars)",
          },
          content: {
            type: "string",
            description: "The content of the artifact in markdown format",
          },
          reason: {
            type: "string",
            description: "Why this artifact is being sent (for pipeline context)",
          },
        },
        required: ["type", "title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "share_content",
      description:
        "Share a visual aid (image, diagram, PDF) with the caller. In text sim sessions, the content appears inline in the chat. In voice calls, the content is sent to the caller's phone via their preferred channel (WhatsApp, MMS, or SMS link). Use when discussing a figure, diagram, or document listed in your visual aids that the caller should see. Always describe the content verbally too.",
      parameters: {
        type: "object",
        properties: {
          media_id: {
            type: "string",
            description:
              "The media ID from the visual aids list in your instructions",
          },
          caption: {
            type: "string",
            description:
              "Brief description of what the content shows and why you are sharing it",
          },
        },
        required: ["media_id"],
      },
    },
  },
];
