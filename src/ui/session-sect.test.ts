import { describe, expect, it } from "vitest";
import { GAME_CONTENT_KINDS, GOAL_HOUR_EVENT, goalHour } from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import {
  type Goal,
  LOCATION,
  SECT,
  SECT_LORE,
  upcomingVisit,
  VILLAGE_SQUARE,
} from "../sim/index.ts";
import { lifeConfig } from "./config.ts";
import { openSession } from "./session.ts";

const base = { mode: "realista", save: "x", runtime: "ollama", think: false } as const;
const content = loadContentDir("content", GAME_CONTENT_KINDS);

describe("las metas de cultivar toman la bajada de la secta (novel-cult-sect-goals)", () => {
  it("puro: el día que cree que la secta está, la meta de cultivar lo lleva a la plaza", () => {
    const g = (id: string): Goal =>
      ({
        id,
        layer: "long",
        kind: "pursue",
        weight: 0.5,
        originEventId: "event:1",
        since: 0,
      }) as unknown as Goal;
    const ok = { ageYears: 12, workAge: 10, rested: true, able: true };
    const alive = () => true;
    const cult = g("resolve:cultivate");
    const rich = g("resolve:wealth");
    expect(goalHour([cult, rich], 6, ok, alive)).toEqual({ kind: "work", goal: rich.id });
    expect(goalHour([cult, rich], 6, { ...ok, sectHere: true }, alive)).toEqual({
      kind: "square",
      goal: cult.id,
    });
    expect(goalHour([cult], 13, { ...ok, sectHere: true }, alive)).toEqual({
      kind: "square",
      goal: cult.id,
    });
    expect(goalHour([cult], 13, { ...ok, sectHere: true, able: false }, alive)).toBeUndefined();
    expect(goalHour([rich], 13, { ...ok, sectHere: true }, alive)).toBeUndefined();
  });

  it("seed 1: el aviso corta el salto, y el día de la bajada va a la plaza", async () => {
    const config = lifeConfig({ ...base, seed: "1", cultivation: true });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    const life = session.life;
    const w = life.world;
    await session.say("quiero entrar a una secta");
    const org = w.truth.ids(SECT)[0];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    if (!org || !sect) throw new Error("sin secta");
    const offset = Math.round((w.map.lonDeg / 360) * w.clock.day);
    const yearDays = Math.round(w.clock.year / w.clock.day);
    const today = Math.floor((life.now + offset) / w.clock.day) % yearDays;
    const day = (today + 10) % yearDays;
    w.truth.set(SECT, org, { ...sect, visitDay: day });
    const visit = upcomingVisit(life.now, day, w.clock, offset);

    // El aviso llega una semana antes: lo sabe (cree la fecha) y corta el salto.
    const first = await session.say("sigo con mi vida dos semanas");
    expect(first.text).toMatch(/Dejás lo que hacías/);
    expect(life.now).toBeLessThan(visit.start);
    expect(w.truth.get(SECT_LORE, life.player)?.visitAt).toBe(visit.start);

    // El día de la bajada la meta lo lleva a la plaza, y la llegada corta el salto.
    const second = await session.say("sigo con mi vida dos semanas");
    expect(second.text).toMatch(/la secta/);
    expect(life.now).toBeGreaterThanOrEqual(visit.start);
    expect(life.now).toBeLessThan(visit.end);
    expect(w.truth.get(LOCATION, life.player)?.space).toBe(VILLAGE_SQUARE);
    const square = w.log
      .all()
      .filter((e) => e.kind === GOAL_HOUR_EVENT && (e.data as { what?: string }).what === "square");
    expect(square.length).toBeGreaterThan(0);
    expect(square.every((e) => e.tick >= visit.start && e.tick < visit.end)).toBe(true);
    // Ya en la plaza no se le propone ir; si se va, la meta se lo ofrece.
    expect(session.suggested(true).some((s) => s.id === "goal:1")).toBe(false);
    const at = w.truth.get(LOCATION, life.player);
    if (!at) throw new Error("sin lugar");
    w.truth.set(LOCATION, life.player, { hex: at.hex });
    const go = session.suggested(true).find((s) => s.id === "goal:1");
    expect(go?.goal?.say).toBe("ir a la plaza, que bajó la secta");
    await session.choose("goal:1");
    expect(w.truth.get(LOCATION, life.player)?.space).toBe(VILLAGE_SQUARE);
  }, 300_000);
});
