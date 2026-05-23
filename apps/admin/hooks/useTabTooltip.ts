"use client";

import { usePathname } from "next/navigation";
import { getPageHelp } from "@/lib/help/page-help";

interface TabTooltipContent {
  about?: string;
  whenToUse?: string;
}

/**
 * Look up a tab's tooltip content from the page-help registry (#687).
 *
 * Returns {} when the current path has no registered help entry or when the
 * tabId isn't in that entry's tabs list — the calling component renders no
 * tooltip in that case (per #689 AC).
 */
export function useTabTooltip(tabId: string): TabTooltipContent {
  const pathname = usePathname() || "/";
  const pageHelp = getPageHelp(pathname);
  if (!pageHelp?.tabs) return {};
  const tab = pageHelp.tabs.find((t) => t.id === tabId);
  if (!tab) return {};
  return {
    about: tab.about,
    whenToUse: tab.whenToUse,
  };
}
