'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTerminology } from '@/contexts/TerminologyContext';
import { useEntityContext } from '@/contexts/EntityContext';
import SubjectDetail from '@/app/x/subjects/_components/SubjectDetail';
import { HierarchyBreadcrumb, type BreadcrumbSegment } from '@/components/shared/HierarchyBreadcrumb';

export default function CourseSubjectDetailPage() {
  const { courseId, subjectId } = useParams<{ courseId: string; subjectId: string }>();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');
  const { plural } = useTerminology();
  const { pushEntity } = useEntityContext();

  const [courseName, setCourseName] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState<string | null>(null);

  // Fetch course name for breadcrumb
  useEffect(() => {
    if (!courseId) return;
    fetch(`/api/playbooks/${courseId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setCourseName(data.playbook.name);
      })
      .catch(() => {});
  }, [courseId]);

  // Fetch subject name for breadcrumb + entity context
  useEffect(() => {
    if (!subjectId) return;
    fetch(`/api/subjects/${subjectId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok || data.subject) {
          const name = data.subject?.name || data.name;
          setSubjectName(name);
          pushEntity({
            type: 'subject',
            id: subjectId,
            label: name,
            href: `/x/courses/${courseId}/subjects/${subjectId}`,
          });
        }
      })
      .catch(() => {});
  }, [subjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const segments: BreadcrumbSegment[] = [
    { label: plural('playbook'), href: '/x/courses' },
    { label: courseName || '', href: `/x/courses/${courseId}`, loading: !courseName },
    { label: subjectName || '', href: `/x/courses/${courseId}/subjects/${subjectId}`, loading: !subjectName },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
      <HierarchyBreadcrumb segments={segments} />
      <SubjectDetail
        subjectId={subjectId}
        onSubjectUpdated={() => {
          // Re-fetch subject name in case it was renamed
          fetch(`/api/subjects/${subjectId}`)
            .then((r) => r.json())
            .then((data) => {
              if (data.ok || data.subject) {
                setSubjectName(data.subject?.name || data.name);
              }
            })
            .catch(() => {});
        }}
        isOperator={isOperator}
        courseId={courseId}
      />
    </div>
  );
}
