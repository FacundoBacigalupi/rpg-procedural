import { describe, expect, it } from "vitest";
import {
  addGoal,
  dropGoal,
  GAME_CONTENT_KINDS,
  GOAL_SKETCHES,
  goalSketches,
  goalTarget,
  sketchOf,
} from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import { lifeConfig } from "./config.ts";
import { openSession } from "./session.ts";

const base = { mode: "realista", save: "x", runtime: "ollama", think: false } as const;
const content = loadContentDir("content", GAME_CONTENT_KINDS);
const sketches = content.all(GOAL_SKETCHES);

describe("metas del personaje (novel-goals-set)", () => {
  it("puro: la frase elige el bosquejo por la primera palabra y la persona por su nombre", () => {
    expect(sketchOf("entrar a una secta", sketches)?.sketch.id).toBe("cultivate");
    expect(sketchOf("entrar a una secta para vengar a mi padre", sketches)?.sketch.id).toBe(
      "cultivate",
    );
    expect(sketchOf("vengar a mi padre", sketches)?.sketch.id).toBe("revenge");
    expect(sketchOf("ser herrero", sketches)?.sketch.id).toBe("craft");
    expect(sketchOf("hacerme rico", sketches)?.sketch.id).toBe("wealth");
    expect(sketchOf("tener mi propia casa", sketches)?.sketch.id).toBe("land");
    expect(sketchOf("casarme con alguien bueno", sketches)?.sketch.id).toBe("family");
    expect(sketchOf("conocer el mundo", sketches)?.sketch.id).toBe("leave");
    expect(sketchOf("algo que no está en la lista", sketches)).toBeUndefined();

    const known = [
      { ref: "agent:7", names: ["Lan", "mi padre"] },
      { ref: "item:1", names: ["padre"] },
    ];
    expect(goalTarget("a mi padre", known)).toBe("agent:7");
    expect(goalTarget("a Lán", known)).toBe("agent:7");
    expect(goalTarget("a nadie", known)).toBeUndefined();

    const one = addGoal([], "vengar a mi padre", sketches, known, 10);
    expect(one.goal).toEqual({
      id: 1,
      text: "vengar a mi padre",
      sketch: "revenge",
      target: "agent:7",
      setAt: 10,
      status: "active",
    });
    expect(addGoal(one.goals, "vengar a Lan", sketches, known, 11).same).toBe(true);
    const two = addGoal(one.goals, "entrar a una secta", sketches, known, 12).goals;
    expect(goalSketches(two)).toEqual(["revenge", "cultivate"]);
    expect(dropGoal(two, "9", sketches).dropped).toBeUndefined();
    const dropped = dropGoal(two, "la secta", sketches);
    expect(dropped.dropped?.id).toBe(2);
    expect(goalSketches(dropped.goals)).toEqual(["revenge"]);
    expect(dropGoal(dropped.goals, "1", sketches).dropped?.sketch).toBe("revenge");
  });

  it("el catálogo carga con sus valores (las referencias se validan al cargar)", () => {
    expect(sketches.length).toBeGreaterThanOrEqual(8);
  });

  it("seed 1: «quiero» guarda la meta, !metas la muestra, el montaje la piensa y se deja", async () => {
    const config = lifeConfig({ ...base, seed: "1" });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });

    expect((await session.say("!metas")).text).toMatch(/No te propusiste nada/);
    const set = await session.say("quiero entrar a una secta");
    expect(set.text).toMatch(/Te lo proponés: entrar a una secta/);
    expect(set.text).toMatch(/cultivar y entrar a una secta/);
    expect((await session.say("quiero entrar a una secta")).text).toMatch(/Ya te lo habías/);
    expect((await session.say("quiero vengar a mi madre")).text).toMatch(/vengarse: Langdang/);
    expect((await session.say("!metas")).text).toMatch(/1\. entrar a una secta[\s\S]*2\. vengar/);

    const skip = await session.say("trabajo el campo dos semanas");
    expect(skip.text).toMatch(/sectas|inmortales|te hicieron|debés una/);

    expect((await session.say("ya no quiero vengar a mi madre")).text).toMatch(/Lo dejás/);
    expect((await session.say("!abandonar 7")).text).toMatch(/No tenés esa meta/);
    expect((await session.say("!metas")).text).toMatch(/Lo que dejaste:\n {2}vengar/);
    // Un deseo de ahora se juega como acción, no queda como meta.
    expect((await session.say("quiero mirar alrededor")).text).not.toMatch(/Te lo proponés/);
    expect(store.getMeta("player_goals")).toEqual([
      expect.objectContaining({ id: 1, sketch: "cultivate", status: "active" }),
      expect.objectContaining({ id: 2, sketch: "revenge", status: "abandoned" }),
    ]);
  }, 300_000);
});
