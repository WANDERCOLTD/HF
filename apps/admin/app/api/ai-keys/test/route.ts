import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/permissions";

// Provider key mapping
const PROVIDER_ENV_VARS: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * @api POST /api/ai-keys/test
 * @visibility internal
 * @scope ai-keys:read
 * @auth session
 * @tags ai
 * @description Test an API key against a provider by making a lightweight validation call. If no key is provided, tests the currently configured runtime key.
 * @body provider string - AI provider to test ("claude" | "openai" | "mock")
 * @body key string - Optional API key to test; uses runtime env var if omitted
 * @response 200 { ok: true, valid: true, message: "Key is valid", model?: "..." }
 * @response 200 { ok: true, valid: false, message: "Invalid API key" }
 * @response 400 { ok: false, error: "Provider is required" }
 * @response 500 { ok: false, error: "Failed to test API key" }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json();
    const { provider } = body;
    let { key } = body;

    if (!provider) {
      return NextResponse.json(
        { ok: false, error: "Provider is required" },
        { status: 400 }
      );
    }

    // If no key provided, use the runtime env var
    if (!key) {
      const envVar = PROVIDER_ENV_VARS[provider];
      key = envVar ? process.env[envVar] : null;

      if (!key) {
        return NextResponse.json({
          ok: true,
          valid: false,
          message: "No API key configured",
        });
      }
    }

    let result: { valid: boolean; message: string; model?: string };

    switch (provider) {
      case "claude":
        result = await testAnthropicKey(key);
        break;
      case "openai":
        result = await testOpenAIKey(key);
        break;
      case "mock":
        result = { valid: true, message: "Mock provider - no key needed" };
        break;
      default:
        return NextResponse.json(
          { ok: false, error: `Unknown provider: ${provider}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error("Failed to test API key:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to test API key" },
      { status: 500 }
    );
  }
}

// Test Anthropic API key
async function testAnthropicKey(key: string): Promise<{ valid: boolean; message: string; model?: string }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    if (response.ok) {
      return {
        valid: true,
        message: "Key is valid",
        model: "claude-haiku-4-5-20251001",
      };
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      return { valid: false, message: "Invalid API key" };
    }

    if (response.status === 403) {
      return { valid: false, message: "Key lacks permissions" };
    }

    if (response.status === 429) {
      // Rate limited means the key is valid
      return { valid: true, message: "Key is valid (rate limited)" };
    }

    return {
      valid: false,
      message: data.error?.message || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

// Test OpenAI API key
async function testOpenAIKey(key: string): Promise<{ valid: boolean; message: string; model?: string }> {
  try {
    // Use the models endpoint - lightweight and doesn't consume tokens
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (response.ok) {
      return {
        valid: true,
        message: "Key is valid",
      };
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      return { valid: false, message: "Invalid API key" };
    }

    if (response.status === 403) {
      return { valid: false, message: "Key lacks permissions" };
    }

    if (response.status === 429) {
      return { valid: true, message: "Key is valid (rate limited)" };
    }

    return {
      valid: false,
      message: data.error?.message || `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      valid: false,
      message: error instanceof Error ? error.message : "Connection failed",
    };
  }
}
