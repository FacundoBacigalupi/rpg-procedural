import { describe, expect, it } from "vitest";
import {
  type CarrionSource,
  carrionShedding,
  type Reach,
  type ReachTaint,
  reachOrder,
  seepageLoad,
  stepWatercourse,
} from "./watercourse.ts";

const reaches: Reach[] = [
  { id: "mar", downstream: null, flow: 6, lengthKm: 5 },
  { id: "alto", downstream: "medio", flow: 1, lengthKm: 3 },
  { id: "medio", downstream: "mar", flow: 2, lengthKm: 4 },
];
const carcass = (buried: boolean): CarrionSource => ({
  id: "c",
  reach: "alto",
  since: 0,
  buried,
  massKg: 70,
  pathogen: "fiebre",
  cause: "ev1",
});
const DAY = 24;

function run(src: CarrionSource[], days: number): Map<string, ReachTaint> {
  let m = new Map<string, ReachTaint>();
  for (let d = 1; d <= days; d++) m = stepWatercourse(reaches, m, src, d * DAY, DAY);
  return m;
}

describe("watercourse", () => {
  it("el cadáver sube, baja y enterrado no aporta", () => {
    expect(carrionShedding(5, false, 70)).toBeGreaterThan(carrionShedding(1, false, 70));
    expect(carrionShedding(5, false, 70)).toBeGreaterThan(carrionShedding(30, false, 70));
    expect(carrionShedding(5, true, 70)).toBe(0);
    expect(carrionShedding(50, false, 70)).toBe(0);
  });

  it("ordena de aguas arriba a abajo", () => {
    expect(reachOrder(reaches).map((r) => r.id)).toEqual(["alto", "medio", "mar"]);
  });

  it("la carga baja por el río y se diluye", () => {
    const m = run([carcass(false)], 8);
    const alto = m.get("alto")?.load ?? 0;
    const medio = m.get("medio")?.load ?? 0;
    expect(alto).toBeGreaterThan(0);
    expect(medio).toBeGreaterThan(0);
    expect(medio).toBeLessThan(alto);
    expect(m.get("medio")?.cause).toBe("ev1");
  });

  it("enterrado o sin fuentes deja el río limpio, y es determinista", () => {
    expect(run([carcass(true)], 8).size).toBe(0);
    expect(run([], 8).size).toBe(0);
    expect([...run([carcass(false)], 8)]).toEqual([...run([carcass(false)], 8)]);
  });

  it("la carga se asienta cuando la fuente se agota", () => {
    expect(run([carcass(false)], 120).size).toBe(0);
  });

  it("filtración a un pozo vecino", () => {
    const m = run([carcass(false)], 6);
    expect(seepageLoad(m.get("alto"))).toBeGreaterThan(0);
    expect(seepageLoad(undefined)).toBe(0);
  });
});
