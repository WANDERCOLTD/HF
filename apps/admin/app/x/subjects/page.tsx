'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { BookOpen, Plus } from 'lucide-react';
import { useTerminology } from '@/contexts/TerminologyContext';
import { FancySelect } from '@/components/shared/FancySelect';
import { DomainPill } from '@/src/components/shared/EntityPill';
import { AdvancedBanner } from '@/components/shared/AdvancedBanner';
import { TrustBadge, TRUST_LEVELS } from '@/app/x/content-sources/_components/shared/badges';
import SubjectDetail from './_components/SubjectDetail';
import SubjectCreateModal from './_components/SubjectCreateModal';

type Subject = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultTrustLevel: string;
  qualificationBody: string | null;
  qualificationRef: string | null;
  qualificationLevel: string | null;
  isActive: boolean;
  _count: { sources: number; domains: number; curricula: number };
  domains: Array<{ domain: { id: string; name: string; slug: string } }>;
  lessonPlanSessions: number;
};

type Domain = { id: string; slug: string; name: string };

const trustFilterColors: Record<string, { bg: string; text: string }> = {
  REGULATORY_STANDARD: { bg: 'var(--trust-l5-bg)', text: 'var(--trust-l5-text)' },
  ACCREDITED_MATERIAL: { bg: 'var(--trust-l4-bg)', text: 'var(--trust-l4-text)' },
  PUBLISHED_REFERENCE: { bg: 'var(--trust-l3-bg)', text: 'var(--trust-l3-text)' },
  EXPERT_CURATED: { bg: 'var(--trust-l2-bg)', text: 'var(--trust-l2-text)' },
  AI_ASSISTED: { bg: 'var(--trust-l1-bg)', text: 'var(--trust-l1-text)' },
  UNVERIFIED: { bg: 'var(--trust-l0-bg)', text: 'var(--trust-l0-text)' },
};

const TRUST_PILLS = [
  { value: 'REGULATORY_STANDARD', label: 'L5' },
  { value: 'ACCREDITED_MATERIAL', label: 'L4' },
  { value: 'PUBLISHED_REFERENCE', label: 'L3' },
  { value: 'EXPERT_CURATED', label: 'L2' },
  { value: 'AI_ASSISTED', label: 'L1' },
  { value: 'UNVERIFIED', label: 'L0' },
];

export default function SubjectsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id');
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');
  const { terms, plural } = useTerminology();

  // List state
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedTrustLevels, setSelectedTrustLevels] = useState<Set<string>>(new Set());
  const [selectedDomain, setSelectedDomain] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadSubjects = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/subjects');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSubjects(data.subjects || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubjects();
    fetch('/api/domains')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setDomains(data.domains || []);
      })
      .catch((e) => console.warn('[Subjects] Failed to load domains:', e));
  }, []);

  // Filter subjects
  const filteredSubjects = useMemo(() => {
    return subjects.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        const matches =
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.qualificationBody?.toLowerCase().includes(q) ||
          s.qualificationLevel?.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (selectedTrustLevels.size > 0 && !selectedTrustLevels.has(s.defaultTrustLevel)) return false;
      if (selectedDomain && !s.domains.some((d) => d.domain.id === selectedDomain)) return false;
      return true;
    });
  }, [subjects, search, selectedTrustLevels, selectedDomain]);

  const selectSubject = (id: string) => {
    router.push(`/x/subjects?id=${id}`, { scroll: false });
  };

  const toggleTrustLevel = (level: string) => {
    setSelectedTrustLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const FilterPill = ({
    label, isActive, colors, onClick,
  }: {
    label: string; isActive: boolean; colors: { bg: string; text: string }; onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className="hf-filter-pill"
      style={isActive ? {
        border: `1px solid color-mix(in srgb, ${colors.text} 25%, transparent)`,
        background: colors.bg,
        color: colors.text,
      } : undefined}
    >
      {label}
    </button>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AdvancedBanner />

      {/* Header + Filters */}
      <div className="hf-card-compact hf-mb-md" style={{ borderRadius: 8, position: 'relative', zIndex: 2 }}>
        <div className="hf-flex hf-flex-between" style={{ marginBottom: 10 }}>
          <h1 className="hf-section-title">Subjects</h1>
          {isOperator && (
            <button onClick={() => setShowCreateModal(true)} className="hf-btn-sm hf-btn-primary">
              <Plus size={14} style={{ marginRight: 4 }} />
              New Subject
            </button>
          )}
        </div>

        <div className="hf-flex hf-flex-wrap hf-gap-lg hf-items-center">
          {/* Search */}
          <input
            type="text"
            placeholder="Search subjects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="hf-input"
            style={{ padding: '6px 10px', borderRadius: 6, width: 180, fontSize: 12, borderColor: 'var(--border-strong)' }}
          />

          <div className="hf-divider-v" />

          {/* Trust Level Pills */}
          <div className="hf-flex hf-gap-sm hf-items-center">
            <span className="hf-text-xs hf-text-muted hf-text-bold">Trust</span>
            {selectedTrustLevels.size > 0 && (
              <button onClick={() => setSelectedTrustLevels(new Set())} className="hf-clear-btn" title="Clear filter">&times;</button>
            )}
            <div className="hf-flex hf-gap-xs">
              {TRUST_PILLS.map((pill) => (
                <FilterPill
                  key={pill.value}
                  label={pill.label}
                  isActive={selectedTrustLevels.has(pill.value)}
                  colors={trustFilterColors[pill.value]}
                  onClick={() => toggleTrustLevel(pill.value)}
                />
              ))}
            </div>
          </div>

          {/* Domain Filter */}
          {domains.length > 1 && (
            <>
              <div className="hf-divider-v" />
              <div className="hf-flex hf-gap-sm hf-items-center">
                <span className="hf-text-xs hf-text-muted hf-text-bold">{terms.domain}</span>
                <FancySelect
                  value={selectedDomain}
                  onChange={setSelectedDomain}
                  placeholder={`All ${plural('domain').toLowerCase()}`}
                  clearable
                  options={domains.map((d) => ({ value: d.id, label: d.name }))}
                  style={{ width: 180 }}
                />
              </div>
            </>
          )}

          {/* Results count */}
          <span className="hf-text-xs hf-text-muted hf-text-bold">
            {filteredSubjects.length} of {subjects.length}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="hf-banner hf-banner-error hf-mb-md" style={{ borderRadius: 8 }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hf-text-xs" style={{ marginLeft: 'auto', textDecoration: 'underline', color: 'inherit' }}>Dismiss</button>
        </div>
      )}

      {/* Master-Detail Layout */}
      <div className="hf-flex hf-gap-lg hf-flex-1" style={{ minHeight: 0, overflow: 'hidden', alignItems: 'stretch' }}>
        {/* List Panel */}
        <div className="hf-master-list">
          {loading ? (
            <div className="hf-text-center hf-text-muted" style={{ padding: 40 }}>
              <div className="hf-spinner" />
            </div>
          ) : filteredSubjects.length === 0 ? (
            <div className="hf-empty-compact" style={{ border: '1px solid var(--border-default)', borderRadius: 12 }}>
              <div style={{ fontSize: 48 }} className="hf-mb-md">
                <BookOpen size={48} style={{ color: 'var(--text-tertiary)' }} />
              </div>
              <div className="hf-heading-lg hf-text-secondary hf-mb-md">
                {search || selectedTrustLevels.size > 0 || selectedDomain
                  ? 'No subjects match filters'
                  : 'No subjects yet'}
              </div>
              {isOperator && !search && selectedTrustLevels.size === 0 && !selectedDomain && (
                <button onClick={() => setShowCreateModal(true)} className="hf-btn hf-btn-primary">
                  <Plus size={14} style={{ marginRight: 4 }} />
                  Create First Subject
                </button>
              )}
            </div>
          ) : (
            <div className="hf-flex-col hf-gap-sm">
              {filteredSubjects.map((subject) => (
                <div
                  key={subject.id}
                  onClick={() => selectSubject(subject.id)}
                  className={`hf-master-item${selectedId === subject.id ? ' hf-master-item-selected' : ''}${!subject.isActive ? ' hf-master-item-inactive' : ''}`}
                >
                  <div className="hf-flex hf-gap-sm hf-mb-sm hf-items-center">
                    <h3 className="hf-heading-sm hf-mb-0" style={{ flex: 1 }}>{subject.name}</h3>
                    <TrustBadge level={subject.defaultTrustLevel} />
                  </div>
                  {subject.qualificationLevel && (
                    <p className="hf-text-xs hf-text-muted" style={{ margin: '0 0 6px' }}>
                      {subject.qualificationLevel}
                      {subject.qualificationBody && ` \u2014 ${subject.qualificationBody}`}
                    </p>
                  )}
                  {subject.domains.length > 0 && (
                    <div className="hf-flex hf-flex-wrap hf-gap-xs hf-mb-sm">
                      {subject.domains.map((d) => (
                        <DomainPill key={d.domain.id} label={d.domain.name} size="compact" />
                      ))}
                    </div>
                  )}
                  <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted hf-items-center">
                    <span><strong>{subject._count.sources}</strong> sources</span>
                    <span><strong>{subject._count.curricula}</strong> curricula</span>
                    {subject.lessonPlanSessions > 0 && (
                      <span><strong>{subject.lessonPlanSessions}</strong> sessions</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className="hf-master-detail-right">
          {!selectedId ? (
            <div className="hf-flex-center hf-text-placeholder" style={{ height: '100%' }}>
              <div className="hf-text-center">
                <BookOpen size={48} style={{ color: 'var(--text-tertiary)', marginBottom: 12 }} />
                <div className="hf-text-md">Select a subject to view details</div>
              </div>
            </div>
          ) : (
            <SubjectDetail
              subjectId={selectedId}
              onSubjectUpdated={loadSubjects}
              isOperator={isOperator}
            />
          )}
        </div>
      </div>

      {/* Create Modal */}
      <SubjectCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(id) => {
          setShowCreateModal(false);
          loadSubjects();
          router.push(`/x/subjects?id=${id}`, { scroll: false });
        }}
      />
    </div>
  );
}
