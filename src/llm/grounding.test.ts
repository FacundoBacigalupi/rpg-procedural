import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentKind, type EntityRef, makeId, Rng, z } from "../core/index.ts";
import {
  ACTION_WORDS,
  type Acquaintance,
  buildPlayerView,
  NARRATION_TEMPLATES,
  type PlayerView,
  type ViewInput,
} from "../game/index.ts";
import { ACTIONS, type Percept } from "../sim/index.ts";
import {
  ActionWordBook,
  DEFAULT_NARRATION,
  groundingProblems,
  LLM_JOBS,
  LlmConfig,
  LlmJobs,
  type LlmProvider,
  MockLLM,
  narrate,
  narrationRequest,
  renderView,
  styleOf,
  TemplateBook,
  validateNarration,
} from "./index.ts";

function load<T extends { readonly id: string }>(kind: ContentKind<T>): T[] {
  const dir = join("content", kind.name);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => z.array(kind.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

const book = new TemplateBook(load(NARRATION_TEMPLATES));
const words = new ActionWordBook(load(ACTION_WORDS));
const style = styleOf(DEFAULT_NARRATION, "es");

const player = makeId("agent", 1);
const mother = makeId("agent", 2);
const other = makeId("agent", 3);
const acquaintances = new Map<EntityRef, Acquaintance>([
  [mother, { name: "Lan", relation: "madre" }],
  [other, { relation: "vecino" }],
]);
const field = (value: unknown, confidence = 0.95) => ({ value, confidence, mistaken: false });

function percept(
  fields: Percept["fields"],
  detail: Percept["detail"],
  n: number,
  source: EntityRef = other,
): Percept {
  return {
    id: `p${n}`,
    observer: player,
    sourceEntityId: source,
    tick: n,
    channels: n % 2 === 0 ? ["sight"] : ["sound"],
    detail,
    fields,
  };
}

function viewOf(over: Partial<ViewInput> = {}): PlayerView {
  return buildPlayerView({
    player,
    scene: {
      placeKinds: ["village"],
      space: "street",
      indoor: false,
      home: false,
      familiar: false,
      hour: 9,
      light: 0.8,
    },
    percepts: [],
    steps: [],
    acquaintances,
    ...over,
  });
}

/** Un chico que el personaje no reconoce, visto juntando algo: el caso de la prueba con Qwen. */
const gathering = viewOf({
  percepts: [
    percept(
      {
        presence: field(true),
        figure: field({ sex: "male", age: "youth" }),
        action: field("action.gather"),
      },
      "clear",
      2,
    ),
  ],
});
const request = narrationRequest(gathering, style);
const check = (text: string) => groundingProblems(text, request, words);

describe("el léxico de acciones", () => {
  it("cada verbo del catálogo y los eventos que se ven tienen palabras", () => {
    for (const a of load(ACTIONS)) expect(words.has(a.id), a.id).toBe(true);
    for (const id of ["body.died", "family.birth"]) expect(words.has(id), id).toBe(true);
    expect(words.has("state")).toBe(false);
    expect(words.kindOf("state")).toBe("state");
  });

  it("no repite ids", () => {
    expect(() => new ActionWordBook([...load(ACTION_WORDS), ...load(ACTION_WORDS)])).toThrow();
  });
});

describe("plantillas", () => {
  it("cada línea de cada acción vista se sostiene a sí misma", () => {
    for (const a of [...load(ACTIONS).map((x) => x.id), "body.died", "family.birth"]) {
      const view = viewOf({
        percepts: [
          percept(
            { presence: field(true), identity: field(other), action: field(a) },
            "identified",
            2,
          ),
        ],
      });
      const req = narrationRequest(view, style);
      for (const line of book.lines(`percept.action.${a}`)) {
        const text = line.replace("{who}", "{{e1|tu vecino}}");
        expect(groundingProblems(text, req, words), `${a}: ${text}`).toEqual([]);
      }
    }
  });

  it("lo que arman las plantillas para percepts sueltos y mezclados pasa, en varias claves", () => {
    const verbs = load(ACTIONS).map((a) => a.id);
    const views: PlayerView[] = [
      viewOf({ percepts: [percept({ presence: field(true, 0.3) }, "vague", 1)] }),
      viewOf({ percepts: [percept({ presence: field(true, 0.3) }, "vague", 2)] }),
      viewOf({
        percepts: [
          percept(
            { presence: field(true), identity: field(mother), words: field("Busco a mi hermano") },
            "identified",
            3,
            mother,
          ),
        ],
      }),
      ...verbs.map((verb, k) =>
        viewOf({
          percepts: [
            percept(
              {
                presence: field(true),
                figure: field({ sex: k % 2 ? "male" : "female", age: "youth" }),
                action: field(`action.${verb}`),
              },
              "clear",
              10 + k,
            ),
            percept(
              {
                presence: field(true),
                identity: field(mother),
                action: field(verbs[(k + 3) % verbs.length]),
              },
              "identified",
              40 + k,
              mother,
            ),
          ],
          steps: [
            {
              verb: "speak",
              self: {
                believed: "success",
                cues: [],
                effect: { kind: "speak", to: null, delivered: true, clarity: 1, text: "Hola" },
              },
            },
          ],
        }),
      ),
    ];
    for (const [n, view] of views.entries()) {
      const req = narrationRequest(view, style);
      for (const seed of [1, 2, 3]) {
        const marked = renderView(view, book, Rng.root(seed).fork("narration", n));
        expect(groundingProblems(marked, req, words), `${n}/${seed}: ${marked}`).toEqual([]);
      }
    }
  });
});

describe("groundingProblems", () => {
  it("acepta la salida fiel de Qwen (recoge del suelo; lo que el personaje hace es suyo)", () => {
    const qwen =
      "Ves a {{e1|un chico de aspecto familiar}}, que se agacha para recoger algo en el suelo. Lo mirás con atención, pero no logras reconocerlo.";
    expect(validateNarration(qwen, request)).toEqual([]);
    expect(check(qwen)).toEqual([]);
  });

  it("sigue el tramo de la etiqueta en las oraciones sin marca", () => {
    expect(check("Ves a {{e1|un chico}}. Junta algo del suelo, despacio.")).toEqual([]);
    expect(check("Ves a {{e1|un chico}}. Junta algo. Se acerca.").join()).toMatch(/"acerca"/);
    expect(check("Ves a {{e1|un chico}}. Lo ves acercarse.").join()).toMatch(/"acercarse"/);
  });

  it("una oración con sujeto propio ya no habla de la etiqueta", () => {
    expect(check("{{e1|Un chico}} junta algo. El viento mueve las hojas.")).toEqual([]);
    expect(check("{{e1|Un chico}} junta algo. Una mujer pasa a lo lejos.")).toEqual([]);
  });

  it.each([
    ["{{e1|Un chico}} busca algo en el suelo.", /only seen to gather: do not say "busca"/],
    ["{{e1|Un chico}} se acerca y recoge algo.", /do not say "acerca"/],
    [
      "{{e1|Un chico}} recoge algo, temblando. Parece inquieto.",
      /how e1 feels.*"temblando"[\s\S]*"inquieto"/,
    ],
    ["Ves a {{e1|un chico}}. Está ahí, de pie.", /e1 was seen to gather: say that/],
  ])("rechaza %s", (text, problem) => {
    // El validador estructural los deja pasar: por eso la aprobación semántica va aparte.
    expect(validateNarration(text, request)).toEqual([]);
    expect(check(text).join("\n")).toMatch(problem);
  });

  it("lo citado no se juzga como acción", () => {
    const view = viewOf({
      percepts: [
        percept(
          { presence: field(true), identity: field(mother), words: field("Busco a mi hermano") },
          "identified",
          3,
          mother,
        ),
      ],
    });
    const req = narrationRequest(view, style);
    expect(groundingProblems("{{e1|Tu madre}} dice: «Busco a mi hermano».", req, words)).toEqual(
      [],
    );
    expect(groundingProblems("{{e1|Tu madre}} busca a su hermano.", req, words).join()).toMatch(
      /"busca"/,
    );
  });

  it("no juzga a quien la vista nombra fuera de lo percibido (a quién se le habló)", () => {
    const view = viewOf({
      percepts: [
        percept(
          { presence: field(true), identity: field(mother), action: field("work") },
          "identified",
          2,
          mother,
        ),
      ],
      steps: [
        {
          verb: "speak",
          self: {
            believed: "success",
            cues: [],
            effect: { kind: "speak", to: mother, delivered: true, clarity: 1, text: "Hola" },
          },
        },
      ],
    });
    const req = narrationRequest(view, style);
    expect(groundingProblems("{{e1|Tu madre}} trabaja y te pregunta algo.", req, words)).toEqual(
      [],
    );
    // Lo visto igual tiene que decirse.
    expect(groundingProblems("Le decís «Hola» a {{e1|tu madre}}.", req, words).join()).toMatch(
      /e1 was seen to work/,
    );
  });

  it("determinista: mismo texto, mismos problemas", () => {
    const text = "{{e1|Un chico}} se acerca, busca y tiembla.";
    expect(check(text)).toEqual(check(text));
  });
});

describe("narrador con aprobación semántica", () => {
  const local = (model: string): LlmProvider => ({ kind: "local", runtime: "ollama", model });
  const jobsWith = (m: MockLLM) =>
    new LlmJobs({
      config: LlmConfig.parse({
        jobs: Object.fromEntries(LLM_JOBS.map((j) => [j, [local("m"), { kind: "templates" }]])),
        promptLanguage: "en",
        outputLanguage: "es",
      }),
      clientFor: (p) => (p.kind === "local" ? m : undefined),
    });
  const rng = Rng.root(1).fork("narration", 0);
  const wrong = "Ves a {{e1|un chico}} que se acerca y busca algo, inquieto.";
  const right = "Ves a {{e1|un chico}} juntando algo del suelo.";

  it("regenera con los problemas de fidelidad y usa la segunda si es fiel", async () => {
    const m = new MockLLM([wrong, right]);
    const n = await narrate(jobsWith(m), request, { templates: book, actionWords: words, rng });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]?.messages.at(-1)?.content).toMatch(/only seen to gather/);
    expect(n).toMatchObject({ source: "llm", text: "Ves a un chico juntando algo del suelo." });
  });

  it("si sigue infiel cae a las plantillas, que son fieles", async () => {
    const m = new MockLLM([wrong, wrong]);
    const n = await narrate(jobsWith(m), request, { templates: book, actionWords: words, rng });
    expect(n.source).toBe("templates");
    expect(n.problems.join()).toMatch(/feels/);
    expect(groundingProblems(n.marked, request, words)).toEqual([]);
  });

  it("sin el léxico queda solo el validador estructural (como antes)", async () => {
    const m = new MockLLM([wrong]);
    const n = await narrate(jobsWith(m), request, { templates: book, rng });
    expect(n.source).toBe("llm");
  });
});
