import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent, makeId } from "../../core/index.ts";
import { GOODS } from "../economy/index.ts";
import {
  effectiveness,
  hasTools,
  type KnownProcesses,
  knownIds,
  laborFactor,
  materialQuality,
  type ProcessKnowledge,
  storageFactor,
  TECH_PROCESSES,
  TechCatalog,
  unlockedProcesses,
  withKnowledge,
  yieldFactor,
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
const catalog = new TechCatalog(content.all(TECH_PROCESSES));

const pk = (process: string, fidelity: number, skill: number): ProcessKnowledge => ({
  process,
  fidelity,
  skill,
  source: makeId("event", 1),
  secret: false,
  learnedAt: 0,
});
const knows = (...ks: ProcessKnowledge[]): KnownProcesses =>
  ks.reduce((acc, k) => withKnowledge(acc, k), {} as KnownProcesses);

describe("ProcessKnowledge y sus efectos", () => {
  it("la eficacia crece con la fidelidad y la mano, y sin fidelidad es cero", () => {
    expect(effectiveness({ fidelity: 1, skill: 1 })).toBe(1);
    expect(effectiveness({ fidelity: 1, skill: 0 })).toBeCloseTo(0.4);
    expect(effectiveness({ fidelity: 0, skill: 1 })).toBe(0);
    expect(effectiveness({ fidelity: 0.8, skill: 0.5 })).toBeGreaterThan(
      effectiveness({ fidelity: 0.8, skill: 0.1 }),
    );
  });

  it("sin saber nada el rendimiento no cambia; con el arado mejora y pide menos trabajo", () => {
    expect(yieldFactor(catalog, undefined, "grain")).toBe(1);
    const plow = knows(pk("digging-stick", 1, 1), pk("wooden-plow", 1, 1));
    expect(yieldFactor(catalog, plow, "grain")).toBeCloseTo(1.15);
    expect(laborFactor(catalog, plow, "grain")).toBeCloseTo(0.6);
    expect(yieldFactor(catalog, plow, "wheat")).toBe(1);
  });

  it("el efecto es proporcional a quien lo sabe: novato rinde menos que maestro", () => {
    const novice = knows(pk("digging-stick", 1, 1), pk("wooden-plow", 0.6, 0.1));
    const master = knows(pk("digging-stick", 1, 1), pk("wooden-plow", 1, 0.9));
    const a = yieldFactor(catalog, novice, "grain");
    const b = yieldFactor(catalog, master, "grain");
    expect(a).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(a);
  });

  it("sin las herramientas del proceso no rinde; de oídas (poca fidelidad) tampoco cuenta", () => {
    expect(yieldFactor(catalog, knows(pk("wooden-plow", 1, 1)), "grain")).toBe(1);
    const hearsay = knows(pk("digging-stick", 0.2, 0.2), pk("wooden-plow", 1, 1));
    const def = catalog.get("wooden-plow");
    if (!def) throw new Error("sin arado");
    expect(hasTools(def, hearsay)).toBe(false);
    expect(yieldFactor(catalog, hearsay, "grain")).toBe(1);
  });

  it("los efectos de varios procesos se componen", () => {
    const all = knows(
      pk("digging-stick", 1, 1),
      pk("wooden-plow", 1, 1),
      pk("fallow-rotation", 1, 1),
      pk("field-manuring", 1, 1),
    );
    expect(yieldFactor(catalog, all, "grain")).toBeCloseTo(1.15 * 1.1 * 1.2);
  });

  it("conservar baja el pudrimiento, y salar a medias conserva a medias", () => {
    expect(storageFactor(catalog, undefined, "salt-pork")).toBe(1);
    const full = storageFactor(catalog, knows(pk("salting", 1, 1)), "salt-pork");
    const half = storageFactor(catalog, knows(pk("salting", 0.7, 0.2)), "salt-pork");
    expect(full).toBeCloseTo(0.25);
    expect(half).toBeGreaterThan(full);
    expect(half).toBeLessThan(1);
  });

  it("calidad de materiales y procesos desbloqueados", () => {
    const charcoal = knows(pk("charcoal-burning", 1, 1));
    expect(materialQuality(catalog, charcoal)["charcoal"]).toBeCloseTo(0.6);
    expect(materialQuality(catalog, undefined)).toEqual({});
    expect(unlockedProcesses(catalog, charcoal)).toEqual([]);
  });

  it("withKnowledge no muta y knownIds sale ordenado", () => {
    const a = knows(pk("spinning", 1, 1));
    const b = withKnowledge(a, pk("brewing", 1, 1));
    expect(knownIds(a)).toEqual(["spinning"]);
    expect(knownIds(b)).toEqual(["brewing", "spinning"]);
  });

  it("es determinista: el mismo saber da el mismo factor sin importar el orden de carga", () => {
    const ks = [
      pk("digging-stick", 0.9, 0.5),
      pk("wooden-plow", 0.8, 0.4),
      pk("fallow-rotation", 0.7, 0.3),
    ];
    const x = yieldFactor(catalog, knows(...ks), "grain");
    const y = yieldFactor(catalog, knows(...[...ks].reverse()), "grain");
    expect(x).toBe(y);
  });
});
