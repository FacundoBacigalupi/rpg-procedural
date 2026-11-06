import { describe, expect, it } from "vitest";
import {
  GAME_CONTENT_KINDS,
  GOAL_HOUR_EVENT,
  goalHour,
  ROUTINE_BREAK_EVENT,
  ROUTINE_MEDITATE_EVENT,
} from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import {
  CULTIVATION_STATE,
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

describe("la delegación de cultivar medita (novel-cult-delegate)", () => {
  const g = (id: string): Goal =>
    ({
      id,
      layer: "long",
      kind: "pursue",
      weight: 0.5,
      originEventId: "event:1",
      since: 0,
    }) as unknown as Goal;
  const ok = { ageYears: 12, workAge: 10, rested: true, able: true, canMeditate: true };
  const alive = () => true;

  it("puro: a la noche la meta de cultivar medita, y lleno rompe en la primera hora", () => {
    const cult = g("resolve:cultivate");
    const rich = g("resolve:wealth");
    expect(goalHour([cult], 20, ok, alive)).toEqual({ kind: "meditate", goal: cult.id });
    expect(goalHour([cult], 19, { ...ok, qiFull: true }, alive)).toEqual({
      kind: "break",
      goal: cult.id,
    });
    expect(goalHour([cult], 20, { ...ok, qiFull: true }, alive)).toEqual({
      kind: "meditate",
      goal: cult.id,
    });
    expect(goalHour([cult], 20, { ...ok, canMeditate: false }, alive)).toBeUndefined();
    expect(goalHour([cult], 20, { ...ok, able: false }, alive)).toBeUndefined();
    expect(goalHour([rich], 20, ok, alive)).toBeUndefined();
    expect(goalHour([cult], 23, ok, alive)).toBeUndefined();
  });

  it("seed 1: dejar pasar días con la meta de cultivar suma horas de meditación", async () => {
    const config = lifeConfig({ ...base, seed: "1", cultivation: true });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    const life = session.life;
    const w = life.world;
    await session.say("quiero entrar a una secta");
    // La secta lejos en el año, así el salto no se corta por el aviso.
    const org = w.truth.ids(SECT)[0];
    const sect = org ? w.truth.get(SECT, org) : undefined;
    if (!org || !sect) throw new Error("sin secta");
    const offset = Math.round((w.map.lonDeg / 360) * w.clock.day);
    const yearDays = Math.round(w.clock.year / w.clock.day);
    const today = Math.floor((life.now + offset) / w.clock.day) % yearDays;
    w.truth.set(SECT, org, { ...sect, visitDay: (today + 120) % yearDays });
    const before = w.truth.get(CULTIVATION_STATE, life.player)?.hours ?? 0;
    const from = life.now;
    await session.say("sigo con mi vida tres días");
    const sat = w.log.all().filter((e) => e.tick >= from && e.kind === ROUTINE_MEDITATE_EVENT);
    expect(sat.length).toBeGreaterThan(0);
    expect(sat.every((e) => e.actors[0] === life.player)).toBe(true);
    const after = w.truth.get(CULTIVATION_STATE, life.player);
    expect(after?.hours ?? 0).toBeGreaterThan(before);
    expect(after?.sensitivity ?? 0).toBeGreaterThanOrEqual(0);
    const breaks = w.log.all().filter((e) => e.tick >= from && e.kind === ROUTINE_BREAK_EVENT);
    expect(breaks.length).toBe(0);
  }, 300_000);
});
