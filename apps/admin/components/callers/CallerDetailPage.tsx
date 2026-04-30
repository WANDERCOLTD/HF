"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEntityContext } from "@/contexts/EntityContext";
import { DomainPill } from "@/src/components/shared/EntityPill";
import { User, BookMarked, PlayCircle, Brain, BarChart3, Target, BookOpen, ClipboardCheck, CheckSquare, GitBranch, MessageCircle, Gauge, Archive, SlidersHorizontal, Phone, TrendingUp, Zap, Play } from "lucide-react";
import { EditableTitle } from "@/components/shared/EditableTitle";
import { FancySelect, type FancySelectOption } from "@/components/shared/FancySelect";
import { SectionSelector, useSectionVisibility } from "@/components/shared/SectionSelector";
import { CallerDomainSection } from "@/components/callers/CallerDomainSection";
import { SimChat } from "@/components/sim/SimChat";
import '@/app/x/sim/sim.css';
import './caller-detail-page.css';
import './caller-detail/lens.css';
import './caller-detail/prompt-tuner.css';
import { useAssistant, useAssistantKeyboardShortcut } from "@/hooks/useAssistant";

// Extracted sub-components
import { ProcessingNotice } from "./caller-detail/CallsTab";
import { MemoriesSection, PersonalitySection, CallerSlugsSection, CallerEnrollmentsSection } from "./caller-detail/ProfileTab";
import { SurveySection } from "./caller-detail/SurveySection";
import { ScoresSection, LearningSection, AssessmentTargetsCard, TopicsCoveredSection, ExamReadinessSection, TopLevelAgentBehaviorSection, PlanProgressSection, ModuleProgressView } from "./caller-detail/ProgressTab";
import { LearningTrajectoryCard } from "./caller-detail/cards/LearningTrajectoryCard";
import { ArtifactsSection } from "./caller-detail/ArtifactsTab";
import { UnifiedPromptSection } from "./caller-detail/PromptsSection";
import { CallsPromptsTab, type BulkActions } from "./caller-detail/CallsPromptsTab";
import { PromptTunerSidebar } from "./caller-detail/PromptTunerSidebar";
import { UpliftTab } from "./caller-detail/UpliftTab";

// Overview lens (now rendered as the first section tab)
import { useCallerInsights } from "./caller-detail/hooks/useCallerInsights";
import { GuideLens } from "./caller-detail/lenses/GuideLens";

// Shared types
import type { CallerData, CallerProfile, CallerRole, Domain, ComposedPrompt, SectionId, ParamConfig } from "./caller-detail/types";

// Journey progress hook
import { useEnrollmentJourney } from "@/hooks/useEnrollmentJourney";

// Session Flow learner-state overlay
import { SessionFlowProgress } from "@/components/session-flow/SessionFlowProgress";


export default function CallerDetailPage() {
  const params = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const callerId = params.callerId as string;
  const { pushEntity } = useEntityContext();

  // Detect if we're in /x/ area and adjust back link accordingly
  const isInXArea = pathname?.startsWith('/x/');
  const backLink = isInXArea ? '/x/callers' : '/callers';

  // Get initial tab from URL param (e.g., ?tab=ai-call)
  // Backwards compat: map old tab IDs to new consolidated tabs
  const tabRedirects: Record<string, SectionId> = {
    // Old consolidated tab IDs → new WHAT/HOW/WHO IDs
    calls: "calls-prompts", profile: "how", progress: "what",
    journey: "calls-prompts",
    // Legacy sub-section IDs → new tabs
    memories: "how", traits: "how", personality: "how", slugs: "how",
    scores: "what", "agent-behavior": "what", learning: "what", "exam-readiness": "what", goals: "what",
    transcripts: "calls-prompts", prompt: "calls-prompts",
  };
  const rawTab = searchParams.get("tab");
  const validTabs: SectionId[] = ["overview", "uplift", "calls-prompts", "how", "what", "artifacts", "ai-call"];
  const mappedTab = rawTab ? (tabRedirects[rawTab] || rawTab) as SectionId : null;
  const lastTabKey = `hf.caller-tab.${callerId}`;
  const savedTab = typeof window !== "undefined" ? window.localStorage.getItem(lastTabKey) as SectionId | null : null;
  const initialTab: SectionId = mappedTab && validTabs.includes(mappedTab)
    ? mappedTab
    : savedTab && validTabs.includes(savedTab)
      ? savedTab
      : "what";

  const [data, setData] = useState<CallerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, _setActiveSection] = useState<SectionId>(initialTab);
  const setActiveSection = (id: SectionId) => {
    _setActiveSection(id);
    try { window.localStorage.setItem(lastTabKey, id); } catch {}
  };
  const [simChatMounted, setSimChatMounted] = useState(initialTab === "ai-call");
  const [callSession, setCallSession] = useState(0);
  if (activeSection === "ai-call" && !simChatMounted) setSimChatMounted(true);

  // Dynamic parameter display configuration (fetched from database)
  const [paramConfig, setParamConfig] = useState<ParamConfig>(null);

  const insights = useCallerInsights(data);

  // Journey progress (shared by ProgressStackCard + CallerEnrollmentsSection)
  const { enrollments: enrollmentJourneys } = useEnrollmentJourney(callerId);

  // Section visibility for consolidated tabs (persisted to localStorage)
  const [profileVis, toggleProfileVis] = useSectionVisibility("caller-profile", {
    memories: true, traits: true, slugs: true, enrollments: true,
  });
  const [enrollmentCount, setEnrollmentCount] = useState(0);

  // Course filter — fetched enrollments + selected playbook
  type Enrollment = { id: string; playbookId: string; status: string; isDefault: boolean; enrolledAt: string; playbook: { id: string; name: string; status: string } };
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("all");
  const [progressVis, toggleProgressVis] = useSectionVisibility("caller-progress", {
    scores: true, behaviour: true, goals: true, exam: true,
  });
  const [hasExamData, setHasExamData] = useState(false);
  const [hasPlanData, setHasPlanData] = useState(false);

  // Expanded states
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
  // Tuner panel state — persisted per caller
  const tunerStorageKey = `hf.tuner.open.${callerId}`;
  const [tunerOpen, setTunerOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(tunerStorageKey) === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(tunerStorageKey, tunerOpen ? "1" : "0");
  }, [tunerOpen, tunerStorageKey]);
  useEffect(() => {
    if (!tunerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTunerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tunerOpen]);
  const [appliedChanges, setAppliedChanges] = useState<{ label: string; oldValue: string; newValue: string }[] | null>(null);

  // Bulk pipeline actions (exposed by CallsPromptsTab for tab-bar buttons)
  const [bulkActions, setBulkActions] = useState<BulkActions | null>(null);

  // Prompts state
  const [composedPrompts, setComposedPrompts] = useState<ComposedPrompt[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Domain state
  const [domains, setDomains] = useState<Domain[]>([]);
  const [showDomainSection, setShowDomainSection] = useState(false);
  const [editingDomain, setEditingDomain] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);

  // Copy feedback state
  const [copiedButton, setCopiedButton] = useState<string | null>(null);
  const copyToClipboard = (text: string, buttonId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedButton(buttonId);
    setTimeout(() => setCopiedButton(null), 1500);
  };

  // ── Inline editing state ──
  const [editingPhone, setEditingPhone] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const CALLER_ROLES: CallerRole[] = ["LEARNER", "TEACHER", "TUTOR", "PARENT", "MENTOR"];

  // Generic PATCH helper for caller fields
  const patchCaller = useCallback(async (fields: Record<string, unknown>) => {
    const res = await fetch(`/api/callers/${callerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || "Update failed");
    return result;
  }, [callerId]);

  const handleSaveName = useCallback(async (newName: string) => {
    const result = await patchCaller({ name: newName });
    if (data) {
      setData({ ...data, caller: result.caller });
    }
  }, [patchCaller, data]);

  const handleSavePhone = useCallback(async () => {
    const trimmed = phoneDraft.trim();
    if (trimmed === (data?.caller.phone || "")) {
      setEditingPhone(false);
      return;
    }
    try {
      const result = await patchCaller({ phone: trimmed || null });
      if (data) setData({ ...data, caller: result.caller });
    } catch (err: any) {
      alert("Failed to update phone: " + err.message);
    }
    setEditingPhone(false);
  }, [phoneDraft, data, patchCaller]);

  const handleSaveEmail = useCallback(async () => {
    const trimmed = emailDraft.trim();
    if (trimmed === (data?.caller.email || "")) {
      setEditingEmail(false);
      return;
    }
    try {
      const result = await patchCaller({ email: trimmed || null });
      if (data) setData({ ...data, caller: result.caller });
    } catch (err: any) {
      alert("Failed to update email: " + err.message);
    }
    setEditingEmail(false);
  }, [emailDraft, data, patchCaller]);

  const handleRoleChange = useCallback(async (newRole: CallerRole) => {
    setShowRoleDropdown(false);
    try {
      const result = await patchCaller({ role: newRole });
      if (data) setData({ ...data, caller: result.caller });
    } catch (err: any) {
      alert("Failed to update role: " + err.message);
    }
  }, [patchCaller, data]);

  const handleArchive = useCallback(async () => {
    if (!confirm("Archive this caller? They will no longer appear in active lists.")) return;
    setArchiving(true);
    try {
      const result = await patchCaller({ archive: true });
      if (data) setData({ ...data, caller: { ...data.caller, archivedAt: result.caller.archivedAt } });
    } catch (err: any) {
      alert("Failed to archive: " + err.message);
    } finally {
      setArchiving(false);
    }
  }, [patchCaller, data]);

  // AI Assistant
  const assistant = useAssistant({
    defaultTab: "chat",
    layout: "popout",
    enabledTabs: ["chat", "data"],
  });

  // Keyboard shortcut for assistant
  useAssistantKeyboardShortcut(assistant.toggle);

  // Fetch prompts when switching to prompts tab
  const fetchPrompts = useCallback(async () => {
    if (!callerId) return;
    setPromptsLoading(true);
    try {
      const res = await fetch(`/api/callers/${callerId}/compose-prompt?limit=50`);
      const result = await res.json();
      if (result.ok) {
        setComposedPrompts(result.prompts);
      }
    } catch (err) {
      console.error("Error fetching prompts:", err);
    } finally {
      setPromptsLoading(false);
    }
  }, [callerId]);


  const fetchData = useCallback(() => {
    if (!callerId) return;

    // Fetch caller data
    fetch(`/api/callers/${callerId}`)
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) {
          // Map personalityProfile -> personality for backward compatibility
          setData({
            ...result,
            personality: result.personalityProfile || null,
          });
          // Register with entity context for AI Chat
          pushEntity({
            type: "caller",
            id: result.caller.id,
            label: result.caller.name || result.caller.email || "Unknown Caller",
            href: `${isInXArea ? '/x' : ''}/callers/${result.caller.id}`,
            data: {
              email: result.caller.email,
              phone: result.caller.phone,
              externalId: result.caller.externalId,
              domainId: result.caller.domainId,
              domain: result.caller.domain,
              callCount: result.counts?.calls || 0,
              memoryCount: result.counts?.memories || 0,
            },
          });
        } else {
          setError(result.error || "Failed to load caller");
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    // Fetch domains for dropdown
    fetch("/api/domains")
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) {
          setDomains(result.domains || []);
        }
      })
      .catch((e) => console.warn("[CallerDetail] Failed to load domains:", e));

    // Fetch prompts for count pill (lightweight, just need the count)
    fetch(`/api/callers/${callerId}/compose-prompt?limit=50`)
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) {
          setComposedPrompts(result.prompts || []);
        }
      })
      .catch((e) => console.warn("[CallerDetail] Failed to load prompts:", e));

    // Fetch enrollments for course filter
    fetch(`/api/callers/${callerId}/enrollments`)
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) {
          const active = (result.enrollments || []).filter((e: Enrollment) => e.status === "ACTIVE");
          setEnrollments(active);
          setEnrollmentCount(active.length);
          // Auto-select: 1 course → that course; 2+ → most recent by enrolledAt
          if (active.length === 1) {
            setSelectedPlaybookId(active[0].playbookId);
          } else if (active.length > 1) {
            const sorted = [...active].sort((a: Enrollment, b: Enrollment) =>
              new Date(b.enrolledAt).getTime() - new Date(a.enrolledAt).getTime()
            );
            setSelectedPlaybookId(sorted[0].playbookId);
          }
        }
      })
      .catch((e) => console.warn("[CallerDetail] Failed to load enrollments:", e));

    // Fetch dynamic parameter display configuration (NO HARDCODING)
    fetch("/api/parameters/display-config")
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) {
          setParamConfig({
            grouped: result.grouped,
            params: result.params,
          });
        }
      })
      .catch((err) => {
        console.error("Failed to load parameter display config:", err);
      });
  }, [callerId, pushEntity, isInXArea]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Course filter options + filtered data ──────────────
  const courseOptions = useMemo((): FancySelectOption[] => {
    const opts: FancySelectOption[] = [
      { value: "all", label: "All Courses" },
    ];
    for (const e of enrollments) {
      opts.push({ value: e.playbookId, label: e.playbook.name });
    }
    return opts;
  }, [enrollments]);

  const filteredCalls = useMemo(() => {
    if (!data?.calls || selectedPlaybookId === "all") return data?.calls || [];
    return data.calls.filter((c) => c.playbookId === selectedPlaybookId);
  }, [data?.calls, selectedPlaybookId]);

  const filteredPrompts = useMemo(() => {
    if (selectedPlaybookId === "all") return composedPrompts;
    return composedPrompts.filter((p) => p.playbookId === selectedPlaybookId || !p.playbookId);
  }, [composedPrompts, selectedPlaybookId]);

  // ── Processing detection + auto-poll ──────────────
  // A call is "processing" if it's recent (< 5 min) and hasn't been analyzed yet.
  // When processing calls exist, poll every 5s to pick up pipeline results.
  const PROCESSING_WINDOW_MS = 5 * 60 * 1000;
  const processingCallIds = useMemo(() => {
    if (!data?.calls) return new Set<string>();
    const now = Date.now();
    return new Set(
      data.calls
        .filter((c) => {
          const age = now - new Date(c.createdAt).getTime();
          return age < PROCESSING_WINDOW_MS && !c.hasScores && !c.hasPrompt;
        })
        .map((c) => c.id)
    );
  }, [data?.calls]);

  const isProcessing = processingCallIds.size > 0;

  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(async () => {
      try {
        const r = await fetch(`/api/callers/${callerId}/status`);
        const result = await r.json();
        if (!result.ok) return;

        const stillProcessing = result.calls.some(
          (c: { hasScores: boolean; hasPrompt: boolean }) => !c.hasScores && !c.hasPrompt,
        );
        if (!stillProcessing) {
          // All calls analyzed — do one full refetch
          const full = await fetch(`/api/callers/${callerId}`);
          const fullResult = await full.json();
          if (fullResult.ok) {
            setData({ ...fullResult, personality: fullResult.personalityProfile || null });
          }
        }
      } catch (e) {
        console.warn("[CallerDetail] Polling fetch failed:", e);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isProcessing, callerId]);

  // Update caller domain
  const handleDomainChange = async (domainId: string | null) => {
    if (!data) return;
    setSavingDomain(true);
    try {
      const res = await fetch(`/api/callers/${callerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId }),
      });
      const result = await res.json();
      if (result.ok) {
        setData({
          ...data,
          caller: result.caller,
        });
        setEditingDomain(false);
      } else {
        alert("Failed to update domain: " + result.error);
      }
    } catch (err: any) {
      alert("Error updating domain: " + err.message);
    } finally {
      setSavingDomain(false);
    }
  };

  // Fetch prompts on mount for Active Prompt section
  useEffect(() => {
    if (composedPrompts.length === 0) {
      fetchPrompts();
    }
  }, [fetchPrompts, composedPrompts.length]);

  const getCallerLabel = (caller: CallerProfile | undefined) => {
    if (!caller) return "Unknown";
    return caller.name || caller.email || caller.phone || caller.externalId || "Unknown";
  };

  if (loading) {
    return (
      <div className="cdp-loading">Loading caller profile...</div>
    );
  }

  if (error || !data) {
    return (
      <div className="cdp-error-wrap">
        <div className="cdp-error-box">
          {error || "Caller not found"}
        </div>
      </div>
    );
  }

  // Sections organized to mirror Course WHAT | HOW | WHO from learner's perspective:
  // Journey (call history) | How (profile/traits) | What (scores/goals) | Artifacts | Call
  // Tabs affected by pipeline processing (will show pulsing indicator)
  const processingTabs = new Set<SectionId>(["calls-prompts", "how", "what", "uplift", "artifacts"]);

  const sections: { id: SectionId; label: string; icon: React.ReactNode; count?: number; special?: boolean; group: "history" | "caller" | "shared" | "action" }[] = [
    { id: "overview", label: "Overview", icon: <span aria-hidden>🧭</span>, group: "shared" },
    { id: "calls-prompts", label: "Calls & Prompts", icon: <Phone size={13} />, count: data.counts.calls, group: "history" },
    { id: "how", label: "How", icon: <User size={13} />, count: (data.counts.memories || 0) + (data.counts.observations || 0), group: "caller" },
    { id: "what", label: "What", icon: <Gauge size={13} />, count: (new Set(data.scores?.map((s: any) => s.parameterId)).size || 0) + (data.counts.callerTargets || 0) + (data.counts.measurements || 0), group: "shared" },
    { id: "artifacts", label: "Artifacts", icon: <BookMarked size={13} />, count: (data.counts.artifacts || 0) + (data.counts.actions || 0), group: "shared" },
    { id: "uplift", label: "Uplift", icon: <TrendingUp size={13} />, group: "shared" },
    { id: "session-flow", label: "Session Flow", icon: <SlidersHorizontal size={13} />, group: "shared" },
    { id: "ai-call", label: "Call", icon: <PlayCircle size={13} />, special: true, group: "action" },
  ];

  return (
    <div className="cdp-root">
      {/* Header */}
      <div className="cdp-header">
        <div className="cdp-header-row">
          <div className="cdp-avatar">
            👤
          </div>
          <div className="cdp-info">
            <div className="cdp-name-row">
              <EditableTitle
                value={getCallerLabel(data.caller)}
                onSave={handleSaveName}
                as="h1"
              />
              {/* Role Badge */}
              <div className="cdp-role-badge-wrap">
                <button
                  className={`cdp-role-badge cdp-role-${(data.caller.role || "LEARNER").toLowerCase()}`}
                  onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                  title="Click to change role"
                >
                  {data.caller.role || "LEARNER"}
                </button>
                {showRoleDropdown && (
                  <div className="cdp-role-dropdown">
                    {CALLER_ROLES.map((r) => (
                      <button
                        key={r}
                        className={`cdp-role-dropdown-item${r === (data.caller.role || "LEARNER") ? " cdp-role-dropdown-item--active" : ""}`}
                        onClick={() => handleRoleChange(r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Domain Badge (click to expand domain section) */}
              <div
                onClick={() => {
                  setActiveSection("overview"); // Navigate to Overview
                  setShowDomainSection(!showDomainSection);
                }}
                className="cdp-domain-badge"
                title="Click to manage institution & onboarding"
              >
                {data.caller.domain ? (
                  <DomainPill label={data.caller.domain.name} size="compact" />
                ) : (
                  <span className="cdp-no-domain">
                    No Institution
                  </span>
                )}
                <span className="cdp-domain-chevron">
                  {showDomainSection ? "▼" : "▶"}
                </span>
              </div>
              {/* Course Selector — filter page by enrolled course */}
              {enrollments.length > 0 && (
                <div className="cdp-course-select">
                  <FancySelect
                    value={selectedPlaybookId}
                    onChange={setSelectedPlaybookId}
                    options={courseOptions}
                    placeholder="Course"
                    searchable={false}
                    clearable={false}
                  />
                </div>
              )}
            </div>
            <div className="cdp-contact-row">
              {/* Editable Phone */}
              {editingPhone ? (
                <span className="cdp-contact-item">
                  📱{" "}
                  <input
                    className="cdp-contact-input"
                    type="tel"
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    onBlur={handleSavePhone}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleSavePhone(); }
                      if (e.key === "Escape") { setEditingPhone(false); }
                    }}
                    autoFocus
                    placeholder="Phone number"
                  />
                </span>
              ) : data.caller.phone ? (
                <span
                  className="cdp-contact-item cdp-contact-editable"
                  onClick={() => { setPhoneDraft(data.caller.phone || ""); setEditingPhone(true); }}
                  title="Click to edit phone"
                >
                  📱 {data.caller.phone}
                </span>
              ) : (
                <span
                  className="cdp-contact-item cdp-contact-add"
                  onClick={() => { setPhoneDraft(""); setEditingPhone(true); }}
                  title="Click to add phone"
                >
                  📱 Add phone
                </span>
              )}
              {/* Editable Email */}
              {editingEmail ? (
                <span className="cdp-contact-item">
                  ✉️{" "}
                  <input
                    className="cdp-contact-input"
                    type="email"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    onBlur={handleSaveEmail}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); handleSaveEmail(); }
                      if (e.key === "Escape") { setEditingEmail(false); }
                    }}
                    autoFocus
                    placeholder="Email address"
                  />
                </span>
              ) : data.caller.email ? (
                <span
                  className="cdp-contact-item cdp-contact-editable"
                  onClick={() => { setEmailDraft(data.caller.email || ""); setEditingEmail(true); }}
                  title="Click to edit email"
                >
                  ✉️ {data.caller.email}
                </span>
              ) : (
                <span
                  className="cdp-contact-item cdp-contact-add"
                  onClick={() => { setEmailDraft(""); setEditingEmail(true); }}
                  title="Click to add email"
                >
                  ✉️ Add email
                </span>
              )}
              {data.caller.externalId && (
                <span className="cdp-external-id">
                  ID: {data.caller.externalId}
                </span>
              )}
              {/* Compact Personality Profile - DYNAMIC (shows first 6 parameters) */}
              {data.personality && data.personality.parameterValues && paramConfig && (
                <div className="cdp-personality-strip">
                  <span className="cdp-personality-icon">🧠</span>
                  {Object.entries(data.personality.parameterValues)
                    .slice(0, 6)
                    .map(([key, value]) => {
                      const info = paramConfig.params[key];
                      if (!info || value === undefined || value === null) return null;
                      const level = value >= 0.7 ? "high" : value <= 0.3 ? "low" : "med";
                      return (
                        <span
                          key={key}
                          title={`${info.label}: ${(value * 100).toFixed(0)}%`}
                          className={`cdp-param-chip cdp-param-chip--${level}`}
                        >
                          {info.label.charAt(0)}{(value * 100).toFixed(0)}
                        </span>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
          {/* Analyze Button - runs spec-driven pipeline (prep mode) on all calls */}
          <button
            onClick={async (e) => {
              if (!confirm("Run analysis on this caller's calls?\n\nThis uses the spec-driven pipeline to:\n• Score behavioral parameters\n• Extract memories (pets, preferences, facts)\n• Update caller profile")) return;

              const btn = e.currentTarget;
              const originalText = btn.textContent;

              try {
                btn.disabled = true;
                btn.textContent = "Analyzing...";

                const callsRes = await fetch(`/api/calls?callerId=${callerId}`);
                const callsData = await callsRes.json();

                if (!callsData.ok || !callsData.calls?.length) {
                  alert("No calls found for this caller");
                  return;
                }

                let analyzed = 0;
                let errors = 0;
                const sorted = [...callsData.calls].sort(
                  (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                );
                for (const call of sorted) {
                  btn.textContent = `Analyzing ${++analyzed}/${sorted.length}...`;
                  try {
                    await fetch(`/api/calls/${call.id}/pipeline`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ callerId, mode: "prep", force: true }),
                    });
                  } catch {
                    errors++;
                  }
                }

                alert(`Analysis complete!\n\nAnalyzed ${analyzed} call(s)${errors > 0 ? `\n${errors} error(s)` : ""}\nRefreshing...`);
                window.location.reload();
              } catch (err: any) {
                alert(`Error: ${err.message}`);
                btn.disabled = false;
                btn.textContent = originalText || "Analyze";
              }
            }}
            title="Run spec-driven analysis pipeline on all calls"
            className="cdp-btn-analyze"
          >
            Analyze
          </button>

          {/* Ask AI Button */}
          <button
            onClick={() => {
              if (data?.caller) {
                assistant.openWithCaller(data.caller);
              } else {
                assistant.open(undefined, { page: `/x/callers/${callerId}` });
              }
            }}
            title="Ask AI Assistant (Cmd+Shift+K)"
            className="cdp-btn-ask-ai"
          >
            ✨ Ask AI
          </button>

          {/* Export Data Button (GDPR SAR) */}
          <button
            onClick={async () => {
              setExporting(true);
              try {
                const res = await fetch(`/api/callers/${callerId}/export`);
                const data = await res.json();
                if (!data.ok) throw new Error(data.error || "Export failed");

                const blob = new Blob([JSON.stringify(data.export, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `caller-${callerId}-export.json`;
                a.click();
                URL.revokeObjectURL(url);
              } catch (err: any) {
                alert(`Export failed: ${err.message}`);
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting}
            title="Export all caller data (GDPR)"
            className="cdp-btn-export"
          >
            {exporting ? "Exporting..." : "Export Data"}
          </button>

          {/* Archive Button — only shown when NOT archived */}
          {!data.caller.archivedAt && (
            <button
              onClick={handleArchive}
              disabled={archiving}
              title="Archive this caller"
              className="cdp-btn-archive"
            >
              <Archive size={14} />
              {archiving ? "Archiving..." : "Archive"}
            </button>
          )}
        </div>
      </div>

      {/* Archive Banner */}
      {data.caller.archivedAt && (
        <div className="cdp-archive-banner">
          <span>This caller was archived on {new Date(data.caller.archivedAt).toLocaleDateString()}</span>
          <button
            onClick={async () => {
              try {
                const res = await fetch(`/api/callers/${callerId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ archive: false }),
                });
                const result = await res.json();
                if (result.ok) {
                  setData({ ...data, caller: { ...data.caller, archivedAt: null } });
                }
              } catch {}
            }}
            className="cdp-btn-unarchive"
          >
            Unarchive
          </button>
        </div>
      )}

      {/* Processing Banner */}
      {isProcessing && (
        <div className="cdp-processing-banner">
          <span className="cdp-processing-spinner-ring" />
          Processing {processingCallIds.size === 1 ? "latest call" : `${processingCallIds.size} calls`} — extracting scores, memories, and generating prompt...
        </div>
      )}

      {/* Section Tabs */}
      <div className="cdp-tab-bar">
        {sections.map((section) => {
          const isActive = activeSection === section.id;
          const isSpecial = section.special;

          const cls = [
            "cdp-tab",
            isActive && "cdp-tab-active",
            isSpecial && "cdp-tab-special",
          ].filter(Boolean).join(" ");

          return (
            <span key={section.id} className="cdp-tab-wrapper">
              <button
                onClick={() => setActiveSection(section.id)}
                className={cls}
              >
                <span className="cdp-tab-icon">{section.icon}</span>
                {section.label}
                {section.count !== undefined && section.count > 0 && (
                  <span className="cdp-tab-count">
                    {section.count}
                  </span>
                )}
                {isProcessing && processingTabs.has(section.id) && (
                  <span className="cdp-tab-processing" title="Pipeline processing..." />
                )}
              </button>
            </span>
          );
        })}

        {/* Right-aligned action group */}
        <div className="cdp-tab-actions">
          {bulkActions?.hasCalls && (
            <>
              <button
                className="cdp-tab-action"
                onClick={() => bulkActions.runBulkPipeline("prep")}
                disabled={bulkActions.bulkRunning !== null}
                title="Run analysis on all calls"
              >
                <Zap size={13} />
                {bulkActions.bulkRunning === "prep"
                  ? `${bulkActions.bulkProgress?.current}/${bulkActions.bulkProgress?.total}`
                  : "Analyse All"}
              </button>
              <button
                className="cdp-tab-action cdp-tab-action--primary"
                onClick={() => bulkActions.runBulkPipeline("prompt")}
                disabled={bulkActions.bulkRunning !== null}
                title="Generate prompts for all calls"
              >
                <Play size={13} />
                {bulkActions.bulkRunning === "prompt"
                  ? `${bulkActions.bulkProgress?.current}/${bulkActions.bulkProgress?.total}`
                  : "Prompt All"}
              </button>
            </>
          )}
          {composedPrompts.length > 0 && (
            <button
              onClick={() => setTunerOpen(!tunerOpen)}
              title="Adjust teaching style and behaviour targets"
              className={`cdp-tune-btn${tunerOpen ? " cdp-tune-btn--active" : ""}`}
            >
              <SlidersHorizontal size={14} />
              Tune
            </button>
          )}
        </div>
      </div>

      {/* Section Content */}
      <div className="cdp-body">
      <div className="cdp-content">
      {activeSection === "overview" && (
        <>
          {/* Domain & Onboarding Section - Collapsible */}
          {showDomainSection && (
            <CallerDomainSection
              caller={{
                id: data.caller.id,
                domainId: data.caller.domainId,
                domain: data.caller.domain,
                domainSwitchCount: 0,
                previousDomainId: null,
              }}
              onboardingSession={null}
              availableDomains={domains}
              onDomainSwitched={() => {
                fetchData();
                setShowDomainSection(false);
              }}
            />
          )}

          {insights ? (
            <GuideLens
              data={data}
              insights={insights}
              paramConfig={paramConfig}
              enrollmentJourneys={enrollmentJourneys}
              onNavigateToCall={(callId) => {
                setActiveSection("calls-prompts");
                setExpandedCall(callId);
              }}
              onNavigateToTab={(tab) => {
                setActiveSection(tab);
              }}
              onStartSim={() => {
                setActiveSection("ai-call");
                setSimChatMounted(true);
              }}
            />
          ) : (
            <div className="hf-empty">
              <h3>No activity yet</h3>
              <p>Start a practice call to see this learner&rsquo;s overview — progress, memory, and goals will appear here after the first session.</p>
              <button
                className="hf-btn hf-btn-primary"
                onClick={() => {
                  setActiveSection("ai-call");
                  setSimChatMounted(true);
                }}
              >
                Start practice call
              </button>
            </div>
          )}
        </>
      )}

      {activeSection === "uplift" && (
        <UpliftTab callerId={callerId} insights={insights} />
      )}

      {activeSection === "calls-prompts" && (
        <CallsPromptsTab
          calls={filteredCalls}
          composedPrompts={filteredPrompts}
          callerId={callerId}
          processingCallIds={processingCallIds}
          expandedCall={expandedCall}
          setExpandedCall={setExpandedCall}
          onBulkActionsReady={setBulkActions}
          onCallUpdated={() => {
            fetch(`/api/callers/${callerId}`)
              .then((r) => r.json())
              .then((result) => {
                if (result.ok) {
                  setData({
                    ...result,
                    personality: result.personalityProfile || null,
                  });
                }
              });
            fetchPrompts();
          }}
        />
      )}

      {activeSection === "how" && (
        <>
          {isProcessing && !data.counts.memories && !data.counts.observations && (
            <ProcessingNotice message="Memories and personality traits will appear here once analysis completes." />
          )}
          <SectionSelector
            storageKey="caller-profile"
            sections={[
              { id: "memories", label: "Memories", icon: <MessageCircle size={13} />, count: data.counts.memories },
              { id: "traits", label: "Traits", icon: <Brain size={13} />, count: data.counts.observations },
              { id: "slugs", label: "Identity", icon: <GitBranch size={13} /> },
              { id: "enrollments", label: "Enrolled", icon: <BookMarked size={13} />, count: enrollmentCount || undefined },
            ]}
            visible={profileVis}
            onToggle={toggleProfileVis}
          >
            {/* Memory category chips inline */}
            {data.memorySummary && profileVis.memories !== false && (
              <>
                <div className="cdp-section-divider" />
                {[
                  { label: "Facts", count: data.memorySummary.factCount, cat: "fact" },
                  { label: "Prefs", count: data.memorySummary.preferenceCount, cat: "preference" },
                  { label: "Events", count: data.memorySummary.eventCount, cat: "event" },
                  { label: "Topics", count: data.memorySummary.topicCount, cat: "topic" },
                ].map((stat) => (
                  <span
                    key={stat.label}
                    className={`cdp-memory-cat-chip cdp-memory-cat-chip--${stat.cat}`}
                  >
                    {stat.count} {stat.label}
                  </span>
                ))}
              </>
            )}
          </SectionSelector>
          {profileVis.memories !== false && (
            <MemoriesSection
              memories={data.memories}
              summary={data.memorySummary}
              expandedMemory={expandedMemory}
              setExpandedMemory={setExpandedMemory}
              hideSummary
            />
          )}
          {profileVis.traits !== false && (
            <PersonalitySection
              personality={data.personality}
              observations={data.observations}
              paramConfig={paramConfig}
            />
          )}
          {profileVis.slugs !== false && (
            <CallerSlugsSection callerId={callerId} />
          )}
          {profileVis.enrollments !== false && (
            <CallerEnrollmentsSection callerId={callerId} domainId={data.caller?.domainId} onCountChange={setEnrollmentCount} enrollmentJourneys={enrollmentJourneys} />
          )}
          <SurveySection callerId={callerId} />
        </>
      )}

      {activeSection === "what" && (
        <>
          {isProcessing && !data.scores?.length && !data.counts.measurements && (
            <ProcessingNotice message="Scores and behaviour data will appear here once analysis completes." />
          )}
          <SectionSelector
            storageKey="caller-progress"
            sections={[
              { id: "scores", label: "Scores", icon: <BarChart3 size={13} />, count: new Set(data.scores?.map((s: any) => s.parameterId)).size || 0 },
              { id: "behaviour", label: "Behaviour", icon: <Brain size={13} />, count: (data.counts.callerTargets || 0) + (data.counts.measurements || 0) },
              { id: "goals", label: "Goals", icon: <Target size={13} />, count: data.counts.activeGoals || 0 },
              { id: "topics", label: "Topics", icon: <BookOpen size={13} />, count: (data.memorySummary?.topicCount || 0) + (data.counts.keyFacts || 0) },
              ...(hasExamData ? [{ id: "exam" as const, label: "Exam", icon: <ClipboardCheck size={13} /> }] : []),
              ...(hasPlanData ? [{ id: "plan" as const, label: "Plan", icon: <CheckSquare size={13} /> }] : []),
            ]}
            visible={progressVis}
            onToggle={toggleProgressVis}
          />
          {progressVis.scores !== false && <ScoresSection scores={data.scores} />}
          {progressVis.behaviour !== false && <TopLevelAgentBehaviorSection callerId={callerId} calls={data.calls} callerTargets={data.callerTargets} />}
          <ModuleProgressView callerId={callerId} />
          {progressVis.goals !== false && data.goals && (
            <AssessmentTargetsCard goals={data.goals} callerId={callerId} />
          )}
          {progressVis.goals !== false && (
            <LearningSection curriculum={data.curriculum} learnerProfile={data.learnerProfile} goals={data.goals} callerId={callerId} />
          )}
          {progressVis.topics !== false && (
            <TopicsCoveredSection memorySummary={data.memorySummary} keyFactCount={data.counts.keyFacts || 0} />
          )}
          {progressVis.exam !== false && <ExamReadinessSection callerId={callerId} onDataLoaded={setHasExamData} />}
          {progressVis.plan !== false && <PlanProgressSection callerId={callerId} calls={data.calls} domainId={data.caller?.domainId} onDataLoaded={setHasPlanData} />}
          <LearningTrajectoryCard callerId={callerId} />
        </>
      )}

      {activeSection === "artifacts" && (
        <ArtifactsSection callerId={callerId} isProcessing={isProcessing} />
      )}

      {activeSection === "session-flow" && (
        <div className="hf-mt-lg">
          <SessionFlowProgress callerId={callerId} />
        </div>
      )}

      {simChatMounted && (
        <div className={activeSection === "ai-call" ? undefined : "hf-hidden"}>
          <SimChat
            key={callSession}
            callerId={callerId}
            callerName={data.caller.name || "Caller"}
            domainName={data.caller.domain?.name}
            playbookId={selectedPlaybookId === "all" ? undefined : selectedPlaybookId}
            mode="embedded"
            onCallEnd={() => {
              fetch(`/api/callers/${callerId}`)
                .then((r) => r.json())
                .then((result) => {
                  if (result.ok) {
                    setData({
                      ...result,
                      personality: result.personalityProfile || null,
                    });
                  }
                });
              fetchPrompts();
            }}
            onNewCall={() => setCallSession(prev => prev + 1)}
          />
        </div>
      )}
      </div>{/* cdp-content */}

      {/* Tuning panel — inline slide-out, stays open across tab switches */}
      {tunerOpen && composedPrompts.length > 0 && (
        <div className="cdp-tuning-panel">
          <details className="cdp-prompt-collapse">
            <summary className="cdp-prompt-collapse-toggle">
              Prompt Preview
              <span className="cdp-prompt-collapse-hint">#{composedPrompts.length}</span>
            </summary>
            <div className="cdp-prompt-collapse-body">
              <UnifiedPromptSection
                prompts={composedPrompts}
                loading={promptsLoading}
                onRefresh={fetchPrompts}
                callerId={callerId}
                appliedChanges={appliedChanges}
                onDismissApplied={() => setAppliedChanges(null)}
              />
            </div>
          </details>
          <PromptTunerSidebar
            inline
            open
            llmPrompt={composedPrompts[composedPrompts.length - 1]?.llmPrompt ?? null}
            callerId={callerId}
            callerName={data.caller.name || "Learner"}
            playbookId={
              selectedPlaybookId !== "all"
                ? selectedPlaybookId
                : (data.publishedPlaybookId ?? null)
            }
            onApplied={(changes) => {
              setAppliedChanges(changes.map((c) => ({
                label: c.label,
                oldValue: c.oldValue,
                newValue: c.newValue,
              })));
              fetchPrompts();
            }}
            onClose={() => setTunerOpen(false)}
          />
        </div>
      )}
      </div>{/* cdp-body */}
    </div>
  );
}
