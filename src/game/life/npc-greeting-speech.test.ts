import { describe, expect, it } from "vitest";
import { type AgentId, makeId } from "../../core/index.ts";
import {
  ACCENT_FEATURES,
  type Accent,
  type AddressDef,
  ENTITY,
  PERSON_NAME,
  SKILL_STATE,
  WorldTruth,
} from "../../sim/index.ts";
import { greetingClarity, lexicalGreetingSpeech, type Native } from "./npc-greeting-speech.ts";
import { GREET_MIN_CLARITY } from "./npc-greetings.ts";

const a = makeId("agent", 1) as AgentId;
const b = makeId("agent", 2) as AgentId;
const flat = (v: number): Accent =>
  Object.fromEntries(ACCENT_FEATURES.map((f) => [f, v])) as unknown as Accent;
const natives: Record<string, Native> = {};
const nativeOf = (_t: unknown, who: AgentId) => natives[who];

describe("el saludo con lengua y acento", () => {
  const truth = new WorldTruth();

  it("misma lengua y mismo acento: se oye entero; otra lengua: no se entiende", () => {
    natives[a] = { language: "hills", accent: flat(0.3) };
    natives[b] = { language: "hills", accent: flat(0.3) };
    expect(greetingClarity(truth, a, b, nativeOf)).toBe(1);
    natives[b] = { language: "coast", accent: flat(0.3) };
    expect(greetingClarity(truth, a, b, nativeOf)).toBe(0);
    expect(0).toBeLessThan(GREET_MIN_CLARITY);
  });

  it("el acento lejano quita claridad y es simétrico; sin datos, 1", () => {
    natives[a] = { language: "hills", accent: flat(0.2) };
    natives[b] = { language: "hills", accent: flat(0.4) };
    const near = greetingClarity(truth, a, b, nativeOf);
    expect(near).toBeLessThan(1);
    expect(greetingClarity(truth, b, a, nativeOf)).toBe(near);
    natives[b] = { language: "hills", accent: flat(0.8) };
    expect(greetingClarity(truth, a, b, nativeOf)).toBeLessThan(near);
    expect(greetingClarity(truth, a, makeId("agent", 9) as AgentId, nativeOf)).toBe(1);
  });

  it("un oído fino compensa parte del acento", () => {
    natives[a] = { language: "hills", accent: flat(0.2) };
    natives[b] = { language: "hills", accent: flat(0.5) };
    const t = new WorldTruth();
    const dull = greetingClarity(t, a, b, nativeOf);
    t.set(SKILL_STATE, b, { speech: { facets: { reading: 1 } } } as never);
    const keen = greetingClarity(t, a, b, nativeOf);
    expect(keen).toBeGreaterThanOrEqual(dull);
  });

  it("el texto sale de la lengua: honorífico del léxico y nombre de pila del oyente", () => {
    const addresses: AddressDef[] = [
      {
        id: "village.to_peer",
        name: "x",
        culture: "village",
        recipient: "peer",
        formality: 0,
        concepts: ["elder"],
      } as AddressDef,
    ];
    const language = { compound: () => ({ text: "zorvu" }), concepts: new Map() } as never;
    const t = new WorldTruth();
    t.set(ENTITY, b, { id: b, originEventId: makeId("event", 1), createdAt: 0 } as never);
    t.set(PERSON_NAME, b, {
      language: "hills",
      parts: [{ kind: "given", form: "Aren" }],
    } as never);
    const speech = lexicalGreetingSpeech({ language, addresses, culture: "village" });
    expect(speech.say(a, b, t)).toBe("Buenas, zorvu Aren");
    expect(speech.say(a, makeId("agent", 9) as AgentId, t)).toBe("Buenas, zorvu");
    expect(speech.say(a, b, t)).toBe(speech.say(a, b, t));
  });
});
