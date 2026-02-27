'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import SubjectDetail from '../_components/SubjectDetail';

export default function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const { data: session } = useSession();
  const isOperator = ['OPERATOR', 'EDUCATOR', 'ADMIN', 'SUPERADMIN'].includes((session?.user?.role as string) || '');

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 24 }}>
      <SubjectDetail
        subjectId={subjectId}
        onSubjectUpdated={() => {}}
        isOperator={isOperator}
      />
    </div>
  );
}
