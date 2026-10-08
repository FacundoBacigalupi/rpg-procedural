import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type EventId, type PlaceRef, Rng } from "../../core/index.ts";
import {
  applySchemaUpdates,
  consolidate,
  FORGET_BELOW,
  formMemory,
  MAX_STRENGTHENED,
  type Memories,
  type Mind,
  type SchemaDef,
  salienceAt,
  sleepQuality,
} from "../index.ts";

const DAY = 86_400;
const A = "agent:1" as AgentId;
const B = "agent:2" as AgentId;
const PLACE = { kind: "none" } as unknown as PlaceRef;
let n = 0;

const mem = (intensity: number, kind = "combat.fight", valence = -0.5, who = [B], at = 0) =>
  formMemory({
    eventId: `event:c${++n}` as EventId,
    kind,
    with: who,
    place: PLACE,
    at,
    intensity,
    valence,
  });
const bag = (...items: ReturnType<typeof mem>[]): Memories => ({ items, gists: [] });
const rng = (k = 1) => Rng.root(7).fork("psyche", A, k);

describe("sleepQuality", () => {
  it("es 1 con sueño completo y sin molestias, y baja con cada factor", () => {
    expect(sleepQuality({ hours: 8, needHours: 8 })).toBe(1);
    const base = sleepQuality({ hours: 8, needHours: 8, discomfort: 0.5 });
    expect(base).toBeLessThan(1);
    expect(sleepQuality({ hours: 4, needHours: 8 })).toBe(0.5);
    expect(sleepQuality({ hours: 8, needHours: 8, nightmares: 1, fear: 1 })).toBeLessThan(0.4);
  });
});

describe("consolidate", () => {
  it("refuerza las intensas, no más de MAX_STRENGTHENED, y no las triviales", () => {
    const items = [0.9, 0.8, 0.7, 0.6, 0.05].map((i, k) => mem(i, `k${k}`));
    const r = consolidate({ memories: bag(...items), now: 10 * DAY, quality: 1, rng: rng() });
    expect(r.pass.strengthened).toHaveLength(MAX_STRENGTHENED);
    expect(r.pass.strengthened).not.toContain(items[4]?.eventId);
    const before = items[0] as (typeof items)[number];
    const after = r.memories.items.find((m) => m.eventId === before.eventId);
    expect(after && salienceAt(after, 10 * DAY)).toBeGreaterThan(salienceAt(before, 10 * DAY));
  });

  it("las triviales pierden saliencia más rápido que lo que decae solo", () => {
    const t = mem(0.05, "walk");
    const r = consolidate({ memories: bag(t), now: DAY, quality: 1, rng: rng() });
    expect(r.pass.faded).toEqual([t.eventId]);
    const after = r.memories.items[0];
    expect(after && salienceAt(after, DAY)).toBeLessThan(salienceAt(t, DAY));
  });

  it("la mala noche refuerza menos y distorsiona más", () => {
    const m = mem(0.9);
    const good = consolidate({ memories: bag(m), now: DAY, quality: 1, rng: rng() });
    const bad = consolidate({ memories: bag(m), now: DAY, quality: 0.1, rng: rng() });
    const g = good.memories.items[0];
    const b = bad.memories.items[0];
    expect(g && salienceAt(g, DAY)).toBeGreaterThan((b && salienceAt(b, DAY)) ?? 1);
    expect(b?.distortion).toBeGreaterThan(g?.distortion ?? 1);
  });

  it("funde un par parecido: queda la más intensa, con menos confianza y más distorsión", () => {
    const a = mem(0.6, "combat.fight", -0.5, [B], 0);
    const b = mem(0.4, "combat.fight", -0.7, [B], DAY);
    const other = mem(0.1, "trade", 0.2, [B]);
    let found = false;
    for (let k = 0; k < 200 && !found; k++) {
      const r = consolidate({
        memories: bag(a, b, other),
        now: 2 * DAY,
        quality: 0,
        rng: rng(k),
      });
      if (r.pass.merged.length === 0) continue;
      found = true;
      expect(r.pass.merged).toEqual([[a.eventId, b.eventId]]);
      expect(r.memories.items).toHaveLength(2);
      const fused = r.memories.items.find((m) => m.eventId === a.eventId);
      expect(fused?.distortion).toBeGreaterThan(0);
      expect(fused?.confidence).toBeLessThan(a.confidence);
      expect(r.memories.gists[0]?.count).toBe(1);
    }
    expect(found).toBe(true);
  });

  it("no funde memorias de distinto tipo ni de signo opuesto", () => {
    const a = mem(0.6, "combat.fight", -0.5);
    const b = mem(0.6, "combat.fight", 0.5);
    const c = mem(0.6, "trade", -0.5);
    for (let k = 0; k < 50; k++) {
      const r = consolidate({ memories: bag(a, b, c), now: DAY, quality: 0, rng: rng(k) });
      expect(r.pass.merged).toHaveLength(0);
    }
  });

  it("confirma el esquema hacia donde ya se inclina", () => {
    const schema = {
      id: "wary",
      species: "human",
      name: "recela",
      harmful: false,
      lean: {},
      effects: { betrayal: 1 },
      values: {},
    } as SchemaDef;
    const mind = (strength: number): Mind => ({
      schemas: { wary: { strength, causes: [] } },
      formative: [],
      originEventId: "event:0" as EventId,
    });
    const m = mem(0.9, "betray");
    const run = (strength: number) =>
      consolidate({
        memories: bag(m),
        now: DAY,
        quality: 1,
        rng: rng(),
        themeOf: () => "betrayal",
        schemas: [schema],
        mind: mind(strength),
      });
    const up = run(0.7).pass.schemaUpdates;
    expect(up).toHaveLength(1);
    expect(up[0]?.delta).toBeGreaterThan(0);
    // Quien no recela no se vuelve receloso por una confirmación que va en contra.
    expect(run(0.2).pass.schemaUpdates).toHaveLength(0);
    const applied = applySchemaUpdates(mind(0.7), up);
    expect(applied.schemas["wary"]?.strength).toBeGreaterThan(0.7);
    expect(applied.schemas["wary"]?.causes).toContain(m.eventId);
  });

  it("es determinista y no deja nada bajo el olvido ni se pierde memoria sin gist", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            i: fc.double({ min: 0, max: 1, noNaN: true }),
            k: fc.constantFrom("a", "b"),
            v: fc.double({ min: -1, max: 1, noNaN: true }),
          }),
          { maxLength: 15 },
        ),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 30 }),
        (xs, quality, days) => {
          const memories = bag(...xs.map((x) => mem(x.i, x.k, x.v)));
          const run = () => consolidate({ memories, now: days * DAY, quality, rng: rng(3) });
          const r1 = run();
          expect(r1).toEqual(run());
          const lost = memories.items.length - r1.memories.items.length;
          expect(lost).toBe(r1.pass.merged.length);
          for (const m of r1.memories.items) {
            expect(m.distortion).toBeGreaterThanOrEqual(0);
            expect(m.distortion).toBeLessThanOrEqual(1);
            expect(m.salience).toBeLessThanOrEqual(1);
          }
          expect(FORGET_BELOW).toBeGreaterThan(0);
        },
      ),
    );
  });
});
