'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, BookMarked, Plus, FileText, ExternalLink } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTerminology } from '@/contexts/TerminologyContext';
import { useEntityContext } from '@/contexts/EntityContext';
import { EditableTitle } from '@/components/shared/EditableTitle';
import { StatusBadge, DomainPill } from '@/src/components/shared/EntityPill';
import { TrustBadge } from '@/app/x/content-sources/_components/shared/badges';
import { HierarchyBreadcrumb } from '@/components/shared/HierarchyBreadcrumb';

type Domain = { id: string; name: string; slug: string };

type PlaybookDetail = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  domain: Domain;
  items: Array<{
    id: string;
    itemType: string;
    isEnabled: boolean;
    sortOrder: number;
    spec: {
      id: string;
      slug: string;
      name: string;
      scope: string;
      outputType: string;
      specRole: string | null;
    } | null;
  }>;
  _count: { items: number };
};

type SubjectSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultTrustLevel: string;
  sourceCount: number;
  curriculumCount: number;
  assertionCount: number;
};

const statusMap: Record<string, 'draft' | 'active' | 'archived'> = {
  draft: 'draft',
  published: 'active',
  archived: 'archived',
};

const outputTypeColors: Record<string, { bg: string; text: string }> = {
  LEARN: { bg: 'var(--badge-violet-bg)', text: 'var(--badge-violet-text)' },
  MEASURE: { bg: 'var(--badge-green-bg)', text: 'var(--badge-green-text)' },
  ADAPT: { bg: 'var(--badge-yellow-bg)', text: 'var(--badge-yellow-text)' },
  COMPOSE: { bg: 'var(--badge-pink-bg)', text: 'var(--badge-pink-text)' },
  AGGREGATE: { bg: 'var(--badge-indigo-bg)', text: 'var(--badge-indigo-text)' },
  REWARD: { bg: 'var(--badge-amber-bg)', text: 'var(--badge-amber-text)' },
};

export default function CourseDetailPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');
  const { terms, plural } = useTerminology();
  const { pushEntity } = useEntityContext();

  const [detail, setDetail] = useState<PlaybookDetail | null>(null);
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'subjects' | 'configuration' | 'settings'>('subjects');

  // Actions state
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/playbooks/${courseId}`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/subjects`).then((r) => r.json()),
    ])
      .then(([pbData, subData]) => {
        if (pbData.ok) {
          setDetail(pbData.playbook);
          pushEntity({
            type: 'playbook',
            id: pbData.playbook.id,
            label: pbData.playbook.name,
            href: `/x/courses/${pbData.playbook.id}`,
          });
        } else {
          setError(pbData.error || 'Course not found');
        }
        if (subData.ok) {
          setSubjects(subData.subjects || []);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePublish = async () => {
    if (!detail) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) setDetail(data.playbook);
      else setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const handleArchive = async () => {
    if (!detail) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ARCHIVED' }),
      });
      const data = await res.json();
      if (data.ok) setDetail((prev) => prev ? { ...prev, status: 'ARCHIVED' } : prev);
      else setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed');
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async () => {
    if (!detail) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DRAFT' }),
      });
      const data = await res.json();
      if (data.ok) setDetail((prev) => prev ? { ...prev, status: 'DRAFT' } : prev);
      else setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setArchiving(false);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        router.push('/x/courses');
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div className="hf-text-center hf-text-muted" style={{ padding: 80 }}>
          <div className="hf-spinner" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={{ padding: 24 }}>
        <HierarchyBreadcrumb
          segments={[{ label: plural('playbook'), href: '/x/courses' }]}
        />
        <div className="hf-banner hf-banner-error" style={{ borderRadius: 8 }}>
          {error || 'Course not found'}
        </div>
      </div>
    );
  }

  // Group detail items by scope for Configuration tab
  const groupedItems = detail.items.reduce<Record<string, PlaybookDetail['items']>>((acc, item) => {
    if (!item.spec) return acc;
    const scope = item.spec.scope || 'OTHER';
    if (!acc[scope]) acc[scope] = [];
    acc[scope].push(item);
    return acc;
  }, {});

  const tabs = [
    { id: 'subjects' as const, label: `${plural('playbook') === 'Courses' ? 'Subjects' : plural('playbook')}`, count: subjects.length },
    { id: 'configuration' as const, label: 'Configuration', count: detail._count.items },
    { id: 'settings' as const, label: 'Settings' },
  ];

  return (
    <div className="hf-page-container" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {/* Breadcrumb */}
      <HierarchyBreadcrumb
        segments={[
          { label: plural('playbook'), href: '/x/courses' },
          { label: detail.name, href: `/x/courses/${detail.id}` },
        ]}
      />

      {/* Header */}
      <div className="hf-flex hf-flex-between hf-items-start hf-mb-lg">
        <div>
          <div className="hf-flex hf-gap-md hf-items-center hf-mb-sm">
            <EditableTitle
              value={detail.name}
              as="h1"
              onSave={async (newName) => {
                const res = await fetch(`/api/playbooks/${detail.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: newName }),
                });
                const data = await res.json();
                if (!data.ok) throw new Error(data.error);
                setDetail((prev) => prev ? { ...prev, name: newName } : prev);
              }}
            />
            <StatusBadge status={statusMap[detail.status.toLowerCase()] || 'draft'} />
          </div>
          <div className="hf-flex hf-gap-sm hf-items-center">
            <DomainPill label={detail.domain.name} href={`/x/domains?id=${detail.domain.id}`} size="compact" />
            <span className="hf-text-xs hf-text-placeholder">v{detail.version}</span>
          </div>
        </div>
        <Link
          href={`/x/playbooks/${detail.id}`}
          className="hf-btn hf-btn-secondary hf-nowrap"
        >
          <ExternalLink size={14} />
          Open Editor
        </Link>
      </div>

      {detail.description && (
        <p className="hf-text-sm hf-text-muted hf-mb-lg" style={{ lineHeight: 1.6 }}>
          {detail.description}
        </p>
      )}

      {/* Stats row */}
      <div className="hf-flex hf-gap-lg hf-mb-lg">
        <div className="hf-stat-card hf-stat-card-compact">
          <div className="hf-stat-value-sm">{subjects.length}</div>
          <div className="hf-text-xs hf-text-muted">Subjects</div>
        </div>
        <div className="hf-stat-card hf-stat-card-compact">
          <div className="hf-stat-value-sm">{detail._count.items}</div>
          <div className="hf-text-xs hf-text-muted">Specs</div>
        </div>
        <div className="hf-stat-card hf-stat-card-compact">
          <div className="hf-stat-value-sm">{detail.items.filter((i) => i.isEnabled).length}</div>
          <div className="hf-text-xs hf-text-muted">Enabled</div>
        </div>
        {detail.publishedAt && (
          <div className="hf-stat-card hf-stat-card-compact">
            <div className="hf-text-sm hf-text-bold">{new Date(detail.publishedAt).toLocaleDateString()}</div>
            <div className="hf-text-xs hf-text-muted">Published</div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="hf-flex hf-gap-sm hf-mb-lg" style={{ borderBottom: '1px solid var(--border-default)' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`hf-tab${activeTab === tab.id ? ' hf-tab-active' : ''}`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="hf-text-xs hf-text-muted" style={{ marginLeft: 6 }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'subjects' && (
        <div>
          {subjects.length === 0 ? (
            <div className="hf-empty-compact" style={{ border: '1px solid var(--border-default)', borderRadius: 12 }}>
              <BookMarked size={36} style={{ color: 'var(--text-tertiary)', marginBottom: 12 }} />
              <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No subjects yet</div>
              <p className="hf-text-xs hf-text-muted">Subjects are created when you upload content or use the Course Setup wizard.</p>
            </div>
          ) : (
            <div className="hf-card-grid-md">
              {subjects.map((sub) => (
                <Link
                  key={sub.id}
                  href={`/x/courses/${courseId}/subjects/${sub.id}`}
                  className="hf-card-compact"
                  style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer', transition: 'border-color 0.15s' }}
                >
                  <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
                    <BookMarked size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    <h3 className="hf-heading-sm hf-mb-0" style={{ flex: 1 }}>{sub.name}</h3>
                    <TrustBadge level={sub.defaultTrustLevel} />
                  </div>
                  {sub.description && (
                    <p className="hf-text-xs hf-text-muted hf-mb-sm" style={{ lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {sub.description}
                    </p>
                  )}
                  <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted">
                    <span><FileText size={12} style={{ marginRight: 2, verticalAlign: -1 }} />{sub.sourceCount} sources</span>
                    <span>{sub.assertionCount} points</span>
                    {sub.curriculumCount > 0 && <span>{sub.curriculumCount} curricula</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'configuration' && (
        <div>
          {Object.keys(groupedItems).length === 0 ? (
            <div className="hf-empty-compact" style={{ border: '1px solid var(--border-default)', borderRadius: 12 }}>
              <div className="hf-text-sm hf-text-muted">No specs configured</div>
            </div>
          ) : (
            <div className="hf-flex-col hf-gap-lg">
              {Object.entries(groupedItems)
                .sort(([a], [b]) => {
                  const order = ['SYSTEM', 'DOMAIN', 'CALLER'];
                  return order.indexOf(a) - order.indexOf(b);
                })
                .map(([scope, items]) => (
                  <div key={scope}>
                    <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase hf-mb-sm">
                      {scope} ({items.length})
                    </div>
                    <div className="hf-card-grid">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--border-default)',
                            background: item.isEnabled ? 'var(--surface-primary)' : 'var(--surface-tertiary)',
                            opacity: item.isEnabled ? 1 : 0.6,
                          }}
                        >
                          <div className="hf-text-xs hf-text-bold" style={{ marginBottom: 4 }}>
                            {item.spec?.name}
                          </div>
                          <div className="hf-flex hf-gap-xs">
                            {item.spec?.outputType && (
                              <span
                                className="hf-text-xs"
                                style={{
                                  padding: '1px 6px',
                                  borderRadius: 3,
                                  background: outputTypeColors[item.spec.outputType]?.bg || 'var(--surface-secondary)',
                                  color: outputTypeColors[item.spec.outputType]?.text || 'var(--text-secondary)',
                                  fontSize: 10,
                                }}
                              >
                                {item.spec.outputType}
                              </span>
                            )}
                            {!item.isEnabled && (
                              <span className="hf-text-xs hf-text-muted" style={{ fontSize: 10 }}>OFF</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && isOperator && (
        <div>
          <div className="hf-flex hf-gap-sm hf-mb-lg hf-flex-wrap">
            {detail.status === 'DRAFT' && (
              <button onClick={handlePublish} disabled={publishing} className="hf-btn hf-btn-primary">
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
            )}
            {detail.status !== 'ARCHIVED' && (
              <button onClick={handleArchive} disabled={archiving} className="hf-btn hf-btn-secondary">
                {archiving ? 'Archiving...' : 'Archive'}
              </button>
            )}
            {detail.status === 'ARCHIVED' && (
              <button onClick={handleRestore} disabled={archiving} className="hf-btn hf-btn-secondary">
                {archiving ? 'Restoring...' : 'Restore'}
              </button>
            )}
            {detail.status === 'DRAFT' && (
              <>
                {!showDeleteConfirm ? (
                  <button onClick={() => setShowDeleteConfirm(true)} className="hf-btn hf-btn-destructive">
                    Delete
                  </button>
                ) : (
                  <div className="hf-flex hf-gap-xs hf-items-center">
                    <span className="hf-text-xs hf-text-error">Delete permanently?</span>
                    <button onClick={handleDelete} disabled={deleting} className="hf-btn-sm hf-btn-destructive">
                      {deleting ? '...' : 'Yes'}
                    </button>
                    <button onClick={() => setShowDeleteConfirm(false)} className="hf-btn-sm hf-btn-secondary">
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Metadata */}
          <div style={{ paddingTop: 16, borderTop: '1px solid var(--border-default)' }}>
            <div className="hf-flex hf-gap-lg hf-text-xs hf-text-muted">
              <span>ID: <span className="hf-mono">{detail.id.slice(0, 8)}...</span></span>
              <span>Created: {new Date(detail.createdAt).toLocaleDateString()}</span>
              <span>Updated: {new Date(detail.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
