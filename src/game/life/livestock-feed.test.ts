import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ContentSource,
  externalAccount,
  holderAccount,
  loadContent,
} from "../../core/index.ts";
import {
  ANIMAL,
  ANIMAL_HUNGER,
  checkInvariants,
  FED_SINK,
  feedRation,
  LIVESTOCK,
  nextHunger,
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
// Una ración que ninguna casa puede dar: todos pasan hambre y mueren en pocos días.
const famished = loadContent(
  GAME_CONTENT_KINDS,
  sources("content").map((s) =>
    s.kind === "livestock"
      ? {
          ...s,
          data: (s.data as { id: string; feed?: object }[]).map((d) => ({
            ...d,
            feed: { ...d.feed, gramsPerDay: 1e9, starveDays: 3 },
          })),
        }
      : s,
  ),
);
const DAY = 86_400;
const OPTS = { frequency: 8, villageLivestock: true, livestockFeed: true } as const;

describe("el ganado come de la casa (livestock-feed)", () => {
  it("ración y hambre puras", () => {
    const hen = content.all(LIVESTOCK).find((s) => s.id === "hen");
    if (!hen) throw new Error("sin gallina");
    expect(feedRation(hen, 2, DAY, DAY)).toBe(40);
    expect(feedRation(hen, 0.25, DAY, DAY)).toBe(20);
    expect(feedRation({ ...hen, feed: undefined }, 2, DAY, DAY)).toBe(0);
    expect(nextHunger(0, 0, DAY, DAY, 10)).toBeCloseTo(0.1);
    expect(nextHunger(0.5, 1, DAY, DAY, 10)).toBeCloseTo(0.4);
    expect(nextHunger(0.05, 1, DAY, DAY, 10)).toBe(0);
    expect(nextHunger(0.95, 0, DAY, DAY, 10)).toBe(1);
    expect(nextHunger(0.3, 0.5, DAY, DAY, 10)).toBeCloseTo(0.3);
  });

  it("lo que come sale de la comida del hogar dueño, con el evento que cita a los que comieron", () => {
    const life = Life.create(7, content, OPTS);
    const w = life.world;
    life.advanceTo(life.now + 10 * DAY);
    const fed = w.log.all().filter((e) => e.kind === "living.animal_fed");
    expect(fed.length).toBeGreaterThan(0);
    for (const e of fed) {
      const d = e.data as { owner: string; eaters: string[]; grams: Record<string, number> };
      expect(e.causes).toEqual(
        d.eaters.map((id) => ({ kind: "state", entity: id, key: "hunger" })),
      );
      for (const id of d.eaters) {
        expect(w.truth.get(ANIMAL, id as never)?.owner).toBe(d.owner);
      }
      const posted = w.ledger.journal().filter((j) => j.eventId === e.id);
      expect(posted.length).toBe(Object.keys(d.grams).length);
      for (const j of posted) {
        expect(j.from).toBe(holderAccount(d.owner as never));
        expect(j.to).toBe(externalAccount(FED_SINK));
        expect(j.amount).toBe(d.grams[j.unit.replace("good:", "")]);
      }
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
    expect(FULL_PROFILE).toMatchObject({ livestockFeed: true });
  }, 300_000);

  it("sin comida pasan hambre y mueren de hambre", () => {
    const life = Life.create(7, famished, { ...OPTS, livestockLife: true });
    const w = life.world;
    const animals = w.truth.ids(ANIMAL).length;
    life.advanceTo(life.now + 2 * DAY);
    expect(w.truth.ids(ANIMAL_HUNGER).length).toBeGreaterThan(0);
    life.advanceTo(life.now + 4 * DAY);
    const starved = w.log
      .all()
      .filter(
        (e) => e.kind === "living.animal_died" && (e.data as { cause: string }).cause === "hunger",
      );
    expect(starved.length).toBeGreaterThan(animals / 2);
    for (const e of starved) {
      const id = (e.data as { animal: string }).animal;
      expect(e.causes).toEqual([{ kind: "state", entity: id, key: "hunger" }]);
      expect(w.truth.get(ANIMAL_HUNGER, id as never)).toBeUndefined();
    }
    expect(w.ledger.audit()).toEqual([]);
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 300_000);

  it("es determinista, y sin la opción no comen", () => {
    const run = () => {
      const l = Life.create(7, content, OPTS);
      l.advanceTo(l.now + 5 * DAY);
      return l.world.log
        .all()
        .filter((e) => e.kind === "living.animal_fed")
        .map((e) => [e.tick, e.data]);
    };
    expect(run()).toEqual(run());
    const off = Life.create(7, content, { frequency: 8, villageLivestock: true });
    off.advanceTo(off.now + 5 * DAY);
    expect(off.world.log.all().some((e) => e.kind === "living.animal_fed")).toBe(false);
    expect(off.world.truth.ids(ANIMAL_HUNGER).length).toBe(0);
  }, 600_000);
});
