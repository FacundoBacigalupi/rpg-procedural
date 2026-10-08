import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { NoSuchBirth, PERSON, STATUS, STATUSES } from "../../sim/index.ts";
import { defaultGameSetup, parseGameSetup } from "../setup/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life, optionsOf } from "./life.ts";

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

function novel(character: object) {
  const base = defaultGameSetup("novel");
  return parseGameSetup({ ...base, novel: { ...base.novel, character } });
}

describe("modo novela: buscar un nacimiento real", () => {
  // Alguien que seguro existe en la aldea del seed: el que sale solo en el modo realista.
  const free = Life.create(7, content, { frequency: 8 });
  const who = free.world.truth.get(PERSON, free.world.player);
  const entryAge = Math.round(
    (free.terrain.population.now - (who?.born ?? 0)) / free.world.clock.year,
  );

  it("el personaje es del sexo y la edad pedidos, de los que ya vivían en la aldea", () => {
    const game = novel({ sex: who?.sex, entryAge });
    const life = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    const { world, terrain } = life;
    const me = world.truth.get(PERSON, world.player);
    expect(me?.sex).toBe(who?.sex);
    const age = (terrain.population.now - (me?.born ?? 0)) / world.clock.year;
    expect(Math.abs(age - entryAge)).toBeLessThanOrEqual(3);
    expect(terrain.population.people.some((p) => p.id === world.player)).toBe(true);
  }, 120_000);

  it("la posición pedida es la del estatus de su hogar", () => {
    const game = novel({ family: { position: "common" }, entryAge });
    const { world } = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    const status = world.truth.get(STATUS, world.player)?.status;
    expect(content.all(STATUSES).find((d) => d.id === status)?.role).toBe("common");
  }, 120_000);

  it("es determinista", () => {
    const game = novel({ sex: who?.sex, entryAge });
    const a = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    const b = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    expect(a.world.player).toBe(b.world.player);
    expect(a.hash()).toEqual(b.hash());
  }, 120_000);

  it("si nadie cumple, lo rechaza con la razón en vez de inventar a alguien", () => {
    const game = novel({ entryAge: 90 });
    expect(() => Life.create(7, content, { frequency: 8, ...optionsOf({ game }) })).not.toThrow();
    const hard = novel({ sex: "female", entryAge: 90 });
    expect(() => Life.create(7, content, { frequency: 8, ...optionsOf({ game: hard }) })).toThrow(
      NoSuchBirth,
    );
  }, 120_000);
});
