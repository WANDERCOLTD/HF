/**
 * Integration Test Setup
 *
 * Unlike unit tests, integration tests run against the actual server and database.
 * No mocking - tests real behavior.
 */

import { beforeAll, afterAll } from 'vitest';

// Base URL for API tests
export const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:3000';

// Helper to make API requests
export async function apiGet(path: string) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  return {
    status: response.status,
    headers: response.headers,
    data: await response.json().catch(() => null),
  };
}

export async function apiPost(path: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    data: await response.json().catch(() => null),
  };
}

// Health check before running integration tests
// Skipped for DB-only tests (journey/) — they manage their own DB connection.
beforeAll(async () => {
  // DB-only tests (e.g., journey/) don't need a running server
  const testPath = expect.getState?.()?.testPath || "";
  if (testPath.includes("/journey/")) {
    console.log("✓ DB-only test — skipping server health check");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/health`);
    if (!response.ok) {
      throw new Error(`Server not responding: ${response.status}`);
    }
    console.log('✓ Server is running');
  } catch (error) {
    console.error('✗ Server is not running. Start with `npm run dev` before running integration tests.');
    throw error;
  }
});
