'use client';

import { useState, useEffect, useRef } from 'react';
import type { SourceStatusData } from '@/components/shared/SourceStatusDots';

/** Max sources per batch request — must match server limit in /api/content-sources/status */
const MAX_STATUS_BATCH = 50;

/**
 * useSourceStatus — fetches batch processing status for a list of content source IDs.
 *
 * Calls GET /api/content-sources/status?ids=a,b,c and returns a map of sourceId → SourceStatusData.
 * Auto-polls every `pollInterval` ms if any source has an active job (extracting/importing/pending).
 */
export function useSourceStatus(
  sourceIds: string[],
  options?: { pollInterval?: number; enabled?: boolean }
): Record<string, SourceStatusData> {
  const { pollInterval = 15_000, enabled = true } = options ?? {};
  const [statusMap, setStatusMap] = useState<Record<string, SourceStatusData>>({});
  const prevIdsRef = useRef<string>('');

  useEffect(() => {
    if (!enabled || sourceIds.length === 0) return;

    // Only re-fetch if IDs actually changed
    const idsKey = sourceIds.slice().sort().join(',');
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const batches: string[][] = [];
        for (let i = 0; i < sourceIds.length; i += MAX_STATUS_BATCH) {
          batches.push(sourceIds.slice(i, i + MAX_STATUS_BATCH));
        }

        const results: Record<string, SourceStatusData> = {};
        for (const batch of batches) {
          const res = await fetch(`/api/content-sources/status?ids=${batch.join(',')}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (data.sources) {
            Object.assign(results, data.sources);
          }
        }

        if (!cancelled) {
          setStatusMap(results);
          prevIdsRef.current = idsKey;
        }
      } catch {
        // Silently fail — dots just won't show
      }
    };

    fetchStatus();

    // Auto-poll if any source has an active job
    const interval = setInterval(() => {
      // Check if any source has active status worth polling for
      const hasActive = Object.values(statusMap).some(
        (s) => s.jobStatus === 'extracting' || s.jobStatus === 'importing' || s.jobStatus === 'pending'
      );
      if (hasActive || prevIdsRef.current !== idsKey) {
        fetchStatus();
      }
    }, pollInterval);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sourceIds.join(','), enabled, pollInterval]); // eslint-disable-line react-hooks/exhaustive-deps

  return statusMap;
}
