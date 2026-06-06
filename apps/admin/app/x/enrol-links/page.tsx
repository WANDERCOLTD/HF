import { redirect } from "next/navigation";
import { requireAuth, isAuthError } from "@/lib/permissions";
import { EnrolLinksClient } from "./EnrolLinksClient";

/**
 * @page /x/enrol-links
 * Test-enrolment helper page for operators. Lists every cohort the
 * operator can read (per /api/cohorts RBAC scoping) and shows a
 * "Copy" button next to each enrolment URL.
 *
 * Workflow the page is built for:
 *   1. Operator opens the page
 *   2. Picks a cohort, hits Copy
 *   3. Opens a Private Browsing window manually (browsers can't
 *      programmatically force incognito), pastes the link
 *   4. Completes the chat as a test learner
 *
 * OPERATOR+ gate (#1141 / V2 epic Story 1).
 */
export default async function EnrolLinksPage() {
  const auth = await requireAuth("OPERATOR");
  if (isAuthError(auth)) {
    redirect("/login?callbackUrl=/x/enrol-links");
  }
  return <EnrolLinksClient />;
}
