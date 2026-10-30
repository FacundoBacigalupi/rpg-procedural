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
import { theftTargetOf } from "./slaughter.ts";

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

const plan = (actor: string, what: string): ActionPlan => ({
  actor: actor as never,
  source: "player",
  root: { kind: "do", verb: "take", args: [{ role: "what", text: what }], manner: [] },
  manner: [],
  causes: [{ kind: "state", entity: actor as never, key: "intent" }],
});

/**
 * El personaje (de un hogar con casa que no es el dueño) se para al lado de una cabra ajena;
 * devuelve el hogar dueño y la cabra.
 */
function besideOthersGoat(l: Life): { owner: string; goat: string } {
  const t = l.world.truth;
  const mine = t.get(PERSON, l.player)?.household;
  const goat = (t.ids(ANIMAL) as string[]).sort().find((id) => {
    const a = t.get(ANIMAL, id as never);
    return (
      a?.species === "goat" && a.owner !== mine && t.get(ENTITY, id as never)?.endedAt === undefined
    );
  });
  const owner = goat === undefined ? undefined : t.get(ANIMAL, goat as never)?.owner;
  const hex = goat === undefined ? undefined : t.get(LOCATION, goat as never)?.hex;
  if (goat === undefined || owner === undefined || hex === undefined) throw new Error("sin cabra");
  const housed = new Set(t.ids(BUILDING).map((b) => t.get(BUILDING, b)?.household));
  if (!housed.has(mine)) throw new Error("sin casa");
  t.set(LOCATION, l.player, { hex });
  return { owner, goat };
}

describe("robar un animal ajeno (livestock-tenure-theft)", () => {
  it("pura: la especie tiene que estar dicha y el animal, al lado y de otro hogar", () => {
    const l = Life.create(SEED, content, {
      frequency: 8,
      villageLivestock: true,
      livestockDairy: true,
    });
    const { owner } = besideOthersGoat(l);
    const t = l.world.truth;
    const o = { species: content.all(LIVESTOCK), year: l.world.clock.year };
    const got = theftTargetOf(t, l.player, "la cabra", l.now, o);
    expect(t.get(ANIMAL, got?.animal as never)?.owner).toBe(owner);
    expect(got?.household).toBe(t.get(PERSON, l.player)?.household);
    expect(t.get(PERSON, got?.victim as never)?.household).toBe(owner);
    expect(theftTargetOf(t, l.player, undefined, l.now, o)).toBeUndefined();
    t.set(LOCATION, l.player, { hex: (t.get(LOCATION, l.player)?.hex ?? 0) + 1 });
    expect(theftTargetOf(t, l.player, "la cabra", l.now, o)).toBeUndefined();
  }, 300_000);

  it("encendido: la cabra pasa a la casa del ladrón y queda el robo; apagado, no; determinista", () => {
    const run = (steal: boolean) => {
      const l = Life.create(SEED, content, {
        frequency: 8,
        villageLivestock: true,
        livestockDairy: true,
        livestockLife: true,
        livestockSlaughter: true,
        livestockSteal: steal,
      });
      const { owner, goat } = besideOthersGoat(l);
      const from = l.world.log.all().length;
      l.turn(plan(l.player, "la cabra"), 1);
      return { l, owner, goat, from };
    };
    const on = run(true);
    const t = on.l.world.truth;
    const mine = t.get(PERSON, on.l.player)?.household;
    const goats = (t.ids(ANIMAL) as string[]).filter((id) => {
      const a = t.get(ANIMAL, id as never);
      return a?.species === "goat" && a.owner === mine;
    });
    expect(goats.length).toBeGreaterThan(0);
    expect(t.get(BUILDING, t.get(ANIMAL, goats[0] as never)?.home as never)?.household).toBe(mine);
    const took = on.l.world.log
      .all()
      .slice(on.from)
      .find((e) => e.kind === "action.take");
    expect((took?.data as { effect?: { animal?: string } } | null)?.effect?.animal).toBeDefined();
    const w = on.l.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).l.hash().total).toBe(on.l.hash().total);
    const off = run(false);
    expect(off.l.world.truth.get(ANIMAL, off.goat as never)?.owner).toBe(off.owner);
    expect(FULL_PROFILE).toMatchObject({ livestockSteal: true });
  }, 600_000);
});
