import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));
const APP_VERSION: string = pkg.version;

// ---------------------------------------------------------------------------
// Security Headers (mirrors apps/admin)
// ---------------------------------------------------------------------------

/**
 * Build Content-Security-Policy directives.
 * Starts as Report-Only — switch to enforcing (CSP_ENFORCE=true) after validation.
 */
function buildCSP(): string {
  const directives = [
    "default-src 'self'",
    // 'unsafe-inline' needed for the theme-flash-prevention script in layout.tsx
    "script-src 'self' 'unsafe-inline'",
    // Tailwind generates inline styles
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // audio/video blob: URLs for voice playback
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.vapi.ai",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  return directives.join("; ");
}

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  // HSTS only in production — sending on localhost poisons Safari's cache
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
  {
    key: process.env.CSP_ENFORCE === "true"
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    value: buildCSP(),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
