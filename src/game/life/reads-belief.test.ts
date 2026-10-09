import { describe, expect, it } from "vitest";
import type { AgentId, Tick } from "../../core/index.ts";
import { beliefConfidenceAt, believed, type ReadPurpose } from "../../sim/index.ts";
import { learnReads } from "./reading.ts";

const ACTOR = "agent:2" as AgentId;
const read = (tick: number, over: Partial<ReadPurpose> = {}): ReadPurpose => ({
  reader: "agent:1" as AgentId,
  actor: ACTOR,
  tick: tick as Tick,
  guessed: "gift" as ReadPurpose["guessed"],
  confidence: 0.6,
  basis: "inferred",
  mistaken: true,
  ...over,
});

describe("la lectura del porqué como creencia", () => {
  it("guarda «X se propone M» con la confianza de la lectura y fuente de razonamiento", () => {
    const b = believed(learnReads(undefined, [read(100)], 200 as Tick), ACTOR, "purpose");
    expect(b?.value).toBe("gift");
    expect(b?.sources[0]?.kind).toBe("reasoning");
    expect(beliefConfidenceAt(b as NonNullable<typeof b>, 200 as Tick)).toBeCloseTo(0.6, 1);
  });

  it("la misma lectura vista dos veces no suma confianza", () => {
    const once = learnReads(undefined, [read(100)], 200 as Tick);
    const twice = learnReads(once, [read(100)], 300 as Tick);
    expect(twice).toBe(once);
  });

  it("no guarda la verdad: lo errado se guarda como se leyó", () => {
    const b = believed(
      learnReads(undefined, [read(100, { mistaken: true })], 100 as Tick),
      ACTOR,
      "purpose",
    );
    expect(JSON.stringify(b)).not.toContain("mistaken");
  });

  it("ignora lecturas viejas o del futuro", () => {
    expect(learnReads(undefined, [read(0)], (10 * 3600) as Tick)).toBeUndefined();
    expect(learnReads(undefined, [read(500)], 100 as Tick)).toBeUndefined();
  });
});
