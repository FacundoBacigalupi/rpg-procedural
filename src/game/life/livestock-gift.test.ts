import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import {
  type ActionPlan,
  ANIMAL,
  BUILDING,
  checkInvariants,
  ENTITY,
  LIVESTOCK,
  LOCATION,
  PERSON,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";
import { giftTargetOf } from "./slaughter.ts";

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
const SEED = 3;

const plan = (actor: string, to: string, what: string): ActionPlan => ({
  actor: actor as never,
  source: "player",
  root: {
    kind: "do",
    verb: "give",
    args: [
      { role: "to", entity: to as never },
      { role: "what", text: what },
    ],
    manner: [],
  },
  manner: [],
  causes: [{ kind: "state", entity: actor as never, key: "intent" }],
});

/**
 * El personaje pasa a la casa de una cabra y se para a su lado con un vecino de otro hogar que
 * tiene casa; devuelve la cabra, la casa y el vecino.
 */
function besideGoatAndNeighbor(l: Life): { owner: string; neighbor: string } {
  const t = l.world.truth;
  const goat = (t.ids(ANIMAL) as string[])
    .sort()
    .find(
      (id) =>
        t.get(ANIMAL, id as never)?.species === "goat" &&
        t.get(ENTITY, id as never)?.endedAt === undefined,
    );
  const owner = goat === undefined ? undefined : t.get(ANIMAL, goat as never)?.owner;
  const hex = goat === undefined ? undefined : t.get(LOCATION, goat as never)?.hex;
  const me = t.get(PERSON, l.player);
  if (goat === undefined || owner === undefined || hex === undefined || me === undefined) {
    throw new Error("sin cabra");
  }
  const housed = new Set(t.ids(BUILDING).map((b) => t.get(BUILDING, b)?.household));
  const neighbor = (t.ids(PERSON) as string[]).sort().find((p) => {
    const h = t.get(PERSON, p as never)?.household;
    return (
      p !== l.player &&
      h !== undefined &&
      h !== owner &&
      housed.has(h) &&
      t.get(ENTITY, p as never)?.endedAt === undefined
    );
  });
  if (neighbor === undefined) throw new Error("sin vecino");
  t.set(PERSON, l.player, { ...me, household: owner });
  t.set(LOCATION, l.player, { hex });
  t.set(LOCATION, neighbor as never, { hex });
  return { owner, neighbor };
}

describe("regalar un animal de la casa (livestock-tenure-gift)", () => {
  it("pura: la especie tiene que estar dicha y el otro, al lado y de otro hogar", () => {
    const l = Life.create(SEED, content, {
      frequency: 8,
      villageLivestock: true,
      livestockDairy: true,
    });
    const { owner, neighbor } = besideGoatAndNeighbor(l);
    const t = l.world.truth;
    const o = { species: content.all(LIVESTOCK), year: l.world.clock.year };
    const got = giftTargetOf(t, l.player, neighbor, "la cabra", l.now, o);
    expect(t.get(ANIMAL, got?.animal as never)?.owner).toBe(owner);
    expect(got?.household).toBe(t.get(PERSON, neighbor as never)?.household);
    expect(t.get(BUILDING, got?.home as never)?.household).toBe(got?.household);
    // Sin decir qué animal (o con otra cosa), no hay regalo de animal.
    expect(giftTargetOf(t, l.player, neighbor, undefined, l.now, o)).toBeUndefined();
    expect(giftTargetOf(t, l.player, neighbor, "el grano", l.now, o)).toBeUndefined();
    // Lejos, no.
    t.set(LOCATION, neighbor as never, { hex: (t.get(LOCATION, l.player)?.hex ?? 0) + 1 });
    expect(giftTargetOf(t, l.player, neighbor, "la cabra", l.now, o)).toBeUndefined();
  }, 300_000);

  it("encendido: la cabra pasa al hogar del vecino y a su casa; apagado, no; determinista", () => {
    const run = (gift: boolean) => {
      const l = Life.create(SEED, content, {
        frequency: 8,
        villageLivestock: true,
        livestockDairy: true,
        livestockLife: true,
        livestockSlaughter: true,
        livestockGift: gift,
      });
      const { owner, neighbor } = besideGoatAndNeighbor(l);
      const goats = (l.world.truth.ids(ANIMAL) as string[]).filter((id) => {
        const a = l.world.truth.get(ANIMAL, id as never);
        return a?.owner === owner && a.species === "goat";
      });
      l.turn(plan(l.player, neighbor, "la cabra"), 1);
      return { l, owner, neighbor, goats };
    };
    const on = run(true);
    const t = on.l.world.truth;
    const theirs = t.get(PERSON, on.neighbor as never)?.household;
    const given = on.goats.filter((id) => t.get(ANIMAL, id as never)?.owner === theirs);
    expect(given.length).toBe(1);
    const home = t.get(ANIMAL, given[0] as never)?.home;
    expect(t.get(BUILDING, home as never)?.household).toBe(theirs);
    const w = on.l.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).l.hash().total).toBe(on.l.hash().total);
    const off = run(false);
    const ot = off.l.world.truth;
    expect(off.goats.every((id) => ot.get(ANIMAL, id as never)?.owner === off.owner)).toBe(true);
    expect(FULL_PROFILE).toMatchObject({ livestockGift: true });
  }, 600_000);
});
