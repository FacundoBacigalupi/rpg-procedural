import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EARTHLIKE_CLOCK,
  EventLog,
  floorDiv,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import { BIOMES, generatePlanet, villageSite } from "../../worldgen/index.ts";
import { checkInvariants, WorldTruth } from "../world/index.ts";
import { DEMOGRAPHY } from "./demography.ts";
import { expressInnate, founderGenome, type Genome, inheritGenome, TRAITS } from "./genome.ts";
import { seedVillage } from "./tables.ts";
import { BIRTH_AGE_SLACK, type VillagePopulation, villagePopulation } from "./village.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [BIOMES, TRAITS, DEMOGRAPHY],
  [
    {
      kind: "biomes",
      file: "content/biomes/whittaker.json",
      data: json("content/biomes/whittaker.json"),
    },
    { kind: "traits", file: "content/traits/human.json", data: json("content/traits/human.json") },
    {
      kind: "demography",
      file: "content/demography/preindustrial.json",
      data: json("content/demography/preindustrial.json"),
    },
  ],
);
const traits = content.all(TRAITS);
const demography = content.all(DEMOGRAPHY)[0] as (typeof DEMOGRAPHY)["schema"]["_output"];

const cache = new Map<number, VillagePopulation>();
function village(seed: number): VillagePopulation {
  let v = cache.get(seed);
  if (!v) {
    const planet = generatePlanet({ seed, biomes: content.all(BIOMES) });
    v = villagePopulation({ seed, site: villageSite(planet), traits, demography });
    cache.set(seed, v);
  }
  return v;
}

const SEEDS = [1, 2, 3];
const ageAt = (born: number, t: number) => floorDiv(t - born, EARTHLIKE_CLOCK.year);

describe("pre-corrida de la aldea", () => {
  it("todos tienen origen: nacimiento con dos padres, la fundación o una llegada", () => {
    for (const seed of SEEDS) {
      const v = village(seed);
      const log = EventLog.from(v.events);
      const byId = new Map(v.people.map((p) => [p.id, p]));
      for (const p of v.people) {
        const origin = log.get(p.origin);
        expect(origin).toBeDefined();
        expect(p.genome.originEventId).toBe(p.origin);
        if (p.mother === null) {
          expect(p.father).toBeNull();
          expect(p.genome.parents).toBeNull();
          expect(["family.founders_settled", "person.arrived"]).toContain(origin?.kind);
          expect(origin?.causes.some((c) => c.kind === "seed")).toBe(true);
          expect(origin?.actors).toContain(p.id);
        } else {
          expect(origin?.kind).toBe("family.birth");
          expect(origin?.actors).toEqual([p.id, p.mother, p.father]);
          expect(p.genome.parents).toEqual([p.mother, p.father]);
          const mother = byId.get(p.mother);
          const father = byId.get(p.father as AgentId);
          expect(mother?.sex).toBe("female");
          expect(father?.sex).toBe("male");
          // La madre estaba en la aldea y viva al parir.
          expect(mother?.since).toBeLessThanOrEqual(p.born);
          expect(mother?.end === null || (mother?.end?.tick ?? 0) >= p.born).toBe(true);
          expect(log.ancestors(p.origin)).toContain(v.foundedEvent);
        }
        if (p.end) expect(log.get(p.end.event)?.actors).toContain(p.id);
      }
    }
  }, 120_000);

  it("la verdad sembrada cumple las invariantes causales", () => {
    for (const seed of SEEDS) {
      const v = village(seed);
      const truth = new WorldTruth();
      seedVillage(truth, v);
      expect(checkInvariants({ truth, log: EventLog.from(v.events) })).toEqual([]);
    }
  }, 120_000);

  it("la población cambia solo por nacimientos, muertes, llegadas y partidas", () => {
    for (const seed of SEEDS) {
      const v = village(seed);
      const count = (kind: string) => v.events.filter((e) => e.kind === kind).length;
      const founders = v.people.filter(
        (p) => v.events[Number(p.origin.slice(6)) - 1]?.kind === "family.founders_settled",
      ).length;
      const alive = v.people.filter((p) => p.end === null);
      expect(alive.length).toBe(
        founders +
          count("family.birth") +
          count("person.arrived") -
          count("person.died") -
          count("family.married_out"),
      );
      // Cada vivo está en un solo hogar, el suyo; los hogares vivos tienen gente.
      const members = v.households.flatMap((h) => h.members);
      expect([...members].sort()).toEqual(alive.map((p) => p.id).sort());
      for (const h of v.households) {
        expect(h.end === null).toBe(h.members.length > 0);
        for (const m of h.members) expect(v.people.find((p) => p.id === m)?.household).toBe(h.id);
      }
      // Una aldea, no un pueblo vacío ni una ciudad.
      expect(alive.length).toBeGreaterThan(20);
      expect(alive.length).toBeLessThan(v.capacity * 1.2);
    }
  }, 120_000);

  it("no hay uniones entre parientes cercanos y los cónyuges se corresponden", () => {
    for (const seed of SEEDS) {
      const v = village(seed);
      const byId = new Map(v.people.map((p) => [p.id, p]));
      const kin = (id: AgentId) => {
        const p = byId.get(id);
        const out = new Set<AgentId>([id]);
        for (const parent of [p?.mother, p?.father]) {
          if (!parent) continue;
          out.add(parent);
          const pp = byId.get(parent);
          if (pp?.mother) out.add(pp.mother);
          if (pp?.father) out.add(pp.father);
        }
        return out;
      };
      for (const e of v.events) {
        if (e.kind !== "family.union") continue;
        const [a, b] = e.actors as AgentId[];
        const ka = kin(a as AgentId);
        for (const k of kin(b as AgentId)) expect(ka.has(k)).toBe(false);
      }
      for (const p of v.people) {
        if (p.spouse !== null) expect(byId.get(p.spouse)?.spouse).toBe(p.id);
      }
    }
  }, 120_000);

  it("el jugador es un nacimiento real de la aldea, vivo y con la edad de entrada", () => {
    for (const seed of SEEDS) {
      const v = village(seed);
      const player = v.people.find((p) => p.id === v.player);
      expect(player?.end).toBeNull();
      expect(player?.mother).not.toBeNull();
      const age = ageAt(player?.born ?? 0, v.now);
      // Si nadie nacido en la aldea tiene 14-16, se elige al más cercano a esa edad.
      const inWindow = v.people.some((p) => {
        const a = ageAt(p.born, v.now);
        return p.end === null && p.mother !== null && a >= 14 && a <= 16;
      });
      if (inWindow) {
        expect(age).toBeGreaterThanOrEqual(14);
        expect(age).toBeLessThanOrEqual(16);
      } else {
        expect(Math.abs(age - 15)).toBeLessThanOrEqual(BIRTH_AGE_SLACK + 1);
      }
      expect(v.households.find((h) => h.id === player?.household)?.members).toContain(v.player);
    }
  }, 120_000);

  it("los años flacos existen, son minoría y cada muerte de hambre cita el suyo", () => {
    let lean = 0;
    let starved = 0;
    let deaths = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const v = village(seed);
      const log = EventLog.from(v.events);
      lean += v.events.filter((e) => e.kind === "family.lean_year").length;
      for (const e of v.events.filter((e) => e.kind === "person.died")) {
        deaths++;
        if ((e.data as { of?: string }).of !== "hunger") continue;
        starved++;
        expect(log.ancestors(e.id).some((a) => log.get(a)?.kind === "family.lean_year")).toBe(true);
      }
    }
    expect(lean).toBeGreaterThan(0);
    expect(starved).toBeLessThan(deaths * 0.4);
  }, 240_000);

  it("calibración: la aldea de un bioma pobre es más chica y pasa más hambre que la de uno rico", () => {
    // Misma aldea, solo cambia el rendimiento del campo (productividad del bioma × hexes de campo).
    const withYield = (seed: number, yieldValue: number) => {
      const site = villageSite(generatePlanet({ seed, biomes: content.all(BIOMES) }));
      const anchors = site.anchors.map((a) =>
        a.kind === "farmland" ? { ...a, yield: yieldValue } : a,
      );
      const v = villagePopulation({ seed, site: { ...site, anchors }, traits, demography });
      const alive = v.people.filter((p) => !p.end).length;
      const lean = v.events.filter((e) => e.kind === "family.lean_year").length;
      return { alive, lean, capacity: v.capacity };
    };
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const poor = SEEDS.map((s) => withYield(s, 2));
    const rich = SEEDS.map((s) => withYield(s, 18));
    // El piso de capacidad es el mismo para todos los pobres: una aldea de desierto o tundra no
    // baja de ahí, pero pasa más años flacos.
    expect(poor.every((r) => r.capacity === demography.land.minCapacity)).toBe(true);
    expect(mean(rich.map((r) => r.capacity))).toBeGreaterThan(demography.land.minCapacity * 2);
    expect(mean(poor.map((r) => r.alive))).toBeLessThan(mean(rich.map((r) => r.alive)));
    expect(mean(poor.map((r) => r.lean))).toBeGreaterThan(mean(rich.map((r) => r.lean)));
  }, 240_000);

  it("mismo seed, misma aldea", () => {
    const planet = generatePlanet({ seed: 2, biomes: content.all(BIOMES) });
    const again = villagePopulation({ seed: 2, site: villageSite(planet), traits, demography });
    const v = village(2);
    expect(again.events).toEqual(v.events);
    expect(again.people).toEqual(v.people);
    expect(again.households).toEqual(v.households);
    expect(again.player).toBe(v.player);
    expect(village(3).player === v.player && village(3).events.length === v.events.length).toBe(
      false,
    );
  }, 120_000);
});

describe("genoma", () => {
  const ev = makeId("event", 1);

  it("mismos padres, mismo seed y mismo id de hijo dan el mismo genoma", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.integer({ min: 1, max: 1e6 }),
        (s, n) => {
          const root = Rng.root(s);
          const mother = {
            id: makeId("agent", 1),
            genome: founderGenome(traits, root.fork("a"), ev),
          };
          const father = {
            id: makeId("agent", 2),
            genome: founderGenome(traits, root.fork("b"), ev),
          };
          const id = makeId("agent", n);
          const a = inheritGenome(traits, mother, father, root.fork("genetics", id), ev);
          const b = inheritGenome(traits, mother, father, root.fork("genetics", id), ev);
          expect(a).toEqual(b);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("la regresión del hijo sobre el promedio de los padres da la heredabilidad", () => {
    const root = Rng.root(7);
    const N = 6000;
    const zOf = (t: (typeof traits)[number], v: number, male: boolean) =>
      (v - t.mean - (male ? (t.maleShift ?? 0) : 0)) / t.sd;
    const rows: { mid: Record<string, number>; child: Record<string, number> }[] = [];
    for (let i = 0; i < N; i++) {
      const mother = {
        id: makeId("agent", 3 * i + 1),
        genome: founderGenome(traits, root.fork("m", i), ev),
      };
      const father = {
        id: makeId("agent", 3 * i + 2),
        genome: founderGenome(traits, root.fork("f", i), ev),
      };
      const childId = makeId("agent", 3 * i + 3);
      const child: Genome = inheritGenome(
        traits,
        mother,
        father,
        root.fork("genetics", childId),
        ev,
      );
      const im = expressInnate(
        traits,
        mother.genome,
        "female",
        root.fork("development", mother.id),
      );
      const iff = expressInnate(traits, father.genome, "male", root.fork("development", father.id));
      const ic = expressInnate(traits, child, "female", root.fork("development", childId));
      const mid: Record<string, number> = {};
      const c: Record<string, number> = {};
      for (const t of traits) {
        mid[t.id] = (zOf(t, im[t.id] as number, false) + zOf(t, iff[t.id] as number, true)) / 2;
        c[t.id] = zOf(t, ic[t.id] as number, false);
      }
      rows.push({ mid, child: c });
    }
    for (const t of traits) {
      const xs = rows.map((r) => r.mid[t.id] as number);
      const ys = rows.map((r) => r.child[t.id] as number);
      const mx = xs.reduce((a, b) => a + b, 0) / N;
      const my = ys.reduce((a, b) => a + b, 0) / N;
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < N; i++) {
        sxy += ((xs[i] as number) - mx) * ((ys[i] as number) - my);
        sxx += ((xs[i] as number) - mx) ** 2;
      }
      expect(Math.abs(sxy / sxx - t.heritability)).toBeLessThan(0.07);
    }
  });
});
