"use client";

import { useCallback, useEffect, useState } from "react";
import { FancySelect } from "@/components/shared/FancySelect";
import type { FancySelectOption } from "@/components/shared/FancySelect";
import { ConversationalWizard } from "../wizard/components/ConversationalWizard";
import type { WizardInitialContext } from "../wizard/components/ConversationalWizard";
import { useChordShortcut } from "@/hooks/useChordShortcut";
import { ChordHintBadge } from "@/components/help/ChordHintBadge";
import { getEffectiveChords } from "@/lib/help/page-help";
import "./get-started-v5.css";

/* ── Types ──────────────────────────────────────────────── */

interface InstitutionFromAPI {
  id: string;
  name: string;
  typeSlug: string | null;
  defaultDomainKind: string | null;
  domainId: string | null;
}

export interface CourseOption {
  id: string;
  name: string;
  status: string;
  subjectName: string | null;
  config: Record<string, unknown> | null;
}

interface V5WizardWithSelectorProps {
  defaultInstitution: {
    id: string;
    name: string;
    domainId: string;
    domainKind: "INSTITUTION" | "COMMUNITY";
    typeSlug: string | null;
  } | null;
  userRole: string;
  /** Pre-select a course (from ?courseId= param) */
  defaultCourseId?: string | null;
  /** Available courses for the domain */
  courses?: CourseOption[];
}

const NEW_COURSE_VALUE = "__new__";

/* ── Component ──────────────────────────────────────────── */

export function V5WizardWithSelector({
  defaultInstitution,
  userRole,
  defaultCourseId,
  courses = [],
}: V5WizardWithSelectorProps) {
  const [institutions, setInstitutions] = useState<InstitutionFromAPI[]>([]);
  const [selectedId, setSelectedId] = useState(defaultInstitution?.id ?? "");
  const [selectedCourseId, setSelectedCourseId] = useState(defaultCourseId ?? NEW_COURSE_VALUE);
  const [loading, setLoading] = useState(false);

  const isSuperAdmin = userRole === "SUPERADMIN";

  // #688 — chord shortcuts (page-specific C=Exit + global nav chords).
  const wizardChords = getEffectiveChords("/x/get-started-v5");
  const { activePrefix: chordActivePrefix } = useChordShortcut(wizardChords);

  // Fetch institution list on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/user/institutions")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list: InstitutionFromAPI[] = data.institutions ?? [];
        setInstitutions(list);
        // If no default was set server-side, pick first from list — but never
        // for SUPERADMIN (#702 fix only worked server-side; the client auto-
        // pick was silently restoring Abacus as the alphabetically-first
        // tenant). SUPERADMIN must make an explicit choice.
        if (!selectedId && list.length > 0 && !isSuperAdmin) setSelectedId(list[0].id);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // #703 — Show institution selector ONLY for SUPERADMIN. Non-SUPERADMIN
  // users are hard-locked to their own session.user.institutionId. Even
  // when they appear in multiple institutions via UserInstitution joins,
  // the wizard does not give them a switcher — the server-side guard in
  // /api/chat (WIZARD mode) is the second line of defense.
  const showInstitutionSelector = isSuperAdmin;

  // Show course selector when courses exist
  const showCourseSelector = courses.length > 0;

  // Build institution FancySelect options
  const instOptions: FancySelectOption[] = institutions.map((inst) => ({
    value: inst.id,
    label: inst.name,
    subtitle: inst.typeSlug?.replace(/-/g, " ") ?? "Organisation",
  }));

  // Build course FancySelect options with "New Course..." at top
  const courseOptions: FancySelectOption[] = [
    { value: NEW_COURSE_VALUE, label: "New Course...", subtitle: "Start from scratch" },
    ...courses.map((c) => ({
      value: c.id,
      label: c.name,
      subtitle: [c.subjectName, c.status].filter(Boolean).join(" · "),
    })),
  ];

  // Build WizardInitialContext from selected institution
  const selected = institutions.find((i) => i.id === selectedId);
  const pickerContext: WizardInitialContext | undefined =
    selected && selected.domainId
      ? {
          institutionName: selected.name,
          institutionId: selected.id,
          domainId: selected.domainId,
          domainKind: (selected.defaultDomainKind as "INSTITUTION" | "COMMUNITY") ?? "INSTITUTION",
          typeSlug: selected.typeSlug,
          userRole,
        }
      : defaultInstitution
        ? {
            institutionName: defaultInstitution.name,
            institutionId: defaultInstitution.id,
            domainId: defaultInstitution.domainId,
            domainKind: defaultInstitution.domainKind,
            typeSlug: defaultInstitution.typeSlug,
            userRole,
          }
        : undefined;

  // Build course pre-fill data for amendment mode
  const selectedCourse = selectedCourseId !== NEW_COURSE_VALUE
    ? courses.find((c) => c.id === selectedCourseId)
    : null;

  // #929 Slice A — Start Over override. For non-SUPERADMIN users this is set
  // by `handleStartOver` after re-fetching `/api/user/wizard-context`, so the
  // wizard re-anchors to the educator's home institution + domain rather than
  // the picker's prior selection or the amendment-mode course's domain.
  //
  // The override REPLACES (not merges with) the picker / amendment context —
  // Start Over drops the course pre-fill so the next attempt is truly fresh.
  //
  // While the re-fetch is in flight we set this to `undefined` (rather than
  // leaving the stale picker context) so the wizard's re-seed effect
  // (ConversationalWizard.tsx — guarded by `initialContext && ...`) does NOT
  // fire with stale data. It re-fires once the new context arrives.
  const [overrideContext, setOverrideContext] = useState<WizardInitialContext | undefined>(undefined);
  const [overrideActive, setOverrideActive] = useState(false);

  const handleStartOver = useCallback(async () => {
    if (isSuperAdmin) return; // SUPERADMIN keeps picker selection (#929 risk note)

    setOverrideActive(true);
    setOverrideContext(undefined); // suppress re-seed effect while fetching

    try {
      const res = await fetch("/api/user/wizard-context");
      const json = await res.json();
      if (json?.ok && json.context) {
        setOverrideContext({ ...json.context, userRole });
      }
    } catch {
      // Fall back silently — the picker/defaultInstitution context will stay
      // in effect via the merge below.
      setOverrideActive(false);
    }
  }, [isSuperAdmin, userRole]);

  // When the override is active and resolved (or even still loading), it wins
  // over the picker/amendment context.
  const initialContext = overrideActive ? overrideContext : pickerContext;

  // Key includes institution + course so wizard resets when switching
  const wizardKey = `v5-${selectedId}-${selectedCourseId}`;

  return (
    <>
      {(showInstitutionSelector || showCourseSelector) && (
        <div className="v5-institution-bar">
          {showInstitutionSelector && (
            <div>
              <label className="hf-text-xs hf-text-muted">Build course for...</label>
              <FancySelect
                value={selectedId}
                onChange={setSelectedId}
                options={instOptions}
                searchable
                loading={loading}
                placeholder="Pick an organisation..."
              />
            </div>
          )}
          {showCourseSelector && (
            <div>
              <label className="hf-text-xs hf-text-muted">Course</label>
              <FancySelect
                value={selectedCourseId}
                onChange={setSelectedCourseId}
                options={courseOptions}
                searchable
                placeholder="Select course..."
              />
            </div>
          )}
        </div>
      )}
      <ConversationalWizard
        key={wizardKey}
        initialContext={
          // #929 Slice A — once the user has hit Start Over (overrideActive),
          // drop the amendment-mode course pre-fill so the fresh attempt
          // anchors to the user's home domain only.
          !overrideActive && selectedCourse && initialContext
            ? {
                ...initialContext,
                courseId: selectedCourse.id,
                courseName: selectedCourse.name,
                subjectDiscipline: selectedCourse.subjectName ?? undefined,
                interactionPattern: (selectedCourse.config as Record<string, unknown> | null)?.interactionPattern as string | undefined,
                teachingMode: (selectedCourse.config as Record<string, unknown> | null)?.teachingMode as string | undefined,
              }
            : initialContext
        }
        userRole={userRole}
        wizardVersion="v5"
        onStartOver={handleStartOver}
      />
      <ChordHintBadge activePrefix={chordActivePrefix} chords={wizardChords} />
    </>
  );
}
