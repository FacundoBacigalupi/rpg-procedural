import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadContent } from "../../core/index.ts";
import { CONTENT_KINDS } from "../content.ts";
import {
  chainLimit,
  confidenceBand,
  type Fact,
  factKey,
  INFERENCE_CAP,
  INFERENCE_RULES,
  type Inference,
  infer,
  inferenceAccuracy,
  knownRules,
  type Premise,
  type Reasoner,
  thinkAbout,
  toRule,
} from "./inference.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "llm" ? [] : sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}

const content = loadContent(CONTENT_KINDS, sources("content"));
const DEFS = content.all(INFERENCE_RULES);
const DEFAULT_INFERENCE_RULES = DEFS.map(toRule);
const ALL = DEFS.map((r) => r.id);
const mind = (over: Partial<Reasoner> = {}): Reasoner => ({
  intellect: 0.7,
  rules: ALL,
  fatigue: 0,
  fear: 0,
  suspicion: 0.3,
  ...over,
});
const f = (pred: string, ...args: string[]): Fact => ({ pred, args });
const p = (
  fact: Fact,
  confidence: number,
  ref: string,
  kind: Premise["kind"] = "percept",
): Premise => ({
  fact,
  confidence,
  kind,
  ref,
});

const burglary: Premise[] = [
  p(f("entered", "ana", "house"), 0.9, "p1"),
  p(f("missing", "jade", "house"), 0.95, "p2"),
  p(f("owner", "jade", "luo"), 0.9, "m1", "memory"),
];
const find = (xs: readonly Inference[], fact: Fact) =>
  xs.find((i) => factKey(i.fact) === factKey(fact));

describe("inferir", () => {
  it("junta evidencia dispersa y cita de dónde salió", () => {
    const out = infer(burglary, DEFAULT_INFERENCE_RULES, mind());
    const took = find(out, f("took", "ana", "jade"));
    expect(took).toBeDefined();
    expect(took?.support).toEqual(["p1", "p2"]);
    expect(took?.chain).toEqual(["theft-from-access"]);
    expect(took?.depth).toBe(1);
    expect(took?.confidence).toBeLessThan(0.9);
  });

  it("encadena: del robo al agravio, citando toda la evidencia", () => {
    const out = infer(burglary, DEFAULT_INFERENCE_RULES, mind());
    const wronged = find(out, f("wronged", "luo", "ana"));
    expect(wronged?.depth).toBe(2);
    expect(wronged?.chain).toEqual(["theft-from-access", "grievance-from-theft"]);
    expect(wronged?.support).toEqual(["m1", "p1", "p2"]);
    expect(wronged?.confidence).toBeLessThan(find(out, f("took", "ana", "jade"))?.confidence ?? 0);
  });

  it("no repite lo que ya sabía ni inventa sin premisas", () => {
    const out = infer(burglary.slice(0, 1), DEFAULT_INFERENCE_RULES, mind());
    expect(out).toEqual([]);
    const known = [...burglary, p(f("took", "ana", "jade"), 0.9, "p3")];
    expect(
      find(infer(known, DEFAULT_INFERENCE_RULES, mind()), f("took", "ana", "jade")),
    ).toBeUndefined();
  });

  it("solo usa las reglas que conoce", () => {
    expect(infer(burglary, DEFAULT_INFERENCE_RULES, mind({ rules: [] }))).toEqual([]);
    const out = infer(burglary, DEFAULT_INFERENCE_RULES, mind({ rules: ["theft-from-access"] }));
    expect(out.map((i) => factKey(i.fact))).toEqual(["took(ana,jade)"]);
  });

  it("la inteligencia alarga la cadena y el cansancio fuerte la corta", () => {
    expect(chainLimit(mind({ intellect: 0.1 }))).toBe(1);
    expect(chainLimit(mind({ intellect: 0.9 }))).toBeGreaterThan(
      chainLimit(mind({ intellect: 0.1 })),
    );
    expect(chainLimit(mind({ intellect: 0.9, fatigue: 0.9 }))).toBe(
      chainLimit(mind({ intellect: 0.9 })) - 1,
    );
    const dull = infer(burglary, DEFAULT_INFERENCE_RULES, mind({ intellect: 0.1 }));
    expect(find(dull, f("wronged", "luo", "ana"))).toBeUndefined();
    expect(find(dull, f("took", "ana", "jade"))).toBeDefined();
  });

  it("el desconfiado acusa con más seguridad la misma evidencia", () => {
    const calm = find(
      infer(burglary, DEFAULT_INFERENCE_RULES, mind({ suspicion: 0 })),
      f("took", "ana", "jade"),
    );
    const wary = find(
      infer(burglary, DEFAULT_INFERENCE_RULES, mind({ suspicion: 1 })),
      f("took", "ana", "jade"),
    );
    expect(wary?.confidence).toBeGreaterThan(calm?.confidence ?? 1);
  });

  it("el miedo infla lo que asusta pero no lo neutro", () => {
    const smoke = [
      p(f("smoke_seen", "village"), 0.6, "p1"),
      p(f("lives_at", "me", "village"), 1, "m1", "memory"),
    ];
    const calm = infer(smoke, DEFAULT_INFERENCE_RULES, mind());
    const scared = infer(smoke, DEFAULT_INFERENCE_RULES, mind({ fear: 1 }));
    expect(find(scared, f("fire_at", "village"))?.confidence).toBeGreaterThan(
      find(calm, f("fire_at", "village"))?.confidence ?? 1,
    );
    const neutral = infer(
      burglary,
      DEFAULT_INFERENCE_RULES,
      mind({ rules: ["theft-from-access", "grievance-from-theft"], suspicion: 0.5 }),
    );
    const neutralScared = infer(
      burglary,
      DEFAULT_INFERENCE_RULES,
      mind({ rules: ["theft-from-access", "grievance-from-theft"], suspicion: 0.5, fear: 1 }),
    );
    // el agravio es neutro: su único cambio viene de la cadena (el robo sí se infla)
    expect(find(neutralScared, f("took", "ana", "jade"))?.confidence).toBeGreaterThan(
      find(neutral, f("took", "ana", "jade"))?.confidence ?? 1,
    );
  });

  it("una pista falsa lleva a una conclusión equivocada y segura", () => {
    // Ana nunca entró: un rumor falso dice que sí. El razonamiento es válido; la premisa, no.
    const planted = [
      p(f("entered", "ana", "house"), 0.9, "r1", "told"),
      p(f("missing", "jade", "house"), 0.95, "p2"),
    ];
    const out = infer(planted, DEFAULT_INFERENCE_RULES, mind({ suspicion: 0.9 }));
    const truth = (x: Fact) => (x.pred === "took" ? false : undefined);
    const acc = inferenceAccuracy(out, truth);
    expect(acc.wrong).toBe(1);
    expect(acc.confidentlyWrong).toBe(1);
  });

  it("dos sospechosos exclusivos compiten: gana el que se siente más fuerte y el otro queda de rival", () => {
    const meal = [
      p(f("sick", "luo"), 1, "p1"),
      p(f("ate_with", "luo", "ana"), 0.9, "p2"),
      p(f("ate_with", "luo", "bo"), 0.5, "p3"),
    ];
    const out = infer(meal, DEFAULT_INFERENCE_RULES, mind({ suspicion: 0.9 }));
    const poisoned = out.filter((i) => i.fact.pred === "poisoned_by");
    expect(poisoned).toHaveLength(1);
    expect(poisoned[0]?.fact.args).toEqual(["luo", "ana"]);
    expect(poisoned[0]?.rival?.fact.args).toEqual(["luo", "bo"]);
  });

  it("dos fuentes del mismo hecho se refuerzan", () => {
    const one = infer([p(f("smoke_seen", "v"), 0.5, "a")], DEFAULT_INFERENCE_RULES, mind());
    const two = infer(
      [p(f("smoke_seen", "v"), 0.5, "a"), p(f("smoke_seen", "v"), 0.5, "b", "told")],
      DEFAULT_INFERENCE_RULES,
      mind(),
    );
    expect(two[0]?.confidence).toBeGreaterThan(one[0]?.confidence ?? 1);
    expect(two[0]?.support).toEqual(["a", "b"]);
  });

  it("pensar sobre un tema filtra, ordena y pone la banda", () => {
    const out = infer(burglary, DEFAULT_INFERENCE_RULES, mind());
    const t = thinkAbout(out, "ana");
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.fact.args.includes("ana"))).toBe(true);
    expect(thinkAbout(out, "nadie")).toEqual([]);
    expect(confidenceBand(0.8)).toBe("convinced");
    expect(confidenceBand(0.5)).toBe("likely");
    expect(confidenceBand(0.3)).toBe("maybe");
    expect(confidenceBand(0.1)).toBe("hunch");
  });
});

const reasonerArb = fc.record({
  intellect: fc.double({ min: 0, max: 1, noNaN: true }),
  rules: fc.subarray(ALL),
  fatigue: fc.double({ min: 0, max: 1, noNaN: true }),
  fear: fc.double({ min: 0, max: 1, noNaN: true }),
  suspicion: fc.double({ min: 0, max: 1, noNaN: true }),
});
const confArb = fc.double({ min: 0, max: 1, noNaN: true });

describe("propiedades", () => {
  it("el orden de la evidencia no cambia nada (determinismo)", () => {
    fc.assert(
      fc.property(
        reasonerArb,
        fc.array(confArb, { minLength: 3, maxLength: 3 }),
        fc.nat(5),
        (who, cs, k) => {
          const ev = burglary.map((e, i) => ({ ...e, confidence: cs[i] ?? 0.5 }));
          const rotated = [...ev.slice(k % 3), ...ev.slice(0, k % 3)];
          expect(infer(rotated, DEFAULT_INFERENCE_RULES, who)).toEqual(
            infer(ev, DEFAULT_INFERENCE_RULES, who),
          );
        },
      ),
    );
  });

  it("toda conclusión está en (0, tope], cita evidencia real y no excede la cadena", () => {
    fc.assert(
      fc.property(reasonerArb, confArb, confArb, (who, a, b) => {
        const ev = [
          ...burglary,
          p(f("sick", "luo"), a, "s1"),
          p(f("ate_with", "luo", "ana"), b, "s2"),
          p(f("smoke_seen", "house"), a, "s3"),
          p(f("lives_at", "ana", "house"), b, "s4"),
        ];
        const refs = new Set(ev.map((e) => e.ref));
        for (const i of infer(ev, DEFAULT_INFERENCE_RULES, who)) {
          expect(i.confidence).toBeGreaterThan(0);
          expect(i.confidence).toBeLessThanOrEqual(INFERENCE_CAP);
          expect(i.support.length).toBeGreaterThan(0);
          for (const r of i.support) expect(refs.has(r)).toBe(true);
          expect(i.depth).toBeLessThanOrEqual(chainLimit(who));
          expect(i.chain.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("sin evidencia no hay conclusiones", () => {
    fc.assert(
      fc.property(reasonerArb, (who) => {
        expect(infer([], DEFAULT_INFERENCE_RULES, who)).toEqual([]);
      }),
    );
  });
});

describe("reglas como contenido", () => {
  it("cargan, y toda variable de la conclusión sale de las premisas", () => {
    expect(DEFS.length).toBeGreaterThanOrEqual(5);
    for (const d of DEFS) {
      const bound = new Set(d.premises.flatMap((q) => q.args));
      for (const a of d.conclusion.args) if (a.startsWith("?")) expect(bound.has(a)).toBe(true);
    }
  });

  it("cada quien conoce según su saber y su mentalidad", () => {
    const none = knownRules(DEFS, { skills: {}, schemas: {} });
    expect(none).toContain("fire-from-smoke");
    expect(none).not.toContain("poison-from-meal");
    const healer = knownRules(DEFS, { skills: { medicine: 0.5 }, schemas: {} });
    expect(healer).toContain("poison-from-meal");
    const wary = knownRules(DEFS, { skills: {}, schemas: { people_are_untrustworthy: 0.8 } });
    expect(wary).toContain("poison-from-meal");
    const weak = knownRules(DEFS, { skills: { medicine: 0.1 }, schemas: {} });
    expect(weak).not.toContain("poison-from-meal");
  });

  it("las reglas de oficio las conoce solo quien tiene el oficio o la mentalidad", () => {
    const none = knownRules(DEFS, { skills: {}, schemas: {} });
    for (const id of [
      "picked-lock-from-clean-entry",
      "blade-from-clean-wound",
      "passage-from-fresh-tracks",
      "plot-from-foreknowledge",
    ]) {
      expect(none).not.toContain(id);
    }
    expect(knownRules(DEFS, { skills: { sleight: 0.5 }, schemas: {} })).toContain(
      "picked-lock-from-clean-entry",
    );
    expect(knownRules(DEFS, { skills: { medicine: 0.5 }, schemas: {} })).toContain(
      "blade-from-clean-wound",
    );
    expect(knownRules(DEFS, { skills: { observation: 0.5 }, schemas: {} })).toContain(
      "passage-from-fresh-tracks",
    );
    expect(knownRules(DEFS, { skills: {}, schemas: { people_are_untrustworthy: 0.9 } })).toContain(
      "plot-from-foreknowledge",
    );
  });

  it("es monótono en el saber y no depende del orden", () => {
    fc.assert(
      fc.property(fc.nat(100), fc.nat(100), (a, b) => {
        const lo = Math.min(a, b) / 100;
        const hi = Math.max(a, b) / 100;
        const low = new Set(knownRules(DEFS, { skills: { medicine: lo }, schemas: {} }));
        const high = new Set(knownRules(DEFS, { skills: { medicine: hi }, schemas: {} }));
        for (const id of low) expect(high.has(id)).toBe(true);
        expect(knownRules([...DEFS].reverse(), { skills: { medicine: hi }, schemas: {} })).toEqual(
          [...high].sort(),
        );
      }),
    );
  });
});
