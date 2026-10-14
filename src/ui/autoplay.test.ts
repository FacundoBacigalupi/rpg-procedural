import { describe, expect, it } from "vitest";
import { Rng } from "../core/index.ts";
import { GAME_CONTENT_KINDS } from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import { choosePolicy, runAutoplay } from "./autoplay.ts";
import { lifeConfig } from "./config.ts";
import { openSession } from "./session.ts";

const base = { mode: "realista", save: "x", runtime: "ollama", think: false } as const;

describe("política del jugador automático", () => {
  const rng = (n: number) => Rng.root(7).fork("autoplay").fork("turn", n);

  it("atiende lo que el cuerpo pide antes que cualquier actividad", () => {
    const move = choosePolicy(rng(0), {
      stalled: 0,
      suggestions: [
        { id: "look", kind: "look", salience: 0.3 },
        { id: "drink", kind: "drink", salience: 0.8 },
        { id: "eat", kind: "eat", salience: 0.7 },
      ],
    });
    expect(move).toEqual({ choose: "drink" });
  });

  it("sin necesidades sortea una línea, igual con el mismo seed", () => {
    const view = { stalled: 0, suggestions: [] };
    const a = Array.from({ length: 20 }, (_, i) => choosePolicy(rng(i), view));
    const b = Array.from({ length: 20 }, (_, i) => choosePolicy(rng(i), view));
    expect(a).toEqual(b);
    expect(a.every((m) => "say" in m)).toBe(true);
    expect(new Set(a.map((m) => ("say" in m ? m.say : ""))).size).toBeGreaterThan(3);
  });

  it("si se estanca, espera una hora para dejar pasar el tiempo", () => {
    expect(
      choosePolicy(rng(0), {
        stalled: 8,
        suggestions: [{ id: "sleep", kind: "sleep", salience: 0.9 }],
      }),
    ).toEqual({ say: "espero una hora" });
  });
});

describe("partida automática sobre la sesión del juego", () => {
  it("juega cinco días con el personaje activo, sin problemas y de forma determinista", async () => {
    const content = loadContentDir("content", GAME_CONTENT_KINDS);
    const play = async () => {
      const config = lifeConfig({ ...base, seed: "1" });
      const session = await openSession(LifeStore.open(openSqlite(":memory:")), {
        seed: config.seed,
        setup: config.setup,
        content,
      });
      const report = await runAutoplay(session, { seed: 1, years: 5 / 365, checkEveryDays: 2 });
      return { report, hash: session.life.hash() };
    };
    const a = await play();
    expect(a.report.failure).toBeUndefined();
    expect(a.report.problems).toEqual([]);
    expect(a.report.turns).toBeGreaterThan(5);
    expect(a.report.routineOnPlayer).toBe(0);
    expect(a.report.playerAlive).toBe(true);
    const b = await play();
    expect(b.hash).toStrictEqual(a.hash);
    expect(b.report.turns).toBe(a.report.turns);
  }, 300_000);
});
