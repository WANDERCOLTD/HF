import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

// Read version from package.json at build time
const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));
const APP_VERSION: string = pkg.version;

// ---------------------------------------------------------------------------
// Security Headers
// ---------------------------------------------------------------------------

/**
 * Build Content-Security-Policy directives.
 * Starts as Report-Only — switch to enforcing after validation.
 * TODO: Replace 'unsafe-inline' for scripts with nonce-based approach.
 */
function buildCSP(): string {
  const directives = [
    "default-src 'self'",
    // 'unsafe-inline' needed for themeInitScript in layout.tsx (flash prevention)
    // Tighten with nonce or hash after validating Report-Only
    "script-src 'self' 'unsafe-inline'",
    // Tailwind and MUI generate inline styles
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // audio/video blob: URLs for voice sim TTS playback
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
  // CSP_ENFORCE=true → enforcing, otherwise Report-Only (safe default)
  {
    key: process.env.CSP_ENFORCE === "true"
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only",
    value: buildCSP(),
  },
];

// ---------------------------------------------------------------------------
// Next.js Config
// ---------------------------------------------------------------------------

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  typescript: {
    ignoreBuildErrors: true, // TODO: revert to false after schema migration lands
  },
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  // Exclude logs folder from file watching to prevent HMR loops
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/logs/**",
          "**/*.jsonl",
        ],
      };
    }
    return config;
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
