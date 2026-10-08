import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, type HouseholdId, makeId, Rng } from "../../core/index.ts";
import {
  type Barrier,
  daylight,
  houseKey,
  type SpaceGraph,
  type SpaceNode,
  spaceReach,
  VILLAGE_SQUARE,
  villageSpaces,
} from "../world/index.ts";
import {
  ATTENTION,
  actionStimulus,
  channelGain,
  falloff,
  forgetExcept,
  type HabituationMemory,
  habituate,
  halfLifeOf,
  KIND_HALF_LIFE,
  type Medium,
  NOTICEABLE,
  type Observer,
  type PerceptKey,
  perceive,
  presenceStimulus,
  RENEWAL_DELTA,
  readChance,
  SENSE_HALF_LIFE,
  SENSES,
  sensorAcuity,
  watching,
} from "./index.ts";

const agent = (n: number) => makeId("agent", n) as AgentId;
const ZHAO = agent(1);
const WEN = agent(2);

function room(key: string, over: Partial<SpaceNode> = {}): SpaceNode {
  return {
    key,
    kind: "square",
    hex: 0,
    area: 44 * 44, // media plaza: 22 m, 30 pasos
    indoor: false,
    daylight: 1,
    lamp: 0,
    noise: 0.05,
    clearSight: 1,
    ...over,
  };
}

function medium(graph: SpaceGraph, light: number): Medium {
  return { graph, forest: [false, false], daylight: light };
}

function observer(id: AgentId, space: string, over: Partial<Observer> = {}): Observer {
  return {
    id,
    at: { hex: 0, space },
    acuity: sensorAcuity(30),
    attention: ATTENTION.alert,
    familiar: new Map([[ZHAO, 1]]),
    ...over,
  };
}

const look = { sex: "male", ageYears: 35 } as const;

/** Cuántos de `n` observadores (cada uno con su tirada) leen `key` de Zhao parado en `space`. */
function readRate(
  m: Medium,
  space: string,
  key: PerceptKey,
  n = 400,
  over: Partial<Observer> = {},
) {
  const obs = Array.from({ length: n }, (_, i) => observer(agent(100 + i), space, over));
  const ps = perceive(
    presenceStimulus({ id: ZHAO, at: { hex: 0, space }, look, tick: 0 }),
    obs,
    m,
    Rng.root(7),
  );
  return ps.filter((p) => p.fields[key] !== undefined).length / n;
}

describe("grafo de espacios", () => {
  const two = (barrier: Barrier): SpaceGraph => ({
    spaces: [room("a", { area: 100 }), room("b", { area: 100 })],
    edges: [{ a: "a", b: "b", barrier }],
  });

  it("dentro del mismo espacio, media vuelta del espacio", () => {
    expect(spaceReach(two("open"), "a", "a", "sight")).toEqual({ pass: 1, meters: 5 });
  });

  it("una pared de piedra corta la vista y casi todo el sonido", () => {
    const wall = two("stone_wall");
    expect(spaceReach(wall, "a", "b", "sight").pass).toBe(0);
    expect(spaceReach(wall, "a", "b", "sound").pass).toBeLessThan(0.05);
    expect(spaceReach(two("doorway"), "a", "b", "sight")).toEqual({ pass: 0.5, meters: 10 });
  });

  it("toma el camino que más deja pasar, aunque sea más largo", () => {
    const g: SpaceGraph = {
      spaces: [room("a", { area: 100 }), room("b", { area: 100 }), room("c", { area: 400 })],
      edges: [
        { a: "a", b: "b", barrier: "wood_wall" },
        { a: "a", b: "c", barrier: "open" },
        { a: "c", b: "b", barrier: "doorway" },
      ],
    };
    expect(spaceReach(g, "a", "b", "sound")).toEqual({ pass: 0.8, meters: 30 });
  });

  it("sin camino no llega nada; un espacio desconocido es un error", () => {
    const g: SpaceGraph = { spaces: [room("a"), room("b")], edges: [] };
    expect(spaceReach(g, "a", "b", "sound").pass).toBe(0);
    expect(() => spaceReach(g, "a", "z", "sound")).toThrow(RangeError);
  });

  it("la aldea mínima: una plaza y una casa por hogar con la puerta a la plaza", () => {
    const hs = [makeId("household", 2), makeId("household", 1)] as HouseholdId[];
    const g = villageSpaces({ hex: 3, households: hs });
    expect(g.spaces.map((s) => s.key)).toEqual([
      VILLAGE_SQUARE,
      houseKey(hs[1] as HouseholdId),
      houseKey(hs[0] as HouseholdId),
    ]);
    expect(g.edges.every((e) => e.a === VILLAGE_SQUARE && e.barrier === "doorway")).toBe(true);
    // De una casa a otra se ve poco (dos vanos) y se oye algo.
    const [, h1, h2] = g.spaces as SpaceNode[];
    const sight = spaceReach(g, (h1 as SpaceNode).key, (h2 as SpaceNode).key, "sight");
    expect(sight.pass).toBeCloseTo(0.25);
  });
});

describe("detección", () => {
  const plaza: SpaceGraph = { spaces: [room("p")], edges: [] };

  it("calibración: a 30 pasos se reconoce a un conocido de día y casi nunca de noche", () => {
    const day = readRate(medium(plaza, daylight(12)), "p", "identity");
    const night = readRate(medium(plaza, daylight(0)), "p", "identity");
    expect(day).toBeGreaterThan(0.9);
    expect(night).toBeLessThan(0.1);
    // De noche igual se nota que hay alguien.
    expect(readRate(medium(plaza, daylight(0)), "p", "presence")).toBeGreaterThan(0.8);
  });

  it("a un desconocido se lo ve bien pero no se lo reconoce", () => {
    const [p] = perceive(
      presenceStimulus({ id: ZHAO, at: { hex: 0, space: "p" }, look, tick: 5 }),
      [observer(WEN, "p", { familiar: new Map(), acuity: { sight: 5, sound: 1 } })],
      medium(plaza, 1),
      Rng.root(1),
    );
    expect(p?.detail).toBe("clear");
    expect(p?.fields.identity?.value).toBeNull();
    expect(p?.fields.figure?.value).toEqual({ sex: "male", age: "adult" });
  });

  it("una pared de piedra: no se ve nada del otro lado", () => {
    const g: SpaceGraph = {
      spaces: [room("a", { area: 16 }), room("b", { area: 16 })],
      edges: [{ a: "a", b: "b", barrier: "stone_wall" }],
    };
    const obs = Array.from({ length: 200 }, (_, i) => observer(agent(10 + i), "a"));
    const ps = perceive(
      presenceStimulus({ id: ZHAO, at: { hex: 0, space: "b" }, look, tick: 0 }),
      obs,
      medium(g, 1),
      Rng.root(3),
    );
    expect(ps.every((p) => !p.channels.includes("sight"))).toBe(true);
    expect(ps.every((p) => p.fields.figure === undefined && p.fields.identity === undefined)).toBe(
      true,
    );
  });

  it("las palabras se entienden cerca y se pierden lejos o con ruido", () => {
    const say = (space: SpaceNode, n = 300) => {
      const g: SpaceGraph = { spaces: [space], edges: [] };
      const obs = Array.from({ length: n }, (_, i) => observer(agent(10 + i), space.key));
      const ps = perceive(
        actionStimulus({
          event: makeId("event", 9) as EventId,
          tick: 0,
          actor: ZHAO,
          at: { hex: 0, space: space.key },
          look,
          verb: "speak",
          emissions: { sight: 0.3, sound: 0.6 },
          words: "el pozo está seco",
        }),
        obs,
        medium(g, 1),
        Rng.root(4),
      );
      return ps.filter((p) => p.fields.words?.value === "el pozo está seco").length / n;
    };
    const near = say(room("p", { area: 30 * 30 }));
    const far = say(room("p", { area: 80 * 80 }));
    const loud = say(room("p", { area: 30 * 30, noise: 0.5 }));
    expect(near).toBeGreaterThan(0.8);
    expect(far).toBeLessThan(near);
    expect(loud).toBeLessThan(0.2);
  });

  it("el que actúa no se percibe desde afuera; otro hex queda fuera de alcance", () => {
    const ps = perceive(
      presenceStimulus({ id: ZHAO, at: { hex: 0, space: "p" }, look, tick: 0 }),
      [observer(ZHAO, "p"), { ...observer(WEN, "p"), at: { hex: 1 } }],
      medium(plaza, 1),
      Rng.root(1),
    );
    expect(ps).toEqual([]);
  });

  it("al aire libre sin sitio: el campo abierto del hex, y el bosque corta la vista", () => {
    const m = (forest: boolean): Medium => ({
      graph: { spaces: [], edges: [] },
      forest: [forest],
      daylight: 1,
    });
    const at = { hex: 0 };
    const o: Observer = { ...observer(WEN, "x"), at };
    expect(channelGain(m(true), o, at).sight).toBeLessThan(channelGain(m(false), o, at).sight);
    expect(channelGain(m(false), o, at).sight).toBeGreaterThan(0);
  });

  it("determinista: los mismos datos dan los mismos percepts", () => {
    const run = () =>
      perceive(
        presenceStimulus({ id: ZHAO, at: { hex: 0, space: "p" }, look, tick: 3 }),
        Array.from({ length: 30 }, (_, i) => observer(agent(10 + i), "p")),
        medium(plaza, daylight(18.5)),
        Rng.root(11),
      );
    expect(run()).toEqual(run());
  });

  it("todo percept apunta a su fuente y solo trae datos que el estímulo emitía", () => {
    const stim = presenceStimulus({ id: ZHAO, at: { hex: 0, space: "p" }, look, tick: 0 });
    const keys = new Set(stim.attributes.map((a) => a.key));
    const ps = perceive(
      stim,
      Array.from({ length: 50 }, (_, i) => observer(agent(10 + i), "p")),
      medium(plaza, 0.3),
      Rng.root(2),
    );
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) {
      expect(p.sourceEntityId).toBe(ZHAO);
      for (const k of Object.keys(p.fields)) {
        expect(keys.has(k as PerceptKey)).toBe(true);
      }
      expect(Object.values(p.fields).every((f) => f?.mistaken === false)).toBe(true);
    }
  });
});

describe("monotonía (perception §Tests)", () => {
  it("más distancia, menos luz o más ruido nunca aumentan la ganancia ni la lectura", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (a1, a2, l1, l2, n1, n2) => {
          const [small, big] = a1 <= a2 ? [a1, a2] : [a2, a1];
          const [dim, bright] = l1 <= l2 ? [l1, l2] : [l2, l1];
          const [quiet, noisy] = n1 <= n2 ? [n1, n2] : [n2, n1];
          const gain = (area: number, light: number, noise: number) =>
            channelGain(
              medium({ spaces: [room("p", { area, noise })], edges: [] }, light),
              observer(WEN, "p"),
              { hex: 0, space: "p" },
            );
          const base = gain(small, bright, quiet);
          expect(gain(big, bright, quiet).sight).toBeLessThanOrEqual(base.sight);
          expect(gain(big, bright, quiet).sound).toBeLessThanOrEqual(base.sound);
          expect(gain(small, dim, quiet).sight).toBeLessThanOrEqual(base.sight);
          expect(gain(small, bright, noisy).sound).toBeLessThanOrEqual(base.sound);
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (x, y) => {
          const [lo, hi] = x <= y ? [x, y] : [y, x];
          expect(readChance(lo)).toBeLessThanOrEqual(readChance(hi));
          expect(falloff("sight", hi)).toBeLessThanOrEqual(falloff("sight", lo));
        },
      ),
    );
  });

  it("los sentidos bajan con la edad, y mirar con atención suma", () => {
    expect(sensorAcuity(70).sight).toBeLessThan(sensorAcuity(30).sight);
    expect(sensorAcuity(70).sound).toBeLessThan(sensorAcuity(30).sound);
    expect(sensorAcuity(30, 1).sight).toBeGreaterThan(sensorAcuity(30).sight);
    expect(watching(0.8)).toBeGreaterThan(ATTENTION.alert);
    expect(ATTENTION.asleep).toBeLessThan(ATTENTION.relaxed);
  });
});

describe("habituación", () => {
  it("decae a la mitad por vida media del canal y el olfato se habitúa antes que la vista", () => {
    const mem: HabituationMemory = new Map();
    expect(habituate(mem, "a", "smell", "smoke", 0.5, 0)).toBe(1);
    expect(habituate(mem, "a", "smell", "smoke", 0.5, SENSE_HALF_LIFE.smell)).toBeCloseTo(0.5, 6);
    expect(habituate(mem, "b", "sight", "bright", 0.5, 0)).toBe(1);
    const sight = habituate(mem, "b", "sight", "bright", 0.5, SENSE_HALF_LIFE.smell);
    expect(sight).toBeGreaterThan(0.9);
  });

  it("un cambio de intensidad o la atención renuevan; un cambio chico no", () => {
    const mem: HabituationMemory = new Map();
    habituate(mem, "k", "hearing", "rain", 0.3, 0);
    const t = SENSE_HALF_LIFE.hearing;
    expect(habituate(mem, "k", "hearing", "rain", 0.3 + RENEWAL_DELTA / 2, t)).toBeCloseTo(0.5, 6);
    expect(habituate(mem, "k", "hearing", "rain", 0.3 + RENEWAL_DELTA, t)).toBe(1);
    expect(habituate(mem, "k", "hearing", "rain", 0.45, 3 * t)).toBeLessThan(NOTICEABLE);
    expect(habituate(mem, "k", "hearing", "rain", 0.45, 3 * t, true)).toBe(1);
  });

  it("la vida media por tipo pisa la del canal", () => {
    expect(halfLifeOf("hearing", "wind")).toBe(KIND_HALF_LIFE["hearing/wind"]);
    expect(halfLifeOf("hearing", "rain")).toBe(SENSE_HALF_LIFE.hearing);
  });

  it("olvidar lo que dejó de estar hace que al volver cuente como nuevo", () => {
    const mem: HabituationMemory = new Map();
    habituate(mem, "x", "smell", "smoke", 0.5, 0);
    forgetExcept(mem, new Set());
    expect(habituate(mem, "x", "smell", "smoke", 0.5, 10 * SENSE_HALF_LIFE.smell)).toBe(1);
  });

  it("es determinista y la saliencia nunca crece sin cambio", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SENSES),
        fc.array(fc.integer({ min: 0, max: 20_000 }), { minLength: 2, maxLength: 12 }),
        (sense, gaps) => {
          const run = (): number[] => {
            const mem: HabituationMemory = new Map();
            let now = 0;
            return gaps.map((g) => {
              now += g;
              return habituate(mem, "k", sense, "kind", 0.4, now);
            });
          };
          const a = run();
          expect(run()).toEqual(a);
          for (let i = 1; i < a.length; i++) expect(a[i] ?? 0).toBeLessThanOrEqual(1);
          // Sin cambio, nunca vuelve a subir: no hay renovación espontánea.
          for (let i = 2; i < a.length; i++) expect(a[i] ?? 0).toBeLessThanOrEqual(a[i - 1] ?? 0);
        },
      ),
    );
  });
});
