"use client";

import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";

export interface CapturedError {
  timestamp: number;
  message: string;
  source?: string;
  stack?: string;
  url?: string;
  status?: number;
}

interface ReportErrorContext {
  source?: string;
  step?: string;
}

interface ErrorCaptureContextValue {
  getRecentErrors: () => CapturedError[];
  clearErrors: () => void;
  errorCount: number;
  /** Manually report a caught error so it appears in BugReportButton + status bar badge */
  reportError: (err: Error | string, context?: ReportErrorContext) => void;
}

const ErrorCaptureContext = createContext<ErrorCaptureContextValue | null>(null);

const MAX_ERRORS = 10;

export function ErrorCaptureProvider({ children }: { children: React.ReactNode }) {
  const bufferRef = useRef<CapturedError[]>([]);
  const [errorCount, setErrorCount] = useState(0);
  const originalFetchRef = useRef<typeof window.fetch | null>(null);

  const pushError = useCallback((err: CapturedError) => {
    const buf = bufferRef.current;
    if (buf.length >= MAX_ERRORS) buf.shift();
    buf.push(err);
    setErrorCount((c) => c + 1);
  }, []);

  useEffect(() => {
    // window.onerror
    const handleError = (event: ErrorEvent) => {
      pushError({
        timestamp: Date.now(),
        message: event.message || "Unknown error",
        source: event.filename || undefined,
        stack: event.error?.stack?.slice(0, 500) || undefined,
      });
    };

    // unhandledrejection
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      pushError({
        timestamp: Date.now(),
        message: reason?.message || String(reason) || "Unhandled promise rejection",
        source: "unhandledrejection",
        stack: reason?.stack?.slice(0, 500) || undefined,
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    // Patch fetch to log failed responses (log-only, never modifies request/response)
    if (!originalFetchRef.current) {
      originalFetchRef.current = window.fetch;
      const origFetch = window.fetch;
      window.fetch = async function patchedFetch(
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> {
        const response = await origFetch.call(window, input, init);
        if (!response.ok && response.status >= 400) {
          const reqUrl =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          // Don't log expected non-error statuses:
          // 401 = normal session expiry, 409 = idempotent "already exists"
          if (response.status !== 401 && response.status !== 409) {
            // Clone response to read error body without consuming the original
            let errorDetail = "";
            try {
              const clone = response.clone();
              const body = await clone.text();
              if (body) {
                try {
                  const json = JSON.parse(body);
                  errorDetail = json.error || json.message || "";
                } catch {
                  // Not JSON — use first 200 chars of text
                  errorDetail = body.slice(0, 200);
                }
              }
            } catch {
              // Clone/read failed — proceed without detail
            }
            const msg = errorDetail
              ? `Fetch ${response.status}: ${errorDetail}`
              : `Fetch failed: ${response.status} ${response.statusText}`;
            pushError({
              timestamp: Date.now(),
              message: msg,
              source: "fetch",
              url: reqUrl,
              status: response.status,
            });
          }
        }
        return response;
      };
    }

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
      // Restore original fetch
      if (originalFetchRef.current) {
        window.fetch = originalFetchRef.current;
        originalFetchRef.current = null;
      }
    };
  }, [pushError]);

  const getRecentErrors = useCallback(() => {
    return [...bufferRef.current];
  }, []);

  const clearErrors = useCallback(() => {
    bufferRef.current = [];
    setErrorCount(0);
  }, []);

  const reportError = useCallback(
    (err: Error | string, context?: ReportErrorContext) => {
      const message = err instanceof Error ? err.message : err;
      const stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
      const source = [context?.source, context?.step]
        .filter(Boolean)
        .join("/") || undefined;
      pushError({ timestamp: Date.now(), message, stack, source });
    },
    [pushError],
  );

  return (
    <ErrorCaptureContext.Provider value={{ getRecentErrors, clearErrors, errorCount, reportError }}>
      {children}
    </ErrorCaptureContext.Provider>
  );
}

export function useErrorCapture(): ErrorCaptureContextValue {
  const ctx = useContext(ErrorCaptureContext);
  if (!ctx) {
    throw new Error("useErrorCapture must be used within ErrorCaptureProvider");
  }
  return ctx;
}
