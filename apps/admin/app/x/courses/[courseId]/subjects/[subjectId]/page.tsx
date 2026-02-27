'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEntityContext } from '@/contexts/EntityContext';
import SubjectDetail from '@/app/x/subjects/_components/SubjectDetail';
import { CourseContextBanner } from '@/components/shared/CourseContextBanner';

export default function CourseSubjectDetailPage() {
  const { courseId, subjectId } = useParams<{ courseId: string; subjectId: string }>();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');
  const { pushEntity } = useEntityContext();

  // Push entity context for ChatPanel AI awareness
  useEffect(() => {
    if (!subjectId) return;
    fetch(`/api/subjects/${subjectId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok || data.subject) {
          const name = data.subject?.name || data.name;
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

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
      <CourseContextBanner courseId={courseId} />
      <SubjectDetail
        subjectId={subjectId}
        onSubjectUpdated={() => {}}
        isOperator={isOperator}
        courseId={courseId}
      />
    </div>
  );
}
