import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentId, BuildingId, HouseholdId } from "../../core/index.ts";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { ANIMAL, BUILDING, checkInvariants, ENTITY, heirOf, PERSON } from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { FULL_PROFILE } from "./profile.ts";

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
const SEED = 3;

/**
 * Se queda sin nadie vivo un hogar con animales (no el del jugador) cuyos muertos tienen un
 * pariente vivo en otro hogar con casa; devuelve el hogar y sus animales.
 */
function emptyAHerd(l: Life): { h: HouseholdId; animals: string[] } {
  const t = l.world.truth;
  const mine = t.get(PERSON, l.player)?.household;
  const homes = new Map<HouseholdId, BuildingId>();
  for (const b of (t.ids(BUILDING) as BuildingId[]).sort()) {
    const h = t.get(BUILDING, b)?.household;
    if (h !== undefined && !homes.has(h)) homes.set(h, b);
  }
  const alive = (id: string) => t.get(ENTITY, id as never)?.endedAt === undefined;
  const people = (t.ids(PERSON) as AgentId[]).sort().filter(alive);
  const owners = [
    ...new Set((t.ids(ANIMAL) as string[]).map((a) => t.get(ANIMAL, a as never)?.owner)),
  ].sort() as HouseholdId[];
  const end = l.world.log.all().at(-1);
  for (const h of owners) {
    if (h === mine) continue;
    const members = people.filter((p) => t.get(PERSON, p)?.household === h);
    if (members.length === 0 || end === undefined) continue;
    if (!members.every((m) => heirOf(t, m, homes) !== undefined)) continue;
    for (const m of members) {
      const e = t.get(ENTITY, m);
      if (e) t.set(ENTITY, m, { ...e, endedAt: end.tick, endEventId: end.id });
    }
    const animals = (t.ids(ANIMAL) as string[]).filter(
      (a) => t.get(ANIMAL, a as never)?.owner === h && alive(a),
    );
    return { h, animals };
  }
  throw new Error("sin hogar con heredero");
}

describe("los animales del hogar que se queda sin nadie se heredan (livestock-tenure-heir)", () => {
  it("encendido: pasan a un pariente vivo de otro hogar y a su casa; apagado, no; determinista", () => {
    const run = (heir: boolean) => {
      const l = Life.create(SEED, content, {
        frequency: 8,
        villageLivestock: true,
        livestockHeir: heir,
      });
      const { h, animals } = emptyAHerd(l);
      l.advanceTo(l.now + 2 * DAY);
      return { l, h, animals };
    };
    const on = run(true);
    const t = on.l.world.truth;
    const ev = on.l.world.log.all().find((e) => e.kind === "living.livestock_inherited");
    const data = ev?.data as { from: string; to: string; animals: string[] } | undefined;
    expect(data?.from).toBe(on.h);
    expect(data?.to).not.toBe(on.h);
    expect(t.get(PERSON, ev?.actors[0] as never)?.household).toBe(data?.to);
    expect(ev?.causes[0]?.kind).toBe("event");
    for (const a of data?.animals ?? []) {
      const r = t.get(ANIMAL, a as never);
      expect(r?.owner).toBe(data?.to);
      expect(t.get(BUILDING, r?.home as never)?.household).toBe(data?.to);
    }
    expect(data?.animals.length).toBeGreaterThan(0);
    const w = on.l.world;
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(run(true).l.hash().total).toBe(on.l.hash().total);
    const off = run(false);
    const ot = off.l.world.truth;
    expect(off.animals.every((a) => ot.get(ANIMAL, a as never)?.owner === off.h)).toBe(true);
    expect(FULL_PROFILE).toMatchObject({ livestockHeir: true });
  }, 600_000);
});
