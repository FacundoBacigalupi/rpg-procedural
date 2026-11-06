import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK } from "../core/index.ts";
import { GAME_CONTENT_KINDS } from "../game/index.ts";
import { LifeStore, loadContentDir, openSqlite } from "../persistence/index.ts";
import { lifeConfig } from "./config.ts";
import { CHAPTER_MARK, chapterHeading, chaptersIn } from "./render.ts";
import { openSession } from "./session.ts";

const base = { mode: "novela", save: "x", runtime: "ollama", think: false } as const;
const content = loadContentDir("content", GAME_CONTENT_KINDS);

describe("capítulos por salto (novel-narr-chapters)", () => {
  it("puro: número, estación del hemisferio y año; se cuentan por la marca", () => {
    const year = EARTHLIKE_CLOCK.year;
    const mid = Math.round(year * 0.6);
    const north = chapterHeading(3, 70 * year + mid, 0, 40);
    const south = chapterHeading(3, 70 * year + mid, 0, -40);
    expect(north).toMatch(/^Capítulo 3 · \p{L}+ del año 70$/u);
    expect(north).not.toBe(south);
    expect(
      chaptersIn([{ text: north }, { text: "Esperás." }, { text: `${CHAPTER_MARK}4 · x` }]),
    ).toBe(2);
  });

  it("seed 1: el salto largo abre capítulo y queda en la bitácora; el corto no", async () => {
    const config = lifeConfig({ ...base, seed: "1" });
    const store = LifeStore.open(openSqlite(":memory:"));
    const session = await openSession(store, { seed: config.seed, setup: config.setup, content });
    const first = await session.say("sigo con mi vida dos semanas");
    expect(first.text).toMatch(/^Capítulo 1 · \p{L}+ del año \d+\n\n/u);
    const short = await session.say("espero una hora");
    expect(short.text.startsWith(CHAPTER_MARK)).toBe(false);
    const second = await session.say("sigo con mi vida dos semanas");
    expect(second.text).toMatch(/^Capítulo 2 · /u);
    expect(chaptersIn(store.narrations())).toBe(2);
  }, 300_000);
});
