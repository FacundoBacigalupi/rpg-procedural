import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EventId, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  HABITS,
  HABITS_CONTENT,
  type HabitDef,
  type HabitHold,
  habitStrength,
  habitsFed,
  MIND,
  PERSON,
  reinforce,
  settledHabits,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
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
const DEFS = content.all(HABITS_CONTENT);
const DAY = 86_400;
const EVENT = 1 as unknown as EventId;

const def: HabitDef = {
  id: "digging",
  species: "human",
  name: "Cavar",
  verbs: ["work"],
  kinds: [],
  gain: 0.2,
  halfLifeDays: 10,
  settledAt: 0.5,
};

describe("hábitos: núcleo puro", () => {
  it("cada repetición suma con rendimiento decreciente y nunca pasa de 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (n) => {
        let hold: HabitHold | undefined;
        let last = 0;
        for (let i = 0; i < n; i++) {
          hold = reinforce(hold, def, i * 60, EVENT).hold;
          expect(hold.strength).toBeGreaterThanOrEqual(last);
          expect(hold.strength).toBeLessThanOrEqual(1);
          last = hold.strength;
        }
        expect(hold?.reps).toBe(n);
      }),
    );
  });

  it("se enfría a la mitad con la vida media y no vuelve solo", () => {
    const hold = { strength: 0.8, updated: 0, reps: 9, causes: [] };
    expect(habitStrength(hold, def, 10 * DAY)).toBeCloseTo(0.4, 3);
    expect(habitStrength(hold, def, 0)).toBe(0.8);
    expect(habitStrength(undefined, def, 5)).toBe(0);
  });

  it("se asienta una sola vez al cruzar el umbral, y de nuevo solo tras enfriarse", () => {
    let hold: HabitHold | undefined;
    const settled: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      const r = reinforce(hold, def, i * 60, EVENT);
      hold = r.hold;
      settled.push(r.settled);
    }
    expect(settled.filter(Boolean)).toHaveLength(1);
    // Un año sin hacerlo lo enfría; retomarlo lo asienta otra vez.
    let again = false;
    for (let i = 0; i < 8; i++) {
      const r = reinforce(hold, def, 365 * DAY + i * 60, EVENT);
      hold = r.hold;
      again ||= r.settled;
    }
    expect(again).toBe(true);
  });

  it("un evento alimenta los hábitos de su verbo o de su tipo", () => {
    expect(habitsFed(DEFS, "action.strike").map((d) => d.id)).toEqual(["brawling"]);
    expect(habitsFed(DEFS, "routine.harvested").map((d) => d.id)).toEqual(["farming"]);
    expect(habitsFed(DEFS, "action.wait")).toEqual([]);
  });

  it("los asentados salen del más fuerte al más débil", () => {
    const habits = {
      holds: {
        digging: { strength: 0.9, updated: 0, reps: 3, causes: [] },
        other: { strength: 0.6, updated: 0, reps: 3, causes: [] },
        faint: { strength: 0.2, updated: 0, reps: 3, causes: [] },
      },
    };
    const defs = [def, { ...def, id: "other" }, { ...def, id: "faint" }];
    expect(settledHabits(habits, defs, 0).map((s) => s.def.id)).toEqual(["digging", "other"]);
  });
});

describe("la aldea toma hábitos de lo que hace", () => {
  const month = (seed: number) => {
    const life = Life.create(seed, content);
    life.advanceTo(life.now + 30 * DAY);
    return life;
  };

  it("quien siembra todos los días termina con el hábito asentado, y lo cita", () => {
    const life = month(10);
    const w = life.world;
    const farmers = living(w.truth).filter(
      (id) => (w.truth.get(HABITS, id)?.holds["farming"]?.reps ?? 0) > 0,
    );
    expect(farmers.length).toBeGreaterThan(0);
    const settled = farmers.filter(
      (id) => settledHabits(w.truth.get(HABITS, id), DEFS, life.now).length > 0,
    );
    expect(settled.length).toBeGreaterThan(0);
    for (const id of settled) {
      const hold = w.truth.get(HABITS, id)?.holds["farming"];
      const ev = w.log.all().find((e) => e.id === hold?.causes.at(-1));
      expect(ev?.kind).toBe("routine.harvested");
      // Al asentarse dejó su marca: el último esquema tocado cita un evento de cosecha.
      const cited = Object.values(w.truth.get(MIND, id)?.schemas ?? {}).some((h) =>
        h.causes.some((c) => w.log.all().find((e) => e.id === c)?.kind === "routine.harvested"),
      );
      expect(cited).toBe(true);
    }
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 180_000);

  it("los chicos que no trabajan no lo tienen", () => {
    const life = month(10);
    const w = life.world;
    const kids = living(w.truth).filter((id: AgentId) => {
      const p = w.truth.get(PERSON, id);
      return p && (life.now - p.born) / w.clock.year < 8;
    });
    for (const id of kids) expect(w.truth.get(HABITS, id)?.holds["farming"]).toBeUndefined();
  }, 180_000);

  it("es determinista", () => {
    expect(month(10).hash()).toEqual(month(10).hash());
  }, 360_000);
});
