"use client";

import { useEffect } from "react";
import { useChatContext } from "@/contexts/ChatContext";
import { useEntityContext } from "@/contexts/EntityContext";
import { useGlobalAssistant } from "@/contexts/AssistantContext";
import type { CourseSnapshot } from "./page";

/**
 * #1225 — bridges the server-rendered course snapshot into the global
 * Cmd+K assistant.
 *
 * #1504 Slice 3 — after the 4-tab → 2-tab collapse the standalone
 * "Course" mode is gone. Course pages now drop the operator into the
 * ASSISTANT tab; the route handler's unified-Assistant builder consumes
 * `pageContext.courseSnapshot` (set below) + the playbook breadcrumb to
 * narrow intent toward course-edit tools. No behavioural regression: the
 * snapshot still flows through the same EntityContext channel.
 *
 * On mount:
 *   1. Set ChatContext mode = "ASSISTANT" — the route handler's unified
 *      Assistant builder reads `pageContext` + breadcrumbs to bias toward
 *      course-edit tools (`update_playbook_config`, etc.).
 *   2. Set EntityContext.pageContext = { page: "course", params: {
 *      courseSnapshot } } — every /api/chat POST from this page carries
 *      the snapshot.
 *   3. Push a course entity breadcrumb so the assistant has the
 *      conventional `entityContext` channel too.
 *   4. Open the assistant on mount so the operator doesn't have to hit
 *      Cmd+K — they came here to chat.
 *
 * On unmount: leave mode/pageContext alone — the user is navigating away,
 * and the global ASSISTANT tab is the right default for everywhere else.
 */
interface ChatLauncherProps {
  readonly courseId: string;
  readonly courseName: string;
  readonly snapshot: CourseSnapshot;
}

export function ChatLauncher({ courseId, courseName, snapshot }: ChatLauncherProps) {
  const { setMode, mode } = useChatContext();
  const { setPageContext, pushEntity } = useEntityContext();
  const assistant = useGlobalAssistant();

  useEffect(() => {
    if (mode !== "ASSISTANT") {
      setMode("ASSISTANT");
    }
    setPageContext("course", { courseSnapshot: snapshot });
    pushEntity({
      type: "playbook",
      id: courseId,
      label: courseName,
      data: { snapshotKeys: Object.keys(snapshot.config) },
    });
    if (!assistant.isOpen) {
      assistant.open();
    }
    // Run once on mount — snapshot is server-rendered and stable for
    // this page render. router.refresh() after a tray apply re-renders
    // the server component which re-mounts this with a fresh snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
