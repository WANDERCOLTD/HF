"use client";

import { useRouter } from "next/navigation";
import { WelcomeSurveyFlow } from "@/components/student/WelcomeSurveyFlow";
import { resolveRedirect } from "@/lib/learner/survey-end-action";

// ---------------------------------------------------------------------------
// Thin page wrapper — delegates to WelcomeSurveyFlow
// ---------------------------------------------------------------------------

export default function WelcomeSurveyPage(): React.ReactElement {
  const router = useRouter();

  return (
    <WelcomeSurveyFlow
      onComplete={() => router.replace(resolveRedirect())}
      onAlreadyDone={() => router.push("/x/student")}
    />
  );
}
