/**
 * Demo Registry
 *
 * Static JSON imports for demo specs. No runtime filesystem reads,
 * consistent with project pattern of eliminating runtime FS access.
 *
 * To add a new demo:
 * 1. Create a JSON file in lib/demo/content/
 * 2. Import it here
 * 3. Add to DEMO_REGISTRY
 */

import type { DemoSpec } from "./types";
import demoTutor001 from "./content/DEMO-TUTOR-001.demo.json";
import demoCaller001 from "./content/DEMO-CALLER-001.demo.json";
import demoContent001 from "./content/DEMO-CONTENT-001.demo.json";
import demoSim001 from "./content/DEMO-SIM-001.demo.json";
import demoPlaybook001 from "./content/DEMO-PLAYBOOK-001.demo.json";
import demoGoals001 from "./content/DEMO-GOALS-001.demo.json";
import demoAdapt001 from "./content/DEMO-ADAPT-001.demo.json";
import demoHarness001 from "./content/DEMO-HARNESS-001.demo.json";
import demoPipeline001 from "./content/DEMO-PIPELINE-001.demo.json";
import demoSpec001 from "./content/DEMO-SPEC-001.demo.json";

const DEMO_REGISTRY: Record<string, DemoSpec> = {
  "DEMO-TUTOR-001": demoTutor001 as unknown as DemoSpec,
  "DEMO-CALLER-001": demoCaller001 as unknown as DemoSpec,
  "DEMO-CONTENT-001": demoContent001 as unknown as DemoSpec,
  "DEMO-SIM-001": demoSim001 as unknown as DemoSpec,
  "DEMO-PLAYBOOK-001": demoPlaybook001 as unknown as DemoSpec,
  "DEMO-GOALS-001": demoGoals001 as unknown as DemoSpec,
  "DEMO-ADAPT-001": demoAdapt001 as unknown as DemoSpec,
  "DEMO-HARNESS-001": demoHarness001 as unknown as DemoSpec,
  "DEMO-PIPELINE-001": demoPipeline001 as unknown as DemoSpec,
  "DEMO-SPEC-001": demoSpec001 as unknown as DemoSpec,
};

/**
 * List all active demos (status = "active").
 */
export function listDemos(): DemoSpec[] {
  return Object.values(DEMO_REGISTRY).filter((d) => d.status === "active");
}

/**
 * Load a specific demo by ID. Returns null if not found.
 */
export function loadDemo(id: string): DemoSpec | null {
  return DEMO_REGISTRY[id] || null;
}

/**
 * List all demos regardless of status (for admin views).
 */
export function listAllDemos(): DemoSpec[] {
  return Object.values(DEMO_REGISTRY);
}
