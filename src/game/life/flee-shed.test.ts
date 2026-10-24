import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  type ContentSource,
  type EventId,
  type ItemId,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import {
  BODY_STATE,
  type Body,
  ENTITY,
  ITEM_HOLD,
  ITEM_LOOK,
  type ItemSize,
  LOCATION,
  PERSON,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { strikeFight } from "./fight.ts";
import { Life } from "./life.ts";
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

const SHEDS = new Set(["fled", "down", "dead"]);

/** El personaje y alguien de su casa en el mismo lugar, cada uno con una canasta y un cuchillo. */
function setting() {
  const life = Life.create(7, content);
  const w = life.world;
  const me = life.player;
  const house = w.truth.get(PERSON, me)?.household;
  const other = living(w.truth).find(
    (id) => id !== me && w.truth.get(PERSON, id)?.household === house,
  ) as AgentId;
  const here = w.truth.get(LOCATION, me);
  if (here) w.truth.set(LOCATION, other, here);
  const origin = w.log.all()[0]?.id as EventId;
  let n = 960;
  const give = (who: AgentId, shape: string, size: ItemSize): ItemId => {
    const id = makeId("item", n++);
    w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: origin });
    w.truth.set(ITEM_LOOK, id, { shape, size });
    w.truth.set(ITEM_HOLD, id, { possession: who as never, rights: [] });
    return id;
  };
  const carried = new Map(
    [me, other].map((id) => [
      id,
      { basket: give(id, "basket", "medium"), knife: give(id, "knife", "small") },
    ]),
  );
  const fight = (seed: number, shed: boolean) =>
    strikeFight({
      truth: w.truth,
      me,
      myBody: w.truth.get(BODY_STATE, me) as Body,
      target: other,
      plans: new Map(w.plans.map((p) => [p.id, p])),
      skills: w.skills,
      traits: w.traits,
      intent: "kill",
      light: 1,
      start: w.scheduler.now,
      rng: Rng.root(seed),
      cause: origin,
      place: { kind: "cell", cell: makeId("cell", 1) },
      ...(shed ? { shed: true } : {}),
    });
  return { w, me, other, carried, fight };
}

const outcomesOf = (event: { data?: unknown }) =>
  (event.data as { outcomes: Record<string, string> }).outcomes;

describe("lo que se pierde al huir o caer (play-refs-objects-source-flee)", () => {
  const s = setting();
  // Busca una pelea en que alguien huya o caiga (depende del seed; el hallazgo es determinista).
  const seed = Array.from({ length: 40 }, (_, k) => k + 1).find((k) =>
    Object.values(outcomesOf(s.fight(k, false).event)).some((o) => SHEDS.has(o)),
  );

  it("quien huye o cae suelta la canasta donde pasó; el cuchillo y lo del que sigue en pie no", () => {
    expect(seed).toBeDefined();
    const r = s.fight(seed as number, true);
    const outcomes = outcomesOf(r.event);
    const moved = new Set(
      r.changes.filter((c) => c.table === ITEM_HOLD.name && c.op === "set").map((c) => c.id),
    );
    expect(moved.size).toBeGreaterThan(0);
    for (const who of [s.me, s.other]) {
      const { basket, knife } = s.carried.get(who) as { basket: ItemId; knife: ItemId };
      expect(moved.has(knife)).toBe(false);
      expect(moved.has(basket)).toBe(SHEDS.has(outcomes[who] ?? ""));
      if (moved.has(basket)) {
        expect(r.changes).toContainEqual(
          expect.objectContaining({ op: "set", table: LOCATION.name, id: basket }),
        );
      }
    }
  }, 120_000);

  it("es determinista y sin `shed` (replay anterior a life-45) no suelta nada", () => {
    const r = s.fight(seed as number, true);
    expect(s.fight(seed as number, true).changes).toEqual(r.changes);
    const old = s.fight(seed as number, false);
    expect(outcomesOf(old.event)).toEqual(outcomesOf(r.event));
    expect(old.changes.some((c) => c.table === ITEM_HOLD.name)).toBe(false);
  }, 120_000);
});
