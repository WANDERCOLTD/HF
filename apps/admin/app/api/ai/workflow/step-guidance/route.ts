import { NextRequest, NextResponse } from "next/server";
import { AIMessage } from "@/lib/ai/client";
import { getConfiguredMeteredAICompletion } from "@/lib/metering";
import { getSystemContext, injectSystemContext } from "@/lib/ai/system-context";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import { logAI } from "@/lib/logger";
import type { StepGuidanceRequest, ClassifyResponse } from "@/lib/workflow/types";
import { requireAuth, isAuthError } from "@/lib/permissions";

// ============================================================================
// System Prompt — Step Execution Guidance
// ============================================================================

const STEP_GUIDANCE_SYSTEM_PROMPT = `You are the STEP GUIDE for HumanFirst Admin workflow execution.

Your job is to help the user fill out the current step's form with intelligent suggestions and guidance.

## How You Work

For each step, you:
1. Understand what the step is trying to accomplish (title + step type)
2. Review the current form state and what fields still need to be filled
3. Ask clarifying questions if needed, or provide direct suggestions
4. Generate field suggestions in JSON format when you have enough information

## Available Step Types and Expected Fields

- **domain**: slug (kebab-case identifier), name, description, identityConfig?
- **spec**: title, specType, specRole, outputType, story?, parameters?
- **content_source**: slug, name, trustLevel, publisherOrg?, accreditingBody?, validFrom?, validUntil?
- **playbook**: name, description, domainId
- **onboarding**: welcomeMessage, identitySpecId, flowPhases?
- **upload**: sourceId, files
- **review**: No input fields (read-only summary)
- **activate**: No input fields (confirmation checklist)

## Field Suggestions

When you have enough information to suggest field values, include them in a JSON block:

\`\`\`fieldUpdates
{
  "slug": "food-safety-l2",
  "name": "Food Safety Level 2",
  "description": "A comprehensive course covering food safety fundamentals..."
}
\`\`\`

These will be auto-applied to the form in the UI.

## Collection Data Context

You have access to previoussteps' collected data, which you can reference. For example:
- If a previous step created a domain, you can reference \`collectedData.create_domain.id\`
- Use this to suggest related content or warn about conflicts

## Important Rules

1. Be conversational first — don't immediately dump all questions.
2. Make suggestions based on the step title and what you know about similar steps.
3. Only include fieldUpdates when you're confident in the suggestions, or when the user explicitly asks.
4. Keep suggestions practical and domain-specific.
5. If the user provides enough info, respond with both conversational guidance AND fieldUpdates.

{systemContext}`;

// ============================================================================
// Route Handler
// ============================================================================

/**
 * @api POST /api/ai/workflow/step-guidance
 * @visibility internal
 * @scope workflow:execute
 * @auth session
 * @tags workflow, ai
 * @description Per-step guidance during workflow execution.
 *   Takes current step type, form state, and user message, returns conversational
 *   guidance + optional field suggestions for auto-fill.
 * @body message string - User's question or request for help
 * @body stepType string - Type of step (domain, spec, content_source, etc)
 * @body stepTitle string - Human-readable step title
 * @body formState object - Current form field values
 * @body collectedData object - Data from previous steps
 * @body history Array - Conversation history [{role, content}]
 * @response 200 { ok, response, fieldUpdates? }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body: StepGuidanceRequest = await request.json();
    const { message, stepType, stepTitle, formState = {}, collectedData = {}, history = [] } = body;

    if (!message?.trim()) {
      return NextResponse.json(
        { ok: false, error: "message is required" },
        { status: 400 }
      );
    }

    if (!stepType) {
      return NextResponse.json(
        { ok: false, error: "stepType is required" },
        { status: 400 }
      );
    }

    // Load system context — include specs, domains, parameters for reference
    const systemContext = await getSystemContext({
      modules: ["specs", "domains", "parameters", "playbooks", "personas"],
      limit: 30,
    });

    // Build system prompt with context
    let systemPrompt = STEP_GUIDANCE_SYSTEM_PROMPT;
    systemPrompt = injectSystemContext(systemPrompt, systemContext);

    // Add current step context
    systemPrompt += `\n### Current Step\n`;
    systemPrompt += `- Type: ${stepType}\n`;
    systemPrompt += `- Title: ${stepTitle}\n`;
    systemPrompt += `- Form State: ${JSON.stringify(formState, null, 2)}\n`;
    if (Object.keys(collectedData).length > 0) {
      systemPrompt += `- Previous Steps Data: ${JSON.stringify(collectedData, null, 2)}\n`;
    }

    // Build messages
    const messages: AIMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      { role: "user", content: message },
    ];

    // @ai-call workflow.step-guidance — Per-step form guidance + field suggestions | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "workflow.step-guidance",
        messages,
        maxTokens: 1500,
        temperature: 0.7,
      },
      { sourceOp: "workflow.step-guidance" }
    );

    // Extract field updates if present
    let fieldUpdates: Record<string, any> | undefined;
    try {
      const fieldsMatch = result.content.match(/```fieldUpdates\s*([\s\S]*?)\s*```/);
      if (fieldsMatch) {
        fieldUpdates = JSON.parse(fieldsMatch[1]);
      }
    } catch {
      // No valid field updates — just conversational guidance
    }

    // Strip the fieldUpdates block from the conversational response
    let conversationalResponse = result.content
      .replace(/```fieldUpdates\s*[\s\S]*?\s*```/g, "")
      .trim();

    // Log interaction
    logAssistantCall(
      {
        callPoint: "workflow.step-guidance",
        userMessage: message,
        metadata: {
          entityType: "workflow",
          action: "step_guidance",
          stepType,
          historyLength: history.length,
          model: result.model,
          provider: result.engine,
        },
      },
      {
        response: result.content,
        success: true,
        fieldUpdates,
      }
    );

    const response: ClassifyResponse = {
      ok: true,
      response: conversationalResponse,
      ...(fieldUpdates && { fieldUpdates }),
    };

    return NextResponse.json(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to provide step guidance";
    console.error("Workflow step-guidance error:", error);
    logAI("workflow.step-guidance:error", "Step guidance failed", msg, { level: "error" });
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
