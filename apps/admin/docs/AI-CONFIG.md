# AI Configuration System

The AI Configuration system allows admins to control which AI provider and model is used for each operation in the application.

## Overview

Instead of hardcoded AI models, each "call point" (a specific operation that uses AI) can be configured independently. This enables:

- **Cost optimization**: Use cheaper models (like Claude Haiku) for simpler tasks
- **Quality tuning**: Use more powerful models (like Claude Opus) for complex tasks
- **A/B testing**: Compare model performance by switching configurations
- **Fallback control**: Switch to OpenAI if Anthropic has issues

## Admin UI

Navigate to **Operations > AI Config** in the sidebar to access the configuration page.

The page shows all configurable call points with:
- Current provider (Claude, OpenAI, or Mock)
- Current model
- Whether it's using default or custom settings
- Reset button to revert to defaults

## Call Points

| Call Point | Description | Default Model |
|------------|-------------|---------------|
| `pipeline.measure` | Scores caller parameters from transcript | claude-sonnet-4 |
| `pipeline.learn` | Extracts facts and memories | claude-sonnet-4 |
| `pipeline.score_agent` | Evaluates agent behavior | claude-sonnet-4 |
| `pipeline.adapt` | Computes personalized targets | claude-sonnet-4 |
| `compose.prompt` | Generates agent guidance prompts | claude-sonnet-4 |
| `analysis.measure` | Standalone parameter scoring | claude-3-haiku |
| `analysis.learn` | Standalone memory extraction | claude-3-haiku |
| `parameter.enrich` | Enriches parameter definitions | claude-3-haiku |
| `bdd.parse` | Parses BDD specifications | claude-sonnet-4 |
| `chat.stream` | Interactive chat completions | claude-sonnet-4 |

## Available Models

### Claude (Anthropic)
- **claude-sonnet-4-5-20250929** - Standard tier, balanced performance
- **claude-3-haiku-20240307** - Fast tier, cost-effective
- **claude-3-5-sonnet-20241022** - Standard tier, previous generation
- **claude-3-opus-20240229** - Premium tier, highest quality

### OpenAI
- **gpt-4o** - Standard tier, balanced
- **gpt-4o-mini** - Fast tier, cost-effective
- **gpt-4-turbo** - Standard tier

### Mock
- **mock_v1** - Testing mode, no API calls

## API

### GET /api/ai-config

Returns all configurations merged with defaults.

```json
{
  "ok": true,
  "configs": [
    {
      "callPoint": "pipeline.measure",
      "label": "Pipeline - MEASURE",
      "description": "Scores caller parameters...",
      "provider": "claude",
      "model": "claude-sonnet-4-5-20250929",
      "isCustomized": false,
      "defaultProvider": "claude",
      "defaultModel": "claude-sonnet-4-5-20250929"
    }
  ],
  "availableModels": { ... }
}
```

### POST /api/ai-config

Create or update a configuration.

```json
{
  "callPoint": "pipeline.measure",
  "provider": "openai",
  "model": "gpt-4o"
}
```

### DELETE /api/ai-config?callPoint=pipeline.measure

Remove a custom configuration and revert to default.

## Using in Code

### Option 1: Config-Aware Completion (Recommended)

```typescript
import { getConfiguredMeteredAICompletion } from "@/lib/metering";

const result = await getConfiguredMeteredAICompletion({
  callPoint: "pipeline.measure",
  messages: [
    { role: "system", content: "You are a scoring assistant..." },
    { role: "user", content: transcript }
  ]
}, {
  callerId: "caller-123",
  callId: "call-456"
});
```

### Option 2: Manual Config Loading

```typescript
import { getAIConfig } from "@/lib/ai/config-loader";
import { getAICompletion } from "@/lib/ai/client";

const config = await getAIConfig("pipeline.measure");

const result = await getAICompletion({
  engine: config.provider,
  model: config.model,
  messages: [...],
  maxTokens: config.maxTokens ?? 1024
});
```

### Option 3: Streaming with Config

```typescript
import { getConfiguredMeteredAICompletionStream } from "@/lib/metering";

const { stream, model } = await getConfiguredMeteredAICompletionStream({
  callPoint: "chat.stream",
  messages: [...]
}, { callerId });

// stream is already metered
return new Response(stream);
```

## Database Schema

```prisma
model AIConfig {
  id          String   @id @default(uuid())
  callPoint   String   @unique
  label       String
  provider    String   @default("claude")
  model       String
  maxTokens   Int?
  temperature Float?
  isActive    Boolean  @default(true)
  description String?  @db.Text
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## Caching

Configurations are cached in memory for 60 seconds to reduce database queries. The cache is automatically cleared when:

- A configuration is created/updated/deleted via the API
- The application restarts

To manually clear the cache:

```typescript
import { clearAIConfigCache } from "@/lib/ai/config-loader";
clearAIConfigCache();
```

## Best Practices

1. **Start with defaults** - The default configurations are optimized for quality and cost balance

2. **Use Haiku for simple tasks** - Parameter enrichment, simple extraction, and validation can use faster/cheaper models

3. **Use Sonnet/GPT-4 for complex tasks** - Prompt composition, personality scoring, and nuanced analysis benefit from better models

4. **Test before production** - Use Mock mode to test pipeline flow without incurring API costs

5. **Monitor costs** - Check the Metering page to track usage by model and call point

## Adding New AI Call Points

**IMPORTANT:** When adding a new AI call to the codebase, you MUST:

1. **Add the call point definition** in `/app/api/ai-config/route.ts`:
   ```typescript
   // In AI_CALL_POINTS array:
   {
     callPoint: "your.new.callpoint",
     label: "Your New Feature",
     description: "What this AI call does",
     defaultProvider: "claude",
     defaultModel: "claude-sonnet-4-5-20250929",
   },
   ```

2. **Add the default config** in `/lib/ai/config-loader.ts`:
   ```typescript
   // In DEFAULT_CONFIGS:
   "your.new.callpoint": { provider: "claude", model: "claude-sonnet-4-5-20250929" },
   ```

3. **Use the config-aware function** in your code:
   ```typescript
   import { getConfiguredMeteredAICompletion } from "@/lib/metering";

   const result = await getConfiguredMeteredAICompletion({
     callPoint: "your.new.callpoint",
     messages: [...]
   }, context);
   ```

4. **Pass the callPoint as sourceOp** for metering visibility:
   - The `getConfiguredMeteredAICompletion` function does this automatically
   - If using raw `getMeteredAICompletion`, pass `sourceOp: "your.new.callpoint"` in context

This ensures:
- The new call point appears in the AI Config admin page
- Admins can configure the provider/model
- Usage is tracked separately in the Metering dashboard
- The call automatically appears in the **Logs panel** (status bar popup) with stage, tokens, and duration
- When deep logging is enabled, full prompt + response are captured for diagnostics

**Important:** Do NOT manually call `logAI()` after `getConfiguredMeteredAICompletion()` — logging is handled centrally. Adding a manual `logAI()` call will create duplicate entries in the Logs panel.
