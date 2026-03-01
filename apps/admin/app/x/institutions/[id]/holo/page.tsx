"use client";

/**
 * Holographic Institution Page — Deep-Link Redirect
 *
 * Redirects /x/institutions/[id]/holo → /x/holographic?domain=[id]
 * Keeps backward compatibility with old URLs.
 */

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import "./holographic-page.css";

export default function HolographicRoute() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/x/holographic?domain=${params.id}`);
  }, [params.id, router]);

  return (
    <div className="hp-loading">
      <Loader2 size={20} className="hf-spinner" />
      <span>Redirecting…</span>
    </div>
  );
}
