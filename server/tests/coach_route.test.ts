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

import { callGeminiJson } from "../routes/analyze";

describe("callGeminiJson key hygiene", () => {
  test("key goes in a header, not the URL", async () => {
    const realFetch = globalThis.fetch;
    let url = "";
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (u: any, init: any) => {
      url = String(u);
      headers = init.headers;
      return Response.json({ candidates: [{ content: { parts: [{ text: "{}" }] } }] });
    }) as any;
    try {
      const out = await callGeminiJson("SECRET123", "p", 1000);
      expect(out).toBe("{}");
      expect(url).not.toContain("key=");
      expect(url).not.toContain("SECRET123");
      expect(headers["x-goog-api-key"]).toBe("SECRET123");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a fetch error carrying the URL never reaches the log with the key", async () => {
    const realFetch = globalThis.fetch;
    const realErr = console.error;
    const logged: unknown[][] = [];
    console.error = (...a: unknown[]) => void logged.push(a);
    globalThis.fetch = (async () => {
      throw new Error("failed https://x/y?key=SECRET123");
    }) as any;
    try {
      // Only name/message strings are logged, with any key= value redacted.
      expect(await callGeminiJson("SECRET123", "p", 1000)).toBeNull();
      expect(logged.length).toBe(1);
      expect(logged[0].every((x) => typeof x === "string")).toBe(true);
      expect(JSON.stringify(logged)).not.toContain("SECRET123");
    } finally {
      globalThis.fetch = realFetch;
      console.error = realErr;
    }
  });
});
