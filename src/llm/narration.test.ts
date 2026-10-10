import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentKind, type EntityRef, makeId, Rng, z } from "../core/index.ts";
import {
  type Acquaintance,
  AMBIENCE,
  ambienceOf,
  buildPlayerView,
  NARRATION_TEMPLATES,
  type PlayerView,
  type StepView,
  type ViewInput,
} from "../game/index.ts";
import {
  ACTIONS,
  type BelievedOutcome,
  type FactorKey,
  type Percept,
  type SelfReport,
  type VerbEffect,
} from "../sim/index.ts";
import {
  DEFAULT_NARRATION,
  LLM_JOBS,
  LlmConfig,
  LlmJobs,
  type LlmProvider,
  MockLLM,
  markedIds,
  narrate,
  narrationRequest,
  narratorSystem,
  narratorUserMessage,
  offlineLlmConfig,
  renderView,
  stripMarks,
  styleOf,
  TemplateBook,
  validateNarration,
} from "./index.ts";

/** El contenido de un tipo leído a mano: la capa llm no puede usar el cargador de persistence. */
function load<T extends { readonly id: string }>(kind: ContentKind<T>): T[] {
  const dir = join("content", kind.name);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => z.array(kind.schema).parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

const book = new TemplateBook(load(NARRATION_TEMPLATES));
const style = styleOf(DEFAULT_NARRATION, "es");

const player = makeId("agent", 1);
const mother = makeId("agent", 2);
const other = makeId("agent", 3);
const acquaintances = new Map<EntityRef, Acquaintance>([
  [mother, { name: "Lan", relation: "madre" }],
  [other, { relation: "vecino" }],
]);

const field = (value: unknown, confidence = 0.95) => ({ value, confidence, mistaken: false });

function percept(fields: Percept["fields"], detail: Percept["detail"], n: number): Percept {
  return {
    id: `p${n}`,
    observer: player,
    sourceEntityId: other,
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

const BELIEVED: readonly BelievedOutcome[] = ["success", "partial", "failure", "unsure"];
const FACTOR_KEYS: readonly FactorKey[] = [
  "skill",
  "light",
  "terrain",
  "nerve",
  "capability",
  "position",
  "means",
];

/** Todos los efectos que la sim puede dar, con sus combinaciones. */
function effects(): { verb: string; effect: VerbEffect }[] {
  const out: { verb: string; effect: VerbEffect }[] = [];
  for (const v of ["rest", "wait", "work", "look"]) out.push({ verb: v, effect: { kind: "none" } });
  for (const reached of [1, 2, null]) {
    for (const stumbled of [false, true]) {
      out.push({ verb: "move", effect: { kind: "move", from: 0, to: 1, reached, stumbled } });
    }
  }
  out.push({ verb: "look", effect: { kind: "observe", acuity: 0.5 } });
  for (const target of [mother, null]) {
    for (const [found, glimpsed] of [
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      out.push({
        verb: "search",
        effect: { kind: "search", target, present: true, found, glimpsed },
      });
    }
  }
  for (const good of ["forage", "gleanings", "weird_thing", null] as never[]) {
    for (const amount of [0, 120]) {
      out.push({
        verb: "gather",
        effect: { kind: "gather", good, amount, what: "hierbas", stumbled: amount === 0 },
      });
    }
  }
  for (const hurt of [false, true])
    out.push({ verb: "work", effect: { kind: "work", effectiveSeconds: 60, hurt } });
  for (const to of [mother, null]) {
    for (const text of ["¿Viste a mi hermana?", null]) {
      for (const delivered of [true, false]) {
        out.push({ verb: "speak", effect: { kind: "speak", to, delivered, clarity: 1, text } });
      }
    }
  }
  for (const target of [other, null]) {
    for (const [committed, hit, glancing] of [
      [true, true, false],
      [true, true, true],
      [true, false, false],
      [false, false, false],
    ] as const) {
      for (const offBalance of [false, true]) {
        out.push({
          verb: "strike",
          effect: { kind: "strike", target, committed, hit, glancing, force: 0.5, offBalance },
        });
      }
    }
  }
  for (const w of [other, null]) {
    for (const deal of [true, false]) {
      for (const edge of [-0.2, 0, 0.2]) {
        out.push({
          verb: "trade",
          effect: {
            kind: "trade",
            with: w,
            deal,
            edge,
            direction: null,
            good: null,
            grams: 0,
            coins: 0,
          },
        });
      }
    }
  }
  const unit = (u: string) => u as never;
  for (const to of [mother, null]) {
    for (const gave of [undefined, { good: "good:grain", grams: 500 }]) {
      out.push({
        verb: "give",
        effect: { kind: "give", to, good: gave ? unit(gave.good) : null, grams: gave?.grams ?? 0 },
      });
    }
  }
  for (const from of [mother, makeId("household", 1)]) {
    for (const got of [
      [],
      [{ unit: unit("coin"), amount: 3 }],
      [{ unit: unit("odd"), amount: 1 }],
    ]) {
      out.push({ verb: "take", effect: { kind: "take", from, wanted: null, got } });
    }
  }
  return out;
}

function steps(): StepView[][] {
  const out: StepView[][] = [];
  let i = 0;
  for (const { verb, effect } of effects()) {
    const believed = BELIEVED[i % BELIEVED.length] as BelievedOutcome;
    const cues = [FACTOR_KEYS[i % FACTOR_KEYS.length]] as SelfReport["cues"];
    out.push([{ verb, self: { believed, cues, effect } }]);
    i++;
  }
  return out;
}

function percepts(): Percept[][] {
  const verbs = load(ACTIONS).map((a) => a.id);
  const out: Percept[][] = [
    [percept({ presence: field(true, 0.3) }, "vague", 1)],
    [percept({ presence: field(true, 0.3) }, "vague", 2)],
    [
      percept(
        { presence: field(true), figure: field({ sex: "female", age: "elder" }) },
        "clear",
        3,
      ),
    ],
    [
      percept(
        {
          presence: field(true),
          identity: field(mother),
          words: field("Mañana vamos al río 2 veces"),
        },
        "identified",
        4,
      ),
    ],
    [percept({ presence: field(true), action: field("dance") }, "clear", 5)],
  ];
  verbs.forEach((verb, k) => {
    out.push([
      percept(
        {
          presence: field(true),
          figure: field({ sex: k % 2 ? "male" : "female", age: "youth" }),
          identity: field(k % 3 === 0 ? other : null),
          action: field(verb),
        },
        k % 3 === 0 ? "identified" : "clear",
        10 + k,
      ),
    ]);
  });
  return out;
}

describe("plantillas", () => {
  it("toda la paleta y las plantillas del repo cargan", () => {
    expect(book.ids().length).toBeGreaterThan(50);
    expect(load(AMBIENCE).length).toBeGreaterThan(0);
  });

  it("cada verbo del catálogo tiene cómo verse hecho por otro", () => {
    for (const a of load(ACTIONS)) expect(book.has(`percept.action.${a.id}`), a.id).toBe(true);
    for (const f of FACTOR_KEYS) expect(book.has(`cue.${f}`), f).toBe(true);
  });

  it("todo lo que pueden armar pasa el validador, en cada variante", () => {
    const cases: PlayerView[] = [
      viewOf(),
      viewOf({
        self: [
          "hungry",
          "thirsty",
          "tired",
          "hurt",
          "bleeding",
          "sick",
          "cold",
          "maimed",
          "blacked_out",
        ],
      }),
      ...steps().map((s) => viewOf({ steps: s })),
      ...percepts().map((p) => viewOf({ percepts: p })),
    ];
    for (const [n, view] of cases.entries()) {
      const request = narrationRequest(view, style);
      for (const seed of [1, 2, 3]) {
        const marked = renderView(view, book, Rng.root(seed).fork("narration", n));
        expect(validateNarration(marked, request), `${n}/${seed}: ${marked}`).toEqual([]);
      }
    }
  });

  it("misma clave, misma prosa", () => {
    const view = viewOf({ steps: steps()[10] as StepView[], percepts: percepts()[3] as Percept[] });
    const a = renderView(view, book, Rng.root(7).fork("narration", 1));
    const b = renderView(view, book, Rng.root(7).fork("narration", 1));
    expect(a).toBe(b);
    expect(stripMarks(a)).not.toContain("{{");
  });
});

describe("validateNarration", () => {
  const view = viewOf({
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
    percepts: [
      percept({ presence: field(true), figure: field({ sex: "male", age: "elder" }) }, "clear", 2),
    ],
  });
  const request = narrationRequest(view, style);
  const ok = "Le decís «Hola» a {{e1|tu madre}}. {{e2|Un viejo}} pasa cerca.";

  it("pasa una narración marcada que nombra a todos", () => {
    expect(request.mustMention).toEqual(["e1", "e2"]);
    expect(validateNarration(ok, request)).toEqual([]);
    expect(validateNarration("Lan te mira. {{e1|Ella}} y {{e2|el viejo}}.", request)).toEqual([]);
  });

  it.each([
    ["Le decís «Hola» a {{e1|tu madre}}. {{e9|alguien}} pasa.", /e9 is not one of the labels/],
    ["Le decís «Hola» a {{e1|tu madre}} {{e2 el viejo}}.", /malformed/],
    ["Le decís «Hola» a {{e1|tu madre}}.", /e2 has to be mentioned/],
    ["Le decís «Hola» a {{e1|tu madre}} y {{e2|el viejo}} Wen.", /"Wen" is a name/],
    ["Le decís «Hola» a {{e1|tu madre}} y ves 3 perros y a {{e2|un viejo}}.", /number 3/],
    ["{{e1|Tu madre}} y {{e2|un viejo}}. El jugador sonríe.", /talk about the game/],
    ["{{e1|Tu madre}} y {{e2|Lan}}.", /e2 is not Lan/],
    [`{{e1|Tu madre}} y {{e2|un viejo}}. ${"Y sigue. ".repeat(200)}`, /too long/],
  ])("rechaza %s", (text, problem) => {
    expect(validateNarration(text, request).join("\n")).toMatch(problem);
  });

  it("un nombre del mundo que el personaje no conoce es una fuga, aunque vaya en minúscula", () => {
    const text = `${ok} Pasa por el camino a yunhe.`;
    expect(validateNarration(text, request, { worldNames: ["yunhe", "Lan"] }).join()).toMatch(
      /"yunhe" is not something/,
    );
    expect(validateNarration(ok, request, { worldNames: ["Lan"] })).toEqual([]);
  });

  it("marcas y ids", () => {
    expect(markedIds("{{e2|a}} {{e1|b}} {{e2|c}}")).toEqual(["e2", "e1"]);
    expect(stripMarks(ok)).toBe("Le decís «Hola» a tu madre. Un viejo pasa cerca.");
  });
});

describe("narrador", () => {
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
  const view = viewOf({
    percepts: [
      percept(
        { presence: field(true), identity: field(mother), action: field("work") },
        "identified",
        2,
      ),
    ],
  });
  const request = narrationRequest(view, style, ambienceOf(view.scene, load(AMBIENCE)));
  const rng = Rng.root(1).fork("narration", 0);

  it("usa lo del modelo si pasa, y el jugador lo lee sin marcas", async () => {
    const m = new MockLLM(["{{e1|Tu madre}} trabaja en la calle."]);
    const n = await narrate(jobsWith(m), request, { templates: book, rng });
    expect(n).toMatchObject({ source: "llm", text: "Tu madre trabaja en la calle." });
    expect(m.calls[0]?.messages[0]?.content).toBe(narratorSystem(style));
    expect(JSON.parse(m.calls[0]?.messages[1]?.content ?? "")).toMatchObject({
      mode: "scene",
      mustMention: ["e1"],
    });
  });

  it("regenera una vez con el error y, si sigue mal, usa las plantillas", async () => {
    const m = new MockLLM(["Ves trabajar a Wen.", "Ves trabajar a Wen, te digo."]);
    const n = await narrate(jobsWith(m), request, { templates: book, rng });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1]?.messages.at(-1)?.content).toMatch(/e1 has to be mentioned/);
    expect(n.source).toBe("templates");
    expect(n.problems.join()).toMatch(/"Wen" is a name/);
    expect(validateNarration(n.marked, request)).toEqual([]);
  });

  it("sin red narra con plantillas", async () => {
    const jobs = new LlmJobs({ config: offlineLlmConfig(), clientFor: () => undefined });
    const n = await narrate(jobs, request, { templates: book, rng });
    expect(n.source).toBe("templates");
    expect(n.text).toMatch(/Lan|tu madre/i);
  });

  it("el prefijo del prompt no cambia entre turnos; lo variable va al final", () => {
    const other = narrationRequest(viewOf({ steps: steps()[5] as StepView[] }), style);
    expect(narratorSystem(request.style)).toBe(narratorSystem(other.style));
    expect(narratorUserMessage(request)).not.toBe(narratorUserMessage(other));
  });

  it("el pedido no lleva ids reales", () => {
    expect(narratorUserMessage(request)).not.toMatch(/agent:|place:|mistaken|confidence/);
  });
});

describe("hablo con alguien", () => {
  it("lee a quién y no toma el nombre como lo dicho", async () => {
    const { parseCommand } = await import("./grammar.ts");
    const draft = parseCommand("hablo con mi padre");
    expect(draft?.kind).toBe("act");
    const speech = draft && "speech" in draft ? draft.speech : undefined;
    expect(speech?.text).toBe("…");
    expect(speech?.to?.relation?.rel).toBe("padre");
  });
});
