import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import { GOODS } from "../economy/index.ts";
import {
  feasibility,
  possibleHere,
  type Surroundings,
  TECH_PROCESSES,
  TechCatalog,
  TechProcessDef,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [GOODS, TECH_PROCESSES],
  [
    { kind: "goods", file: "g.json", data: json("content/goods/core.json") },
    { kind: "goods", file: "c.json", data: json("content/goods/catalog.json") },
    { kind: "techprocesses", file: "t.json", data: json("content/techprocesses/mortal.json") },
  ],
);
const defs = content.all(TECH_PROCESSES);
const catalog = new TechCatalog(defs);

const here = (over: Partial<Surroundings> = {}): Surroundings => ({
  resources: new Set(),
  energy: {},
  concepts: new Set(),
  tools: new Set(),
  workers: 1,
  laws: new Set(),
  ...over,
});

describe("catálogo de procesos mortales", () => {
  it("carga, cubre los dominios del primer catálogo y no tiene ciclos de herramientas", () => {
    expect(defs.length).toBeGreaterThanOrEqual(15);
    const domains = new Set(defs.map((d) => d.domain));
    for (const d of [
      "agriculture",
      "food",
      "metallurgy",
      "ceramics_glass",
      "textiles",
      "writing",
    ]) {
      expect(domains.has(d as never)).toBe(true);
    }
    expect(catalog.toolChain("iron-plowshare")).toEqual([
      "bloomery-iron",
      "charcoal-burning",
      "clay-firing",
      "digging-stick",
      "iron-forging",
      "wooden-plow",
    ]);
  });

  it("rechaza herramientas inexistentes y ciclos", () => {
    const mk = (id: string, tools: string[]) =>
      TechProcessDef.parse({
        id,
        name: id,
        domain: "custom",
        requires: { tools },
        tacitness: 0.5,
        learnHours: 10,
      });
    expect(() => new TechCatalog([mk("a", ["nada"])])).toThrow(/no existe/);
    expect(() => new TechCatalog([mk("a", ["b"]), mk("b", ["a"])])).toThrow(/ciclo/);
  });

  it("el esquema rechaza temperatura fuera del fuego y claves de más", () => {
    const base = { id: "x", name: "x", domain: "custom", tacitness: 0.5, learnHours: 1 };
    expect(
      TechProcessDef.safeParse({ ...base, requires: { energy: { kind: "water", temperature: 5 } } })
        .success,
    ).toBe(false);
    expect(TechProcessDef.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe("factibilidad física", () => {
  const bronze = catalog.get("bronze-alloying");
  if (!bronze) throw new Error("sin bronce");

  it("sin estaño no hay bronce, aunque sobre todo lo demás", () => {
    const f = feasibility(
      bronze,
      here({
        energy: { fire: 1200 },
        concepts: new Set(["alloying"]),
        tools: new Set(["copper-smelting"]),
      }),
    );
    expect(f.possible).toBe(false);
    expect(f.missing).toEqual([{ kind: "resource", id: "tin-ore" }]);
  });

  it("con todo lo que pide es posible; el horno frío es lo que falta", () => {
    const base = here({
      resources: new Set(["tin-ore"]),
      concepts: new Set(["alloying"]),
      tools: new Set(["copper-smelting"]),
    });
    expect(feasibility(bronze, { ...base, energy: { fire: 1000 } }).possible).toBe(true);
    const cold = feasibility(bronze, { ...base, energy: { fire: 700 } });
    expect(cold.missing).toEqual([{ kind: "energy", energy: "fire", have: 700, need: 950 }]);
  });

  it("la escala y la ley del mundo cuentan; la ley que falta tapa todo lo demás", () => {
    const iron = catalog.get("bloomery-iron");
    if (!iron) throw new Error("sin hierro");
    expect(feasibility(iron, here()).missing.some((m) => m.kind === "scale")).toBe(true);
    const gated = TechProcessDef.parse({
      id: "gunpowder",
      name: "pólvora",
      domain: "chemistry",
      requires: { resources: ["saltpeter"] },
      tacitness: 0.6,
      learnHours: 100,
      worldLaw: ["volatile-saltpeter"],
    });
    expect(feasibility(gated, here()).missing).toEqual([{ kind: "law", id: "volatile-saltpeter" }]);
    const ok = feasibility(
      gated,
      here({ resources: new Set(["saltpeter"]), laws: new Set(["volatile-saltpeter"]) }),
    );
    expect(ok.possible).toBe(true);
  });

  it("una cultura sin estaño no hace bronce y con estaño sí (geografía)", () => {
    const wit = {
      concepts: new Set(["alloying", "forced-draft"]),
      energy: { fire: 1300 } as const,
      tools: new Set(["copper-smelting"]),
    };
    const noTin = possibleHere(
      defs,
      here({ ...wit, resources: new Set(["copper-ore", "charcoal"]) }),
    );
    expect(noTin.some((d) => d.id === "bronze-alloying")).toBe(false);
    const withTin = possibleHere(
      defs,
      here({ ...wit, resources: new Set(["copper-ore", "charcoal", "tin-ore"]) }),
    );
    expect(withTin.some((d) => d.id === "bronze-alloying")).toBe(true);
  });

  it("es determinista: dos llamadas dan lo mismo", () => {
    const h = here({ resources: new Set(["timber", "salt"]), workers: 5 });
    expect(possibleHere(defs, h)).toEqual(possibleHere(defs, h));
  });
});
