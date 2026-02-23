"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Legacy route — redirects to master-detail view at /x/subjects?id=<subjectId>.
 * Kept so that old bookmarks / external links still resolve.
 */
export default function SubjectRedirect() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/x/subjects?id=${subjectId}`);
  }, [subjectId, router]);

  return null;
}
