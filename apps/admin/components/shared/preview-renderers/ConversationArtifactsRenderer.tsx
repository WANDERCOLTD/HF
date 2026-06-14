"use client";

/**
 * ConversationArtifactsRenderer — #1643 (Epic #1606 Group A.5).
 *
 * Inspector card for the `conversationArtifacts` composer section
 * (loader + transform shipped in #1642). Surfaces the
 * DELIVERED/READ artifacts the AI emitted after the most-recent prior
 * call so the educator can see what's about to be referenced in the
 * next composed prompt.
 *
 * Data shape mirrors the `renderConversationArtifacts` transform output
 * + an extra `loading` discriminant so the DesignTab can render a
 * "loading…" state while the preview route fetches.
 *
 * Empty states:
 *  - `loading: true` → muted "Loading recent artifacts…" placeholder
 *  - `hasArtifacts: false` AND no prior call yet → muted
 *    "No prior call on this course yet — Call 1 path"
 *  - `hasArtifacts: false` AND prior call had zero DELIVERED → muted
 *    "Last call shared no artifacts" with the call timestamp
 *  - `hasArtifacts: true` → totalCount summary + per-artifact list with
 *    type/title/snippet
 */

import { registerPreviewRenderer } from "@/components/shared/designer-shell/section-registry";
import type { PreviewRendererProps } from "@/components/shared/designer-shell/section-registry";

export interface ConversationArtifactsRendererArtifact {
  id: string;
  type: string;
  title: string;
  snippet: string;
  confidence: number;
  deliveredAt: string | null;
}

export interface ConversationArtifactsRendererData {
  loading?: boolean;
  /** Caller chosen for preview ("most-recent active learner on this course"). Null when no callers enrolled yet. */
  previewCallerName?: string | null;
  hasArtifacts: boolean;
  lastCallId: string | null;
  lastCallAt: string | null;
  totalCount?: number;
  artifacts: ConversationArtifactsRendererArtifact[];
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export function ConversationArtifactsRenderer({
  data,
}: PreviewRendererProps<ConversationArtifactsRendererData>) {
  if (data.loading) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Conversation artifacts</div>
        <span className="hf-badge hf-badge-muted">
          Loading recent artifacts…
        </span>
      </div>
    );
  }

  if (data.previewCallerName === null) {
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">Conversation artifacts</div>
        <span className="hf-badge hf-badge-muted">
          No learners enrolled yet
        </span>
      </div>
    );
  }

  const callerPrefix = data.previewCallerName
    ? ` (${data.previewCallerName})`
    : "";

  if (!data.hasArtifacts) {
    const lastCallRelative = data.lastCallAt ? formatRelative(data.lastCallAt) : "";
    if (!data.lastCallId) {
      return (
        <div className="hf-card-compact">
          <div className="hf-category-label">
            Conversation artifacts{callerPrefix}
          </div>
          <span className="hf-badge hf-badge-muted">
            No prior call yet — Call 1 path
          </span>
        </div>
      );
    }
    return (
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Conversation artifacts{callerPrefix}
        </div>
        <span className="hf-badge hf-badge-muted">
          Last call ({lastCallRelative}) shared no artifacts
        </span>
      </div>
    );
  }

  const totalCount = data.totalCount ?? data.artifacts.length;
  const lastCallRelative = data.lastCallAt ? formatRelative(data.lastCallAt) : "";

  return (
    <div className="hf-card-compact">
      <div className="hf-category-label">
        Conversation artifacts{callerPrefix} — {totalCount} from{" "}
        {lastCallRelative || "last call"}
      </div>
      <ol className="hf-list-row">
        {data.artifacts.map((a) => (
          <li key={a.id}>
            <span className="hf-badge hf-badge-info">{a.type}</span>{" "}
            <strong>{a.title}</strong>
            <div className="hf-text-sm hf-text-muted">{a.snippet}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

registerPreviewRenderer<"conversationArtifacts", ConversationArtifactsRendererData>(
  "conversationArtifacts",
  ConversationArtifactsRenderer,
);
