"use client";

import "./quick-launch.css";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTerminology } from "@/contexts/TerminologyContext";
import { AgentTuner } from "@/components/shared/AgentTuner";
import type { AgentTunerOutput, AgentTunerPill } from "@/lib/agent-tuner/types";
import { AgentTuningPanel, type AgentTuningPanelOutput } from "@/components/shared/AgentTuningPanel";
import type { MatrixPosition } from "@/lib/domain/agent-tuning";
import { WizardSummary } from "@/components/shared/WizardSummary";
import { FancySelect } from "@/components/shared/FancySelect";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import {
  Building2, BookOpen, User, PlayCircle, Target,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { OnboardingTabContent } from "@/app/x/domains/components/OnboardingTab";
import type { DomainDetail } from "@/app/x/domains/components/types";

// ── Types ──────────────────────────────────────────

type Persona = {
  slug: string;
  name: string;
  description: string | null;
};

type Phase = "form" | "committing" | "result";

type StepStatus = "pending" | "active" | "done" | "error" | "skipped";

type TimelineStep = {
  id: string;
  label: string;
  status: StepStatus;
  message?: string;
};

type LaunchResult = {
  domainId: string;
  domainSlug: string;
  domainName: string;
  subjectId?: string;
  callerId: string;
  callerName: string;
  assertionCount: number;
  moduleCount: number;
  goalCount: number;
  warnings: string[];
  identitySpecId?: string;
  playbookId?: string;
};

type CourseCheck = {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "recommended" | "optional";
  passed: boolean;
  detail: string;
  fixAction?: { label: string; href: string };
};

type ResumeTask = {
  id: string;
  context: any;
  startedAt: string;
};

// ── Step Marker ────────────────────────────────────

function StepMarker({ number, label, completed }: { number: number; label: string; completed?: boolean }) {
  return (
    <div className="ql-step-marker">
      <div className={`ql-step-circle ${completed ? "ql-step-circle-done" : "ql-step-circle-pending"}`}>
        {completed ? "\u2713" : number}
      </div>
      <div className={`ql-step-label ${completed ? "ql-step-label-done" : "ql-step-label-pending"}`}>
        {label}
      </div>
    </div>
  );
}

// ── Form Card ─────────────────────────────────────

function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="ql-form-card">
      {children}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────

export default function QuickLaunchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { terms, lower } = useTerminology();

  // ── Phase state machine ────────────────────────────
  const [phase, setPhase] = useState<Phase>("form");
  const [taskId, setTaskId] = useState<string | null>(null);

  // Warn on browser refresh/close when in-progress
  useUnsavedGuard(phase === "committing");

  // Form state
  const [brief, setBrief] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [nameLoading, setNameLoading] = useState(false);
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);
  const [suggestedPersona, setSuggestedPersona] = useState<string | null>(null);
  const [suggestedGoals, setSuggestedGoals] = useState<string[] | null>(null);
  const [persona, setPersona] = useState("");
  const [goalInput, setGoalInput] = useState("");
  const [goals, setGoals] = useState<string[]>([]);
  const [tunerPills, setTunerPills] = useState<AgentTunerPill[]>([]);
  const [behaviorTargets, setBehaviorTargets] = useState<Record<string, number>>({});
  const [matrixTargets, setMatrixTargets] = useState<Record<string, number>>({});
  const [matrixTraits, setMatrixTraits] = useState<string[]>([]);
  const [matrixPositions, setMatrixPositions] = useState<Record<string, MatrixPosition>>({});
  const [qualificationRef, setQualificationRef] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Domain picker — use existing domain or create new
  const [domains, setDomains] = useState<{ id: string; slug: string; name: string }[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<string>("");

  // Institution picker
  const { data: sessionData } = useSession();
  const [institutions, setInstitutions] = useState<{ id: string; name: string }[]>([]);
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string>("");
  const [newInstitutionName, setNewInstitutionName] = useState("");
  const [institutionsLoading, setInstitutionsLoading] = useState(true);

  // Personas from API
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personasLoading, setPersonasLoading] = useState(true);

  // Commit state
  const [commitTimeline, setCommitTimeline] = useState<TimelineStep[]>([]);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commitAbortRef = useRef<AbortController | null>(null);

  // Resume
  const [resumeTask, setResumeTask] = useState<ResumeTask | null>(null);

  // ── Load personas + domains ────────────────────────

  useEffect(() => {
    fetch("/api/onboarding/personas")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.personas?.length > 0) {
          setPersonas(data.personas);
          setPersona(data.defaultPersona || data.personas[0].slug);
        }
      })
      .catch((e) => {
        console.warn("[QuickLaunch] Failed to load personas, using fallback:", e);
        setPersonas([{ slug: "tutor", name: "Tutor", description: "Patient teaching expert" }]);
        setPersona("tutor");
      })
      .finally(() => setPersonasLoading(false));

    // Load domains for domain picker
    fetch("/api/domains?activeOnly=true")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.domains) {
          setDomains(data.domains.map((d: any) => ({
            id: d.id,
            slug: d.slug,
            name: d.name,
          })));
        }
      })
      .catch(() => {});

    // Load institutions for institution picker
    fetch("/api/user/institutions")
      .then((r) => r.json())
      .then((data) => {
        if (data.institutions) {
          setInstitutions(data.institutions.map((i: any) => ({
            id: i.id,
            name: i.name,
          })));
        }
      })
      .catch(() => {})
      .finally(() => setInstitutionsLoading(false));
  }, []);

  // ── Auto-select user's institution from session ──
  useEffect(() => {
    const userInstId = (sessionData?.user as any)?.institutionId;
    if (userInstId && !selectedInstitutionId) {
      setSelectedInstitutionId(userInstId);
    }
  }, [sessionData, selectedInstitutionId]);

  // ── Check for resumable task ──────────────────────

  useEffect(() => {
    fetch("/api/tasks?status=in_progress,completed&taskType=quick_launch&limit=1&sort=recent")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.tasks) {
          const inProgress = data.tasks.find((t: any) => t.taskType === "quick_launch" && t.status === "in_progress");
          const resultPhase = data.tasks.find(
            (t: any) => t.taskType === "quick_launch" && t.status === "completed" && t.context?.phase === "result" && t.context?.result
          );

          // For in_progress, show resume banner
          const qlTask = inProgress;
          const claimedId = localStorage.getItem("ql-active-task");
          if (qlTask && qlTask.context && qlTask.id !== claimedId) {
            setResumeTask({
              id: qlTask.id,
              context: qlTask.context,
              startedAt: qlTask.startedAt,
            });
          }
        }
      })
      .catch((e) => console.warn("[QuickLaunch] Failed to check for resumable tasks:", e));
  }, []);

  // ── Resume handler ────────────────────────────────

  const handleResume = useCallback(() => {
    if (!resumeTask?.context) return;
    const ctx = resumeTask.context;

    try { localStorage.setItem("ql-active-task", resumeTask.id); } catch {}
    setTaskId(resumeTask.id);

    // Restore input state
    if (ctx.input) {
      setSubjectName(ctx.input.subjectName || "");
      setBrief(ctx.input.brief || "");
      if (ctx.input.subjectName) setNameManuallyEdited(true);
      setPersona(ctx.input.persona || "");
      setGoals(ctx.input.learningGoals || []);
      setQualificationRef(ctx.input.qualificationRef || "");
    }

    // If result phase, restore summary directly
    if (ctx.phase === "result" && ctx.result) {
      setResult(ctx.result as LaunchResult);
      setPhase("result");
      setResumeTask(null);
      return;
    }

    setPhase("form");
    setResumeTask(null);
  }, [resumeTask]);

  // ── AI field suggestions (fires on blur of brief textarea) ──

  const suggestAbort = useRef<AbortController | null>(null);

  const suggestFields = useCallback(
    async (text: string) => {
      if (text.trim().length < 20) return;

      suggestAbort.current?.abort();
      const controller = new AbortController();
      suggestAbort.current = controller;

      const timeout = setTimeout(() => controller.abort(), 10_000);

      setNameLoading(true);
      try {
        const res = await fetch("/api/domains/suggest-name", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brief: text.trim(),
            personaSlugs: personas.map((p) => p.slug),
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (!data.ok) return;

        if (data.name && !nameManuallyEdited) {
          if (!subjectName.trim()) {
            setSubjectName(data.name);
          } else {
            setSuggestedName(data.name);
          }
        }

        if (data.persona && personas.some((p) => p.slug === data.persona)) {
          if (!persona) {
            setPersona(data.persona);
          } else if (data.persona !== persona) {
            setSuggestedPersona(data.persona);
          }
        }

        if (data.goals?.length) {
          if (goals.length === 0) {
            setGoals(data.goals);
          } else {
            const newGoals = data.goals.filter(
              (g: string) => !goals.some((existing) => existing.toLowerCase() === g.toLowerCase())
            );
            if (newGoals.length > 0) {
              setSuggestedGoals(newGoals);
            }
          }
        }
      } catch {
        // Silently fail — user can fill fields manually
      } finally {
        clearTimeout(timeout);
        setNameLoading(false);
      }
    },
    [nameManuallyEdited, subjectName, persona, goals, personas]
  );

  // ── Goal chips ─────────────────────────────────────

  const addGoal = useCallback(() => {
    const trimmed = goalInput.trim();
    if (trimmed && !goals.includes(trimmed)) {
      setGoals((prev) => [...prev, trimmed]);
      setGoalInput("");
    }
  }, [goalInput, goals]);

  const removeGoal = (index: number) => {
    setGoals((prev) => prev.filter((_, i) => i !== index));
  };

  const handleTunerChange = useCallback(({ pills, parameterMap }: AgentTunerOutput) => {
    setTunerPills(pills);
    setBehaviorTargets(parameterMap);
  }, []);

  const handleMatrixChange = useCallback(({ parameterMap, traits, matrixPositions: mp }: AgentTuningPanelOutput) => {
    setMatrixTargets(parameterMap);
    setMatrixTraits(traits);
    setMatrixPositions(mp);
  }, []);

  // ── Launch (Analyze → Commit in sequence) ─────────

  const canLaunch = !!subjectName.trim() && !!persona && phase === "form";

  // Track the domainId from analyze across the two-step flow
  const analyzeResultRef = useRef<{ domainId: string; subjectId: string; identityConfig: any } | null>(null);

  const handleLaunch = async () => {
    if (!canLaunch) return;

    setPhase("committing");
    setCommitTimeline([]);
    setError(null);

    // Create abort controller
    commitAbortRef.current?.abort();
    const controller = new AbortController();
    commitAbortRef.current = controller;

    try {
      // ── Step 1: Analyze (create domain + generate identity) ──
      const institutionId = selectedInstitutionId === "__new__" && newInstitutionName.trim()
        ? `create:${newInstitutionName.trim()}`
        : selectedInstitutionId || undefined;

      const allTraits = [...new Set([...matrixTraits, ...tunerPills.map((p) => p.label)])];

      const analyzeRes = await fetch("/api/domains/quick-launch/analyze", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectName: subjectName.trim(),
          brief: brief.trim() || undefined,
          persona,
          learningGoals: goals,
          toneTraits: allTraits.length > 0 ? allTraits : undefined,
          qualificationRef: qualificationRef.trim() || undefined,
          domainId: selectedDomainId || undefined,
          kind: "COMMUNITY",
          institutionId,
        }),
      });

      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok || !analyzeData.ok) {
        throw new Error(analyzeData.error || `Server error: ${analyzeRes.status}`);
      }

      setTaskId(analyzeData.taskId || null);
      analyzeResultRef.current = {
        domainId: analyzeData.domainId,
        subjectId: analyzeData.subjectId,
        identityConfig: analyzeData.identityConfig,
      };

      // ── Step 2: Commit (scaffold + caller + prompt via SSE) ──
      const commitRes = await fetch("/api/domains/quick-launch/commit", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: analyzeData.taskId,
          domainId: analyzeData.domainId,
          preview: {
            domainId: analyzeData.domainId,
            domainSlug: analyzeData.domainSlug,
            domainName: analyzeData.domainName,
            subjectId: analyzeData.subjectId,
            sourceId: "",
            assertionCount: 0,
            assertionSummary: {},
            identityConfig: analyzeData.identityConfig,
            warnings: [],
          },
          overrides: {},
          input: {
            subjectName: subjectName.trim(),
            brief: brief.trim() || undefined,
            persona,
            learningGoals: goals,
            qualificationRef: qualificationRef.trim() || undefined,
            kind: "COMMUNITY",
            behaviorTargets: { ...matrixTargets, ...behaviorTargets },
            matrixPositions: Object.keys(matrixPositions).length > 0 ? matrixPositions : undefined,
          },
        }),
      });

      if (!commitRes.ok) {
        const body = await commitRes.json().catch(() => null);
        throw new Error(body?.error || `Server error: ${commitRes.status}`);
      }

      const reader = commitRes.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            handleCommitEvent(JSON.parse(dataLine.slice(6)));
          } catch {
            // Ignore
          }
        }
      }

      if (buffer.trim()) {
        const dataLine = buffer.split("\n").find((l) => l.startsWith("data: "));
        if (dataLine) {
          try {
            handleCommitEvent(JSON.parse(dataLine.slice(6)));
          } catch {
            // Ignore
          }
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setPhase("form");
        return;
      }
      const msg = err.message || "Creation failed";
      const isNetworkError = msg === "Load failed" || msg === "Failed to fetch" || msg === "NetworkError when attempting to fetch resource.";
      setError(
        isNetworkError
          ? "Connection lost — the server may have restarted. Check your tunnel and try again."
          : msg
      );
      setPhase("form");
    }
  };

  const handleCancelCommit = () => {
    commitAbortRef.current?.abort();
    setPhase("form");
  };

  const handleCommitEvent = (event: any) => {
    const { phase: evtPhase, message, detail } = event;

    if (evtPhase === "complete" && detail) {
      setResult(detail as LaunchResult);
      setPhase("result");
      try { localStorage.removeItem("ql-active-task"); } catch {}
      return;
    }

    if (evtPhase === "error") {
      setError(message);
      setPhase("form");
      return;
    }

    if (evtPhase === "init") return;

    setCommitTimeline((prev) => {
      const existing = prev.find((s) => s.id === evtPhase);
      if (existing) {
        return prev.map((s) => {
          if (s.id === evtPhase) {
            const isDone = message.includes("\u2713");
            const isSkipped = message.includes("skipped");
            return {
              ...s,
              status: isDone ? "done" : isSkipped ? "skipped" : "active",
              message,
            };
          }
          if (s.status === "active" && !message.includes("\u2713")) {
            return { ...s, status: "done" };
          }
          return s;
        });
      }
      const updated = prev.map((s) =>
        s.status === "active" ? { ...s, status: "done" as StepStatus } : s
      );
      return [
        ...updated,
        { id: evtPhase, label: message, status: "active" as StepStatus, message },
      ];
    });
  };

  // ── Result screen state ──

  const [editDomainName, setEditDomainName] = useState("");
  const [editWelcome, setEditWelcome] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingWelcome, setSavingWelcome] = useState(false);
  const [classroom, setClassroom] = useState<{ cohortId: string; joinToken: string; joinUrl: string } | null>(null);
  const [creatingClassroom, setCreatingClassroom] = useState(false);
  const { copied, copy: copyText } = useCopyToClipboard();
  const [courseChecks, setCourseChecks] = useState<CourseCheck[]>([]);
  const [courseReady, setCourseReady] = useState(false);
  const [checksLoading, setChecksLoading] = useState(false);

  // Accordion state (result phase)
  const [tunePersonaExpanded, setTunePersonaExpanded] = useState(false);
  const [onboardingExpanded, setOnboardingExpanded] = useState(false);
  const [domainDetail, setDomainDetail] = useState<DomainDetail | null>(null);
  const [domainDetailLoading, setDomainDetailLoading] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);

  // Fetch course readiness checks when result screen appears
  const fetchCourseReadiness = useCallback(async () => {
    if (!result) return;
    setChecksLoading(true);
    try {
      const params = new URLSearchParams({ callerId: result.callerId });
      if (result.subjectId) params.set("subjectId", result.subjectId);
      const res = await fetch(`/api/domains/${result.domainId}/course-readiness?${params}`);
      const data = await res.json();
      if (data.ok) {
        setCourseChecks(data.checks || []);
        setCourseReady(data.ready ?? false);
      }
    } catch (e) {
      console.warn("[QuickLaunch] Course readiness fetch failed:", e);
    } finally {
      setChecksLoading(false);
    }
  }, [result]);

  // Fetch full domain detail for onboarding accordion
  const fetchDomainDetail = useCallback(async () => {
    if (!result) return;
    setDomainDetailLoading(true);
    try {
      const res = await fetch(`/api/domains/${result.domainId}`);
      const data = await res.json();
      if (data.ok && data.domain) {
        setDomainDetail(data.domain as DomainDetail);
      }
    } catch (e) {
      console.warn("[QuickLaunch] Failed to fetch domain detail:", e);
    } finally {
      setDomainDetailLoading(false);
    }
  }, [result]);

  const handleToggleOnboarding = useCallback(() => {
    const willExpand = !onboardingExpanded;
    setOnboardingExpanded(willExpand);
    if (willExpand && !domainDetail && !domainDetailLoading) {
      fetchDomainDetail();
    }
  }, [onboardingExpanded, domainDetail, domainDetailLoading, fetchDomainDetail]);

  const handleToggleTunePersona = useCallback(() => {
    const willExpand = !tunePersonaExpanded;
    setTunePersonaExpanded(willExpand);
    if (willExpand && !domainDetail && !domainDetailLoading) {
      fetchDomainDetail();
    }
  }, [tunePersonaExpanded, domainDetail, domainDetailLoading, fetchDomainDetail]);

  // Save persona tuning changes to domain
  const handlePersonaTuningChange = useCallback(async (output: AgentTuningPanelOutput) => {
    if (!result) return;
    setSavingPersona(true);
    try {
      const targets: Record<string, any> = {};
      for (const [paramId, value] of Object.entries(output.parameterMap)) {
        targets[paramId] = { value, confidence: 0.5 };
      }
      targets._matrixPositions = output.matrixPositions;
      targets._traits = output.traits;
      await fetch(`/api/domains/${result.domainId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingDefaultTargets: targets }),
      });
    } catch (e) {
      console.warn("[Community] Failed to save persona tuning:", e);
    } finally {
      setSavingPersona(false);
    }
  }, [result]);

  // Sync inline welcome when domainDetail refreshes
  useEffect(() => {
    if (domainDetail?.onboardingWelcome !== undefined) {
      setEditWelcome(domainDetail.onboardingWelcome || "");
    }
  }, [domainDetail?.onboardingWelcome]);

  useEffect(() => {
    if (phase === "result" && result) {
      setEditDomainName(result.domainName);
      fetchCourseReadiness();
      fetch(`/api/domains/${result.domainId}/onboarding`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setEditWelcome(data.domain?.onboardingWelcome || "");
          }
        })
        .catch((e) => console.warn("[QuickLaunch] Failed to load domain welcome:", e));

      // Auto-expand onboarding — it's the main feature for community
      setOnboardingExpanded(true);
      fetchDomainDetail();
    }
  }, [phase, result, fetchCourseReadiness, fetchDomainDetail]);

  // Poll readiness every 10s while on result page
  useEffect(() => {
    if (phase !== "result" || !result) return;
    const interval = setInterval(fetchCourseReadiness, 10_000);
    return () => clearInterval(interval);
  }, [phase, result, fetchCourseReadiness]);

  const handleSaveDomainName = async (name: string) => {
    if (!result || name === result.domainName) return;
    setSavingName(true);
    try {
      await fetch(`/api/domains/${result.domainId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch {
      // silent — the edit is still reflected locally
    }
    setSavingName(false);
  };

  const handleSaveWelcome = async (welcome: string) => {
    if (!result) return;
    setSavingWelcome(true);
    try {
      await fetch(`/api/domains/${result.domainId}/onboarding`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingWelcome: welcome }),
      });
    } catch {
      // silent
    }
    setSavingWelcome(false);
  };

  const handleCreateClassroom = async () => {
    if (!result) return;
    setCreatingClassroom(true);
    try {
      const res = await fetch(`/api/domains/${result.domainId}/classroom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${editDomainName} Classroom` }),
      });
      const data = await res.json();
      if (data.ok) {
        setClassroom({
          cohortId: data.cohort.id,
          joinToken: data.joinToken,
          joinUrl: `${window.location.origin}/join/${data.joinToken}`,
        });
      }
    } catch {
      // silent
    }
    setCreatingClassroom(false);
  };

  const handleCopyJoinLink = () => {
    if (!classroom) return;
    copyText(classroom.joinUrl);
  };

  // ── Reset all ─────────────────────────────────────

  const handleReset = () => {
    if (taskId) {
      fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds: [taskId], action: "archive" }),
      }).catch(() => {});
    }
    setPhase("form");
    setResult(null);
    try { localStorage.removeItem("ql-active-task"); } catch {}
    setCommitTimeline([]);
    setTaskId(null);
    setError(null);
    setBrief("");
    setSubjectName("");
    setSuggestedName(null);
    setSuggestedPersona(null);
    setSuggestedGoals(null);
    setNameManuallyEdited(false);
    setPersona("");
    setGoals([]);
    setGoalInput("");
    setQualificationRef("");
    setShowAdvanced(false);
    setSelectedDomainId("");
    setTunerPills([]);
    setBehaviorTargets({});
    setMatrixTargets({});
    setMatrixTraits([]);
    setMatrixPositions({});
    setClassroom(null);
    setEditDomainName("");
    setEditWelcome("");
    setNewInstitutionName("");
    setCourseChecks([]);
    setCourseReady(false);
    setTunePersonaExpanded(false);
    setOnboardingExpanded(false);
    setDomainDetail(null);
    setDomainDetailLoading(false);
    setSavingPersona(false);
    analyzeResultRef.current = null;
  };

  // ── Form completion ───────────────────────────────

  const formSteps = [!!subjectName.trim(), !!persona];
  const completedSteps = formSteps.filter(Boolean).length;
  const totalRequired = formSteps.length;

  const selectedPersona = personas.find((p) => p.slug === persona);

  // ── Render ─────────────────────────────────────────

  return (
    <div className="ql-page" style={{ maxWidth: 720 }}>
      {/* ── Header ── */}
      <div className="ql-hero">
        <div className="ql-hero-icon">
          <span>&#x1F465;</span>
        </div>
        <h1 className="ql-hero-title">
          Create Community
        </h1>
        <p className="ql-hero-subtitle">
          {phase === "form" && "Create a community for individuals to have meaningful conversations with an AI companion."}
          {phase === "committing" && "Creating your community..."}
          {phase === "result" && "Your community is ready!"}
        </p>
      </div>

      {/* ── Resume Banner ── */}
      {resumeTask && phase === "form" && (
        <div className="ql-resume-banner">
          <div>
            <div className="ql-resume-title">
              Resume previous launch?
            </div>
            <div className="ql-resume-detail">
              You have an in-progress community setup
              {resumeTask.context?.input?.subjectName &&
                ` for "${resumeTask.context.input.subjectName}"`}
              {" "}started {new Date(resumeTask.startedAt).toLocaleString()}
            </div>
          </div>
          <div className="hf-flex hf-gap-sm">
            <button
              onClick={handleResume}
              className="hf-btn hf-btn-primary"
            >
              Resume
            </button>
            <button
              onClick={() => {
                if (resumeTask?.id) {
                  fetch(`/api/tasks?taskId=${resumeTask.id}`, { method: "DELETE" }).catch((e) => console.warn("[QuickLaunch] Failed to delete old task:", e));
                }
                setResumeTask(null);
              }}
              className="hf-btn hf-btn-secondary"
            >
              Start Fresh
            </button>
          </div>
        </div>
      )}

      {/* ── Error Banner ── */}
      {error && (
        <div className="ql-error-banner">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ql-error-dismiss"
            title="Dismiss"
          >
            &times;
          </button>
        </div>
      )}

      {/* ── Phase: Committing (progress timeline) ── */}
      {phase === "committing" && (
        <div className="ql-commit-panel">
          <div className="ql-commit-title">
            Creating your community...
          </div>
          {commitTimeline.map((step, i) => (
            <div
              key={step.id}
              className={`ql-timeline-row ${i < commitTimeline.length - 1 ? "ql-timeline-row-border" : ""}`}
            >
              <div className={`ql-timeline-circle ql-timeline-circle-${step.status}`}>
                {step.status === "done" && "\u2713"}
                {step.status === "active" && (
                  <span className="ql-timeline-spinner-inline" />
                )}
                {step.status === "error" && "\u2717"}
                {step.status === "skipped" && "\u2014"}
                {step.status === "pending" && (i + 1)}
              </div>
              <div className={`ql-timeline-label ${
                step.status === "active" ? "ql-timeline-label-active" :
                step.status === "done" ? "ql-timeline-label-done" :
                "ql-timeline-label-muted"
              }`}>
                {step.message || step.label}
              </div>
            </div>
          ))}

          <button onClick={handleCancelCommit} className="ql-cancel-btn">
            Cancel
          </button>
        </div>
      )}

      {/* ── Phase: Result ── */}
      {phase === "result" && result && (
        <div className="hf-flex-col" style={{ gap: 20 }}>
          {/* ── Summary ── */}
          <WizardSummary
            title="Your Community is Ready!"
            subtitle={result.goalCount > 0 ? `${result.goalCount} goals` : undefined}
            intent={{
              items: [
                { icon: <BookOpen className="w-4 h-4" />, label: "Subject", value: subjectName || "—" },
                ...(selectedPersona ? [{ icon: <User className="w-4 h-4" />, label: "Persona", value: selectedPersona.name }] : []),
                ...(goals.length > 0 ? [{ icon: <Target className="w-4 h-4" />, label: "Goals", value: `${goals.length} learning goal${goals.length !== 1 ? "s" : ""}` }] : []),
              ],
            }}
            created={{
              entities: [
                {
                  icon: <Building2 className="w-5 h-5" />,
                  label: terms.domain,
                  name: result.domainName,
                  href: `/x/domains?id=${result.domainId}`,
                },
                {
                  icon: <User className="w-5 h-5" />,
                  label: "Test Caller",
                  name: result.callerName,
                  href: `/x/callers/${result.callerId}`,
                },
              ],
            }}
            stats={result.goalCount > 0 ? [{ label: "Goals", value: result.goalCount }] : []}
            tuning={matrixTraits.length > 0 || tunerPills.length > 0 ? {
              traits: [...new Set([...matrixTraits, ...tunerPills.map(p => p.label)])],
              paramCount: Object.keys(behaviorTargets).length,
            } : undefined}
            primaryAction={{
              label: "Try It",
              icon: <PlayCircle className="w-5 h-5" />,
              href: `/x/sim/${result.callerId}`,
            }}
            secondaryActions={[
              { label: "View Community", href: `/x/domains?id=${result.domainId}` },
              { label: "Launch Another", onClick: handleReset },
            ]}
          >
            {/* ── Editable community name ── */}
            <div className="wiz-section">
              <div className="wiz-section-label">
                Community Name {savingName && <span className="ql-saving-indicator">&mdash; saving...</span>}
              </div>
              <input
                type="text"
                value={editDomainName}
                onChange={(e) => setEditDomainName(e.target.value)}
                onBlur={() => handleSaveDomainName(editDomainName)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="hf-input"
                style={{ width: "100%", fontSize: 16, fontWeight: 600 }}
              />
            </div>

            {/* ── Course Readiness Checklist ── */}
            {courseChecks.length > 0 && (
              <div className="wiz-section">
                <div className="wiz-section-label">Review Steps</div>
                <div className="hf-flex-col" style={{ gap: 6 }}>
                  {courseChecks.map((check) => (
                    <div
                      key={check.id}
                      className={`ql-readiness-row ${check.passed ? "ql-readiness-row-pass" : "ql-readiness-row-pending"}`}
                      style={{ cursor: check.fixAction?.href ? "pointer" : "default" }}
                      onClick={() => {
                        if (check.fixAction?.href) router.push(check.fixAction.href);
                      }}
                    >
                      <div className={`ql-readiness-circle ${check.passed ? "ql-readiness-circle-pass" : check.severity === "critical" ? "ql-readiness-circle-critical" : "ql-readiness-circle-default"}`}>
                        {check.passed ? "\u2713" : check.severity === "critical" ? "!" : "\u2022"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="ql-readiness-name">
                          {check.name}
                          {check.severity === "critical" && !check.passed && (
                            <span className="ql-readiness-required">REQUIRED</span>
                          )}
                        </div>
                        <div className="ql-readiness-detail">{check.detail}</div>
                      </div>
                      {check.fixAction?.href && (
                        <div className="ql-readiness-fix">
                          {check.fixAction.label} &rarr;
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="hf-banner hf-banner-warning">
                {result.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}
          </WizardSummary>

          {/* ── Onboarding Configuration (FIRST — the main feature) ── */}
          <div className="ql-result-card">
            {/* Always-visible: Welcome message quick edit */}
            <div className="ql-result-section-label">
              Onboarding Welcome {savingWelcome && <span className="ql-saving-indicator">&mdash; saving...</span>}
            </div>
            <div className="ql-result-desc">
              This message is shown to learners when they join.
            </div>
            <textarea
              value={editWelcome}
              onChange={(e) => setEditWelcome(e.target.value)}
              onBlur={() => handleSaveWelcome(editWelcome)}
              placeholder="e.g. Welcome! Let's get started with your learning journey."
              rows={2}
              className="ql-result-textarea"
            />

            {/* Accordion: Full onboarding flow planner */}
            <button
              onClick={handleToggleOnboarding}
              className="ql-accordion-toggle"
            >
              {onboardingExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>Customise Onboarding Flow</span>
              {domainDetailLoading && !domainDetail && (
                <div className="hf-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              )}
            </button>

            {onboardingExpanded && (
              <div className="ql-accordion-content">
                {domainDetailLoading && !domainDetail ? (
                  <div className="hf-flex hf-gap-sm" style={{ justifyContent: "center", padding: 24 }}>
                    <div className="hf-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                    <span className="hf-text-sm hf-text-muted">Loading onboarding configuration...</span>
                  </div>
                ) : domainDetail ? (
                  <OnboardingTabContent
                    domain={domainDetail}
                    onDomainRefresh={fetchDomainDetail}
                  />
                ) : null}
              </div>
            )}
          </div>

          {/* ── Tune Persona (Boston Matrix) ── */}
          <div className="ql-result-card">
            <button
              onClick={handleToggleTunePersona}
              className="ql-accordion-toggle"
              style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}
            >
              {tunePersonaExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span>Tune Persona</span>
              {savingPersona && (
                <span className="ql-saving-indicator">&mdash; saving...</span>
              )}
            </button>
            <div className="ql-accordion-hint">
              Drag the dots to adjust your companion&apos;s voice and personality.
            </div>
            {tunePersonaExpanded && (
              <div className="ql-accordion-content">
                {domainDetailLoading && !domainDetail ? (
                  <div className="hf-flex hf-gap-sm" style={{ justifyContent: "center", padding: 24 }}>
                    <div className="hf-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                    <span className="hf-text-sm hf-text-muted">Loading persona settings...</span>
                  </div>
                ) : (
                  <AgentTuningPanel
                    initialPositions={
                      (domainDetail?.onboardingDefaultTargets as any)?._matrixPositions
                      || (Object.keys(matrixPositions).length > 0 ? matrixPositions : undefined)
                    }
                    existingParams={
                      domainDetail?.onboardingDefaultTargets
                        ? Object.fromEntries(
                            Object.entries(domainDetail.onboardingDefaultTargets as Record<string, any>)
                              .filter(([k]) => !k.startsWith("_"))
                              .map(([k, v]) => [k, typeof v === "object" && v !== null ? (v as any).value : v])
                          )
                        : undefined
                    }
                    onChange={handlePersonaTuningChange}
                    compact
                  />
                )}
              </div>
            )}
          </div>

          {/* ── Test Call ── */}
          <div className="ql-result-card">
            <div className="ql-result-title">
              Test Call
            </div>
            <div className="ql-result-desc">
              Try a conversation with your AI companion to see how it responds.
            </div>
            <button
              onClick={() => router.push(`/x/sim/${result.callerId}`)}
              className="ql-classroom-btn ql-classroom-btn-active"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <PlayCircle className="w-5 h-5" />
              Start Test Call
            </button>
          </div>

          {/* ── Bottom Actions ── */}
          <div className="hf-flex" style={{ justifyContent: "center", gap: 12, paddingTop: 8, paddingBottom: 24 }}>
            <button
              onClick={handleReset}
              className="hf-btn hf-btn-secondary"
            >
              Launch Another
            </button>
            <button
              onClick={() => router.push("/x/communities")}
              className="hf-btn hf-btn-secondary"
            >
              View All Communities
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: Form ── */}
      {phase === "form" && (
        <>
          {/* Step 1: Describe what you're building */}
          <FormCard>
            <StepMarker number={1} label="Describe your community" completed={!!subjectName.trim()} />

            {/* Domain picker */}
            {domains.length > 0 && (
              <div className="hf-mb-md">
                <label className="hf-label">
                  {terms.domain}
                </label>
                <select
                  value={selectedDomainId}
                  onChange={(e) => setSelectedDomainId(e.target.value)}
                  className="ql-select"
                >
                  <option value="">{`Create new ${lower("domain")}`}</option>
                  {domains.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {selectedDomainId && (
                  <div className="hf-text-xs hf-text-muted hf-mt-xs">
                    {`A new ${lower("playbook")} (class) will be created within this ${lower("domain")}.`}
                  </div>
                )}
              </div>
            )}

            <div className="ql-form-hint">
              Tell us what you&apos;re creating &mdash; a tutor, coach, support agent, or anything else.
            </div>
            <textarea
              id="brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g. An AI tutor for 11+ Creative Comprehension, a sales coaching agent, or a customer support assistant"
              rows={3}
              className="ql-input-hero ql-input-hero-brief"
              onBlur={(e) => {
                suggestFields(e.target.value);
              }}
            />

            {/* Community name — AI-suggested or manually entered */}
            <div className="hf-mt-md">
              <div className="hf-flex hf-gap-sm hf-mb-sm">
                <label htmlFor="subject" className="ql-name-label">
                  Community name
                </label>
                {nameLoading && (
                  <span className="ql-name-suggesting">
                    <span className="ql-spinner-xs" />
                    Suggesting...
                  </span>
                )}
                {!nameLoading && subjectName && !nameManuallyEdited && !suggestedName && (
                  <span className="ql-ai-badge">
                    AI suggested
                  </span>
                )}
              </div>
              <input
                id="subject"
                type="text"
                value={subjectName}
                onChange={(e) => {
                  setSubjectName(e.target.value);
                  setNameManuallyEdited(true);
                  setSuggestedName(null);
                }}
                placeholder={brief.trim().length >= 20 ? "Generating name..." : "e.g. Creative Comprehension, Sales Coaching"}
                className="ql-input-hero ql-input-hero-name"
              />
              {suggestedName && suggestedName !== subjectName && (
                <button
                  type="button"
                  onClick={() => {
                    setSubjectName(suggestedName);
                    setSuggestedName(null);
                    setNameManuallyEdited(false);
                  }}
                  className="ql-suggestion-btn"
                >
                  <span className="ql-suggestion-label">Suggestion:</span>
                  {suggestedName}
                  <span className="ql-suggestion-use">Use</span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); setSuggestedName(null); }}
                    className="ql-suggestion-dismiss"
                  >
                    &times;
                  </span>
                </button>
              )}
              {!brief.trim() && !subjectName.trim() && !suggestedName && (
                <div className="ql-no-brief-hint">
                  Describe what you&apos;re building above and we&apos;ll suggest a name
                </div>
              )}
            </div>
          </FormCard>

          {/* Step 2: Persona */}
          <FormCard>
            <StepMarker number={2} label={`Choose a ${lower('persona')}`} completed={!!persona} />
            <div className="ql-form-hint">
              The personality and interaction style your AI will use with callers.
            </div>
            <FancySelect
              options={personas.map((p) => ({ value: p.slug, label: p.name, subtitle: p.description ?? undefined }))}
              value={persona}
              onChange={(v) => { setPersona(v); setSuggestedPersona(null); }}
              placeholder={`Pick a ${lower('persona')}...`}
              loading={personasLoading}
            />
            {suggestedPersona && suggestedPersona !== persona && (() => {
              const sp = personas.find((p) => p.slug === suggestedPersona);
              if (!sp) return null;
              return (
                <button
                  type="button"
                  onClick={() => { setPersona(suggestedPersona); setSuggestedPersona(null); }}
                  className="ql-suggestion-btn"
                >
                  <span className="ql-suggestion-label">Suggestion:</span>
                  {sp.name}
                  <span className="ql-suggestion-use">Use</span>
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); setSuggestedPersona(null); }}
                    className="ql-suggestion-dismiss"
                  >
                    &times;
                  </span>
                </button>
              );
            })()}

            {/* ── Teaching style (Boston Matrix) ── */}
            <div className="ql-section-divider">
              <div className="hf-section-title" style={{ marginBottom: 8 }}>
                Teaching style
              </div>
              <div className="hf-text-xs hf-text-muted hf-mb-md">
                Place the dots to set your companion&apos;s personality. Click a preset to start from a known style.
              </div>
              <AgentTuningPanel
                onChange={handleMatrixChange}
                compact
              />
            </div>

            {/* ── Advanced: AI-driven behavior pills ── */}
            <div className="hf-mt-md">
              <AgentTuner
                initialPills={tunerPills}
                context={{ personaSlug: persona || undefined, subjectName: subjectName || undefined }}
                onChange={handleTunerChange}
                label="Advanced: Fine-tune behavior"
              />
            </div>
          </FormCard>

          {/* Step 3: Learning Goals */}
          <FormCard>
            <StepMarker number={3} label="Goals" completed={goals.length > 0} />
            <div className="ql-form-hint">
              Optional &mdash; what should users achieve?
            </div>
            <div className="hf-flex" style={{ gap: 10, marginBottom: goals.length > 0 ? 12 : 0 }}>
              <input
                type="text"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addGoal();
                  }
                }}
                placeholder="e.g. Pass the certification, Close more deals, Resolve tickets faster"
                className="ql-input-hero"
                style={{ flex: 1 }}
              />
              <button
                onClick={addGoal}
                disabled={!goalInput.trim()}
                className="hf-btn hf-btn-secondary"
                style={{ padding: "14px 20px", borderRadius: 12, fontSize: 15, fontWeight: 600, opacity: goalInput.trim() ? 1 : 0.4 }}
              >
                Add
              </button>
            </div>
            {goals.length > 0 && (
              <div className="hf-flex hf-flex-wrap hf-gap-sm">
                {goals.map((g, i) => (
                  <span key={i} className="ql-goal-chip">
                    {g}
                    <button onClick={() => removeGoal(i)} className="ql-goal-chip-remove">
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
            {suggestedGoals && suggestedGoals.length > 0 && (
              <div style={{ marginTop: goals.length > 0 ? 10 : 0 }}>
                <div className="ql-suggest-header">
                  Suggestions
                  <span
                    role="button"
                    onClick={() => setSuggestedGoals(null)}
                    className="ql-suggest-dismiss-sm"
                  >
                    &times;
                  </span>
                </div>
                <div className="hf-flex hf-flex-wrap" style={{ gap: 6 }}>
                  {suggestedGoals.map((g, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setGoals((prev) => [...prev, g]);
                        setSuggestedGoals((prev) => prev ? prev.filter((_, j) => j !== i) : null);
                      }}
                      className="ql-goal-suggest"
                    >
                      + {g}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </FormCard>

          {/* Advanced Options */}
          <div style={{ padding: "16px 0 0" }}>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="ql-advanced-toggle"
            >
              {showAdvanced ? "\u25BE" : "\u25B8"} Advanced options
            </button>
            {showAdvanced && (
              <div style={{ marginTop: 12, maxWidth: 480 }}>
                <label htmlFor="qualRef" className="ql-advanced-label">
                  Qualification reference
                </label>
                <input
                  id="qualRef"
                  type="text"
                  value={qualificationRef}
                  onChange={(e) => setQualificationRef(e.target.value)}
                  placeholder="e.g. Highfield L2 Food Safety"
                  className="ql-input-hero"
                />
              </div>
            )}
          </div>

          {/* ── Build Button ── */}
          <div style={{ padding: "32px 0 0" }}>
            <button
              onClick={handleLaunch}
              disabled={!canLaunch}
              className={`ql-build-btn ${canLaunch ? "ql-build-btn-active" : "ql-build-btn-disabled"}`}
            >
              Build It
            </button>

            {/* Progress bar showing form completion */}
            <div className="hf-mt-md">
              <div className="ql-form-progress-bar">
                <span>{completedSteps} of {totalRequired} required</span>
                {!canLaunch && (
                  <span>
                    {!subjectName.trim()
                      ? "Enter a community name"
                      : !persona
                        ? "Select a persona"
                        : ""}
                  </span>
                )}
              </div>
              <div className="ql-thin-track">
                <div
                  className={`ql-thin-fill ${completedSteps === totalRequired ? "ql-thin-fill-success" : "ql-thin-fill-accent"}`}
                  style={{ width: `${(completedSteps / totalRequired) * 100}%` }}
                />
              </div>
            </div>

            <p className="ql-form-footer">
              Creates a community, configures the companion persona, and sets up a test caller.
            </p>
          </div>
        </>
      )}

      {/* Spinner animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
