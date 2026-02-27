'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useEntityContext } from '@/contexts/EntityContext';
import { CourseContextBanner } from '@/components/shared/CourseContextBanner';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
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
  const { pushEntity } = useEntityContext();

  const [source, setSource] = useState<SourceDetail | null>(null);
  const [contentMethods, setContentMethods] = useState<{ teachMethod: string; count: number }[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId || !subjectId || !sourceId) return;
    setLoading(true);

    Promise.all([
      fetch(`/api/content-sources/${sourceId}`).then((r) => r.json()),
      fetch(`/api/courses/${courseId}/content-breakdown?sourceId=${sourceId}`).then((r) => r.json()).catch(() => null),
    ])
      .then(([srcData, breakdownData]) => {
        if (breakdownData?.ok) {
          setContentMethods(breakdownData.methods || []);
          setContentTotal(breakdownData.total || 0);
        }
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

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div className="hf-text-center hf-text-muted" style={{ padding: 80 }}>
          <div className="hf-spinner" />
        </div>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div style={{ padding: 24 }}>
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
      <CourseContextBanner courseId={courseId} />

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
          className="hf-btn hf-btn-primary hf-nowrap"
        >
          <ExternalLink size={14} />
          View All Teaching Points
        </Link>
      </div>

      {/* Teaching Method Breakdown */}
      {contentMethods.length > 0 && (
        <div className="hf-mb-lg">
          <TeachMethodStats methods={contentMethods} total={contentTotal} compact />
        </div>
      )}

      {/* Info Card */}
      <div className="hf-card">
        <div className="hf-flex hf-gap-lg hf-flex-wrap">
          <div>
            <div className="hf-text-xs hf-text-muted hf-mb-xs">File</div>
            <div className="hf-text-sm hf-flex hf-gap-sm hf-items-center">
              <FileText size={14} className="hf-text-muted" />
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
