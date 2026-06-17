"use client";

/**
 * ScoringLhMenu — LH bucket nav for the Scoring tab.
 *
 * Filters JOURNEY_MENU_ITEMS by BUCKETS_BY_TAB.scoring.
 * Sibling of TeachingLhMenu.
 */

import {
  JOURNEY_MENU_ITEMS_BY_ID,
} from "@/lib/journey/menu-items";
import { getSettingsForBucket } from "@/lib/journey/bucket-relations";
import { BUCKETS_BY_TAB } from "@/lib/journey/buckets-by-tab";
import type { JourneyMenuBucketId } from "@/lib/journey/setting-contracts";

interface ScoringLhMenuProps {
  courseId: string;
  selectedId: JourneyMenuBucketId | null;
  onSelect: (id: JourneyMenuBucketId) => void;
}

export function ScoringLhMenu({
  selectedId,
  onSelect,
}: ScoringLhMenuProps) {
  const buckets = BUCKETS_BY_TAB.scoring.map(
    (id) => JOURNEY_MENU_ITEMS_BY_ID[id],
  );

  return (
    <div
      className="hf-journey-lh"
      data-testid="hf-scoring-lh-menu"
    >
      <div className="hf-journey-lh-groups">
        <div className="hf-journey-group">
          <div className="hf-journey-group-body">
            {buckets.map((b) => {
              const settings = getSettingsForBucket(b.id);
              const settingsCount = settings.length;
              const isEmpty = settingsCount === 0;
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`hf-journey-setting-row ${
                    selectedId === b.id ? "hf-selected" : ""
                  } ${isEmpty ? "hf-journey-bucket-empty" : ""}`}
                  onClick={() => onSelect(b.id)}
                  data-testid={`hf-scoring-bucket-row-${b.id}`}
                  title={
                    isEmpty && b.emptyReservation
                      ? b.emptyReservation.note
                      : undefined
                  }
                >
                  <span className="hf-journey-bucket-label">
                    {b.label}
                    {isEmpty ? (
                      <span className="hf-journey-bucket-empty-tag">
                        {b.emptyReservation
                          ? `T${b.emptyReservation.ieltsTheme}`
                          : "soon"}
                      </span>
                    ) : null}
                  </span>
                  {!isEmpty ? (
                    <span className="hf-journey-bucket-count">
                      {settingsCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
