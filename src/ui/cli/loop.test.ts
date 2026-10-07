import { afterEach, describe, expect, it } from "vitest";
import { STUB_ENGINE, type StubPlan, type StubSetup, stubReplayGame } from "../../game/index.ts";
import { LifeStore, openSqlite, type SqlDriver } from "../../persistence/index.ts";
import { checkInvariants, hashState } from "../../sim/index.ts";
import { type ReplayInput, replay, replayInputFromStore } from "../../tools/index.ts";
import { runCli, VERSIONS } from "./loop.ts";
import { elapsed } from "./render.ts";

async function* feed(lines: readonly string[]) {
  for (const l of lines) yield l;
}

const opened: SqlDriver[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

function memory(): LifeStore {
  const db = openSqlite(":memory:");
  opened.push(db);
  return LifeStore.open(db);
}

async function session(store: LifeStore, lines: readonly string[], seed = 5): Promise<string> {
  let out = "";
  await runCli(feed(lines), (t) => (out += t), store, { seed, setup: { villagers: 4 } });
  return out;
}

const SCRIPT = [
  "mirar",
  "esperar 3 días",
  "construir una choza",
  "volar",
  "ayuda",
  "",
  "regalar 1 moneda a aldeano 2",
  "dormir",
];

describe("runCli", () => {
  it("juega, guarda cada turno y el replay llega al mismo estado", async () => {
    const store = memory();
    const out = await session(store, [...SCRIPT, "salir", "esperar"]);
    expect(out).toMatch(/^Empieza una vida\.\nEstás en la aldea\./);
    expect(out).toContain("Ves a: aldeano 2, aldeano 3, aldeano 4, aldeano 5.");
    expect(out).toContain("Eso todavía no se entiende.");
    expect(out).toContain("Fuera del personaje: ayuda, salir.");
    expect(out).toMatch(/La vida queda guardada\.\n$/);

    // Lo que no es un plan no se guarda; lo de después de salir no se lee.
    expect(store.plans().map((p) => p.plan)).toEqual([
      { verb: "look" },
      { verb: "wait", seconds: 3 * 86400 },
      { verb: "build" },
      { amount: 1, to: "agent:2", verb: "give" },
      { verb: "wait", seconds: 8 * 3600 },
    ]);
    expect(checkInvariants(store.load())).toEqual([]);

    const { input, checkpoints } = replayInputFromStore(store);
    expect(checkpoints).toHaveLength(5);
    const end = store.load().scheduler.now;
    const report = replay(input as ReplayInput<StubSetup, StubPlan>, stubReplayGame(VERSIONS), {
      checkpoints,
      until: end,
    });
    expect(report.divergence).toBeUndefined();
    expect(report.checked).toBe(5);
    expect(report.hash).toEqual(hashState(store.load()));
  });

  it("al volver sigue la misma vida, y da lo mismo que jugar de un tirón", async () => {
    const split = memory();
    await session(split, [...SCRIPT.slice(0, 3), "salir"]);
    const back = await session(split, SCRIPT.slice(3), 999);
    expect(back).toMatch(/^Seguís donde quedaste\./);

    const straight = memory();
    await session(straight, SCRIPT);
    expect(split.load().scheduler).toEqual(straight.load().scheduler);
    expect(split.plans()).toEqual(straight.plans());
    expect(split.checkpoints()).toEqual(straight.checkpoints());
  });

  it("no sigue una vida de otra versión", async () => {
    const store = memory();
    await session(store, ["salir"]);
    store.setMeta("versions", { ...VERSIONS, engine: `${STUB_ENGINE}-viejo` });
    await expect(session(store, [])).rejects.toThrow(/otra versión/);
  });
});

describe("elapsed", () => {
  it.each([
    [60, "Pasa un minuto."],
    [3600, "Pasa una hora."],
    [7200 + 60, "Pasan 2 horas y un minuto."],
    [86400 * 3 + 3600, "Pasan 3 días y una hora."],
    [30, "no pasa nada de tiempo"],
  ])("%i segundos: %s", (s, text) => {
    expect(elapsed(s)).toBe(text);
  });
});
