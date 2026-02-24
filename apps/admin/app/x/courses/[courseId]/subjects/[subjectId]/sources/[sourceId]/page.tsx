'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTerminology } from '@/contexts/TerminologyContext';
import { useEntityContext } from '@/contexts/EntityContext';
import { HierarchyBreadcrumb, type BreadcrumbSegment } from '@/components/shared/HierarchyBreadcrumb';
import { TrustBadge } from '@/app/x/content-sources/_components/shared/badges';
import { FileText, ExternalLink } from 'lucide-react';
import Link from 'next/link';

type SourceDetail = {
  id: string;
  name: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  trustLevel: string;
  documentType: string | null;
  status: string;
  assertionCount: number;
  createdAt: string;
  updatedAt: string;
};

export default function CourseSourceDetailPage() {
  const { courseId, subjectId, sourceId } = useParams<{
    courseId: string;
    subjectId: string;
    sourceId: string;
  }>();
  const { plural } = useTerminology();
  const { pushEntity } = useEntityContext();

  const [courseName, setCourseName] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState<string | null>(null);
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId || !subjectId || !sourceId) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/playbooks/${courseId}`).then((r) => r.json()),
      fetch(`/api/subjects/${subjectId}`).then((r) => r.json()),
      fetch(`/api/content-sources/${sourceId}`).then((r) => r.json()),
    ])
      .then(([pbData, subData, srcData]) => {
        if (pbData.ok) setCourseName(pbData.playbook.name);
        if (subData.ok || subData.subject) setSubjectName(subData.subject?.name || subData.name);
        if (srcData.ok || srcData.source) {
          const s = srcData.source || srcData;
          setSource({
            id: s.id,
            name: s.name,
            fileName: s.fileName,
            fileSize: s.fileSize,
            mimeType: s.mimeType,
            trustLevel: s.trustLevel,
            documentType: s.documentType,
            status: s.status,
            assertionCount: s._count?.assertions ?? s.assertionCount ?? 0,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          });
          pushEntity({
            type: 'source',
            id: s.id,
            label: s.name,
            href: `/x/courses/${courseId}/subjects/${subjectId}/sources/${sourceId}`,
          });
        } else {
          setError('Source not found');
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [courseId, subjectId, sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const segments: BreadcrumbSegment[] = [
    { label: plural('playbook'), href: '/x/courses' },
    { label: courseName || '', href: `/x/courses/${courseId}`, loading: !courseName },
    { label: subjectName || '', href: `/x/courses/${courseId}/subjects/${subjectId}`, loading: !subjectName },
    { label: source?.name || '', href: `/x/courses/${courseId}/subjects/${subjectId}/sources/${sourceId}`, loading: !source },
  ];

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <HierarchyBreadcrumb segments={segments} />
        <div className="hf-text-center hf-text-muted" style={{ padding: 80 }}>
          <div className="hf-spinner" />
        </div>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div style={{ padding: 24 }}>
        <HierarchyBreadcrumb segments={segments} />
        <div className="hf-banner hf-banner-error" style={{ borderRadius: 8 }}>
          {error || 'Source not found'}
        </div>
      </div>
    );
  }

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
      <HierarchyBreadcrumb segments={segments} />

      {/* Header */}
      <div className="hf-flex hf-flex-between hf-items-start hf-mb-lg">
        <div>
          <h1 className="hf-page-title hf-mb-sm">{source.name}</h1>
          <div className="hf-flex hf-gap-sm hf-items-center">
            <TrustBadge level={source.trustLevel} />
            {source.documentType && (
              <span className="hf-text-xs hf-text-muted">{source.documentType}</span>
            )}
          </div>
        </div>
        <Link
          href={`/x/content-sources/${sourceId}`}
          className="hf-btn hf-btn-secondary hf-nowrap"
        >
          <ExternalLink size={14} />
          Full Detail
        </Link>
      </div>

      {/* Info Card */}
      <div className="hf-card">
        <div className="hf-flex hf-gap-lg hf-flex-wrap">
          <div>
            <div className="hf-text-xs hf-text-muted hf-mb-xs">File</div>
            <div className="hf-text-sm hf-flex hf-gap-sm hf-items-center">
              <FileText size={14} style={{ color: 'var(--text-muted)' }} />
              {source.fileName || '—'}
            </div>
          </div>
          <div>
            <div className="hf-text-xs hf-text-muted hf-mb-xs">Size</div>
            <div className="hf-text-sm">{formatBytes(source.fileSize)}</div>
          </div>
          <div>
            <div className="hf-text-xs hf-text-muted hf-mb-xs">Type</div>
            <div className="hf-text-sm">{source.mimeType || '—'}</div>
          </div>
          <div>
            <div className="hf-text-xs hf-text-muted hf-mb-xs">Teaching Points</div>
            <div className="hf-text-sm hf-text-bold">{source.assertionCount}</div>
          </div>
          <div>
            <div className="hf-text-xs hf-text-muted hf-mb-xs">Status</div>
            <div className="hf-text-sm">{source.status}</div>
          </div>
          <div>
            <div className="hf-text-xs hf-text-muted hf-mb-xs">Created</div>
            <div className="hf-text-sm">{new Date(source.createdAt).toLocaleDateString()}</div>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="hf-mt-lg">
        <div className="hf-flex hf-gap-lg hf-text-xs hf-text-muted">
          <span>ID: <span className="hf-mono">{source.id.slice(0, 8)}...</span></span>
          <span>Updated: {new Date(source.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
