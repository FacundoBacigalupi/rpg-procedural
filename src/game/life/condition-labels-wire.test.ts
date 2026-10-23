import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, loadContent } from "../../core/index.ts";
import {
  emptyMental,
  MENTAL,
  type MentalLabelDef,
  openCondition,
  settleConditions,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";
import { labeledSupportFor, mindTheoryOf } from "./support.ts";

const DAY = 86400;

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

// Hash de develop: apagado no debe moverlo.
const BASE_HASH = "b218098c25ac14a61ca65cbd61b1324438ae2a400978faa2e6bfd7efa9b29f26";

const defs: MentalLabelDef[] = [
  {
    id: "t.grief",
    theory: "t",
    kind: "grief",
    name: "pena",
    treatment: "family_care",
    stigma: 0,
    help: 0.4,
  },
  {
    id: "t.depression",
    theory: "t",
    kind: "depression",
    name: "x",
    treatment: "confinement",
    stigma: 0.5,
    help: -0.6,
  },
] as never;

describe("condiciones con etiqueta cultural (cableado)", () => {
  const content = loadContent(GAME_CONTENT_KINDS, sources("content"));

  it("apagado deja el hash de develop", () => {
    expect(Life.create(3, content, {}).hash().total).toBe(BASE_HASH);
    expect(Life.create(3, content, { conditionLabels: false }).hash().total).toBe(BASE_HASH);
  }, 120_000);

  it("el trato que ayuda acelera la cura y el que daña la estira", () => {
    const l = Life.create(3, content, {});
    const who = "nadie" as AgentId;
    // Sin teoría en la cultura de la persona: cae a `plain`, que no está en estas definiciones.
    expect(mindTheoryOf(l.world.truth, who)).toBeUndefined();
    const t = labeledSupportFor(l.world.truth, who, defs, () => 0);
    expect(t.support("grief")).toBe(0);
    expect(labeledSupportFor(l.world.truth, who, [], () => 0.2).support("grief")).toBe(0.2);
    const withPlain = [
      { ...defs[0], theory: "plain" },
      { ...defs[1], theory: "plain" },
    ] as MentalLabelDef[];
    const p = labeledSupportFor(l.world.truth, who, withPlain, () => 0.1);
    expect(p.support("grief")).toBeCloseTo(0.5, 6);
    expect(p.stretch("depression")).toBeCloseTo(1.3, 6);
  });

  it("settleConditions: stretch alarga la cura; sin stretch es igual que antes", () => {
    const m0 = emptyMental("e1" as never, 0);
    const m = openCondition(m0, "depression", 0.8, "e1" as never, {}, 0);
    const base = settleConditions(m, 40 * DAY, DAY, 0);
    expect(settleConditions(m, 40 * DAY, DAY, 0, undefined)).toEqual(base);
    const slow = settleConditions(m, 40 * DAY, DAY, 0, () => 1.5);
    expect(slow.conditions[0]?.severity).toBeGreaterThan(base.conditions[0]?.severity ?? 1);
  });

  it("encendido es determinista y todo duelo cita eventos reales", () => {
    const run = () => {
      const l = Life.create(3, content, { conditionLabels: true });
      l.advanceTo(l.now + DAY * 120);
      return l;
    };
    const a = run();
    const b = run();
    expect(a.hash().total).toBe(b.hash().total);
    const ids = new Set(a.world.log.all().map((e) => e.id));
    for (const id of a.world.truth.ids(MENTAL)) {
      const s = a.world.truth.get(MENTAL, id);
      for (const c of s?.conditions ?? [])
        for (const ev of c.originEventIds) expect(ids.has(ev)).toBe(true);
    }
  }, 600_000);
});
