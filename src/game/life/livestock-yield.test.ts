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
import { ANIMAL, checkInvariants, ENTITY, LAID_SOURCE } from "../../sim/index.ts";
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
