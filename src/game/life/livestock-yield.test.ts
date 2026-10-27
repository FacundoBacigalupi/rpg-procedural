import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  holderAccount,
  ledgerUnit,
  loadContent,
} from "../../core/index.ts";
import {
  ANIMAL,
  checkInvariants,
  coldFactor,
  daylightFactor,
  ENTITY,
  hungerFactor,
  LAID_SOURCE,
  LIVESTOCK,
} from "../../sim/index.ts";
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
const OPTS = { frequency: 8, villageLivestock: true, livestockYield: true } as const;
const EGG = ledgerUnit("good:egg");

describe("las gallinas ponen huevos (livestock-yield)", () => {
  it("los huevos entran al hogar dueño, de gallinas adultas, con el evento que las cita", () => {
    const life = Life.create(7, content, OPTS);
    const w = life.world;
    life.advanceTo(life.now + 20 * DAY);
    const laid = w.log.all().filter((e) => e.kind === "living.animal_yield");
    expect(laid.length).toBeGreaterThan(0);
    for (const e of laid) {
      const d = e.data as { owner: string; good: string; grams: number; from: string[] };
      expect(d.good).toBe("egg");
      expect(d.grams).toBe(50 * d.from.length);
      expect(e.causes).toEqual(d.from.map((id) => ({ kind: "state", entity: id, key: "yield" })));
      for (const id of d.from) {
        const a = w.truth.get(ANIMAL, id as never);
        expect(a).toMatchObject({ species: "hen", sex: "female", owner: d.owner });
      }
      const posted = w.ledger.journal().filter((j) => j.eventId === e.id);
      expect(posted.map((j) => [j.unit, j.from, j.to, j.amount])).toEqual([
        [EGG, externalAccount(LAID_SOURCE), holderAccount(d.owner as never), d.grams],
      ]);
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ livestockYield: true });
  }, 300_000);

  it("con días cortos ponen menos (livestock-yield-season)", () => {
    const hen = content.all(LIVESTOCK).find((s) => s.id === "hen")?.yields?.[0];
    if (!hen) throw new Error("sin huevos");
    expect(daylightFactor(hen, undefined)).toBe(1);
    expect(daylightFactor(hen, 16)).toBe(1);
    expect(daylightFactor(hen, 6)).toBeCloseTo(0.15);
    expect(daylightFactor(hen, 11.5)).toBeCloseTo(0.575);
    expect(daylightFactor({ ...hen, daylightHours: undefined }, 6)).toBe(1);
    const eggs = (season: boolean) => {
      const l = Life.create(7, content, { ...OPTS, livestockSeason: season });
      l.advanceTo(l.now + 20 * DAY);
      return l.world.log
        .all()
        .filter((e) => e.kind === "living.animal_yield")
        .reduce((n, e) => n + (e.data as { grams: number }).grams, 0);
    };
    // La misma tirada por gallina y día con una chance menor: pone un subconjunto.
    const plain = eggs(false);
    const seasonal = eggs(true);
    expect(seasonal).toBeLessThanOrEqual(plain);
    expect(FULL_PROFILE).toMatchObject({ livestockSeason: true });
  }, 600_000);

  it("con frío y con hambre ponen menos (livestock-yield-feed)", () => {
    const hen = content.all(LIVESTOCK).find((s) => s.id === "hen")?.yields?.[0];
    if (!hen) throw new Error("sin huevos");
    expect(coldFactor(hen, undefined)).toBe(1);
    expect(coldFactor(hen, 20)).toBe(1);
    expect(coldFactor(hen, -10)).toBeCloseTo(0.3);
    expect(coldFactor(hen, 6)).toBeCloseTo(0.65);
    expect(coldFactor({ ...hen, coldC: undefined }, -10)).toBe(1);
    expect(hungerFactor(hen, 0)).toBe(1);
    expect(hungerFactor(hen, 0.25)).toBeCloseTo(0.5);
    expect(hungerFactor(hen, 0.8)).toBe(0);
    expect(hungerFactor({ ...hen, hungerStop: undefined }, 0.8)).toBe(1);
    const run = (feed: boolean) => {
      const l = Life.create(7, content, {
        ...OPTS,
        livestockFeed: true,
        livestockYieldFeed: feed,
      });
      l.advanceTo(l.now + 20 * DAY);
      return l;
    };
    const eggs = (l: Life) =>
      l.world.log
        .all()
        .filter((e) => e.kind === "living.animal_yield")
        .reduce((n, e) => n + (e.data as { grams: number }).grams, 0);
    // La misma tirada por gallina y día con una chance igual o menor: pone un subconjunto.
    const fed = run(true);
    expect(eggs(fed)).toBeLessThanOrEqual(eggs(run(false)));
    expect(fed.world.ledger.audit()).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ livestockYieldFeed: true });
  }, 600_000);

  it("es determinista, y sin la opción no ponen", () => {
    const run = () => {
      const l = Life.create(7, content, OPTS);
      l.advanceTo(l.now + 10 * DAY);
      return l.world.log
        .all()
        .filter((e) => e.kind === "living.animal_yield")
        .map((e) => [e.tick, e.data]);
    };
    expect(run()).toEqual(run());
    const off = Life.create(7, content, { frequency: 8, villageLivestock: true });
    off.advanceTo(off.now + 10 * DAY);
    expect(off.world.log.all().some((e) => e.kind === "living.animal_yield")).toBe(false);
    expect(off.world.truth.ids(ANIMAL).every((id) => off.world.truth.get(ENTITY, id))).toBe(true);
  }, 600_000);
});
