'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import SubjectDetail from '../_components/SubjectDetail';
import { HierarchyBreadcrumb, type BreadcrumbSegment } from '@/components/shared/HierarchyBreadcrumb';

export default function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');

  const [subjectName, setSubjectName] = useState<string | null>(null);

  useEffect(() => {
    if (!subjectId) return;
    fetch(`/api/subjects/${subjectId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok || data.subject) {
          setSubjectName(data.subject?.name || data.name || 'Subject');
        } else {
          setSubjectName('Subject');
        }
      })
      .catch(() => setSubjectName('Subject'));
  }, [subjectId]);

  const segments: BreadcrumbSegment[] = [
    { label: 'Subjects', href: '/x/subjects' },
    { label: subjectName || '', href: `/x/subjects/${subjectId}`, loading: !subjectName },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
      <HierarchyBreadcrumb segments={segments} />
      <SubjectDetail
        subjectId={subjectId}
        onSubjectUpdated={() => {
          fetch(`/api/subjects/${subjectId}`)
            .then((r) => r.json())
            .then((data) => {
              if (data.ok || data.subject) {
                setSubjectName(data.subject?.name || data.name || 'Subject');
              }
            })
            .catch(() => {});
        }}
        isOperator={isOperator}
      />
    </div>
  );
}
