/**
 * Manifest Resolver
 *
 * Resolves stable manifest item IDs to current href/label/icon values.
 * Tours reference item IDs instead of hardcoding hrefs — when the sidebar
 * manifest changes, tours follow automatically.
 *
 * Sources, merged in order (sidebar wins on id collision):
 *   1. lib/sidebar/sidebar-manifest.json — items rendered in the visible
 *      sidebar
 *   2. lib/sidebar/tour-anchors.json — items the tours reference but the
 *      simplified sidebar (#7f49c460) no longer renders. Keeps tours
 *      working without re-polluting the visible nav.
 */

import manifest from "@/lib/sidebar/sidebar-manifest.json";
import tourAnchors from "@/lib/sidebar/tour-anchors.json";

interface ManifestItemInfo {
  id: string;
  href: string;
  label: string;
  icon?: string;
  sectionId: string;
  roleVariants?: Record<string, { label?: string; href?: string; icon?: string }>;
}

export interface ResolvedItem {
  href: string;
  label: string;
  icon?: string;
  sectionId: string;
}

// Build lookup map once at module load. Sidebar manifest first so its
// entries take precedence if a tour-anchor id collides.
const ITEM_MAP = new Map<string, ManifestItemInfo>();

function indexSections(sections: typeof manifest | typeof tourAnchors): void {
  for (const section of sections) {
    for (const item of section.items) {
      const itemId = (item as { id?: string }).id;
      if (!itemId || ITEM_MAP.has(itemId)) continue;
      ITEM_MAP.set(itemId, {
        id: itemId,
        href: item.href,
        label: item.label,
        icon: (item as { icon?: string }).icon,
        sectionId: section.id,
        roleVariants: (item as { roleVariants?: ManifestItemInfo["roleVariants"] }).roleVariants,
      });
    }
  }
}

indexSections(manifest);
indexSections(tourAnchors);

/**
 * Resolve a manifest item ID to its current info.
 * Pass a role to resolve role-variant overrides (e.g. EDUCATOR → classrooms href).
 */
export function resolveManifestItem(
  itemId: string,
  role?: string,
): ResolvedItem | null {
  const info = ITEM_MAP.get(itemId);
  if (!info) return null;

  if (role && info.roleVariants?.[role]) {
    const variant = info.roleVariants[role];
    return {
      href: variant.href ?? info.href,
      label: variant.label ?? info.label,
      icon: variant.icon ?? info.icon,
      sectionId: info.sectionId,
    };
  }

  return {
    href: info.href,
    label: info.label,
    icon: info.icon,
    sectionId: info.sectionId,
  };
}

/** All known manifest item IDs (for validation). */
export function getAllManifestItemIds(): string[] {
  return Array.from(ITEM_MAP.keys());
}
