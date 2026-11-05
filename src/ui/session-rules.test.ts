import { describe, expect, it } from "vitest";
import type { AgentId } from "../core/index.ts";
import { DELEGATION_STOPPING_ACTS, GAME_CONTENT_KINDS, type Interrupt } from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import { lifeConfig } from "./config.ts";
import { renderNotes } from "./render.ts";
import { openSession } from "./session.ts";

const base = { mode: "realista", save: "x", runtime: "ollama", think: false } as const;

describe("reglas de los saltos (novel-montage-rules)", () => {
  it("puro: la delegación decide qué palabras cortan y las notas se agrupan por día", () => {
    expect(DELEGATION_STOPPING_ACTS.minimal).toBeNull();
    expect(DELEGATION_STOPPING_ACTS.normal?.has("request")).toBe(true);
    expect(DELEGATION_STOPPING_ACTS.wide?.has("request")).toBe(false);
    expect(DELEGATION_STOPPING_ACTS.wide?.has("promise")).toBe(true);
    const who = "agent:2" as AgentId;
    const seen = (tick: number): Interrupt => ({
      kind: "watched",
      tick,
      rule: { kind: "person", who },
    });
    const born: Interrupt = {
      kind: "watched",
      tick: 5,
      rule: { kind: "event", event: "family.birth" },
    };
    const talk: Interrupt = { kind: "spoken_to", tick: 6, who };
    const text = renderNotes([seen(1), seen(2), born, talk], () => "Lan");
    expect(text).toBe("Anotado: viste a Lan (en 2 días distintos).\nAnotado: nació una criatura.");
    expect(renderNotes([talk], () => "Lan")).toBe("");
  });

  it("seed 1: mínima corta cuando le hablan, normal sigue y anota a quien se pidió", async () => {
    const content = loadContentDir("content", GAME_CONTENT_KINDS);
    const config = lifeConfig({ ...base, seed: "1" });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    const life = session.life;
    const days = async (line: string) => {
      const from = life.now;
      const reply = await session.say(line);
      return { reply, days: (life.now - from) / life.world.clock.day };
    };

    expect((await session.say("!delegar mínima")).text).toMatch(/mínima/);
    expect((await session.say("!avisar a Nadie Inventado")).text).toMatch(/No sabés de quién/);
    expect((await session.say("!anotar a mi madre")).text).toMatch(/anotar: Langdang/);
    expect((await session.say("!avisar nacimientos")).text).toMatch(/avisar: nació/);
    expect((await session.say("!no avisar nacimientos")).text).not.toMatch(/nació/);

    const short = await days("trabajo el campo dos semanas");
    expect(short.days).toBeLessThan(14);
    expect(short.reply.text).toMatch(/te hablan/);
    expect(short.reply.text).toMatch(/Anotado: viste a Langdang/);
    // Un salto delegado cortado antes de la semana igual se cuenta como montaje.
    expect(short.reply.text).not.toMatch(/inquieto/);

    await session.say("!delegar normal");
    const long = await days("trabajo el campo dos semanas");
    expect(long.days).toBeGreaterThanOrEqual(14);
    expect(long.reply.text).toMatch(/Anotado: viste a Langdang \(en \d+ días distintos\)/);
    expect(store.getMeta("routine_rules")).toEqual({
      delegation: "normal",
      watch: [{ on: { kind: "person", who: expect.any(String) }, action: "note" }],
    });
  }, 300_000);
});
