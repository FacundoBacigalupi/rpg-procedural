import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  continuityFor,
  EMPTY_MEMORY,
  markedPhrases,
  RECENT_MAX,
  remember,
  SUMMARIES_MAX,
} from "./continuity.ts";

const keys = new Map([
  ["e1", "agent:7"],
  ["e2", "agent:9"],
]);

describe("memoria de continuidad", () => {
  it("guarda cómo se nombró a cada entidad y lo entrega por etiqueta local", () => {
    const mem = remember(EMPTY_MEMORY, {
      marked: "{{e1|la tía de ojos cansados}} te mira. {{e2|el viejo}} calla.",
      text: "La tía de ojos cansados te mira. El viejo calla.",
      keys,
    });
    // En otro pedido la tía es e5: la descripción la sigue, y e2 no la recibe.
    const view = continuityFor(mem, new Map([["e5", "agent:7"]]));
    expect(view.established).toEqual([{ id: "e5", phrases: ["la tía de ojos cansados"] }]);
    expect(JSON.stringify(view)).not.toContain("agent:");
  });

  it("no mezcla a quien el personaje no vinculó (sin clave, no hay descripción)", () => {
    const mem = remember(EMPTY_MEMORY, {
      marked: "{{e3|un desconocido}} pasa.",
      text: "Un desconocido pasa.",
      keys,
    });
    expect(Object.keys(mem.descriptions)).toEqual([]);
  });

  it("los fragmentos viejos pasan a resúmenes de una frase, con tope", () => {
    let mem = EMPTY_MEMORY;
    for (let i = 0; i < 30; i++) {
      mem = remember(mem, { marked: `Día ${i}. Algo más.`, text: `Día ${i}. Algo más.`, keys });
    }
    expect(mem.recent).toHaveLength(RECENT_MAX);
    expect(mem.recent.at(-1)).toBe("Día 29. Algo más.");
    expect(mem.summaries).toHaveLength(SUMMARIES_MAX);
    expect(mem.summaries.at(-1)).toBe("Día 25.");
  });

  it("el lugar se describe la primera vez y no se pisa", () => {
    let mem = remember(EMPTY_MEMORY, {
      marked: "El patio huele a humo. Hay barro.",
      text: "El patio huele a humo. Hay barro.",
      keys,
      placeKey: "place:1",
    });
    mem = remember(mem, { marked: "Otra cosa.", text: "Otra cosa.", keys, placeKey: "place:1" });
    expect(continuityFor(mem, keys, "place:1").place).toEqual(["El patio huele a humo."]);
  });

  it("es JSON plano y determinista", () => {
    const input = { marked: "{{e1|la tía}} habla.", text: "La tía habla.", keys };
    const a = remember(EMPTY_MEMORY, input);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(remember(EMPTY_MEMORY, input)).toEqual(a);
  });

  it("markedPhrases tolera cualquier texto y respeta el tope por entidad", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        for (const phrases of markedPhrases(s).values())
          expect(phrases.length).toBeLessThanOrEqual(4);
      }),
    );
  });
});
