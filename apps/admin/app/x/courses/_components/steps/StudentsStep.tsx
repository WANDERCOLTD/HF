'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, Plus, Trash2, Users, User, Mail, Search, X, Loader2 } from 'lucide-react';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import type { StepProps } from '../CourseSetupWizard';

type EnrollMode = 'group' | 'individual' | 'email';

type CohortOption = {
  id: string;
  name: string;
  memberCount: number;
};

type CallerOption = {
  id: string;
  name: string;
  email: string | null;
};

export function StudentsStep({ setData, getData, onNext, onPrev }: StepProps) {
  const domainId = getData<string>('domainId');
  const hasDomain = !!domainId;

  const [mode, setMode] = useState<EnrollMode>(hasDomain ? 'group' : 'email');

  // Group mode state
  const [cohorts, setCohorts] = useState<CohortOption[]>([]);
  const [cohortsLoading, setCohortsLoading] = useState(false);
  const [cohortsError, setCohortsError] = useState<string | null>(null);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);

  // Individual mode state
  const [callers, setCallers] = useState<CallerOption[]>([]);
  const [callersLoading, setCallersLoading] = useState(false);
  const [callersError, setCallersError] = useState<string | null>(null);
  const [callerSearch, setCallerSearch] = useState('');
  const [selectedCallerIds, setSelectedCallerIds] = useState<string[]>([]);

  // Email mode state
  const [emails, setEmails] = useState<string[]>(['']);

  // Restore saved data
  useEffect(() => {
    const savedCohortIds = getData<string[]>('cohortGroupIds');
    if (savedCohortIds) setSelectedCohortIds(savedCohortIds);
    const savedCallerIds = getData<string[]>('selectedCallerIds');
    if (savedCallerIds) setSelectedCallerIds(savedCallerIds);
    const savedEmails = getData<string[]>('studentEmails');
    if (savedEmails && savedEmails.length > 0) setEmails(savedEmails);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchCohorts = useCallback(async (signal?: AbortSignal) => {
    if (!domainId) return;
    setCohortsLoading(true);
    setCohortsError(null);
    try {
      const res = await fetch(`/api/cohorts?domainId=${domainId}&limit=100`, { signal });
      if (!res.ok) throw new Error('Failed to load groups');
      const data = await res.json();
      if (!signal?.aborted && data.ok) {
        setCohorts(
          (data.cohorts || []).map((c: any) => ({
            id: c.id, name: c.name,
            memberCount: c._count?.members ?? c.memberCount ?? 0,
          }))
        );
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setCohortsError(err.message || 'Failed to load groups');
    } finally {
      if (!signal?.aborted) setCohortsLoading(false);
    }
  }, [domainId]);

  const fetchCallers = useCallback(async (signal?: AbortSignal) => {
    setCallersLoading(true);
    setCallersError(null);
    try {
      const res = await fetch('/api/callers?limit=200&withCounts=false', { signal });
      if (!res.ok) throw new Error('Failed to load learners');
      const data = await res.json();
      if (!signal?.aborted && data.ok) {
        setCallers(
          (data.callers || []).map((c: any) => ({
            id: c.id, name: c.name || c.email || 'Unknown', email: c.email || null,
          }))
        );
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setCallersError(err.message || 'Failed to load learners');
    } finally {
      if (!signal?.aborted) setCallersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'group' || !domainId) return;
    const ac = new AbortController();
    fetchCohorts(ac.signal);
    return () => ac.abort();
  }, [mode, domainId, fetchCohorts]);

  useEffect(() => {
    if (mode !== 'individual') return;
    const ac = new AbortController();
    fetchCallers(ac.signal);
    return () => ac.abort();
  }, [mode, fetchCallers]);

  const handleAddEmail = () => setEmails([...emails, '']);
  const handleEmailChange = (index: number, value: string) => {
    const next = [...emails];
    next[index] = value;
    setEmails(next);
  };
  const handleRemoveEmail = (index: number) => setEmails(emails.filter((_, i) => i !== index));

  const toggleCohort = (id: string) => {
    setSelectedCohortIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleCaller = (id: string) => {
    setSelectedCallerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filteredCallers = callerSearch.trim()
    ? callers.filter(
        (c) =>
          c.name.toLowerCase().includes(callerSearch.toLowerCase()) ||
          (c.email && c.email.toLowerCase().includes(callerSearch.toLowerCase()))
      )
    : callers;

  const handleNext = () => {
    setData('cohortGroupIds', selectedCohortIds.length > 0 ? selectedCohortIds : undefined);
    setData('selectedCallerIds', selectedCallerIds.length > 0 ? selectedCallerIds : undefined);
    setData('studentEmails', emails.filter((e) => e.trim()));
    onNext();
  };

  const handleSkip = () => {
    setData('cohortGroupIds', undefined);
    setData('selectedCallerIds', undefined);
    setData('studentEmails', []);
    onNext();
  };

  const totalSelected =
    selectedCohortIds.length + selectedCallerIds.length + emails.filter((e) => e.trim()).length;

  const MODE_TABS: { id: EnrollMode; label: string; icon: React.ReactNode; requiresDomain: boolean }[] = [
    { id: 'group', label: 'Add a Group', icon: <Users className="hf-icon-sm" />, requiresDomain: true },
    { id: 'individual', label: 'Pick Individuals', icon: <User className="hf-icon-sm" />, requiresDomain: false },
    { id: 'email', label: 'Invite by Email', icon: <Mail className="hf-icon-sm" />, requiresDomain: false },
  ];

  const availableTabs = hasDomain ? MODE_TABS : MODE_TABS.filter((t) => !t.requiresDomain);

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-md">
          <FieldHint label="Add Students" hint={WIZARD_HINTS["course.students"]} labelClass="hf-page-title hf-mb-xs" />
          <p className="hf-page-subtitle">Enroll students now, or skip and add them later</p>
          <div className="hf-banner hf-banner-info hf-mt-sm">
            <strong>WhatsApp Follow-ups:</strong> After each lesson, students receive a message on WhatsApp.
            Make sure students have provided phone numbers during enrollment.
          </div>
          {!hasDomain && (
            <p className="hf-hint hf-mt-xs">
              Group enrollment will be available after the course is created.
            </p>
          )}
        </div>

        {/* Mode tabs */}
        {availableTabs.length > 1 && (
          <div className="hf-flex hf-gap-sm hf-mb-md">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`hf-mode-tab${mode === tab.id ? ' hf-mode-tab-active' : ''}`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Group Mode ─────────────────────────────── */}
        {mode === 'group' && (
          <div>
            {cohortsError && (
              <div className="hf-banner hf-banner-error hf-mb-sm">
                {cohortsError}
                <button onClick={() => fetchCohorts()} className="hf-link-subtle hf-text-sm hf-ml-sm">
                  Retry
                </button>
              </div>
            )}
            {cohortsLoading ? (
              <div className="hf-loading-row-lg">
                <Loader2 className="hf-spinner hf-icon-sm" />
                <span className="hf-text-sm">Loading groups...</span>
              </div>
            ) : cohorts.length === 0 && !cohortsError ? (
              <div className="hf-empty-compact">
                <Users className="hf-icon-xl hf-text-tertiary hf-icon-block" />
                <p className="hf-text-sm hf-text-secondary">No groups found for this institution.</p>
                <p className="hf-text-xs hf-text-muted hf-mt-xs">Create a classroom first, or use another enrollment method.</p>
              </div>
            ) : (
              <div className="hf-flex hf-flex-col hf-gap-sm">
                {cohorts.map((cohort) => {
                  const selected = selectedCohortIds.includes(cohort.id);
                  return (
                    <button
                      key={cohort.id}
                      onClick={() => toggleCohort(cohort.id)}
                      className={`hf-select-item${selected ? ' hf-select-item-selected' : ''}`}
                    >
                      <div className={`hf-checkbox${selected ? ' hf-checkbox-checked' : ''}`}>
                        {selected && (
                          <svg className="hf-icon-xs" fill="none" stroke="white" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="hf-flex-1">
                        <p className="hf-text-sm hf-text-bold">{cohort.name}</p>
                        <p className="hf-text-xs hf-text-muted">
                          {cohort.memberCount} member{cohort.memberCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Individual Mode ────────────────────────── */}
        {mode === 'individual' && (
          <div>
            {callersError && (
              <div className="hf-banner hf-banner-error hf-mb-sm">
                {callersError}
                <button onClick={() => fetchCallers()} className="hf-link-subtle hf-text-sm hf-ml-sm">
                  Retry
                </button>
              </div>
            )}
            {/* Search */}
            <div className="hf-search-wrap">
              <Search className="hf-search-icon hf-icon-sm" />
              <input
                type="text"
                value={callerSearch}
                onChange={(e) => setCallerSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="hf-input"
              />
              {callerSearch && (
                <button onClick={() => setCallerSearch('')} className="hf-search-clear">
                  <X className="hf-icon-sm" />
                </button>
              )}
            </div>

            {selectedCallerIds.length > 0 && (
              <p className="hf-text-sm hf-text-secondary hf-mb-sm">{selectedCallerIds.length} selected</p>
            )}

            {callersLoading ? (
              <div className="hf-loading-row-lg">
                <Loader2 className="hf-spinner hf-icon-sm" />
                <span className="hf-text-sm">Loading learners...</span>
              </div>
            ) : filteredCallers.length === 0 ? (
              <div className="hf-empty-compact">
                <User className="hf-icon-xl hf-text-tertiary hf-icon-block" />
                <p className="hf-text-sm hf-text-secondary">
                  {callerSearch ? 'No learners match your search.' : 'No learners found.'}
                </p>
              </div>
            ) : (
              <div className="hf-list-scroll hf-flex hf-flex-col hf-gap-xs">
                {filteredCallers.map((caller) => {
                  const selected = selectedCallerIds.includes(caller.id);
                  return (
                    <button
                      key={caller.id}
                      onClick={() => toggleCaller(caller.id)}
                      className={`hf-select-item hf-select-item-compact${selected ? ' hf-select-item-selected' : ''}`}
                    >
                      <div className={`hf-checkbox hf-checkbox-sm${selected ? ' hf-checkbox-checked' : ''}`}>
                        {selected && (
                          <svg className="hf-icon-xs" fill="none" stroke="white" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="hf-flex-1 hf-min-w-0">
                        <p className="hf-text-sm hf-text-bold hf-truncate">
                          {caller.name}
                        </p>
                        {caller.email && (
                          <p className="hf-text-xs hf-text-muted hf-truncate">
                            {caller.email}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Email Mode ─────────────────────────────── */}
        {mode === 'email' && (
          <div>
            <div className="hf-flex hf-flex-col hf-gap-sm hf-mb-md">
              {emails.map((email, i) => (
                <div key={i} className="hf-flex hf-gap-sm">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => handleEmailChange(i, e.target.value)}
                    placeholder="student@school.edu"
                    className="hf-input hf-flex-1"
                  />
                  {emails.length > 1 && (
                    <button onClick={() => handleRemoveEmail(i)} className="hf-btn-icon-error">
                      <Trash2 className="hf-icon-sm" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={handleAddEmail} className="hf-link-accent hf-text-sm">
              <Plus className="hf-icon-sm" /> Add another email
            </button>
            <p className="hf-hint hf-mt-md">
              Invitations will be sent to these addresses. Students will create accounts when they join.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="hf-step-footer">
        <button onClick={onPrev} className="hf-btn hf-btn-ghost">Back</button>
        <div className="hf-flex hf-items-center hf-gap-sm">
          <button onClick={handleSkip} className="hf-btn hf-btn-ghost">Skip</button>
          <button onClick={handleNext} className="hf-btn hf-btn-primary">
            {totalSelected > 0 ? `Next (${totalSelected})` : 'Next'} <ArrowRight className="hf-icon-sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
