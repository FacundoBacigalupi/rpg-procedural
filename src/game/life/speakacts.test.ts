import { describe, expect, it } from "vitest";
import {
  type Acquaintance,
  requestWant,
  type SpeakActsOptions,
  speakActCandidates,
  speakActsDefaults,
} from "./speakacts.ts";

const o: SpeakActsOptions = { minFamiliarity: 0.3, quietSeconds: 1000, weight: 0.4, chance: 0.9 };
const p = (id: string, over: Partial<Acquaintance> = {}): Acquaintance => ({
  id,
  familiarity: 0.8,
  affection: 0.5,
  updated: 0,
  whereaboutsKnown: true,
  ...over,
});

describe("speak con acto declarado", () => {
  it("saluda a quien conoce y no trata hace tiempo, con ánimo desde afecto y familiaridad", () => {
    const [c, ...rest] = speakActCandidates([p("agent:2")], 5000, o);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({
      id: "speak:agent:2",
      verb: "speak",
      target: "agent:2",
      act: { kind: "greet" },
      mood: 0.26,
      chance: 0.9,
    });
  });

  it("no saluda a un desconocido, a quien trató hace poco ni a quien le cae mal", () => {
    expect(speakActCandidates([p("agent:2", { familiarity: 0.1 })], 5000, o)).toEqual([]);
    expect(speakActCandidates([p("agent:2", { updated: 4500 })], 5000, o)).toEqual([]);
    expect(speakActCandidates([p("agent:2", { affection: -0.5 })], 5000, o)).toEqual([]);
  });

  it("pregunta por el querido de quien no sabe dónde está, y no a él mismo", () => {
    const out = speakActCandidates(
      [p("agent:2"), p("agent:3", { whereaboutsKnown: false, updated: 4900 })],
      5000,
      o,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "speak:agent:2",
      act: { kind: "ask", about: "agent:3" },
    });
  });

  it("no vuelve a preguntarle a quien trató hace poco", () => {
    const people = [
      p("agent:2", { updated: 4900 }),
      p("agent:3", { whereaboutsKnown: false, updated: 4900 }),
    ];
    expect(speakActCandidates(people, 5000, o)).toEqual([]);
  });

  it("orden fijo por id, sin repetir un conocido", () => {
    const out = speakActCandidates([p("agent:9"), p("agent:2")], 5000, o);
    expect(out.map((c) => c.id)).toEqual(["speak:agent:2", "speak:agent:9"]);
  });

  it("promete devolver lo que cree deber, con prioridad sobre pedir, contar y saludar", () => {
    const [c] = speakActCandidates([p("agent:2", { owes: "coin:copper" })], 5000, o, {
      want: { what: null, urgency: 1 },
      news: [{ about: "agent:7", claim: "dead" }],
    });
    expect(c).toMatchObject({ act: { kind: "promise", what: "coin:copper" }, mood: 0.33 });
  });

  it("pide lo que le falta solo con urgencia y afecto suficientes", () => {
    const want = { what: "grano", urgency: 0.8 };
    expect(speakActCandidates([p("agent:2")], 5000, o, { want })[0]).toMatchObject({
      act: { kind: "request", what: "grano" },
      mood: 0.16,
    });
    const quiet = { ...o, quietSeconds: 99999 };
    expect(
      speakActCandidates([p("agent:2")], 5000, quiet, { want: { ...want, urgency: 0.2 } }),
    ).toEqual([]);
    expect(speakActCandidates([p("agent:2", { affection: 0.1 })], 5000, quiet, { want })).toEqual(
      [],
    );
  });

  it("cuenta la noticia de un tercero a quien no ve hace tiempo, y no a su protagonista", () => {
    const news = [{ about: "agent:2", claim: "dead" as const }];
    const out = speakActCandidates([p("agent:2"), p("agent:3")], 5000, o, { news });
    expect(out.find((c) => c.id === "speak:agent:3")?.act).toEqual({
      kind: "tell",
      about: "agent:2",
      claim: "dead",
    });
    expect(out.find((c) => c.id === "speak:agent:2")?.act).toEqual({ kind: "greet" });
    expect(speakActCandidates([p("agent:3", { updated: 4900 })], 5000, o, { news })).toEqual([]);
  });

  it("pide un bien concreto solo si la despensa de su casa no alcanza", () => {
    const goods = [{ id: "grain", name: "grano", form: "good" }];
    const w = { ...o, requestWhat: "grano" };
    expect(requestWant(o, 0.7, [], goods)).toEqual({ what: null, urgency: 0.7 });
    expect(requestWant(w, 0.7, [], goods)).toEqual({ what: "grano", urgency: 0.7 });
    expect(requestWant(w, 0.7, [{ unit: "good:grain", amount: 400 }], goods).urgency).toBe(0.7);
    expect(requestWant(w, 0.7, [{ unit: "good:grain", amount: 1500 }], goods).urgency).toBe(0);
  });

  it("los valores por defecto medidos: silencio de un día y peso 0,4", () => {
    expect(speakActsDefaults(86_400)).toEqual({
      minFamiliarity: 0.3,
      quietSeconds: 86_400,
      weight: 0.4,
      chance: 0.9,
    });
  });
});
