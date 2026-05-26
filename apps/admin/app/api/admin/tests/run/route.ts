import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { requireAuth, isAuthError } from "@/lib/permissions";

// Store for active test runs
const activeRuns = new Map<string, {
  status: "running" | "completed" | "failed";
  output: string[];
  startedAt: Date;
  completedAt?: Date;
  exitCode?: number;
}>();

/**
 * @api POST /api/admin/tests/run
 * @visibility internal
 * @scope admin:write
 * @auth bearer
 * @tags admin
 * @description Start a Playwright test run with optional file, project, and test name filters
 * @body file string - Optional test file to run
 * @body project string - Optional Playwright project name
 * @body testName string - Optional test name filter (grep)
 * @response 200 { ok: true, runId: string, message: "Test run started", command: string }
 * @response 500 { ok: false, error: "..." }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth("ADMIN");
    if (isAuthError(authResult)) return authResult.error;

    const body = await request.json().catch(() => ({}));
    const { file, project, testName } = body;

    const runId = `run-${Date.now()}`;
    const adminRoot = path.resolve(process.cwd());

    // Build the command
    const args = ["playwright", "test"];

    if (file) {
      args.push(file);
    }

    if (project) {
      args.push(`--project=${project}`);
    }

    if (testName) {
      args.push("-g", testName);
    }

    // Add reporter for JSON output
    args.push("--reporter=list,json");

    // Initialize run state
    activeRuns.set(runId, {
      status: "running",
      output: [],
      startedAt: new Date(),
    });

    // Spawn the process
    const child = spawn("npx", args, {
      cwd: adminRoot,
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    child.stdout.on("data", (data) => {
      const run = activeRuns.get(runId);
      if (run) {
        run.output.push(data.toString());
      }
    });

    child.stderr.on("data", (data) => {
      const run = activeRuns.get(runId);
      if (run) {
        run.output.push(`[stderr] ${data.toString()}`);
      }
    });

    child.on("close", (code) => {
      const run = activeRuns.get(runId);
      if (run) {
        run.status = code === 0 ? "completed" : "failed";
        run.completedAt = new Date();
        run.exitCode = code ?? undefined;
      }
    });

    return NextResponse.json({
      ok: true,
      runId,
      message: "Test run started",
      command: `npx ${args.join(" ")}`,
    });
  } catch (error: any) {
    console.error("Error starting test run:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to start tests" },
      { status: 500 }
    );
  }
}

/**
 * @api GET /api/admin/tests/run
 * @visibility internal
 * @scope admin:read
 * @auth bearer
 * @tags admin
 * @description Get status of a specific test run by ID, or list all runs if no runId provided
 * @query runId string - Optional run ID to get status for
 * @response 200 { ok: true, runId: string, status: string, output: string, ... }
 * @response 404 { ok: false, error: "Run not found" }
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth("ADMIN");
  if (isAuthError(authResult)) return authResult.error;

  const runId = request.nextUrl.searchParams.get("runId");

  if (!runId) {
    // Return list of all runs
    const runs = Array.from(activeRuns.entries()).map(([id, run]) => ({
      id,
      ...run,
      output: run.output.length, // Just count, not full output
    }));

    return NextResponse.json({ ok: true, runs });
  }

  const run = activeRuns.get(runId);

  if (!run) {
    return NextResponse.json(
      { ok: false, error: "Run not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    runId,
    status: run.status,
    output: run.output.join(""),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    exitCode: run.exitCode,
    duration: run.completedAt
      ? run.completedAt.getTime() - run.startedAt.getTime()
      : Date.now() - run.startedAt.getTime(),
  });
}
