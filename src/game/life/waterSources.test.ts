import { describe, expect, it } from "vitest";
import { hexKindsFromTerrain, resolveWaterSources, waterAt, waterHooks } from "./waterSources.ts";

describe("waterAt", () => {
  it("en el sitio bebe el pozo, y hervirlo mata la carga", () => {
    const raw = waterAt({}, { hex: 3, space: "s" }, 0.5);
    const boiled = waterAt({ treatment: "boil" }, { hex: 3, space: "s" }, 0.5);
    expect(raw.treated).toBe(0);
    expect(boiled.treated).toBeGreaterThan(0.9);
  });
  it("a campo abierto usa la fuente del hex, por defecto río, y el mar es salado", () => {
    const cfg = { hexKinds: new Map([[7, "sea" as const]]) };
    expect(waterAt(cfg, { hex: 7 }, 0).salinity).toBeGreaterThan(0.5);
    expect(waterAt(cfg, { hex: 1 }, 0).load).toBeGreaterThan(0);
  });

  it("con lluvia a campo abierto se bebe lluvia; el mar y el pozo no cambian; sin gancho, igual", () => {
    const cfg = {
      hexKinds: new Map([[7, "sea" as const]]),
      rainingAt: (now: number) => now === 5,
    };
    expect(waterAt(cfg, { hex: 1 }, 0, 5).turbidity).toBeLessThan(0.05);
    expect(waterAt(cfg, { hex: 1 }, 0, 6).turbidity).toBeGreaterThanOrEqual(0.1);
    expect(waterAt(cfg, { hex: 7 }, 0, 5).salinity).toBeGreaterThan(0.5);
    expect(waterAt({}, { hex: 1 }, 0, 5)).toEqual(waterAt({}, { hex: 1 }, 0));
  });
});

describe("agua hervida con el verbo boil", () => {
  const truth = (until: number) =>
    ({
      get: (t: { name: string }) =>
        t.name === "body.treated_water" ? { treatment: "boil", until } : { hex: 1, space: "s" },
    }) as never;
  it("mientras dura, drinkQuality aplica el tratamiento; después, la fuente cruda", () => {
    const h = waterHooks({});
    expect(h.drinkQuality(truth(100), "agent:1" as never, 50).treated).toBeGreaterThan(0.9);
    expect(h.drinkQuality(truth(100), "agent:1" as never, 200).treated).toBe(0);
    expect(h.drinkQuality(truth(100), "agent:1" as never).treated).toBe(0);
  });
});

describe("resolveWaterSources", () => {
  it("sin rainFromWeather no cambia nada; con él arma rainingAt desde el tiempo", () => {
    const map = { lonDeg: 0, climate: { cell: 1 } } as never;
    const off = {};
    expect(resolveWaterSources(off, map, {} as never, 1 as never)).toBe(off);
    const own = { rainFromWeather: true, rainingAt: () => true };
    expect(resolveWaterSources(own, map, {} as never, 1 as never)).toBe(own);
    expect(
      resolveWaterSources({ rainFromWeather: true }, map, {} as never, 1 as never).rainingAt,
    ).toBeTypeOf("function");
  });
  it("waterFor pasa now: con lluvia bebe lluvia", () => {
    const h = waterHooks({ rainingAt: (n) => n === 5 });
    const truth = { get: () => ({ hex: 1 }) } as never;
    expect(h.waterFor(truth, "agent:1" as never, 0, 5).turbidity).toBeLessThan(0.05);
    expect(h.waterFor(truth, "agent:1" as never, 0, 6).turbidity).toBeGreaterThanOrEqual(0.1);
  });
});

describe("hexKindsFromTerrain", () => {
  it("mar, lago y río del terreno; lo seco no entra", () => {
    const m = hexKindsFromTerrain({
      sea: Uint8Array.from([1, 0, 0, 0]),
      lake: Uint8Array.from([0, 1, 0, 0]),
      water: Uint8Array.from([0, 0, 2, 0]),
    });
    expect(m.get(0)).toBe("sea");
    expect(m.get(1)).toBe("stagnant");
    expect(m.get(2)).toBe("river");
    expect(m.has(3)).toBe(false);
  });
});
