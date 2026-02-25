'use client';

import { useCallback } from 'react';
import { useStepFlow } from '@/contexts/StepFlowContext';
import { ProgressStepper } from '@/components/shared/ProgressStepper';
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard';
import { IntentStep } from './steps/IntentStep';
import { ContentStep } from './steps/ContentStep';
import { LessonPlanStep } from './steps/LessonPlanStep';
import { CourseConfigStep } from './steps/CourseConfigStep';
import { StudentsStep } from './steps/StudentsStep';
import { CourseDoneStep } from './steps/CourseDoneStep';

type StepComponent = React.FC<StepProps>;

export interface StepProps {
  setData: (key: string, value: unknown) => void;
  getData: <T = unknown>(key: string) => T | undefined;
  onNext: () => void;
  onPrev: () => void;
  endFlow: () => void;
}

type CourseSetupWizardProps = {
  onComplete?: () => void;
};

export function CourseSetupWizard({ onComplete }: CourseSetupWizardProps) {
  const { state, setStep, nextStep, prevStep, setData, getData, endFlow } = useStepFlow();

  // Warn on browser refresh/close when user has started filling in data
  useUnsavedGuard(!!getData<string>('courseName'));

  if (!state || !state.active) {
    return <div>Loading wizard...</div>;
  }

  const currentStepId = state.steps[state.currentStep]?.id;

  const steps: Record<string, StepComponent> = {
    intent: IntentStep,
    content: ContentStep,
    'lesson-plan': LessonPlanStep,
    'course-config': CourseConfigStep,
    students: StudentsStep,
    done: CourseDoneStep,
  };

  const StepComponent = steps[currentStepId];

  const handleNext = useCallback(() => {
    nextStep();
  }, [nextStep]);

  const handlePrev = useCallback(() => {
    prevStep();
  }, [prevStep]);

  const handleEndFlow = useCallback(() => {
    endFlow();
    onComplete?.();
  }, [endFlow, onComplete]);

  if (!StepComponent) {
    return <div>Unknown step: {currentStepId}</div>;
  }

  const progressSteps = state.steps.map((s, i) => {
    const isProcessing = !!getData<boolean>(`stepProcessing_${s.id}`);
    return {
      label: s.label,
      completed: i < state.currentStep,
      active: i === state.currentStep,
      processing: i === state.currentStep && isProcessing,
      backgroundProcessing: i < state.currentStep && isProcessing,
      onClick: i < state.currentStep ? () => setStep(i) : undefined,
    };
  });

  return (
    <div className="hf-page-container hf-page-scroll">
      <div className="hf-wizard-stepper">
        <ProgressStepper steps={progressSteps} />
      </div>
      <StepComponent
        setData={setData}
        getData={getData}
        onNext={handleNext}
        onPrev={handlePrev}
        endFlow={handleEndFlow}
      />
    </div>
  );
}
