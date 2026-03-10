'use client';

import { OnboardingEditor } from '@/components/shared/OnboardingEditor';

interface StudentJourneyTabProps {
  courseId: string;
  domainId: string;
  domainName: string | null;
  isOperator: boolean;
}

/**
 * Thin wrapper — delegates to OnboardingEditor in full (two-column) mode.
 * Preserved for backward compatibility.
 */
export function StudentJourneyTab({ courseId, domainId, domainName, isOperator }: StudentJourneyTabProps) {
  return (
    <OnboardingEditor
      courseId={courseId}
      domainId={domainId}
      domainName={domainName}
      isOperator={isOperator}
      compact={false}
    />
  );
}
