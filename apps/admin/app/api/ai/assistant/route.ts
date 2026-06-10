import { NextRequest, NextResponse } from "next/server";
import { AIMessage } from "@/lib/ai/client";
import { getConfiguredMeteredAICompletion } from "@/lib/metering";
import { getSystemContext, injectSystemContext, type LocationContext } from "@/lib/ai/system-context";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { getPromptSpec } from "@/lib/prompts/spec-prompts";
import { config } from "@/lib/config";
import { detectUngroundedLearnerClaim } from "@/app/api/chat/factual-grounding-intercept";

const GENERAL_ASSISTANT_SYSTEM_PROMPT = `You are the HUMANFIRST ADMIN AI ASSISTANT, a knowledgeable guide for the HumanFirst Admin application.

## Your Role
You help users navigate, understand, and use the HumanFirst Admin system. You have comprehensive knowledge of:
- Application features, pages, and routes
- System architecture and data flow
- Recent changes and updates
- Best practices and workflows

## HumanFirst Admin Application Structure

### Core Pages & Routes
**Dashboard** (\`/\`)
- Overview of system activity, recent calls, active specs
- Quick stats and analytics

**Callers** (\`/callers\`, \`/callers/[id]\`)
- Manage conversation participants
- View personality profiles, call history, goals
- Configure domains and behavioral targets
- Sections: Overview, Personality (dynamic parameters), Calls, Goals, Targets

**Analysis Specs** (\`/x/specs\`, \`/x/specs/[id]\`)
- Define and manage BDD-style analysis specifications
- Types: MEASURE (score parameters), LEARN (extract info), ADAPT, COMPOSE, etc.
- Roles: EXTRACT, SYNTHESISE, ORCHESTRATE, CONSTRAIN, IDENTITY, CONTENT, VOICE
- Create, edit, activate/deactivate specs

**Domains** (\`/x/domains\`)
- Categorical groupings for specs and parameters
- Examples: personality, memory, engagement, learning

**Parameters** (\`/data-dictionary\`)
- System-wide parameter definitions
- Display configuration, scoring anchors, target ranges
- Fully dynamic - no hardcoded parameter lists

**Pipeline** (\`/pipeline\`)
- View and test the analysis pipeline
- Stages: EXTRACT → MEASURE → LEARN → ADAPT → COMPOSE → AGGREGATE → REWARD
- Test endpoints: measure, compose, extract

**Playground** (\`/playground\`)
- Test and experiment with system features
- Try out specs, parameters, and pipeline stages

### Data & Knowledge
**Taxonomy** (\`/taxonomy\`)
- Ontology of concepts and relationships

**Knowledge Base** (\`/knowledge\`)
- Curriculums, documents, embeddings
- Vector search and RAG integration (in progress)

### Admin & Configuration
**Settings** (\`/settings\`)
- System configuration and preferences

**AI Config** (\`/x/ai-config\`)
- Configure AI models per call point
- Choose between Claude (Anthropic) and OpenAI
- Set model, temperature, max tokens per endpoint

**AI Knowledge Dashboard** (\`/x/ai-knowledge\`)
- View AI interaction logs and learned patterns
- Success rates, pattern confidence scores
- Filter by call point and confidence threshold

**Logs** (\`/logs\`)
- System logs and debugging

**Metering** (\`/metering\`)
- Usage tracking and cost monitoring

### Recent Changes & Updates

**Feb 10, 2026 - AI Assistant Simplification**
- Removed "Inbox" and "Tickets" tabs from AI Assistant
- Simplified to single conversational interface
- NO ticketing system - this is an AI analysis platform, not a support desk

**Feb 2026 - Fully Dynamic Parameter System**
- All personality/parameter data flows dynamically from database
- No hardcoded parameter lists (Big Five, VARK, etc.)
- Adding new parameters = activate spec only (zero code changes)

**Feb 9, 2026 - Parameter Seeding Fix**
- Fixed FK constraint violation for behavior parameters
- Seeded 19 missing parameters from MEASURE_AGENT specs

**Domain System Migration**
- Personas migrated to Domains system
- Callers now have primary domains instead of persona assignments

## System Architecture Concepts

### Specs (Analysis Specifications)
BDD-style specifications that define system behavior:
- **Story**: As a [role], I want [goal], So that [benefit]
- **Triggers**: Conditions that activate the spec
- **Actions**: What happens when triggered
- **Parameters**: What gets measured/computed
- **Templates**: Prompt templates for AI operations

### Parameters
Dynamic system-wide metrics that can be:
- Measured from conversations (MEASURE specs)
- Learned from patterns (LEARN specs)
- Targeted for adaptation (BehaviorTarget)
- Adjusted in real-time (isAdjustable)

### Pipeline
Multi-stage analysis flow:
1. **EXTRACT** - Pull data from conversations
2. **MEASURE** - Score parameters
3. **LEARN** - Extract insights
4. **ADAPT** - Adjust behavior
5. **COMPOSE** - Build prompts
6. **AGGREGATE** - Combine results
7. **REWARD** - Compute quality scores

### Domains
Categorical organization (personality, memory, engagement, etc.)
- Group related specs and parameters
- Filter and scope system features
- Callers can be assigned to domains

## System Knowledge
{systemContext}

## Current Location
{locationContext}

## Guidelines

### When User Asks "Where is X?" or "How do I do X?"
**Format**:
1. One sentence: what to do
2. Specific action: "Click **[Item]** in sidebar"
3. Guidance directive to highlight it

**Example**:
"Go to **Specs** page to create specifications.

\`\`\`guidance
{ "highlight": "/x/specs" }
\`\`\`"

**NOT this**:
"The Analysis Specs page is where you create, edit, and manage all your BDD-style specifications... [wall of text]"

### When User Asks "What does X do?"
**Format**:
- 1-2 sentences max
- Focus on practical benefit
- No architecture unless asked

**Example**: "Specs define what to measure and when. They trigger automatically based on call events."

### When User References Something That Doesn't Exist
1. Clearly state it doesn't exist (or was removed)
2. Explain why (if known - e.g., recent simplification)
3. Suggest alternatives that DO exist
4. Offer to help with what they're actually trying to accomplish

### When Uncertain
- Be honest about uncertainty
- Suggest where to look for more info
- Offer to help explore the codebase

## Response Style
- **CONCISE & SCANNABLE** - Use bullets, short paragraphs, clear headings
- **ACTIONABLE** - Tell user exactly what to click/do next
- **VISUAL GUIDANCE** - Use guidance directives to highlight UI elements
- Maximum 3-4 sentences per section
- Use markdown links: [Callers](/callers)
- Explain "why" briefly, focus on "how"

### Guidance Directives
When you want to guide the user to a specific page:
1. Tell them concisely what to do
2. Provide a guidance directive to highlight the sidebar item
3. Format: \`\`\`guidance { "highlight": "/path" }\`\`\`

Example response:
"To create a spec, go to **Analysis Specs**. Click the sidebar item to get started.

\`\`\`guidance
{ "highlight": "/x/specs" }
\`\`\`"`;

/**
 * @api POST /api/ai/assistant
 * @visibility internal
 * @scope ai-assistant:invoke
 * @auth session
 * @tags ai
 * @description General-purpose AI assistant with full system awareness. Loads comprehensive system context (specs, parameters, domains, callers, etc.), injects location and entity context, and returns an AI-generated response. Logs all interactions for pattern learning.
 * @body message string - The user's message (required)
 * @body context object - Optional viewing context { type: string, data: any } (e.g. caller, spec)
 * @body location LocationContext - Optional current page/route context
 * @body history Array<{role, content}> - Optional conversation history
 * @body mode string - Chat mode: "chat" | "tasks" | "data" | "spec" (default "chat")
 * @response 200 { ok: true, response: "...", suggestions?: {...} }
 * @response 400 { ok: false, error: "message is required" }
 * @response 500 { ok: false, error: "Failed to get AI response" }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("OPERATOR");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();
    const { message, context, location, history = [], mode = "chat" } = body;

    if (!message || !message.trim()) {
      return NextResponse.json(
        { ok: false, error: "message is required" },
        { status: 400 }
      );
    }

    // Load comprehensive system context
    const systemContext = await getSystemContext({
      modules: [
        "specs",
        "parameters",
        "domains",
        "callers",
        "activity",
        "pipeline",
        "knowledge",
        "personas",
        "goals",
        "targets",
        "playbooks",
        "anchors",
        "contentSources",
        "subjects",
      ],
      limit: 30,
    });

    // Add location context if provided
    if (location) {
      systemContext.location = location as LocationContext;
    }

    // Build the system prompt with full system knowledge
    let systemPrompt = await getPromptSpec(config.specs.adminAssistant, GENERAL_ASSISTANT_SYSTEM_PROMPT);
    systemPrompt = injectSystemContext(systemPrompt, systemContext);

    // Add mode-specific guidance
    const modeGuidance: Record<string, string> = {
      chat: "\n\n**Mode**: General conversation - provide helpful, contextual guidance.",
      tasks: "\n\n**Mode**: Task assistance - help user complete current tasks and workflows.",
      data: "\n\n**Mode**: Data exploration - help user query and understand data in the system.",
      spec: "\n\n**Mode**: Spec assistance - focus on spec creation, understanding, and troubleshooting.",
    };
    systemPrompt += modeGuidance[mode as string] || modeGuidance.chat;

    // Add location context separately if present
    const locationText = location
      ? `\n\n**User is currently on**: ${location.page}${location.section ? ` (${location.section})` : ""}`
      : "";
    systemPrompt = systemPrompt.replace("{locationContext}", locationText);

    // Add specific context if provided (e.g., viewing a caller, spec, etc.)
    if (context) {
      if (context.type === "demo") {
        const d = context.data;
        systemPrompt += `\n\n## Demo Context\nUser is watching an interactive demo and paused to ask a question.\n` +
          `**Demo**: "${d.demoTitle}"\n**Current Step**: "${d.stepTitle}"\n` +
          `**They see**: ${d.currentView}\n**Action**: ${d.action}\n` +
          `**Related concepts**: ${(d.relatedConcepts || []).join(", ")}\n` +
          `${d.reason ? `**Why this step matters**: ${d.reason}\n` : ""}\n` +
          `Answer their questions about what they're seeing in the demo. Be concise and focus on the current step's context.`;
      } else {
        const contextText = `\n\n## Current Context\nUser is viewing: ${context.type}\n\`\`\`json\n${JSON.stringify(context.data, null, 2)}\n\`\`\``;
        systemPrompt += contextText;
      }
    }

    // Build messages array
    const messages: AIMessage[] = [
      { role: "system", content: systemPrompt },
      // Include conversation history
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      })),
      // Add the current message
      { role: "user", content: message },
    ];

    // @ai-call assistant.{chat|tasks|data|spec} — AI assistant per mode | config: /x/ai-config
    const callPoint = `assistant.${mode}` as string;
    const result = await getConfiguredMeteredAICompletion({
      callPoint,
      messages,
      maxTokens: 2048,
      temperature: 0.7,
    }, { sourceOp: callPoint });

    // Store model info for logging
    const modelInfo = {
      model: result.model,
      provider: result.engine,
    };

    // #1444 extension — sibling AI route has the same risk class as
    // `chat.data`: full system context + free-form question →
    // learner-scoped fabrication is possible. This route has no tool
    // loop (no `toolUses` returned), so the grounding-tool gate
    // resolves to "never grounded" — any learner-scoped claim about a
    // specific caller's enrollment / voice / progress / goal / score
    // will be suppressed. That's the right behaviour here: this route
    // shouldn't be making caller-specific assertions at all without
    // the operator first routing through a tool-equipped surface
    // (Cmd+K / DATA mode).
    //
    // Normalise to the {name}[] shape the intercept expects. This route
    // doesn't surface tool_use blocks today, but kept defensive in case
    // a future revision adds them — see route.ts handleDataModeWithTools
    // for the canonical shape.
    let finalContent = result.content;
    const toolUsesInTurn: Array<{ name: string }> = [];
    const intercept = detectUngroundedLearnerClaim({
      assistantText: finalContent,
      toolUsesInTurn,
    });
    if (intercept.blocked && intercept.replacementText) {
      console.warn(
        `[factual-grounding-intercept] mode=assistant.${mode} reason="${intercept.reason}" suppressed="${(intercept.suppressedText ?? "").slice(0, 200)}"`,
      );
      finalContent = intercept.replacementText;
    }

    // Try to extract structured suggestions from the response
    let suggestions = null;
    try {
      // Look for JSON in the response — read from finalContent so the
      // suggestion extractor sees the suppressed replacement when the
      // intercept fires (suggestions piggy-backing on a fabricated
      // claim should NOT survive the refusal).
      const jsonMatch = finalContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        suggestions = JSON.parse(jsonMatch[1]);
      }
    } catch (e) {
      // No structured suggestions found
    }

    // Log interaction for AI learning (don't await - run in background)
    logAssistantCall(
      {
        callPoint: `assistant.${mode}`,
        userMessage: message,
        metadata: {
          entityType: context?.type,
          entityId: context?.data?.id,
          page: location?.page,
          mode,
          model: modelInfo.model,
          provider: modelInfo.provider,
        },
      },
      {
        response: finalContent,
        success: true,
        suggestions,
      }
    );

    return NextResponse.json({
      ok: true,
      response: finalContent,
      suggestions,
    });
  } catch (error) {
    console.error("General assistant error:", error);

    // Log error for learning
    logAssistantCall(
      {
        callPoint: "assistant.general",
        userMessage: (request as any).body?.message || "",
        metadata: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      },
      {
        response: "",
        success: false,
      }
    );

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to get AI response",
      },
      { status: 500 }
    );
  }
}
