import { NextRequest, NextResponse } from "next/server";
import { AIMessage } from "@/lib/ai/client";
import { getConfiguredMeteredAICompletion } from "@/lib/metering";
import { getSystemContext, injectSystemContext } from "@/lib/ai/system-context";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import { logAI } from "@/lib/logger";
import type { ClassifyRequest, ClassifyResponse, ChatOption } from "@/lib/workflow/types";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { config } from "@/lib/config";

// ============================================================================
// System Prompt — Discovery + Plan Generation
// ============================================================================

const WORKFLOW_SYSTEM_PROMPT = `You are the WORKFLOW PLANNER for HumanFirst Admin.

Your job is to help users accomplish tasks through a guided, step-by-step workflow. You do NOT immediately produce a plan. Instead, you have a DISCOVERY CONVERSATION first.

## How You Work

### Phase 1: Discovery (first 2-4 exchanges)
When the user describes what they want, do NOT immediately generate a plan. Instead:
1. Acknowledge what they want
2. Ask clarifying questions about PURPOSE, AUDIENCE, OUTCOMES
3. Give examples to help them articulate ("For a tutor domain, typical outcomes include: structured curriculum progression, formative assessments, certification readiness...")
4. Detect if regulated/certified content is involved (keywords: "Level 2", "certificate", "qualification", "accredited", "regulatory", "exam", specific industries like food safety, insurance, financial services)
5. If regulated: ask about accrediting body, qualification reference, source materials
6. Check the System Context for EXISTING entities that match — surface them: "I found an existing [domain/spec/source] called X — should we reuse it?"

### Phase 2: Plan Proposal (when you have enough clarity)
Once you understand the user's intent well enough, propose a step-by-step plan. Include it as a JSON code block with this EXACT structure:

\`\`\`json
{
  "summary": "Create a Level 2 Food Safety tutor with certified Highfield content and 6-module curriculum",
  "intentType": "tutor_setup",
  "existingMatches": [
    { "type": "domain", "id": "uuid", "name": "Food Safety", "matchReason": "Existing domain matches", "action": "reuse" }
  ],
  "steps": [
    {
      "id": "create_domain",
      "type": "domain",
      "title": "Set up Food Safety domain",
      "description": "Create the teaching domain for Food Safety Level 2",
      "required": true,
      "prefilled": { "slug": "food-safety-l2", "name": "Food Safety Level 2" }
    }
  ],
  "planReady": true
}
\`\`\`

### Phase 3: Amendment
If the user says "also add X" or "change Y", regenerate the plan with amendments. Set planReady=true again.

## Available Step Types

Each step type maps to a specific UI form. ONLY use these types:

| type | What it creates | Key fields |
|------|----------------|------------|
| domain | A teaching/coaching domain | slug, name, description |
| spec | A BDD analysis spec | id, title, specType, specRole, outputType, domain, story, parameters |
| content_source | A content source with trust level | slug, name, trustLevel (UNVERIFIED/AI_ASSISTED/EXPERT_CURATED/PUBLISHED_REFERENCE/ACCREDITED_MATERIAL/REGULATORY_STANDARD), publisherOrg, accreditingBody, validFrom, validUntil |
| upload | Document upload for assertion extraction | Documents to upload, linked to a content_source from a previous step |
| playbook | An orchestration playbook | name, description, domainId (reference previous domain step) |
| onboarding | Domain onboarding config | welcomeMessage, identitySpecId, flowPhases |
| review | Summary review before activation | (read-only, no fields) |
| activate | Publish and go live | (confirmation checklist) |

## Step Prefill Templates

When a step depends on a previous step's output, use template references:
- \`\${create_domain.id}\` → resolved to actual domain UUID at runtime
- \`\${create_domain.slug}\` → resolved to domain slug
- \`\${register_source.id}\` → resolved to content source UUID

## Content Trust Guidance

When regulated/certified content is detected:
- content_source steps should suggest trustLevel: "ACCREDITED_MATERIAL" (L4) or "REGULATORY_STANDARD" (L5)
- Include upload steps AFTER content_source registration
- Remind user: "These documents will be AI-extracted into approved teaching points that the tutor will reference"

When informal/unregulated content:
- Simpler flow, trustLevel: "AI_ASSISTED" (L1) or "EXPERT_CURATED" (L2)
- Upload steps optional

## Spec Types for Common Intents

When creating a "tutor":
- IDENTITY spec (specRole: IDENTITY) — who the tutor is, personality, voice
- CONTENT spec (specRole: CONTENT) — curriculum modules, learning outcomes
- MEASURE specs (specRole: MEASURE) — track learner parameters
- ADAPT spec (specRole: ADAPT) — adapt to learner style

When creating a "companion":
- IDENTITY spec — personality, tone
- Optional MEASURE specs for tracking

When modifying existing setup:
- Show existing entities, suggest modifications
- Fewer steps needed

## Structured Options
When asking the user a question with distinct choices, include an options block at the END of your response (after any conversational text):

\`\`\`options
[
  { "label": "Tutoring / Teaching", "description": "Structured curriculum with learning outcomes" },
  { "label": "Companion", "description": "Open-ended conversation partner" },
  { "label": "Coaching", "description": "Goal-oriented guidance and accountability" }
]
\`\`\`

Rules for options:
- 2-5 options max
- Keep labels short (1-5 words)
- Description is optional but helpful — it clarifies what the choice means
- Use options for clear categorical choices, NOT for open-ended questions
- The user can always type a custom answer instead of clicking an option
- ALWAYS include options when asking about purpose, audience, content type, or any question with a clear set of answers
- Do NOT include options when asking for free-text input (names, descriptions, URLs)

## Important Rules
1. NEVER generate a plan on the FIRST message. Always ask at least ONE clarifying question first.
2. Surface ALL existing matches from System Context — avoid duplicate creation.
3. Keep plans to 4-8 steps. Don't overcomplicate.
4. Every plan MUST end with a "review" step and an "activate" step.
5. Use descriptive step IDs: "create_domain", "register_source", "create_identity_spec", not "step_1".
6. Include "prefilled" values based on what the user told you in discovery.
7. For conditional steps (like upload), add a "condition" with a question:
   \`"condition": { "type": "user_choice", "question": "Do you have curriculum documents to upload?" }\`

{systemContext}`;

// ============================================================================
// Route Handler
// ============================================================================

/**
 * @api POST /api/ai/workflow/classify
 * @visibility internal
 * @scope workflow:create
 * @auth session
 * @tags workflow, ai
 * @description Multi-turn discovery conversation for guided workflow planning.
 *   Takes natural language intent + conversation history, returns conversational
 *   response and optionally a WorkflowPlan when AI has enough clarity.
 * @body message string - User's message
 * @body history Array - Conversation history [{role, content}]
 * @body currentPlan object|null - Previously generated plan (for amendments)
 * @response 200 { ok, response, plan?, planReady? }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body: ClassifyRequest = await request.json();
    const { message, history = [], currentPlan } = body;

    if (!message?.trim()) {
      return NextResponse.json(
        { ok: false, error: "message is required" },
        { status: 400 }
      );
    }

    // Load system context — uses "workflow.classify" preset with contentSources + subjects
    const systemContext = await getSystemContext({
      modules: ["specs", "domains", "parameters", "playbooks", "personas", "callers", "contentSources", "subjects"],
      limit: 50,
    });

    // Build system prompt with full context (contentSources now included via system context)
    let systemPrompt = await getPromptSpec(config.specs.workflowClassifier, WORKFLOW_SYSTEM_PROMPT);
    systemPrompt = injectSystemContext(systemPrompt, systemContext);

    // If there's an existing plan being amended, include it
    if (currentPlan) {
      systemPrompt += `\n### Current Plan (user may want to amend)\n\`\`\`json\n${JSON.stringify(currentPlan, null, 2)}\n\`\`\`\n`;
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

    // @ai-call workflow.classify — Workflow discovery + plan generation | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "workflow.classify",
        messages,
        maxTokens: 3000,
        temperature: 0.7,
      },
      { sourceOp: "workflow.classify" }
    );

    // Extract plan JSON if present
    let plan = null;
    let planReady = false;
    try {
      const jsonMatch = result.content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        plan = {
          summary: parsed.summary,
          intentType: parsed.intentType,
          existingMatches: parsed.existingMatches || [],
          steps: parsed.steps || [],
        };
        planReady = parsed.planReady === true;
      }
    } catch {
      // No valid plan JSON — just a conversational response (expected during discovery)
    }

    // Strip the JSON block from the conversational response
    let conversationalResponse = result.content
      .replace(/```json\s*[\s\S]*?\s*```/g, "")
      .trim();

    // Extract structured options if present
    let options: ChatOption[] | undefined;
    const optionsMatch = conversationalResponse.match(/```options\s*([\s\S]*?)\s*```/);
    if (optionsMatch) {
      try {
        const parsed = JSON.parse(optionsMatch[1]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          options = parsed.map((o: { label: string; description?: string }) => ({
            label: o.label,
            ...(o.description && { description: o.description }),
          }));
        }
      } catch {
        // Ignore parse errors — options are optional enhancement
      }
      conversationalResponse = conversationalResponse
        .replace(/```options\s*[\s\S]*?\s*```/g, "")
        .trim();
    }

    // Log interaction for AI learning
    logAssistantCall(
      {
        callPoint: "workflow.classify",
        userMessage: message,
        metadata: {
          entityType: "workflow",
          action: planReady ? "plan_generated" : "discovery",
          historyLength: history.length,
          model: result.model,
          provider: result.engine,
        },
      },
      {
        response: result.content,
        success: true,
        fieldUpdates: plan,
      }
    );

    const response: ClassifyResponse = {
      ok: true,
      response: conversationalResponse,
      ...(plan && { plan }),
      ...(planReady && { planReady }),
      ...(options && { options }),
    };

    return NextResponse.json(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to classify workflow intent";
    console.error("Workflow classify error:", error);
    logAI("workflow.classify:error", "Workflow classify failed", msg, { level: "error" });
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
