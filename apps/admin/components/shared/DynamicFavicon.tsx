'use client';

import { useEffect } from 'react';

/**
 * Dynamic favicon — HFF monogram colored by environment.
 *
 * SANDBOX (VM/local):  Teal background (#06b6d4)
 * STAGING (Cloud Run): Blue background (#3b82f6)
 * PILOT (Cloud Run):   Purple background (#8b5cf6)
 * PROD (Cloud Run):    Navy background (#1F1B4A) with gold "HFF" text
 *
 * Legacy DEV/TEST/STG/LIVE values are mapped to the canonical names.
 * Replaces the default Next.js triangle favicon at runtime.
 */

const RAW_ENV = (process.env.NEXT_PUBLIC_APP_ENV || 'SANDBOX').toUpperCase();

const LEGACY_ALIAS: Record<string, string> = {
  DEV: 'STAGING',
  TEST: 'PILOT',
  STG: 'STAGING',
  LIVE: 'PROD',
};

const ENV_CANONICAL = LEGACY_ALIAS[RAW_ENV] ?? RAW_ENV;

interface EnvFaviconConfig {
  bg: string;
  text: string;
}

const ENV_FAVICON: Record<string, EnvFaviconConfig> = {
  SANDBOX: { bg: '#06b6d4', text: '#ffffff' },
  STAGING: { bg: '#3b82f6', text: '#ffffff' },
  PILOT:   { bg: '#8b5cf6', text: '#ffffff' },
  PROD:    { bg: '#1F1B4A', text: '#F5B856' },
};

function generateFaviconSVG(config: EnvFaviconConfig): string {
  const { bg, text } = config;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="6" fill="${bg}"/>
  <text x="16" y="17" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="800"
        letter-spacing="-0.5" fill="${text}">HFF</text>
</svg>`;
}

function setFavicon(svg: string) {
  const encoded = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  const existing = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
  existing.forEach((el) => el.remove());

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = encoded;
  document.head.appendChild(link);
}

export default function DynamicFavicon() {
  useEffect(() => {
    const isLocal = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
    // Cloud Run "STAGING" deploy when accessed from VM via SSH tunnel
    // (localhost:3000) is still SANDBOX visually — distinct teal favicon.
    const key = isLocal ? 'SANDBOX' : ENV_CANONICAL;
    const config = ENV_FAVICON[key] || ENV_FAVICON.SANDBOX;
    const svg = generateFaviconSVG(config);
    setFavicon(svg);
  }, []);

  return null;
}
