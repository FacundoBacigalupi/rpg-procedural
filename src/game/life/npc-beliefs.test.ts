import { describe, expect, it } from "vitest";
import type { AgentId } from "../../core/index.ts";
import { believed, type Percept } from "../../sim/index.ts";
import { learnActions } from "./knowing.ts";

const A = "agent:1" as AgentId;

function seen(tick: number, identified: boolean): Percept {
  return {
    id: `p:${tick}`,
    observer: "agent:9" as AgentId,
    tick,
    channels: ["sight"],
    detail: identified ? "identified" : "clear",
    fields: {
      action: { value: "action.give", confidence: 0.8, mistaken: false },
      identity: { value: identified ? A : null, confidence: 0.8, mistaken: false },
    },
  } as Percept;
}

describe("NPC sobre NPC: lo que vio hacer", () => {
  it("el que reconoció queda con la acción creída; el desconocido, no", () => {
    const b = learnActions(undefined, [seen(100, true), seen(110, false)], 50, 120);
    expect(believed(b, A, "action")?.value).toBe("action.give");
    expect(learnActions(undefined, [seen(110, false)], 50, 120)).toBeUndefined();
  });

  it("lo anterior a la ventana no se vuelve a aprender", () => {
    expect(learnActions(undefined, [seen(40, true)], 50, 120)).toBeUndefined();
  });
});
