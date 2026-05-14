/**
 * Seed Demo Metering Data
 *
 * Generates ~2,500–3,500 realistic UsageEvent records spanning 30 days.
 * Uses calculateCost() + DEFAULT_COST_RATES directly for consistency
 * with the metering dashboard.
 *
 * Targets:
 * - ~$35-50 total cost
 * - AI ~65% of cost, COMPUTE ~20%, DATABASE ~10%, EXTERNAL ~5%
 * - Weekdays 3× weekends
 * - Realistic sourceOp/model/engine combinations
 */

import { prisma } from "@/lib/prisma";
import { calculateCost, DEFAULT_COST_RATES } from "@/lib/metering/cost-config";

// ─── Event Templates ─────────────────────────────────────────────────

interface EventTemplate {
  category: "AI" | "DATABASE" | "COMPUTE" | "STORAGE" | "EXTERNAL";
  operation: string;
  engine?: string;
  model?: string;
  sourceOp: string;
  unitType: string;
  /** Average quantity per event (actual will vary ±50%) */
  avgQuantity: number;
  /** Weight — higher = more likely to be generated */
  weight: number;
}

const TEMPLATES: EventTemplate[] = [
  // ── AI events (65% of cost) ──
  {
    category: "AI",
    operation: "claude:input",
    engine: "claude",
    model: "claude-sonnet-4-5-20250929",
    sourceOp: "pipeline:run",
    unitType: "1k_tokens",
    avgQuantity: 2400,
    weight: 25,
  },
  {
    category: "AI",
    operation: "claude:output",
    engine: "claude",
    model: "claude-sonnet-4-5-20250929",
    sourceOp: "pipeline:run",
    unitType: "1k_tokens",
    avgQuantity: 800,
    weight: 25,
  },
  {
    category: "AI",
    operation: "claude:input",
    engine: "claude",
    model: "claude-sonnet-4-5-20250929",
    sourceOp: "compose-prompt",
    unitType: "1k_tokens",
    avgQuantity: 1800,
    weight: 10,
  },
  {
    category: "AI",
    operation: "claude:output",
    engine: "claude",
    model: "claude-sonnet-4-5-20250929",
    sourceOp: "compose-prompt",
    unitType: "1k_tokens",
    avgQuantity: 600,
    weight: 10,
  },
  {
    category: "AI",
    operation: "openai:input",
    engine: "openai",
    model: "gpt-4o",
    sourceOp: "chat",
    unitType: "1k_tokens",
    avgQuantity: 1200,
    weight: 5,
  },
  {
    category: "AI",
    operation: "openai:output",
    engine: "openai",
    model: "gpt-4o",
    sourceOp: "chat",
    unitType: "1k_tokens",
    avgQuantity: 400,
    weight: 5,
  },

  // ── COMPUTE events (20% of cost) ──
  {
    category: "COMPUTE",
    operation: "pipeline",
    engine: undefined,
    model: undefined,
    sourceOp: "pipeline:run",
    unitType: "100ms",
    avgQuantity: 4500,
    weight: 15,
  },
  {
    category: "COMPUTE",
    operation: "analysis",
    engine: undefined,
    model: undefined,
    sourceOp: "pipeline:analyze",
    unitType: "100ms",
    avgQuantity: 2200,
    weight: 8,
  },

  // ── DATABASE events (10% of cost) ──
  {
    category: "DATABASE",
    operation: "query",
    engine: "postgres",
    model: undefined,
    sourceOp: "pipeline:run",
    unitType: "ms",
    avgQuantity: 180,
    weight: 12,
  },
  {
    category: "DATABASE",
    operation: "query",
    engine: "postgres",
    model: undefined,
    sourceOp: "admin:browse",
    unitType: "ms",
    avgQuantity: 120,
    weight: 5,
  },

  // ── EXTERNAL events (5% of cost) ──
  {
    category: "EXTERNAL",
    operation: "vapi",
    engine: "vapi",
    model: undefined,
    sourceOp: "voice:call",
    unitType: "count",
    avgQuantity: 1,
    weight: 3,
  },
  {
    category: "EXTERNAL",
    operation: "webhook",
    engine: undefined,
    model: undefined,
    sourceOp: "voice:webhook",
    unitType: "count",
    avgQuantity: 1,
    weight: 2,
  },

  // ── STORAGE events (small) ──
  {
    category: "STORAGE",
    operation: "transcript",
    engine: undefined,
    model: undefined,
    sourceOp: "voice:call",
    unitType: "mb",
    avgQuantity: 15000,
    weight: 2,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────

/** Pseudo-random in range [min, max] */
function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Gaussian-ish random (Box-Muller, truncated) */
function gaussRandom(mean: number, stddev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(1, Math.round(mean + z * stddev));
}

/** Weighted random template selection */
function pickTemplate(templates: EventTemplate[]): EventTemplate {
  const totalWeight = templates.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.random() * totalWeight;
  for (const t of templates) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return templates[templates.length - 1];
}

/** Is this day a weekday? (0=Sun, 6=Sat) */
function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

// ─── Main ────────────────────────────────────────────────────────────

export async function seedDemoMeteringData(): Promise<{
  eventsCreated: number;
  totalCostCents: number;
}> {
  const now = new Date();
  const events: Array<{
    category: "AI" | "DATABASE" | "COMPUTE" | "STORAGE" | "EXTERNAL";
    operation: string;
    userId: string | null;
    callerId: string | null;
    callId: string | null;
    quantity: number;
    unitType: string;
    costCents: number;
    engine: string | null;
    model: string | null;
    sourceOp: string | null;
    metadata: null;
    createdAt: Date;
  }> = [];

  let totalCostCents = 0;

  // Generate events for each of the last 30 days
  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const date = new Date(now);
    date.setDate(date.getDate() - dayOffset);
    date.setHours(0, 0, 0, 0);

    // Weekdays get 3× more events than weekends
    const baseEvents = isWeekday(date) ? randBetween(80, 120) : randBetween(25, 45);

    for (let i = 0; i < baseEvents; i++) {
      const template = pickTemplate(TEMPLATES);

      // Vary quantity ±50% with gaussian distribution
      const quantity = gaussRandom(
        template.avgQuantity,
        template.avgQuantity * 0.3
      );

      // Calculate cost using the same function the dashboard uses
      const rateKey = `${template.category}:${template.operation}`;
      const rate = DEFAULT_COST_RATES[rateKey];
      const costCents = rate
        ? calculateCost(quantity, rate.costPerUnit, rate.unitType)
        : 0;

      totalCostCents += costCents;

      // Random timestamp within the day (weighted toward business hours)
      const hour = isWeekday(date)
        ? gaussRandom(14, 3) // peak at 2pm, spread 3h
        : gaussRandom(12, 4);
      const minute = randBetween(0, 59);
      const second = randBetween(0, 59);

      const eventDate = new Date(date);
      eventDate.setHours(
        Math.max(0, Math.min(23, hour)),
        minute,
        second,
        randBetween(0, 999)
      );

      events.push({
        category: template.category,
        operation: template.operation,
        userId: null,
        callerId: null,
        callId: null,
        quantity,
        unitType: template.unitType,
        costCents,
        engine: template.engine ?? null,
        model: template.model ?? null,
        sourceOp: template.sourceOp ?? null,
        metadata: null,
        createdAt: eventDate,
      });
    }
  }

  // Bulk insert
  const result = await prisma.usageEvent.createMany({ data: events });

  return {
    eventsCreated: result.count,
    totalCostCents: Math.round(totalCostCents * 100) / 100,
  };
}
