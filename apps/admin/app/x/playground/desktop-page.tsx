"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useTerminology } from "@/contexts/TerminologyContext";
import { VerticalSlider } from "@/components/shared/VerticalSlider";
import { CallerPicker } from "@/components/shared/CallerPicker";
import { FancySelect } from "@/components/shared/FancySelect";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import {
  entityColors,
  specTypeColors,
  pipelineColors,
  diffColors,
} from "@/src/components/shared/uiColors";
import { AIConfigButton } from "@/components/shared/AIConfigButton";
import { AIModelBadge } from "@/components/shared/AIModelBadge";
import { UnifiedAssistantPanel } from "@/components/shared/UnifiedAssistantPanel";
import { useAssistant, useAssistantKeyboardShortcut } from "@/hooks/useAssistant";

// =============================================================================
// TYPES
// =============================================================================

type Domain = {
  id: string;
  slug: string;
  name: string;
};

type Playbook = {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  version: string;
  domainId: string;
  domain: Domain;
};

type SpecSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  specRole: string | null;
  outputType: string;
  scope: string;
};

type CallerSummary = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  domain: Domain | null;
  _count?: { calls: number; memories: number };
};

type Call = {
  id: string;
  transcript: string;
  createdAt: string;
  callSequence?: number;
  source?: string;
  hasScores?: boolean;
  hasMemories?: boolean;
};

type CallerDetail = CallerSummary & {
  calls: Call[];
};

type GeneratedPrompt = {
  id: string;
  prompt: string;
  llmPrompt: Record<string, any>;
  inputs?: {
    composition?: {
      sectionsActivated?: string[];
      sectionsSkipped?: string[];
    };
  };
};

type ParsedMessage = {
  role: "ai" | "user";
  content: string;
};

type SectionDiff = {
  key: string;
  status: "added" | "removed" | "changed" | "unchanged";
  previous?: unknown;
  current?: unknown;
};

type BehaviorParameter = {
  parameterId: string;
  name: string;
  definition: string | null;
  domainGroup: string | null;
  systemValue: number | null;
  playbookValue: number | null;
  effectiveValue: number;
  effectiveScope: string;
};

type PlaygroundSection = "caller" | "specs" | "prompts";
type WizardMode = "caller" | "matrix";

// Matrix cell for test matrix
type MatrixCell = {
  callerId: string;
  callerName: string;
  playbookId: string | null; // null = baseline (no playbook)
  playbookName: string;
  status: "pending" | "generating" | "success" | "error";
  prompt?: GeneratedPrompt;
  error?: string;
};

// =============================================================================
// CONSTANTS
// =============================================================================

const WIZARD_MODES: { id: WizardMode; label: string; icon: string; description: string }[] = [
  { id: "caller", label: "Prompt Tuner", icon: "✏️", description: "Tune prompt output for one caller" },
  { id: "matrix", label: "Test Matrix", icon: "📊", description: "Test N callers × M subjects" },
];

const SPEC_TYPE_INFO: Record<string, { label: string; description: string; icon: string }> = {
  LEARN: { label: "Learn", description: "Extracts caller data", icon: "🧠" },
  MEASURE: { label: "Measure", description: "Scores behaviour", icon: "📊" },
  ADAPT: { label: "Adapt", description: "Computes targets", icon: "🔄" },
  COMPOSE: { label: "Compose", description: "Builds prompt", icon: "✍️" },
  IDENTITY: { label: "Identity", description: "WHO the agent is", icon: "🎭" },
  CONTENT: { label: "Content", description: "WHAT it knows", icon: "📖" },
  CONTEXT: { label: "Context", description: "Caller context", icon: "👤" },
  VOICE: { label: "Voice", description: "HOW it speaks", icon: "🗣️" },
  META: { label: "Meta", description: "Legacy", icon: "⚙️" },
};

// Merge spec type and pipeline colors for badge display
const BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  // Spec roles (from specTypeColors)
  IDENTITY: { bg: specTypeColors.IDENTITY.bg, text: specTypeColors.IDENTITY.text },
  CONTENT:  { bg: specTypeColors.CONTENT.bg,  text: specTypeColors.CONTENT.text },
  CONTEXT:  { bg: specTypeColors.CONTEXT.bg,  text: specTypeColors.CONTEXT.text },
  VOICE:    { bg: specTypeColors.VOICE.bg,    text: specTypeColors.VOICE.text },
  META:     { bg: specTypeColors.META.bg,     text: specTypeColors.META.text },
  // Pipeline operations (from pipelineColors)
  LEARN:    { bg: pipelineColors.LEARN.bg,    text: pipelineColors.LEARN.text },
  MEASURE:  { bg: pipelineColors.MEASURE.bg,  text: pipelineColors.MEASURE.text },
  ADAPT:    { bg: pipelineColors.ADAPT.bg,    text: pipelineColors.ADAPT.text },
  COMPOSE:  { bg: pipelineColors.COMPOSE.bg,  text: pipelineColors.COMPOSE.text },
};

// =============================================================================
// UTILITIES
// =============================================================================

function getSpecBadgeType(spec: { specRole: string | null; outputType: string }): string {
  const role = spec.specRole;
  if (role === "IDENTITY" || role === "CONTENT" || role === "VOICE" || role === "CONTEXT") {
    return role;
  }
  return spec.outputType;
}

function parseTranscript(text: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;

  for (const line of text.split("\n")) {
    if (line.match(/^(AI|Agent):/i)) {
      if (current) messages.push(current);
      current = { role: "ai", content: line.replace(/^(AI|Agent):\s*/i, "") };
    } else if (line.match(/^(User|Caller):/i)) {
      if (current) messages.push(current);
      current = { role: "user", content: line.replace(/^(User|Caller):\s*/i, "") };
    } else if (current && line.trim()) {
      current.content += "\n" + line;
    }
  }
  if (current) messages.push(current);
  return messages;
}

function computeDiff(prev: Record<string, unknown> | null, curr: Record<string, unknown>): SectionDiff[] {
  const allKeys = new Set([...Object.keys(prev || {}), ...Object.keys(curr)]);
  return Array.from(allKeys)
    .filter((key) => !key.startsWith("_")) // Skip internal keys for cleaner diff
    .map((key) => {
      const prevVal = prev?.[key];
      const currVal = curr[key];
      const prevStr = JSON.stringify(prevVal);
      const currStr = JSON.stringify(currVal);

      return {
        key,
        status: !prevVal
          ? "added"
          : !currVal
            ? "removed"
            : prevStr !== currStr
              ? "changed"
              : "unchanged",
        previous: prevVal,
        current: currVal,
      } as SectionDiff;
    });
}

// Find where two strings diverge and return snippets around the difference
function getDiffSnippets(a: string, b: string, contextLen = 40): { a: string; b: string } {
  // Find first difference
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;

  // Get context before the difference
  const start = Math.max(0, i - contextLen);
  const prefix = start > 0 ? "..." : "";

  // Extract snippets around the difference
  const aSnippet = prefix + a.slice(start, i + contextLen) + (i + contextLen < a.length ? "..." : "");
  const bSnippet = prefix + b.slice(start, i + contextLen) + (i + contextLen < b.length ? "..." : "");

  return { a: aSnippet, b: bSnippet };
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (isToday) return `Today ${time}`;
  if (isYesterday) return `Yesterday ${time}`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ` ${time}`;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PlaygroundPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { terms, plural, lower } = useTerminology();

  // Read mode from URL, default to "caller"
  const modeParam = searchParams.get("mode") as WizardMode | null;
  const initialMode: WizardMode = modeParam && ["caller", "matrix"].includes(modeParam) ? modeParam : "caller";

  // Wizard mode (top-level)
  const [wizardMode, setWizardMode] = useState<WizardMode>(initialMode);

  // Sync URL when mode changes
  const handleModeChange = useCallback((mode: WizardMode) => {
    setWizardMode(mode);
    router.replace(`/x/playground?mode=${mode}`, { scroll: false });
  }, [router]);

  // Sync mode from URL when navigating via sidebar
  useEffect(() => {
    const urlMode = searchParams.get("mode") as WizardMode | null;
    if (urlMode && ["caller", "matrix"].includes(urlMode) && urlMode !== wizardMode) {
      setWizardMode(urlMode);
    }
  }, [searchParams, wizardMode]);

  // Section navigation (for Caller wizard steps)
  const [activeSection, setActiveSection] = useState<PlaygroundSection>("caller");

  // Selection state
  const [selectedCallerId, setSelectedCallerId] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [selectedPlaybookId, setSelectedPlaybookId] = useState("");

  // Data state
  const [caller, setCaller] = useState<CallerDetail | null>(null);
  const [callers, setCallers] = useState<CallerSummary[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [availableSpecs, setAvailableSpecs] = useState<{
    systemSpecs: SpecSummary[];
    domainSpecs: SpecSummary[];
  }>({ systemSpecs: [], domainSpecs: [] });

  // Prompt state
  const [generatedPrompt, setGeneratedPrompt] = useState<GeneratedPrompt | null>(null);
  const [previousPrompt, setPreviousPrompt] = useState<GeneratedPrompt | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Local spec toggles (not persisted)
  const [specToggles, setSpecToggles] = useState<Record<string, boolean>>({});
  const [showSystemSpecs, setShowSystemSpecs] = useState(false);

  // Tuning panel state
  const [behaviorParams, setBehaviorParams] = useState<BehaviorParameter[]>([]);
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, number>>({});
  const [loadingTargets, setLoadingTargets] = useState(false);

  // Draft spec injection
  const [draftSpecJson, setDraftSpecJson] = useState("");
  const [draftSpecError, setDraftSpecError] = useState<string | null>(null);
  const [draftSpecEnabled, setDraftSpecEnabled] = useState(false);
  const [showDraftInput, setShowDraftInput] = useState(false);

  // Transcript viewer state
  const [selectedCallId, setSelectedCallId] = useState("");

  // UI state
  const [showDiff, setShowDiff] = useState(true);
  const [outputMode, setOutputMode] = useState<"sections" | "raw">("sections");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callerSearch, setCallerSearch] = useState("");
  const [showCallerDropdown, setShowCallerDropdown] = useState(false);
  const { copied, copy: copyText } = useCopyToClipboard();

  // Create Caller modal state
  const [showCreateCallerModal, setShowCreateCallerModal] = useState(false);
  const [newCallerName, setNewCallerName] = useState("");
  const [newCallerEmail, setNewCallerEmail] = useState("");
  const [newCallerDomainId, setNewCallerDomainId] = useState("");
  const [creatingCaller, setCreatingCaller] = useState(false);

  // Create Playbook modal state
  const [showCreatePlaybookModal, setShowCreatePlaybookModal] = useState(false);
  const [newPlaybookName, setNewPlaybookName] = useState("");
  const [newPlaybookDomainId, setNewPlaybookDomainId] = useState("");
  const [creatingPlaybook, setCreatingPlaybook] = useState(false);

  // Spec upload state
  const [uploadingSpec, setUploadingSpec] = useState(false);
  const [specUploadResult, setSpecUploadResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Create Domain modal state
  const [showCreateDomainModal, setShowCreateDomainModal] = useState(false);
  const [newDomainName, setNewDomainName] = useState("");
  const [newDomainSlug, setNewDomainSlug] = useState("");
  const [creatingDomain, setCreatingDomain] = useState(false);

  // Test Matrix state
  const [matrixCallerIds, setMatrixCallerIds] = useState<string[]>([]);

  // AI Assistant
  const assistant = useAssistant({
    defaultTab: "chat",
    layout: "popout",
    enabledTabs: ["chat", "data"],
  });

  // Keyboard shortcut for assistant
  useAssistantKeyboardShortcut(assistant.toggle);
  const [matrixPlaybookIds, setMatrixPlaybookIds] = useState<(string | null)[]>([]); // null = baseline
  const [matrixCells, setMatrixCells] = useState<Map<string, MatrixCell>>(new Map());
  const [isGeneratingMatrix, setIsGeneratingMatrix] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set()); // For diff comparison
  const [showMatrixHelp, setShowMatrixHelp] = useState(false);

  // Refs
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const callerSearchRef = useRef<HTMLDivElement>(null);

  // Section validation
  const canAccessSpecs = !!selectedCallerId;
  const canAccessPrompts = !!selectedCallerId && !!selectedPlaybookId;

  // =============================================================================
  // DATA LOADING
  // =============================================================================

  useEffect(() => {
    Promise.all([
      fetch("/api/callers?withCounts=true").then((r) => r.json()),
      fetch("/api/domains").then((r) => r.json()),
      fetch("/api/playbooks").then((r) => r.json()),
      fetch("/api/playbooks/available-items").then((r) => r.json()),
    ])
      .then(([callersRes, domainsRes, playbooksRes, specsRes]) => {
        if (callersRes.ok) setCallers(callersRes.callers || []);
        if (domainsRes.ok) setDomains(domainsRes.domains || []);
        if (playbooksRes.ok) setPlaybooks(playbooksRes.playbooks || []);
        if (specsRes.ok) {
          setAvailableSpecs({
            systemSpecs: specsRes.systemSpecs || [],
            domainSpecs: specsRes.domainSpecs || [],
          });
          // Initialize toggles from specs (all enabled by default)
          const toggles: Record<string, boolean> = {};
          [...(specsRes.systemSpecs || []), ...(specsRes.domainSpecs || [])].forEach((spec: SpecSummary) => {
            toggles[spec.id] = true;
          });
          setSpecToggles(toggles);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (callerSearchRef.current && !callerSearchRef.current.contains(e.target as Node)) {
        setShowCallerDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch behavior targets when playbook changes
  useEffect(() => {
    if (!selectedPlaybookId) {
      setBehaviorParams([]);
      setPreviewOverrides({});
      return;
    }

    setLoadingTargets(true);
    fetch(`/api/playbooks/${selectedPlaybookId}/targets`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setBehaviorParams(data.parameters || []);
          setPreviewOverrides({}); // Reset overrides when playbook changes
        }
        setLoadingTargets(false);
      })
      .catch(() => {
        setLoadingTargets(false);
      });
  }, [selectedPlaybookId]);

  // =============================================================================
  // CALLER SELECTION
  // =============================================================================

  const filteredCallers = useMemo(() => {
    if (!callerSearch) return callers.slice(0, 20);
    const s = callerSearch.toLowerCase();
    return callers
      .filter(
        (c) =>
          c.name?.toLowerCase().includes(s) ||
          c.email?.toLowerCase().includes(s) ||
          c.phone?.toLowerCase().includes(s) ||
          c.externalId?.toLowerCase().includes(s)
      )
      .slice(0, 20);
  }, [callers, callerSearch]);

  const handleCallerSelect = useCallback(
    async (callerId: string) => {
      setSelectedCallerId(callerId);
      setShowCallerDropdown(false);
      setCallerSearch("");
      setGeneratedPrompt(null);
      setPreviousPrompt(null);

      try {
        const res = await fetch(`/api/callers/${callerId}`);
        const data = await res.json();
        if (data.ok) {
          setCaller({ ...data.caller, calls: data.calls || [] });

          // Auto-select domain/playbook
          if (data.caller.domain?.id) {
            setSelectedDomainId(data.caller.domain.id);
            const published = playbooks.find(
              (pb) => pb.domainId === data.caller.domain.id && pb.status === "PUBLISHED"
            );
            if (published) {
              setSelectedPlaybookId(published.id);
            }
          }

          // Auto-select most recent call
          if (data.calls?.length > 0) {
            setSelectedCallId(data.calls[0].id);
          }
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load caller");
      }
    },
    [playbooks]
  );

  const handleAttachDomain = useCallback(async (domainId: string) => {
    if (!selectedCallerId) return;
    try {
      const res = await fetch(`/api/callers/${selectedCallerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId }),
      });
      const data = await res.json();
      if (data.ok) {
        setCaller((prev) => (prev ? { ...prev, domain: domains.find((d) => d.id === domainId) || null } : null));
        setSelectedDomainId(domainId);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to attach domain");
    }
  }, [selectedCallerId, domains]);

  // =============================================================================
  // DRAFT SPEC PARSING (must be before generatePrompt which depends on it)
  // =============================================================================

  const parsedDraftSpec = useMemo(() => {
    if (!draftSpecEnabled || !draftSpecJson) return null;
    try {
      return JSON.parse(draftSpecJson);
    } catch {
      return null;
    }
  }, [draftSpecEnabled, draftSpecJson]);

  // =============================================================================
  // PROMPT GENERATION
  // =============================================================================

  const generatePrompt = useCallback(async () => {
    if (!selectedCallerId) return;

    // Store previous for diff
    if (generatedPrompt) {
      setPreviousPrompt(generatedPrompt);
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Build request body - include draft spec if enabled, and target overrides
      const requestBody: Record<string, unknown> = {};
      if (parsedDraftSpec) {
        requestBody.draftSpec = parsedDraftSpec;
      }
      // Include target overrides for preview (not persisted)
      if (Object.keys(previewOverrides).length > 0) {
        requestBody.targetOverrides = previewOverrides;
      }

      const res = await fetch(`/api/callers/${selectedCallerId}/compose-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (data.ok) {
        setGeneratedPrompt(data.prompt);
      } else {
        setError(data.error || "Failed to generate prompt");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate prompt");
    } finally {
      setIsGenerating(false);
    }
  }, [selectedCallerId, generatedPrompt, parsedDraftSpec, previewOverrides]);

  const triggerDebouncedRegenerate = useCallback(() => {
    if (!selectedCallerId || !generatedPrompt) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      generatePrompt();
    }, 400);
  }, [selectedCallerId, generatedPrompt, generatePrompt]);

  // =============================================================================
  // DRAFT SPEC HANDLING
  // =============================================================================

  const handleDraftSpecChange = useCallback((json: string) => {
    setDraftSpecJson(json);
    setDraftSpecError(null);

    if (!json.trim()) {
      setDraftSpecEnabled(false);
      return;
    }

    try {
      const parsed = JSON.parse(json);
      if (!parsed.id || !parsed.title) {
        setDraftSpecError("Spec must have 'id' and 'title' fields");
        setDraftSpecEnabled(false);
      } else {
        setDraftSpecEnabled(true);
      }
    } catch {
      setDraftSpecError("Invalid JSON");
      setDraftSpecEnabled(false);
    }
  }, []);

  // =============================================================================
  // SPEC TOGGLES
  // =============================================================================

  const handleToggleSpec = useCallback(
    (specId: string) => {
      setSpecToggles((prev) => ({
        ...prev,
        [specId]: !prev[specId],
      }));
      triggerDebouncedRegenerate();
    },
    [triggerDebouncedRegenerate]
  );

  // =============================================================================
  // TRANSCRIPT VIEWER
  // =============================================================================

  const selectedCall = caller?.calls.find((c) => c.id === selectedCallId);
  const parsedMessages = selectedCall ? parseTranscript(selectedCall.transcript) : [];

  // =============================================================================
  // COPY TO CLIPBOARD
  // =============================================================================

  const handleCopy = useCallback(() => {
    if (!generatedPrompt) return;
    const text = outputMode === "raw"
      ? JSON.stringify(generatedPrompt.llmPrompt, null, 2)
      : generatedPrompt.prompt;
    copyText(text);
  }, [generatedPrompt, outputMode, copyText]);

  // =============================================================================
  // DIFF COMPUTATION
  // =============================================================================

  const diff = useMemo(() => {
    if (!previousPrompt || !generatedPrompt) return [];
    return computeDiff(
      previousPrompt.llmPrompt as Record<string, unknown>,
      generatedPrompt.llmPrompt as Record<string, unknown>
    ).filter((d) => d.status !== "unchanged");
  }, [previousPrompt, generatedPrompt]);

  // =============================================================================
  // FILTERED PLAYBOOKS
  // =============================================================================

  const filteredPlaybooks = selectedDomainId
    ? playbooks.filter((pb) => pb.domainId === selectedDomainId)
    : playbooks;

  // =============================================================================
  // RENDER
  // =============================================================================

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>
        Loading Lab...
      </div>
    );
  }

  const sectionTabs: { id: PlaygroundSection; label: string; icon: string; enabled: boolean }[] = [
    { id: "caller", label: "1. Caller", icon: "👤", enabled: true },
    { id: "specs", label: "2. Specs", icon: "📋", enabled: canAccessSpecs },
    { id: "prompts", label: "3. Prompts", icon: "✨", enabled: canAccessPrompts },
  ];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--surface-secondary)" }}>
      {/* ===== CONTROL BAR HEADER ===== */}
      <div
        style={{
          padding: "12px 24px",
          minHeight: 56,
          background: "var(--surface-primary)",
          borderBottom: "1px solid var(--border-default)",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 4, background: "var(--surface-secondary)", padding: 4, borderRadius: 8, flexShrink: 0 }}>
          {WIZARD_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleModeChange(mode.id)}
              title={mode.description}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                background: wizardMode === mode.id ? "var(--surface-primary)" : "transparent",
                color: wizardMode === mode.id ? "var(--text-primary)" : "var(--text-muted)",
                boxShadow: wizardMode === mode.id ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <span>{mode.icon}</span>
              <span>{mode.label}</span>
            </button>
          ))}
        </div>

        {/* Control bar with pickers - Prompt Tuner mode */}
        {wizardMode === "caller" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
            {/* Step 1: Caller Picker */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: selectedCallerId ? entityColors.caller.bg : "var(--surface-secondary)",
                  color: selectedCallerId ? entityColors.caller.text : "var(--text-muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                1
              </span>
              <div style={{ minWidth: 260 }}>
                <CallerPicker
                  value={selectedCallerId || null}
                  onChange={(id) => {
                    if (id) handleCallerSelect(id);
                  }}
                  placeholder="Select caller..."
                  onCreateNew={() => setShowCreateCallerModal(true)}
                />
              </div>
            </div>

            <span style={{ color: "var(--border-default)", fontSize: 18 }}>›</span>

            {/* Step 2: Playbook Picker */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: selectedPlaybookId ? entityColors.playbook.bg : "var(--surface-secondary)",
                  color: selectedPlaybookId ? entityColors.playbook.text : "var(--text-muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                2
              </span>
              <div style={{ minWidth: 220 }}>
                <FancySelect
                  value={selectedPlaybookId}
                  onChange={(val) => {
                    if (val === "__create__") {
                      setShowCreatePlaybookModal(true);
                    } else {
                      setSelectedPlaybookId(val);
                    }
                  }}
                  options={[
                    { value: "__create__", label: `+ Create new ${lower("playbook")}...`, isAction: true },
                    ...playbooks
                      .filter((pb) => !selectedDomainId || pb.domainId === selectedDomainId)
                      .map((pb) => ({
                        value: pb.id,
                        label: pb.name,
                        subtitle: pb.domain?.name,
                        badge: pb.status,
                      })),
                  ]}
                  placeholder={`Select ${lower("playbook")}...`}
                  disabled={!selectedCallerId}
                  selectedStyle={{
                    border: `1px solid ${entityColors.playbook.accent}`,
                    background: entityColors.playbook.bg,
                  }}
                />
              </div>
            </div>

            <span style={{ color: "var(--border-default)", fontSize: 18 }}>›</span>

            {/* Step 3: Generate Button */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: generatedPrompt ? "var(--accent-secondary-bg, #ede9fe)" : "var(--surface-secondary)",
                  color: generatedPrompt ? "var(--accent-secondary, #7c3aed)" : "var(--text-muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                3
              </span>
              <button
                onClick={generatePrompt}
                disabled={!selectedCallerId || !selectedPlaybookId || isGenerating}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--surface-primary)",
                  background:
                    !selectedCallerId || !selectedPlaybookId
                      ? "var(--border-default)"
                      : isGenerating
                        ? "var(--accent-secondary-muted, #a78bfa)"
                        : "var(--accent-secondary, #7c3aed)",
                  border: "none",
                  borderRadius: 8,
                  cursor: !selectedCallerId || !selectedPlaybookId ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {isGenerating ? (
                  <>
                    <span className="animate-spin">⟳</span>
                    Generating...
                  </>
                ) : generatedPrompt ? (
                  <>
                    <span>↻</span>
                    Regenerate
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    Generate
                  </>
                )}
              </button>
            </div>

            <div style={{ flex: 1 }} />

            {/* Clear all button */}
            {(selectedCallerId || selectedPlaybookId || generatedPrompt) && (
              <button
                onClick={() => {
                  setSelectedCallerId("");
                  setCaller(null);
                  setSelectedPlaybookId("");
                  setGeneratedPrompt(null);
                  setPreviousPrompt(null);
                }}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  color: "var(--text-muted)",
                  background: "transparent",
                  border: "1px solid var(--border-default)",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Control bar - Test Matrix mode */}
        {wizardMode === "matrix" && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1 }}>
            {/* Callers count */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: matrixCallerIds.length > 0 ? entityColors.caller.bg : "var(--surface-secondary)",
                  color: matrixCallerIds.length > 0 ? entityColors.caller.text : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {matrixCallerIds.length} caller{matrixCallerIds.length !== 1 ? "s" : ""}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 14 }}>×</span>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: matrixPlaybookIds.length > 0 ? entityColors.playbook.bg : "var(--surface-secondary)",
                  color: matrixPlaybookIds.length > 0 ? entityColors.playbook.text : "var(--text-muted)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {matrixPlaybookIds.length} config{matrixPlaybookIds.length !== 1 ? "s" : ""}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 14 }}>=</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                {matrixCallerIds.length * matrixPlaybookIds.length} cells
              </span>
            </div>

            <div style={{ flex: 1 }} />

            {/* Generate All button */}
            <button
              onClick={async () => {
                if (matrixCallerIds.length === 0 || matrixPlaybookIds.length === 0) return;
                setIsGeneratingMatrix(true);

                // Initialize all cells as pending
                const newCells = new Map<string, MatrixCell>();
                for (const callerId of matrixCallerIds) {
                  const c = callers.find(c => c.id === callerId);
                  for (const playbookId of matrixPlaybookIds) {
                    const pb = playbookId ? playbooks.find(p => p.id === playbookId) : null;
                    const key = `${callerId}:${playbookId || "baseline"}`;
                    newCells.set(key, {
                      callerId,
                      callerName: c?.name || c?.email || "Unknown",
                      playbookId,
                      playbookName: pb?.name || "(baseline)",
                      status: "generating",
                    });
                  }
                }
                setMatrixCells(newCells);

                // Generate all in parallel
                const promises = matrixCallerIds.flatMap(callerId =>
                  matrixPlaybookIds.map(async playbookId => {
                    const key = `${callerId}:${playbookId || "baseline"}`;
                    try {
                      const body: any = {};
                      if (playbookId === null) {
                        body.playbookIds = [];
                      } else {
                        body.playbookIds = [playbookId];
                      }
                      const res = await fetch(`/api/callers/${callerId}/compose-prompt`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(body),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setMatrixCells(prev => {
                          const next = new Map(prev);
                          const cell = next.get(key);
                          if (cell) {
                            next.set(key, { ...cell, status: "success", prompt: data.prompt });
                          }
                          return next;
                        });
                      } else {
                        throw new Error(data.error || "Failed to generate");
                      }
                    } catch (err: any) {
                      setMatrixCells(prev => {
                        const next = new Map(prev);
                        const cell = next.get(key);
                        if (cell) {
                          next.set(key, { ...cell, status: "error", error: err.message });
                        }
                        return next;
                      });
                    }
                  })
                );

                await Promise.all(promises);
                setIsGeneratingMatrix(false);
              }}
              disabled={matrixCallerIds.length === 0 || matrixPlaybookIds.length === 0 || isGeneratingMatrix}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--surface-primary)",
                background: isGeneratingMatrix
                  ? "var(--text-muted)"
                  : matrixCallerIds.length > 0 && matrixPlaybookIds.length > 0
                  ? "linear-gradient(135deg, var(--accent-secondary, #8b5cf6), var(--accent-primary))"
                  : "var(--border-default)",
                border: "none",
                borderRadius: 8,
                cursor: matrixCallerIds.length > 0 && matrixPlaybookIds.length > 0 && !isGeneratingMatrix ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {isGeneratingMatrix ? (
                <>
                  <span className="animate-spin">⟳</span>
                  Generating...
                </>
              ) : (
                <>
                  <span>✨</span>
                  Generate All
                </>
              )}
            </button>

            {/* Help button */}
            <button
              onClick={() => setShowMatrixHelp(!showMatrixHelp)}
              style={{
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 500,
                color: showMatrixHelp ? "var(--accent-primary)" : "var(--text-muted)",
                background: showMatrixHelp ? "var(--accent-subtle-bg, #eef2ff)" : "transparent",
                border: "1px solid",
                borderColor: showMatrixHelp ? "var(--accent-subtle-border, #c7d2fe)" : "var(--border-default)",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span>?</span>
              <span>Help</span>
            </button>
          </div>
        )}

        {/* Ask AI Button - always visible */}
        {wizardMode && (
          <button
            onClick={() => {
              assistant.open(undefined, { page: "/x/playground", section: wizardMode });
            }}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "rgba(139, 92, 246, 0.1)",
              color: "var(--accent-secondary, #8b5cf6)",
              border: "1px solid rgba(139, 92, 246, 0.2)",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginLeft: wizardMode === "caller" ? 0 : "auto",
            }}
            title="Ask AI Assistant (Cmd+Shift+K)"
          >
            ✨ Ask AI
          </button>
        )}
      </div>

      {/* Test Matrix Help Panel */}
      {wizardMode === "matrix" && showMatrixHelp && (
        <div
          style={{
            margin: "0 20px",
            marginTop: 12,
            padding: 20,
            background: "linear-gradient(135deg, var(--accent-subtle-bg, #eef2ff) 0%, var(--surface-secondary) 100%)",
            borderRadius: 12,
            border: "1px solid var(--accent-subtle-border, #c7d2fe)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--identity-accent, #4338ca)", display: "flex", alignItems: "center", gap: 8 }}>
              <span>📊</span> How to Use Test Matrix
            </h3>
            <button
              onClick={() => setShowMatrixHelp(false)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--accent-primary)" }}
            >
              ×
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {/* Step 1 */}
            <div style={{ background: "var(--surface-primary)", borderRadius: 8, padding: 16, border: "1px solid var(--accent-subtle-border, #e0e7ff)" }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>1️⃣</div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 6 }}>Add Items to Matrix</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Click <strong style={{ color: entityColors.caller.accent }}>+ Add Callers</strong> and <strong style={{ color: entityColors.playbook.accent }}>+ Add {plural("playbook")}</strong> in the left panel to build your test matrix.
              </div>
            </div>

            {/* Step 2 */}
            <div style={{ background: "var(--surface-primary)", borderRadius: 8, padding: 16, border: "1px solid var(--accent-subtle-border, #e0e7ff)" }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>2️⃣</div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 6 }}>Generate Prompts</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Click <strong style={{ background: "linear-gradient(135deg, var(--accent-secondary, #8b5cf6), var(--accent-primary))", color: "var(--surface-primary)", padding: "1px 6px", borderRadius: 4 }}>Generate All</strong> to create prompts for every caller × playbook combination.
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ background: "var(--surface-primary)", borderRadius: 8, padding: 16, border: "1px solid var(--accent-subtle-border, #e0e7ff)" }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>3️⃣</div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 6 }}>View & Compare</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                <strong>Click</strong> a cell to view its prompt. <strong>Shift+click</strong> two cells to see a side-by-side diff comparison.
              </div>
            </div>
          </div>

          {/* Tips */}
          <div style={{ marginTop: 16, padding: 12, background: "var(--surface-primary)", borderRadius: 8, border: "1px solid var(--accent-subtle-border, #e0e7ff)" }}>
            <div style={{ fontWeight: 600, fontSize: 12, color: "var(--identity-accent, #4338ca)", marginBottom: 8 }}>Tips</div>
            <div style={{ display: "flex", gap: 24, fontSize: 11, color: "var(--text-secondary)" }}>
              <div><span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>A</span> = First selected cell (blue)</div>
              <div><span style={{ color: "var(--badge-pink-text)", fontWeight: 600 }}>B</span> = Second selected cell (pink)</div>
              <div><strong>(baseline)</strong> = No playbook applied, uses domain defaults</div>
              <div>Diff view shows section differences between two prompts</div>
            </div>
          </div>
        </div>
      )}


      {/* ===== ERROR ===== */}
      {error && (
        <div
          style={{
            margin: "0 20px",
            marginTop: 12,
            padding: 12,
            background: "var(--status-error-bg)",
            color: "var(--status-error-text)",
            borderRadius: 8,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ================================================================ */}
      {/* CALLER WIZARD CONTENT                                           */}
      {/* ================================================================ */}
      {wizardMode === "caller" && (
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {/* ============================================================ */}
          {/* EMPTY STATE: No caller selected */}
          {/* ============================================================ */}
          {!selectedCallerId && (
            <div style={{ maxWidth: 600, margin: "0 auto" }}>
              <div
                style={{
                  textAlign: "center",
                  padding: "60px 20px",
                  background: "var(--surface-primary)",
                  borderRadius: 12,
                  border: "1px solid var(--border-default)",
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 16 }}>🧪</div>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 8px 0" }}>
                  Prompt Tuner
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>
                  Select a caller using the picker above, then choose a playbook and generate prompts
                </p>
                <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
                  <CallerPicker
                    value={selectedCallerId || null}
                    onChange={(callerId) => {
                      if (callerId) {
                        handleCallerSelect(callerId);
                      }
                    }}
                    placeholder="Search callers..."
                    style={{ width: 280 }}
                    onCreateNew={() => setShowCreateCallerModal(true)}
                  />
                  <button
                    onClick={() => setShowCreateCallerModal(true)}
                    style={{
                      padding: "12px 24px",
                      background: "var(--button-primary-bg)",
                      color: "var(--surface-primary)",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    ➕ Create Caller
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* MAIN CONTENT: Two-column layout when caller is selected */}
          {/* ============================================================ */}
          {selectedCallerId && (
            <div style={{ display: "flex", gap: 20, maxWidth: 1400, margin: "0 auto" }}>
              {/* LEFT COLUMN: Caller info + Specs */}
              <div style={{ width: 320, flexShrink: 0 }}>
                {/* Compact Caller Card */}
                <div
                  style={{
                    background: "var(--surface-primary)",
                    borderRadius: 12,
                    border: "1px solid var(--border-default)",
                    padding: 16,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        background: entityColors.caller.bg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                      }}
                    >
                      👤
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {caller?.name || "Unnamed Caller"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {caller?.email || caller?.phone || caller?.externalId || caller?.id.slice(0, 12)}
                      </div>
                    </div>
                    {caller?.domain && (
                      <span style={{ fontSize: 10, padding: "3px 6px", background: entityColors.domain.bg, color: entityColors.domain.text, borderRadius: 4, whiteSpace: "nowrap" }}>
                        {caller.domain.name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Specs Panel */}
                <div
                  style={{
                    background: "var(--surface-primary)",
                    borderRadius: 12,
                    border: "1px solid var(--border-default)",
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 14 }}>📋</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Specs</span>
                    <div style={{ flex: 1 }} />
                    <button
                      onClick={() => setShowSystemSpecs(!showSystemSpecs)}
                      style={{
                        fontSize: 11,
                        color: showSystemSpecs ? "var(--accent-primary)" : "var(--text-muted)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {showSystemSpecs ? "Hide system" : "Show system"}
                    </button>
                  </div>

                  {/* System Specs */}
                  {showSystemSpecs && availableSpecs.systemSpecs.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: "var(--text-placeholder)", marginBottom: 6, fontWeight: 500 }}>SYSTEM</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {availableSpecs.systemSpecs.map((spec) => {
                          const isEnabled = specToggles[spec.id] !== false;
                          const badgeType = getSpecBadgeType(spec);
                          const colors = BADGE_COLORS[badgeType] || { bg: "var(--surface-secondary)", text: "var(--text-muted)" };
                          return (
                            <button
                              key={spec.id}
                              onClick={() => handleToggleSpec(spec.id)}
                              title={spec.description || spec.name}
                              style={{
                                fontSize: 10,
                                padding: "4px 8px",
                                borderRadius: 4,
                                border: "none",
                                cursor: "pointer",
                                background: isEnabled ? colors.bg : "var(--surface-secondary)",
                                color: isEnabled ? colors.text : "var(--text-muted)",
                                opacity: isEnabled ? 1 : 0.5,
                              }}
                            >
                              {spec.slug}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Playbook Specs */}
                  {availableSpecs.domainSpecs.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-placeholder)", marginBottom: 6, fontWeight: 500 }}>PLAYBOOK</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {availableSpecs.domainSpecs.map((spec) => {
                          const isEnabled = specToggles[spec.id] !== false;
                          const badgeType = getSpecBadgeType(spec);
                          const colors = BADGE_COLORS[badgeType] || { bg: "var(--surface-secondary)", text: "var(--text-muted)" };
                          return (
                            <button
                              key={spec.id}
                              onClick={() => handleToggleSpec(spec.id)}
                              title={spec.description || spec.name}
                              style={{
                                fontSize: 10,
                                padding: "4px 8px",
                                borderRadius: 4,
                                border: "none",
                                cursor: "pointer",
                                background: isEnabled ? colors.bg : "var(--surface-secondary)",
                                color: isEnabled ? colors.text : "var(--text-muted)",
                                opacity: isEnabled ? 1 : 0.5,
                              }}
                            >
                              {spec.slug}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {availableSpecs.systemSpecs.length === 0 && availableSpecs.domainSpecs.length === 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-placeholder)", textAlign: "center", padding: 12 }}>
                      No specs available
                    </div>
                  )}
                </div>

                {/* Tuning Panel */}
                {selectedPlaybookId && behaviorParams.length > 0 && (
                  <div
                    style={{
                      marginTop: 16,
                      background: "var(--status-warning-bg, #fffbeb)",
                      border: "1px solid var(--status-warning-border, #fde68a)",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 14 }}>🎚️</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--status-warning-text, #92400e)" }}>Tuning</span>
                      {Object.keys(previewOverrides).length > 0 && (
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--status-warning-accent, #f59e0b)" }} title="Modified" />
                      )}
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: "var(--status-warning-muted, #b45309)" }}>{behaviorParams.length} params</span>
                    </div>
                    <div style={{ maxHeight: 200, overflowY: "auto" }}>
                      {behaviorParams.slice(0, 5).map((param) => (
                        <div key={param.parameterId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--status-warning-border-light, #fef3c7)" }}>
                          <div style={{ flex: 1, fontSize: 11, color: "var(--status-warning-text, #92400e)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{param.name}</div>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={previewOverrides[param.parameterId] ?? param.effectiveValue}
                            onChange={(e) => setPreviewOverrides((prev) => ({ ...prev, [param.parameterId]: parseInt(e.target.value) }))}
                            style={{ width: 60 }}
                          />
                          <span style={{ fontSize: 10, color: "var(--status-warning-muted, #b45309)", width: 24, textAlign: "right" }}>{previewOverrides[param.parameterId] ?? param.effectiveValue}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: Output Panel */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* No playbook selected */}
                {!selectedPlaybookId && (
                  <div style={{ textAlign: "center", padding: "60px 20px", background: "var(--surface-primary)", borderRadius: 12, border: "1px solid var(--border-default)" }}>
                    <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📚</div>
                    <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 8px 0" }}>Select a {terms.playbook}</h3>
                    <p style={{ fontSize: 14, color: "var(--text-muted)" }}>Choose a {lower("playbook")} from the control bar above to generate prompts</p>
                  </div>
                )}

                {/* Ready to generate */}
                {selectedPlaybookId && !generatedPrompt && !isGenerating && (
                  <div style={{ textAlign: "center", padding: "60px 20px", background: "var(--surface-primary)", borderRadius: 12, border: "1px solid var(--border-default)" }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>✨</div>
                    <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 8px 0" }}>Ready to Generate</h3>
                    <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 20 }}>Click Generate in the control bar or below</p>
                    <button
                      onClick={generatePrompt}
                      style={{ padding: "12px 24px", fontSize: 14, fontWeight: 600, color: "var(--surface-primary)", background: "var(--accent-secondary, #7c3aed)", border: "none", borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
                    >
                      <span>✨</span> Generate Prompt
                    </button>
                  </div>
                )}

                {/* Generating */}
                {isGenerating && (
                  <div style={{ textAlign: "center", padding: "60px 20px", background: "var(--surface-primary)", borderRadius: 12, border: "1px solid var(--border-default)" }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }} className="animate-pulse">⟳</div>
                    <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--accent-secondary, #7c3aed)", margin: 0 }}>Generating prompt...</h3>
                  </div>
                )}

                {/* Generated output */}
                {generatedPrompt && !isGenerating && (
                  <div style={{ background: "var(--surface-primary)", borderRadius: 12, border: "1px solid var(--border-default)", overflow: "hidden" }}>
                    {/* Header */}
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-default)", display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 14 }}>✨</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Generated Prompt</span>
                      <AIConfigButton callPoint="compose.prompt" label="Prompt Composition" />
                      <AIModelBadge callPoint="compose.prompt" variant="badge" size="sm" />
                      <div style={{ flex: 1 }} />
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => setOutputMode("sections")}
                          style={{
                            padding: "4px 10px", fontSize: 11, fontWeight: outputMode === "sections" ? 600 : 400,
                            color: outputMode === "sections" ? "var(--accent-primary)" : "var(--text-muted)",
                            background: outputMode === "sections" ? "var(--accent-subtle-bg, #eef2ff)" : "transparent",
                            border: "1px solid", borderColor: outputMode === "sections" ? "var(--accent-subtle-border, #c7d2fe)" : "var(--border-default)", borderRadius: 4, cursor: "pointer",
                          }}
                        >
                          Sections
                        </button>
                        <button
                          onClick={() => setOutputMode("raw")}
                          style={{
                            padding: "4px 10px", fontSize: 11, fontWeight: outputMode === "raw" ? 600 : 400,
                            color: outputMode === "raw" ? "var(--accent-primary)" : "var(--text-muted)",
                            background: outputMode === "raw" ? "var(--accent-subtle-bg, #eef2ff)" : "transparent",
                            border: "1px solid", borderColor: outputMode === "raw" ? "var(--accent-subtle-border, #c7d2fe)" : "var(--border-default)", borderRadius: 4, cursor: "pointer",
                          }}
                        >
                          Raw
                        </button>
                      </div>
                      <button
                        onClick={() => handleCopy()}
                        style={{ padding: "4px 10px", fontSize: 11, color: copied ? "var(--status-success-text)" : "var(--text-muted)", background: copied ? "var(--status-success-bg, #d1fae5)" : "var(--surface-secondary)", border: "none", borderRadius: 4, cursor: "pointer" }}
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>

                    {/* Content */}
                    <div style={{ padding: 16, maxHeight: 500, overflowY: "auto" }}>
                      {outputMode === "raw" ? (
                        <pre style={{ fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, color: "var(--text-secondary)" }}>
                          {JSON.stringify(generatedPrompt.llmPrompt, null, 2)}
                        </pre>
                      ) : (
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                          {generatedPrompt.llmPrompt?._quickStart && (
                            <div style={{ marginBottom: 16 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>Quick Start</div>
                              <div style={{ background: "var(--status-success-bg, #f0fdf4)", border: "1px solid var(--status-success-border, #bbf7d0)", borderRadius: 8, padding: 12, fontSize: 12 }}>
                                <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{JSON.stringify(generatedPrompt.llmPrompt._quickStart, null, 2)}</pre>
                              </div>
                            </div>
                          )}
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>Prompt</div>
                            <div style={{ whiteSpace: "pre-wrap" }}>{generatedPrompt.prompt}</div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Diff */}
                    {previousPrompt && showDiff && (
                      <div style={{ borderTop: "1px solid var(--border-default)", padding: 16, background: "var(--background)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>Changes</span>
                          <button onClick={() => setShowDiff(false)} style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-placeholder)", background: "none", border: "none", cursor: "pointer" }}>Hide</button>
                        </div>
                        <div style={{ fontSize: 12 }}>
                          {computeDiff(previousPrompt.llmPrompt, generatedPrompt.llmPrompt)
                            .filter((d) => d.status !== "unchanged")
                            .slice(0, 10)
                            .map((diff) => (
                              <div key={diff.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                                <span style={{ fontSize: 10, fontWeight: 600, color: diff.status === "added" ? diffColors.added.text : diff.status === "removed" ? diffColors.removed.text : diffColors.changed.text }}>
                                  {diff.status === "added" ? "+" : diff.status === "removed" ? "-" : "~"}
                                </span>
                                <span style={{ color: "var(--text-secondary)" }}>{diff.key}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}


      {/* ================================================================ */}
      {/* TEST MATRIX CONTENT                                             */}
      {/* ================================================================ */}
      {wizardMode === "matrix" && (
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          <div style={{ maxWidth: 1600, margin: "0 auto" }}>
            {/* Selection Controls */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              {/* Callers Selection */}
              <div
                style={{
                  background: "var(--surface-primary)",
                  border: `2px solid ${entityColors.caller.border}`,
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>👤</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Callers</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
                    {matrixCallerIds.length} selected
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {matrixCallerIds.map(id => {
                    const c = callers.find(c => c.id === id);
                    return (
                      <span
                        key={id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          background: entityColors.caller.bg,
                          color: entityColors.caller.text,
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        {c?.name || c?.email || id.slice(0, 8)}
                        <button
                          onClick={() => setMatrixCallerIds(prev => prev.filter(x => x !== id))}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 14, color: entityColors.caller.text, opacity: 0.7 }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
                <FancySelect
                  value=""
                  onChange={(id) => {
                    if (id && !matrixCallerIds.includes(id)) {
                      setMatrixCallerIds(prev => [...prev, id]);
                    }
                  }}
                  placeholder="+ Add caller..."
                  searchable
                  options={callers
                    .filter(c => !matrixCallerIds.includes(c.id))
                    .map(c => ({
                      value: c.id,
                      label: c.name || c.email || c.externalId || "Unknown",
                      subtitle: c.domain?.name,
                    }))}
                />
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setMatrixCallerIds(callers.slice(0, 5).map(c => c.id))}
                    style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "1px solid var(--border-default)", padding: "4px 8px", borderRadius: 4, cursor: "pointer" }}
                  >
                    Recent 5
                  </button>
                  <button
                    onClick={() => setMatrixCallerIds([])}
                    style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "1px solid var(--border-default)", padding: "4px 8px", borderRadius: 4, cursor: "pointer" }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Playbooks Selection */}
              <div
                style={{
                  background: "var(--surface-primary)",
                  border: `2px solid ${entityColors.playbook.border}`,
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 16 }}>📒</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{plural("playbook")}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
                    {matrixPlaybookIds.length} selected
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {matrixPlaybookIds.map((id, i) => {
                    const pb = id ? playbooks.find(p => p.id === id) : null;
                    return (
                      <span
                        key={id || "baseline"}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 8px",
                          background: id ? entityColors.playbook.bg : "var(--surface-secondary)",
                          color: id ? entityColors.playbook.text : "var(--text-muted)",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        {pb?.name || "(baseline)"}
                        <button
                          onClick={() => setMatrixPlaybookIds(prev => prev.filter((_, j) => j !== i))}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 14, color: id ? entityColors.playbook.text : "var(--text-muted)", opacity: 0.7 }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
                <FancySelect
                  value=""
                  onChange={(id) => {
                    if (id === "__baseline__") {
                      if (!matrixPlaybookIds.includes(null)) {
                        setMatrixPlaybookIds(prev => [...prev, null]);
                      }
                    } else if (id && !matrixPlaybookIds.includes(id)) {
                      setMatrixPlaybookIds(prev => [...prev, id]);
                    }
                  }}
                  placeholder="+ Add configuration..."
                  options={[
                    { value: "__baseline__", label: "(baseline)", subtitle: `No ${lower("playbook")} - system defaults only` },
                    ...playbooks
                      .filter(p => p.status === "PUBLISHED" && !matrixPlaybookIds.includes(p.id))
                      .map(p => ({
                        value: p.id,
                        label: p.name,
                        subtitle: p.domain?.name,
                      })),
                  ]}
                />
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      const published = playbooks.filter(p => p.status === "PUBLISHED").slice(0, 3).map(p => p.id);
                      setMatrixPlaybookIds([null, ...published]);
                    }}
                    style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "1px solid var(--border-default)", padding: "4px 8px", borderRadius: 4, cursor: "pointer" }}
                  >
                    Baseline + Top 3
                  </button>
                  <button
                    onClick={() => setMatrixPlaybookIds([])}
                    style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "1px solid var(--border-default)", padding: "4px 8px", borderRadius: 4, cursor: "pointer" }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Matrix Grid */}
            {matrixCallerIds.length === 0 || matrixPlaybookIds.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "60px 20px",
                  background: "var(--surface-primary)",
                  borderRadius: 12,
                  border: "1px solid var(--border-default)",
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>📊</div>
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                  Select callers and configurations above to build your test matrix
                </p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--surface-primary)", borderRadius: 12, overflow: "hidden" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: 12, background: "var(--surface-secondary)", borderBottom: "1px solid var(--border-default)", textAlign: "left", fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
                        Caller
                      </th>
                      {matrixPlaybookIds.map((pbId, i) => {
                        const pb = pbId ? playbooks.find(p => p.id === pbId) : null;
                        return (
                          <th
                            key={pbId || "baseline"}
                            style={{
                              padding: 12,
                              background: pbId ? entityColors.playbook.bg : "var(--surface-secondary)",
                              borderBottom: "1px solid var(--border-default)",
                              textAlign: "center",
                              fontSize: 12,
                              fontWeight: 600,
                              color: pbId ? entityColors.playbook.text : "var(--text-muted)",
                              minWidth: 160,
                            }}
                          >
                            {pb?.name || "(baseline)"}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixCallerIds.map(callerId => {
                      const c = callers.find(c => c.id === callerId);
                      return (
                        <tr key={callerId}>
                          <td style={{ padding: 12, borderBottom: "1px solid var(--border-default)", fontSize: 13, fontWeight: 500, color: "var(--text-primary)", background: entityColors.caller.bg }}>
                            {c?.name || c?.email || callerId.slice(0, 8)}
                            {c?.domain && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.domain.name}</div>}
                          </td>
                          {matrixPlaybookIds.map(pbId => {
                            const key = `${callerId}:${pbId || "baseline"}`;
                            const cell = matrixCells.get(key);
                            const isSelected = selectedCells.has(key);
                            const selectionIndex = isSelected ? Array.from(selectedCells).indexOf(key) + 1 : 0;
                            return (
                              <td
                                key={key}
                                onClick={(e) => {
                                  if (cell?.status !== "success") return;
                                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                                    // Multi-select: toggle cell in selection (max 2)
                                    setSelectedCells(prev => {
                                      const next = new Set(prev);
                                      if (next.has(key)) {
                                        next.delete(key);
                                      } else if (next.size < 2) {
                                        next.add(key);
                                      } else {
                                        // Replace oldest selection
                                        const arr = Array.from(next);
                                        next.delete(arr[0]);
                                        next.add(key);
                                      }
                                      return next;
                                    });
                                  } else {
                                    // Single click: select just this one (or deselect if already sole selection)
                                    if (selectedCells.size === 1 && selectedCells.has(key)) {
                                      setSelectedCells(new Set());
                                    } else {
                                      setSelectedCells(new Set([key]));
                                    }
                                  }
                                }}
                                style={{
                                  padding: 12,
                                  borderBottom: "1px solid var(--border-default)",
                                  textAlign: "center",
                                  cursor: cell?.status === "success" ? "pointer" : "default",
                                  background: isSelected
                                    ? selectionIndex === 1 ? "var(--badge-blue-bg, #dbeafe)" : "var(--badge-pink-bg, #fce7f3)"  // blue for 1st, pink for 2nd
                                    : "var(--surface-primary)",
                                  outline: isSelected ? `2px solid ${selectionIndex === 1 ? "var(--accent-primary)" : "var(--badge-pink-text)"}` : "none",
                                  outlineOffset: -2,
                                  transition: "background 0.15s",
                                }}
                              >
                                {!cell ? (
                                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>—</span>
                                ) : cell.status === "generating" ? (
                                  <span className="animate-spin" style={{ fontSize: 16 }}>⟳</span>
                                ) : cell.status === "error" ? (
                                  <span style={{ fontSize: 12, color: "var(--status-error-text)" }} title={cell.error}>❌</span>
                                ) : cell.status === "success" && cell.prompt ? (
                                  <div>
                                    <div style={{ fontSize: 11, color: "var(--status-success-text)", fontWeight: 600 }}>
                                      {isSelected ? <span style={{ color: selectionIndex === 1 ? "var(--accent-primary)" : "var(--badge-pink-text)" }}>{selectionIndex === 1 ? "A" : "B"}</span> : "✓"}
                                    </div>
                                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                      {cell.prompt.inputs?.composition?.sectionsActivated?.length || 0} sections
                                    </div>
                                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                      {((cell.prompt.prompt?.length || 0) / 1000).toFixed(1)}k chars
                                    </div>
                                  </div>
                                ) : null}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Selection Detail / Diff View */}
            {selectedCells.size === 0 && matrixCells.size > 0 && (
              <div style={{ marginTop: 16, padding: 16, background: "var(--surface-secondary)", borderRadius: 8, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                Click a cell to view prompt details. <strong>Shift+click</strong> two cells to compare.
              </div>
            )}

            {/* Single Cell Detail */}
            {selectedCells.size === 1 && (() => {
              const key = Array.from(selectedCells)[0];
              const cell = matrixCells.get(key);
              if (!cell || !cell.prompt) return null;
              return (
                <div
                  style={{
                    marginTop: 20,
                    background: "var(--surface-primary)",
                    border: "2px solid var(--accent-primary)",
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ padding: 16, background: "var(--badge-blue-bg, #dbeafe)", borderBottom: "1px solid var(--badge-blue-border, #93c5fd)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ fontWeight: 700, color: "var(--badge-blue-text, #1d4ed8)", marginRight: 8 }}>A</span>
                      <span style={{ fontWeight: 600, color: "var(--badge-blue-text, #1e40af)" }}>{cell.callerName}</span>
                      <span style={{ color: "var(--accent-primary)", margin: "0 8px" }}>×</span>
                      <span style={{ fontWeight: 600, color: "var(--badge-blue-text, #1e40af)" }}>{cell.playbookName}</span>
                    </div>
                    <button
                      onClick={() => setSelectedCells(new Set())}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--accent-primary)" }}
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ padding: 16, maxHeight: 400, overflow: "auto" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                      Sections: {cell.prompt.inputs?.composition?.sectionsActivated?.join(", ") || "none"}
                    </div>
                    <pre style={{ fontSize: 11, background: "var(--surface-secondary)", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
                      {cell.prompt.prompt}
                    </pre>
                  </div>
                </div>
              );
            })()}

            {/* Diff View (2 cells selected) */}
            {selectedCells.size === 2 && (() => {
              const [keyA, keyB] = Array.from(selectedCells);
              const cellA = matrixCells.get(keyA);
              const cellB = matrixCells.get(keyB);
              if (!cellA?.prompt || !cellB?.prompt) return null;

              const sectionsA = new Set(cellA.prompt.inputs?.composition?.sectionsActivated || []);
              const sectionsB = new Set(cellB.prompt.inputs?.composition?.sectionsActivated || []);
              const allSections = new Set([...sectionsA, ...sectionsB]);
              const onlyInA = [...allSections].filter(s => sectionsA.has(s) && !sectionsB.has(s));
              const onlyInB = [...allSections].filter(s => sectionsB.has(s) && !sectionsA.has(s));
              const inBoth = [...allSections].filter(s => sectionsA.has(s) && sectionsB.has(s));

              return (
                <div style={{ marginTop: 20 }}>
                  {/* Diff Header */}
                  <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                    <div style={{ flex: 1, padding: 12, background: "var(--badge-blue-bg, #dbeafe)", borderRadius: 8, border: "2px solid var(--accent-primary)" }}>
                      <div style={{ fontWeight: 700, color: "var(--badge-blue-text, #1d4ed8)", marginBottom: 4 }}>A</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--badge-blue-text, #1e40af)" }}>{cellA.callerName} × {cellA.playbookName}</div>
                      <div style={{ fontSize: 11, color: "var(--accent-primary)" }}>{sectionsA.size} sections, {((cellA.prompt.prompt?.length || 0) / 1000).toFixed(1)}k chars</div>
                    </div>
                    <div style={{ flex: 1, padding: 12, background: "var(--badge-pink-bg, #fce7f3)", borderRadius: 8, border: "2px solid var(--badge-pink-text)" }}>
                      <div style={{ fontWeight: 700, color: "var(--badge-pink-accent, #be185d)", marginBottom: 4 }}>B</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--badge-pink-accent, #9d174d)" }}>{cellB.callerName} × {cellB.playbookName}</div>
                      <div style={{ fontSize: 11, color: "var(--badge-pink-text)" }}>{sectionsB.size} sections, {((cellB.prompt.prompt?.length || 0) / 1000).toFixed(1)}k chars</div>
                    </div>
                    <button
                      onClick={() => setSelectedCells(new Set())}
                      style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-muted)" }}
                    >
                      ×
                    </button>
                  </div>

                  {/* Section Diff Summary */}
                  <div style={{ padding: 16, background: "var(--surface-secondary)", borderRadius: 8, marginBottom: 16 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Section Differences</div>
                    <div style={{ display: "flex", gap: 24, fontSize: 12 }}>
                      <div>
                        <span style={{ color: "var(--status-success-text)", fontWeight: 600 }}>In both ({inBoth.length}):</span>{" "}
                        <span style={{ color: "var(--text-muted)" }}>{inBoth.join(", ") || "none"}</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>Only in A ({onlyInA.length}):</span>{" "}
                        <span style={{ color: "var(--text-muted)" }}>{onlyInA.join(", ") || "none"}</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--badge-pink-text)", fontWeight: 600 }}>Only in B ({onlyInB.length}):</span>{" "}
                        <span style={{ color: "var(--text-muted)" }}>{onlyInB.join(", ") || "none"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Side-by-Side Prompts */}
                  <div style={{ display: "flex", gap: 16 }}>
                    <div style={{ flex: 1, background: "var(--surface-primary)", border: "1px solid var(--badge-blue-border, #93c5fd)", borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ padding: "8px 12px", background: "var(--badge-blue-bg, #dbeafe)", borderBottom: "1px solid var(--badge-blue-border, #93c5fd)", fontWeight: 600, fontSize: 12, color: "var(--badge-blue-text, #1d4ed8)" }}>
                        Prompt A
                      </div>
                      <pre style={{ fontSize: 10, padding: 12, margin: 0, maxHeight: 400, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {cellA.prompt.prompt}
                      </pre>
                    </div>
                    <div style={{ flex: 1, background: "var(--surface-primary)", border: "1px solid var(--badge-pink-border, #f9a8d4)", borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ padding: "8px 12px", background: "var(--badge-pink-bg, #fce7f3)", borderBottom: "1px solid var(--badge-pink-border, #f9a8d4)", fontWeight: 600, fontSize: 12, color: "var(--badge-pink-accent, #be185d)" }}>
                        Prompt B
                      </div>
                      <pre style={{ fontSize: 10, padding: 12, margin: 0, maxHeight: 400, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {cellB.prompt.prompt}
                      </pre>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ===== MODALS ===== */}

      {/* Create Caller Modal */}
      {showCreateCallerModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCreateCallerModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-primary)",
              borderRadius: 12,
              padding: 24,
              width: 400,
              maxWidth: "90vw",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
          >
            <h2 style={{ margin: "0 0 20px 0", fontSize: 18, fontWeight: 600 }}>Create New Caller</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={newCallerName}
                  onChange={(e) => setNewCallerName(e.target.value)}
                  placeholder="Enter caller name"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Email (optional)
                </label>
                <input
                  type="email"
                  value={newCallerEmail}
                  onChange={(e) => setNewCallerEmail(e.target.value)}
                  placeholder="email@example.com"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Institution (optional)
                </label>
                <FancySelect
                  value={newCallerDomainId}
                  onChange={setNewCallerDomainId}
                  placeholder="No institution"
                  options={[
                    { value: "", label: "No institution" },
                    ...domains.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
              <button
                onClick={() => {
                  setShowCreateCallerModal(false);
                  setNewCallerName("");
                  setNewCallerEmail("");
                  setNewCallerDomainId("");
                }}
                style={{
                  padding: "10px 20px",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 6,
                  background: "var(--surface-primary)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!newCallerName.trim()) return;
                  setCreatingCaller(true);
                  try {
                    const res = await fetch("/api/callers", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: newCallerName.trim(),
                        email: newCallerEmail.trim() || null,
                        domainId: newCallerDomainId || null,
                      }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      setCallers((prev) => [data.caller, ...prev]);
                      handleCallerSelect(data.caller.id);
                      setShowCreateCallerModal(false);
                      setNewCallerName("");
                      setNewCallerEmail("");
                      setNewCallerDomainId("");
                    } else {
                      setError(data.error || "Failed to create caller");
                    }
                  } catch {
                    setError("Failed to create caller");
                  } finally {
                    setCreatingCaller(false);
                  }
                }}
                disabled={!newCallerName.trim() || creatingCaller}
                style={{
                  padding: "10px 20px",
                  border: "none",
                  borderRadius: 6,
                  background: newCallerName.trim() ? "var(--accent-primary)" : "var(--border-default)",
                  color: newCallerName.trim() ? "var(--surface-primary)" : "var(--text-muted)",
                  cursor: newCallerName.trim() ? "pointer" : "not-allowed",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {creatingCaller ? "Creating..." : "Create Caller"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Playbook Modal */}
      {showCreatePlaybookModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCreatePlaybookModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-primary)",
              borderRadius: 12,
              padding: 24,
              width: 400,
              maxWidth: "90vw",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
          >
            <h2 style={{ margin: "0 0 20px 0", fontSize: 18, fontWeight: 600 }}>{`Create New ${terms.playbook}`}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={newPlaybookName}
                  onChange={(e) => setNewPlaybookName(e.target.value)}
                  placeholder={`Enter ${lower("playbook")} name`}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Institution *
                </label>
                <FancySelect
                  value={newPlaybookDomainId}
                  onChange={setNewPlaybookDomainId}
                  placeholder="Select institution..."
                  options={domains.map((d) => ({ value: d.id, label: d.name }))}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
              <button
                onClick={() => {
                  setShowCreatePlaybookModal(false);
                  setNewPlaybookName("");
                  setNewPlaybookDomainId("");
                }}
                style={{
                  padding: "10px 20px",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 6,
                  background: "var(--surface-primary)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!newPlaybookName.trim() || !newPlaybookDomainId) return;
                  setCreatingPlaybook(true);
                  try {
                    const res = await fetch("/api/playbooks", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: newPlaybookName.trim(),
                        domainId: newPlaybookDomainId,
                        status: "DRAFT",
                      }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      // Add the new playbook to the list with its domain
                      const domain = domains.find((d) => d.id === newPlaybookDomainId);
                      setPlaybooks((prev) => [{ ...data.playbook, domain }, ...prev]);
                      setSelectedPlaybookId(data.playbook.id);
                      setShowCreatePlaybookModal(false);
                      setNewPlaybookName("");
                      setNewPlaybookDomainId("");
                    } else {
                      setError(data.error || `Failed to create ${lower("playbook")}`);
                    }
                  } catch {
                    setError(`Failed to create ${lower("playbook")}`);
                  } finally {
                    setCreatingPlaybook(false);
                  }
                }}
                disabled={!newPlaybookName.trim() || !newPlaybookDomainId || creatingPlaybook}
                style={{
                  padding: "10px 20px",
                  border: "none",
                  borderRadius: 6,
                  background: newPlaybookName.trim() && newPlaybookDomainId ? "var(--accent-primary)" : "var(--border-default)",
                  color: newPlaybookName.trim() && newPlaybookDomainId ? "var(--surface-primary)" : "var(--text-muted)",
                  cursor: newPlaybookName.trim() && newPlaybookDomainId ? "pointer" : "not-allowed",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {creatingPlaybook ? "Creating..." : `Create ${terms.playbook}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Domain Modal */}
      {showCreateDomainModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCreateDomainModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-primary)",
              borderRadius: 12,
              padding: 24,
              width: 400,
              maxWidth: "90vw",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
          >
            <h2 style={{ margin: "0 0 20px 0", fontSize: 18, fontWeight: 600 }}>{`Create New ${terms.domain}`}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={newDomainName}
                  onChange={(e) => setNewDomainName(e.target.value)}
                  placeholder="e.g., Customer Support"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Slug (optional)
                </label>
                <input
                  type="text"
                  value={newDomainSlug}
                  onChange={(e) => setNewDomainSlug(e.target.value)}
                  placeholder="e.g., customer-support"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Auto-generated from name if left empty
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
              <button
                onClick={() => {
                  setShowCreateDomainModal(false);
                  setNewDomainName("");
                  setNewDomainSlug("");
                }}
                style={{
                  padding: "10px 20px",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 6,
                  background: "var(--surface-primary)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!newDomainName.trim()) return;
                  setCreatingDomain(true);
                  try {
                    const slug = newDomainSlug.trim() || newDomainName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                    const res = await fetch("/api/domains", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: newDomainName.trim(),
                        slug,
                      }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      setDomains((prev) => [...prev, data.domain]);
                      setSelectedDomainId(data.domain.id);
                      setSelectedPlaybookId("");
                      setShowCreateDomainModal(false);
                      setNewDomainName("");
                      setNewDomainSlug("");
                    } else {
                      setError(data.error || "Failed to create domain");
                    }
                  } catch {
                    setError("Failed to create domain");
                  } finally {
                    setCreatingDomain(false);
                  }
                }}
                disabled={!newDomainName.trim() || creatingDomain}
                style={{
                  padding: "10px 20px",
                  border: "none",
                  borderRadius: 6,
                  background: newDomainName.trim() ? "var(--accent-primary)" : "var(--border-default)",
                  color: newDomainName.trim() ? "var(--surface-primary)" : "var(--text-muted)",
                  cursor: newDomainName.trim() ? "pointer" : "not-allowed",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {creatingDomain ? "Creating..." : `Create ${terms.domain}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Playbook Modal */}
      {showCreatePlaybookModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCreatePlaybookModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface-primary)",
              borderRadius: 12,
              padding: 24,
              width: 400,
              maxWidth: "90vw",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
          >
            <h2 style={{ margin: "0 0 20px 0", fontSize: 18, fontWeight: 600 }}>{`Create New ${terms.playbook}`}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={newPlaybookName}
                  onChange={(e) => setNewPlaybookName(e.target.value)}
                  placeholder="e.g., Onboarding Flow v1"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 6,
                    fontSize: 14,
                  }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 4, color: "var(--text-secondary)" }}>
                  Institution *
                </label>
                <FancySelect
                  value={newPlaybookDomainId}
                  onChange={setNewPlaybookDomainId}
                  placeholder="Select institution..."
                  options={domains.map((d) => ({ value: d.id, label: d.name }))}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
              <button
                onClick={() => {
                  setShowCreatePlaybookModal(false);
                  setNewPlaybookName("");
                  setNewPlaybookDomainId("");
                }}
                style={{
                  padding: "10px 20px",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 6,
                  background: "var(--surface-primary)",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!newPlaybookName.trim() || !newPlaybookDomainId) return;
                  setCreatingPlaybook(true);
                  try {
                    const res = await fetch("/api/playbooks", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: newPlaybookName.trim(),
                        domainId: newPlaybookDomainId,
                      }),
                    });
                    const data = await res.json();
                    if (data.ok) {
                      setPlaybooks((prev) => [...prev, data.playbook]);
                      setSelectedDomainId(newPlaybookDomainId);
                      setSelectedPlaybookId(data.playbook.id);
                      setShowCreatePlaybookModal(false);
                      setNewPlaybookName("");
                      setNewPlaybookDomainId("");
                    } else {
                      setError(data.error || `Failed to create ${lower("playbook")}`);
                    }
                  } catch {
                    setError(`Failed to create ${lower("playbook")}`);
                  } finally {
                    setCreatingPlaybook(false);
                  }
                }}
                disabled={!newPlaybookName.trim() || !newPlaybookDomainId || creatingPlaybook}
                style={{
                  padding: "10px 20px",
                  border: "none",
                  borderRadius: 6,
                  background: newPlaybookName.trim() && newPlaybookDomainId ? "var(--accent-primary)" : "var(--border-default)",
                  color: newPlaybookName.trim() && newPlaybookDomainId ? "var(--surface-primary)" : "var(--text-muted)",
                  cursor: newPlaybookName.trim() && newPlaybookDomainId ? "pointer" : "not-allowed",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {creatingPlaybook ? "Creating..." : `Create ${terms.playbook}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant */}
      <UnifiedAssistantPanel
        visible={assistant.isOpen}
        onClose={assistant.close}
        context={assistant.context}
        location={assistant.location}
        {...assistant.options}
      />
    </div>
  );
}
