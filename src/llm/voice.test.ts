import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeId } from "../core/index.ts";
import { buildPlayerView } from "../game/index.ts";
import {
  characterLexicon,
  DEFAULT_NARRATION,
  MOODS,
  narrationRequest,
  narratorUserMessage,
  registerOf,
  STRATA,
  styleOf,
  unknownTermsIn,
  type VoiceInput,
  validateNarration,
  voiceOf,
  type WorldTerm,
} from "./index.ts";

const WORLD: WorldTerm[] = [
  { concept: "qi", term: "qi", plain: "el aliento de las cosas", technical: false },
  {
    concept: "realm.foundation",
    term: "Fundación",
    plain: "uno de esos inmortales",
    technical: true,
  },
  {
    concept: "realm.core",
    term: "núcleo dorado",
    plain: "esa luz que llevan adentro",
    technical: true,
  },
];

const style = styleOf(DEFAULT_NARRATION, "es");
const view = buildPlayerView({
  player: makeId("agent", 1),
  scene: {
    placeKinds: ["village"],
    space: "street",
    indoor: false,
    home: false,
    familiar: true,
    hour: 10,
    light: 1,
  },
  percepts: [],
  steps: [],
  acquaintances: new Map(),
});

describe("léxico del personaje", () => {
  it("lo técnico entra solo si lo cree; lo común siempre", () => {
    const peasant = characterLexicon(WORLD, new Set());
    expect(peasant.use).toEqual(["qi"]);
    expect(peasant.avoid.map((a) => a.term)).toEqual(["núcleo dorado", "Fundación"]);
    const adept = characterLexicon(WORLD, new Set(["realm.foundation"]));
    expect(adept.use).toEqual(["Fundación", "qi"]);
    expect(adept.avoid.map((a) => a.term)).toEqual(["núcleo dorado"]);
  });

  it("no depende del orden del mundo", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const shuffled = [...WORLD].sort(
          (a, b) => ((a.concept.length * seed) % 7) - ((b.concept.length * seed) % 7),
        );
        expect(characterLexicon(shuffled, new Set())).toEqual(characterLexicon(WORLD, new Set()));
      }),
    );
  });

  it("el validador rechaza el término que no conoce y dice qué usar", () => {
    const vocabulary = characterLexicon(WORLD, new Set());
    const req = narrationRequest(view, style, [], { vocabulary });
    const bad = validateNarration("Pasa un cultivador de la fundación, con su núcleo dorado.", req);
    expect(bad).toEqual([
      '"núcleo dorado" is a term the character does not know: say "esa luz que llevan adentro" instead',
      '"Fundación" is a term the character does not know: say "uno de esos inmortales" instead',
    ]);
    expect(
      validateNarration("Pasa uno de esos inmortales, con esa luz que llevan adentro.", req),
    ).toEqual([]);
    // Sin léxico en el pedido no hay restricción.
    expect(validateNarration("Habla de la Fundación.", narrationRequest(view, style))).toEqual([]);
  });

  it("no confunde una palabra más larga con el término", () => {
    const lex = characterLexicon(WORLD, new Set());
    expect(unknownTermsIn("la fundaciones del puente", lex)).toEqual([]);
    expect(unknownTermsIn("«Fundación», dijo", lex, "")).toHaveLength(1);
    expect(unknownTermsIn("«Fundación», dijo", lex, "Fundación")).toEqual([]);
  });
});

describe("voz del personaje", () => {
  it("el registro sube con el estudio y el estrato", () => {
    expect(registerOf("poor", 0)).toBe("rough");
    expect(registerOf("common", 0.4)).toBe("plain");
    expect(registerOf("noble", 0.5)).toBe("refined");
    fc.assert(
      fc.property(
        fc.constantFrom(...STRATA),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, e) => {
          const order = ["rough", "plain", "refined"];
          expect(order.indexOf(registerOf(s, Math.min(1, e + 0.1)))).toBeGreaterThanOrEqual(
            order.indexOf(registerOf(s, e)),
          );
        },
      ),
    );
  });

  it("el pedido lleva la voz como consignas, no como números, y el ánimo no agrega hechos", () => {
    for (const mood of MOODS) {
      const input: VoiceInput = {
        culture: "de montaña",
        stratum: "common",
        education: 0.3,
        trade: { name: "herrero", notices: ["el temple de una hoja"] },
        mood,
      };
      const req = narrationRequest(view, style, [], { voice: voiceOf(input) });
      const msg = JSON.parse(narratorUserMessage(req));
      expect(msg.voice.culture).toBe("de montaña");
      expect(msg.voice.trade.notices).toEqual(["el temple de una hoja"]);
      expect(typeof msg.voice.mood).toBe("string");
      expect(msg.voice.mood).not.toBe(mood === "calm" ? "x" : mood);
      expect(validateNarration("Caminás por la calle.", req)).toEqual([]);
    }
  });

  it("sin voz ni léxico el mensaje es el de siempre", () => {
    const msg = JSON.parse(narratorUserMessage(narrationRequest(view, style)));
    expect(msg.voice).toBeUndefined();
    expect(msg.vocabulary).toBeUndefined();
  });
});
