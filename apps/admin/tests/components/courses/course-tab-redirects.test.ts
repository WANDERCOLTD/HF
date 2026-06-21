/**
 * P5 (#1850) — Course Detail tab redirect behaviour.
 *
 * Pins the contract that a deep link carrying `?tab=design` (the now-
 * retired Design tab) lands the user on the Journey tab, not a blank
 * panel. Also pins the sibling legacy redirects (`sessions`,
 * `onboarding`, `overview`, `audience`, `session-flow`, `genome`,
 * `content`) so future cleanup can't silently drop them.
 *
 * Unit test against the extracted helper at
 * `app/x/courses/[courseId]/_lib/tab-redirects.ts` — keeps the assertion
 * fast (no React, no next/navigation) and free of layout brittleness.
 */

import { describe, it, expect } from 'vitest';

import {
  VALID_TABS,
  LEGACY_TAB_REDIRECTS,
  resolveInitialTab,
} from '@/app/x/courses/[courseId]/_lib/tab-redirects';

describe('resolveInitialTab — P5 (#1850) Design tab retirement', () => {
  it('?tab=design lands on the Journey tab', () => {
    expect(resolveInitialTab('design')).toBe('journey');
  });

  it('?tab=design is also covered by the LEGACY_TAB_REDIRECTS table directly', () => {
    expect(LEGACY_TAB_REDIRECTS.design).toBe('journey');
  });

  it('legacy aliases sessions / onboarding / overview / audience / session-flow all land on Journey', () => {
    expect(resolveInitialTab('sessions')).toBe('journey');
    expect(resolveInitialTab('onboarding')).toBe('journey');
    expect(resolveInitialTab('overview')).toBe('journey');
    expect(resolveInitialTab('audience')).toBe('journey');
    expect(resolveInitialTab('session-flow')).toBe('journey');
  });

  it('legacy alias genome lands on Sources (intelligence)', () => {
    expect(resolveInitialTab('genome')).toBe('intelligence');
  });

  // #2204 (U2 of #2185) — 'content' is now a real tab id (Teaching
  // Content skeleton). The legacy redirect ?tab=content → intelligence
  // was removed; ?tab=content passes through to the new tab.
  it("'content' is no longer a legacy alias — passes through to the Teaching Content tab", () => {
    expect(LEGACY_TAB_REDIRECTS.content).toBeUndefined();
    expect(resolveInitialTab('content')).toBe('content');
  });
});

describe('resolveInitialTab — default + passthrough behaviour', () => {
  it('null param → journey (default landing surface)', () => {
    expect(resolveInitialTab(null)).toBe('journey');
  });

  it('undefined param → journey', () => {
    expect(resolveInitialTab(undefined)).toBe('journey');
  });

  it('empty string → journey', () => {
    expect(resolveInitialTab('')).toBe('journey');
  });

  it('active tab ids pass through verbatim', () => {
    expect(resolveInitialTab('journey')).toBe('journey');
    expect(resolveInitialTab('teaching')).toBe('teaching');
    expect(resolveInitialTab('scoring')).toBe('scoring');
    expect(resolveInitialTab('modules')).toBe('modules');
    expect(resolveInitialTab('voice')).toBe('voice');
    expect(resolveInitialTab('settings')).toBe('settings');
  });

  it('unknown tab id → journey (safe fallback)', () => {
    expect(resolveInitialTab('nonsense-bogus-tab')).toBe('journey');
  });
});

describe('VALID_TABS — active vs legacy', () => {
  it('contains the post-P5 active tab set', () => {
    const activeIds = [
      'journey',
      'teaching',
      'scoring',
      'modules',
      'intelligence',
      'curriculum',
      'learners',
      'proof',
      'goals',
      'skills',
      'voice',
      'settings',
    ];
    for (const id of activeIds) {
      expect(VALID_TABS).toContain(id);
    }
  });

  it('still contains `design` as a legacy id so deep links resolve before redirecting', () => {
    expect(VALID_TABS).toContain('design');
  });

  it('every legacy id has a destination in LEGACY_TAB_REDIRECTS', () => {
    const legacyIds = ['design', 'overview', 'genome', 'audience', 'session-flow'];
    for (const id of legacyIds) {
      expect(LEGACY_TAB_REDIRECTS[id]).toBeDefined();
    }
  });
});
