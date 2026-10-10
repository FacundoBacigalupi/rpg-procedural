import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { GAME_CONTENT_KINDS, Life } from "../../game/index.ts";
import { replayLifeAt } from "./at.ts";
import { inspect } from "./inspector.ts";

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

describe("inspector", () => {
  const life = Life.create(7, content);
  const before = life.hash();

  it("no cambia el estado con ningún comando", () => {
    const first = life.world.log.all()[0]?.id ?? "event:1";
    const last = life.world.log.all().at(-1)?.id ?? "event:1";
    for (const cmd of [
      "tables",
      `entity ${life.player}`,
      `find ${life.player}`,
      `origin ${life.player}`,
      `why ${last}`,
      `effects ${first}`,
      "timeline 5",
      "body",
      "view",
      "invariants",
      "hash",
      "pressures",
      "hazard",
      "memories",
      "wrong",
      `wrong ${life.player}`,
      "percepts",
      "rumor x",
      "mind",
      "nada",
    ]) {
      expect(inspect(life, cmd).length).toBeGreaterThan(0);
    }
    expect(life.hash()).toEqual(before);
  }, 120_000);

  it("la entidad del personaje muestra sus componentes y su origen", () => {
    expect(inspect(life, `entity ${life.player}`)).toContain("# body.state");
    expect(inspect(life, `origin ${life.player}`)).toContain("nace en");
    expect(inspect(life, "entity agent:99999")).toContain("No hay");
  });

  it("muestra el hambre de los hogares con su fuente y la descarga que la alivia", () => {
    const all = inspect(life, "pressures hunger");
    expect(all).toMatch(/^hunger@household:\d+ \d\.\d\d/);
    const id = all.split(" ")[0]?.split("@")[1] ?? "";
    const one = inspect(life, `pressure hunger ${id}`);
    expect(one).toContain(`${id}.larder`);
    expect(one).toContain("life.borrow");
    expect(inspect(life, "pressure hunger household:99999")).toContain("No hay");
    expect(life.hash()).toEqual(before);
  });

  it("memories, wrong y percepts responden con la verdad y no tocan nada", () => {
    expect(inspect(life, "memories agent:99999")).toContain("No hay");
    expect(inspect(life, "wrong agent:99999")).toContain("No hay");
    expect(inspect(life, "percepts agent:99999")).toContain("No hay");
    expect(inspect(life, "memories")).toMatch(/memorias|no guarda/);
    expect(inspect(life, "wrong")).toMatch(/falsas|Nadie/);
    expect(inspect(life, "percepts").length).toBeGreaterThan(0);
    expect(life.hash()).toEqual(before);
  });

  it("at y diff rehacen un tick pasado sin tocar la vida", () => {
    const now = Life.create(7, content);
    const t0 = now.now;
    now.advanceTo(t0 + 2880);
    const h = now.hash();
    const input = {
      seed: 7,
      versions: { engine: "t", content: "t", format: 1 },
      setup: { game: {} },
      plans: [],
    };
    const past = (t: number) => replayLifeAt(content, input as never, t);
    expect(past(t0 + 1440).now).toBe(t0 + 1440);
    expect(inspect(now, `at ${t0 + 1440} hash`, past)).toContain(`[t${t0 + 1440}]`);
    expect(inspect(now, `at ${t0 + 5000} hash`, past)).toContain("entre 0 y");
    expect(inspect(now, "at 5 hash", past)).toContain("empieza en");
    expect(inspect(now, `diff ${t0} ${t0 + 2880}`, past)).toMatch(/^diff t\d+ → t\d+/);
    expect(inspect(now, "diff 100 100", past)).toContain("nada cambió");
    expect(now.hash()).toEqual(h);
  }, 120_000);

  it("dice cuándo llegan los comandos de sistemas que faltan", () => {
    expect(inspect(life, "rumor event:999999")).toContain("No hay un evento");
    expect(inspect(life, "rumor")).toBe("rumor <evento>");
    expect(inspect(life, "mind agent:1")).toContain("Fase 2");
    expect(inspect(life, "invariants")).toBe("Sin violaciones.");
  });
});
