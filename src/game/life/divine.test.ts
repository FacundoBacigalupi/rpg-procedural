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
} from "../../core/index.ts";
import {
  DIVINATION_METHODS,
  DIVINER_ROLE,
  type DiviningCandidate,
  divinerSlots,
  ENTITY,
  PERSON,
  PROPHECY_BELIEFS,
  pickDiviners,
  prophecyId,
  type StateChange,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { consultDiviner, type DivineOptions, READING_EVENT, seedDiviners } from "./divine.ts";
import { Life } from "./life.ts";

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

const cand = (id: string, o: Partial<DiviningCandidate> = {}): DiviningCandidate => ({
  id: id as AgentId,
  ageYears: 40,
  sociability: 0,
  curiosity: 0,
  warmth: 0,
  boldness: 0,
  ...o,
});

describe("quién se hace adivino de calle", () => {
  it("un lugar chico no sostiene a ninguno y uno grande a uno cada tanto", () => {
    expect(divinerSlots(10)).toBe(0);
    expect(divinerSlots(25)).toBe(1);
    expect(divinerSlots(130)).toBe(2);
  });

  it("no elige a los jóvenes y prefiere al sociable, curioso y mayor", () => {
    const pick = pickDiviners(
      [
        cand("agent:1", { ageYears: 20, sociability: 1 }),
        cand("agent:2"),
        cand("agent:3", { sociability: 0.8, curiosity: 0.5 }),
      ],
      2,
    );
    expect(pick).toEqual(["agent:3", "agent:2"]);
  });

  it("el orden de entrada no cambia a quién elige", () => {
    fc.assert(
      fc.property(fc.nat(), (n) => {
        const all = [1, 2, 3, 4, 5].map((i) =>
          cand(`agent:${i}`, { ageYears: 30 + ((i * 7 + n) % 5) }),
        );
        expect(pickDiviners(all, 2)).toEqual(pickDiviners([...all].reverse(), 2));
      }),
      { numRuns: 20 },
    );
  });
});

describe("adivinos y consultas en la aldea", () => {
  const life = Life.create(7, content);
  const w = life.world;
  const o: DivineOptions = {
    methods: content.all(DIVINATION_METHODS),
    clock: w.clock,
    placeOf: () => ({ hex: 0 }) as never,
  };
  const apply = (changes: readonly StateChange[]) => {
    for (const c of changes) {
      if (c.op === "set") {
        if (c.table === DIVINER_ROLE.name) w.truth.set(DIVINER_ROLE, c.id, c.value as never);
        if (c.table === PROPHECY_BELIEFS.name)
          w.truth.set(PROPHECY_BELIEFS, c.id, c.value as never);
      }
    }
  };

  it("siembra tantos como cabe, con método y causa, y no repite", () => {
    const people = (w.truth.ids(PERSON) as AgentId[]).filter(
      (id) => w.truth.get(ENTITY, id)?.endedAt === undefined,
    ).length;
    const first = seedDiviners(w.truth, o, life.now);
    expect(first.changes.length).toBeLessThanOrEqual(divinerSlots(people));
    expect(first.events.length).toBe(first.changes.length);
    for (const e of first.events) expect(e.causes.length).toBeGreaterThan(0);
    expect(seedDiviners(w.truth, o, life.now)).toEqual(first);
    apply(first.changes);
    const again = seedDiviners(w.truth, o, life.now);
    expect(again.changes).toEqual([]);
  }, 60_000);

  it("la consulta deja la profecía raíz en el adivino y la contada en el cliente", () => {
    seedDiviners(w.truth, o, life.now);
    apply(seedDiviners(w.truth, o, life.now).changes);
    const diviner = (w.truth.ids(DIVINER_ROLE) as AgentId[])[0];
    if (!diviner) return;
    const client = (w.truth.ids(PERSON) as AgentId[]).find((id) => id !== diviner) as AgentId;
    const cause = w.log.all()[0]?.id as EventId;
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const out = consultDiviner(
          w.truth,
          o,
          diviner,
          client,
          { asked: "love" },
          cause,
          life.now,
          Rng.root(seed),
        );
        expect(out?.events[0]?.kind).toBe(READING_EVENT);
        expect(out?.events[0]?.causes[0]).toEqual({ kind: "event", event: cause });
        const changeOf = (who: AgentId) =>
          ((out?.changes ?? []).find((c) => c.id === who) as unknown as { value: unknown }).value;
        const mine = changeOf(diviner) as { items: { id: string; hops: number }[] };
        const theirs = changeOf(client) as {
          items: { id: string; hops: number; claim: { subject: string } }[];
        };
        expect(mine.items[0]?.id).toBe(prophecyId(cause));
        expect(mine.items[0]?.hops).toBe(0);
        expect(theirs.items[0]?.hops).toBe(1);
        expect(theirs.items[0]?.claim.subject).toBe(client);
        // Misma semilla, mismo resultado.
        expect(
          consultDiviner(
            w.truth,
            o,
            diviner,
            client,
            { asked: "love" },
            cause,
            life.now,
            Rng.root(seed),
          ),
        ).toEqual(out);
      }),
      { numRuns: 8 },
    );
  }, 120_000);

  it("sin rol de adivino no hay consulta", () => {
    const [a, b] = (w.truth.ids(PERSON) as AgentId[]).filter(
      (id) => w.truth.get(DIVINER_ROLE, id) === undefined,
    );
    const cause = w.log.all()[0]?.id as EventId;
    expect(
      consultDiviner(w.truth, o, a as AgentId, b as AgentId, {}, cause, life.now, Rng.root(1)),
    ).toBeNull();
  }, 60_000);
});
