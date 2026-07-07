import { describe, expect, it } from "vitest";
import { corsOriginFor, parseCorsOrigins } from "./http.ts";

describe("HTTP helpers", () => {
  it("parses comma-separated CORS origins without emitting an invalid combined origin", () => {
    const origins = parseCorsOrigins("http://localhost:5173, http://192.168.86.30:5173");

    expect(origins).toEqual(["http://localhost:5173", "http://192.168.86.30:5173"]);
    expect(corsOriginFor(origins, "http://192.168.86.30:5173")).toBe("http://192.168.86.30:5173");
    expect(corsOriginFor(origins, "http://evil.example")).toBeUndefined();
  });

  it("supports wildcard and non-browser requests", () => {
    expect(corsOriginFor(["*"], "http://anything.example")).toBe("*");
    expect(corsOriginFor(["http://localhost:5173"], undefined)).toBe("http://localhost:5173");
  });
});
