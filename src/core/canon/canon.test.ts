import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CanonError, canonicalize, canonicalJson } from "./index.ts";

/** Datos JSON sin `-0` (que se normaliza) ni claves raras de prototipo. */
const data = fc
  .jsonValue()
  .map((v) => JSON.stringify(v))
  .filter((t) => !t.includes('"__proto__"'))
  .map((t) => JSON.parse(t) as unknown);

/** El mismo objeto con las claves en otro orden, a cualquier profundidad. */
function shuffleKeys(v: unknown, flip: boolean): unknown {
  if (Array.isArray(v)) return v.map((x) => shuffleKeys(x, !flip));
  if (v === null || typeof v !== "object") return v;
  const keys = Object.keys(v);
  if (flip) keys.reverse();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = shuffleKeys((v as Record<string, unknown>)[k], !flip);
  return out;
}

describe("canonicalJson", () => {
  it("vuelve igual y es punto fijo", () => {
    fc.assert(
      fc.property(data, (v) => {
        const text = canonicalJson(v);
        expect(JSON.parse(text)).toEqual(v);
        expect(canonicalJson(JSON.parse(text))).toBe(text);
      }),
    );
  });

  it("no depende del orden de las claves", () => {
    fc.assert(
      fc.property(data, fc.boolean(), (v, flip) => {
        expect(canonicalJson(shuffleKeys(v, flip))).toBe(canonicalJson(v));
      }),
    );
  });

  it("los flotantes vuelven exactos", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        const back = JSON.parse(canonicalJson({ x })).x as number;
        expect(Object.is(x, -0) ? back === 0 : Object.is(back, x)).toBe(true);
      }),
    );
  });

  it("ordena por código, omite undefined y escribe -0 como 0", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: -0 }], B: "é" })).toBe(
      '{"B":"é","a":[2,{"c":0}],"b":1}',
    );
    expect(canonicalize({ z: -0, y: undefined })).toEqual({ z: 0 });
  });

  it.each<[string, unknown]>([
    ["NaN", { x: Number.NaN }],
    ["infinito", [Number.POSITIVE_INFINITY]],
    ["undefined en un array", [1, undefined]],
    ["Map", { m: new Map() }],
    ["Date", new Date(0)],
    ["función", { f: () => 1 }],
    ["bigint", 1n],
  ])("rechaza %s", (_, v) => {
    expect(() => canonicalJson(v)).toThrow(CanonError);
  });
});
