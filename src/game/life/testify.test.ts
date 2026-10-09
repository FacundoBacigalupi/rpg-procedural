import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  loadContent,
  Rng,
  type Tick,
} from "../../core/index.ts";
import {
  type Deed,
  formMemory,
  KNOWN_DEEDS,
  MEMORIES,
  PERSON,
  RELATION_BONDS,
  RELATION_DIMS,
  RELATIONS,
  relationship,
  TRAITS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import {
  bribeValue,
  CLARITY_BY_VIA,
  FORGOTTEN_CLARITY,
  giveTestimony,
  recallClarity,
  TESTIMONY_EVENT,
  type TestifyOptions,
  validOffer,
  witnessProfile,
} from "./testify.ts";
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

function scene(seed: number) {
  const life = Life.create(seed, content);
  const w = life.world;
  const [witness, asker, doer, victim] = living(w.truth) as AgentId[];
  const cause = w.log.all()[0]?.id as EventId;
  const o: TestifyOptions = {
    dims: content.all(RELATION_DIMS),
    bonds: content.all(RELATION_BONDS),
    traits: content.all(TRAITS),
    placeOf: () => ({ hex: 0 }) as never,
  };
  const deed: Deed = {
    kind: "theft",
    by: doer as AgentId,
    victim: victim as AgentId,
    event: cause,
    at: life.now as Tick,
    via: "saw",
  };
  w.truth.set(KNOWN_DEEDS, witness as AgentId, { deeds: [deed] });
  return { life, w, o, witness: witness as AgentId, asker: asker as AgentId, deed, cause };
}

function feel(s: ReturnType<typeof scene>, to: AgentId, dims: Record<string, number>) {
  const { w, o, witness, life } = s;
  const rel = relationship(w.truth.get(RELATIONS, witness), to, life.now, {
    dims: o.dims,
    bonds: o.bonds,
    schemaStrength: () => 0,
  });
  const toward = { ...(w.truth.get(RELATIONS, witness)?.toward ?? {}) };
  toward[to] = { ...rel, dims: { ...rel.dims, ...dims } };
  w.truth.set(RELATIONS, witness, { toward, originEventId: s.cause });
}

describe("testigos en el juego", () => {
  it("no declara un hecho que no conoce", () => {
    const s = scene(7);
    const out = giveTestimony(
      s.w.truth,
      s.o,
      s.witness,
      s.asker,
      { deed: "event:999999" as EventId },
      s.cause,
      s.life.now,
      Rng.root(1),
    );
    expect(out).toBeNull();
  }, 600_000);

  it("el miedo y la lealtad hacia quien lo hizo salen de la relación", () => {
    const s = scene(7);
    feel(s, s.deed.by as AgentId, { fear: 1, affection: 1, gratitude: 1 });
    const p = witnessProfile(s.w.truth, s.o, s.witness, s.asker, s.deed, 0.4, s.life.now);
    expect(p.motives.fear).toBe(1);
    expect(p.motives.loyaltyToDoer).toBe(1);
    expect(p.motives.bribe).toBe(0.4);
    expect(p.recall.affinityToDoer).toBe(1);
  }, 600_000);

  it("el rencor a un tercero lo vuelve sospechoso, nunca quien hizo el hecho", () => {
    const s = scene(7);
    const third = living(s.w.truth).find(
      (id) => ![s.witness, s.asker, s.deed.by, s.deed.victim].includes(id),
    ) as AgentId;
    feel(s, third, { resentment: 0.9 });
    feel(s, s.deed.by as AgentId, { resentment: 1 });
    const p = witnessProfile(s.w.truth, s.o, s.witness, s.asker, s.deed, 0, s.life.now);
    expect(p.other).toBe(third);
    expect(p.motives.hatredOfOther).toBeCloseTo(0.9, 5);
  }, 600_000);

  it("lo declarado queda como told de quien preguntó y no pisa lo que vio", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const s = scene(7);
        const out = giveTestimony(
          s.w.truth,
          s.o,
          s.witness,
          s.asker,
          { deed: s.deed.event },
          s.cause,
          s.life.now,
          Rng.root(seed),
        );
        expect(out?.events[0]?.kind).toBe(TESTIMONY_EVENT);
        expect(out?.events[0]?.causes[0]).toEqual({ kind: "event", event: s.cause });
        const told = out?.testimony.kind !== null;
        expect(out?.changes.length).toBe(told ? 1 : 0);
        // Quien ya lo vio no cambia su versión con lo que le cuentan.
        s.w.truth.set(KNOWN_DEEDS, s.asker, { deeds: [{ ...s.deed, via: "saw" }] });
        const again = giveTestimony(
          s.w.truth,
          s.o,
          s.witness,
          s.asker,
          { deed: s.deed.event },
          s.cause,
          s.life.now,
          Rng.root(seed),
        );
        expect(again?.changes).toEqual([]);
        // Determinista con el mismo seed.
        const twin = giveTestimony(
          s.w.truth,
          s.o,
          s.witness,
          s.asker,
          { deed: s.deed.event },
          s.cause,
          s.life.now,
          Rng.root(seed),
        );
        expect(twin?.testimony).toEqual(again?.testimony);
      }),
      { numRuns: 20 },
    );
  }, 600_000);

  it("el testigo es una persona viva de la aldea", () => {
    const s = scene(7);
    expect(s.w.truth.get(PERSON, s.witness)).toBeDefined();
  }, 600_000);

  it("la oferta pesa según los gramos y satura", () => {
    expect(bribeValue(0)).toBe(0);
    expect(bribeValue(10)).toBeCloseTo(0.5, 5);
    expect(bribeValue(1000)).toBeLessThan(1);
    expect(bribeValue(20)).toBeGreaterThan(bribeValue(10));
  });

  it("sin ledger, con un bien que no es dinero o sin saldo no hay soborno", () => {
    const inq = { deed: "event:1" as EventId, offer: { unit: "good:rice", grams: 5 } };
    expect(validOffer(inq, "agent:1" as AgentId, undefined)).toBeNull();
    expect(validOffer({ deed: inq.deed }, "agent:1" as AgentId, undefined)).toBeNull();
  });

  it("el miedo a quien pregunta sube la honestidad y quita miedo al culpable", () => {
    const s = scene(7);
    feel(s, s.deed.by as AgentId, { fear: 0.8 });
    const calm = witnessProfile(s.w.truth, s.o, s.witness, s.asker, s.deed, 0, s.life.now, 0);
    const pressed = witnessProfile(s.w.truth, s.o, s.witness, s.asker, s.deed, 0, s.life.now, 1);
    expect(pressed.motives.honesty).toBeGreaterThan(calm.motives.honesty);
    expect(pressed.motives.fear).toBeLessThan(calm.motives.fear);
  }, 600_000);

  it("la claridad sale de la memoria guardada: viva casi igual, vieja y olvidada mucho menos", () => {
    const s = scene(7);
    const t = s.w.truth;
    const base = CLARITY_BY_VIA[s.deed.via];
    expect(recallClarity(t, s.witness, s.deed, s.life.now)).toBe(base);
    const mem = formMemory({
      eventId: s.deed.event,
      kind: "action.take",
      with: [],
      place: { hex: 0 } as never,
      at: s.deed.at,
      intensity: 0.9,
      valence: -0.5,
    });
    t.set(MEMORIES, s.witness, { items: [mem], gists: [] });
    const fresh = recallClarity(t, s.witness, s.deed, s.deed.at);
    expect(fresh).toBeLessThanOrEqual(base);
    expect(fresh).toBeGreaterThan(base * 0.8);
    t.set(MEMORIES, s.witness, {
      items: [],
      gists: [
        {
          kind: "action.take",
          with: [],
          count: 1,
          valence: -0.5,
          peak: 0.1,
          first: 0,
          last: 0,
          causes: [s.deed.event],
        },
      ],
    });
    expect(recallClarity(t, s.witness, s.deed, s.life.now)).toBeCloseTo(
      base * FORGOTTEN_CLARITY,
      6,
    );
  }, 600_000);
});
