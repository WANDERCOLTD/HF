"use client";

/**
 * CourseContentTab — Admin gap A1 closure (U2 of #2185, story #2204).
 *
 * Bi-pane operator surface for browsing the TYPED teaching content of a
 * course — MCQ Bank / Cue Cards / Topic Prompts / Scenario Probes /
 * Reflection Prompts. Mirrors the Modules tab's bi-pane pattern
 * (LH intent groups → RHS detail) using `DesignerShell`.
 *
 * Distinct from the older `intelligence` tab, which surfaces flat
 * source uploads + content breakdowns. This tab is intent-grouped by
 * teaching-content kind, scoped to the typed primitives the Lattice
 * has standardised on (ContentQuestion rows + AuthoredModule.settings
 * sub-objects).
 *
 * Skeleton scope (#2204): READ-ONLY browse. Editing actions
 * (add MCQ, edit cue card, regenerate topic pool) are out of scope and
 * tracked under sibling stories in epic #2185.
 *
 * Data-driven: reads ContentQuestion (MCQ rows) + Playbook.config.modules
 * cueCardPool/topicPool sub-objects via
 * `/api/courses/[courseId]/typed-content`. No per-course hardcoding;
 * adding a new course exercises this tab without UI changes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { ContentDetailPanel } from "@/components/content-tab/ContentDetailPanel";
import { ContentLhPicker } from "@/components/content-tab/ContentLhPicker";
import "@/components/content-tab/content-tab.css";
import {
  CONTENT_KINDS,
  type ContentKind,
  type TypedContentPayload,
} from "@/components/content-tab/types";
import { DesignerShell } from "@/components/shared/designer-shell/DesignerShell";

interface CourseContentTabProps {
  courseId: string;
}

const FIRST_KIND: ContentKind = CONTENT_KINDS[0]?.kind ?? "mcqs";

export function CourseContentTab({ courseId }: CourseContentTabProps) {
  const [payload, setPayload] = useState<TypedContentPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<ContentKind>(FIRST_KIND);
  // Bumped after a successful row save (S6 of #2185) to retrigger the fetch.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/typed-content`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok) {
          setPayload({
            courseId: data.courseId,
            groups: data.groups,
            modules: data.modules,
            sources: data.sources,
          });
        } else {
          setError(data?.error || "Failed to load content");
          setPayload(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Network error");
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, reloadToken]);

  const handleContentChanged = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  const handleSelect = useCallback((kind: ContentKind) => {
    setSelectedKind(kind);
  }, []);

  const navContent = useMemo(() => {
    if (loading || !payload) {
      return (
        <div className="hf-journey-lh" data-testid="hf-content-lh-loading">
          <div className="hf-journey-lh-groups">
            <div className="hf-card hf-card-compact">Loading content…</div>
          </div>
        </div>
      );
    }
    return (
      <ContentLhPicker
        groups={payload.groups}
        selectedKind={selectedKind}
        onSelect={handleSelect}
      />
    );
  }, [loading, payload, selectedKind, handleSelect]);

  const canvasContent = useMemo(() => {
    if (loading) {
      return (
        <div className="hf-empty" data-testid="hf-content-loading">
          <h2 className="hf-section-title">Loading content…</h2>
          <p className="hf-section-desc">
            Reading typed teaching content from this course.
          </p>
        </div>
      );
    }
    if (error) {
      return (
        <div
          className="hf-banner hf-banner-error"
          data-testid="hf-content-error"
        >
          Could not load content. {error}
        </div>
      );
    }
    if (!payload) {
      return (
        <div className="hf-empty" data-testid="hf-content-empty-payload">
          <h2 className="hf-section-title">No content loaded</h2>
          <p className="hf-section-desc">
            The course has no readable content payload.
          </p>
        </div>
      );
    }
    return (
      <ContentDetailPanel
        selectedKind={selectedKind}
        groups={payload.groups}
        modules={payload.modules}
        sources={payload.sources}
        courseId={courseId}
        onContentChanged={handleContentChanged}
      />
    );
  }, [loading, error, payload, selectedKind, courseId, handleContentChanged]);

  return (
    <div data-testid="hf-course-content-tab">
      <DesignerShell nav={navContent} canvas={canvasContent} />
    </div>
  );
}
