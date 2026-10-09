import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { NoSuchBirth, PERSON, STATUS, STATUSES, temperamentFit } from "../../sim/index.ts";
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
  }, 600_000);

  it("la posición pedida es la del estatus de su hogar", () => {
    const game = novel({ family: { position: "common" }, entryAge });
    const { world } = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    const status = world.truth.get(STATUS, world.player)?.status;
    expect(content.all(STATUSES).find((d) => d.id === status)?.role).toBe("common");
  }, 600_000);

  it("es determinista", () => {
    const game = novel({ sex: who?.sex, entryAge });
    const a = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    const b = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    expect(a.world.player).toBe(b.world.player);
    expect(a.hash()).toEqual(b.hash());
  }, 600_000);

  it("si nadie cumple, lo rechaza con la razón en vez de inventar a alguien", () => {
    const game = novel({ entryAge: 90 });
    expect(() => Life.create(7, content, { frequency: 8, ...optionsOf({ game }) })).not.toThrow();
    const hard = novel({ sex: "female", entryAge: 90 });
    expect(() => Life.create(7, content, { frequency: 8, ...optionsOf({ game: hard }) })).toThrow(
      NoSuchBirth,
    );
  }, 600_000);
});

describe("modo novela: el temperamento pedido pesa en la búsqueda", () => {
  const free = Life.create(7, content, { frequency: 8 });
  const clock = free.world.clock;
  const now = free.terrain.population.now;
  const people = free.terrain.population.people;
  const who = people.find((p) => p.id === free.world.player);
  const ageOf = (born: number) => (now - born) / clock.year;
  const entryAge = Math.round(ageOf(who?.born ?? 0));
  const wish = {
    boldness: {
      min: (who?.innate["boldness"] ?? 0) - 0.02,
      max: (who?.innate["boldness"] ?? 0) + 0.02,
    },
  };

  it("el elegido puntúa al menos como el que salía solo (encaje / (1 + distancia de edad))", () => {
    const game = novel({ entryAge, temperament: wish });
    const life = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    const score = (id: string) => {
      const p = people.find((x) => x.id === id);
      const age = ageOf(p?.born ?? 0);
      const distance = Math.abs(age - entryAge);
      return temperamentFit(p?.innate ?? {}, wish) / (1 + distance);
    };
    expect(score(life.world.player)).toBeGreaterThanOrEqual(score(free.world.player));
  }, 600_000);

  it("es determinista y rechaza un eje que no es de temperamento", () => {
    const game = novel({ entryAge, temperament: wish });
    const a = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    const b = Life.create(7, content, { frequency: 8, ...optionsOf({ game }) });
    expect(a.hash()).toEqual(b.hash());
    const bad = novel({ entryAge, temperament: { nope: { min: 0, max: 1 } } });
    expect(() => Life.create(7, content, { frequency: 8, ...optionsOf({ game: bad }) })).toThrow(
      /temperamento pedido inválido/,
    );
  }, 600_000);
});
