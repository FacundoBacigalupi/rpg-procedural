import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, Rng } from "../../core/index.ts";
import type { Vector } from "../relations/index.ts";
import { looseCounter, understand } from "./acts.ts";
import { SpeechLine } from "./lines.ts";
import {
  alternativesAmong,
  bargainFace,
  dealHolds,
  type Leverage,
  leverageShift,
  MAX_ROUNDS,
  type OfferInput,
  offerMargin,
  weighOffer,
} from "./offers.ts";
import { decideReply, type ReplyInput } from "./reply.ts";

const ana = "agent:1" as AgentId;
const bruno = "agent:2" as AgentId;
const lex = {
  people: [],
  goods: [
    { id: "grain", names: ["grano"] },
    { id: "salt", names: ["sal"] },
  ],
};
const PRICE: Record<string, number> = { grain: 8, salt: 16 };

const base: OfferInput = {
  give: { good: "salt", grams: 1000 },
  want: { good: "grain", grams: 1000 },
  worth: (g) => PRICE[g] ?? null,
  spare: () => 100_000,
  speakerHas: () => 100_000,
  felt: 0,
};

describe("entender propuestas", () => {
  it("lee qué da y qué quiere quien habla", () => {
    expect(understand("Te doy 2 kilos de sal por 3 kilos de grano", lex)).toEqual({
      kind: "offer",
      give: { good: "salt", grams: 2000 },
      want: { good: "grain", grams: 3000 },
    });
    expect(understand("Te compro grano por sal", lex)).toEqual({
      kind: "offer",
      give: { good: "salt", grams: 1000 },
      want: { good: "grain", grams: 1000 },
    });
  });
  it("aceptar y rechazar son frases cortas; las largas no", () => {
    expect(understand("Trato hecho", lex)).toEqual({ kind: "accept" });
    expect(understand("No gracias", lex)).toEqual({ kind: "refuse" });
    expect(
      understand("Hola, cuando termine la cosecha te cuento como nos fue, de acuerdo con todo", lex)
        .kind,
    ).not.toBe("accept");
  });
  it("una promesa con la palabra por delante sigue siendo promesa", () => {
    expect(understand("Te doy mi palabra, te devuelvo el grano", lex).kind).toBe("promise");
  });
});

describe("weighOffer", () => {
  it("acepta si lo que recibe vale más que lo que cede con su margen", () => {
    expect(weighOffer(base).kind).toBe("accept");
  });
  it("contraoferta si falta poco y rechaza si falta mucho", () => {
    const cheap = { ...base, give: { good: "salt", grams: 520 } };
    expect(weighOffer(cheap).kind).toBe("counter");
    expect(weighOffer({ ...base, give: { good: "salt", grams: 100 } }).kind).toBe("reject");
  });
  it("la contraoferta cede menos de lo que se le pidió y es un trato que aceptaría", () => {
    const v = weighOffer({ ...base, give: { good: "salt", grams: 520 } });
    if (v.kind !== "counter") throw new Error("esperaba contraoferta");
    expect(v.counter.gives?.grams).toBeLessThan(1000);
    const again = weighOffer({ ...base, give: v.counter.gets, want: v.counter.gives });
    expect(again.kind).toBe("accept");
  });
  it("sin reserva o sin que quien propone tenga lo que ofrece, no hay trato", () => {
    expect(weighOffer({ ...base, spare: () => 0 }).kind).toBe("short");
    expect(weighOffer({ ...base, speakerHas: () => 0 }).kind).toBe("short");
  });
  it("un bien que no sabe valuar no se tasa", () => {
    expect(weighOffer({ ...base, worth: () => null }).kind).toBe("unvalued");
  });
  it("un regalo se recibe", () => {
    expect(weighOffer({ ...base, want: null }).kind).toBe("gift");
  });
  it("más calidez, menos margen; el margen está acotado", () => {
    fc.assert(
      fc.property(fc.double({ min: -3, max: 3, noNaN: true }), (f) => {
        const m = offerMargin(f);
        expect(m).toBeGreaterThanOrEqual(-0.1);
        expect(m).toBeLessThanOrEqual(0.4);
        expect(offerMargin(f + 0.1)).toBeLessThanOrEqual(m);
      }),
    );
  });
  it("lo que cede el oyente nunca supera lo que se le pidió", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 1, max: 50_000 }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (g, w, felt) => {
          const v = weighOffer({
            ...base,
            felt,
            give: { good: "salt", grams: g },
            want: { good: "grain", grams: w },
          });
          const given =
            v.kind === "accept" ? v.deal.gives : v.kind === "counter" ? v.counter.gives : null;
          if (given) expect(given.grams).toBeLessThanOrEqual(w);
        },
      ),
    );
  });
});

describe("poder de negociación", () => {
  const none: Leverage = { alternatives: 0, desperation: 0, face: 0 };
  it("las alternativas y la cara suben el margen; la desesperación lo baja", () => {
    expect(offerMargin(0, { ...none, alternatives: 1 })).toBeGreaterThan(offerMargin(0));
    expect(offerMargin(0, { ...none, face: 1 })).toBeGreaterThan(offerMargin(0));
    expect(offerMargin(0, { ...none, desperation: 1 })).toBeLessThan(offerMargin(0));
  });
  it("el desesperado acepta lo que con alternativas rechazaría", () => {
    const tight = { ...base, give: { good: "salt", grams: 520 } };
    expect(weighOffer({ ...tight, leverage: { ...none, desperation: 1 } }).kind).toBe("accept");
    expect(weighOffer({ ...tight, leverage: { ...none, alternatives: 1 } }).kind).not.toBe(
      "accept",
    );
  });
  it("el margen sigue acotado con cualquier palanca", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        (f, alternatives, desperation, face) => {
          const m = offerMargin(f, { alternatives, desperation, face });
          expect(m).toBeGreaterThanOrEqual(-0.1);
          expect(m).toBeLessThanOrEqual(0.4);
        },
      ),
    );
  });
  it("sin palancas no cambia nada", () => {
    expect(leverageShift(undefined)).toBe(0);
    expect(leverageShift(none)).toBe(0);
  });
});

describe("decideReply con propuestas", () => {
  const lines = (JSON.parse(readFileSync("content/speech/es.json", "utf8")) as unknown[]).map((l) =>
    SpeechLine.parse(l),
  );
  const f = (over: Partial<Vector> = {}): Vector => ({
    trust: 0.2,
    respect: 0,
    affection: 0.2,
    fear: 0,
    attraction: 0,
    gratitude: 0,
    jealousy: 0,
    resentment: 0,
    familiarity: 0.5,
    dependency: 0,
    ...over,
  });
  const reply = (text: string, over: Partial<ReplyInput> = {}, feel = f()) =>
    decideReply(
      {
        act: understand(text, lex),
        speaker: bruno,
        listener: ana,
        feel,
        direct: () => null,
        heard: [],
        nameOf: () => "Bruno",
        goodName: (g) => g,
        held: () => 100_000,
        members: 1,
        worth: (g) => PRICE[g] ?? null,
        speakerHas: () => 100_000,
        lines,
        rng: Rng.root(1),
        ...over,
      },
      0,
    );

  it("cierra un trato justo con el intercambio", () => {
    const r = reply("Te doy 1 kilo de sal por 1 kilo de grano");
    expect(r.line).toBe("offer.accept");
    expect(r.deal).toEqual({
      gets: { good: "salt", grams: 1000 },
      gives: { good: "grain", grams: 1000 },
    });
  });
  it("el rencor cierra el trato", () => {
    const r = reply("Te doy 1 kilo de sal por 1 kilo de grano", {}, f({ resentment: 0.8 }));
    expect(r.line).toBe("offer.refuse.grudge");
    expect(r.deal).toBeUndefined();
  });
  it("sin precio creído no tasa", () => {
    const r = reply("Te doy 1 kilo de sal por 1 kilo de grano", { worth: () => null });
    expect(r.line).toBe("offer.unvalued");
  });
  it("aceptar sin propuesta abierta no cierra nada; con una abierta, la cierra", () => {
    expect(reply("Trato hecho").line).toBe("answer.nothing");
    const open = { gets: { good: "salt", grams: 500 }, gives: { good: "grain", grams: 700 } };
    expect(reply("Trato hecho", { open }).deal).toEqual(open);
    expect(reply("No gracias", { open }).deal).toBeUndefined();
    expect(reply("No gracias", { open }).line).toBe("refuse.ack");
  });
  it("el regateo se cansa: tras varias rondas ya no contraofertan", () => {
    const cheap = "Te doy 1 kilo de grano por 1 kilo de grano";
    expect(reply(cheap).line).toBe("offer.counter");
    expect(reply(cheap, { rounds: MAX_ROUNDS }).line).toBe("offer.refuse.tired");
  });
  it("aceptar una contraoferta ya no vale si alguno dejó de tener lo prometido", () => {
    const open = { gets: { good: "salt", grams: 500 }, gives: { good: "grain", grams: 700 } };
    expect(reply("Trato hecho", { open }).deal).toEqual(open);
    expect(reply("Trato hecho", { open, speakerHas: () => 0 }).line).toBe("accept.short");
    expect(reply("Trato hecho", { open, held: () => 0 }).deal).toBeUndefined();
  });
  it("dealHolds respeta la reserva y lo que tiene quien acepta", () => {
    const deal = { gets: { good: "salt", grams: 500 }, gives: { good: "grain", grams: 700 } };
    expect(
      dealHolds(
        deal,
        () => 700,
        () => 500,
      ),
    ).toBe(true);
    expect(
      dealHolds(
        deal,
        () => 699,
        () => 500,
      ),
    ).toBe(false);
    expect(
      dealHolds(
        deal,
        () => 700,
        () => 499,
      ),
    ).toBe(false);
  });
  it("es determinista", () => {
    fc.assert(
      fc.property(fc.nat(), (seed) => {
        const a = reply("Te doy 1 kilo de sal por 1 kilo de grano", { rng: Rng.root(seed) });
        const b = reply("Te doy 1 kilo de sal por 1 kilo de grano", { rng: Rng.root(seed) });
        expect(a).toEqual(b);
      }),
    );
  });
});

describe("contraoferta con términos sueltos", () => {
  // El NPC recibiría 1 kilo de sal y daría 2 de grano.
  const open = { gets: { good: "salt", grams: 1000 }, gives: { good: "grain", grams: 2000 } };
  const loose = (text: string) => looseCounter(text, understand(text, lex), open, lex);
  it("«te doy la mitad» escala lo que da quien habla", () => {
    expect(loose("Te doy la mitad")).toEqual({
      kind: "offer",
      give: { good: "salt", grams: 500 },
      want: open.gives,
    });
  });
  it("«dame la mitad» escala lo que pide", () => {
    expect(loose("Dame la mitad")).toEqual({
      kind: "offer",
      give: open.gets,
      want: { good: "grain", grams: 1000 },
    });
  });
  it("«por lo mismo pero con grano» cambia el bien que da", () => {
    expect(loose("Por lo mismo pero con grano")).toEqual({
      kind: "offer",
      give: { good: "grain", grams: 1000 },
      want: open.gives,
    });
  });
  it("sin trato abierto o sin términos sueltos no toca nada", () => {
    const act = understand("Te doy la mitad", lex);
    expect(looseCounter("Te doy la mitad", act, undefined, lex)).toBe(act);
    const hi = understand("Hola", lex);
    expect(looseCounter("Hola", hi, open, lex)).toBe(hi);
  });
});

describe("alternativas y cara del regateo", () => {
  const house = (stock: number, members = 2) => ({ stock, members });
  it("comprando cuentan las casas con de sobra; vendiendo, las que les falta", () => {
    const houses = [house(9000), house(7000), house(1000)];
    expect(alternativesAmong(houses, "buy", 3000, 500)).toBeCloseTo(2 / 3);
    expect(alternativesAmong(houses, "sell", 3000, 500)).toBeCloseTo(1 / 3);
    expect(alternativesAmong([], "buy", 3000, 500)).toBe(0);
    expect(
      alternativesAmong([house(99999), house(99999), house(99999), house(99999)], "buy", 3000, 500),
    ).toBe(1);
  });
  it("la cara pesa con los testigos y baja ante quien tiene más rango", () => {
    expect(bargainFace(0, 1, 0)).toBe(0);
    expect(bargainFace(3, 1, 1)).toBe(1);
    expect(bargainFace(3, 0, 2)).toBe(0.5);
    expect(bargainFace(9, 5, 0)).toBe(1);
  });
});
