'use client';

import { useParams } from 'next/navigation';
import { SessionDetailClient } from './session-detail';

export default function SessionDetailPage() {
  const { courseId, sessionNum } = useParams<{ courseId: string; sessionNum: string }>();

  return (
    <div className="hf-page-content">
      <SessionDetailClient courseId={courseId} sessionNum={parseInt(sessionNum, 10)} />
    </div>
  );
}
