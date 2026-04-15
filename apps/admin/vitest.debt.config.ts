/**
 * vitest.debt.config.ts
 *
 * Runs ONLY the test files that are currently quarantined in the main
 * vitest.config.ts `exclude` list. Used to track test-debt triage progress
 * without affecting the main `npm run test` gate.
 *
 * Usage:
 *   npm run test:debt
 *
 * Keep the include list synchronised with vitest.config.ts's quarantine
 * block. When a file is fixed and removed from the quarantine, remove it
 * from here too.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    globals: true,
    environment: "jsdom",
    // Run ONLY the quarantined files. Mirror of vitest.config.ts exclude list.
    include: [
      "tests/api/admin-terminology.test.ts",
      "tests/api/content-source-extract.test.ts",
      "tests/api/content-source-import-classify.test.ts",
      "tests/api/content-source-upload.test.ts",
      "tests/api/educator-dashboard.test.ts",
      "tests/api/institution-types.test.ts",
      "tests/api/join-token.test.ts",
      "tests/api/lesson-plan.test.ts",
      "tests/api/pipeline-resilience.test.ts",
      "tests/api/sim-pipeline.test.ts",
      "tests/api/sim-setup.test.ts",
      "tests/api/student-progress.test.ts",
      "tests/lib/aggregate-runner.test.ts",
      "tests/lib/ai-call-coverage.test.ts",
      "tests/lib/auth.test.ts",
      "tests/lib/composition/preamble.test.ts",
      "tests/lib/composition/quickstart.test.ts",
      "tests/lib/composition/trust.test.ts",
      "tests/lib/content-trust/course-ref-bologna.test.ts",
      "tests/lib/content-trust/lesson-planner.test.ts",
      "tests/lib/content-trust/segment-document.test.ts",
      "tests/lib/curriculum-runner.test.ts",
      "tests/lib/domain-readiness.test.ts",
      "tests/lib/domain/course-setup.test.ts",
      "tests/lib/embeddings.test.ts",
      "tests/lib/extraction-retry.test.ts",
      "tests/lib/issue-140-entity-hierarchy-consistency.test.ts",
      "tests/lib/route-auth-coverage.test.ts",
      "tests/ops/pipeline-manifest.test.ts",
    ],
    exclude: ["node_modules", ".next"],
    setupFiles: ["./tests/setup.ts"],
  },
});
