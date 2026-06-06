"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEntityContext } from "@/contexts/EntityContext";
import { DomainPill } from "@/src/components/shared/EntityPill";
import { User, BookMarked, PlayCircle, Brain, BarChart3, Target, BookOpen, ClipboardCheck, CheckSquare, GitBranch, MessageCircle, Gauge, Archive, SlidersHorizontal, Phone, TrendingUp, Zap, Play } from "lucide-react";
import { EditableTitle } from "@/components/shared/EditableTitle";
import { FancySelect, type FancySelectOption } from "@/components/shared/FancySelect";
import { SectionSelector, useSectionVisibility } from "@/components/shared/SectionSelector";
import { CallerDomainSection } from "@/components/callers/CallerDomainSection";
import { VoiceProviderOverride } from "@/components/callers/VoiceProviderOverride";
import { VoiceCostPanel } from "@/components/callers/VoiceCostPanel";
import { SimChat } from "@/components/sim/SimChat";
import { ModulePickerSelectionBanner, ModulePickerInviteBanner } from "@/components/sim/ModulePickerBanners";
import { SimStateBreadcrumb } from "@/components/sim/SimStateBreadcrumb";
import '@/app/x/sim/sim.css';
import './caller-detail-page.css';
import './caller-detail/lens.css';
import './caller-detail/prompt-tuner.css';
import { useAssistant, useAssistantKeyboardShortcut } from "@/hooks/useAssistant";
import { TabWithHelp } from "@/components/help/TabWithHelp";
import { getPageHelp } from "@/lib/help/page-help";

// Extracted sub-components
import { ProcessingNotice } from "./caller-detail/CallsTab";
import { MemoriesSection, PersonalitySection, CallerSlugsSection, CallerEnrollmentsSection } from "./caller-detail/ProfileTab";
import { SurveySection } from "./caller-detail/SurveySection";
import { ScoresSection, LearningSection, AssessmentTargetsCard, TopicsCoveredSection, ExamReadinessSection, TopLevelAgentBehaviorSection, PlanProgressSection, ModuleProgressView } from "./caller-detail/ProgressTab";
import { LearningTrajectoryCard } from "./caller-detail/cards/LearningTrajectoryCard";
import { ArtifactsSection } from "./caller-detail/ArtifactsTab";
import { PromptTimelineRows } from "./caller-detail/PromptTimelineRows";
import { CallsPromptsTab, type BulkActions } from "./caller-detail/CallsPromptsTab";
import { PromptTunerSidebar } from "./caller-detail/PromptTunerSidebar";
import { StalePromptPill } from "./caller-detail/StalePromptPill";
import { UpliftTab } from "./caller-detail/UpliftTab";
import { UpliftV2Tab } from "./caller-detail/caller-detail-v2/UpliftV2Tab";
import { ProgressV2Tab } from "./caller-detail/caller-detail-v2/ProgressV2Tab";
import { V1BetaBanner } from "./caller-detail/caller-detail-v2/V1BetaBanner";
import { OverviewV2Tab } from "./caller-detail/caller-detail-v2/OverviewV2Tab";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const callerId = params.callerId as string;
  const { pushEntity } = useEntityContext();

  // Detect if we're in /x/ area and adjust back link accordingly
  const isInXArea = pathname?.startsWith('/x/');
  const backLink = isInXArea ? '/x/callers' : '/callers';

  // Get initial tab from URL param (e.g., ?tab=ai-call)
  // Backwards compat: map old tab IDs to new consolidated tabs.
  // v1 → v2 retirement: any URL pointing at a v1 (or hidden) tab lands on
  // its v2 equivalent so bookmarks keep working.
  const tabRedirects: Record<string, SectionId> = {
    // v1 → v2
    overview: "overview-v2",
    uplift: "uplift-v2",
    what: "progress-v2",
    progress: "progress-v2",
    // Old consolidated tab IDs → new WHAT/HOW/WHO IDs
    calls: "calls-prompts", profile: "how",
    journey: "calls-prompts",
    // Legacy sub-section IDs → new tabs
    memories: "how", traits: "how", personality: "how", slugs: "how",
    scores: "progress-v2", "agent-behavior": "progress-v2", learning: "progress-v2", "exam-readiness": "progress-v2", goals: "progress-v2",
    transcripts: "calls-prompts", prompt: "calls-prompts",
    // Hidden tabs land on the new default Overview
    artifacts: "overview-v2",
  };
  const rawTab = searchParams.get("tab");
  // Tabs that may render but DO NOT appear in the tab bar (legacy / hidden).
  // The validTabs list keeps render branches reachable via ?tab=<id>; the
  // tab bar itself is built from the VISIBLE_TABS subset below.
  const validTabs: SectionId[] = ["overview", "overview-v2", "uplift", "uplift-v2", "calls-prompts", "tune", "how", "what", "progress-v2", "artifacts", "ai-call", "session-flow"];
  const VISIBLE_TABS = new Set<SectionId>([
    "overview-v2",
    "calls-prompts",
    "tune",
    "progress-v2",
    "uplift-v2",
    "session-flow",
    "how",
    "ai-call",
  ]);
  const mappedTab = rawTab ? (tabRedirects[rawTab] || rawTab) as SectionId : null;
  const lastTabKey = `hf.caller-tab.${callerId}`;
  // Also redirect a v1 / hidden id from localStorage so returning users land
  // on the new equivalent instead of a hidden tab they can no longer reach.
  const savedTabRaw = typeof window !== "undefined" ? window.localStorage.getItem(lastTabKey) : null;
  const savedTab = savedTabRaw
    ? ((tabRedirects[savedTabRaw] || savedTabRaw) as SectionId)
    : null;
  // #641: migrate from the old slide-out toggle (`hf.tuner.open.<callerId>`).
  // If the user had Tune open last visit AND no explicit ?tab= is set, send
  // them to the new Tune tab and drop the old key so we never honor it twice.
  const legacyTunerOpenKey = `hf.tuner.open.${callerId}`;
  const legacyTunerOpen = typeof window !== "undefined"
    ? window.localStorage.getItem(legacyTunerOpenKey) === "1"
    : false;
  if (typeof window !== "undefined" && legacyTunerOpen) {
    window.localStorage.removeItem(legacyTunerOpenKey);
  }
  const initialTab: SectionId = mappedTab && validTabs.includes(mappedTab)
    ? mappedTab
    : (!rawTab && legacyTunerOpen)
      ? "tune"
      : savedTab && validTabs.includes(savedTab)
        ? savedTab
        : "overview-v2";

  const [data, setData] = useState<CallerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #688 — page-help registry for tab tooltips. Chord runner + badge are
  // global (ChordShortcutProvider + ChordHintBadge in app/layout.tsx, #966 / #970).
  const pageHelp = useMemo(() => getPageHelp(`/x/callers/${callerId}`), [callerId]);

  const [activeSection, _setActiveSection] = useState<SectionId>(initialTab);
  // Refs mirror the latest active tab + visible sections so the long-lived
  // keydown listener below sees current values without re-binding.
  const activeSectionRef = React.useRef<SectionId>(initialTab);
  const sectionsRef = React.useRef<Array<{ id: SectionId }>>([]);
  const setActiveSection = (id: SectionId) => {
    _setActiveSection(id);
    activeSectionRef.current = id;
    try { window.localStorage.setItem(lastTabKey, id); } catch {}
    // Mirror the active tab to the URL so reload restores it. Without
    // this the URL's stale ?tab= wins over localStorage on reload and the
    // user gets bounced back to whichever tab they originally landed on.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") !== id) {
        params.set("tab", id);
        router.replace(`?${params.toString()}`, { scroll: false });
      }
    }
  };
  const [simChatMounted, setSimChatMounted] = useState(initialTab === "ai-call");
  const [callSession, setCallSession] = useState(0);
  // #396: parent-owned "is a call live?" flag so the SimStateBreadcrumb pill
  // reads "(Active)" while the user is mid-call instead of always "(Pre-call)".
  const [isCallActive, setIsCallActive] = useState(false);
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
  // #1177 — variant fan-out: when a variant Playbook is selected, the call
  // filter must match the variant's sibling family (parent + linked variants
  // sharing the Curriculum), not the variant alone. Populated by the
  // /api/playbooks/[id] fetch below.
  const [variantSiblingIds, setVariantSiblingIds] = useState<string[]>([]);
  // #253-follow-up: surface "Pick module" header button when the active
  // playbook has authored modules. Mirrors /x/sim/[callerId] wiring.
  const [modulesAuthored, setModulesAuthored] = useState<boolean>(false);
  // #357: authored modules — needed so the selection banner can resolve a
  // human label for the module id rather than show the raw id.
  const [authoredModules, setAuthoredModules] = useState<Array<{ id: string; label?: string }>>([]);
  const requestedModuleId = searchParams.get("requestedModuleId") || undefined;
  const [progressVis, toggleProgressVis] = useSectionVisibility("caller-progress", {
    scores: true, behaviour: true, goals: true, exam: true,
  });
  const [hasExamData, setHasExamData] = useState(false);
  const [hasPlanData, setHasPlanData] = useState(false);

  // Expanded states
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
  // #641: tuner state moved from a slide-out toggle to a top-level tab. The
  // legacy `hf.tuner.open.<callerId>` localStorage key is migrated to a
  // deep-link to ?tab=tune on next visit (see initialTab resolution above).
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


  // #972 — five init endpoints fire in parallel via Promise.allSettled.
  // Why allSettled (not all): each fetch has independent error handling;
  // a 500 on /api/domains must NOT prevent the caller from rendering. all()
  // would short-circuit on first failure and hide everything.
  //
  // AbortController cleanup is mandatory — if the user navigates away mid-
  // load, abandoned resolutions would setState on an unmounted component
  // (React 18 swallows the warning; React 19 may throw). The signal is wired
  // through every fetch and the cleanup function returned from useEffect
  // calls abort() to short-circuit any pending resolution.
  //
  // React 18 batches all setState calls inside the allSettled .then() into a
  // single re-render automatically — so mount goes from 5+ renders (one per
  // sequential fetch) down to 2 (loading → loaded).
  const fetchData = useCallback((signal?: AbortSignal) => {
    if (!callerId) return;

    Promise.allSettled([
      fetch(`/api/callers/${callerId}`, { signal }).then((r) => r.json()),
      fetch("/api/domains", { signal }).then((r) => r.json()),
      fetch(`/api/callers/${callerId}/compose-prompt?limit=50`, { signal }).then((r) => r.json()),
      fetch(`/api/callers/${callerId}/enrollments`, { signal }).then((r) => r.json()),
      fetch("/api/parameters/display-config", { signal }).then((r) => r.json()),
    ]).then(([callerRes, domainsRes, promptsRes, enrollmentsRes, paramConfigRes]) => {
      if (signal?.aborted) return;

      // Caller (critical path — unblocks main render)
      if (callerRes.status === "fulfilled") {
        const result = callerRes.value;
        if (result.ok) {
          // Map personalityProfile -> personality for backward compatibility
          setData({
            ...result,
            personality: result.personalityProfile || null,
          });
          // Register with entity context for AI Chat.
          //
          // Order matters: pushEntity at EntityContext.tsx:113 truncates the
          // breadcrumb stack whenever a re-push lands on an entity already
          // present (back-stack nav behaviour). If we pushed playbook FIRST
          // then caller, and the caller was already in sessionStorage from a
          // prior visit, the second push (caller) found itself at index 0
          // and sliced the playbook back out — leaving the chat with only
          // the caller UUID. The model would then invent a UUID for
          // playbook_id when calling update_behavior_target and the tool
          // returned playbook_not_found. Incognito worked because there was
          // no stale state to trip the truncation.
          //
          // Fix: push the caller FIRST (no-op if already present), THEN
          // push the playbook (different type, ADD on top). End state is
          // [caller, playbook] regardless of prior sessionStorage state.
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
          if (result.publishedPlaybookId) {
            pushEntity({
              type: "playbook",
              id: result.publishedPlaybookId,
              label: result.publishedPlaybookName || "Active Course",
              href: `${isInXArea ? '/x' : ''}/courses/${result.publishedPlaybookId}`,
            });
          }
        } else {
          setError(result.error || "Failed to load caller");
        }
      } else {
        // Caller fetch outright rejected — only path that surfaces an error
        // (others degrade silently per original behaviour).
        if ((callerRes.reason as { name?: string })?.name !== "AbortError") {
          setError((callerRes.reason as Error)?.message || "Failed to load caller");
        }
      }
      setLoading(false);

      // Supplementary data — each degrades independently per original behaviour
      if (domainsRes.status === "fulfilled") {
        const result = domainsRes.value;
        if (result.ok) setDomains(result.domains || []);
      } else if ((domainsRes.reason as { name?: string })?.name !== "AbortError") {
        console.warn("[CallerDetail] Failed to load domains:", domainsRes.reason);
      }

      if (promptsRes.status === "fulfilled") {
        const result = promptsRes.value;
        if (result.ok) setComposedPrompts(result.prompts || []);
      } else if ((promptsRes.reason as { name?: string })?.name !== "AbortError") {
        console.warn("[CallerDetail] Failed to load prompts:", promptsRes.reason);
      }

      if (enrollmentsRes.status === "fulfilled") {
        const result = enrollmentsRes.value;
        if (result.ok) {
          const active = (result.enrollments || []).filter((e: Enrollment) => e.status === "ACTIVE");
          setEnrollments(active);
          setEnrollmentCount(active.length);
          // Auto-select: 1 course → that course; 2+ → most recent by enrolledAt.
          // MUST match resolveActivePlaybookId() — keep these branches in sync.
          //
          // NOTE on divergence from the L9 chain contract (docs/CHAIN-CONTRACTS.md):
          // this page needs the FULL enrollment list (rendered as a course-filter
          // dropdown elsewhere on the page), not just the resolved playbookId — so
          // it can't reduce to a `/active-playbook` call without losing the list.
          // The auto-pick rule below MUST stay byte-identical to
          // `lib/caller/resolve-active-playbook.ts::resolveActivePlaybookId` —
          // any drift breaks the L9 invariant ("same caller behaves the same way
          // on either page"). This admin page is out of scope for the arch-checker
          // Check G (learner-facing only); the lint rule does not catch this site.
          if (active.length === 1) {
            setSelectedPlaybookId(active[0].playbookId);
          } else if (active.length > 1) {
            const sorted = [...active].sort((a: Enrollment, b: Enrollment) =>
              new Date(b.enrolledAt).getTime() - new Date(a.enrolledAt).getTime()
            );
            setSelectedPlaybookId(sorted[0].playbookId);
          }
        }
      } else if ((enrollmentsRes.reason as { name?: string })?.name !== "AbortError") {
        console.warn("[CallerDetail] Failed to load enrollments:", enrollmentsRes.reason);
      }

      if (paramConfigRes.status === "fulfilled") {
        const result = paramConfigRes.value;
        if (result.ok) {
          setParamConfig({
            grouped: result.grouped,
            params: result.params,
          });
        }
      } else if ((paramConfigRes.reason as { name?: string })?.name !== "AbortError") {
        console.error("Failed to load parameter display config:", paramConfigRes.reason);
      }
    });
  }, [callerId, pushEntity, isInXArea]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
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

  // #1177 — variant fan-out: include calls/prompts from sibling Playbooks
  // sharing the same Curriculum. Falls back to exact-match when sibling
  // metadata hasn't loaded yet (the /api/playbooks/[id] fetch is async).
  const callMatchSet = useMemo(() => {
    if (selectedPlaybookId === "all") return null;
    return new Set(
      variantSiblingIds.length > 0 ? variantSiblingIds : [selectedPlaybookId],
    );
  }, [selectedPlaybookId, variantSiblingIds]);

  const filteredCalls = useMemo(() => {
    if (!data?.calls || !callMatchSet) return data?.calls || [];
    return data.calls.filter((c) => c.playbookId && callMatchSet.has(c.playbookId));
  }, [data?.calls, callMatchSet]);

  const filteredPrompts = useMemo(() => {
    if (!callMatchSet) return composedPrompts;
    return composedPrompts.filter(
      (p) => !p.playbookId || callMatchSet.has(p.playbookId),
    );
  }, [composedPrompts, callMatchSet]);

  // #253-follow-up: load `modulesAuthored` from the active playbook's config
  // so the SimChat header shows the "Pick module" button when authored
  // modules exist for this course. Mirrors /x/sim/[callerId] wiring.
  useEffect(() => {
    if (!selectedPlaybookId || selectedPlaybookId === "all") {
      setModulesAuthored(false);
      setVariantSiblingIds([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/playbooks/${selectedPlaybookId}`)
      .then((r) => r.json())
      .then((pbData) => {
        if (cancelled || !pbData?.ok) return;
        const cfg = (pbData.playbook?.config as Record<string, unknown> | null) ?? {};
        setModulesAuthored(cfg.modulesAuthored === true);
        // #357: also surface the authored module list for the banner label.
        if (Array.isArray(cfg.modules)) {
          setAuthoredModules(cfg.modules as Array<{ id: string; label?: string }>);
        } else {
          setAuthoredModules([]);
        }
        // #1177 — variant fan-out: sibling Playbook IDs (parent + linked
        // variants sharing a Curriculum). Used to widen the Calls/Prompts
        // filter so a learner's history isn't hidden when a variant is
        // selected instead of the parent.
        if (Array.isArray(pbData.siblingPlaybookIds)) {
          setVariantSiblingIds(pbData.siblingPlaybookIds as string[]);
        } else {
          setVariantSiblingIds([selectedPlaybookId]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModulesAuthored(false);
          setAuthoredModules([]);
          setVariantSiblingIds([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlaybookId]);

  const handlePickModule = useCallback(() => {
    if (selectedPlaybookId === "all" || !selectedPlaybookId) return;
    const sp = new URLSearchParams();
    // #270: pass callerId so the picker (admin context) can include it on
    // GET /api/student/module-progress — without it the route returns 400
    // because requireStudentOrAdmin demands explicit caller selection for
    // non-STUDENT users.
    sp.set("callerId", callerId);
    // Strip requestedModuleId from the carry-over so the banner doesn't
    // double-fire when the learner returns from the picker.
    const carryParams = new URLSearchParams(searchParams.toString());
    carryParams.delete("requestedModuleId");
    sp.set(
      "returnTo",
      `/x/callers/${callerId}${carryParams.toString() ? `?${carryParams.toString()}` : ""}`,
    );
    router.push(`/x/student/${selectedPlaybookId}/modules?${sp.toString()}`);
  }, [callerId, router, searchParams, selectedPlaybookId]);

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

  // #688 — listen for chord-driven tab switches. Convention: chord engine
  // dispatches `hf:chord:tab:<id>`. Map id → SectionId via the registry.
  useEffect(() => {
    const tabIds = (pageHelp?.tabs ?? []).map((t) => t.id);
    const handlers: Array<{ name: string; fn: EventListener }> = [];
    for (const id of tabIds) {
      const name = `hf:chord:tab:${id}`;
      const fn: EventListener = () => setActiveSection(id as SectionId);
      window.addEventListener(name, fn);
      handlers.push({ name, fn });
    }
    return () => {
      for (const { name, fn } of handlers) window.removeEventListener(name, fn);
    };
  // setActiveSection is intentionally a stable reference via the closure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageHelp]);

  // Secondary tab nav — Option+Shift+ArrowLeft / Option+Shift+ArrowRight
  // cycle through the visible tabs. Bare Cmd+Arrow stays bound to browser
  // back/forward; H+letter (registry) jumps to a specific tab. Skips inside
  // text fields so the macOS "select word" shortcut keeps working.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!e.altKey || !e.shiftKey) return;
      if (e.metaKey || e.ctrlKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (sectionsRef.current.length === 0) return;
      e.preventDefault();
      const ids = sectionsRef.current.map((s) => s.id);
      const idx = ids.indexOf(activeSectionRef.current);
      const next = e.key === "ArrowRight"
        ? ids[(idx + 1 + ids.length) % ids.length]
        : ids[(idx - 1 + ids.length) % ids.length];
      setActiveSection(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCallerLabel = (caller: CallerProfile | undefined) => {
    if (!caller) return "Unknown";
    return caller.name || caller.email || caller.phone || caller.externalId || "Unknown";
  };

  // #972 follow-up — hooks BEFORE early returns to satisfy rules-of-hooks.
  // The original placement after the loading/error guards would skip the
  // useMemo calls on early-return code paths, violating the hook ordering
  // invariant. The useMemo body is now null-safe via the early `if (!data)`
  // check so it stays the same shape on every render.
  const allSections = useMemo<{ id: SectionId; label: React.ReactNode; icon: React.ReactNode; count?: number; special?: boolean; group: "history" | "caller" | "shared" | "action" }[]>(() => {
    if (!data) return [];
    return [
      { id: "overview-v2", label: <TabWithHelp tabId="overview-v2">Overview</TabWithHelp>, icon: <span aria-hidden>🧭</span>, group: "shared" },
      { id: "calls-prompts", label: <TabWithHelp tabId="calls-prompts">Calls</TabWithHelp>, icon: <Phone size={13} />, count: data.counts.calls, group: "history" },
      { id: "tune", label: <TabWithHelp tabId="tune">Tune</TabWithHelp>, icon: <SlidersHorizontal size={13} />, count: data.counts.prompts || undefined, group: "caller" },
      { id: "progress-v2", label: <TabWithHelp tabId="progress-v2">Progress</TabWithHelp>, icon: <Gauge size={13} />, count: (new Set(data.scores?.map((s: any) => s.parameterId)).size || 0) + (data.counts.callerTargets || 0) + (data.counts.measurements || 0), group: "shared" },
      { id: "uplift-v2", label: <TabWithHelp tabId="uplift-v2">Uplift</TabWithHelp>, icon: <TrendingUp size={13} />, group: "shared" },
      { id: "session-flow", label: <TabWithHelp tabId="session-flow">Session Flow</TabWithHelp>, icon: <SlidersHorizontal size={13} />, group: "shared" },
      { id: "how", label: <TabWithHelp tabId="how">Profile</TabWithHelp>, icon: <User size={13} />, count: (data.counts.memories || 0) + (data.counts.observations || 0), group: "caller" },
      { id: "ai-call", label: <TabWithHelp tabId="ai-call">Call</TabWithHelp>, icon: <PlayCircle size={13} />, special: true, group: "action" },
      // Retired (hidden) — kept here for URL-redirect fall-through and any
      // legacy callers that haven't migrated their bookmarks yet.
      { id: "overview", label: "Overview (v1)", icon: <span aria-hidden>🧭</span>, group: "shared" },
      { id: "what", label: "Progress (v1)", icon: <Gauge size={13} />, group: "shared" },
      { id: "uplift", label: "Uplift (v1)", icon: <TrendingUp size={13} />, group: "shared" },
      { id: "artifacts", label: <TabWithHelp tabId="artifacts">Artifacts</TabWithHelp>, icon: <BookMarked size={13} />, count: (data.counts.artifacts || 0) + (data.counts.actions || 0), group: "shared" },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.counts, data?.scores]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sections = useMemo(() => allSections.filter((s) => VISIBLE_TABS.has(s.id)), [allSections]);

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
  const processingTabs = new Set<SectionId>(["calls-prompts", "how", "what", "uplift", "uplift-v2", "progress-v2", "overview-v2", "artifacts"]);

  // Tab order requested 2026-05-29: Overview · Calls · Tune · Progress ·
  // Uplift · Session Flow · Profile · Call. v1 tabs and Artifacts are
  // hidden via VISIBLE_TABS (URLs to them redirect to the v2 equivalent).
  // BETA labels dropped — v2 is canonical now. `tabId` props on TabWithHelp
  // match the registry entry ids in `lib/help/page-help.ts` so the help
  // popover + chord nav resolve to the right tab.
  // (allSections + sections useMemo declared above the early returns for
  // rules-of-hooks compliance — see #972 follow-up comment.)
  sectionsRef.current = sections;

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
          {/* #641: Tune is a top-level tab now — the old slide-out toggle was removed. */}
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

          {/* Per-caller voice provider override (AnyVoice #1027). */}
          {showDomainSection && data.caller.id ? (
            <VoiceProviderOverride callerId={data.caller.id} />
          ) : null}

          {/* Per-caller voice spend summary (AnyVoice #1028). */}
          {showDomainSection && data.caller.id ? (
            <VoiceCostPanel callerId={data.caller.id} />
          ) : null}

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

      {activeSection === "overview-v2" && insights && (
        <OverviewV2Tab
          callerId={callerId}
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
        />
      )}

      {activeSection === "uplift" && (
        <>
          <UpliftTab
            callerId={callerId}
            insights={insights}
            scores={(data.scores ?? []) as never}
            callerTargets={(data.callerTargets ?? []) as never}
          />
        </>
      )}

      {activeSection === "uplift-v2" && (
        <UpliftV2Tab
          callerId={callerId}
          scores={(data.scores ?? []) as never}
          callerTargets={(data.callerTargets ?? []) as never}
          memorySummary={data.memorySummary ?? null}
        />
      )}

      {activeSection === "progress-v2" && (
        <ProgressV2Tab
          callerId={callerId}
          memorySummary={data.memorySummary ?? null}
        />
      )}

      {activeSection === "calls-prompts" && (
        <>
          {/* #831 — surface compose-input staleness above the calls list.
              Renders nothing when the cached prompt is fresh. */}
          <StalePromptPill callerId={callerId} />
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
        </>
      )}

      {/* #641 + #642: Tune tab — single-column row timeline with prompt rows
          interleaved with diff rows, followed by the tuner sliders. */}
      {activeSection === "tune" && (
        <div className="cdp-tune-tab">
          {/* #831 — surface compose-input staleness above the tune panel. */}
          <StalePromptPill callerId={callerId} />
          {composedPrompts.length === 0 ? (
            <div className="hf-empty-dashed">
              <div className="hf-empty-state-icon hf-mb-md">🎛️</div>
              <div className="hf-empty-state-title">No Prompts Yet</div>
              <div className="hf-text-sm hf-text-muted hf-mt-sm hf-empty-hint-centered">
                Run the pipeline on a call (Calls &amp; Prompts tab) to generate the first prompt. Once it exists you can tune it from here.
              </div>
            </div>
          ) : (
            <>
              <PromptTimelineRows
                prompts={composedPrompts}
                calls={(data.calls ?? []) as never}
                callScores={(data.scores ?? []) as never}
                loading={promptsLoading}
                onRefresh={fetchPrompts}
                callerId={callerId}
              />
              <div className="cdp-tune-tab-tuner">
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
                  // #911 — thread the friendly playbook name through so the
                  // pending-changes tray reads `Course <name>` rather than
                  // `Course <uuid-prefix>`. Resolve from enrollments where
                  // both the playbookId and a name are co-located; for the
                  // "all" selector we look up the published-playbook id in
                  // the same enrollments list.
                  playbookName={(() => {
                    const targetId =
                      selectedPlaybookId !== "all"
                        ? selectedPlaybookId
                        : (data.publishedPlaybookId ?? null);
                    if (!targetId) return null;
                    return enrollments.find((e) => e.playbookId === targetId)?.playbook.name ?? null;
                  })()}
                  onApplied={(changes) => {
                    setAppliedChanges(changes.map((c) => ({
                      label: c.label,
                      oldValue: c.oldValue,
                      newValue: c.newValue,
                    })));
                    fetchPrompts();
                  }}
                />
              </div>
            </>
          )}
        </div>
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
              { id: "topics", label: "Topics", icon: <BookOpen size={13} />, count: (data.memorySummary?.topicCount || 0) + (data.memorySummary?.factCount || 0) },
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
            <TopicsCoveredSection memorySummary={data.memorySummary} keyFactCount={data.memorySummary?.factCount ?? 0} />
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
          {/* #357: mirror the sim-view module-picker banners + state
              breadcrumb so the admin caller-detail surface gives the same
              signals as /x/sim/[id]. */}
          <SimStateBreadcrumb
            pastCallCount={(data?.calls ?? []).filter((c: { transcript?: string | null }) => c.transcript?.trim()).length}
            activeCall={isCallActive}
            requestedModuleId={requestedModuleId ?? null}
            modules={authoredModules}
            onPickModule={
              modulesAuthored && selectedPlaybookId && selectedPlaybookId !== "all"
                ? handlePickModule
                : undefined
            }
          />
          {requestedModuleId ? (
            <ModulePickerSelectionBanner
              moduleId={requestedModuleId}
              modules={authoredModules}
            />
          ) : modulesAuthored && selectedPlaybookId && selectedPlaybookId !== "all" ? (
            <ModulePickerInviteBanner
              moduleCount={authoredModules.length}
              onPick={handlePickModule}
            />
          ) : null}
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
            onCallStateChange={setIsCallActive}
            requestedModuleId={requestedModuleId}
          />
        </div>
      )}
      </div>{/* cdp-content */}
      </div>{/* cdp-body */}
    </div>
  );
}
