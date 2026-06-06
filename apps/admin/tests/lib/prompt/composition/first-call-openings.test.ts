/**
 * first-call-openings template defaults tests (#1195).
 *
 * 8 vitests covering the AC matrix. These exercise the PURE helpers
 * directly — the quickstart.ts integration is covered by manual smoke
 * + the existing composition test suite that runs the full transform.
 */

import { describe, expect, it } from "vitest";

import {
  classifyFirstPhaseIntent,
  hasReturningUserPhrasing,
  renderFirstCallOpening,
  rewriteReturningUserPhrasing,
  RETURNING_USER_HEURISTIC_PATTERNS,
} from "@/lib/prompt/composition/defaults/first-call-openings";

describe("classifyFirstPhaseIntent", () => {
  it("classifies 'Greet the caller warmly' → greet", () => {
    expect(classifyFirstPhaseIntent("Greet the caller warmly")).toBe("greet");
  });

  it("classifies 'Introduce yourself and your role' → introduce", () => {
    expect(classifyFirstPhaseIntent("Introduce yourself and your role")).toBe(
      "introduce",
    );
  });

  it("classifies 'Set expectations for the session' → set-expectations", () => {
    expect(classifyFirstPhaseIntent("Set expectations for the session")).toBe(
      "set-expectations",
    );
  });

  it("classifies 'Learn about the caller's background' → discover", () => {
    expect(
      classifyFirstPhaseIntent("Learn about the caller's background"),
    ).toBe("discover");
  });

  it("classifies 'Understand their goals and motivations' → understand-goals", () => {
    expect(
      classifyFirstPhaseIntent("Understand their goals and motivations"),
    ).toBe("understand-goals");
  });

  it("classifies 'Assess existing knowledge level' → assess-knowledge", () => {
    expect(classifyFirstPhaseIntent("Assess existing knowledge level")).toBe(
      "assess-knowledge",
    );
  });

  it("falls through to unclassified on unfamiliar phrasing", () => {
    expect(classifyFirstPhaseIntent("Sing the alphabet backwards")).toBe(
      "unclassified",
    );
  });

  it("handles empty / undefined gracefully", () => {
    expect(classifyFirstPhaseIntent(undefined)).toBe("unclassified");
    expect(classifyFirstPhaseIntent(null)).toBe("unclassified");
    expect(classifyFirstPhaseIntent("")).toBe("unclassified");
  });
});

describe("renderFirstCallOpening", () => {
  it("produces a warm greet opening with name + subject", () => {
    const out = renderFirstCallOpening({
      intent: "greet",
      callerName: "Pop",
      subjectRef: "The CIO/CTO Standard",
    });
    expect(out).toMatch(/Hi, Pop!/);
    expect(out).toMatch(/CIO\/CTO/);
    // Sanity: never contains the "Welcome back" trap
    expect(out).not.toMatch(/welcome\s+back/i);
    expect(out).not.toMatch(/let'?s revise/i);
  });

  it("handles unknown caller name gracefully", () => {
    const out = renderFirstCallOpening({
      intent: "greet",
      callerName: null,
      subjectRef: "IELTS",
    });
    expect(out).not.toContain("null");
    expect(out).not.toContain(", !");
    expect(out).toMatch(/IELTS/);
  });

  it("set-expectations opening mentions session frame", () => {
    const out = renderFirstCallOpening({
      intent: "set-expectations",
      callerName: "Sam",
      subjectRef: "GCSE Biology",
    });
    expect(out).toMatch(/Sam/);
    expect(out).toMatch(/frame|set/i);
  });

  it("each intent stays within length budget (≤160 chars)", () => {
    const intents = [
      "greet",
      "introduce",
      "set-expectations",
      "discover",
      "understand-goals",
      "assess-knowledge",
      "unclassified",
    ] as const;
    for (const intent of intents) {
      const out = renderFirstCallOpening({
        intent,
        callerName: "Caller With A Long Name",
        subjectRef: "A Very Long Subject Discipline Name",
      });
      expect(out.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("hasReturningUserPhrasing", () => {
  it("catches all 5 documented patterns", () => {
    expect(hasReturningUserPhrasing("Welcome back. Let's revise what you've covered.")).toBe(true);
    expect(hasReturningUserPhrasing("Welcome back")).toBe(true);
    expect(hasReturningUserPhrasing("Let's revise the basics")).toBe(true);
    expect(hasReturningUserPhrasing("Let me know if you want to pick up where we left off")).toBe(true);
    expect(hasReturningUserPhrasing("Last time we worked on X")).toBe(true);
    expect(hasReturningUserPhrasing("you've covered the fundamentals")).toBe(true);
  });

  it("does NOT catch the benign 'Welcome! Glad you're here.' (TL guard)", () => {
    expect(hasReturningUserPhrasing("Welcome! Glad you're here.")).toBe(false);
    expect(hasReturningUserPhrasing("Welcome to the course")).toBe(false);
    expect(hasReturningUserPhrasing("Welcome aboard!")).toBe(false);
  });

  it("does NOT catch 'first revision session' (the word 'revise' must be adjacent to 'let's')", () => {
    // The pattern is /let'?s revise/i — requires the let's prefix
    expect(hasReturningUserPhrasing("This is a revision session.")).toBe(false);
  });

  it("exposes the pattern set for future audit", () => {
    expect(RETURNING_USER_HEURISTIC_PATTERNS.length).toBe(5);
    for (const rx of RETURNING_USER_HEURISTIC_PATTERNS) {
      expect(rx).toBeInstanceOf(RegExp);
    }
  });
});

describe("rewriteReturningUserPhrasing", () => {
  it("emits a first-call-appropriate opening seeded with name + subject", () => {
    const out = rewriteReturningUserPhrasing({
      callerName: "Pop",
      subjectRef: "The CIO/CTO Standard",
    });
    expect(out).toMatch(/Pop/);
    expect(out).toMatch(/CIO\/CTO/);
    expect(out).not.toMatch(/welcome\s+back/i);
    expect(out).not.toMatch(/let'?s revise/i);
    expect(out).not.toMatch(/you'?ve covered/i);
  });

  it("falls back gracefully when subjectRef is null", () => {
    const out = rewriteReturningUserPhrasing({
      callerName: "Sam",
      subjectRef: null,
    });
    expect(out).toMatch(/Sam/);
    expect(out).not.toMatch(/null/);
  });
});

describe("integration matrix — AC 1-8 condensed", () => {
  it("AC1: phases configured → synthesised opening (not the welcomeMessage)", () => {
    // Simulates the cascade outcome: phase 0 goal classified, then rendered.
    const goal = "Greet the caller warmly";
    const intent = classifyFirstPhaseIntent(goal);
    const out = renderFirstCallOpening({
      intent,
      callerName: "Pop",
      subjectRef: "The CIO/CTO Standard",
    });
    expect(intent).toBe("greet");
    expect(out).toMatch(/Pop/);
    expect(out).not.toMatch(/welcome\s+back/i);
  });

  it("AC2: no phases + 'Welcome back' welcomeMessage → rewritten", () => {
    const original = "Welcome back. Let's revise what you've covered.";
    expect(hasReturningUserPhrasing(original)).toBe(true);
    const rewritten = rewriteReturningUserPhrasing({
      callerName: "Pop",
      subjectRef: "The CIO/CTO Standard",
    });
    expect(rewritten).not.toBe(original);
    expect(rewritten).toMatch(/Pop/);
  });

  it("AC8: benign 'Welcome! Glad you're here.' is NOT rewritten (false-positive guard)", () => {
    const benign = "Welcome! Glad you're here.";
    expect(hasReturningUserPhrasing(benign)).toBe(false);
  });
});
