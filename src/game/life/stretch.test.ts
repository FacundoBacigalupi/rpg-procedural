import { describe, expect, it } from "vitest";
import type { AgentId, Event } from "../../core/index.ts";
import type { StepRecord } from "./act.ts";
import { stretchOf } from "./stretch.ts";

const ME = "agent:1" as AgentId;
const step = (verb: string, believed: string, effect: object = { kind: "none" }) =>
  ({ verb, at: 0, self: { believed, effect } }) as unknown as StepRecord;
const ev = (kind: string, tick: number) => ({ kind, tick, actors: [ME] }) as unknown as Event;

describe("lo vivido en un salto", () => {
  const steps = [
    step("work", "success"),
    step("work", "failure"),
    step("work", "success", { kind: "work", hurt: true }),
    step("eat", "success"),
    step("wait", "success"),
    step("speak", "success", { kind: "speak", to: "agent:2" }),
    step("speak", "success", { kind: "speak", to: "agent:2" }),
  ];

  it("cuenta los verbos más repetidos, los fracasos, a quién habló y si se lastimó", () => {
    const s = stretchOf(steps, [], ME, 0, 3000, 1000);
    expect(s.days).toBe(3);
    expect(s.did[0]).toEqual({ verb: "work", times: 3, failed: 1 });
    expect(s.did.map((d) => d.verb)).not.toContain("wait");
    expect(s.spoke).toBe(1);
    expect(s.hurt).toBe(true);
    expect(s.fought).toBe(false);
  });

  it("una pelea propia dentro del salto cuenta; una anterior, no", () => {
    expect(stretchOf([], [ev("combat.strike", 50)], ME, 10, 2000, 1000).fought).toBe(true);
    expect(stretchOf([], [ev("combat.strike", 5)], ME, 10, 2000, 1000).fought).toBe(false);
  });
});
