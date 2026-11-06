import { describe, expect, it } from "vitest";
import type { LifeSetup, Suggestion } from "../game/index.ts";
import {
  addGoal,
  dropGoal,
  GAME_CONTENT_KINDS,
  GOAL_HOUR_EVENT,
  GOAL_SKETCHES,
  goalHour,
  goalSketches,
  goalTarget,
  goalWatch,
  NPC_GOALS,
  parseSkip,
  sketchOf,
} from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import type { ActionPlan, Goal } from "../sim/index.ts";
import { replayLifeAt } from "../tools/inspector/at.ts";
import { type ReplayInput, replayInputFromStore } from "../tools/replay/index.ts";
import { lifeConfig } from "./config.ts";
import { suggestionPhrase } from "./hints.ts";
import { renderSuggestion } from "./render.ts";
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

  it("puro (novel-goals-watch): las metas ponen avisos y «hasta que pase algo» es un salto abierto", () => {
    expect(parseSkip("sigo con mi vida hasta que pase algo con mi meta")).toEqual({
      target: { kind: "open", goal: true },
    });
    expect(parseSkip("sigo con mi vida hasta que pase algo")).toEqual({
      target: { kind: "open", goal: false },
    });
    const known = [{ ref: "agent:7", names: ["mi padre"] }];
    const one = addGoal([], "vengar a mi padre", sketches, known, 0).goals;
    const two = addGoal(one, "entrar a una secta", sketches, known, 0).goals;
    expect(goalWatch(two, sketches)).toEqual([
      { on: { kind: "goal", goal: 1, who: "agent:7" }, action: "stop" },
      { on: { kind: "goal", goal: 2, events: ["cultivation."] }, action: "stop" },
    ]);
    const kin = addGoal([], "cuidar a mi padre", sketches, known, 0).goals;
    expect(goalWatch(kin, sketches).map((r) => r.action)).toEqual(["note"]);
    expect(goalWatch(kin, sketches, true).map((r) => r.action)).toEqual(["stop"]);
    expect(goalWatch(dropGoal(kin, "1", sketches).goals, sketches)).toEqual([]);
  });

  it("seed 1: la venganza corta el salto al ver a la persona", async () => {
    const config = lifeConfig({ ...base, seed: "1" });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    const life = session.life;
    expect((await session.say("sigo con mi vida hasta que pase algo con mi meta")).text).toMatch(
      /No tenés una meta/,
    );
    await session.say("quiero vengar a mi madre");
    const from = life.now;
    const reply = await session.say("sigo con mi vida hasta que pase algo con mi meta");
    expect((life.now - from) / life.world.clock.day).toBeLessThan(14);
    expect(reply.text).toMatch(/ves a Langdang \(lo que querés: vengar a mi madre\)/);
  }, 300_000);

  it("seed 1 (novel-goals-hooks): las metas proponen opciones y se juegan", async () => {
    const config = lifeConfig({ ...base, seed: "1" });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    expect(session.suggested(true).some((s) => s.kind === "goal")).toBe(false);
    const talk = session.suggested(true).find((s) => s.kind === "talk");
    await session.say("quiero hacerme rico");
    if (talk?.with !== undefined) await session.say(`quiero cuidar a mi ${talk.with}`);
    const all = session.suggested(true);
    const goals = all.filter((s) => s.kind === "goal");
    expect(talk?.with).toBeDefined();
    if (talk?.with !== undefined) {
      const kin = goals.find((s) => s.goal?.id === 2);
      expect(kin?.goal?.say).toMatch(/^ir a hablar con /);
      expect(renderSuggestion(kin as Suggestion)).toMatch(/\(por «cuidar a mi /);
      expect(suggestionPhrase(kin as Suggestion)).toMatch(/^hablo con /);
    }
    // Trabajar de más solo se ofrece de día, como trabajar: si es de noche, se espera la mañana.
    if (!all.some((s) => s.kind === "work")) {
      await session.say("duermo hasta que amanezca");
      await session.say("espero dos horas");
    }
    const day = session.suggested(true);
    expect(day.some((s) => s.kind === "work")).toBe(true);
    const rich = day.find((s) => s.goal?.id === 1);
    expect(rich && renderSuggestion(rich)).toBe("Trabajar de más (por «hacerme rico»)");
    const played = await session.choose("goal:1");
    // Se juega como cualquier opción: la factibilidad real la decide la sim (acá, dónde trabajar).
    expect(played.text).not.toMatch(/ya no está/);
    expect(played.text.length).toBeGreaterThan(0);
    await session.say("ya no quiero hacerme rico");
    expect(session.suggested(true).some((s) => s.goal?.id === 1)).toBe(false);
  }, 300_000);

  it("seed 1 (novel-goals-truth-act): la meta entra a la verdad con su acto y el replay la rehace", async () => {
    const config = lifeConfig({ ...base, seed: "1" });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    const life = session.life;
    const goalsOf = () => life.world.truth.get(NPC_GOALS, life.player)?.items ?? [];
    expect(goalsOf()).toEqual([]);
    await session.say("quiero vengar a mi madre");
    await session.say("me propongo hacerme rico");
    const [revenge, rich] = goalsOf();
    expect(revenge).toMatchObject({ layer: "long", kind: "avenge", weight: 0.5 });
    expect(revenge?.id).toMatch(/^resolve:revenge:agent:\d+$/);
    expect(rich).toMatchObject({ id: "resolve:wealth", kind: "pursue", value: "wealth" });
    const origin = life.world.log.get(revenge?.originEventId as never);
    expect(origin?.kind).toBe("action.resolve");
    // El panel también la tiene: «me propongo» es lo mismo que «quiero».
    expect((await session.say("!metas")).text).toMatch(/2\. hacerme rico/);

    const replayed = () =>
      replayLifeAt(
        content,
        replayInputFromStore(store).input as ReplayInput<LifeSetup, ActionPlan>,
        life.now + 1,
      ).world.truth.get(NPC_GOALS, life.player)?.items;
    expect(replayed()).toEqual(goalsOf());

    await session.say("ya no quiero vengar a mi madre");
    expect(goalsOf().map((g) => g.id)).toEqual(["resolve:wealth"]);
    expect(replayed()).toEqual(goalsOf());
  }, 300_000);

  it("puro (novel-goals-truth-delegate): madrugar por el trabajo, la tarde para la persona", () => {
    const g = (id: string, weight: number, target?: string): Goal =>
      ({
        id,
        layer: "long",
        kind: "pursue",
        weight,
        originEventId: "event:1",
        since: 0,
        ...(target ? { target } : {}),
      }) as unknown as Goal;
    const alive = (w: string) => w !== "agent:9";
    const ok = { ageYears: 30, workAge: 10, rested: true, able: true };
    const rich = g("resolve:wealth", 0.5);
    const land = g("resolve:land", 0.5);
    const avenge = g("resolve:revenge:agent:7", 0.5, "agent:7");
    const both = [land, rich, avenge];
    expect(goalHour(both, 12, ok, alive)).toBeUndefined();
    expect(goalHour(both, 5, ok, alive)).toBeUndefined();
    // Mismo peso: desempata el id (land < wealth), sin importar el orden.
    expect(goalHour(both, 6, ok, alive)).toEqual({ kind: "work", goal: land.id });
    expect(goalHour([rich, land], 7.5, ok, alive)).toEqual({ kind: "work", goal: land.id });
    expect(goalHour(both, 20, ok, alive)).toEqual({
      kind: "visit",
      goal: avenge.id,
      whom: "agent:7",
    });
    // Agotado no madruga; dolorido no sale; un chico no trabaja de más; un muerto no se visita.
    expect(goalHour(both, 6, { ...ok, rested: false }, alive)).toBeUndefined();
    expect(goalHour(both, 18, { ...ok, able: false }, alive)).toBeUndefined();
    expect(goalHour([rich], 6, { ...ok, ageYears: 8 }, alive)).toBeUndefined();
    expect(goalHour([g("resolve:revenge:agent:9", 0.5, "agent:9")], 18, ok, alive)).toBeUndefined();
    // Las metas que no son del jugador o no tienen forma de día no toman horas.
    expect(
      goalHour([g("resolve:cultivate", 0.5), g("core:wealth", 0.9)], 6, ok, alive),
    ).toBeUndefined();
  });

  it("seed 1 (novel-goals-truth-delegate): los días saltados trabajan de más por la meta", async () => {
    const config = lifeConfig({ ...base, seed: "1" });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    const life = session.life;
    await session.say("quiero hacerme rico");
    const from = life.now;
    await session.say("sigo con mi vida una semana");
    const hours = life.world.log
      .all()
      .filter((e) => e.kind === GOAL_HOUR_EVENT && e.tick > from && e.actors[0] === life.player);
    expect(hours.length).toBeGreaterThanOrEqual(6);
    expect(hours.every((e) => (e.data as { goal: string }).goal === "resolve:wealth")).toBe(true);
    // Esas horas son de campo: el personaje cosecha antes de que empiece la jornada de la aldea.
    const late = life.world.log
      .all()
      .filter(
        (e) =>
          e.kind === "routine.harvested" &&
          e.actors[0] === life.player &&
          hours.some((h) => h.tick === e.tick),
      );
    expect(late.length).toBeGreaterThan(0);
  }, 300_000);
});
