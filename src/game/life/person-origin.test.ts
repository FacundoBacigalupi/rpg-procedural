import { describe, expect, it } from "vitest";
import { type AgentId, makeId, type SettlementId } from "../../core/index.ts";
import {
  ACCENT_FEATURES,
  type Accent,
  COMMUNITY_ACCENT,
  type CommunityAccent,
  PLACE,
  WorldTruth,
} from "../../sim/index.ts";
import { greetingClarity, personNative } from "./npc-greeting-speech.ts";
import { languagesOf, levelIn, originOf, setPersonOrigin } from "./person-origin.ts";

const flat = (x: number): Accent =>
  Object.fromEntries(ACCENT_FEATURES.map((f) => [f, x])) as unknown as Accent;
const home = makeId("settlement", 1) as SettlementId;
const far = makeId("settlement", 2) as SettlementId;
const a = makeId("agent", 1) as AgentId;
const b = makeId("agent", 2) as AgentId;

function world(): WorldTruth {
  const t = new WorldTruth();
  t.set(PLACE, home, { kind: "village" } as never);
  for (const [id, lang, x] of [
    [home, "hills", 0.2],
    [far, "coast", 0.7],
  ] as const) {
    t.set(COMMUNITY_ACCENT, id, {
      language: lang,
      accent: flat(x),
      parent: flat(0.5),
      generations: 3,
      originEventId: "event:0",
    } as unknown as CommunityAccent);
  }
  return t;
}

describe("origen y lenguas por persona", () => {
  it("sin fila es de la aldea y la claridad entre vecinos es 1", () => {
    const t = world();
    expect(originOf(t, a)).toBe(home);
    expect(languagesOf(t, a)).toEqual([{ language: "hills", level: 1 }]);
    expect(personNative(t, a)?.language).toBe("hills");
    expect(greetingClarity(t, a, b, personNative, levelIn)).toBe(1);
  });

  it("un viajero de otra comunidad habla otra lengua: no lo entienden, y él entiende según su nivel", () => {
    const t = world();
    setPersonOrigin(t, b, { origin: far, learned: [{ language: "hills", level: 0.6 }] });
    expect(personNative(t, b)?.language).toBe("coast");
    expect(levelIn(t, b, "coast")).toBe(1);
    expect(levelIn(t, b, "hills")).toBe(0.6);
    expect(levelIn(t, a, "coast")).toBe(0);
    // la gente de la aldea no entiende al viajero; el viajero entiende parte de la aldea
    expect(greetingClarity(t, b, a, personNative, levelIn)).toBe(0);
    expect(greetingClarity(t, a, b, personNative, levelIn)).toBe(0.6);
  });

  it("misma lengua en otra comunidad: se entiende con el acento cambiado", () => {
    const t = world();
    t.set(COMMUNITY_ACCENT, far, {
      ...(t.get(COMMUNITY_ACCENT, far) as CommunityAccent),
      language: "hills",
      accent: flat(0.3),
    });
    setPersonOrigin(t, b, { origin: far, learned: [] });
    const c = greetingClarity(t, a, b, personNative, levelIn);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(1);
    expect(greetingClarity(t, a, b, personNative, levelIn)).toBe(c);
  });
});
