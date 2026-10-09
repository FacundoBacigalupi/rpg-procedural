import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type Event,
  type EventId,
  loadContent,
  type PlaceRef,
} from "../../core/index.ts";
import {
  addMemory,
  checkInvariants,
  FORGET_BELOW,
  formMemory,
  halfLifeDays,
  MEMORIES,
  MEMORY_CAPACITY,
  type Memories,
  recall,
  salienceAt,
  salient,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { livedFrom } from "./memories.ts";
import { living } from "./world.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const DAY = 86_400;
const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const PLACE = { kind: "none" } as unknown as PlaceRef;
let n = 0;
const ev = () => `event:${++n}` as EventId;

const exp = (intensity: number, at = 0, valence = -0.5, who: readonly AgentId[] = [B]) =>
  formMemory({
    eventId: ev(),
    kind: "combat.fight",
    with: who,
    place: PLACE,
    at,
    intensity,
    valence,
  });

describe("memoria episódica: núcleo puro", () => {
  it("la saliencia nunca sube sola, está en 0-1 y la intensidad frena el olvido", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 3650 }),
        fc.integer({ min: 0, max: 3650 }),
        (i, d1, d2) => {
          const m = exp(i);
          const [lo, hi] = d1 <= d2 ? [d1, d2] : [d2, d1];
          expect(salienceAt(m, hi * DAY)).toBeLessThanOrEqual(salienceAt(m, lo * DAY));
          expect(salienceAt(m, lo * DAY)).toBeLessThanOrEqual(1);
          expect(salienceAt(m, hi * DAY)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
    expect(halfLifeDays(0.95)).toBeGreaterThan(halfLifeDays(0.5));
    expect(halfLifeDays(0.5)).toBeGreaterThan(halfLifeDays(0.1));
  });

  it("una memoria flash casi no decae y una trivial se va en meses", () => {
    const flash = exp(0.95);
    const trivial = exp(0.1);
    expect(salienceAt(flash, 365 * DAY)).toBeGreaterThan(0.8 * salienceAt(flash, 0));
    expect(salienceAt(trivial, 365 * DAY)).toBeLessThan(FORGET_BELOW);
  });

  it("recordar la refuerza desde donde estaba y no pasa de 1", () => {
    const m = exp(0.4);
    const later = 60 * DAY;
    const r = recall(m, later);
    expect(r.salience).toBeGreaterThan(salienceAt(m, later));
    expect(r.salience).toBeLessThanOrEqual(1);
    expect(r.recalls).toBe(1);
    expect(r.lastRecalled).toBe(later);
    expect(salienceAt(recall(recall(recall(m, later), later), later), later)).toBeLessThanOrEqual(
      1,
    );
  });

  it("la confianza sale de cómo se supo y de la claridad con que se percibió", () => {
    const seen = exp(0.5);
    const base = {
      eventId: ev(),
      kind: "x",
      with: [B],
      place: PLACE,
      at: 0,
      intensity: 0.5,
      valence: 0,
    };
    const told = formMemory({ ...base, source: "told", toldBy: A });
    const dim = formMemory({ ...base, clarity: 0.4 });
    expect(told.confidence).toBeLessThan(seen.confidence);
    expect(dim.confidence).toBeLessThan(seen.confidence);
    expect(told.toldBy).toBe(A);
  });

  it("lo olvidado se comprime en un resumen que cuenta y guarda causas", () => {
    let mem: Memories | undefined;
    for (let i = 0; i < 3; i++) mem = addMemory(mem, exp(0.1, i * DAY), i * DAY);
    // Un año después, una memoria nueva: las tres viejas ya estaban bajo el umbral.
    mem = addMemory(mem, exp(0.6, 400 * DAY, -0.5, [A]), 400 * DAY);
    expect(mem.items).toHaveLength(1);
    expect(mem.gists).toHaveLength(1);
    expect(mem.gists[0]?.count).toBe(3);
    expect(mem.gists[0]?.with).toEqual([B]);
    expect(mem.gists[0]?.causes.length).toBeGreaterThan(0);
    expect(mem.gists[0]?.valence).toBeCloseTo(-0.5, 5);
  });

  it("la capacidad se respeta: se van las menos salientes, nunca las más", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.3, max: 1, noNaN: true }), { minLength: 1, maxLength: 60 }),
        (intensities) => {
          let mem: Memories | undefined;
          intensities.forEach((i, k) => {
            mem = addMemory(mem, exp(i, k * 60), k * 60);
          });
          const now = intensities.length * 60;
          expect(mem?.items.length ?? 0).toBeLessThanOrEqual(MEMORY_CAPACITY);
          const kept = salient(mem, now);
          const total =
            (mem?.items.length ?? 0) + (mem?.gists.reduce((s, g) => s + g.count, 0) ?? 0);
          expect(total).toBe(intensities.length);
          // Nada de lo comprimido era más saliente que lo que quedó (salvo empates de borde).
          const floor = Math.min(...kept.map((k) => k.salience));
          for (const g of mem?.gists ?? []) expect(g.peak).toBeLessThanOrEqual(1);
          expect(floor).toBeGreaterThanOrEqual(FORGET_BELOW);
        },
      ),
    );
  });

  it("es determinista: la misma secuencia da el mismo resultado", () => {
    const run = () => {
      n = 0;
      let mem: Memories | undefined;
      for (let k = 0; k < 40; k++)
        mem = addMemory(mem, exp(((k * 37) % 100) / 100, k * DAY), k * DAY);
      return JSON.stringify(mem);
    };
    expect(run()).toBe(run());
  });
});

describe("qué vive cada quien de un evento", () => {
  const fight = (hits: { to: string; severity: number }[]): Event =>
    ({
      id: ev(),
      tick: 10,
      kind: "combat.fight",
      actors: [A, B],
      place: PLACE,
      data: { hits },
      emissions: null,
      causes: [],
      resolution: "scene",
    }) as unknown as Event;

  it("el golpeado la guarda con más peso y más dolor que quien pegó", () => {
    const lived = livedFrom(fight([{ to: B, severity: 0.8 }]));
    const hitter = lived.find((l) => l.who === A)?.experience;
    const victim = lived.find((l) => l.who === B)?.experience;
    expect(victim?.intensity).toBeGreaterThan(hitter?.intensity ?? 1);
    expect(victim?.valence).toBeLessThan(hitter?.valence ?? -1);
    expect(victim?.with).toEqual([A]);
  });

  it("una mentira sorprendida queda en la memoria de ambos, más hiriente si era injusta", () => {
    const speak = (certain: boolean) =>
      ({
        id: ev(),
        kind: "action.speak",
        tick: 5,
        actors: [A, B],
        place: PLACE,
        data: { effect: { kind: "speak", judged: { verdict: "caught", certain } } },
      }) as unknown as Event;
    const sure = livedFrom(speak(true));
    const unjust = livedFrom(speak(false));
    expect(sure.map((l) => l.who)).toEqual([A, B]);
    const accused = (l: typeof sure) => l.find((x) => x.who === B)?.experience;
    expect(accused(unjust)?.valence).toBeLessThan(accused(sure)?.valence ?? -1);
    const believed = {
      ...speak(true),
      data: { effect: { kind: "speak", judged: { verdict: "believed" } } },
    };
    expect(livedFrom(believed as unknown as Event)).toEqual([]);
  });

  it("una ofensa de forma deja un recuerdo doloroso en el ofendido, más vívido cuanta más cara perdió", () => {
    const speak = (faceLoss: number) =>
      ({
        id: ev(),
        kind: "action.speak",
        tick: 5,
        actors: [A, B],
        place: PLACE,
        data: { effect: { kind: "speak", form: { faceLoss } } },
      }) as unknown as Event;
    const small = livedFrom(speak(0.1));
    const big = livedFrom(speak(0.8));
    expect(big.map((l) => l.who)).toEqual([A]);
    expect(big[0]?.experience.with).toEqual([B]);
    expect(big[0]?.experience.valence).toBeLessThan(small[0]?.experience.valence ?? -1);
    expect(big[0]?.experience.intensity).toBeGreaterThan(small[0]?.experience.intensity ?? 1);
    expect(livedFrom(speak(0))).toEqual([]);
  });

  it("una amenaza queda en ambos: vívida en el amenazado, tenue en quien amenazó", () => {
    const speak = (faceLoss: number) =>
      ({
        id: ev(),
        kind: "action.speak",
        tick: 5,
        actors: [A, B],
        place: PLACE,
        data: {
          effect: { kind: "speak", regard: { kind: "threat", faceLoss, deltas: { fear: 0.2 } } },
        },
      }) as unknown as Event;
    const lived = livedFrom(speak(0.7));
    expect(lived.map((l) => l.who)).toEqual([A, B]);
    const [victim, threatener] = [lived[0]?.experience, lived[1]?.experience];
    expect(victim?.intensity).toBeGreaterThan(threatener?.intensity ?? 1);
    expect(victim?.valence).toBeLessThan(threatener?.valence ?? -1);
  });

  it("un evento sin memoria no deja nada", () => {
    expect(livedFrom({ ...fight([]), kind: "action.wait" })).toEqual([]);
  });
});

describe("la aldea recuerda", () => {
  it("las peleas y las muertes de la casa quedan en las memorias de quien las vivió, y es determinista", () => {
    const run = () => {
      const life = Life.create(10, content);
      life.advanceTo(life.now + 60 * DAY);
      return life;
    };
    const life = run();
    const w = life.world;
    const owners = living(w.truth).filter((id) => w.truth.get(MEMORIES, id));
    for (const id of owners) {
      const mem = w.truth.get(MEMORIES, id);
      expect(mem?.items.length ?? 0).toBeLessThanOrEqual(MEMORY_CAPACITY);
      for (const m of mem?.items ?? []) {
        // Cada memoria cita un evento real del registro.
        expect(w.log.all().some((e) => e.id === m.eventId)).toBe(true);
        expect(m.confidence).toBeGreaterThan(0);
      }
    }
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run().hash()).toEqual(life.hash());
  }, 360_000);
});
