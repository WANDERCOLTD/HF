import { describe, it, expect, vi, afterEach } from "vitest";

import { GET } from "@/app/api/system/db-target/route";

describe("GET /api/system/db-target", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    vi.stubEnv("DATABASE_URL", original ?? "");
    vi.unstubAllEnvs();
  });

  async function callAndParse() {
    const res = await GET();
    return res.json();
  }

  it("extracts target=sandbox from hf_sandbox URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@h:5432/hf_sandbox?schema=public");
    const body = await callAndParse();
    expect(body).toEqual({ ok: true, dbTarget: "sandbox", dbName: "hf_sandbox" });
  });

  it("extracts target=staging from hf_staging URL", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@h:5432/hf_staging?schema=public");
    const body = await callAndParse();
    expect(body).toEqual({ ok: true, dbTarget: "staging", dbName: "hf_staging" });
  });

  it("collapses legacy hf_dev → sandbox target", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@h:5432/hf_dev?schema=public");
    const body = await callAndParse();
    expect(body).toEqual({ ok: true, dbTarget: "sandbox", dbName: "hf_dev" });
  });

  it("returns dbTarget=null when URL points at an unrecognised DB", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@h:5432/some_other_db?schema=public");
    const body = await callAndParse();
    expect(body).toEqual({ ok: true, dbTarget: null, dbName: "some_other_db" });
  });

  it("returns both nulls when DATABASE_URL is unset", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const body = await callAndParse();
    expect(body).toEqual({ ok: true, dbTarget: null, dbName: null });
  });
});
