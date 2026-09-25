import { afterEach, describe, expect, test } from "bun:test";
import { explainBlunder } from "../routes/analyze";

const post = (body: string) =>
  new Request("http://x/api/analyze/blunder", { method: "POST", body });

describe("explainBlunder adapter", () => {
  const saved = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = saved;
  });

  test("missing GEMINI_API_KEY is a 503 JSON error, not a 200 'Coach unavailable' card", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await explainBlunder(post("{}"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/GEMINI_API_KEY/);
  });

  test("invalid JSON body is a 400", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const res = await explainBlunder(post("{not json"));
    expect(res.status).toBe(400);
  });

  test("valid JSON with missing fields is a 400 from the core", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const res = await explainBlunder(post(JSON.stringify({ fen: "" })));
    expect(res.status).toBe(400);
  });
});
