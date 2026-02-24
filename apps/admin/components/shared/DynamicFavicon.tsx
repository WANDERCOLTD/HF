'use client';

import { useEffect } from 'react';

/**
 * Dynamic favicon — HFF monogram colored by environment.
 *
 * DEV (Cloud Run):  Blue background (#3b82f6)
 * DEV (VM/local):   Teal background (#06b6d4) — distinct from Cloud Run DEV
 * TEST:             Purple background (#8b5cf6)
 * STG:              Amber background (#f59e0b)
 * LIVE:             Navy background (#1F1B4A) with gold "HFF" text
 *
 * Replaces the default Next.js triangle favicon at runtime.
 */

const ENV = (process.env.NEXT_PUBLIC_APP_ENV || 'DEV').toUpperCase();

interface EnvFaviconConfig {
  bg: string;
  text: string;
}

const ENV_FAVICON: Record<string, EnvFaviconConfig> = {
  DEV:  { bg: '#3b82f6', text: '#ffffff' },
  /** VM/localhost gets teal — visually distinct from Cloud Run DEV blue */
  VM:   { bg: '#06b6d4', text: '#ffffff' },
  TEST: { bg: '#8b5cf6', text: '#ffffff' },
  STG:  { bg: '#f59e0b', text: '#ffffff' },
  LIVE: { bg: '#1F1B4A', text: '#F5B856' },
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

  // Remove any existing favicons
  const existing = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
  existing.forEach((el) => el.remove());

  // Set new SVG favicon
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
    // VM/localhost DEV gets teal favicon; Cloud Run DEV gets blue
    const key = isLocal && ENV === 'DEV' ? 'VM' : ENV;
    const config = ENV_FAVICON[key] || ENV_FAVICON.DEV;
    const svg = generateFaviconSVG(config);
    setFavicon(svg);
  }, []);

  return null;
}
