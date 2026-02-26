"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTerminology } from "@/contexts/TerminologyContext";
import { useStepFlow } from "@/contexts/StepFlowContext";
import { ProgressStepper } from "@/components/shared/ProgressStepper";
import { useUnsavedGuard } from "@/hooks/useUnsavedGuard";
import { useWizardResume } from "@/hooks/useWizardResume";
import { WizardResumeBanner } from "@/components/shared/WizardResumeBanner";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { WizardSummary } from "@/components/shared/WizardSummary";
import { Building2, Users, BookOpen, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import { FancySelect } from "@/components/shared/FancySelect";
import "./classroom-wizard.css";

interface GroupOption {
  id: string;
  name: string;
}

interface Domain {
  id: string;
  name: string;
  slug: string;
}

interface PlaybookOption {
  id: string;
  name: string;
  description: string | null;
}

interface WizardStep {
  id: string;
  label: string;
  activeLabel: string;
  order: number;
  skippable: boolean;
  description?: string;
}

const FALLBACK_STEPS: WizardStep[] = [
  { id: "name-focus", label: "Name & Focus", activeLabel: "Setting Name & Learning Focus", order: 1, skippable: false },
  { id: "courses", label: "Courses", activeLabel: "Selecting Courses", order: 2, skippable: true },
  { id: "review", label: "Review", activeLabel: "Reviewing Classroom", order: 3, skippable: false },
  { id: "invite", label: "Invite", activeLabel: "Inviting Students", order: 4, skippable: false },
];

async function fetchApi(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    try {
      return await res.json();
    } catch {
      return { ok: false, error: `Server error (${res.status})` };
    }
  }
  return res.json();
}

export default function NewClassroomPage() {
  const router = useRouter();
  const { terms, plural, lower, lowerPlural } = useTerminology();
  const { state, isActive, startFlow, setStep: flowSetStep, setData: flowSetData, getData: flowGetData, endFlow } = useStepFlow();
  const flowInitialized = useRef(false);
  const { pendingTask, isLoading: resumeLoading } = useWizardResume("classroom_setup");

  // Derive 1-indexed step from context (0-indexed) for UI compatibility
  const step = (state?.currentStep ?? 0) + 1;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [domainId, setDomainId] = useState("");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    joinToken: string;
  } | null>(null);
  const [error, setError] = useState("");

  // Warn on browser refresh/close when user has started filling in data
  useUnsavedGuard(name.trim().length > 0 && !created);
  // Steps are managed by StepFlowContext; FALLBACK_STEPS used as reference for labels
  const flowSteps = state?.steps || FALLBACK_STEPS;

  // Department picker state
  const [groupId, setGroupId] = useState("");
  const [availableGroups, setAvailableGroups] = useState<GroupOption[]>([]);

  // Email invite state
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Course picker state
  const [playbooks, setPlaybooks] = useState<PlaybookOption[]>([]);
  const [selectedPlaybooks, setSelectedPlaybooks] = useState<Set<string>>(new Set());
  const [loadingPlaybooks, setLoadingPlaybooks] = useState(false);

  // AI suggestion state
  const [nameSuggestions, setNameSuggestions] = useState<string[]>([]);
  const [loadingNameSugg, setLoadingNameSugg] = useState(false);
  const [suggDescription, setSuggDescription] = useState("");
  const [loadingDescSugg, setLoadingDescSugg] = useState(false);

  const loadClassroomSteps = async () => {
    try {
      const res = await fetch("/api/wizard-steps?wizard=classroom");
      const data = await res.json();
      if (data.ok && data.steps?.length > 0) return data.steps;
    } catch {
      // Silent — fallback already set
    }
    return FALLBACK_STEPS;
  };

  const startFreshFlow = async () => {
    const stepsToUse = await loadClassroomSteps();

    // Create a UserTask for DB-backed wizard persistence
    let taskId: string | undefined;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: "classroom_setup", currentStep: 0, context: { _wizardStep: 0 } }),
      });
      const data = await res.json();
      if (data.ok) taskId = data.taskId;
    } catch {
      // Continue without DB persistence — sessionStorage still works
    }

    startFlow({
      flowId: "create-classroom",
      steps: stepsToUse.map((s: WizardStep) => ({ id: s.id, label: s.label, activeLabel: s.activeLabel })),
      returnPath: "/x/educator/classrooms/new",
      taskType: "classroom_setup",
      taskId,
    });
  };

  const handleResume = async () => {
    if (!pendingTask) return;
    const stepsToUse = await loadClassroomSteps();
    const ctx = pendingTask.context || {};

    startFlow({
      flowId: "create-classroom",
      steps: stepsToUse.map((s: WizardStep) => ({ id: s.id, label: s.label, activeLabel: s.activeLabel })),
      returnPath: "/x/educator/classrooms/new",
      taskType: "classroom_setup",
      taskId: pendingTask.id,
      initialData: ctx,
      initialStep: ctx._wizardStep ?? 0,
    });

    // Hydrate local state from resumed context
    if (ctx.name) setName(ctx.name);
    if (ctx.description) setDescription(ctx.description);
    if (ctx.domainId) setDomainId(ctx.domainId);
    if (ctx.groupId) setGroupId(ctx.groupId);
    if (ctx.created) setCreated(ctx.created);
    if (ctx.selectedPlaybooks) setSelectedPlaybooks(new Set(ctx.selectedPlaybooks));
  };

  const handleDiscardResume = async () => {
    if (pendingTask) {
      try {
        await fetch(`/api/tasks?taskId=${pendingTask.id}`, { method: "DELETE" });
      } catch { /* ignore */ }
    }
    await startFreshFlow();
  };

  // Initialize StepFlowContext (load steps from ORCHESTRATE spec with hardcoded fallback)
  useEffect(() => {
    if (flowInitialized.current) return;
    // Don't auto-start if resume detection is still loading or a pending task exists
    if (resumeLoading || pendingTask) return;
    flowInitialized.current = true;

    if (isActive && state?.flowId === "create-classroom") {
      // Restore local state from context on re-entry (page refresh with sessionStorage intact)
      const savedName = flowGetData<string>("name");
      const savedDesc = flowGetData<string>("description");
      const savedDomainId = flowGetData<string>("domainId");
      const savedGroupId = flowGetData<string>("groupId");
      const savedCreated = flowGetData<{ id: string; joinToken: string }>("created");
      const savedPlaybooks = flowGetData<string[]>("selectedPlaybooks");
      if (savedName) setName(savedName);
      if (savedDesc) setDescription(savedDesc);
      if (savedDomainId) setDomainId(savedDomainId);
      if (savedGroupId) setGroupId(savedGroupId);
      if (savedCreated) setCreated(savedCreated);
      if (savedPlaybooks) setSelectedPlaybooks(new Set(savedPlaybooks));
    } else {
      // No active flow, no pending resume — start fresh
      startFreshFlow();
    }
  }, [resumeLoading, pendingTask]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchApi("/api/domains")
      .then((res: { ok: boolean; domains?: Domain[] }) => {
        if (res?.ok && res.domains) {
          setDomains(res.domains);
          if (res.domains.length === 1) {
            setDomainId(res.domains[0].id);
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Load groups when domain changes
  useEffect(() => {
    if (!domainId) {
      setAvailableGroups([]);
      setGroupId("");
      return;
    }
    fetchApi(`/api/playbook-groups?domainId=${domainId}`)
      .then((res: { ok: boolean; groups?: { id: string; name: string }[] }) => {
        if (res?.ok && res.groups) {
          setAvailableGroups(res.groups.map((g) => ({ id: g.id, name: g.name })));
        } else {
          setAvailableGroups([]);
        }
      });
  }, [domainId]);

  // Fetch cohort name suggestions when domain is selected
  useEffect(() => {
    if (!domainId || name.trim()) return;
    const domain = domains.find((d) => d.id === domainId);
    if (!domain) return;
    const group = availableGroups.find((g) => g.id === groupId);
    setNameSuggestions([]);
    setLoadingNameSugg(true);
    fetchApi("/api/educator/classrooms/suggest-name", {
      method: "POST",
      body: JSON.stringify({ domainName: domain.name, groupName: group?.name }),
    })
      .then((res: { ok: boolean; names?: string[] }) => {
        if (res?.ok && res.names?.length) setNameSuggestions(res.names);
      })
      .catch(() => {})
      .finally(() => setLoadingNameSugg(false));
  }, [domainId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load playbooks when domain changes
  useEffect(() => {
    if (!domainId) {
      setPlaybooks([]);
      setSelectedPlaybooks(new Set());
      return;
    }
    setLoadingPlaybooks(true);
    fetchApi(`/api/educator/playbooks?domainId=${domainId}`)
      .then((res: { ok: boolean; playbooks?: PlaybookOption[] }) => {
        if (res?.ok && res.playbooks) {
          setPlaybooks(res.playbooks);
          // Pre-select all
          setSelectedPlaybooks(new Set(res.playbooks.map((p) => p.id)));
        }
      })
      .finally(() => setLoadingPlaybooks(false));
  }, [domainId]);

  const handleNameBlur = async () => {
    if (name.trim().length < 3 || description.trim()) return;
    const domain = domains.find((d) => d.id === domainId);
    setLoadingDescSugg(true);
    try {
      const res = await fetchApi("/api/educator/classrooms/suggest-description", {
        method: "POST",
        body: JSON.stringify({ cohortName: name, domainName: domain?.name ?? "" }),
      });
      if (res?.ok && res.description) setSuggDescription(res.description);
    } catch {
      // Silent
    } finally {
      setLoadingDescSugg(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setError("");

    try {
      const res = await fetchApi("/api/educator/classrooms", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          domainId,
          groupId: groupId || undefined,
          playbookIds: [...selectedPlaybooks],
        }),
      });

      if (res?.ok) {
        sessionStorage.removeItem("classroom-draft"); // clean up legacy
        const createdData = { id: res.classroom.id, joinToken: res.classroom.joinToken };
        setCreated(createdData);
        flowSetData("created", createdData);
        const inviteIdx = state?.steps.findIndex(s => s.id === "invite") ?? 3;
        flowSetStep(inviteIdx >= 0 ? inviteIdx : 3);
      } else {
        setError(res?.error ?? `Failed to create ${lower("cohort")}`);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setCreating(false);
    }
  };

  const handleSendInvites = async () => {
    if (!created) return;
    const emails = inviteEmails
      .split(/[,\n]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));
    if (emails.length === 0) return;

    setInviting(true);
    setInviteResult(null);
    try {
      const res = await fetchApi(`/api/educator/classrooms/${created.id}/invite`, {
        method: "POST",
        body: JSON.stringify({ emails }),
      });
      if (res?.ok) {
        const parts: string[] = [];
        if (res.created > 0) parts.push(`${res.created} invite${res.created !== 1 ? "s" : ""} sent`);
        if (res.skipped > 0) parts.push(`${res.skipped} already invited`);
        setInviteResult({ ok: true, message: parts.join(", ") || "Done" });
        setInviteEmails("");
      } else {
        setInviteResult({ ok: false, message: res?.error ?? "Failed to send invites" });
      }
    } catch {
      setInviteResult({ ok: false, message: "Network error" });
    } finally {
      setInviting(false);
    }
  };

  const joinUrl = created?.joinToken
    ? `${window.location.origin}/join/${created.joinToken}`
    : "";

  const selectedDomain = domains.find((d) => d.id === domainId);

  const inviteMessage = `You're invited to join ${name}${selectedDomain ? ` (${selectedDomain.name})` : ""}!\n\nJoin here: ${joinUrl}`;

  const { copiedKey, copy: copyText } = useCopyToClipboard();

  const copyLink = () => copyText(joinUrl, "link");
  const copyMessage = () => copyText(inviteMessage, "message");

  // Show resume banner if there's an unfinished wizard task and flow isn't active
  const showWizard = isActive && state?.flowId === "create-classroom";
  if (!showWizard && !resumeLoading && pendingTask) {
    return (
      <div className="cwiz-container-padded">
        <WizardResumeBanner
          task={pendingTask}
          onResume={handleResume}
          onDiscard={handleDiscardResume}
          label="Classroom Setup"
        />
      </div>
    );
  }

  if (loading || resumeLoading) {
    return (
      <div className="cwiz-loading">
        <div className="hf-spinner" />
      </div>
    );
  }

  return (
    <div className="cwiz-container">
      <h1 className="hf-page-title flex items-center gap-2 cwiz-title-gap">
        Create {terms.cohort}
        <span className="hf-gf-badge">GF</span>
      </h1>
      <p className="hf-page-subtitle cwiz-subtitle-gap">
        Set up a new {lower("cohort")} for your {lowerPlural("caller")}.
      </p>

      {/* Step indicators */}
      <ProgressStepper
        steps={(state?.steps || FALLBACK_STEPS).map((s, i) => ({
          label: s.label,
          completed: i < (state?.currentStep ?? 0),
          active: i === (state?.currentStep ?? 0),
          processing: (i === 1 && loadingPlaybooks) || (i === 2 && creating),
          onClick: i < (state?.currentStep ?? 0) ? () => flowSetStep(i) : undefined,
        }))}
      />

      {/* Step 1: Name & Focus */}
      {step === 1 && (
        <div className="hf-card">
          <h2 className="hf-section-title cwiz-section-header">
            {flowSteps[0]?.label ?? "Name & Focus"}
          </h2>

          <div className="cwiz-field-group">
            <label className="hf-label">{terms.cohort} Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameBlur}
              placeholder="e.g. Year 10 English, Tuesday Coaching Group"
              className="hf-input cwiz-input-full"
            />
            {loadingNameSugg && (
              <div className="hf-ai-loading-row hf-mt-xs">
                <Loader2 size={12} className="hf-spinner" />
                <span className="hf-text-xs hf-text-muted">Generating name ideas…</span>
              </div>
            )}
            {!loadingNameSugg && nameSuggestions.length > 0 && !name.trim() && (
              <div className="hf-mt-xs">
                <p className="hf-ai-inline-hint hf-mb-xs">
                  <Sparkles size={11} /> Suggestions — click to use:
                </p>
                <div className="hf-suggestion-chips">
                  {nameSuggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      className="hf-suggestion-chip"
                      onClick={() => { setName(s); setNameSuggestions([]); }}
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="cwiz-field-group">
            <label className="hf-label">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`A short note about this ${lower("cohort")}...`}
              rows={3}
              className="hf-input cwiz-textarea-full"
            />
            {loadingDescSugg && (
              <div className="hf-ai-loading-row hf-mt-xs">
                <Loader2 size={12} className="hf-spinner" />
                <span className="hf-text-xs hf-text-muted">Drafting description…</span>
              </div>
            )}
            {!loadingDescSugg && suggDescription && !description.trim() && (
              <div className="hf-mt-xs">
                <p className="hf-ai-inline-hint hf-mb-xs">
                  <Sparkles size={11} /> Suggestion:
                </p>
                <div className="hf-suggestion-chips">
                  <button
                    type="button"
                    className="hf-suggestion-chip"
                    onClick={() => { setDescription(suggDescription); setSuggDescription(""); }}
                  >
                    {suggDescription}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="cwiz-field-group-lg">
            <label className="hf-label">Learning Focus *</label>
            {domains.length === 0 ? (
              <p className="cwiz-no-domain">
                No institutions available.{" "}
                <span
                  className="cwiz-create-link"
                  onClick={() => router.push("/x/quick-launch")}
                >
                  Create one with Community
                </span>
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {domains.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDomainId(d.id)}
                    className={`hf-chip${domainId === d.id ? " hf-chip-selected" : ""}`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {availableGroups.length > 0 && (
            <div className="cwiz-field-group-lg">
              <label className="hf-label">{terms.group || "Department"} (optional)</label>
              <FancySelect
                value={groupId}
                onChange={setGroupId}
                placeholder={`All ${(terms.group || "Department").toLowerCase()}s`}
                clearable
                options={availableGroups.map((g) => ({ value: g.id, label: g.name }))}
                style={{ width: "100%" }}
              />
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { endFlow(); router.push("/x/educator/classrooms"); }}
              className="hf-btn hf-btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              disabled={!name.trim() || !domainId}
              onClick={() => {
                flowSetData("name", name);
                flowSetData("description", description);
                flowSetData("domainId", domainId);
                flowSetData("groupId", groupId || undefined);
                flowSetStep(1);
              }}
              className="hf-btn hf-btn-primary cwiz-btn-wide"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Courses */}
      {step === 2 && (
        <div className="hf-card">
          <h2 className="hf-section-title cwiz-section-header-sm">
            {flowSteps[1]?.label ?? "Courses"}
          </h2>
          <p className="hf-hint cwiz-section-header">
            Select which courses to include in this {lower("cohort")}. All are selected by default.
          </p>

          {loadingPlaybooks ? (
            <div className="cwiz-spinner-wrap">
              <div className="hf-spinner" />
            </div>
          ) : playbooks.length === 0 ? (
            <div className="hf-banner hf-banner-info cwiz-banner-gap">
              No published courses for this domain. Your {lowerPlural("caller")} can still join — courses can be added later.
            </div>
          ) : (
            <div className="flex flex-col gap-2 cwiz-course-list">
              {playbooks.map((pb) => {
                const isSelected = selectedPlaybooks.has(pb.id);
                return (
                  <button
                    key={pb.id}
                    onClick={() => {
                      setSelectedPlaybooks((prev) => {
                        const next = new Set(prev);
                        if (next.has(pb.id)) next.delete(pb.id);
                        else next.add(pb.id);
                        return next;
                      });
                    }}
                    className={`hf-chip${isSelected ? " hf-chip-selected" : ""} flex items-start gap-3 text-left w-full cwiz-course-chip`}
                  >
                    <div
                      className={`cwiz-checkbox-visual flex-shrink-0 ${isSelected ? "cwiz-checkbox-checked" : "cwiz-checkbox-unchecked"}`}
                    >
                      {isSelected && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <div className="cwiz-course-name">
                        {pb.name}
                      </div>
                      {pb.description && (
                        <div className="hf-hint cwiz-course-desc">
                          {pb.description}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                flowSetData("selectedPlaybooks", [...selectedPlaybooks]);
                flowSetStep(0);
              }}
              className="hf-btn hf-btn-secondary flex-1"
            >
              Back
            </button>
            <button
              onClick={() => {
                flowSetData("selectedPlaybooks", [...selectedPlaybooks]);
                flowSetStep(2);
              }}
              className="hf-btn hf-btn-primary cwiz-btn-wide"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Create */}
      {step === 3 && (
        <div className="hf-card">
          <h2 className="hf-section-title cwiz-section-header">
            {flowSteps[2]?.label ?? "Review"}
          </h2>

          <div className="cwiz-review-box">
            <div className="cwiz-review-title">
              {name}
            </div>
            {description && (
              <div className="cwiz-review-desc">
                {description}
              </div>
            )}
            <div className="cwiz-review-tags">
              <div className="cwiz-review-tag">
                {selectedDomain?.name}
              </div>
              {selectedPlaybooks.size > 0 && (
                <div className="cwiz-review-tag">
                  {selectedPlaybooks.size} course{selectedPlaybooks.size !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          </div>

          <ErrorBanner error={error} className="cwiz-error-gap" />

          <div className="flex gap-3">
            <button
              onClick={() => flowSetStep(1)}
              className="hf-btn hf-btn-secondary flex-1"
            >
              Back
            </button>
            <button
              disabled={creating}
              onClick={handleCreate}
              className="hf-btn hf-btn-primary cwiz-btn-wide"
            >
              {creating ? <><span className="hf-spinner cwiz-spinner-sm" /> Creating...</> : `Create ${terms.cohort}`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Invite */}
      {step === 4 && created && (
        <WizardSummary
          title={`${terms.cohort} Created!`}
          subtitle={`Invite your ${lowerPlural("caller")} to join.`}
          intent={{
            items: [
              { icon: <Users className="w-4 h-4" />, label: terms.cohort, value: name || "—" },
              ...(selectedDomain ? [{ icon: <Building2 className="w-4 h-4" />, label: terms.domain, value: selectedDomain.name }] : []),
              ...(selectedPlaybooks.size > 0 ? [{ icon: <BookOpen className="w-4 h-4" />, label: "Courses", value: `${selectedPlaybooks.size} selected` }] : []),
            ],
          }}
          created={{
            entities: [
              {
                icon: <Users className="w-5 h-5" />,
                label: terms.cohort,
                name: name || "—",
                detail: `${selectedPlaybooks.size} course${selectedPlaybooks.size !== 1 ? "s" : ""}`,
                href: `/x/educator/classrooms/${created.id}`,
              },
              ...(selectedDomain ? [{
                icon: <Building2 className="w-5 h-5" />,
                label: terms.domain,
                name: selectedDomain.name,
                href: `/x/domains?id=${selectedDomain.id}`,
              }] : []),
            ],
          }}
          primaryAction={{
            label: `Go to ${terms.cohort}`,
            href: `/x/educator/classrooms/${created.id}`,
            onClick: endFlow,
          }}
          secondaryActions={[
            {
              label: "Create Another",
              onClick: () => {
                setName("");
                setDescription("");
                setDomainId(domains.length === 1 ? domains[0].id : "");
                setGroupId("");
                setCreated(null);
                setSelectedPlaybooks(new Set());
                setInviteEmails("");
                setInviteResult(null);
                // Clear stale bag data so the new flow starts fresh
                flowSetData("name", undefined);
                flowSetData("description", undefined);
                flowSetData("domainId", undefined);
                flowSetData("groupId", undefined);
                flowSetData("created", undefined);
                flowSetData("selectedPlaybooks", undefined);
                flowSetStep(0);
              },
            },
          ]}
        >
          {/* Join Link */}
          <div className="wiz-section">
            <div className="wiz-section-label">Join Link</div>
            <div className="cwiz-join-box">
              <input
                type="text"
                readOnly
                value={joinUrl}
                className="hf-input cwiz-join-input"
              />
              <button
                onClick={copyLink}
                className={`wiz-action-primary cwiz-copy-btn${copiedKey === "link" ? " cwiz-copy-btn-copied" : ""}`}
              >
                {copiedKey === "link" ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>

          {/* Email Invites */}
          <div className="wiz-section">
            <div className="wiz-section-label">Invite by Email</div>
            <textarea
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder={`Enter email addresses (one per line or comma-separated)\ne.g. alice@school.com, bob@school.com`}
              rows={3}
              className="hf-input cwiz-email-textarea"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSendInvites}
                disabled={inviting || !inviteEmails.trim()}
                className="hf-btn hf-btn-primary cwiz-invite-btn"
              >
                {inviting ? "Sending..." : "Send Invites"}
              </button>
              {inviteResult && (
                <span className={`cwiz-invite-result ${inviteResult.ok ? "cwiz-invite-result-ok" : "cwiz-invite-result-err"}`}>
                  {inviteResult.message}
                </span>
              )}
            </div>
          </div>

          {/* Invite Message */}
          <div className="wiz-section">
            <div className="wiz-section-label">Invite Message</div>
            <div className="cwiz-message-box">
              <pre className="cwiz-message-pre">
                {inviteMessage}
              </pre>
            </div>
            <button
              onClick={copyMessage}
              className={`wiz-action-secondary${copiedKey === "message" ? " cwiz-copy-msg-copied" : ""}`}
            >
              {copiedKey === "message" ? "Copied!" : "Copy Message"}
            </button>
          </div>
        </WizardSummary>
      )}
    </div>
  );
}
