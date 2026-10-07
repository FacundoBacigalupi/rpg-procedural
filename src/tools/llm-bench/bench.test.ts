import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockLLM, parserSetup } from "../../llm/index.ts";
import { loadContentDir } from "../../persistence/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  CONTENT_KINDS,
  type IntentDraft,
  PARSER_EXAMPLES,
  PLANS,
} from "../../sim/index.ts";
import {
  benchCases,
  benchModel,
  benchSwap,
  formatSummaries,
  NARRATION_PROBE,
  type ParserFixture,
} from "./bench.ts";
import { scoreDraft } from "./score.ts";

const content = loadContentDir("content", CONTENT_KINDS);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const examples = content.all(PARSER_EXAMPLES);
const setup = parserSetup(catalog, examples);
const cases = benchCases(examples);

/** Un reloj que avanza 10 ms por lectura, para que la latencia sea determinista. */
function clock(step = 10): () => number {
  let t = 0;
  return () => {
    t += step;
    return t;
  };
}

/** Contesta lo esperado para cada caso, buscando el texto del jugador en el último mensaje. */
function oracle(name = "oracle"): MockLLM {
  return new MockLLM((req) => {
    if (req === NARRATION_PROBE) return "La plaza está en silencio.";
    const last = req.messages.at(-1)?.content ?? "";
    const e = examples.find((x) => last.endsWith(`Player: ${x.text}`));
    return JSON.stringify(e?.expect ?? {});
  }, name);
}

const find = (id: string): IntentDraft => {
  const e = examples.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e.expect;
};

describe("scoreDraft", () => {
  it("el borrador esperado contra sí mismo pasa en todos los campos", () => {
    for (const e of examples) expect(scoreDraft(e.expect, e.expect).pass, e.id).toBe(true);
  });

  it("act y plan cuentan igual; otro verbo falla en los pasos", () => {
    const want = find("shot-move");
    expect(scoreDraft(want, { ...want, kind: "plan" }).kind).toBe(true);
    const other: IntentDraft = { kind: "act", plan: { kind: "do", verb: "look", args: [] } };
    const s = scoreDraft(want, other);
    expect(s).toMatchObject({ steps: false, roles: false, refs: false, pass: false });
  });

  it("una referencia sin los rasgos que la distinguen falla en refs", () => {
    const want = find("shot-move");
    const plan = want.plan;
    if (plan?.kind !== "do") throw new Error("shot-move es un do");
    const vague: IntentDraft = {
      ...want,
      plan: {
        ...plan,
        args: plan.args.map((a) =>
          "ref" in a ? { ...a, ref: { text: "allá", kind: a.ref.kind, features: [] } } : a,
        ),
      },
    };
    expect(scoreDraft(want, vague)).toMatchObject({ steps: true, roles: true, refs: false });
  });

  it("olvidarse de descartar un resultado declarado se nota", () => {
    const want = examples.find((e) => e.expect.stripped)?.expect;
    if (!want) throw new Error("falta un ejemplo con stripped");
    const { stripped: _, ...rest } = want;
    expect(scoreDraft(want, rest).stripped).toBe(false);
  });
});

describe("benchModel", () => {
  it("un modelo que contesta lo esperado pasa todo al primer intento", async () => {
    const { results, summary } = await benchModel({
      client: oracle(),
      setup,
      examples: cases,
      now: clock(),
    });
    expect(results).toHaveLength(cases.length);
    expect(summary).toMatchObject({
      cases: cases.length,
      valid: cases.length,
      firstTry: cases.length,
      pass: cases.length,
      coldMs: 10,
      msP50: 10,
    });
    expect(results.every((r) => r.raw.length === 1)).toBe(true);
    expect(formatSummaries([summary])).toMatch(/^model\s+valid.*\noracle\s+100%/);
  });

  it("basura cae a las plantillas después de regenerar, y queda grabada", async () => {
    const m = new MockLLM(() => "no sé", "junk");
    const { results, summary } = await benchModel({
      client: m,
      setup,
      examples: cases.slice(0, 3),
      now: clock(),
    });
    expect(summary).toMatchObject({ valid: 0, pass: 0 });
    expect(results[0]).toMatchObject({ ok: false, attempts: 2, raw: ["no sé", "no sé"] });
  });

  it("sin restringir, el pedido no lleva esquema y el nombre lo dice", async () => {
    const m = oracle();
    const r = await benchModel({
      client: m,
      setup,
      examples: cases.slice(0, 1),
      now: clock(),
      grammar: false,
    });
    expect(r.summary.model).toBe("oracle (free)");
    expect(m.calls.every((c) => c.schema === undefined)).toBe(true);
  });
});

describe("benchSwap", () => {
  it("alterna narrar con el residente y parsear, y mide la diferencia", async () => {
    const resident = oracle("big");
    const parser = oracle("small");
    const s = await benchSwap({
      resident,
      parser,
      setup,
      examples: cases.slice(0, 4),
      now: clock(),
    });
    expect(s).toMatchObject({
      resident: "big",
      parser: "small",
      samePass: 4,
      swapPass: 4,
      penaltyMs: 0,
    });
    // 4 narraciones y 4 parseos con el mismo; 4 narraciones más con el residente en el cambio.
    expect(resident.calls).toHaveLength(12);
    expect(parser.calls).toHaveLength(4);
  });
});

describe("fixtures grabadas", () => {
  const dir = "test/fixtures/parser";
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];

  it.skipIf(files.length === 0)("repetir lo grabado da el mismo resultado sin red", async () => {
    for (const f of files) {
      const fx = JSON.parse(readFileSync(join(dir, f), "utf8")) as ParserFixture;
      const byId = new Map(fx.cases.map((c) => [c.id, c]));
      const kept = cases.filter((c) => byId.has(c.id));
      // El primer caso corre dos veces: una en frío y otra con el resto.
      const raw = [kept[0], ...kept].flatMap((c) => (c ? (byId.get(c.id)?.raw ?? []) : []));
      const { results } = await benchModel({
        client: new MockLLM(raw, fx.model),
        setup,
        examples: kept,
        now: clock(),
      });
      for (const r of results) {
        // Un contenido distinto puede volver inválido lo grabado; nunca lo contrario sin regrabar.
        if (fx.contentHash === content.hash)
          expect(r.score?.pass ?? false, `${f} ${r.id}`).toBe(byId.get(r.id)?.pass);
      }
    }
  });
});
