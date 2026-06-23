import { describe, it, expect } from "vitest";
import { reshapeScores, type AdminCallScoreRow } from "@/lib/hf";

// Representative payload shape captured from
// apps/admin/app/api/calls/scores/route.ts — admin returns raw CallScore
// rows with `call.{source, callerId}` + `parameter.{name, parameterId}`
// joined.
function row(
  callId: string,
  parameterId: string,
  score: number,
  opts: {
    createdAt?: string;
    callerId?: string;
    source?: string;
    label?: string;
  } = {},
): AdminCallScoreRow {
  return {
    callId,
    parameterId,
    score,
    createdAt: opts.createdAt ?? "2026-06-22T10:00:00Z",
    call: {
      source: opts.source ?? "vapi-pstn",
      callerId: opts.callerId ?? "caller-1",
    },
    parameter: { name: opts.label ?? parameterId, parameterId },
  };
}

describe("reshapeScores", () => {
  it("groups (callId, parameterId) rows into one SessionScore per callId", () => {
    const rows: AdminCallScoreRow[] = [
      row("call-A", "skill_fluency_and_coherence_fc", 6, {
        label: "Fluency and Coherence",
      }),
      row("call-A", "skill_lexical_resource_lr", 7, {
        label: "Lexical Resource",
      }),
      row("call-A", "skill_grammatical_range_and_accuracy_gra", 5, {
        label: "Grammatical Range and Accuracy",
      }),
      row("call-A", "skill_pronunciation_p", 6, { label: "Pronunciation" }),
    ];
    const sessions = reshapeScores(rows);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("call-A");
    expect(sessions[0].criteria).toHaveLength(4);
    // Overall = mean of the 4 criterion scores: (6+7+5+6)/4 = 6.0
    expect(sessions[0].overall).toBeCloseTo(6.0);
  });

  it("renders criteria in canonical display order regardless of input order", () => {
    const rows: AdminCallScoreRow[] = [
      // Input order: pronunciation, grammar, lexical, fluency
      row("call-A", "skill_pronunciation_p", 6),
      row("call-A", "skill_grammatical_range_and_accuracy_gra", 5),
      row("call-A", "skill_lexical_resource_lr", 7),
      row("call-A", "skill_fluency_and_coherence_fc", 6),
    ];
    const [session] = reshapeScores(rows);
    expect(session.criteria.map((c) => c.key)).toEqual([
      "fluency",
      "lexical",
      "grammar",
      "pronunciation",
    ]);
  });

  it("resolves the criterion label from the admin response's parameter.name (never a literal)", () => {
    const rows: AdminCallScoreRow[] = [
      row("call-A", "skill_fluency_and_coherence_fc", 6, {
        label: "Fluency and Coherence",
      }),
    ];
    const [session] = reshapeScores(rows);
    expect(session.criteria[0].label).toBe("Fluency and Coherence");
  });

  it("filters out non-IELTS parameterIds (BEH-*, _average sentinels, behaviour rows)", () => {
    const rows: AdminCallScoreRow[] = [
      row("call-A", "skill_fluency_and_coherence_fc", 6),
      row("call-A", "BEH-WARMTH", 0.7),
      row("call-A", "BEH-ABSTRACT-VS-CONCRETE", 0.5),
      row("call-A", "skill_pronunciation_p_average", 5.5),
    ];
    const [session] = reshapeScores(rows);
    expect(session.criteria).toHaveLength(1);
    expect(session.criteria[0].key).toBe("fluency");
  });

  it("drops sessions with zero IELTS criterion rows (no honest overall)", () => {
    const rows: AdminCallScoreRow[] = [
      row("call-A", "BEH-WARMTH", 0.7),
      row("call-A", "BEH-ABSTRACT-VS-CONCRETE", 0.5),
    ];
    const sessions = reshapeScores(rows);
    expect(sessions).toEqual([]);
  });

  it("averages duplicate rows for the same (callId, parameterId) — Mock segments share callId", () => {
    const rows: AdminCallScoreRow[] = [
      // P1 segment
      row("call-mock", "skill_fluency_and_coherence_fc", 5),
      // P2 segment
      row("call-mock", "skill_fluency_and_coherence_fc", 7),
      // P3 segment
      row("call-mock", "skill_fluency_and_coherence_fc", 6),
    ];
    const [session] = reshapeScores(rows);
    // Mean of 5, 7, 6 = 6.0
    expect(session.criteria[0].score).toBeCloseTo(6.0);
  });

  it("scopes by callerId when supplied (filters out cross-caller rows)", () => {
    const rows: AdminCallScoreRow[] = [
      row("call-A", "skill_fluency_and_coherence_fc", 6, {
        callerId: "caller-1",
      }),
      row("call-B", "skill_fluency_and_coherence_fc", 7, {
        callerId: "caller-2",
      }),
    ];
    const sessions = reshapeScores(rows, { callerId: "caller-1" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("call-A");
  });

  it("returns all callers' sessions when no callerId scope is supplied", () => {
    const rows: AdminCallScoreRow[] = [
      row("call-A", "skill_fluency_and_coherence_fc", 6, {
        callerId: "caller-1",
      }),
      row("call-B", "skill_fluency_and_coherence_fc", 7, {
        callerId: "caller-2",
      }),
    ];
    const sessions = reshapeScores(rows);
    expect(sessions).toHaveLength(2);
  });

  it("sorts oldest-first so the Progress page's first/latest derivations are correct", () => {
    const rows: AdminCallScoreRow[] = [
      row("call-B", "skill_fluency_and_coherence_fc", 7, {
        createdAt: "2026-06-22T11:00:00Z",
      }),
      row("call-A", "skill_fluency_and_coherence_fc", 5, {
        createdAt: "2026-06-20T09:00:00Z",
      }),
      row("call-C", "skill_fluency_and_coherence_fc", 8, {
        createdAt: "2026-06-23T08:00:00Z",
      }),
    ];
    const sessions = reshapeScores(rows);
    expect(sessions.map((s) => s.id)).toEqual(["call-A", "call-B", "call-C"]);
  });

  it("infers a short SessionScore.type label from Call.source", () => {
    const rowsVapi: AdminCallScoreRow[] = [
      row("call-A", "skill_fluency_and_coherence_fc", 6, {
        source: "vapi-pstn",
      }),
    ];
    const rowsSim: AdminCallScoreRow[] = [
      row("call-B", "skill_fluency_and_coherence_fc", 6, { source: "sim" }),
    ];
    expect(reshapeScores(rowsVapi)[0].type).toBe("Voice");
    expect(reshapeScores(rowsSim)[0].type).toBe("Sim");
  });

  it("degrades safely on an empty input", () => {
    expect(reshapeScores([])).toEqual([]);
  });
});
