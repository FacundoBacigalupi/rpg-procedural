import { describe, expect, it } from "vitest";
import { panelOptionsOf } from "./panels.ts";

describe("panelOptionsOf", () => {
  it("sin opciones activas no agrega nada", () => {
    expect(panelOptionsOf({})).toEqual({});
    expect(panelOptionsOf({ objectCues: true, consumables: [{ good: "tea" }] })).toEqual({});
  });

  it("las señales por objeto piden ansia, huso local y consumibles", () => {
    const base = { consumables: [{ good: "tea" }, { good: "wine" }], objectCues: true };
    expect(panelOptionsOf({ ...base, cravingCues: true })).toEqual({});
    expect(panelOptionsOf({ ...base, cravingCues: true, cueLocal: true })).toEqual({
      cueLocal: true,
      objectCues: ["tea", "wine"],
    });
    expect(panelOptionsOf({ cravingCues: true, cueLocal: true, objectCues: true })).toEqual({
      cueLocal: true,
    });
  });

  it("viewCues pasa solo con ansia, huso, objectCues y consumibles", () => {
    const viewCues = { stalls: () => [] };
    const on = {
      consumables: [{ good: "tea" }],
      cravingCues: true,
      cueLocal: true,
      objectCues: true,
    };
    expect(panelOptionsOf({ ...on, viewCues })).toEqual({
      cueLocal: true,
      objectCues: ["tea"],
      viewCues,
    });
    expect(panelOptionsOf({ ...on, objectCues: false, viewCues })).toEqual({ cueLocal: true });
  });

  it("el residuo pasa tal cual", () => {
    const residue = {} as never;
    expect(panelOptionsOf({ residue })).toEqual({ residue });
  });
});
