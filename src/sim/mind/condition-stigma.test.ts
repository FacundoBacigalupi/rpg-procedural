import { describe, expect, it } from "vitest";
import type { EventId } from "../../core/index.ts";
import {
  familyHides,
  type MentalLabelDef,
  STIGMA_DAILY_KEEP,
  stepStigma,
  stigmaFrom,
  stigmaStanding,
} from "./condition-labels.ts";

const def = (
  theory: string,
  kind: MentalLabelDef["kind"],
  stigma: number,
  treatment: MentalLabelDef["treatment"] = "none",
): MentalLabelDef => ({
  id: `${theory}.${kind}`,
  theory,
  kind,
  name: "x",
  treatment,
  stigma,
  help: 0,
});
const defs = [
  def("plain", "depression", 0.1),
  def("weakness", "depression", 0.8),
  def("weakness", "addiction", 0.5, "confinement"),
  def("plain", "addiction", 0.5),
];
const ev = "e1" as EventId;

describe("estigma de la condición", () => {
  it("lo pone cada uno con su teoría, escalado por la gravedad", () => {
    const c = { kind: "depression", severity: 0.5 };
    expect(stigmaFrom(defs, "weakness", c)).toBe(0.4);
    expect(stigmaFrom(defs, "plain", c)).toBe(0.05);
    expect(stigmaFrom(defs, undefined, c)).toBe(0.05);
    expect(stigmaFrom(defs, "weakness", { kind: "fever", severity: 1 })).toBe(0);
  });

  it("la familia esconde solo con un trato que saca de la vista", () => {
    expect(familyHides(defs, ["weakness"], "addiction")).toBe(true);
    expect(familyHides(defs, ["plain", "weakness"], "addiction")).toBe(true);
    expect(familyHides(defs, ["plain"], "addiction")).toBe(false);
    expect(familyHides(defs, [], "addiction")).toBe(false);
  });

  it("lo de hoy pisa lo anterior y lo que ya no se ve se va olvidando", () => {
    const a = stepStigma(undefined, { b: 0.4, a: 0.2 }, ev);
    expect(Object.keys(a?.by ?? {})).toEqual(["a", "b"]);
    const b = stepStigma(a, { a: 0.3 }, "e2" as EventId);
    expect(b?.by["a"]).toBe(0.3);
    expect(b?.by["b"]).toBeCloseTo(0.4 * STIGMA_DAILY_KEEP, 6);
    expect(b?.originEventId).toBe(ev);
    let s = b;
    for (let i = 0; i < 80; i++) s = stepStigma(s, {}, ev);
    expect(s).toBeUndefined();
  });

  it("la reputación de estigma es la media sobre la comunidad", () => {
    const s = stepStigma(undefined, { a: 0.4, b: 0.2 }, ev);
    expect(stigmaStanding(s, 4)).toBe(0.15);
    expect(stigmaStanding(undefined, 4)).toBe(0);
    expect(stigmaStanding(s, 0)).toBe(0);
  });
});
