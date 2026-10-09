import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EventId, PlaceRef } from "../../core/index.ts";
import { type AgentId, Rng } from "../../core/index.ts";
import { addMemory, formMemory } from "../mind/index.ts";
import type { Vector } from "../relations/index.ts";
import { understand } from "./acts.ts";
import { clampTemper, NO_RECOLLECTION, recollect } from "./disposition.ts";
import { hear } from "./knowledge.ts";
import { SpeechLine } from "./lines.ts";
import {
  decideReply,
  GIFT_GRAMS,
  holdsGrudge,
  isFormal,
  misheard,
  RESERVE_GRAMS_PER_MEMBER,
  type ReplyInput,
  warmth,
} from "./reply.ts";

const STRANGER: Vector = {
  trust: 0.05,
  respect: 0,
  affection: 0,
  fear: 0,
  attraction: 0,
  gratitude: 0,
  jealousy: 0,
  resentment: 0,
  familiarity: 0,
  dependency: 0,
};
// Como un padre o un hijo: cariño, confianza y trato diario (content/relation-bonds).
const KIN: Vector = { ...STRANGER, trust: 0.35, respect: 0.3, affection: 0.4, familiarity: 0.9 };
// Alguien que solo vive en la misma casa.
const HOUSEMATE: Vector = { ...STRANGER, trust: 0.1, familiarity: 0.5 };

const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
  SpeechLine.parse(l),
);
const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const lex = {
  people: [{ id: bruno, names: ["Bruno", "hermano"] }],
  goods: [{ id: "grain", names: ["grano", "grain"] }],
};

function input(over: Partial<ReplyInput>): ReplyInput {
  return {
    act: { kind: "greet" },
    speaker: bruno,
    listener: ana,
    feel: KIN,
    direct: () => null,
    heard: [],
    nameOf: () => "Bruno",
    goodName: () => "grano",
    held: () => 0,
    members: 4,
    lines,
    rng: Rng.root(1),
    ...over,
  };
}

describe("entender", () => {
  it("reconoce saludo, despedida, pregunta, pedido y noticia", () => {
    expect(understand("¡Hola, buen día!", lex).kind).toBe("greet");
    expect(understand("Chau, nos vemos", lex).kind).toBe("farewell");
    expect(understand("¿Sabés dónde está Bruno?", lex)).toEqual({ kind: "ask", about: bruno });
    expect(understand("Dame un poco de grano", lex)).toEqual({ kind: "request", good: "grain" });
    expect(understand("Te cuento que Bruno murió", lex)).toEqual({
      kind: "tell",
      about: bruno,
      claim: "dead",
    });
    expect(understand("el cielo está lindo", lex).kind).toBe("other");
  });

  it("con la voz turbia capta lo grueso pero no el detalle", () => {
    expect(understand("¿Dónde está Bruno?", lex, 0.1)).toEqual({ kind: "ask", about: null });
  });
});

describe("contestar", () => {
  it("sin creencias dice que no sabe, y si le contaron algo lo repite como dicho", () => {
    const ask = input({ act: { kind: "ask", about: bruno } });
    expect(decideReply(ask, 0).line).toBe("ask.unknown");
    const told = hear(undefined, { about: bruno, claim: "dead", from: ana, at: 5 });
    expect(decideReply({ ...ask, heard: told.claims }, 0).line).toBe("ask.heard_dead");
  });

  it("responde dónde está lo que ve de primera mano", () => {
    const r = decideReply(
      input({ act: { kind: "ask", about: bruno }, direct: () => ({ where: "yard" }) }),
      0,
    );
    expect(r.line).toBe("ask.at.yard");
    expect(r.text).toContain("Bruno");
  });

  it("duda de lo que contradice lo que ve, y toma como dicho lo que no", () => {
    const tell = input({ act: { kind: "tell", about: bruno, claim: "dead" } });
    const doubt = decideReply({ ...tell, direct: () => ({ where: "room" }) }, 0);
    expect(doubt.line).toBe("tell.doubt");
    expect(doubt.accepted).toBeUndefined();
    expect(decideReply(tell, 9).accepted).toEqual({
      about: bruno,
      claim: "dead",
      from: bruno,
      at: 9,
    });
  });

  it("con señales claras de mentira acusa y no toma lo contado; un sincero tranquilo es creído", () => {
    const tell = input({ act: { kind: "tell", about: bruno, claim: "dead" } });
    const liar = {
      lying: true,
      control: 0,
      nerves: 1,
      insight: 1,
      familiarity: 1,
      conflict: 1,
      implausibility: 1,
      trust: 0,
      wariness: 1,
    };
    const honest = {
      lying: false,
      control: 0.5,
      nerves: 0,
      insight: 0.5,
      familiarity: 0.5,
      conflict: 0,
      implausibility: 0,
      trust: 0.8,
      wariness: 0,
    };
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const rng = Rng.root(seed);
        const caught = decideReply({ ...tell, detect: liar, rng }, 3);
        expect(caught.line).toBe("tell.caught");
        expect(caught.accepted).toBeUndefined();
        expect(caught.judgement?.trustDelta).toBeLessThan(0);
        expect(caught.caught).toEqual({ liar: bruno, by: ana, at: 3, certain: true });
        const ok = decideReply({ ...tell, detect: honest, rng }, 3);
        // El juicio tiene ruido: un sincero a veces despierta duda, pero nunca se lo acusa de mentir.
        expect(["tell.dead", "tell.doubted"]).toContain(ok.line);
        if (ok.line === "tell.dead") expect(ok.accepted?.claim).toBe("dead");
        expect(ok.caught).toBeUndefined();
      }),
    );
  });

  it("da solo a la familia y solo lo que sobra después de la reserva", () => {
    const req = input({ act: { kind: "request", good: "grain" } });
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    expect(decideReply({ ...req, held: () => rich }, 0).give).toEqual({
      good: "grain",
      grams: GIFT_GRAMS,
    });
    expect(decideReply({ ...req, held: () => rich - 1 }, 0).line).toBe("request.short");
    const neighbor = decideReply({ ...req, held: () => rich, feel: STRANGER }, 0);
    expect(neighbor.line).toBe("request.credit");
    expect(neighbor.give).toEqual({ good: "grain", grams: GIFT_GRAMS, credit: true });
    const owing = { grams: 800, overdue: false };
    expect(decideReply({ ...req, held: () => rich, feel: STRANGER, owes: owing }, 0).line).toBe(
      "request.refuse.limit",
    );
    const late = { grams: 300, overdue: true };
    expect(decideReply({ ...req, held: () => rich, feel: STRANGER, owes: late }, 0).line).toBe(
      "request.refuse.owes",
    );
  });

  it("cede por miedo, devuelve el favor y suena cálido según la relación", () => {
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    const req = input({ act: { kind: "request", good: "grain" }, held: () => rich });
    const afraid = { ...STRANGER, fear: 0.7, resentment: 0.6 };
    expect(decideReply({ ...req, feel: afraid }, 0).line).toBe("request.give.afraid");
    expect(decideReply({ ...req, feel: { ...STRANGER, resentment: 0.6 } }, 0).line).toBe(
      "request.refuse.grudge",
    );
    const back = decideReply({ ...req, feel: { ...STRANGER, gratitude: 0.6 } }, 0);
    expect(back.line).toBe("request.give.grateful");
    expect(back.give?.grams).toBe(GIFT_GRAMS);
    const warm = decideReply({ ...req, feel: { ...STRANGER, affection: 0.5, trust: 0.3 } }, 0);
    expect(warm.line).toBe("request.give");
    expect(["Tomá, llevate grano, lo que necesites.", "Claro que sí, te paso grano."]).toContain(
      warm.text,
    );
  });

  it("da o fía según lo que siente por quien pide, no según el parentesco", () => {
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    const req = input({ act: { kind: "request", good: "grain" }, held: () => rich });
    expect(decideReply({ ...req, feel: HOUSEMATE }, 0).line).toBe("request.credit");
    // Un desconocido que se ganó el cariño recibe como de la familia.
    const dear = { ...STRANGER, affection: 0.5, trust: 0.3 };
    expect(decideReply({ ...req, feel: dear }, 0).line).toBe("request.give");
    // Un pariente al que se le guarda rencor o no se le cree, no.
    expect(decideReply({ ...req, feel: { ...KIN, resentment: 0.5 } }, 0).line).toBe(
      "request.refuse.grudge",
    );
    expect(decideReply({ ...req, feel: { ...KIN, trust: -0.4 } }, 0).line).toBe(
      "request.refuse.grudge",
    );
    expect(warmth(KIN)).toBeGreaterThan(warmth(HOUSEMATE));
    expect(holdsGrudge(KIN)).toBe(false);
  });

  it("se habla de usted a quien se respeta o tiene rango y no se trata de cerca", () => {
    expect(isFormal(STRANGER)).toBe(false);
    expect(isFormal(STRANGER, true)).toBe(true);
    expect(isFormal({ ...STRANGER, respect: 0.6 })).toBe(true);
    // El hijo que respeta a su padre lo tutea: lo conoce demasiado.
    expect(isFormal(KIN, true)).toBe(false);
    const greet = input({ act: { kind: "greet" }, feel: STRANGER, rankAbove: true });
    const formalLines = lines.find((l) => l.id === "greet")?.formal ?? [];
    expect(formalLines).toContain(decideReply(greet, 0).text);
  });

  it("a quien sabe que robó o pegó no le da ni de familia, y lo saluda frío", () => {
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    const req = input({ act: { kind: "request", good: "grain" }, held: () => rich });
    const refused = decideReply({ ...req, reproach: "theft" }, 0);
    expect(refused.line).toBe("request.refuse.theft");
    expect(refused.give).toBeUndefined();
    expect(decideReply({ ...req, reproach: "assault" }, 0).line).toBe("request.refuse.assault");
    expect(decideReply(input({ reproach: "assault" }), 0).line).toBe("greet.cold.assault");
    expect(decideReply({ ...req, reproach: null }, 0).give).toBeDefined();
  });

  it("el temperamento mueve los umbrales: el cálido da antes, el reactivo se ofende antes", () => {
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    const req = input({ act: { kind: "request", good: "grain" }, held: () => rich });
    const mild = { ...STRANGER, affection: 0.3, trust: 0.15 }; // calidez ≈ 0,195: justo bajo el umbral
    const cold = { warmth: -1, reactivity: 0 };
    const kind = { warmth: 1, reactivity: 0 };
    expect(decideReply({ ...req, feel: mild, temper: cold }, 0).line).toBe("request.credit");
    expect(decideReply({ ...req, feel: mild, temper: kind }, 0).line).toBe("request.give");
    const sore = { ...KIN, resentment: 0.35 };
    expect(holdsGrudge(sore)).toBe(false);
    expect(holdsGrudge(sore, 1)).toBe(true);
    expect(decideReply({ ...req, feel: sore, temper: { warmth: 0, reactivity: 1 } }, 0).line).toBe(
      "request.refuse.grudge",
    );
  });

  it("lo que recuerda de quien habla cambia el saludo y el pedido sin tocar la relación", () => {
    const rich = 4 * RESERVE_GRAMS_PER_MEMBER + GIFT_GRAMS;
    const req = input({ act: { kind: "request", good: "grain" }, held: () => rich });
    const fond = { bias: 0.8, vivid: 0.6, count: 3 };
    const sour = { bias: -0.8, vivid: 0.6, count: 3 };
    expect(decideReply(input({ recollection: fond }), 0).line).toBe("greet.fond");
    expect(decideReply(input({ recollection: sour }), 0).line).toBe("greet.wary");
    expect(decideReply(input({ recollection: { ...sour, vivid: 0.05 } }), 0).line).toBe("greet");
    expect(decideReply({ ...req, recollection: sour }, 0).line).toBe("request.refuse.remembered");
    // Un recuerdo grato acerca a quien la relación sola dejaba en el fiado.
    const mild = { ...STRANGER, affection: 0.3, trust: 0.15 };
    expect(decideReply({ ...req, feel: mild }, 0).line).toBe("request.credit");
    expect(decideReply({ ...req, feel: mild, recollection: fond }, 0).line).toBe("request.give");
    // El saludo frío por una falta conocida manda sobre el recuerdo grato.
    expect(decideReply(input({ recollection: fond, reproach: "theft" }), 0).line).toBe(
      "greet.cold.theft",
    );
  });

  it("es determinista", () => {
    const a = input({ act: { kind: "greet" } });
    expect(decideReply(a, 0)).toEqual(decideReply(a, 0));
  });
});

describe("recordar a quien habla", () => {
  const PLACE = { kind: "none" } as unknown as PlaceRef;
  let n = 0;
  const mem = (who: AgentId, intensity: number, valence: number, at = 0) =>
    formMemory({
      eventId: `event:${++n}` as EventId,
      kind: "combat.fight",
      with: [who],
      place: PLACE,
      at,
      intensity,
      valence,
    });

  it("sin memorias de esa persona no hay nada que recordar", () => {
    expect(recollect(undefined, bruno, 0)).toEqual(NO_RECOLLECTION);
    const other = addMemory(undefined, mem(ana, 0.9, -0.9), 0);
    expect(recollect(other, bruno, 0)).toEqual(NO_RECOLLECTION);
  });

  it("el tono sigue la valencia, pesa más lo intenso y se apaga con el tiempo", () => {
    const bad = addMemory(undefined, mem(bruno, 0.9, -0.9), 0);
    const r = recollect(bad, bruno, 0);
    expect(r.bias).toBeLessThan(-0.5);
    expect(r.vivid).toBeGreaterThan(0.5);
    const mixed = addMemory(
      addMemory(undefined, mem(bruno, 0.9, -0.9), 0),
      mem(bruno, 0.1, 0.9),
      0,
    );
    expect(recollect(mixed, bruno, 0).bias).toBeLessThan(0);
    const day = 86_400;
    const later = recollect(addMemory(undefined, mem(bruno, 0.2, -0.9), 0), bruno, 400 * day);
    expect(Math.abs(later.bias)).toBeLessThan(Math.abs(recollect(bad, bruno, 0).bias));
  });

  it("también cuenta lo ya olvidado, comprimido en resumen", () => {
    let m = addMemory(undefined, mem(bruno, 0.1, -0.8), 0);
    for (let i = 0; i < 25; i++) m = addMemory(m, mem(ana, 0.5, 0.5, 1), 1);
    expect(m.gists.some((g) => g.with.includes(bruno))).toBe(true);
    expect(recollect(m, bruno, 1).count).toBeGreaterThan(0);
  });

  it("siempre está acotado, y el temperamento también", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            i: fc.double({ min: 0, max: 1, noNaN: true }),
            v: fc.double({ min: -1, max: 1, noNaN: true }),
          }),
          { maxLength: 30 },
        ),
        fc.integer({ min: 0, max: 400 }),
        (xs, days) => {
          let m = undefined as ReturnType<typeof addMemory> | undefined;
          for (const x of xs) m = addMemory(m, mem(bruno, x.i, x.v), 0);
          const r = recollect(m, bruno, days * 86_400);
          expect(r.bias).toBeGreaterThanOrEqual(-1);
          expect(r.bias).toBeLessThanOrEqual(1);
          expect(r.vivid).toBeGreaterThanOrEqual(0);
          expect(r.vivid).toBeLessThanOrEqual(1);
        },
      ),
    );
    expect(clampTemper(9)).toBe(1);
    expect(clampTemper(-9)).toBe(-1);
  });
});

describe("el acto declarado y lo que el oyente entiende", () => {
  it("pide que se lo repitan solo si no captó nada y quería decir otra cosa", () => {
    const other = { kind: "other" } as const;
    expect(misheard({ act: other, intended: "ask" })).toBe(true);
    expect(misheard({ act: other })).toBe(false);
    expect(misheard({ act: { kind: "greet" }, intended: "ask" })).toBe(false);
  });
});
