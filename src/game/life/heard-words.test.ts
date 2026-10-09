import { describe, expect, it } from "vitest";
import type { AgentId, Event } from "../../core/index.ts";
import { HEARD_WORDS, WorldTruth } from "../../sim/index.ts";
import { heardWordsProcess } from "./taboos.ts";

describe("palabras de forma en el léxico", () => {
  it("las dos personas de la charla aprenden el tratamiento y las palabras dichas", () => {
    const a = "agent:1" as AgentId;
    const b = "agent:2" as AgentId;
    const e = {
      id: "event:1",
      tick: 1,
      kind: "action.speak",
      actors: [a, b],
      data: { effect: { form: { address: "kel", words: [{ text: "mor" }] } } },
    } as unknown as Event;
    const out = heardWordsProcess().run({
      now: 1,
      recent: [e],
      truth: new WorldTruth(),
    } as never);
    expect(out.changes).toHaveLength(2);
    const t = new WorldTruth();
    for (const c of (out.changes ?? []) as unknown as { id: never; value: never }[])
      t.set(HEARD_WORDS, c.id, c.value);
    expect(t.get(HEARD_WORDS, a)?.words).toEqual(["kel", "mor"]);
  });
});
