'use client';

/**
 * Environment indicator — no visible banner.
 * Prefixes the browser tab title with the env label, plus an arrow notation
 * when the sandbox VM has been pointed at a non-sandbox DB via /db-switch.
 * Exports env color/label for StatusBar badge, AccountPanel, and login page.
 */

import { useEffect } from 'react';

/**
 * Environment detection — set via NEXT_PUBLIC_APP_ENV in .env/.env.local
 *
 * Canonical values:
 *   SANDBOX — VM/localhost (grey)
 *   STAGING — staging.humanfirstfoundation.com (blue)
 *   PILOT   — pilot.humanfirstfoundation.com (purple)
 *   PROD    — app.humanfirstfoundation.com (gold)
 *
 * Legacy values (still accepted, mapped to canonical):
 *   DEV  -> SANDBOX (when isLocalhost) or STAGING (Cloud Run)
 *   TEST -> PILOT
 *   STG  -> STAGING
 *   LIVE -> PROD
 *
 * Optional NEXT_PUBLIC_DB_TARGET:
 *   When the sandbox VM is switched to another env's DB via /db-switch,
 *   this is set to 'staging' | 'pilot' | 'sandbox'. Drives the [VM→PILOT] title
 *   prefix and the colored ring on UserAvatar.
 */
const RAW_ENV = (process.env.NEXT_PUBLIC_APP_ENV || 'SANDBOX').toUpperCase();
const DB_TARGET = (process.env.NEXT_PUBLIC_DB_TARGET || '').toLowerCase();

/** Normalize legacy env names to canonical */
const LEGACY_ALIAS: Record<string, string> = {
  DEV: 'STAGING',
  TEST: 'PILOT',
  STG: 'STAGING',
  LIVE: 'PROD',
};

const ENV_CANONICAL = LEGACY_ALIAS[RAW_ENV] ?? RAW_ENV;

interface EnvColorConfig {
  sidebar: string;
  text?: string;
  sidebarWidth: number;
  label: string;
}

const ENV_COLORS: Record<string, EnvColorConfig | null> = {
  SANDBOX: { sidebar: 'var(--env-sandbox-color, #64748b)', sidebarWidth: 6, label: 'SANDBOX' },
  STAGING: { sidebar: 'var(--env-staging-color, #3b82f6)', sidebarWidth: 6, label: 'STAGING' },
  PILOT:   { sidebar: 'var(--env-pilot-color, #8b5cf6)', sidebarWidth: 6, label: 'PILOT' },
  PROD:    { sidebar: 'var(--env-prod-color, #F5B856)', text: 'var(--login-navy, #1F1B4A)', sidebarWidth: 6, label: 'PROD' },
};

const ENV_CONFIG = ENV_COLORS[ENV_CANONICAL];

if (!ENV_CONFIG) {
  console.warn(`⚠️ Unknown NEXT_PUBLIC_APP_ENV: "${RAW_ENV}". Valid values: SANDBOX | STAGING | PILOT | PROD (legacy DEV/TEST/STG/LIVE also accepted).`);
}

/** Canonical env name (SANDBOX/STAGING/PILOT/PROD) */
export const envCanonical = ENV_CANONICAL;

/** DB target ('sandbox' | 'staging' | 'pilot' | null) — set when sandbox VM is pointed at a non-sandbox DB */
export const envDbTarget: string | null = DB_TARGET || null;

/** Whether an environment badge should be shown */
export const showEnvBanner = ENV_CONFIG != null;

/** Whether this is a non-production environment */
export const isNonProd = ENV_CANONICAL !== 'PROD';

/** Environment accent color (null if unknown env) */
export const envSidebarColor = ENV_CONFIG?.sidebar ?? null;

/** Environment text color override (null = white) */
export const envTextColor = ENV_CONFIG?.text ?? null;

/** Short label for the environment (null if unknown env) */
export const envLabel = ENV_CONFIG?.label ?? null;

/** Color for the DB-target ring (CSS var) — used on UserAvatar when DB target differs from env */
export function dbTargetColor(target: string | null): string | null {
  if (!target) return null;
  const key = target.toUpperCase();
  return ENV_COLORS[key]?.sidebar ?? null;
}

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
    if (ENV_CANONICAL === 'PROD') return;
    const isLocal = isLocalhost();
    let label: string;
    if (isLocal) {
      // VM. If DB is switched to another env, show "VM→PILOT" / "VM→STAGING".
      const target = (envDbTarget || '').toUpperCase();
      label = target && target !== 'SANDBOX' ? `VM→${target}` : 'VM';
    } else {
      label = ENV_CANONICAL;
    }
    const base = document.title.replace(/^\[(VM|VM→\w+|SANDBOX|STAGING|PILOT|PROD|DEV|TEST|STG|LIVE)\]\s*/, '');
    document.title = `[${label}] ${base || 'HFF'}`;
  }, []);

  return null;
}
