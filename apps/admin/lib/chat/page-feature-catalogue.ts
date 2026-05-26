/**
 * #812 — DATA-mode feature catalogue: serialise the matching PAGE_HELP_REGISTRY
 * entry for the user's current route into a block the assistant can read.
 *
 * Why a separate block from #809's `pageContext`:
 *   - #809 says "the user is on /x/courses/abc, on the Design tab" (live state)
 *   - #812 says "this page has these tabs: Content, Design, Curriculum, …"
 *     and what each one is for (static feature inventory)
 *
 * Together the assistant knows both *where* the user is and *what exists* on
 * the page, so questions like "tell me about Felt Progress" stop returning
 * "I don't see that section" — the registry is the single source of truth.
 *
 * Token budget: stays under ~500 tokens (2000-char proxy) for any single page
 * in PAGE_HELP_REGISTRY. The `whenToUse` hover-help line is deliberately
 * omitted — it largely restates the `about` field for the human reader and
 * pushed Course detail (7 tabs) over budget. The `about` field alone is
 * enough for the assistant to answer "what is the X tab?".
 */

import { getPageHelp } from "@/lib/help/page-help";

export function buildPageFeatureCatalogue(pathname: string | undefined): string {
  if (!pathname) return "";
  const help = getPageHelp(pathname);
  if (!help) return "";

  const lines: string[] = [
    `## Page features (from PAGE_HELP_REGISTRY)`,
    `Page: **${help.title}** — ${help.about}`,
  ];

  if (help.tabs && help.tabs.length > 0) {
    lines.push("", `Tabs on this page:`);
    for (const tab of help.tabs) {
      const operatorMark = tab.requiresOperator ? " _(operator-only)_" : "";
      lines.push(`- **${tab.label}** (\`${tab.id}\`)${operatorMark} — ${tab.about}`);
    }
  }

  return `\n\n${lines.join("\n")}`;
}
