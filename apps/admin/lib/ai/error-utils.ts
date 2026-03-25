/**
 * Shared AI Error Classification and User Messaging
 *
 * Handles error classification, user-friendly messages, and retry logic
 * for all AI provider calls (Claude, OpenAI).
 */

export type AIErrorCode =
  | "RATE_LIMIT"
  | "OVERLOADED"
  | "TIMEOUT"
  | "AUTH"
  | "BILLING"
  | "CONTENT_POLICY"
  | "PARSE_ERROR"
  | "NETWORK"
  | "MODEL"
  | "UNKNOWN";

/**
 * Classify an error into a standardized error code.
 * Checks error message patterns and error types.
 */
export function classifyAIError(error: unknown): AIErrorCode {
  if (!(error instanceof Error)) {
    return "UNKNOWN";
  }

  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Anthropic SDK APIError — check HTTP status code directly
  const status = (error as any).status as number | undefined;
  if (typeof status === "number") {
    if (status === 529 || status === 503) return "OVERLOADED";
    if (status === 429) return "RATE_LIMIT";
    if (status === 401 || status === 403) return "AUTH";
    if (status === 500 || status === 502) return "OVERLOADED"; // Transient server errors
  }

  // Timeout detection
  if (name === "aborterror" || message.includes("timeout") || message.includes("timed out") || message.includes("was aborted")) {
    return "TIMEOUT";
  }

  // Overloaded / transient server errors (Anthropic 529, OpenAI 503)
  if (message.includes("overloaded") || message.includes("529") || message.includes("503")) {
    return "OVERLOADED";
  }

  // Billing
  if (message.includes("credit balance")) {
    return "BILLING";
  }

  // Authentication
  if (
    message.includes("api key") ||
    message.includes("authentication") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  ) {
    return "AUTH";
  }

  // Rate limiting
  if (message.includes("rate limit") || message.includes("too many requests") || message.includes("429")) {
    return "RATE_LIMIT";
  }

  // Model errors
  if (message.includes("model") && (message.includes("not found") || message.includes("does not exist"))) {
    return "MODEL";
  }

  // Network errors
  if (
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("eaddrnotavail") ||
    message.includes("unreachable")
  ) {
    return "NETWORK";
  }

  // Content policy
  if (message.includes("content policy") || message.includes("safety")) {
    return "CONTENT_POLICY";
  }

  // JSON parse errors
  if (
    name === "syntaxerror" ||
    message.includes("json") ||
    message.includes("unexpected token") ||
    message.includes("invalid json")
  ) {
    return "PARSE_ERROR";
  }

  return "UNKNOWN";
}

/**
 * Get a user-friendly error message for an error code.
 * Safe to display to end users.
 */
export function userMessageForError(code: AIErrorCode): string {
  switch (code) {
    case "RATE_LIMIT":
      return "The AI service is busy right now. Please wait a moment and try again.";
    case "OVERLOADED":
      return "The AI service is temporarily overloaded. Retrying automatically...";
    case "TIMEOUT":
      return "The AI service took too long to respond. Please check your connection and try again.";
    case "AUTH":
      return "Authentication failed. Please check the API configuration and try again.";
    case "BILLING":
      return "Unable to process due to billing issue. Please check your AI provider account.";
    case "CONTENT_POLICY":
      return "Your message was blocked by safety filters. Please rephrase and try again.";
    case "PARSE_ERROR":
      return "The AI response was malformed. Please try again.";
    case "NETWORK":
      return "Network error connecting to the AI service. Please check your internet connection.";
    case "MODEL":
      return "The configured AI model is not available. Please check AI settings.";
    case "UNKNOWN":
    default:
      return "An error occurred while processing your request. Please try again.";
  }
}

/**
 * Determine if an error is retryable.
 * Used to decide whether to retry the call or give up.
 */
export function isRetryable(code: AIErrorCode): boolean {
  switch (code) {
    case "RATE_LIMIT":
    case "OVERLOADED":
    case "TIMEOUT":
    case "NETWORK":
      return true;
    case "AUTH":
    case "BILLING":
    case "CONTENT_POLICY":
    case "PARSE_ERROR":
    case "MODEL":
    case "UNKNOWN":
    default:
      return false;
  }
}

/**
 * Determine if an error is due to a user's input (not system fault).
 * Used to decide whether to log as a failure vs just a user error.
 */
export function isUserError(code: AIErrorCode): boolean {
  return code === "CONTENT_POLICY" || code === "PARSE_ERROR";
}
