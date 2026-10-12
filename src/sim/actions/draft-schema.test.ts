import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadContent } from "../../core/index.ts";
import { TRAITS } from "../family/index.ts";
import { SKILLS } from "../skills/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  type DraftPlanNode,
  draftCatalogProblems,
  type IntentDraft,
  intentDraftFor,
  intentDraftJsonSchemaFor,
  PARSER_EXAMPLES,
  PLANS,
  structuralDraftFor,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS, PARSER_EXAMPLES],
  (
    [
      ["actions", "content/actions/core.json"],
      ["plans", "content/plans/steal.json"],
      ["skills", "content/skills/core.json"],
      ["traits", "content/traits/human.json"],
      ["llm/parser-examples", "content/llm/parser-examples/core.json"],
    ] as const
  ).map(([kind, file]) => ({ kind, file, data: json(file) })),
);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const examples = content.all(PARSER_EXAMPLES);
const checked = intentDraftFor(catalog);
const structural = structuralDraftFor(catalog);

const moveTo = (args: unknown[], manner?: string[]): unknown => ({
  kind: "act",
  plan: { kind: "do", verb: "move", args, ...(manner ? { manner } : {}) },
});
const forest = { text: "el bosque", kind: "place", features: ["bosque"] };

/** Borradores bien formados para el esquema genérico que el catálogo tiene que rechazar. */
const BAD: readonly [string, unknown, RegExp][] = [
  ["verbo inventado", { kind: "act", plan: { kind: "do", verb: "fly", args: [] } }, /unknown verb/],
  ["rol inventado", moveTo([{ role: "where", ref: forest }]), /no role "where"/],
  ["texto donde va una referencia", moveTo([{ role: "to", text: "al bosque" }]), /takes a ref/],
  [
    "rol repetido",
    moveTo([
      { role: "to", ref: forest },
      { role: "to", ref: forest },
    ]),
    /twice/,
  ],
  ["modo de otro verbo", moveTo([{ role: "to", ref: forest }], ["loud"]), /no manner "loud"/],
  [
    "onEvent todavía no",
    {
      kind: "plan",
      plan: {
        kind: "onEvent",
        trigger: { kind: "time", text: "si anochece", is: { kind: "dark" } },
        react: { kind: "do", verb: "look", args: [] },
      },
    },
    /not available/,
  ],
  [
    "repeat sin cuántas veces",
    { kind: "plan", plan: { kind: "repeat", body: { kind: "do", verb: "look", args: [] } } },
    /say how many times/,
  ],
  [
    "if con una condición sin normalizar",
    {
      kind: "plan",
      plan: {
        kind: "if",
        cond: { kind: "time", text: "si se me da la gana" },
        // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
        then: { kind: "do", verb: "look", args: [] },
      },
    },
    /say which condition/,
  ],
  [
    "plantilla sin su parámetro",
    { kind: "act", plan: { kind: "template", template: "steal", params: {} } },
    /needs "victim"/,
  ],
  [
    "riesgos que no existen",
    { kind: "act", plan: { kind: "do", verb: "look", args: [] }, risksAccepted: ["death"] },
    /no risks/,
  ],
];

function verbsOf(node: DraftPlanNode | undefined): string[] {
  if (!node) return [];
  switch (node.kind) {
    case "do":
      return [node.verb];
    case "seq":
      return node.steps.flatMap(verbsOf);
    case "until":
      return verbsOf(node.body);
    case "template":
      return [`template:${node.template}`];
    default:
      return [];
  }
}

describe("el borrador según el catálogo", () => {
  it("todos los ejemplos del parser pasan los dos esquemas", () => {
    expect(examples.length).toBeGreaterThanOrEqual(30);
    for (const e of examples) {
      expect(draftCatalogProblems(e.expect, catalog), e.id).toEqual([]);
      expect(checked.safeParse(e.expect).success, e.id).toBe(true);
      expect(structural.safeParse(e.expect).success, e.id).toBe(true);
    }
  });

  it("los ejemplos cubren cada verbo, cada plantilla y cada tipo de intención", () => {
    const used = new Set(examples.flatMap((e) => verbsOf(e.expect.plan)));
    if (examples.some((e) => e.expect.speech)) used.add("speak");
    for (const v of catalog.verbs) expect(used, v.id).toContain(v.id);
    for (const t of catalog.templates) expect(used, t.id).toContain(`template:${t.id}`);
    const kinds = new Set(examples.map((e) => e.expect.kind));
    expect([...kinds].sort()).toEqual(["act", "goal", "meta", "plan", "question_ooc"]);
    expect(examples.some((e) => e.expect.stripped)).toBe(true);
    expect(examples.some((e) => e.expect.unmapped)).toBe(true);
  });

  it.each(BAD)("rechaza %s con los dos esquemas y un mensaje claro", (_, draft, message) => {
    const r = checked.safeParse(draft);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join("\n")).toMatch(message);
    expect(structural.safeParse(draft).success).toBe(false);
  });

  it("la salida restringida pide lo que el genérico deja opcional: la clase y la condición", () => {
    const noKind = moveTo([{ role: "to", ref: { text: "el bosque", features: ["bosque"] } }]);
    const wrongKind = moveTo([{ role: "to", ref: { ...forest, kind: "person" } }]);
    const noIs = {
      kind: "plan",
      plan: {
        kind: "until",
        body: { kind: "do", verb: "wait", args: [] },
        cond: { kind: "time", text: "hasta que anochezca" },
      },
    };
    expect(checked.safeParse(noKind).success).toBe(true);
    for (const d of [noKind, wrongKind, noIs]) expect(structural.safeParse(d).success).toBe(false);
  });

  it("repeat e if ejecutables pasan también el esquema restringido del modelo", () => {
    const look = { kind: "do", verb: "look", args: [] };
    const conditional = {
      kind: "if",
      cond: { kind: "time", text: "de noche", is: { kind: "dark" } },
      // biome-ignore lint/suspicious/noThenProperty: rama del nodo if, no es una promesa
      then: look,
      else: { kind: "do", verb: "wait", args: [] },
    };
    for (const plan of [
      { kind: "repeat", times: 2, body: look },
      conditional,
      { kind: "repeat", times: 3, body: conditional },
    ]) {
      const draft = { kind: "plan", plan };
      expect(checked.safeParse(draft).success).toBe(true);
      expect(structural.safeParse(draft).success).toBe(true);
    }
  });

  it("ambos esquemas rechazan repeat fuera de límites, intervalos y if sin condición", () => {
    const look = { kind: "do", verb: "look", args: [] };
    const invalidPlans = [
      { kind: "repeat", times: 0, body: look },
      { kind: "repeat", times: 1001, body: look },
      { kind: "repeat", times: 1.5, body: look },
      { kind: "repeat", times: 2, every: { amount: 1, unit: "minute" }, body: look },
      {
        kind: "if",
        // biome-ignore lint/suspicious/noThenProperty: rama del nodo if, no es una promesa
        then: look,
      },
    ];
    for (const plan of invalidPlans) {
      const draft = { kind: "plan", plan };
      expect(checked.safeParse(draft).success).toBe(false);
      expect(structural.safeParse(draft).success).toBe(false);
    }
  });

  it("el JSON Schema sale del esquema estructural y es determinista", () => {
    const a = JSON.stringify(intentDraftJsonSchemaFor(catalog));
    const b = JSON.stringify(
      intentDraftJsonSchemaFor(new ActionCatalog(catalog.verbs, catalog.templates)),
    );
    expect(a).toBe(b);
    expect(a).toContain('"const":"take"');
    // Tope de tamaño del esquema que ve el modelo: 22 000, 23 000 con el acto de habla, 25 000 con `consult`, 26 000 con `purpose` 27 000 con `consume` 27 500 con `filter` 29 000 con `forge` y 31 000 con `hire`.
    // repeat e if agregan variantes recursivas y la condición normalizada: 31 583 caracteres.
    expect(a.length).toBeLessThan(32_000);
  });

  it("sin el catálogo, un borrador ajeno pasa el genérico (por eso el control existe)", () => {
    const draft = { kind: "act", plan: { kind: "do", verb: "fly", args: [] } } as IntentDraft;
    expect(draftCatalogProblems(draft, catalog)).toHaveLength(1);
  });
});
