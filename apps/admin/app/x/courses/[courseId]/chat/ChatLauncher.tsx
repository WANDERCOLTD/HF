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
 * On mount:
 *   1. Set ChatContext mode = "COURSE_MANAGE" — the server dispatcher
 *      narrows tools to COURSE_MANAGE_TOOLS and the system prompt
 *      switch-case routes through the DATA-mode template (page-context
 *      builder picks up the snapshot).
 *   2. Set EntityContext.pageContext = { page: "course", params: {
 *      courseSnapshot } } — every /api/chat POST from this page carries
 *      the snapshot.
 *   3. Push a course entity breadcrumb so the assistant has the
 *      conventional `entityContext` channel too.
 *   4. Open the assistant on mount so the operator doesn't have to hit
 *      Cmd+K — they came here to chat.
 *
 * On unmount: leave mode/pageContext alone — the user is navigating away,
 * and Cmd+K elsewhere will reset to DATA via the existing route-change
 * effects in EntityContext.
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
    if (mode !== "COURSE_MANAGE") {
      setMode("COURSE_MANAGE");
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
