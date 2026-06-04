import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { renderProviderPrompt } from "@/lib/prompt/composition/renderPromptSummary";
import { getVoiceProvider } from "@/lib/voice/provider-factory";
import { getVoiceCallSettings } from "@/lib/system-settings";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { VAPI_TOOL_DEFINITIONS, TOOL_SETTING_KEYS } from "../tools/route";

export const runtime = "nodejs";

/**
 * @api POST /api/vapi/assistant-request
 * @visibility public
 * @scope vapi:assistant
 * @auth webhook-secret
 * @tags vapi, composition, calls
 * @description VAPI calls this at call start to get a per-caller assistant
 *   config. Route identifies caller by phone number and loads their active
 *   ComposedPrompt; the VapiProvider adapter (#1017) renders the provider-
 *   shaped assistant payload (model + tools + serverUrl + knowledgePlan).
 *   Must respond within 7.5 seconds.
 *
 *   VAPI Server URL event: "assistant-request"
 *   Ref: https://docs.vapi.ai/server-url/events
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const provider = await getVoiceProvider("vapi");
    const authError = provider.verifyInboundRequest(request, rawBody);
    if (authError) return authError;

    const body = JSON.parse(rawBody);

    // VAPI sends various event types to the Server URL
    const messageType = body.message?.type || body.type;

    if (messageType !== "assistant-request") {
      // For non-assistant-request events, acknowledge and return
      return NextResponse.json({ ok: true });
    }

    // Extract caller phone from VAPI call data
    const customerPhone =
      body.message?.call?.customer?.number ||
      body.call?.customer?.number ||
      null;

    if (!customerPhone) {
      console.warn("[vapi/assistant-request] No customer phone number in request (missing field)");
      return NextResponse.json(
        { error: "No customer phone number provided" },
        { status: 400 },
      );
    }

    // Load voice call settings (30s cache — hot-configurable via Settings UI)
    const vs = await getVoiceCallSettings();
    const serverUrlBase = `${config.app.url}/api/vapi`;

    // Build tool definitions — only include tools enabled in settings.
    // Sourced from VAPI_TOOL_DEFINITIONS today; #1019 migrates the source
    // to the TOOLS-001 spec without changing the AssistantRequestContext shape.
    // Cast to ProviderToolDefinition[] — VAPI_TOOL_DEFINITIONS uses a wider
    // `type: string` inference; the canonical type narrows to `"function"`.
    const enabledTools = VAPI_TOOL_DEFINITIONS
      .filter((tool) => {
        const settingKey = TOOL_SETTING_KEYS[tool.function.name];
        return settingKey ? (vs as any)[settingKey] : true;
      }) as unknown as import("@/lib/voice/types").ProviderToolDefinition[];

    // Normalize phone (strip spaces, ensure +)
    const normalizedPhone = customerPhone.replace(/\s+/g, "");

    // Find caller by phone
    const caller = await prisma.caller.findFirst({
      where: { phone: normalizedPhone },
      select: { id: true, name: true, phone: true },
    });

    if (!caller) {
      console.warn(`[vapi/assistant-request] No caller found for phone: ***${normalizedPhone.slice(-4)}`);
      const unknownCallerAssistant = provider.buildAssistantConfig({
        callerId: null,
        callerName: null,
        customerPhone: normalizedPhone,
        voicePrompt: vs.unknownCallerPrompt,
        firstLine: "Hello! I don't think we've spoken before. What's your name?",
        toolDefinitions: [],
        knowledgePlanEnabled: false,
        serverUrlBase,
        modelConfig: { provider: vs.provider, model: vs.model },
        unknownCallerPrompt: vs.unknownCallerPrompt,
        noActivePromptFallback: vs.noActivePromptFallback,
      });
      return NextResponse.json(unknownCallerAssistant);
    }

    // Resolve default playbook for course-scoped prompt lookup
    const defaultPlaybookId = await resolvePlaybookId(caller.id);

    // Load the active ComposedPrompt for this caller (scoped to default playbook if set)
    const composedPrompt = await prisma.composedPrompt.findFirst({
      where: {
        callerId: caller.id,
        status: "active",
        ...(defaultPlaybookId ? { playbookId: defaultPlaybookId } : {}),
      },
      orderBy: { composedAt: "desc" },
      select: {
        id: true,
        llmPrompt: true,
        prompt: true,
      },
    });

    if (!composedPrompt?.llmPrompt) {
      console.warn(`[vapi/assistant-request] No active prompt for caller: ${caller.id}`);
      const callerLabel = caller.name || "a returning caller";
      const fallbackAssistant = provider.buildAssistantConfig({
        callerId: caller.id,
        callerName: caller.name,
        customerPhone: normalizedPhone,
        voicePrompt: `${vs.noActivePromptFallback} The caller is ${callerLabel}.`,
        firstLine: `Hi${caller.name ? ` ${caller.name}` : ""}! Good to hear from you.`,
        toolDefinitions: [],
        knowledgePlanEnabled: false,
        serverUrlBase,
        modelConfig: { provider: vs.provider, model: vs.model },
        unknownCallerPrompt: vs.unknownCallerPrompt,
        noActivePromptFallback: vs.noActivePromptFallback,
      });
      return NextResponse.json(fallbackAssistant);
    }

    // Render voice-optimized prompt from the stored llmPrompt
    const voicePrompt = renderProviderPrompt(composedPrompt.llmPrompt as any);
    const firstLine = (composedPrompt.llmPrompt as any)?._quickStart?.first_line ?? null;

    console.log(
      `[vapi/assistant-request] Serving prompt for caller ${caller.id}: ${voicePrompt.length} chars (provider: ${vs.provider}, model: ${vs.model}, rag: ${vs.knowledgePlanEnabled})`,
    );

    const assistantConfig = provider.buildAssistantConfig({
      callerId: caller.id,
      callerName: caller.name,
      customerPhone: normalizedPhone,
      voicePrompt,
      firstLine,
      toolDefinitions: enabledTools,
      knowledgePlanEnabled: vs.knowledgePlanEnabled,
      serverUrlBase,
      modelConfig: { provider: vs.provider, model: vs.model },
      unknownCallerPrompt: vs.unknownCallerPrompt,
      noActivePromptFallback: vs.noActivePromptFallback,
    });

    return NextResponse.json(assistantConfig);
  } catch (error: any) {
    console.error("[vapi/assistant-request] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal error" },
      { status: 500 },
    );
  }
}
