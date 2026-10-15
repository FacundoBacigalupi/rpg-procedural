import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, Rng } from "../../core/index.ts";
import type { ClimateNormals } from "../world/index.ts";
import {
  folkRainChance,
  knownSigns,
  SIGN_HORIZON_DAYS,
  SIGNS,
  type SignId,
  type SignRecord,
  signFaith,
  signLift,
  signRecord,
  signsShowing,
} from "./signs.ts";

const clock = EARTHLIKE_CLOCK;
const normals: ClimateNormals = {
  cell: "c:1",
  latDeg: 45,
  axialTiltDeg: 23.4,
  annualMeanC: 9,
  seasonalRangeC: 22,
  annualPrecipMm: 800,
  windEast: 1,
  windNorth: 0.3,
};

/** El registro de una señal sumado en varios seeds y personas, para que la medida no sea ruido. */
function pooled(id: SignId): SignRecord {
  const acc = { id, shown: 0, hits: 0, rainy: 0, days: 0, rainyDays: 0 };
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = signRecord(id, normals, clock, Rng.root(seed), "yo", 1000, 720);
    acc.shown += r.shown;
    acc.hits += r.hits;
    acc.rainy += r.rainy;
    acc.days += r.days;
    acc.rainyDays += r.rainyDays;
  }
  return acc;
}

describe("señales populares del tiempo", () => {
  const lift = Object.fromEntries(SIGNS.map((d) => [d.id, signLift(pooled(d.id))])) as Record<
    SignId,
    number
  >;

  it("las que miran lo que el modelo liga a la lluvia correlacionan de verdad", () => {
    expect(lift.strong_wind).toBeGreaterThan(0.05);
    expect(lift.heavy_sky).toBeGreaterThan(0.05);
    // «cielo limpio, buen tiempo»: llueve menos de lo normal los días siguientes.
    expect(lift.clear_sky).toBeLessThan(-0.03);
  });

  it("las demás son superstición: casi no se apartan del azar", () => {
    for (const id of ["muggy_air", "red_dusk", "aching_knees", "low_swallows"] as const)
      expect(Math.abs(lift[id] ?? 1)).toBeLessThan(0.05);
  });

  it("una señal buena igual falla: ni siempre acierta ni siempre avisa", () => {
    const r = pooled("heavy_sky");
    expect(r.hits).toBeLessThan(r.shown);
    expect(r.shown).toBeLessThan(r.days);
    expect(r.hits).toBeGreaterThan(0);
  });

  it("el registro sólo cuenta días ya cumplidos: el último mirado deja el plazo entero detrás", () => {
    const r = signRecord("heavy_sky", normals, clock, Rng.root(3), "yo", 500, 300);
    expect(r.days).toBe(300 - SIGN_HORIZON_DAYS + 1);
  });

  it("es determinista", () => {
    const rng = Rng.root(9);
    expect(signsShowing(normals, clock, rng, "yo", 77)).toEqual(
      signsShowing(normals, clock, rng, "yo", 77),
    );
    expect(knownSigns(rng, "aldea")).toEqual(knownSigns(Rng.root(9), "aldea"));
    expect(knownSigns(rng, "aldea")).toHaveLength(4);
    expect(new Set(knownSigns(rng, "aldea")).size).toBe(4);
  });

  it("la fe sale de la tasa de aciertos y no se opina con pocas pruebas", () => {
    const base = { id: "heavy_sky" as const, rainy: 0, days: 100, rainyDays: 30 };
    expect(signFaith({ ...base, shown: 3, hits: 3 })).toBe("unproven");
    expect(signFaith({ ...base, shown: 20, hits: 18 })).toBe("often");
    expect(signFaith({ ...base, shown: 20, hits: 12 })).toBe("sometimes");
    expect(signFaith({ ...base, shown: 20, hits: 5 })).toBe("rarely");
  });

  it("la creencia popular de lluvia sale de la tasa vivida y se invierte con las señales de buen tiempo", () => {
    const rec = (id: SignId, shown: number, hits: number): [SignId, SignRecord] => [
      id,
      { id, shown, hits, rainy: 0, days: 100, rainyDays: 30 },
    ];
    const records = new Map([rec("heavy_sky", 20, 16), rec("clear_sky", 20, 15)]);
    expect(folkRainChance(["heavy_sky"], records)).toBe(0.8);
    expect(folkRainChance(["clear_sky"], records)).toBe(0.25);
    expect(folkRainChance(["aching_knees"], records)).toBeUndefined();
    expect(folkRainChance([], records)).toBeUndefined();
  });
});
