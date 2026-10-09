import { describe, expect, it } from "vitest";
import {
  afterHarvest,
  afterManure,
  afterWeather,
  type CropSpec,
  fallowDays,
  freshParcel,
  parcelYield,
} from "./parcel.ts";

const WHEAT: CropSpec = { uptake: { n: 0.2, p: 0.1, k: 0.1 }, saltTolerance: 0.3 };
const BEAN: CropSpec = { uptake: { n: 0.05, p: 0.1, k: 0.1 }, fixesN: 1, saltTolerance: 0.2 };

describe("suelo por parcela", () => {
  it("cosechar sin devolver baja el rendimiento y manda el nutriente más escaso", () => {
    let s = freshParcel("loam", 40);
    const y0 = parcelYield(s, WHEAT);
    for (let i = 0; i < 4; i++) s = afterHarvest(s, WHEAT, 1);
    expect(parcelYield(s, WHEAT)).toBeLessThan(y0);
    expect(s.fertility.n).toBeLessThan(s.fertility.p);
  });

  it("el barbecho y el abono recuperan, sin pasar el tope", () => {
    let s = freshParcel("loam", 40);
    for (let i = 0; i < 4; i++) s = afterHarvest(s, WHEAT, 1);
    const tired = s.fertility.n;
    expect(fallowDays(s, 365).fertility.n).toBeGreaterThan(tired);
    const fed = afterManure(s, 20, 1);
    expect(fed.fertility.n).toBeGreaterThan(tired);
    expect(fed.fertility.n).toBeLessThanOrEqual(1);
  });

  it("la leguminosa gasta menos nitrógeno que el trigo", () => {
    const s = freshParcel("loam", 40);
    expect(afterHarvest(s, BEAN, 1).fertility.n).toBeGreaterThan(
      afterHarvest(s, WHEAT, 1).fertility.n,
    );
  });

  it("la erosión se lleva suelo en la ladera sin cobertura y no vuelve; la arena lava más", () => {
    const wear = {
      heavyRainDays: 30,
      slope: 1,
      cover: 0,
      irrigatedDays: 0,
      drained: true,
      arid: false,
    };
    const s = freshParcel("loam", 40);
    const bare = afterWeather(s, wear);
    expect(bare.depth).toBeLessThan(s.depth);
    expect(afterWeather(s, { ...wear, cover: 0.9 }).depth).toBeGreaterThan(bare.depth);
    expect(fallowDays(bare, 1000).depth).toBe(bare.depth);
    const sand = afterWeather(freshParcel("sand", 40), wear);
    expect(sand.fertility.n / freshParcel("sand", 40).fertility.n).toBeLessThan(
      bare.fertility.n / s.fertility.n,
    );
  });

  it("regar sin drenaje en clima seco saliniza y baja el rendimiento", () => {
    let s = freshParcel("loam", 40);
    const dry = {
      heavyRainDays: 0,
      slope: 0,
      cover: 0,
      irrigatedDays: 100,
      drained: false,
      arid: true,
    };
    for (let i = 0; i < 10; i++) s = afterWeather(s, dry);
    expect(s.salinity).toBeGreaterThan(0.3);
    expect(parcelYield(s, WHEAT)).toBeLessThan(parcelYield(freshParcel("loam", 40), WHEAT));
  });

  it("sin suelo útil no rinde", () => {
    expect(parcelYield(freshParcel("rocky", 3), WHEAT)).toBe(0);
  });
});
