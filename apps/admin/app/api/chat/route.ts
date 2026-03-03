import { NextRequest, NextResponse } from "next/server";
import { AIEngine, AIMessage, ContentBlock } from "@/lib/ai/client";
import { getAIConfig } from "@/lib/ai/config-loader";
import { classifyAIError, userMessageForError } from "@/lib/ai/error-utils";
import { getConfiguredMeteredAICompletionStream, getConfiguredMeteredAICompletion } from "@/lib/metering";
import { buildSystemPrompt } from "./system-prompts";
import { executeCommand, parseCommand } from "@/lib/chat/commands";
import { logAI } from "@/lib/logger";
import { logAIInteraction } from "@/lib/ai/knowledge-accumulation";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { ADMIN_TOOLS } from "@/lib/chat/admin-tools";
import { executeAdminTool } from "@/lib/chat/admin-tool-handlers";
import { CHAT_TOOLS, executeToolCall, buildContentCatalog } from "./tools";
import { WIZARD_TOOLS, executeWizardTool } from "@/lib/chat/wizard-tools";
import { buildWizardSystemPrompt } from "@/lib/chat/wizard-system-prompt";
import { computeCurrentPhase } from "@/app/x/get-started-v2/components/wizard-schema";
import { embedText } from "@/lib/embeddings";
import { retrieveKnowledgeForPrompt } from "@/lib/knowledge/retriever";
import { getKnowledgeRetrievalSettings, getSubjectsCatalog } from "@/lib/system-settings";
import { getSourceIdsForDomain, getSourceIdsForPlaybook } from "@/lib/knowledge/domain-sources";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import {
  searchAssertionsHybrid,
  searchAssertions,
  searchCallerMemories,
  formatAssertion,
} from "@/lib/knowledge/assertions";

export const runtime = "nodejs";

type ChatMode = "DATA" | "CALL" | "BUG" | "WIZARD";

interface EntityBreadcrumb {
  type: string;
  id: string;
  label: string;
  data?: Record<string, unknown>;
}

interface BugContextPayload {
  url: string;
  errors: Array<{
    message: string;
    source?: string;
    timestamp: number;
    status?: number;
    stack?: string;
    url?: string;
  }>;
  browser: string;
  viewport: string;
  timestamp: number;
}

interface ChatRequest {
  message: string;
  mode: ChatMode;
  entityContext: EntityBreadcrumb[];
  conversationHistory?: { role: string; content: string }[];
  isCommand?: boolean;
  engine?: AIEngine;
  callId?: string; // Active call ID for media message creation in CALL mode
  bugContext?: BugContextPayload; // Bug report context for BUG mode
  setupData?: Record<string, unknown>; // Current wizard state for WIZARD mode
}

const MAX_TOOL_ITERATIONS = 5;

/**
 * @api POST /api/chat
 * @visibility internal
 * @scope chat:send
 * @auth session
 * @tags chat
 * @description Sends a message to the AI chat assistant. Supports DATA mode (tool calling for database queries and spec updates), CALL mode (voice call simulation with content sharing), and BUG mode (bug diagnosis with source code awareness). Returns a streaming text response. Handles slash commands separately. Logs interactions for AI knowledge accumulation.
 * @body message string - User message text (required)
 * @body mode string - Chat mode: "DATA" | "CALL" | "BUG"
 * @body entityContext EntityBreadcrumb[] - Current UI context breadcrumbs
 * @body conversationHistory object[] - Previous conversation messages
 * @body engine string - AI engine to use (optional, uses default if not specified)
 * @body bugContext object - Bug report context for BUG mode (url, errors, browser, viewport, timestamp)
 * @response 200 text/plain (streaming response)
 * @response 400 { ok: false, error: "Message is required" }
 * @response 500 { ok: false, error: "...", errorCode: "BILLING" | "AUTH" | "RATE_LIMIT" | ... }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;
    const userRole = authResult.session.user.role;

    const body: ChatRequest = await request.json();
    const { message, mode, entityContext, conversationHistory = [], engine, callId: requestCallId, bugContext, setupData } = body;

    if (!message?.trim()) {
      return NextResponse.json({ ok: false, error: "Message is required" }, { status: 400 });
    }

    // WIZARD mode: handle early (has its own system prompt, no slash commands)
    if (mode === "WIZARD") {
      const userId = authResult.session.user.id;
      const isCommunity = setupData?.defaultDomainKind === "COMMUNITY";
      const { phase: currentPhase, phaseIndex, phaseFields } = computeCurrentPhase(
        setupData || {},
        !!isCommunity,
      );
      const subjectsCatalog = await getSubjectsCatalog();
      const wizardPrompt = buildWizardSystemPrompt(setupData || {}, currentPhase, phaseIndex, phaseFields, subjectsCatalog);
      // Deduplicate: client includes the current message in conversationHistory
      const lastHist = conversationHistory[conversationHistory.length - 1];
      const msgInHistory = lastHist?.role === "user" && lastHist?.content === message.trim();

      const wizardMessages: AIMessage[] = [
        { role: "system", content: wizardPrompt },
        ...conversationHistory.slice(-40).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        ...(msgInHistory ? [] : [{ role: "user" as const, content: message.trim() }]),
      ];
      const aiConfig = await getAIConfig("wizard.get-started");
      const selectedEngine = engine || aiConfig.provider;
      return await handleWizardModeWithTools(
        wizardMessages, "wizard.get-started", engine, selectedEngine, mode,
        message, entityContext, conversationHistory, userId, setupData,
      );
    }

    // Check for slash command
    const parsed = parseCommand(message);
    if (parsed) {
      const result = await executeCommand(message, entityContext, mode as "DATA" | "CALL" | "BUG");
      return NextResponse.json(result);
    }

    // Build mode-specific system prompt with terminology
    const userInstitutionId = authResult.session.user.institutionId;
    const systemPrompt = await buildSystemPrompt(mode as "DATA" | "CALL" | "BUG", entityContext, bugContext, userRole, userInstitutionId);

    // Prepare messages with conversation history
    const lastHistoryMessage = conversationHistory[conversationHistory.length - 1];
    const isUserMessageInHistory = lastHistoryMessage?.role === "user" && lastHistoryMessage?.content === message.trim();

    const messages: AIMessage[] = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      ...(isUserMessageInHistory ? [] : [{ role: "user" as const, content: message.trim() }]),
    ];

    // @ai-call chat.{data|call} — Chat per mode (DATA with tools, CALL with voice sim) | config: /x/ai-config
    const callPoint = `chat.${mode.toLowerCase()}`;
    const aiConfig = await getAIConfig(callPoint);
    const selectedEngine = engine || aiConfig.provider;

    // DATA mode: use tool calling with non-streaming loop
    if (mode === "DATA") {
      const userId = authResult.session.user.id;
      return await handleDataModeWithTools(messages, callPoint, engine, selectedEngine, mode, message, entityContext, conversationHistory, userRole, userId);
    }

    // CALL mode: per-turn knowledge retrieval (matches what VAPI does live)
    if (mode === "CALL") {
      const callerEntity = entityContext.find((e) => e.type === "caller");

      // Retrieve relevant knowledge for this message (fire-and-forget on error)
      const knowledgeBlock = await retrieveSimKnowledge(message, callerEntity?.id, conversationHistory);
      if (knowledgeBlock && messages[0]?.role === "system" && typeof messages[0].content === "string") {
        messages[0].content += knowledgeBlock;
      }

      if (callerEntity && requestCallId) {
        return await handleCallModeWithTools(
          messages, callPoint, engine, selectedEngine, mode, message,
          entityContext, conversationHistory, callerEntity.id, requestCallId
        );
      }

      // @ai-call chat.call — Streaming CALL mode (no callId) | config: /x/ai-config
      const { stream: meteredStream } = await getConfiguredMeteredAICompletionStream(
        {
          callPoint,
          engineOverride: engine,
          messages,
        },
        { sourceOp: callPoint }
      );

      logChatRequest(mode, message, selectedEngine, conversationHistory, entityContext);

      return new Response(meteredStream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "X-Chat-Mode": mode,
          "X-AI-Engine": selectedEngine,
        },
      });
    }

    // BUG mode: streaming diagnosis, no tool calling
    if (mode === "BUG") {
      // @ai-call chat.bug — Bug diagnosis with code context | config: /x/ai-config
      const callPoint = "chat.bug";

      const { stream: meteredStream } = await getConfiguredMeteredAICompletionStream(
        {
          callPoint,
          engineOverride: engine,
          messages,
        },
        { sourceOp: callPoint }
      );

      logChatRequest(mode, message, selectedEngine, conversationHistory, entityContext);

      return new Response(meteredStream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "X-Chat-Mode": mode,
          "X-AI-Engine": selectedEngine,
        },
      });
    }

    // Should not reach here
    return NextResponse.json({ ok: false, error: "Invalid chat mode" }, { status: 400 });
  } catch (error) {
    console.error("Chat API error:", error);
    const errorMessage = parseAIError(error);
    return NextResponse.json(
      { ok: false, error: errorMessage, errorCode: getErrorCode(error) },
      { status: 500 }
    );
  }
}

/**
 * DATA mode with tool calling.
 * Uses non-streaming for the tool loop, then returns final text.
 */
async function handleDataModeWithTools(
  messages: AIMessage[],
  callPoint: string,
  engine: AIEngine | undefined,
  selectedEngine: string,
  mode: ChatMode,
  message: string,
  entityContext: EntityBreadcrumb[],
  conversationHistory: { role: string; content: string }[],
  userRole: string,
  userId: string,
): Promise<Response> {
  const loopMessages: AIMessage[] = [...messages];
  let toolCallCount = 0;
  let finalContent = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // @ai-call chat.data — Non-streaming with tools | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint,
        engineOverride: engine,
        messages: loopMessages,
        tools: ADMIN_TOOLS,
      },
      { sourceOp: `${callPoint}.tools` }
    );

    // If no tool calls, we're done
    if (!response.toolUses || response.toolUses.length === 0) {
      finalContent = response.content;
      break;
    }

    // Model wants to use tools
    toolCallCount += response.toolUses.length;

    // Add assistant's response (with tool_use blocks) to the conversation
    loopMessages.push({
      role: "assistant",
      content: response.rawContentBlocks || [{ type: "text", text: response.content }],
    });

    // Execute each tool and collect results
    const toolResultBlocks: ContentBlock[] = [];
    for (const toolUse of response.toolUses) {
      console.log(`[chat-tools] Executing tool: ${toolUse.name}`, JSON.stringify(toolUse.input).slice(0, 200));
      const result = await executeAdminTool(toolUse.name, toolUse.input, userRole as any, { userId });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Add tool results as a user message
    loopMessages.push({
      role: "user",
      content: toolResultBlocks,
    });
  }

  // If loop exhausted without final content, use the last response
  if (!finalContent) {
    finalContent = "I used several tools but couldn't complete the request. Please try again with a more specific question.";
  }

  logChatRequest(mode, message, selectedEngine, conversationHistory, entityContext, toolCallCount);

  // Return as streaming-style response for consistency with other modes
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(finalContent));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Chat-Mode": mode,
      "X-AI-Engine": selectedEngine,
      "X-Tool-Calls": toolCallCount.toString(),
    },
  });
}

/**
 * CALL mode with content sharing tools.
 * Checks if teaching materials are available; if so, enables share_content tool.
 * Uses non-streaming for the tool loop, then returns final text as a stream.
 */
async function handleCallModeWithTools(
  messages: AIMessage[],
  callPoint: string,
  engine: AIEngine | undefined,
  selectedEngine: string,
  mode: ChatMode,
  message: string,
  entityContext: EntityBreadcrumb[],
  conversationHistory: { role: string; content: string }[],
  callerId: string,
  callId: string,
): Promise<Response> {
  // Check if there's any content to share
  const catalog = await buildContentCatalog(callerId);

  // No content available — fall back to standard streaming (no tools needed)
  if (!catalog) {
    // @ai-call chat.call — Streaming CALL mode (no content catalog) | config: /x/ai-config
    const { stream: meteredStream } = await getConfiguredMeteredAICompletionStream(
      {
        callPoint,
        engineOverride: engine,
        messages,
      },
      { sourceOp: callPoint }
    );

    logChatRequest(mode, message, selectedEngine, conversationHistory, entityContext);

    return new Response(meteredStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Chat-Mode": mode,
        "X-AI-Engine": selectedEngine,
      },
    });
  }

  // Inject content catalog into system prompt.
  // Strip [VISUAL AIDS] section from the voice prompt first — the content catalog
  // is a superset (same media + share_content tool instructions). Without this,
  // the AI sees the same document listed twice and sends it twice.
  const systemMsg = messages[0];
  if (systemMsg?.role === "system" && typeof systemMsg.content === "string") {
    systemMsg.content = systemMsg.content.replace(
      /\[VISUAL AIDS\]\n[\s\S]*?(?=\n\[(?:PEDAGOGY MODE|ACTIVITIES|RETRIEVAL|OPENING|RULES)\]|\n*$)/,
      "",
    );
    systemMsg.content += catalog;
  }

  // Tool loop (same pattern as DATA mode)
  const loopMessages: AIMessage[] = [...messages];
  let toolCallCount = 0;
  let finalContent = "";
  const toolCtx = { callerId, callId };

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // @ai-call chat.call — Non-streaming with content tools | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint,
        engineOverride: engine,
        messages: loopMessages,
        tools: CHAT_TOOLS,
      },
      { sourceOp: `${callPoint}.tools`, callerId, callId }
    );

    // No tool calls — done
    if (!response.toolUses || response.toolUses.length === 0) {
      finalContent = response.content;
      break;
    }

    toolCallCount += response.toolUses.length;

    // Add assistant's response to conversation
    loopMessages.push({
      role: "assistant",
      content: response.rawContentBlocks || [{ type: "text", text: response.content }],
    });

    // Execute tools and collect results
    const toolResultBlocks: ContentBlock[] = [];
    for (const toolUse of response.toolUses) {
      console.log(`[chat-tools:call] Executing: ${toolUse.name}`, JSON.stringify(toolUse.input).slice(0, 200));
      const result = await executeToolCall(toolUse, toolCtx);
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: result.tool_use_id,
        content: result.content,
        ...(result.is_error ? { is_error: true } : {}),
      });
    }

    loopMessages.push({
      role: "user",
      content: toolResultBlocks,
    });
  }

  if (!finalContent) {
    finalContent = "Let me continue our conversation.";
  }

  logChatRequest(mode, message, selectedEngine, conversationHistory, entityContext, toolCallCount);

  // Return as streaming-style response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(finalContent));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Chat-Mode": mode,
      "X-AI-Engine": selectedEngine,
      "X-Tool-Calls": toolCallCount.toString(),
    },
  });
}

/** Contextual fallback when the AI tool loop ends without producing text. */
function buildWizardFallback(toolCalls: Array<{ name: string; input: Record<string, unknown> }>): string {
  const names = new Set(toolCalls.map((tc) => tc.name));

  if (names.has("show_actions")) return "Here's a summary of your setup. Ready to create your course?";
  if (names.has("show_upload")) return "Now let's add some teaching content for your course.";
  if (names.has("show_sliders")) return "Let's fine-tune the AI tutor's personality.";

  if (names.has("show_options")) {
    // Use the question header from the show_options tool so the user knows what's being asked
    const optionCall = toolCalls.find((tc) => tc.name === "show_options");
    const question = optionCall?.input?.question as string | undefined;
    return question ? `Choose your **${question.toLowerCase()}** below.` : "Pick an option below.";
  }

  if (names.has("update_setup")) {
    // Summarise what was actually saved using field values
    const updateCalls = toolCalls.filter((tc) => tc.name === "update_setup");
    const allFields: Record<string, unknown> = {};
    for (const tc of updateCalls) {
      const fields = tc.input.fields as Record<string, unknown> | undefined;
      if (fields) Object.assign(allFields, fields);
    }
    const parts: string[] = [];
    if (allFields.institutionName) parts.push(String(allFields.institutionName));
    if (allFields.courseName) parts.push(`${allFields.courseName} course`);
    if (allFields.interactionPattern) parts.push(`${allFields.interactionPattern} approach`);
    if (allFields.teachingMode) parts.push(`${allFields.teachingMode} emphasis`);
    if (allFields.sessionCount) parts.push(`${allFields.sessionCount} sessions`);
    if (allFields.durationMins) parts.push(`${allFields.durationMins} min each`);
    if (allFields.welcomeMessage) parts.push("welcome message");
    if (parts.length > 0) return `Got it — ${parts.join(", ")}.`;
    return "Got it, saved that.";
  }

  if (names.has("show_suggestions")) return "";
  return "";
}

/**
 * WIZARD mode with tool calling.
 * Uses non-streaming tool loop (same pattern as DATA mode) with wizard-specific tools.
 * Returns the final text response + raw content blocks (so the client can extract tool_use blocks).
 */
async function handleWizardModeWithTools(
  messages: AIMessage[],
  callPoint: string,
  engine: AIEngine | undefined,
  selectedEngine: string,
  mode: ChatMode,
  message: string,
  entityContext: EntityBreadcrumb[],
  conversationHistory: { role: string; content: string }[],
  userId: string,
  setupData?: Record<string, unknown>,
): Promise<Response> {
  const loopMessages: AIMessage[] = [...messages];
  let toolCallCount = 0;
  let finalContent = "";
  let allToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // @ai-call wizard.get-started — Non-streaming with wizard tools | config: /x/ai-config
    const response = await getConfiguredMeteredAICompletion(
      {
        callPoint,
        engineOverride: engine,
        messages: loopMessages,
        tools: WIZARD_TOOLS,
      },
      { sourceOp: `${callPoint}.tools`, userId }
    );

    // If no tool calls, we're done
    if (!response.toolUses || response.toolUses.length === 0) {
      finalContent = response.content;
      break;
    }

    // Capture text from responses that also include tool calls — the AI often
    // sends a conversational acknowledgment alongside tools (e.g. "Great choice —
    // Socratic works well for science!" + show_options). Always take the LATEST
    // text so multi-round entity resolution doesn't lose the final contextual reply.
    if (response.content) {
      finalContent = response.content;
    }

    // Model wants to use tools
    toolCallCount += response.toolUses.length;

    // Collect tool calls for the client — separate data tools from UI tools
    // to ensure auto-injected update_setup (entity IDs) is processed BEFORE
    // show_* tools that render panels dependent on those IDs.
    const showToolNames = new Set(["show_options", "show_sliders", "show_upload", "show_actions"]);
    let sawShowTool = false;
    const deferredShowTools: Array<{ name: string; input: Record<string, unknown> }> = [];
    for (const tu of response.toolUses) {
      if (showToolNames.has(tu.name)) {
        if (sawShowTool) {
          console.warn(`[wizard-tools] Dropping duplicate show_* tool: ${tu.name}`);
          continue;
        }
        sawShowTool = true;
        // Defer show_* tools — push them AFTER auto-injected data updates
        deferredShowTools.push({ name: tu.name, input: tu.input });
        continue;
      }
      allToolCalls.push({ name: tu.name, input: tu.input });
    }

    // Add assistant's response to conversation
    loopMessages.push({
      role: "assistant",
      content: response.rawContentBlocks || [{ type: "text", text: response.content }],
    });

    // Execute each tool and collect results.
    // mergedSetupData accumulates fields from earlier tools so later tools (e.g. show_upload)
    // see the latest state — not just the client's stale snapshot.
    const mergedSetupData: Record<string, unknown> = { ...(setupData ?? {}) };
    const toolResultBlocks: ContentBlock[] = [];
    for (const toolUse of response.toolUses) {
      console.log(`[wizard-tools] Executing: ${toolUse.name}`, JSON.stringify(toolUse.input).slice(0, 200));
      const result = await executeWizardTool(toolUse.name, toolUse.input, userId, mergedSetupData);
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.content,
        ...(result.is_error ? { is_error: true } : {}),
      });

      // Merge update_setup fields into running state so subsequent tools see them
      if (toolUse.name === "update_setup") {
        const fields = toolUse.input.fields as Record<string, unknown> | undefined;
        if (fields) Object.assign(mergedSetupData, fields);
      }

      // Auto-inject update_setup so the client always gets resolved IDs
      // (don't rely on the AI remembering to call update_setup after creation/resolution)
      if (!result.is_error) {
        // 1. Entity resolution: autoInjectFields from update_setup (institution/course/subject resolution)
        if (result.autoInjectFields && Object.keys(result.autoInjectFields).length > 0) {
          allToolCalls.push({
            name: "update_setup",
            input: { fields: result.autoInjectFields },
          });
          // Also merge into running state for later tools in this iteration
          Object.assign(mergedSetupData, result.autoInjectFields);
        }
        // 2. Creation tools: extract IDs from JSON result
        try {
          const data = JSON.parse(result.content);
          if (data.ok && toolUse.name === "create_institution") {
            const creationFields = { draftDomainId: data.domainId, draftInstitutionId: data.institutionId };
            allToolCalls.push({
              name: "update_setup",
              input: { fields: creationFields },
            });
            Object.assign(mergedSetupData, creationFields);
          } else if (data.ok && toolUse.name === "create_course") {
            const creationFields = { draftPlaybookId: data.playbookId, draftCallerId: data.callerId };
            allToolCalls.push({
              name: "update_setup",
              input: { fields: creationFields },
            });
            Object.assign(mergedSetupData, creationFields);
            // Auto-inject mark_complete so the success card reliably appears
            allToolCalls.push({ name: "mark_complete", input: {} });
          }
        } catch { /* non-JSON result — no injection needed */ }
      }
    }

    // Now append deferred show_* tools AFTER all data updates are queued
    // This ensures the client processes entity IDs before rendering panels
    allToolCalls.push(...deferredShowTools);

    loopMessages.push({
      role: "user",
      content: toolResultBlocks,
    });

    // If the last tool was a show_* or mark_complete, the AI should give text next round
    // (the tool result says "Panel displayed, wait for response" so the AI will naturally provide text)
  }

  if (!finalContent) {
    // Contextual fallback based on what tools were called — avoids a static boring string
    finalContent = buildWizardFallback(allToolCalls);
  }

  logChatRequest(mode, message, selectedEngine, conversationHistory, entityContext, toolCallCount);

  // Return as JSON (not streaming) so the client can access tool calls
  const responsePayload = {
    content: finalContent,
    toolCalls: allToolCalls,
    toolCallCount,
  };

  return NextResponse.json(responsePayload, {
    headers: {
      "X-Chat-Mode": mode,
      "X-AI-Engine": selectedEngine,
      "X-Tool-Calls": toolCallCount.toString(),
    },
  });
}

/**
 * Per-turn knowledge retrieval for sim calls.
 * Mirrors what VAPI gets via /api/vapi/knowledge on every conversation turn.
 * Returns a formatted text block to append to the system prompt, or null.
 */
async function retrieveSimKnowledge(
  message: string,
  callerId: string | undefined,
  conversationHistory: { role: string; content: string }[],
): Promise<string | null> {
  try {
    // Load retrieval settings (30s cache)
    const ks = await getKnowledgeRetrievalSettings();

    // Build query from last N user messages (same as VAPI endpoint)
    const recentUserMessages = conversationHistory
      .filter((m) => m.role === "user")
      .slice(-(ks.queryMessageCount - 1))
      .map((m) => m.content);
    recentUserMessages.push(message);
    const queryText = recentUserMessages.join(" ");

    if (!queryText.trim()) return null;

    // Resolve course-scoped content source IDs (playbook-scoped, domain fallback)
    let sourceIds: string[] | undefined;
    if (callerId) {
      const playbookId = await resolvePlaybookId(callerId);
      if (playbookId) {
        sourceIds = await getSourceIdsForPlaybook(playbookId);
      } else {
        const { prisma } = await import("@/lib/prisma");
        const caller = await prisma.caller.findUnique({
          where: { id: callerId },
          select: { domainId: true },
        });
        if (caller?.domainId) {
          sourceIds = await getSourceIdsForDomain(caller.domainId);
        }
      }
    }

    // Embed query text for vector search
    let queryEmbedding: number[] | undefined;
    try {
      queryEmbedding = await embedText(queryText);
    } catch {
      // Fall back to keyword-only — don't block the sim call
    }

    // Run retrieval strategies in parallel — scoped to caller's domain
    const [knowledgeResults, assertionResults, memoryResults] = await Promise.all([
      // NOTE: KnowledgeChunk has no domain FK — stays unscoped until schema migration
      retrieveKnowledgeForPrompt({
        queryText,
        queryEmbedding,
        callerId,
        limit: ks.chunkLimit,
        minRelevance: ks.minRelevance,
      }),
      queryEmbedding
        ? searchAssertionsHybrid(queryText, queryEmbedding, ks.assertionLimit, ks.minRelevance, sourceIds)
        : searchAssertions(queryText, ks.assertionLimit, sourceIds),
      callerId ? searchCallerMemories(callerId, queryText, ks.memoryLimit) : Promise.resolve([]),
    ]);

    // Format results
    const lines: string[] = [];

    for (const a of assertionResults) {
      lines.push(formatAssertion(a));
    }
    for (const k of knowledgeResults) {
      lines.push(k.title ? `[${k.title}] ${k.content}` : k.content);
    }
    for (const m of memoryResults) {
      lines.push(`[Memory] ${m.key}: ${m.value}`);
    }

    if (lines.length === 0) return null;

    // Sort by relevance already done in individual searches
    const allResults = [
      ...assertionResults.map((a) => ({ text: formatAssertion(a), score: a.relevanceScore })),
      ...knowledgeResults.map((k) => ({ text: k.title ? `[${k.title}] ${k.content}` : k.content, score: k.relevanceScore })),
      ...memoryResults.map((m) => ({ text: `[Memory] ${m.key}: ${m.value}`, score: m.relevanceScore })),
    ];
    allResults.sort((a, b) => b.score - a.score);
    const top = allResults.slice(0, ks.topResults);

    console.log(
      `[sim/knowledge] ${top.length} results ` +
        `(assertions: ${assertionResults.length}, chunks: ${knowledgeResults.length}, memories: ${memoryResults.length}, vector: ${!!queryEmbedding})`,
    );

    return `\n\n[RELEVANT TEACHING MATERIAL FOR THIS TURN]\nUse the following content to inform your response. Reference specific facts when relevant.\n${top.map((r) => `- ${r.text}`).join("\n")}`;
  } catch (err) {
    console.warn("[sim/knowledge] Retrieval failed, continuing without:", err);
    return null;
  }
}

/**
 * Log chat request metadata
 */
function logChatRequest(
  mode: string,
  message: string,
  selectedEngine: string,
  conversationHistory: { role: string; content: string }[],
  entityContext: EntityBreadcrumb[],
  toolCalls?: number,
) {
  const promptSummary = `[${mode}] ${message.slice(0, 200)}${message.length > 200 ? "..." : ""}`;
  logAI("chat", promptSummary, "(streaming)", {
    mode,
    engine: selectedEngine,
    messageLength: message.length,
    historyLength: conversationHistory.length,
    entityContext: entityContext.map((e) => `${e.type}:${e.id}`).join(", "),
    ...(toolCalls ? { toolCalls } : {}),
  });

  const entityInfo = entityContext.length > 0 ? entityContext[0] : null;
  logAIInteraction({
    callPoint: `chat.${mode.toLowerCase()}`,
    userMessage: message,
    aiResponse: "(streaming response)",
    outcome: "success",
    metadata: {
      entityType: entityInfo?.type,
      entityId: entityInfo?.id,
      action: "chat",
      model: selectedEngine,
      provider: selectedEngine,
      ...(toolCalls ? { toolCalls } : {}),
    },
  }).catch(console.error);
}

/**
 * Parse AI provider errors into user-friendly messages
 */
/**
 * Parse AI error to user-friendly message
 */
function parseAIError(error: unknown): string {
  const code = classifyAIError(error);
  return userMessageForError(code);
}

/**
 * Extract error code for frontend handling
 */
function getErrorCode(error: unknown): string {
  const code = classifyAIError(error);

  // Map AIErrorCode to backwards-compatible codes for existing frontend
  const codeMap: Record<string, string> = {
    RATE_LIMIT: "RATE_LIMIT",
    TIMEOUT: "NETWORK",
    AUTH: "AUTH",
    BILLING: "BILLING",
    CONTENT_POLICY: "CONTENT_POLICY",
    PARSE_ERROR: "API_ERROR",
    NETWORK: "NETWORK",
    MODEL: "MODEL",
    UNKNOWN: "API_ERROR",
  };

  return codeMap[code] || "API_ERROR";
}
