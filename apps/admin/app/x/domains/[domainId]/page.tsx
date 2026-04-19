"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Redirects /x/domains/[domainId] → /x/domains?id=[domainId]
 * The full domain editor lives on /x/domains with split-panel layout.
 */
export default function DomainDetailRedirect() {
  const params = useParams();
  const router = useRouter();
  const domainId = params.domainId as string;

  useEffect(() => {
    router.replace(`/x/domains?id=${domainId}`);
  }, [domainId, router]);

  return (
    <div className="hf-empty">Redirecting...</div>
  );
}
