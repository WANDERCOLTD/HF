/**
 * Visual Aids Transform
 *
 * Formats extracted images/figures for inclusion in the voice prompt.
 * The AI uses this list to:
 * - Describe diagrams verbally during voice calls
 * - Share images via share_content tool during sim sessions
 *
 * When a lesson plan entry is active, tags each image with whether it
 * belongs to the current session and prioritises session images first.
 */

import { registerTransform } from "../TransformRegistry";
import type { VisualAidData } from "../types";

registerTransform("formatVisualAids", (rawData, context) => {
  const aids = rawData as VisualAidData[] | null;
  if (!aids || aids.length === 0) return null;

  // Collect session-specific media IDs from lesson plan entry
  const sessionMedia = context.sharedState?.lessonPlanEntry?.media as
    | Array<{ mediaId: string }>
    | null
    | undefined;
  const sessionMediaIds = new Set(sessionMedia?.map((m) => m.mediaId) || []);

  const available = aids.map((a) => ({
    mediaId: a.mediaId,
    fileName: a.fileName,
    captionText: a.captionText,
    figureRef: a.figureRef,
    chapter: a.chapter,
    ...(sessionMediaIds.size > 0 ? { currentSession: sessionMediaIds.has(a.mediaId) } : {}),
  }));

  // Session images first, then others
  if (sessionMediaIds.size > 0) {
    available.sort((a, b) => (a.currentSession === b.currentSession ? 0 : a.currentSession ? -1 : 1));
  }

  return {
    hasVisualAids: true,
    count: available.length,
    sessionCount: sessionMediaIds.size > 0
      ? available.filter((a) => a.currentSession).length
      : undefined,
    available,
  };
});
