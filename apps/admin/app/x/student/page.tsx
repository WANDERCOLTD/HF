"use client";

/**
 * Student Entry Router — resolves journey position and redirects.
 *
 * All student entry points converge here:
 * - Magic link join → /x/student
 * - Login redirect → /x/student
 * - Post-survey completion → /x/student
 * - Returning student → /x/student
 *
 * Calls GET /api/student/journey-position to find next stop, then redirects.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function StudentEntryRouter(): React.ReactElement {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/student/journey-position")
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.nextStop?.redirect) {
          router.replace(data.nextStop.redirect);
        } else if (data.nextStop?.redirect) {
          // Even on 404 (no enrollment), use the redirect hint
          router.replace(data.nextStop.redirect);
        } else {
          // Fallback — go to sim
          router.replace("/x/sim");
        }
      })
      .catch(() => {
        setError("Something went wrong. Please try again.");
      });
  }, [router]);

  if (error) {
    return (
      <div className="hf-flex hf-items-center hf-justify-center" style={{ minHeight: "60vh" }}>
        <div className="hf-card" style={{ maxWidth: 400, textAlign: "center" }}>
          <p className="hf-text-sm hf-text-muted">{error}</p>
          <button
            className="hf-btn hf-btn-primary hf-mt-md"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hf-flex hf-items-center hf-justify-center" style={{ minHeight: "60vh" }}>
      <div className="hf-spinner" />
    </div>
  );
}
