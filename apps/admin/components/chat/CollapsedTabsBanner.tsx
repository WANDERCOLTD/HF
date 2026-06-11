"use client";

/**
 * #1504 Slice 3 — one-time information banner shown after the
 * 4-tab → 2-tab collapse. Independent from the Slice 2
 * `HistoryMergedBanner`: that one only fires for users who had legacy
 * TUNING / COURSE_MANAGE history to merge; this one fires for everyone
 * because the visible tab change is operator-relevant even for fresh
 * installs.
 *
 * Rendered only when localStorage has NOT yet recorded a dismiss; clicking
 * "Got it" flips the per-user key from undefined → "shown" so the banner
 * never reappears for that user.
 *
 * Uses `hf-banner hf-banner-info` design-system tokens — no inline colours
 * (see `.claude/rules/ui-design-system.md`).
 */

import React from "react";
import { useSession } from "next-auth/react";
import { getTabsCollapsedBannerKey } from "@/contexts/ChatContext";

export function CollapsedTabsBanner(): React.ReactElement | null {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const state = window.localStorage.getItem(getTabsCollapsedBannerKey(userId));
      // Show on every key state EXCEPT "shown". Fresh installs land here
      // with `null` and see the banner once; dismissed users land here
      // with "shown" and never see it again.
      setVisible(state !== "shown");
    } catch {
      // ignore — banner is non-essential
    }
  }, [userId]);

  if (!visible) return null;

  const dismiss = () => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(getTabsCollapsedBannerKey(userId), "shown");
      }
    } catch {
      // ignore
    }
    setVisible(false);
  };

  return (
    <div className="hf-banner hf-banner-info chat-tabs-banner" role="status">
      <span>
        Chat tabs simplified: Tuning and Course are now part of Assistant. Open
        a learner or course to scope your edits.
      </span>
      <button
        type="button"
        className="chat-tabs-banner-dismiss"
        onClick={dismiss}
        aria-label="Dismiss tab simplification notice"
      >
        Got it
      </button>
    </div>
  );
}
