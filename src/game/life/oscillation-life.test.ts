// life-29: el mapa de la aldea guarda la cuenca y la teleconexión; con `legacyNoOscillation`
// (replay de motores anteriores) no, y el clima y la cosecha vuelven a ser los de siempre.
// Arma el mapa desde el planeta y el sitio (sin la pre-corrida de la población, que es pesada).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, loadContent, Rng } from "../../core/index.ts";
import { anomalyOfMap, harvestSeason, oscillationYearOfMap, weatherAt } from "../../sim/index.ts";
import { BIOMES, generatePlanet, villageSite } from "../../worldgen/index.ts";
import { engineOptions } from "./life.ts";
import { localMapOf } from "./map.ts";

const biomes = loadContent(
  [BIOMES],
  [
    {
      kind: "biomes",
      file: "content/biomes/whittaker.json",
      data: JSON.parse(readFileSync("content/biomes/whittaker.json", "utf8")),
    },
  ],
).all(BIOMES);
const clock = EARTHLIKE_CLOCK;
const yearDays = Math.round(clock.year / clock.day);

function mapsOf(seed: number) {
  const planet = generatePlanet({ seed, biomes });
  const site = villageSite(planet);
  return { on: localMapOf(planet, site), off: localMapOf(planet, site, true) };
}

describe("oscilación en la aldea (life-29)", () => {
  // Busca un seed cuya aldea tenga cuenca con teleconexión apreciable.
  const found = [1, 2, 3, 4]
    .map((seed) => ({ seed, ...mapsOf(seed) }))
    .find((x) => Math.abs(x.on.oscillation?.teleconnection ?? 0) > 0.05);

  it("el mapa guarda {basin, teleconnection} y es determinista", () => {
    expect(found).toBeDefined();
    const { seed, on } = found as NonNullable<typeof found>;
    expect(mapsOf(seed).on.oscillation).toEqual(on.oscillation);
    expect(on.oscillation?.basin).toMatch(/^basin-/);
  });

  it("con legacyNoOscillation (motores < life-29) no hay cuenca ni anomalía", () => {
    const { seed, on, off } = found as NonNullable<typeof found>;
    expect(engineOptions("life-28", {}).legacyNoOscillation).toBe(true);
    expect(engineOptions("life-29", {}).legacyNoOscillation).toBeUndefined();
    expect(off.oscillation).toBeUndefined();
    expect(anomalyOfMap(off, clock, seed)).toBeUndefined();
    // Lo demás del mapa es igual.
    expect({ ...on, oscillation: undefined }).toEqual({ ...off, oscillation: undefined });
  });

  it("con oscilación el tiempo y la cosecha de algún año difieren; sin ella son los de siempre", () => {
    const { seed, on, off } = found as NonNullable<typeof found>;
    const root = Rng.root(seed);
    const withOsc = harvestSeason(on.climate, clock, root, anomalyOfMap(on, clock, seed));
    const without = harvestSeason(off.climate, clock, root, anomalyOfMap(off, clock, seed));
    let weatherDiff = 0;
    let harvestDiff = 0;
    for (let y = 0; y < 10; y++) {
      const day = y * yearDays + 150;
      if (withOsc(day) !== without(day)) harvestDiff++;
      const tick = day * clock.day;
      if (
        JSON.stringify(weatherAt(on, clock, seed, tick)) !==
        JSON.stringify(weatherAt(off, clock, seed, tick))
      )
        weatherDiff++;
    }
    expect(weatherDiff).toBeGreaterThan(0);
    expect(harvestDiff).toBeGreaterThan(0);
  });

  it("oscillationYearOfMap (life-34) coincide con anomalyOfMap y cita la fase de la cuenca", () => {
    const { seed, on, off } = found as NonNullable<typeof found>;
    let seen = 0;
    for (let y = 0; y < 12; y++) {
      const day = y * yearDays + 100;
      const o = oscillationYearOfMap(on, clock, seed, day);
      expect(o?.cause.basin).toBe(on.oscillation?.basin);
      expect(o?.cause.year).toBe(y);
      expect(o?.precipFactor).toBe(anomalyOfMap(on, clock, seed)?.(day).precipFactor);
      expect(oscillationYearOfMap(on, clock, seed, day)).toEqual(o);
      if (o?.effect === "dry") expect(o.precipFactor).toBeLessThan(1);
      if (o?.precipFactor !== 1) seen++;
    }
    expect(seen).toBeGreaterThan(0);
    expect(oscillationYearOfMap(off, clock, seed, 100)).toBeUndefined();
  });
});
