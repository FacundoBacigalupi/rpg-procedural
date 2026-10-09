import { describe, expect, it } from "vitest";
import {
  hearSkill,
  observeSkill,
  opinionError,
  opinionKey,
  reputationOf,
  tellSkill,
} from "./index.ts";

describe("opinión ajena de la habilidad", () => {
  it("ver bien acerca la opinión a lo mostrado y la afirma", () => {
    const a = observeSkill(undefined, 0.6, 0.9, 0.5, 0, 10);
    expect(a.estimate.level).toBeCloseTo(0.6, 5);
    const b = observeSkill(a, 0.6, 0.9, 0.5, 0, 20);
    expect(b.estimate.spread).toBeLessThan(a.estimate.spread);
    expect(b.samples).toBe(2);
    expect(b.sources).toEqual(["observed"]);
  });

  it("ver mal casi no mueve, y un lector entrenado ve más claro", () => {
    const prior = observeSkill(undefined, 0.2, 0.9, 0.5, 0, 1);
    const blurry = observeSkill(prior, 0.8, 0.15, 0.1, 0, 2);
    const clear = observeSkill(prior, 0.8, 0.9, 0.9, 0, 2);
    expect(clear.estimate.level).toBeGreaterThan(blurry.estimate.level);
    expect(blurry.estimate.level).toBeLessThan(0.5);
  });

  it("una pose engaña a quien mira: cree lo mostrado, no lo verdadero", () => {
    const fooled = observeSkill(undefined, 0.2, 0.9, 0.4, 0, 1);
    expect(opinionError(fooled, 0.6)).toBeLessThan(-0.3);
  });

  it("el rumor pesa menos con poca confianza y se pincha con un hecho visto", () => {
    const fame = hearSkill(undefined, { level: 0.9, hops: 2, trust: 0.8, slant: 1 }, 5);
    const doubtful = hearSkill(undefined, { level: 0.9, hops: 2, trust: 0.1 }, 5);
    expect(fame.estimate.spread).toBeLessThan(doubtful.estimate.spread);
    expect(fame.estimate.level).toBeGreaterThan(0.9 - 1e-9);
    const seen = observeSkill(fame, 0.3, 0.9, 0.6, 0, 9);
    expect(seen.estimate.level).toBeLessThan(fame.estimate.level - 0.2);
    expect(seen.sources).toEqual(["rumor", "observed"]);
  });

  it("la reputación pesa por precisión y el rumor que se cuenta se ensancha", () => {
    const sure = observeSkill(undefined, 0.7, 1, 1, 0, 1);
    const vague = hearSkill(undefined, { level: 0.2, hops: 3, trust: 0.3 }, 1);
    const rep = reputationOf([sure, vague]);
    expect(rep?.level).toBeGreaterThan(0.5);
    expect(reputationOf([])).toBeNull();
    expect(tellSkill(sure, 0, 0.9).hops).toBe(1);
  });

  it("la clave junta quién y qué habilidad", () => {
    expect(opinionKey("agent:3", "sword")).toBe("agent:3|sword");
  });
});
