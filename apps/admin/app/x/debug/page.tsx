"use client";

import { useState, useEffect } from "react";
import { FancySelect, FancySelectOption } from "@/components/shared/FancySelect";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";

// Categorized API endpoints for testing
const API_ENDPOINTS: FancySelectOption[] = [
  // System
  { value: "/api/health", label: "Health Check", subtitle: "GET - System health", badge: "System" },
  { value: "/api/system/readiness", label: "Readiness", subtitle: "GET - System readiness", badge: "System" },
  { value: "/api/supervisor", label: "Supervisor", subtitle: "GET - Supervisor status", badge: "System" },

  // Data
  { value: "/api/domains", label: "Domains", subtitle: "GET - All domains", badge: "Data" },
  { value: "/api/callers", label: "Callers", subtitle: "GET - All callers", badge: "Data" },
  { value: "/api/playbooks", label: "Subjects", subtitle: "GET - All subjects", badge: "Data" },
  { value: "/api/analysis-specs", label: "Specs", subtitle: "GET - All analysis specs", badge: "Data" },
  { value: "/api/parameters", label: "Parameters", subtitle: "GET - All parameters", badge: "Data" },
  { value: "/api/prompt-slugs", label: "Prompt Slugs", subtitle: "GET - All prompt slugs", badge: "Data" },
  { value: "/api/prompt-templates", label: "Prompt Templates", subtitle: "GET - All templates", badge: "Data" },
  { value: "/api/goals", label: "Goals", subtitle: "GET - All goals", badge: "Data" },

  // Dictionary
  { value: "/api/data-dictionary/parameters", label: "Dictionary Params", subtitle: "GET - Data dictionary params", badge: "Dict" },
  { value: "/api/data-dictionary/xrefs", label: "Dictionary XRefs", subtitle: "GET - Cross-references", badge: "Dict" },

  // Pipeline
  { value: "/api/pipeline/manifest", label: "Pipeline Manifest", subtitle: "GET - Pipeline configuration", badge: "Pipeline" },
  { value: "/api/pipeline/runs", label: "Pipeline Runs", subtitle: "GET - Recent pipeline runs", badge: "Pipeline" },

  // Lab
  { value: "/api/lab/features", label: "Lab Features", subtitle: "GET - BDD feature sets", badge: "Lab" },
  { value: "/api/lab/uploads", label: "Lab Uploads", subtitle: "GET - Uploaded specs", badge: "Lab" },

  // Metering
  { value: "/api/metering/summary", label: "Metering Summary", subtitle: "GET - Usage summary", badge: "Metering" },
  { value: "/api/metering/events", label: "Metering Events", subtitle: "GET - Usage events", badge: "Metering" },
  { value: "/api/metering/rates", label: "Metering Rates", subtitle: "GET - Cost rates", badge: "Metering" },

  // Config
  { value: "/api/ai-config", label: "AI Config", subtitle: "GET - AI configuration", badge: "Config" },
  { value: "/api/ai-models", label: "AI Models", subtitle: "GET - Configured AI models", badge: "Config" },

  // Taxonomy
  { value: "/api/taxonomy-graph", label: "Taxonomy Graph", subtitle: "GET - Parameter graph", badge: "Taxonomy" },
  { value: "/api/specs/tree", label: "Specs Tree", subtitle: "GET - Spec hierarchy", badge: "Taxonomy" },
];

export default function DebugPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [selectedEndpoint, setSelectedEndpoint] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const { copied, copy: copyText } = useCopyToClipboard();

  // Load logs from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("hf.debug.logs");
    if (stored) {
      try {
        setLogs(JSON.parse(stored));
      } catch {}
    }
  }, []);

  const addLog = (msg: string) => {
    setLogs((prev) => {
      const newLogs = [...prev, `[${new Date().toISOString()}] ${msg}`].slice(-100);
      localStorage.setItem("hf.debug.logs", JSON.stringify(newLogs));
      return newLogs;
    });
  };

  const clearLogs = () => {
    setLogs([]);
    localStorage.removeItem("hf.debug.logs");
  };

  const testPipeline = async () => {
    addLog("Testing pipeline endpoint...");
    try {
      // Use a test call ID - this will fail but shows if route works
      const res = await fetch("/api/calls/test-call-id/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callerId: "test", mode: "prep" }),
      });
      const text = await res.text();
      addLog(`Pipeline response (${res.status}): ${text.slice(0, 200)}`);
      try {
        setTestResult(JSON.parse(text));
      } catch {
        setTestResult({ raw: text.slice(0, 500) });
      }
    } catch (err: any) {
      addLog(`Pipeline error: ${err.message}`);
      setTestResult({ error: err.message });
    }
  };

  const testEndpoint = async () => {
    if (!input.trim()) return;
    addLog(`Testing: ${input}`);
    try {
      const res = await fetch(input);
      const text = await res.text();
      addLog(`Response (${res.status}): ${text.slice(0, 200)}`);
      try {
        setTestResult(JSON.parse(text));
      } catch {
        setTestResult({ raw: text.slice(0, 500) });
      }
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      setTestResult({ error: err.message });
    }
  };

  const handleEndpointSelect = (value: string) => {
    setSelectedEndpoint(value);
    if (value) {
      setInput(value);
    }
  };

  // Safe JSON stringify that handles errors
  const safeStringify = (obj: any): string => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return `[Error stringifying: ${e instanceof Error ? e.message : "unknown"}]`;
    }
  };

  const copyResult = () => {
    if (!testResult) return;
    copyText(safeStringify(testResult));
  };

  return (
    <div className="hf-page-container">
      <div style={{ marginBottom: 24 }}>
        <a href="/x/settings" style={{ fontSize: 13, color: "var(--accent-primary)", textDecoration: "none" }}>&larr; Back to Settings</a>
        <h1 className="hf-page-title" style={{ marginTop: 4 }}>Debug Console</h1>
        <p style={{ color: "var(--text-secondary)", margin: "4px 0 0", fontSize: 14 }}>
          Test API endpoints and view request/response logs
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={testPipeline}
          style={{
            padding: "8px 16px",
            background: "var(--accent-primary)",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          Test Pipeline Route
        </button>
        <button
          onClick={clearLogs}
          style={{
            padding: "8px 16px",
            background: "var(--status-error-text)",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          Clear Logs
        </button>
      </div>

      {/* Endpoint Picker */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 6, color: "var(--text-secondary)", fontWeight: 500 }}>
          Quick Select Endpoint
        </label>
        <FancySelect
          value={selectedEndpoint}
          onChange={handleEndpointSelect}
          options={API_ENDPOINTS}
          placeholder="Search or select an API endpoint..."
          searchable
          clearable
          style={{ maxWidth: 500 }}
        />
      </div>

      {/* Custom URL Input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSelectedEndpoint("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") testEndpoint();
          }}
          placeholder="Or paste custom endpoint URL..."
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            background: "var(--surface-primary)",
            color: "var(--text-primary)",
            fontSize: 14,
          }}
        />
        <button
          onClick={testEndpoint}
          disabled={!input.trim()}
          style={{
            padding: "8px 16px",
            background: input.trim() ? "var(--status-success-text)" : "var(--text-muted)",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: input.trim() ? "pointer" : "not-allowed",
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          Test URL
        </button>
      </div>

      {testResult && (
        <div
          style={{
            marginBottom: 16,
            padding: 16,
            background: "var(--surface-secondary)",
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            fontFamily: "monospace",
            fontSize: 12,
            overflow: "auto",
            maxHeight: 300,
            position: "relative",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong style={{ color: "var(--text-primary)" }}>Last Result:</strong>
            <button
              onClick={copyResult}
              style={{
                padding: "4px 10px",
                background: copied ? "var(--status-success-text)" : "var(--surface-tertiary)",
                color: copied ? "white" : "var(--text-secondary)",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 500,
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre style={{ color: "var(--text-primary)", margin: 0, whiteSpace: "pre-wrap" }}>
            {safeStringify(testResult)}
          </pre>
        </div>
      )}

      <div
        style={{
          background: "var(--surface-dark, #1e1e1e)",
          color: "var(--text-on-dark, #d4d4d4)",
          padding: 16,
          borderRadius: 8,
          border: "1px solid var(--border-dark, #333)",
          fontFamily: "monospace",
          fontSize: 12,
          height: 400,
          overflow: "auto",
        }}
      >
        {logs.length === 0 ? (
          <span style={{ color: "var(--text-tertiary, #666)" }}>
            No logs yet. Click "Test Pipeline Route" or paste info here.
          </span>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {log}
            </div>
          ))
        )}
      </div>

      <div
        style={{
          marginTop: 16,
          padding: 16,
          background: "var(--warning-bg, #fef3c7)",
          border: "1px solid var(--warning-border, #f59e0b)",
          borderRadius: 8,
        }}
      >
        <strong style={{ color: "var(--warning-text, #92400e)" }}>Paste error info here:</strong>
        <textarea
          style={{
            width: "100%",
            height: 100,
            marginTop: 8,
            padding: 8,
            fontFamily: "monospace",
            fontSize: 12,
            border: "1px solid var(--warning-border, #d97706)",
            borderRadius: 4,
            background: "var(--surface-primary)",
            color: "var(--text-primary)",
          }}
          placeholder="Paste terminal logs, error messages, or other debug info..."
          onBlur={(e) => {
            if (e.target.value.trim()) {
              addLog(`USER INPUT:\n${e.target.value}`);
              e.target.value = "";
            }
          }}
        />
      </div>
    </div>
  );
}
