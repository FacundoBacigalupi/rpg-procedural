import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentId, EntityRef, EventId } from "../../core/index.ts";
import { loadContent, Rng } from "../../core/index.ts";
import {
  BODY_NUTRIENTS,
  BODY_STATE,
  DAILY_NEED,
  DIETS,
  dietDayIntake,
  ENTITY,
  FOODS,
  fullStores,
  NUTRIENT_PROFILES,
  NUTRITION,
  PERSON,
  type ProcessContext,
  WorldTruth,
} from "../../sim/index.ts";
import { BIOMES } from "../../worldgen/index.ts";
import { nutritionProcess, profileMap } from "./nutrition.ts";

const json = (f: string) => JSON.parse(readFileSync(f, "utf8"));
const content = loadContent(
  [BIOMES, FOODS, NUTRIENT_PROFILES, DIETS],
  [
    { kind: "foods", file: "a.json", data: json("content/foods/wild.json") },
    { kind: "foods", file: "c.json", data: json("content/foods/catalog.json") },
    { kind: "biomes", file: "w.json", data: json("content/biomes/whittaker.json") },
    { kind: "foods", file: "b.json", data: json("content/foods/stores.json") },
    {
      kind: "nutrient-profiles",
      file: "p.json",
      data: json("content/nutrient-profiles/staples.json"),
    },
    { kind: "diets", file: "d.json", data: json("content/diets/village.json") },
  ],
);
const profiles = content.all(NUTRIENT_PROFILES);
const diet = content.all(DIETS)[0];
const clock = { day: 86400, year: 86400 * 360, moons: [] };
const a = "agent:1" as AgentId;
const place = { kind: "cell", cell: "cell:1" } as never;

function world(body: object): WorldTruth {
  const t = new WorldTruth();
  t.set(
    ENTITY,
    a as EntityRef,
    { id: a, originEventId: "event:1" as EventId, createdAt: 0 } as never,
  );
  t.set(PERSON, a as EntityRef, { household: "household:1" } as never);
  t.set(BODY_STATE, a as EntityRef, body as never);
  return t;
}
const ctx = (truth: WorldTruth, now: number, window = clock.day) =>
  ({ now, window, truth, rng: Rng.root(1), newId: () => "x" }) as unknown as ProcessContext;

describe("life.nutrition", () => {
  it("la dieta de la aldea cubre la necesidad y no escribe nada", () => {
    const intake = dietDayIntake(diet as never, profileMap(profiles));
    for (const n of BODY_NUTRIENTS) expect(intake[n]).toBeGreaterThanOrEqual(DAILY_NEED[n]);
    const p = nutritionProcess({ clock, profiles, diet, placeOf: () => place });
    expect(p.run(ctx(world({ glycogen: 100, fat: 100 }), clock.day * 30, clock.day * 30))).toEqual(
      {},
    );
  });

  it("pasar hambre vacía reservas, avisa la carencia con causa y es determinista", () => {
    const p = nutritionProcess({ clock, profiles, diet, placeOf: () => place });
    const t = world({ glycogen: 0, fat: 0 });
    const out = p.run(ctx(t, clock.day * 200, clock.day * 200));
    expect(out.changes?.some((c) => c.table === NUTRITION.name)).toBe(true);
    const ev = out.events?.filter((e) => e.kind === "body.deficiency") ?? [];
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0]?.causes.length).toBeGreaterThan(0);
    expect(p.run(ctx(t, clock.day * 200, clock.day * 200))).toEqual(out);
  });

  it("al volver a comer las reservas se llenan y la fila se borra", () => {
    const p = nutritionProcess({ clock, profiles, diet, placeOf: () => place });
    const t = world({ glycogen: 100, fat: 100 });
    t.set(NUTRITION, a as EntityRef, { stores: { ...fullStores(), vitaminC: 59.9 }, at: 0 });
    const out = p.run(ctx(t, clock.day));
    expect(out.changes?.[0]).toMatchObject({ op: "delete", table: NUTRITION.name });
  });
});
