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
  ITEM_WEAR,
  LOCATION,
  PERSON,
  WEAPONS,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { strikeFight, wieldedWeapon } from "./fight.ts";
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
const weapons = content.all(WEAPONS);

/** El personaje con una espada y alguien de su casa con un cuchillo, en el mismo lugar. */
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
  let n = 970;
  const give = (who: AgentId, shape: string): ItemId => {
    const id = makeId("item", n++);
    w.truth.set(ENTITY, id, { id, createdAt: 0, originEventId: origin });
    w.truth.set(ITEM_LOOK, id, { shape, size: "medium" });
    w.truth.set(ITEM_HOLD, id, { possession: who as never, rights: [] });
    return id;
  };
  const sword = give(me, "sword");
  const knife = give(other, "knife");
  const fight = (seed: number, armed: boolean) =>
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
      ...(armed ? { weapons } : {}),
    });
  return { w, me, other, sword, knife, give, fight };
}

describe("armas en la pelea de la vida (novel3-weapons-wire)", () => {
  const s = setting();

  it("el catálogo trae palo, sable, espada, lanza, cuchillo y hacha", () => {
    const shapes = weapons.map((x) => x.shape);
    for (const shape of ["stick", "saber", "sword", "spear", "knife", "axe"])
      expect(shapes).toContain(shape);
  });

  it("cada uno pelea con lo que tiene en la mano: evento, resumen, heridas y desgaste", () => {
    const hitBy = (k: number) =>
      (s.fight(k, true).event.data as { hits: { by: string }[] }).hits.some((h) => h.by === s.me);
    const seed = Array.from({ length: 30 }, (_, k) => k + 1).find(hitBy) as number;
    expect(seed).toBeDefined();
    const r = s.fight(seed, true);
    const data = r.event.data as {
      weapons: Record<string, { item: string; shape: string; wear: number }>;
      hits: { by: string }[];
    };
    expect(data.weapons[s.me]?.shape).toBe("sword");
    expect(data.weapons[s.other]?.shape).toBe("knife");
    expect(r.gist.weapon).toBe("sword");
    expect(r.gist.theirWeapon).toBe("knife");
    const wear = r.changes.filter((c) => c.table === ITEM_WEAR.name && c.op === "set");
    for (const c of wear) expect([s.sword, s.knife]).toContain(c.id);
    expect(data.hits.some((h) => h.by === s.me)).toBe(true);
    expect(wear.map((c) => c.id)).toContain(s.sword);
    const body = r.changes.find((c) => c.table === BODY_STATE.name && c.id === s.other);
    const wounds = ((body as { value?: Body } | undefined)?.value?.wounds ?? []).filter(
      (x) => x.kind === "cut",
    );
    expect(wounds.length).toBeGreaterThan(0);
    expect(s.fight(seed, true).changes).toEqual(r.changes);
  }, 120_000);

  it("sin la opción se pelea a mano: ni armas en el evento ni desgaste", () => {
    const r = s.fight(3, false);
    expect((r.event.data as { weapons?: unknown }).weapons).toBeUndefined();
    expect(r.gist.weapon).toBeUndefined();
    expect(r.changes.some((c) => c.table === ITEM_WEAR.name)).toBe(false);
  }, 120_000);

  it("prefiere la de más rango y no toma una gastada del todo ni una guardada", () => {
    expect(wieldedWeapon(s.w.truth, s.me, weapons)?.item).toBe(s.sword);
    const spear = s.give(s.me, "spear");
    expect(wieldedWeapon(s.w.truth, s.me, weapons)?.item).toBe(spear);
    s.w.truth.set(ITEM_WEAR, spear, { wear: 1 });
    expect(wieldedWeapon(s.w.truth, s.me, weapons)?.item).toBe(s.sword);
    const here = s.w.truth.get(LOCATION, s.me);
    if (here) s.w.truth.set(LOCATION, s.sword, here);
    expect(wieldedWeapon(s.w.truth, s.me, weapons)).toBeUndefined();
  }, 120_000);
});
