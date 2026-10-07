import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type DraftPlanNode,
  IntentDraft,
  intentDraftJsonSchema,
  type RefDescription,
} from "./index.ts";

const key = fc.constantFrom("walk", "take", "talk", "covert", "careful", "target", "to", "steal");
const words = fc.constantFrom("el viejo", "la herrería", "mi espada", "té verde", "la puerta");
const opt = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });

/** Sin claves `undefined`, como llega del JSON del modelo. */
function clean<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

const { ref } = fc.letrec<{ ref: RefDescription }>((tie) => ({
  ref: fc.record({
    text: words,
    kind: opt(fc.constantFrom("person" as const, "object" as const, "place" as const)),
    features: fc.array(words, { maxLength: 3 }),
    relation: opt(
      fc.record({
        to: fc.oneof({ depthSize: "small" }, fc.constant("self" as const), tie("ref")),
        rel: fc.constantFrom("de", "mi"),
      }),
    ),
    quantity: opt(
      fc.oneof(
        fc.record({ kind: fc.constant("count" as const), n: fc.integer({ min: 1, max: 9 }) }),
        fc.constant({ kind: "all" as const }),
      ),
    ),
  }),
}));

const cond = fc.record({
  kind: fc.constantFrom("belief" as const, "percept" as const, "time" as const, "self" as const),
  text: fc.constantFrom("si nadie mira", "hasta que anochezca"),
});

const { node } = fc.letrec<{ node: DraftPlanNode }>((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.record({
      kind: fc.constant("do" as const),
      verb: key,
      args: fc.array(fc.record({ role: key, ref }), { maxLength: 2 }),
      manner: opt(fc.array(key, { maxLength: 2 })),
    }),
    fc.record({
      kind: fc.constant("seq" as const),
      steps: fc.array(tie("node"), { minLength: 1, maxLength: 3 }),
    }),
    fc.record({ kind: fc.constant("until" as const), body: tie("node"), cond }),
    fc.record({
      kind: fc.constant("repeat" as const),
      body: tie("node"),
      times: opt(fc.integer({ min: 1, max: 5 })),
    }),
    fc.record({
      kind: fc.constant("if" as const),
      cond,
      // biome-ignore lint/suspicious/noThenProperty: el nodo `if` del plan
      then: tie("node"),
      else: opt(tie("node")),
    }),
    fc.record({ kind: fc.constant("onEvent" as const), trigger: cond, react: tie("node") }),
  ),
}));

const draft = fc
  .record({
    kind: fc.constantFrom("act" as const, "plan" as const),
    plan: node,
    manner: opt(fc.array(key, { maxLength: 2 })),
    stripped: opt(fc.array(fc.constant("y lo convenzo"), { maxLength: 1 })),
    speech: opt(fc.record({ text: fc.constant("¿Viste a mi hermana?"), to: opt(ref) })),
  })
  .map(clean);

describe("IntentDraft", () => {
  it("acepta borradores al azar (planes anidados, referencias con relación) y vuelven iguales por JSON", () => {
    fc.assert(
      fc.property(draft, (d) => {
        const parsed = IntentDraft.parse(d);
        expect(parsed).toEqual(d);
        expect(IntentDraft.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
      }),
    );
  });

  it("metas, preguntas y comandos llevan texto y no plan", () => {
    expect(IntentDraft.parse({ kind: "goal", text: "quiero volverme inmortal" }).kind).toBe("goal");
    expect(() => IntentDraft.parse({ kind: "question_ooc" })).toThrow(/text/);
    expect(() =>
      IntentDraft.parse({
        kind: "meta",
        text: "guardar",
        plan: { kind: "do", verb: "walk", args: [] },
      }),
    ).toThrow(/no lleva plan/);
  });

  it("un acto necesita plan o habla", () => {
    expect(() => IntentDraft.parse({ kind: "act" })).toThrow(/plan o habla/);
    expect(IntentDraft.parse({ kind: "act", speech: { text: "Hola" } }).speech?.text).toBe("Hola");
  });

  it("no acepta ids reales, campos inventados ni verbos que no son claves", () => {
    const base = { kind: "act", plan: { kind: "do", verb: "take", args: [] } };
    expect(IntentDraft.safeParse(base).success).toBe(true);
    expect(IntentDraft.safeParse({ ...base, outcome: "success" }).success).toBe(false);
    expect(
      IntentDraft.safeParse({ ...base, plan: { kind: "do", verb: "Tomar la espada", args: [] } })
        .success,
    ).toBe(false);
    expect(
      IntentDraft.safeParse({
        ...base,
        plan: { kind: "do", verb: "take", args: [{ role: "target", ref: { id: "agent:3" } }] },
      }).success,
    ).toBe(false);
  });

  it("el JSON Schema restringe lo mismo: objetos cerrados, tipos de intención y nodos recursivos", () => {
    const s = intentDraftJsonSchema();
    expect(s["additionalProperties"]).toBe(false);
    const props = s["properties"] as Record<string, { enum?: string[] }>;
    expect(props["kind"]?.enum).toEqual(["act", "plan", "goal", "question_ooc", "meta"]);
    const text = JSON.stringify(s);
    expect(text).toContain('"$ref":"#/$defs/');
    for (const k of ["do", "seq", "until", "repeat", "if", "onEvent", "template"]) {
      expect(text).toContain(`"const":"${k}"`);
    }
    // Determinista: el mismo esquema en cada llamada (va en el prefijo cacheado).
    expect(JSON.stringify(intentDraftJsonSchema())).toBe(text);
  });
});
