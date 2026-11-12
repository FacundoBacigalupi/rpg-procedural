import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AgentId, type EntityRef, type EventId, Rng } from "../../core/index.ts";
import type { Trait } from "../family/index.ts";
import { absorbDraw, absorbWant, mixedPurity, regrown, rootMatch } from "./absorb.ts";
import { breakChance, breakOutcome, breakPreparation } from "./breakthrough.ts";
import { generateCultivationLaw, QI_THRESHOLDS } from "./law.ts";
import type { PlaceQi } from "./meditation.ts";
import {
  BLIND_PREP,
  breaksBlind,
  generateSchool,
  type KnownTechnique,
  METHOD_FACTOR,
  methodCovers,
  realmIndex,
  realmOf,
  type SchoolNames,
  UNGUIDED_TRAMOS,
} from "./school.ts";
import {
  bearingDeg,
  COMPASS8,
  chooseSeat,
  compassOf,
  generateSect,
  sectLoreOf,
  sectMaster,
} from "./sect.ts";
import { aptitudeOf, talentOf } from "./talent.ts";
import { readRoots, TRIAL_ACCEPT_QUALITY, trialAccepts } from "./trial.ts";

const talents = JSON.parse(readFileSync("content/talents/human.json", "utf8")) as Trait[];
const FIVE = { id: "five_phases", elements: ["wood", "fire", "earth", "metal", "water"] };
const E = "event:1" as EventId;
const lawOf = (seed: number) =>
  generateCultivationLaw(Rng.root(seed).fork("cultivation", "law"), FIVE, E);

describe("la ley del cultivo (novel-cult-law)", () => {
  it("mismo seed, misma ley; otro seed, otra escalera", () => {
    expect(lawOf(7)).toEqual(lawOf(7));
    const ladders = new Set(
      [1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(lawOf(s).paths[0]?.thresholds)),
    );
    expect(ladders.size).toBe(6);
  });

  it("la escalera del qi: saturación, capacidad creciente, cuello de botella acotado", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const law = lawOf(seed);
      expect(law.originEventId).toBe(E);
      const ts = law.paths[0]?.thresholds ?? [];
      expect(ts.length).toBeGreaterThanOrEqual(QI_THRESHOLDS[0]);
      expect(ts.length).toBeLessThanOrEqual(QI_THRESHOLDS[1]);
      for (const [i, t] of ts.entries()) {
        expect(t.kind).toBe("saturation");
        expect(t.index).toBe(i);
        expect(t.bottleneck).toBeGreaterThanOrEqual(0.1);
        expect(t.bottleneck).toBeLessThanOrEqual(0.95);
        if (i > 0) expect(t.capacity).toBeGreaterThan(ts[i - 1]?.capacity ?? 0);
      }
      expect(law.rootThreshold).toBeGreaterThan(1);
      expect(law.rootThreshold).toBeLessThan(1.7);
    }
  });
});

describe("el talento (novel-cult-law)", () => {
  const people = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      talentOf(talents, i % 2 ? "male" : "female", undefined, Rng.root(9).fork("t", i), E),
    );

  it("la mayoría no tiene raíz; los que sí, entre una y cinco con afinidades que suman 1", () => {
    const law = lawOf(3);
    const apts = people(2000).map((t) => aptitudeOf(law, t.innate));
    const rooted = apts.filter((a) => a.roots.length > 0);
    expect(rooted.length / apts.length).toBeGreaterThan(0.02);
    expect(rooted.length / apts.length).toBeLessThan(0.25);
    for (const a of apts.filter((x) => x.roots.length === 0)) expect(a.rootQuality).toBe(0);
    for (const a of rooted) {
      expect(a.roots.length).toBeLessThanOrEqual(5);
      const sum = a.roots.reduce((s, r) => s + r.affinity, 0);
      expect(sum).toBeCloseTo(1, 2);
      expect(a.rootQuality).toBeGreaterThan(0);
      expect(a.rootQuality).toBeLessThanOrEqual(1);
    }
  });

  it("se hereda: hijos de padres con raíz la tienen más seguido", () => {
    const law = lawOf(3);
    const pool = people(3000);
    const strong = pool.filter((t) => (t.genome.additive["spirit_root"] ?? 0) > 1);
    const weak = pool.filter((t) => (t.genome.additive["spirit_root"] ?? 0) < -0.5);
    const kids = (ps: typeof pool) =>
      ps.slice(0, 120).map((m, i) => {
        const f = ps[(i + 1) % ps.length] ?? m;
        return aptitudeOf(
          law,
          talentOf(
            talents,
            "female",
            {
              mother: { id: `agent:${i}` as AgentId, genome: m.genome },
              father: { id: `agent:${i + 1000}` as AgentId, genome: f.genome },
            },
            Rng.root(11).fork("kid", i),
            E,
          ).innate,
        );
      });
    const share = (xs: ReturnType<typeof kids>) =>
      xs.filter((a) => a.roots.length > 0).length / xs.length;
    expect(share(kids(strong))).toBeGreaterThan(share(kids(weak)) + 0.1);
  });
});

describe("absorber (novel-cult-absorb)", () => {
  const place: PlaceQi = {
    cell: 1,
    level: 1000,
    reference: 1000,
    regenPerYear: 100,
    elements: { fire: 800, water: 200 },
  };
  const apt = (element: string) => ({
    roots: [{ element, affinity: 1 }],
    rootQuality: 0.8,
    meridians: 0.5,
    comprehension: 0.5,
  });

  it("la raíz que se parece al qi del lugar junta más; sin raíz, nada", () => {
    expect(rootMatch(apt("fire"), place)).toBe(1);
    expect(rootMatch(apt("water"), place)).toBeCloseTo(0.4);
    expect(rootMatch({ ...apt("fire"), roots: [] }, place)).toBe(0);
    const fire = absorbWant(apt("fire"), 4, 1, 1, rootMatch(apt("fire"), place));
    const water = absorbWant(apt("water"), 4, 1, 1, rootMatch(apt("water"), place));
    expect(fire).toBeGreaterThan(water);
    expect(absorbWant({ ...apt("fire"), roots: [] }, 4, 1, 1, 1)).toBe(0);
  });

  it("lo que entra lo acotan la celda y el recipiente", () => {
    expect(absorbDraw(50, place, 0, 0, 100)).toBe(50);
    expect(absorbDraw(50, place, 0, 80, 100)).toBe(20);
    expect(absorbDraw(50, place, 990, 0, 100)).toBe(10);
    expect(absorbDraw(50, place, 0, 100, 100)).toBe(0);
  });

  it("la regeneración repone el débito sin pasarse; la pureza es la mezcla", () => {
    const t = { taken: 60, drawn: 60, at: 0 };
    expect(regrown(t, place, 100, 1000).taken).toBe(50);
    expect(regrown(t, place, 100_000, 1000).taken).toBe(0);
    expect(regrown(t, place, 100_000, 1000).drawn).toBe(60);
    expect(mixedPurity(10, 1, 10, 0)).toBe(0.5);
    expect(mixedPurity(0, 0, 5, 0.7)).toBe(0.7);
  });
});

describe("la ruptura (novel-cult-break)", () => {
  const apt = {
    roots: [{ element: "wood", affinity: 1 }],
    rootQuality: 0.8,
    meridians: 0.5,
    comprehension: 0.5,
  };
  const full = { qi: 100, capacity: 100, purity: 1, calm: 1, meridianDamage: 0, foundation: 0 };

  it("la preparación sube con saturación, pureza y calma; los meridianos dañados la bajan", () => {
    const p = breakPreparation(apt, full);
    expect(breakPreparation(apt, { ...full, qi: 50 })).toBeLessThan(p);
    expect(breakPreparation(apt, { ...full, purity: 0.2 })).toBeLessThan(p);
    expect(breakPreparation(apt, { ...full, calm: 0.5 })).toBeLessThan(p);
    expect(breakPreparation(apt, { ...full, meridianDamage: 0.5 })).toBeLessThan(p);
    expect(breakPreparation({ ...apt, roots: [] }, full)).toBe(0);
  });

  it("la probabilidad es monótona en la preparación y en el cuello de botella", () => {
    const xs = [0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => breakChance(x, 0.3));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] ?? 0);
    expect(breakChance(0.5, 0.2)).toBeGreaterThan(breakChance(0.5, 0.6));
  });

  it("éxito con calidad por el margen; mal preparado, más retroceso y más duro", () => {
    const ok = breakOutcome(0.9, 0.3, 0, 0);
    expect(ok.kind).toBe("success");
    if (ok.kind === "success") expect(ok.quality).toBeGreaterThan(0.5);
    const backlashes = (prep: number) => {
      let n = 0;
      for (let i = 0; i < 100; i++) {
        if (breakOutcome(prep, 0.6, 0.999, i / 100).kind === "backlash") n++;
      }
      return n;
    };
    expect(backlashes(0.1)).toBeGreaterThan(backlashes(0.5));
    const hard = breakOutcome(0, 0.6, 0.999, 0);
    const soft = breakOutcome(0.55, 0.6, 0.999, 0);
    if (hard.kind === "backlash" && soft.kind === "backlash") {
      expect(hard.lostShare).toBeGreaterThan(soft.lostShare);
    } else throw new Error("se esperaban dos retrocesos");
    expect(breakOutcome(0.55, 0.6, 0.999, 0.99).kind).toBe("stalled");
  });
});

describe("la secta cercana (novel-cult-sect-place)", () => {
  it("la sede: la tierra con más qi; empata la más cercana y después el menor id", () => {
    const c = (cell: number, hops: number, level: number, land = true) => ({
      cell,
      hops,
      level,
      land,
    });
    expect(chooseSeat([c(1, 0, 5), c(2, 1, 9), c(3, 2, 99, false)])?.cell).toBe(2);
    expect(chooseSeat([c(4, 2, 9), c(5, 1, 9)])?.cell).toBe(5);
    expect(chooseSeat([c(7, 1, 9), c(6, 1, 9)])?.cell).toBe(6);
    expect(chooseSeat([c(1, 0, 5, false)])).toBeUndefined();
  });

  it("el rumbo desde la aldea: norte 0, este 90, sur 180, oeste 270", () => {
    const o = { lat: 10, lon: 20 };
    expect(bearingDeg(o, { lat: 11, lon: 20 })).toBe(0);
    expect(bearingDeg(o, { lat: 10, lon: 21 })).toBe(90);
    expect(bearingDeg(o, { lat: 9, lon: 20 })).toBe(180);
    expect(bearingDeg(o, { lat: 10, lon: 19 })).toBe(270);
    expect(bearingDeg({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })).toBe(90);
  });

  it("sus cultivadores: todos con raíz, en tramos de la ley, qi bajo la capacidad", () => {
    const seat = {
      cell: 1,
      hops: 1,
      km: 120,
      bearingDeg: 45,
      qi: { cell: 1, level: 1500, reference: 1000, regenPerYear: 100, elements: { wood: 900 } },
    };
    const sectOf = (seed: number) =>
      generateSect({
        rng: Rng.root(seed).fork("sect"),
        law: lawOf(seed),
        talents,
        seat,
        seatPlace: "place:9" as EntityRef,
        now: 1_000_000,
        yearTicks: 1000,
        originEventId: E,
        foundedYearsAgo: 200,
      });
    for (const seed of [1, 2, 3, 4, 5]) {
      const law = lawOf(seed);
      const sect = sectOf(seed);
      expect(sect).toEqual(sectOf(seed));
      expect(sect.founded).toBe(800_000);
      expect(sectMaster(sect)?.rank).toBe("master");
      expect(sect.slots.length).toBeGreaterThanOrEqual(5);
      const ts = law.paths[0]?.thresholds ?? [];
      for (const s of sect.slots) {
        expect(aptitudeOf(law, s.talent.innate).roots.length).toBeGreaterThan(0);
        expect(s.stage).toBeLessThan(ts.length);
        expect(s.qi).toBeLessThanOrEqual(ts[s.stage]?.capacity ?? 0);
        expect(s.purity).toBeGreaterThanOrEqual(0);
        expect(s.purity).toBeLessThanOrEqual(1);
        expect(s.born).toBeLessThan(1_000_000 - 14 * 1000);
      }
    }
  });
});

describe("lo que la aldea sabe de la secta (novel-cult-sect-known)", () => {
  it("el rumbo en ocho puntos", () => {
    expect(compassOf(0)).toBe("n");
    expect(compassOf(350)).toBe("n");
    expect(compassOf(44)).toBe("ne");
    expect(compassOf(90)).toBe("e");
    expect(compassOf(200)).toBe("s");
    expect(compassOf(-90)).toBe("w");
  });

  it("cada uno con su error: casi siempre el rumbo cerca, jornadas alrededor de las reales", () => {
    const sect = {
      seatPlace: "place:9" as EntityRef,
      seat: {
        cell: 1,
        hops: 2,
        km: 200,
        bearingDeg: 45,
        qi: { cell: 1, level: 1, reference: 1, regenPerYear: 1, elements: {} },
      },
      founded: 0,
      originEventId: E,
      slots: [],
    };
    const lores = Array.from({ length: 400 }, (_, i) =>
      sectLoreOf(Rng.root(5).fork("p", i), "org:1" as EntityRef, sect, 10),
    );
    expect(sectLoreOf(Rng.root(5).fork("p", 0), "org:1" as EntityRef, sect, 10)).toEqual(lores[0]);
    const off = (b: string) => {
      const d = Math.abs(COMPASS8.indexOf(b as never) - 1);
      return Math.min(d, 8 - d);
    };
    expect(lores.filter((l) => l.bearing === "ne").length).toBeGreaterThan(200);
    expect(lores.every((l) => off(l.bearing) <= 2)).toBe(true);
    for (const l of lores) {
      expect(l.seat).toBe("place:9");
      expect(l.days).toBeGreaterThanOrEqual(5);
      expect(l.days).toBeLessThanOrEqual(11);
      expect(l.confidence).toBeGreaterThan(0);
      expect(l.confidence).toBeLessThan(0.9);
    }
    expect(new Set(lores.map((l) => l.days)).size).toBeGreaterThan(3);
  });
});

describe("la piedra de prueba (novel-cult-sect-trial)", () => {
  const law = lawOf(3);
  const strong = {
    spirit_root: 3.5,
    root_fire: 2,
    root_wood: 0,
    root_earth: 0,
    root_metal: 0,
    root_water: 0,
  };
  const none = { spirit_root: law.rootThreshold - 2, root_fire: 0 };
  const reads = (innate: Record<string, number>, n = 200) =>
    Array.from({ length: n }, (_, i) => readRoots(law, innate, Rng.root(5).fork("trial", i)));

  it("es determinista y lee con la misma ley", () => {
    const r = readRoots(law, strong, Rng.root(1));
    expect(readRoots(law, strong, Rng.root(1))).toEqual(r);
    expect(r.elements[0]).toBe("fire");
    expect(trialAccepts(r)).toBe(true);
  });

  it("sin raíz casi nunca brilla; con una raíz fuerte casi siempre acepta", () => {
    expect(reads(none).filter((r) => r.elements.length > 0).length).toBe(0);
    const ok = reads(strong).filter(trialAccepts).length;
    expect(ok).toBeGreaterThan(190);
  });

  it("se equivoca cerca del borde: la misma raíz a veces brilla y a veces no", () => {
    const edge = { ...strong, spirit_root: law.rootThreshold + 0.05 };
    const lit = reads(edge).filter((r) => r.elements.length > 0).length;
    expect(lit).toBeGreaterThan(40);
    expect(lit).toBeLessThan(180);
    for (const r of reads(edge)) {
      if (r.elements.length > 0) expect(r.quality).toBeGreaterThan(0);
      expect(trialAccepts(r)).toBe(r.elements.length > 0 && r.quality >= TRIAL_ACCEPT_QUALITY);
    }
  });
});

describe("la escuela (novel-cult-school)", () => {
  const names = JSON.parse(
    readFileSync(new URL("../../../content/schools/xianxia.json", import.meta.url), "utf8"),
  )[0] as SchoolNames;

  it("reparte los umbrales de la ley en reinos contiguos, sin huecos, igual con el mismo seed", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const law = lawOf(seed);
      const n = law.paths[0]?.thresholds.length ?? 0;
      const school = generateSchool(Rng.root(seed), law, names);
      expect(generateSchool(Rng.root(seed), law, names)).toEqual(school);
      expect(school.realms[0]?.from).toBe(0);
      expect(school.realms.at(-1)?.to).toBe(n - 1);
      for (const [i, r] of school.realms.entries()) {
        expect(r.to).toBeGreaterThanOrEqual(r.from);
        if (i > 0) expect(r.from).toBe((school.realms[i - 1]?.to ?? 0) + 1);
        expect(names.realms[i]).toContain(r.name);
      }
      expect(school.realms[0]?.to).toBeGreaterThanOrEqual(1);
      expect(school.technique.factor).toBeGreaterThanOrEqual(1.2);
      expect(school.technique.factor).toBeLessThanOrEqual(1.6);
      expect(names.techniques).toContain(school.technique.name);
    }
  });

  it("el reino de un tramo: capa dentro del reino, la cima del último pasado el final", () => {
    const school = {
      layer: "capa",
      technique: { name: "t", factor: 1.3 },
      realms: [
        { name: "A", from: 0, to: 2 },
        { name: "B", from: 3, to: 3 },
      ],
    };
    expect(realmOf(school, 0)).toEqual({ name: "A", layer: 1 });
    expect(realmOf(school, 2)).toEqual({ name: "A", layer: 3 });
    expect(realmOf(school, 3)).toEqual({ name: "B" });
    expect(realmOf(school, 9)).toEqual({ name: "B" });
  });

  it("un método por reino: el de entrada abajo, nombres sin repetir, rinde en su rango (novel2-method-school)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const school = generateSchool(Rng.root(seed), lawOf(seed), names);
      const methods = school.methods ?? [];
      expect(methods).toHaveLength(school.realms.length);
      expect(methods[0]).toEqual({ ...school.technique, realm: 0 });
      expect(new Set(methods.map((m) => m.name)).size).toBe(methods.length);
      for (const [i, m] of methods.entries()) {
        expect(m.realm).toBe(i);
        if (i === 0) continue;
        expect(m.factor).toBeGreaterThanOrEqual(METHOD_FACTOR[0]);
        expect(m.factor).toBeLessThanOrEqual(METHOD_FACTOR[1]);
      }
    }
  });

  it("cubrir y romper a ciegas: el método llega hasta su reino; sin método, los primeros tramos", () => {
    const school = {
      layer: "capa",
      technique: { name: "t", factor: 1.3 },
      realms: [
        { name: "A", from: 0, to: 2 },
        { name: "B", from: 3, to: 4 },
        { name: "C", from: 5, to: 5 },
      ],
    };
    expect(realmIndex(school, 0)).toBe(0);
    expect(realmIndex(school, 4)).toBe(1);
    expect(realmIndex(school, 9)).toBe(2);
    const entry: KnownTechnique = {
      org: "org:1" as EntityRef,
      name: "t",
      factor: 1.3,
      learnedAt: 0,
    };
    const second: KnownTechnique = { ...entry, realm: 1 };
    // Sin `realm`, el primero.
    expect(methodCovers(school, entry, 2)).toBe(true);
    expect(methodCovers(school, entry, 3)).toBe(false);
    expect(methodCovers(school, second, 2)).toBe(true);
    expect(methodCovers(school, second, 4)).toBe(true);
    // Romper desde la cima del reino A cae en B: a ciegas con el de entrada, no con el segundo.
    expect(breaksBlind(school, entry, 1)).toBe(false);
    expect(breaksBlind(school, entry, 2)).toBe(true);
    expect(breaksBlind(school, second, 2)).toBe(false);
    expect(breaksBlind(school, second, 4)).toBe(true);
    // Sin método: se intuyen los primeros tramos.
    expect(breaksBlind(undefined, undefined, UNGUIDED_TRAMOS - 2)).toBe(false);
    expect(breaksBlind(undefined, undefined, UNGUIDED_TRAMOS - 1)).toBe(true);
    expect(BLIND_PREP).toBeLessThan(1);
  });
});
