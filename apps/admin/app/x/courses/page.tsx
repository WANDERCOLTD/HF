'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { BookOpen, Users, Plus, Trash2, X, BookMarked } from 'lucide-react';
import { useTerminology } from '@/contexts/TerminologyContext';
import { StatusBadge, DomainPill } from '@/src/components/shared/EntityPill';
import { FancySelect } from '@/components/shared/FancySelect';
import { AdvancedBanner } from '@/components/shared/AdvancedBanner';
import { getAudienceOption } from '@/lib/prompt/composition/transforms/audience';
import { TEACHING_PROFILES, type TeachingProfileKey } from '@/lib/content-trust/teaching-profiles';
import { INTERACTION_PATTERN_LABELS, type InteractionPattern } from '@/lib/content-trust/resolve-config';

type Domain = { id: string; name: string };
type Group = { id: string; name: string; groupType: string };

type SubjectRef = { id: string; name: string };

type ContentStats = {
  totalTPs: number;
  sourceCount: number;
  docTypes: string[];
  categories: Record<string, number>;
};

type CourseListItem = {
  id: string;
  name: string;
  description: string | null;
  domain: Domain;
  group: Group | null;
  subjects: SubjectRef[];
  studentCount: number;
  specCount: number;
  status: string;
  version: string;
  createdAt: string;
  audience: string | null;
  learningStructure: 'structured' | 'continuous' | null;
  teachingProfile: string | null;
  contentStats: ContentStats | null;
};

const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;

const statusColors: Record<string, { bg: string; text: string; icon: string; desc: string }> = {
  DRAFT: { bg: 'var(--status-warning-bg)', text: 'var(--status-warning-text)', icon: '\u{1F4DD}', desc: 'Work in progress' },
  PUBLISHED: { bg: 'var(--status-success-bg)', text: 'var(--status-success-text)', icon: '\u2705', desc: 'Active and in use' },
  ARCHIVED: { bg: 'var(--status-neutral-bg)', text: 'var(--status-neutral-text)', icon: '\u{1F4E6}', desc: 'No longer active' },
};

const statusMap: Record<string, 'draft' | 'active' | 'archived'> = {
  draft: 'draft',
  published: 'active',
  archived: 'archived',
};

// ── Insight Badges ─────────────────────────────────────

/** Compact icon + label badge with tooltip, used on course cards */
function InsightBadge({ icon, label, tooltip }: { icon: string; label: string; tooltip: string }) {
  return (
    <span className="hf-insight-badge" title={tooltip}>
      <span className="hf-insight-badge-icon">{icon}</span>
      {label}
    </span>
  );
}

/** Instruction-category labels for insight display */
const INSTRUCTION_CATEGORY_LABELS: Record<string, { label: string; plural: string; icon: string }> = {
  skill_framework: { label: 'skill', plural: 'skills', icon: '🎯' },
  teaching_rule: { label: 'principle', plural: 'principles', icon: '📐' },
  edge_case: { label: 'edge case', plural: 'edge cases', icon: '⚡' },
};

function CourseInsightBadges({ course }: { course: CourseListItem }) {
  const badges: { icon: string; label: string; tooltip: string }[] = [];

  // Learning structure — only show when Continuous (Structured is the default, keep cards uncluttered)
  if (course.learningStructure === 'continuous') {
    badges.push({
      icon: '♾️',
      label: 'Continuous',
      tooltip: 'Continuous Learning — all material in one programme; the system picks teaching points per call based on mastery.',
    });
  }

  // Teaching profile → interaction pattern
  if (course.teachingProfile) {
    const profile = TEACHING_PROFILES[course.teachingProfile as TeachingProfileKey];
    if (profile) {
      const patternInfo = INTERACTION_PATTERN_LABELS[profile.interactionPattern as InteractionPattern];
      if (patternInfo) {
        badges.push({ icon: patternInfo.icon, label: patternInfo.label, tooltip: patternInfo.description });
      }
    }
  }

  // Audience
  if (course.audience) {
    const opt = getAudienceOption(course.audience);
    if (opt) {
      badges.push({ icon: '👤', label: opt.ages, tooltip: `${opt.label} — ${opt.description}` });
    }
  }

  // Teaching mode from profile
  if (course.teachingProfile) {
    const profile = TEACHING_PROFILES[course.teachingProfile as TeachingProfileKey];
    if (profile) {
      // Use a short label from the profile key (e.g. "comprehension-led" → "Comprehension")
      const modeLabel = course.teachingProfile.replace(/-led$/, '');
      badges.push({
        icon: '📖',
        label: modeLabel.charAt(0).toUpperCase() + modeLabel.slice(1),
        tooltip: profile.description,
      });
    }
  }

  // Doc types
  const stats = course.contentStats;
  if (stats?.docTypes?.length) {
    const docTypeLabels: Record<string, string> = {
      COURSE_REFERENCE: 'Teaching Guide',
      TEXTBOOK: 'Textbook',
      READING_PASSAGE: 'Reading',
      WORKSHEET: 'Worksheet',
      CURRICULUM: 'Curriculum',
      QUESTION_BANK: 'Questions',
      ASSESSMENT: 'Assessment',
      LESSON_PLAN: 'Lesson Plan',
      COMPREHENSION: 'Comprehension',
    };
    for (const dt of stats.docTypes) {
      const label = docTypeLabels[dt];
      if (label) {
        badges.push({ icon: '📄', label, tooltip: `Content type: ${label}` });
      }
    }
  }

  // Instruction category counts (skills, principles, edge cases)
  if (stats?.categories) {
    for (const [cat, config] of Object.entries(INSTRUCTION_CATEGORY_LABELS)) {
      const count = stats.categories[cat];
      if (count && count > 0) {
        badges.push({
          icon: config.icon,
          label: `${count} ${count === 1 ? config.label : config.plural}`,
          tooltip: `${count} ${config.plural} extracted from content`,
        });
      }
    }
  }

  if (badges.length === 0) return null;

  return (
    <div className="hf-flex hf-gap-xs hf-mb-sm hf-flex-wrap">
      {badges.map((b, i) => (
        <InsightBadge key={i} icon={b.icon} label={b.label} tooltip={b.tooltip} />
      ))}
    </div>
  );
}

function CourseCard({ course, plural, deleteMode, selected, onToggle, onArchive }: {
  course: CourseListItem;
  plural: (k: string) => string;
  deleteMode?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
  onArchive?: (id: string) => void;
}) {
  const isPublished = course.status === 'PUBLISHED' || course.status === 'published';
  const canDelete = !isPublished;
  const stats = course.contentStats || { totalTPs: 0, sourceCount: 0, docTypes: [], categories: {} };
  const cardContent = (
    <>
      <div className="hf-flex hf-flex-between hf-items-start hf-mb-sm">
        {deleteMode && canDelete && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle?.(course.id)}
            className="hf-checkbox hf-mr-sm"
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <h3 className="hf-heading-sm hf-mb-0 hf-flex-1">{course.name}</h3>
        <StatusBadge status={statusMap[course.status] || 'draft'} size="compact" />
      </div>
      <div className="hf-flex hf-gap-xs hf-mb-sm hf-flex-wrap">
        <DomainPill label={course.domain.name} size="compact" />
        {course.group && (
          <span className="hf-pill hf-pill-neutral">{course.group.name}</span>
        )}
      </div>
      {course.description && (
        <p className="hf-text-xs hf-text-muted hf-mb-sm hf-line-clamp-2">{course.description}</p>
      )}
      <CourseInsightBadges course={course} />
      <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted hf-items-center">
        <span><Users size={12} className="hf-icon-inline" /><strong>{course.studentCount}</strong> {plural('caller').toLowerCase()}</span>
        {stats.totalTPs > 0 && (
          <span><BookMarked size={12} className="hf-icon-inline" /><strong>{stats.totalTPs}</strong> TPs</span>
        )}
      </div>
      {deleteMode && !canDelete && (
        <div className="hf-flex hf-flex-end hf-mt-sm">
          <button
            className="hf-btn hf-btn-xs hf-btn-secondary"
            onClick={(e) => { e.stopPropagation(); onArchive?.(course.id); }}
          >
            Archive first
          </button>
        </div>
      )}
    </>
  );

  if (deleteMode) {
    return (
      <div
        className={`hf-card-compact${course.status === 'archived' ? ' hf-faded' : ''}${selected ? ' hf-card-selected' : ''}`}
        onClick={() => canDelete && onToggle?.(course.id)}
        style={canDelete ? { cursor: 'pointer' } : undefined}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <Link
      href={`/x/courses/${course.id}`}
      className={`hf-card-compact hf-card-link${course.status === 'archived' ? ' hf-faded' : ''}`}
    >
      {cardContent}
    </Link>
  );
}

export default function CoursesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');
  const { terms, plural, lower } = useTerminology();

  // Redirect ?id=xxx to /x/courses/xxx and ?action=setup to /x/courses/new
  const legacyId = searchParams.get('id');
  const actionParam = searchParams.get('action');
  useEffect(() => {
    if (legacyId) {
      router.replace(`/x/courses/${legacyId}`);
    } else if (actionParam === 'setup') {
      router.replace('/x/courses/new');
    }
  }, [legacyId, actionParam, router]);

  // List state
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set());
  const [selectedDomain, setSelectedDomain] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'department' | 'domain' | 'subject'>('none');
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadCourses = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/courses');
      if (!res.ok) throw new Error('Failed to load courses');
      const data = await res.json();
      setCourses(data.courses || []);
      setDomains(data.domains || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!legacyId && actionParam !== 'setup') loadCourses();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyId, actionParam]);

  // Derive unique groups from courses
  const availableGroups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const c of courses) {
      if (c.group) map.set(c.group.id, c.group);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [courses]);

  // Filter courses (client-side)
  const filteredCourses = useMemo(() => {
    return courses.filter((c) => {
      if (search) {
        const s = search.toLowerCase();
        const matchesSearch = c.name.toLowerCase().includes(s) || c.description?.toLowerCase().includes(s) || c.domain.name.toLowerCase().includes(s) || c.group?.name.toLowerCase().includes(s);
        if (!matchesSearch) return false;
      }
      if (selectedStatuses.size > 0 && !selectedStatuses.has(c.status.toUpperCase())) return false;
      if (selectedDomain && selectedDomain !== c.domain.id) return false;
      if (selectedGroup && c.group?.id !== selectedGroup) return false;
      return true;
    });
  }, [courses, search, selectedStatuses, selectedDomain, selectedGroup]);

  // Group courses by domain or department
  const groupedCourses = useMemo(() => {
    if (groupBy === 'none') return null;

    if (groupBy === 'domain') {
      const byDomain = new Map<string, CourseListItem[]>();
      for (const c of filteredCourses) {
        const arr = byDomain.get(c.domain.id) || [];
        arr.push(c);
        byDomain.set(c.domain.id, arr);
      }
      return Array.from(byDomain.values())
        .sort((a, b) => a[0].domain.name.localeCompare(b[0].domain.name))
        .map((items) => ({ label: items[0].domain.name, courses: items }));
    }

    if (groupBy === 'subject') {
      const bySubject = new Map<string, CourseListItem[]>();
      const noSubject: CourseListItem[] = [];
      for (const c of filteredCourses) {
        if (c.subjects?.length > 0) {
          // A course can have multiple subjects — put it in each bucket
          for (const s of c.subjects) {
            const arr = bySubject.get(s.id) || [];
            arr.push(c);
            bySubject.set(s.id, arr);
          }
        } else {
          noSubject.push(c);
        }
      }
      const groups = Array.from(bySubject.values())
        .sort((a, b) => (a[0].subjects[0]?.name || '').localeCompare(b[0].subjects[0]?.name || ''))
        .map((items) => ({ label: items[0].subjects[0]?.name || 'Unknown', courses: items }));
      if (noSubject.length > 0) groups.push({ label: 'No ' + lower('knowledge_area'), courses: noSubject });
      return groups;
    }

    // groupBy === 'department'
    const groups: { label: string; courses: CourseListItem[] }[] = [];
    const byGroup = new Map<string, CourseListItem[]>();
    const ungrouped: CourseListItem[] = [];

    for (const c of filteredCourses) {
      if (c.group) {
        const arr = byGroup.get(c.group.id) || [];
        arr.push(c);
        byGroup.set(c.group.id, arr);
      } else {
        ungrouped.push(c);
      }
    }

    const sortedEntries = Array.from(byGroup.entries()).sort((a, b) => {
      const nameA = a[1][0]?.group?.name || '';
      const nameB = b[1][0]?.group?.name || '';
      return nameA.localeCompare(nameB);
    });

    for (const [, items] of sortedEntries) {
      groups.push({ label: items[0].group!.name, courses: items });
    }
    if (ungrouped.length > 0) {
      groups.push({ label: 'Ungrouped', courses: ungrouped });
    }

    return groups;
  }, [filteredCourses, groupBy, lower]);

  const toggleStatus = (status: string) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleArchive = async (id: string) => {
    try {
      const res = await fetch(`/api/playbooks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ARCHIVED' }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error || 'Failed to archive');
        return;
      }
      await loadCourses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive');
    }
  };

  const handleDeleteSelected = async () => {
    setDeleting(true);
    try {
      const results = await Promise.all(
        Array.from(selectedIds).map(async (id) => {
          const res = await fetch(`/api/playbooks/${id}`, { method: 'DELETE' });
          const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
          return { id, ok: res.ok && body.ok, error: body.error };
        })
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        const reasons = [...new Set(failed.map((f) => f.error).filter(Boolean))];
        setError(`${failed.length} of ${selectedIds.size} deletes failed${reasons.length ? ': ' + reasons.join('; ') : ''}`);
      }
      setSelectedIds(new Set());
      setDeleteMode(false);
      setShowDeleteConfirm(false);
      await loadCourses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const exitDeleteMode = () => {
    setDeleteMode(false);
    setSelectedIds(new Set());
    setShowDeleteConfirm(false);
  };

  // Redirect in progress
  if (legacyId || actionParam === 'setup') return (
    <div className="hf-empty-compact">
      <div className="hf-spinner" />
    </div>
  );

  const FilterPill = ({
    label, isActive, colors, onClick, icon, tooltip,
  }: {
    label: string; isActive: boolean; colors: { bg: string; text: string }; onClick: () => void; icon?: string; tooltip?: string;
  }) => (
    <button
      onClick={onClick}
      title={tooltip}
      className="hf-filter-pill"
      style={isActive ? {
        border: `1px solid color-mix(in srgb, ${colors.text} 25%, transparent)`,
        background: colors.bg,
        color: colors.text,
      } : undefined}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );

  return (
    <div className="hf-page-container hf-page-wide hf-page-scroll hf-flex-col">
      <AdvancedBanner />

      {/* Header + Filters */}
      <div className="hf-flex hf-flex-between hf-mb-lg hf-items-start">
        <div>
          <h1 className="hf-page-title hf-mb-xs">{plural('playbook')}</h1>
          <p className="hf-page-subtitle">Manage your {plural('playbook').toLowerCase()} and track {plural('caller').toLowerCase()} progress</p>
        </div>
        {isOperator && (
          <div className="hf-flex hf-gap-sm">
            {deleteMode ? (
              <button onClick={exitDeleteMode} className="hf-btn hf-btn-secondary">
                <X size={16} />
                Cancel
              </button>
            ) : (
              <>
                {courses.length > 0 && (
                  <button onClick={() => setDeleteMode(true)} className="hf-btn hf-btn-secondary">
                    <Trash2 size={16} />
                    Delete
                  </button>
                )}
                <Link href="/x/courses/new" className="hf-btn hf-btn-primary">
                  <Plus size={16} />
                  New {terms.playbook}
                </Link>
              </>
            )}
          </div>
        )}
      </div>

      <div className="hf-card-compact hf-mb-lg">
        <div className="hf-flex hf-flex-wrap hf-gap-lg hf-items-center">
          {/* Search */}
          <input
            type="text"
            placeholder={`Search ${plural('playbook').toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="hf-input hf-input-sm"
          />

          <div className="hf-divider-v" />

          {/* Status Pills */}
          <div className="hf-flex hf-gap-sm hf-items-center">
            <span className="hf-text-xs hf-text-muted hf-text-bold">Status</span>
            {selectedStatuses.size > 0 && (
              <button onClick={() => setSelectedStatuses(new Set())} className="hf-clear-btn" title="Clear filter">&times;</button>
            )}
            <div className="hf-flex hf-gap-xs">
              {STATUSES.map((status) => {
                const config = statusColors[status];
                return (
                  <FilterPill
                    key={status}
                    label={status}
                    icon={config.icon}
                    tooltip={config.desc}
                    isActive={selectedStatuses.has(status)}
                    colors={config}
                    onClick={() => toggleStatus(status)}
                  />
                );
              })}
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

          {/* Department Filter */}
          {availableGroups.length > 0 && (
            <>
              <div className="hf-divider-v" />
              <div className="hf-flex hf-gap-sm hf-items-center">
                <span className="hf-text-xs hf-text-muted hf-text-bold">{terms.group || 'Department'}</span>
                <FancySelect
                  value={selectedGroup}
                  onChange={setSelectedGroup}
                  placeholder={`All`}
                  clearable
                  options={availableGroups.map((g) => ({ value: g.id, label: g.name }))}
                  style={{ width: 160 }}
                />
              </div>
            </>
          )}

          {/* Group-by Toggle */}
          {(availableGroups.length > 0 || domains.length > 1 || courses.some((c) => c.subjects?.length > 0)) && (
            <>
              <div className="hf-divider-v" />
              <div className="hf-flex hf-gap-sm hf-items-center">
                <span className="hf-text-xs hf-text-muted hf-text-bold">Group by</span>
                <FancySelect
                  value={groupBy}
                  onChange={(v) => setGroupBy(v as 'none' | 'department' | 'domain' | 'subject')}
                  options={[
                    { value: 'none', label: 'None' },
                    ...(domains.length > 1 ? [{ value: 'domain', label: terms.domain }] : []),
                    ...(availableGroups.length > 0 ? [{ value: 'department', label: terms.group || 'Department' }] : []),
                    ...(courses.some((c) => c.subjects?.length > 0) ? [{ value: 'subject', label: terms.knowledge_area || 'Knowledge Area' }] : []),
                  ]}
                  style={{ width: 180 }}
                />
              </div>
            </>
          )}

          {/* Results count */}
          <span className="hf-text-xs hf-text-muted hf-text-bold">
            {filteredCourses.length} of {courses.length}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="hf-banner hf-banner-error hf-mb-md">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hf-text-xs hf-ml-auto hf-link-subtle">Dismiss</button>
        </div>
      )}


      {/* Delete Action Bar */}
      {deleteMode && (
        <div className="hf-banner hf-banner-warning hf-mb-md hf-flex hf-flex-between hf-items-center">
          <span className="hf-text-sm hf-text-bold">
            {selectedIds.size === 0
              ? `Select ${plural('playbook').toLowerCase()} to delete`
              : `${selectedIds.size} selected`}
          </span>
          <div className="hf-flex hf-gap-sm">
            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={selectedIds.size === 0}
                className="hf-btn hf-btn-sm hf-btn-destructive"
              >
                <Trash2 size={14} />
                Delete Selected
              </button>
            ) : (
              <>
                <span className="hf-text-sm hf-text-error hf-text-bold">
                  Permanently delete {selectedIds.size} {selectedIds.size === 1 ? terms.playbook.toLowerCase() : plural('playbook').toLowerCase()}?
                </span>
                <button onClick={() => setShowDeleteConfirm(false)} className="hf-btn hf-btn-sm hf-btn-secondary">
                  No, keep
                </button>
                <button onClick={handleDeleteSelected} disabled={deleting} className="hf-btn hf-btn-sm hf-btn-destructive">
                  {deleting ? 'Deleting...' : 'Yes, delete'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Course Cards Grid */}
      {loading ? (
        <div className="hf-card-grid-lg">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="hf-card-compact" style={{ pointerEvents: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div className="hf-skeleton hf-skeleton-text hf-skeleton-w-lg" />
                <div className="hf-skeleton hf-skeleton-badge" />
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <div className="hf-skeleton hf-skeleton-badge hf-skeleton-w-md" />
                <div className="hf-skeleton hf-skeleton-badge hf-skeleton-w-sm" />
              </div>
              <div className="hf-skeleton hf-skeleton-text-sm hf-skeleton-w-full" style={{ marginBottom: 4 }} />
              <div className="hf-skeleton hf-skeleton-text-sm hf-skeleton-w-md" />
            </div>
          ))}
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="hf-empty-compact">
          <div className="hf-mb-md">
            <BookOpen size={48} className="hf-text-tertiary" />
          </div>
          <div className="hf-heading-lg hf-text-secondary hf-mb-md">
            {search || selectedStatuses.size > 0 || selectedDomain
              ? `No ${plural('playbook').toLowerCase()} match filters`
              : `No ${plural('playbook').toLowerCase()} yet`}
          </div>
          {isOperator && !search && selectedStatuses.size === 0 && !selectedDomain && (
            <Link href="/x/courses/new" className="hf-btn hf-btn-primary">
              <Plus size={14} />
              Create First {terms.playbook}
            </Link>
          )}
        </div>
      ) : groupedCourses ? (
        /* Group-by department view */
        <div className="hf-flex-col hf-gap-lg">
          {groupedCourses.map((group) => (
            <div key={group.label}>
              <div className="hf-flex hf-items-center hf-gap-sm hf-mb-sm">
                <h2 className="hf-section-title hf-mb-0">{group.label}</h2>
                <span className="hf-badge hf-badge-neutral">{group.courses.length}</span>
              </div>
              <div className="hf-card-grid-lg">
                {group.courses.map((course) => (
                  <CourseCard key={course.id} course={course} plural={plural} deleteMode={deleteMode} selected={selectedIds.has(course.id)} onToggle={toggleSelected} onArchive={handleArchive} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Flat view */
        <div className="hf-card-grid-lg">
          {filteredCourses.map((course) => (
            <CourseCard key={course.id} course={course} plural={plural} deleteMode={deleteMode} selected={selectedIds.has(course.id)} onToggle={toggleSelected} onArchive={handleArchive} />
          ))}
        </div>
      )}
    </div>
  );
}
