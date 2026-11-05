import { describe, expect, it } from "vitest";
import { GAME_CONTENT_KINDS } from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import { lifeConfig } from "./config.ts";
import { openSession } from "./session.ts";

const base = { mode: "realista", save: "x", runtime: "ollama", think: false } as const;

describe("saltar tiempo desde la sesión (novel-montage-parse)", () => {
  it("«trabajo el campo dos semanas» vive la rutina del hogar dos semanas y queda guardado como plan", async () => {
    const content = loadContentDir("content", GAME_CONTENT_KINDS);
    const config = lifeConfig({ ...base, seed: "1" });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    const life = session.life;
    const from = life.now;
    const reply = await session.say("trabajo el campo dos semanas");
    expect(reply.turn).toBe(true);
    const days = (life.now - from) / life.world.clock.day;
    const worked = life.world.log
      .all()
      .filter(
        (e) => e.kind === "routine.harvested" && e.tick > from && e.actors.includes(life.player),
      );
    // Seed 1: le hablan sin pedirle nada (queda anotado) y el salto sigue hasta el final.
    expect(days).toBeGreaterThanOrEqual(14);
    expect(worked.length).toBeGreaterThan(0);
    expect(reply.text).toContain("Pasan 14 días");
    const last = store.plans().at(-1)?.plan as { source?: string } | undefined;
    expect(last?.source).toBe("routine");
  }, 300_000);
});
