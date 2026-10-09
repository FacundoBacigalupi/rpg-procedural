import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  EARTHLIKE_CLOCK,
  type Event,
  loadContent,
} from "../../core/index.ts";
import { BORN_TABOO, PERSON, PERSON_NAME } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { bornTaboosProcess, bornTaboosSettleProcess, liveTaboos, villageOf } from "./taboos.ts";

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

describe("tabúes que nacen en la aldea", () => {
  const w = Life.create(7, content).world;
  const form = w.form;
  if (!form) throw new Error("la aldea tiene forma de habla");
  const village = villageOf(w.truth);
  const dead = w.truth.ids(PERSON).find((id) => w.truth.get(PERSON_NAME, id)) as AgentId;
  const died: Event = {
    id: "event:9999" as Event["id"],
    tick: 100,
    kind: "body.died",
    actors: [dead],
    place: { kind: "settlement", settlement: village as never },
    data: { cause: "age" },
    emissions: null,
    causes: [{ kind: "seed" }],
    resolution: "local",
  };
  const placeOf = () => died.place;
  const ctx = (now: number, recent: Event[]) =>
    ({ now, recent, truth: w.truth, window: 0 }) as never;

  it("la aldea tiene su asentamiento", () => {
    expect(village).toBeDefined();
  });

  it("al morir alguien nace el tabú de su nombre, con evento que cuelga de la muerte", () => {
    const p = bornTaboosProcess({ form, clock: EARTHLIKE_CLOCK, placeOf });
    const out = p.run(ctx(100, [died]));
    expect(out.events).toHaveLength(1);
    expect(out.events?.[0]?.kind).toBe("language.taboo_born");
    expect(out.events?.[0]?.causes).toEqual([{ kind: "event", event: died.id }]);
    expect(out.changes).toHaveLength(1);
  });

  it("sin la muerte en los eventos no pasa nada", () => {
    const p = bornTaboosProcess({ form, clock: EARTHLIKE_CLOCK, placeOf });
    expect(p.run(ctx(100, []))).toEqual({});
  });

  it("el tabú vivo entra a la lista de tabúes de la forma y los años lo asientan", () => {
    const truth = w.truth;
    const given = truth.get(PERSON_NAME, dead)?.parts.find((x) => x.kind === "given");
    truth.set(BORN_TABOO, dead, {
      subject: dead,
      community: village as never,
      language: form.language.id,
      kind: "dead",
      word: given?.meaning ?? ["clear"],
      circumlocution: ["old", "mountain"],
      severity: 0.6,
      bornAt: 100,
      uses: 0,
      status: "active",
      causeEvent: died.id,
      originEventId: "event:9998" as Event["id"],
    });
    expect(liveTaboos(truth, form, 100).length).toBe(form.taboos.length + 1);
    const settle = bornTaboosSettleProcess({ village: died.place });
    expect(settle.run(ctx(100 + 61 * 365 * 86_400, []))).toMatchObject({
      events: [{ kind: "language.taboo_lapsed" }],
    });
  });
});
