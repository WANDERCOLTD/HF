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

  // If no domainId, only individual/email modes are available (groups need a domain)
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

  // Fetch cohorts — used by useEffect + Retry button
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
            id: c.id,
            name: c.name,
            memberCount: c._count?.members ?? c.memberCount ?? 0,
          }))
        );
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('[StudentsStep] Failed to load cohorts:', err);
      setCohortsError(err.message || 'Failed to load groups');
    } finally {
      if (!signal?.aborted) setCohortsLoading(false);
    }
  }, [domainId]);

  // Fetch callers — used by useEffect + Retry button
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
            id: c.id,
            name: c.name || c.email || 'Unknown',
            email: c.email || null,
          }))
        );
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('[StudentsStep] Failed to load callers:', err);
      setCallersError(err.message || 'Failed to load learners');
    } finally {
      if (!signal?.aborted) setCallersLoading(false);
    }
  }, []);

  // Load cohorts when group mode is selected
  useEffect(() => {
    if (mode !== 'group' || !domainId) return;
    const ac = new AbortController();
    fetchCohorts(ac.signal);
    return () => ac.abort();
  }, [mode, domainId, fetchCohorts]);

  // Load callers when individual mode is selected
  useEffect(() => {
    if (mode !== 'individual') return;
    const ac = new AbortController();
    fetchCallers(ac.signal);
    return () => ac.abort();
  }, [mode, fetchCallers]);

  // Email helpers
  const handleAddEmail = () => setEmails([...emails, '']);
  const handleEmailChange = (index: number, value: string) => {
    const next = [...emails];
    next[index] = value;
    setEmails(next);
  };
  const handleRemoveEmail = (index: number) => setEmails(emails.filter((_, i) => i !== index));

  // Cohort toggle
  const toggleCohort = (id: string) => {
    setSelectedCohortIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Caller toggle
  const toggleCaller = (id: string) => {
    setSelectedCallerIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Filtered callers for search
  const filteredCallers = callerSearch.trim()
    ? callers.filter(
        (c) =>
          c.name.toLowerCase().includes(callerSearch.toLowerCase()) ||
          (c.email && c.email.toLowerCase().includes(callerSearch.toLowerCase()))
      )
    : callers;

  // Save and advance
  const handleNext = () => {
    setData('cohortGroupIds', selectedCohortIds.length > 0 ? selectedCohortIds : undefined);
    setData('selectedCallerIds', selectedCallerIds.length > 0 ? selectedCallerIds : undefined);
    setData('studentEmails', emails.filter((e) => e.trim()));
    onNext();
  };

  // Skip
  const handleSkip = () => {
    setData('cohortGroupIds', undefined);
    setData('selectedCallerIds', undefined);
    setData('studentEmails', []);
    onNext();
  };

  // Count total selections across all modes
  const totalSelected =
    selectedCohortIds.length + selectedCallerIds.length + emails.filter((e) => e.trim()).length;

  const MODE_TABS: { id: EnrollMode; label: string; icon: React.ReactNode; requiresDomain: boolean }[] = [
    { id: 'group', label: 'Add a Group', icon: <Users className="w-4 h-4" />, requiresDomain: true },
    { id: 'individual', label: 'Pick Individuals', icon: <User className="w-4 h-4" />, requiresDomain: false },
    { id: 'email', label: 'Invite by Email', icon: <Mail className="w-4 h-4" />, requiresDomain: false },
  ];

  const availableTabs = hasDomain ? MODE_TABS : MODE_TABS.filter((t) => !t.requiresDomain);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-8 max-w-2xl mx-auto w-full">
        <div className="mb-6">
          <FieldHint label="Add Students" hint={WIZARD_HINTS["course.students"]} labelClass="text-3xl font-bold text-[var(--text-primary)] mb-2" />
          <p className="text-[var(--text-secondary)]">
            Enroll students now, or skip and add them later
          </p>
          <div className="hf-banner hf-banner-info" style={{ marginTop: 12 }}>
            <strong>WhatsApp Follow-ups:</strong> After each lesson, students receive a message on WhatsApp.
            Make sure students have provided phone numbers during enrollment.
          </div>
          {!hasDomain && (
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Group enrollment will be available after the course is created.
            </p>
          )}
        </div>

        {/* Mode tabs */}
        {availableTabs.length > 1 && (
          <div className="flex gap-2 mb-6">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === tab.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
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
              <div className="hf-banner hf-banner-error" style={{ marginBottom: 12 }}>
                {cohortsError}
                <button
                  onClick={() => fetchCohorts()}
                  className="ml-2 underline text-sm"
                >
                  Retry
                </button>
              </div>
            )}
            {cohortsLoading ? (
              <div className="flex items-center gap-2 text-[var(--text-muted)] py-8">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading groups...</span>
              </div>
            ) : cohorts.length === 0 && !cohortsError ? (
              <div className="text-center py-8">
                <Users className="w-10 h-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
                <p className="text-[var(--text-secondary)] text-sm">
                  No groups found for this institution.
                </p>
                <p className="text-[var(--text-muted)] text-xs mt-1">
                  Create a classroom first, or use another enrollment method.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {cohorts.map((cohort) => {
                  const selected = selectedCohortIds.includes(cohort.id);
                  return (
                    <button
                      key={cohort.id}
                      onClick={() => toggleCohort(cohort.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                        selected
                          ? 'border-[var(--accent)] bg-[var(--accent)] bg-opacity-5'
                          : 'border-[var(--border-default)] hover:border-[var(--border-subtle)]'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          selected
                            ? 'border-[var(--accent)] bg-[var(--accent)]'
                            : 'border-[var(--border-default)]'
                        }`}
                      >
                        {selected && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-[var(--text-primary)]">{cohort.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">
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
              <div className="hf-banner hf-banner-error" style={{ marginBottom: 12 }}>
                {callersError}
                <button
                  onClick={() => fetchCallers()}
                  className="ml-2 underline text-sm"
                >
                  Retry
                </button>
              </div>
            )}
            {/* Search */}
            <div className="relative mb-4">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
              />
              <input
                type="text"
                value={callerSearch}
                onChange={(e) => setCallerSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="w-full pl-10 pr-8 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              {callerSearch && (
                <button
                  onClick={() => setCallerSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  <X className="w-4 h-4 text-[var(--text-muted)]" />
                </button>
              )}
            </div>

            {/* Selected count */}
            {selectedCallerIds.length > 0 && (
              <div className="mb-3 text-sm text-[var(--text-secondary)]">
                {selectedCallerIds.length} selected
              </div>
            )}

            {callersLoading ? (
              <div className="flex items-center gap-2 text-[var(--text-muted)] py-8">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading learners...</span>
              </div>
            ) : filteredCallers.length === 0 ? (
              <div className="text-center py-8">
                <User className="w-10 h-10 mx-auto mb-3 text-[var(--text-tertiary)]" />
                <p className="text-[var(--text-secondary)] text-sm">
                  {callerSearch ? 'No learners match your search.' : 'No learners found.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[360px] overflow-y-auto">
                {filteredCallers.map((caller) => {
                  const selected = selectedCallerIds.includes(caller.id);
                  return (
                    <button
                      key={caller.id}
                      onClick={() => toggleCaller(caller.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all ${
                        selected
                          ? 'bg-[var(--accent)] bg-opacity-10'
                          : 'hover:bg-[var(--surface-secondary)]'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          selected
                            ? 'border-[var(--accent)] bg-[var(--accent)]'
                            : 'border-[var(--border-default)]'
                        }`}
                      >
                        {selected && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {caller.name}
                        </p>
                        {caller.email && (
                          <p className="text-xs text-[var(--text-muted)] truncate">{caller.email}</p>
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
            <div className="space-y-3 mb-4">
              {emails.map((email, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => handleEmailChange(i, e.target.value)}
                    placeholder="student@school.edu"
                    className="flex-1 px-4 py-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                  {emails.length > 1 && (
                    <button
                      onClick={() => handleRemoveEmail(i)}
                      className="p-2 rounded-lg"
                      style={{ color: "var(--status-error-text)" }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={handleAddEmail}
              className="flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
            >
              <Plus className="w-4 h-4" /> Add another email
            </button>
            <p className="text-xs text-[var(--text-tertiary)] mt-4">
              Invitations will be sent to these addresses. Students will create accounts when they join.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-6 border-t border-[var(--border-default)] bg-[var(--surface-secondary)] flex justify-between items-center">
        <button
          onClick={onPrev}
          className="px-6 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSkip}
            className="px-6 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Skip
          </button>
          <button
            onClick={handleNext}
            className="flex items-center gap-2 px-6 py-2 bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
          >
            {totalSelected > 0 ? `Next (${totalSelected})` : 'Next'} <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
