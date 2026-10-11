import { describe, expect, it } from "vitest";
import type { EventId } from "../../core/index.ts";
import type { MoldRumor } from "../../sim/index.ts";
import {
  believedHoldings,
  type TakeBelievedOptions,
  takeCandidates,
  theftNormPenalty,
} from "./takeillicit.ts";

const o: TakeBelievedOptions = { minConfidence: 0.3, perDeed: 0.2, maxPenalty: 0.5 };
const has = (about: string, value: string): MoldRumor => ({
  mold: "attr",
  about,
  attr: "has",
  value,
});
const known = new Set(["agent:2", "agent:3"]);

describe("hurto desde lo que se cree", () => {
  it("solo bienes que se cree que tiene un conocido, con la mejor confianza y sin sí mismo", () => {
    const held = believedHoldings(
      [
        { rumor: has("agent:2", "pan"), confidence: 0.5 },
        { rumor: has("agent:2", "pan"), confidence: 0.9 },
        { rumor: has("agent:3", "sal"), confidence: 0.1 },
        { rumor: has("agent:9", "oro"), confidence: 1 },
        { rumor: has("agent:1", "tela"), confidence: 1 },
        { rumor: { mold: "attr", about: "agent:2", attr: "sick", value: true }, confidence: 1 },
      ],
      known,
      "agent:1",
      o,
    );
    expect(held).toEqual([{ holder: "agent:2", good: "pan", confidence: 0.9 }]);
  });

  it("la candidata nombra dueño y bien, es un delito y su chance baja con la confianza", () => {
    const [c] = takeCandidates([{ holder: "agent:2", good: "pan", confidence: 0.5 }], o);
    expect(c).toMatchObject({
      id: "take:agent:2+pan",
      verb: "take",
      target: "agent:2",
      contributes: { wealth: 0.5 },
      chance: 0.3,
      loss: 0.5,
      risk: 0.5,
    });
  });

  it("la sanción legal sale de los robos conocidos y tiene techo", () => {
    const deed = (n: number, kind: "theft" | "assault") => ({
      kind,
      by: null,
      victim: "agent:2" as never,
      event: `event:${n}` as EventId,
      at: n,
      via: "told" as const,
    });
    expect(theftNormPenalty(undefined, o)).toBe(0);
    expect(theftNormPenalty({ deeds: [deed(1, "assault")] }, o)).toBe(0);
    expect(theftNormPenalty({ deeds: [deed(1, "theft")] }, o)).toBe(0.2);
    expect(theftNormPenalty({ deeds: [1, 2, 3, 4].map((n) => deed(n, "theft")) }, o)).toBe(0.5);
  });
});
