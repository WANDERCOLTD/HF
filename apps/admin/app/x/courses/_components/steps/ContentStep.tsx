'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { PackUploadStep } from '@/components/wizards/PackUploadStep';
import type { PackUploadResult } from '@/components/wizards/PackUploadStep';
import { FieldHint } from '@/components/shared/FieldHint';
import { WIZARD_HINTS } from '@/lib/wizard-hints';
import type { StepProps } from '../CourseSetupWizard';

export function ContentStep({ setData, getData, onNext, onPrev }: StepProps) {
  const [packComplete, setPackComplete] = useState(false);
  const [packSummary, setPackSummary] = useState<string | null>(null);
  const [packTimedOut, setPackTimedOut] = useState(false);
  const packTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const domainId = getData<string>('domainId') || '';
  const courseName = getData<string>('courseName') || '';

  // Load saved data
  useEffect(() => {
    const savedPackComplete = getData<boolean>('packComplete');
    if (savedPackComplete) setPackComplete(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Safety timeout — if PackUploadStep doesn't call back within 5 min, show nav buttons
  useEffect(() => {
    if (!packComplete && !packTimedOut) {
      packTimeoutRef.current = setTimeout(() => setPackTimedOut(true), 5 * 60 * 1000);
    }
    return () => {
      if (packTimeoutRef.current) clearTimeout(packTimeoutRef.current);
    };
  }, [packComplete, packTimedOut]);

  const handlePackResult = useCallback((result: PackUploadResult) => {
    if (packTimeoutRef.current) clearTimeout(packTimeoutRef.current);

    if (result.mode === 'skip') {
      setData('contentMode', 'skip');
      onNext();
      return;
    }
    if (result.mode === 'pack-upload') {
      setData('packTaskId', result.taskId);
      setData('packSubjects', result.subjects);
      setData('packSourceCount', result.sourceCount);
      setData('packComplete', true);
      setData('contentMode', 'pack');
      setPackComplete(true);
      const subjectNames = (result.subjects || []).map((s) => s.name).join(', ');
      setPackSummary(`${result.subjects?.length || 0} subject${(result.subjects?.length || 0) !== 1 ? 's' : ''} · ${result.sourceCount || 0} files uploaded (${subjectNames})`);
      onNext();
    }
    if (result.mode === 'existing-course') {
      setData('existingCourseId', result.courseId);
      setData('contentMode', 'existing-course');
      setPackComplete(true);
      onNext();
    }
  }, [setData, onNext]);

  const handleSkip = () => {
    setData('contentMode', 'skip');
    onNext();
  };

  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step">
        <div className="hf-mb-lg">
          <FieldHint label="Add Content" hint={WIZARD_HINTS["course.content"]} labelClass="hf-page-title hf-mb-sm" />
          <p className="hf-page-subtitle">Upload your course files</p>
        </div>

        <div className="hf-mb-lg">
          {packComplete && packSummary ? (
            <div className="hf-banner hf-banner-success">
              <CheckCircle className="hf-icon-sm hf-flex-shrink-0" />
              <span>{packSummary}</span>
            </div>
          ) : (
            <PackUploadStep domainId={domainId} courseName={courseName} onResult={handlePackResult} onBack={onPrev} />
          )}
        </div>
      </div>

      {/* Footer — shows when user navigates back to this step after completion */}
      {packComplete && (
        <div className="hf-step-footer">
          <button onClick={onPrev} className="hf-btn hf-btn-ghost">
            Back
          </button>
          <button onClick={onNext} className="hf-btn hf-btn-primary">
            Next <ArrowRight className="hf-icon-sm" />
          </button>
        </div>
      )}
    </div>
  );
}
