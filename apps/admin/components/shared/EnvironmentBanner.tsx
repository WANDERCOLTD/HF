'use client';

/**
 * Environment indicator — no visible banner.
 * Prefixes the browser tab title for DEV/STG.
 * Exports env color/label for StatusBar badge, AccountPanel, and login page.
 */

import { useEffect } from 'react';

/**
 * Environment detection — MUST be set via NEXT_PUBLIC_APP_ENV in .env/.env.local
 * Valid values: DEV | TEST | STG | LIVE
 *
 * DEV (vm/localhost) → blue stripe
 * TEST (test.humanfirstfoundation.com) → purple stripe
 * STG (staging) → amber stripe
 * LIVE (lab.humanfirstfoundation.com) → no stripe
 */
const ENV = process.env.NEXT_PUBLIC_APP_ENV || 'DEV';

const ENV_COLORS: Record<string, { sidebar: string; text?: string; sidebarWidth: number; label: string } | null> = {
  DEV:  { sidebar: 'var(--env-dev-color, #3b82f6)', sidebarWidth: 6, label: 'DEV' },                                     // Blue
  TEST: { sidebar: 'var(--env-test-color, #8b5cf6)', sidebarWidth: 6, label: 'TEST' },                                   // Purple
  STG:  { sidebar: 'var(--env-stg-color, #f59e0b)', sidebarWidth: 6, label: 'STG' },                                     // Amber
  LIVE: { sidebar: 'var(--env-live-color, #F5B856)', text: 'var(--login-navy, #1F1B4A)', sidebarWidth: 6, label: 'LIVE' }, // Gold
};

const ENV_NORMALIZED = ENV.toUpperCase();
const ENV_CONFIG = ENV_COLORS[ENV_NORMALIZED];

if (!ENV_CONFIG) {
  console.warn(`⚠️ Unknown NEXT_PUBLIC_APP_ENV: "${ENV}". Valid values: DEV | TEST | STG | LIVE`);
}

/** Whether an environment badge should be shown (all envs now show a badge) */
export const showEnvBanner = ENV_CONFIG != null;

/** Whether this is a non-production environment (use for demo panels, dev-only features) */
export const isNonProd = ENV_NORMALIZED !== 'LIVE';

/** Environment accent color (null if unknown env). Used by StatusBar badge + login page. */
export const envSidebarColor = ENV_CONFIG?.sidebar ?? null;

/** Environment text color override (null = white). Used for light backgrounds like gold LIVE badge. */
export const envTextColor = ENV_CONFIG?.text ?? null;

/** Short label for the environment (null if unknown env) */
export const envLabel = ENV_CONFIG?.label ?? null;

/** Whether we're running on localhost/VM (vs Cloud Run) — detected at runtime */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

/**
 * Invisible component — only prefixes the browser tab title.
 * Environment badge is rendered by StatusBar.
 */
export default function EnvironmentBanner() {
  useEffect(() => {
    if (ENV_NORMALIZED === 'LIVE') return;
    const isLocal = isLocalhost();
    const label = isLocal && ENV_NORMALIZED === 'DEV' ? 'VM' : ENV_NORMALIZED;
    const base = document.title.replace(/^\[(DEV|TEST|STG|LIVE|VM)\]\s*/, '');
    document.title = `[${label}] ${base || 'HFF'}`;
  }, []);

  return null;
}
