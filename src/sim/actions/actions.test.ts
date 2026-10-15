import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, type EntityRef, loadContent, makeId, Rng } from "../../core/index.ts";
import { TRAITS } from "../family/index.ts";
import { SKILLS } from "../skills/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  ActionDef,
  type ActionPlan,
  type AttemptActor,
  type AttemptInput,
  actionDuration,
  advance,
  attempt,
  type CursorEnv,
  FRESH_CURSOR,
  type IntentDraft,
  type KnownEntity,
  nodeAt,
  PLANS,
  type PlanCursor,
  type PlanNode,
  parsePlan,
  planFromDraft,
  planLeaves,
  type RefDescription,
  refTokens,
  resolveRef,
  toSeconds,
  validatePlan,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [ACTIONS, PLANS, SKILLS, TRAITS],
  [
    { kind: "actions", file: "content/actions/core.json", data: json("content/actions/core.json") },
    { kind: "skills", file: "content/skills/core.json", data: json("content/skills/core.json") },
    { kind: "traits", file: "content/traits/human.json", data: json("content/traits/human.json") },
    { kind: "plans", file: "content/plans/steal.json", data: json("content/plans/steal.json") },
  ],
);
const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));
const verb = (id: string) => catalog.verb(id) as ActionDef;

const me = makeId("agent", 1);
const wu = makeId("agent", 2);
const lin = makeId("agent", 3);
const dad = makeId("agent", 4);
const forest = makeId("place", 1);
const fields = makeId("place", 2);

const desc = (text: string, extra: Partial<RefDescription> = {}): RefDescription => ({
  text,
  features: [],
  ...extra,
});

const known = (ref: EntityRef, names: string[], extra: Partial<KnownEntity> = {}): KnownEntity => ({
  ref,
  kind: ref.startsWith("place:") ? "place" : "person",
  names,
  features: [],
  relations: [],
  present: false,
  via: [],
  ...extra,
});

const village: KnownEntity[] = [
  known(wu, ["Wu"], { features: ["viejo", "puesto de té"], present: true }),
  known(lin, ["Lin"], { features: ["vieja", "tejedora"] }),
  known(dad, ["Chen"], { features: ["leñador"], relations: [{ rel: "padre", of: "self" }] }),
  known(forest, ["el bosque"], { features: ["pinos"] }),
  known(fields, ["los campos"], { features: ["arroz"] }),
];

describe("catálogo", () => {
  it("el contenido del repo carga: veintiséis verbos y la plantilla de robar", () => {
    expect(catalog.verbs.map((v) => v.id).sort()).toEqual([
      "boil",
      "consult",
      "consume",
      "cook",
      "drink",
      "drop",
      "eat",
      "filter",
      "forge",
      "gather",
      "give",
      "hire",
      "look",
      "move",
      "ponder",
      "rest",
      "search",
      "spare",
      "speak",
      "store",
      "strike",
      "take",
      "tend",
      "trade",
      "wait",
      "work",
    ]);
    expect(catalog.template("steal")?.params).toEqual([{ id: "victim", kind: "person" }]);
  });

  it("todo lo que puede hacer fallar un verbo tiene forma, y los roles existen", () => {
    const base = verb("take");
    const bad = (patch: Partial<ActionDef>) => ActionDef.safeParse({ ...base, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ failureModes: base.failureModes.filter((m) => m.factor !== "light") })).toBe(
      false,
    );
    expect(bad({ failureModes: base.failureModes.filter((m) => m.factor !== "means") })).toBe(
      false,
    );
    expect(bad({ requires: [{ kind: "position", near: "nobody" }] })).toBe(false);
    expect(bad({ manners: [...base.manners, ...base.manners] })).toBe(false);
  });

  it("una plantilla que nombra un verbo inexistente no carga", () => {
    const steal = json("content/plans/steal.json");
    steal[0].root.steps[0].verb = "fly";
    expect(() =>
      loadContent(
        [ACTIONS, PLANS, SKILLS, TRAITS],
        [
          { kind: "actions", file: "a.json", data: json("content/actions/core.json") },
          { kind: "skills", file: "s.json", data: json("content/skills/core.json") },
          { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
          { kind: "plans", file: "p.json", data: steal },
        ],
      ),
    ).toThrow(/fly/);
  });
});

describe("plan", () => {
  const take: PlanNode = {
    kind: "do",
    verb: "take",
    args: [{ role: "from", entity: wu }],
    manner: ["covert"],
  };
  const plan = (root: PlanNode): ActionPlan => ({
    actor: me,
    source: "player",
    root,
    manner: [],
    causes: [],
  });

  it("valida contra el catálogo: verbos, roles, tipos, requeridos y modos", () => {
    expect(validatePlan(plan(take), catalog)).toEqual([]);
    const wrong: PlanNode = {
      kind: "seq",
      steps: [
        { kind: "do", verb: "fly", args: [], manner: [] },
        { kind: "do", verb: "speak", args: [{ role: "to", entity: forest }], manner: ["loud"] },
        { kind: "do", verb: "strike", args: [], manner: [] },
      ],
    };
    const problems = validatePlan(plan(wrong), catalog);
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toMatch(/fly.*desconocido/);
    expect(problems.join("\n")).toMatch(/to no es un person/);
    expect(problems.join("\n")).toMatch(/modo desconocido loud/);
    expect(problems.join("\n")).toMatch(/falta target/);
  });

  it("vuelve igual por JSON y rechaza ids que no son ids", () => {
    const p = plan({ kind: "until", body: take, cond: { kind: "dark" }, max: 5 });
    expect(parsePlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => parsePlan({ ...p, actor: "agent:01" })).toThrow();
    expect(() =>
      parsePlan({ ...p, root: { ...take, args: [{ role: "from", entity: "x" }] } }),
    ).toThrow();
  });

  const env = (now: number, extra: Partial<CursorEnv> = {}): CursorEnv => ({
    now,
    dark: false,
    lastBelieved: null,
    ...extra,
  });
  const leaves = (root: PlanNode, envs: (i: number) => CursorEnv, limit = 50): string[] => {
    const out: string[] = [];
    let c: PlanCursor = FRESH_CURSOR;
    for (let i = 0; i < limit; i++) {
      c = advance(root, c, envs(i));
      if (c.path === null) break;
      const n = nodeAt(root, c.path);
      out.push(n.kind === "do" ? n.verb : n.kind);
    }
    return out;
  };

  it("el cursor recorre seq en orden y termina", () => {
    const root: PlanNode = {
      kind: "seq",
      steps: [{ kind: "do", verb: "look", args: [], manner: [] }, take],
    };
    expect(leaves(root, (i) => env(i))).toEqual(["look", "take"]);
  });

  it("until corta por la condición, por lo creído y por el tope", () => {
    const look: PlanNode = { kind: "do", verb: "look", args: [], manner: [] };
    const dark: PlanNode = { kind: "until", body: look, cond: { kind: "dark" }, max: 100 };
    expect(leaves(dark, (i) => env(i, { dark: i >= 3 }))).toHaveLength(3);
    expect(leaves(dark, () => env(0, { dark: true }))).toEqual([]);
    const ok: PlanNode = { kind: "until", body: look, cond: { kind: "succeeded" }, max: 100 };
    expect(
      leaves(ok, (i) => env(i, { lastBelieved: i >= 4 ? "success" : "failure" })),
    ).toHaveLength(4);
    const capped: PlanNode = { kind: "until", body: look, cond: { kind: "light" }, max: 7 };
    expect(leaves(capped, (i) => env(i, { dark: true }))).toHaveLength(7);
    const timed: PlanNode = {
      kind: "until",
      body: look,
      cond: { kind: "elapsed", seconds: 600 },
      max: 100,
    };
    expect(leaves(timed, (i) => env(i * 60))).toHaveLength(10);
  });

  it("repeat corre el cuerpo las veces pedidas y sigue con el paso de después", () => {
    const look: PlanNode = { kind: "do", verb: "look", args: [], manner: [] };
    const three: PlanNode = { kind: "repeat", body: look, times: 3 };
    expect(leaves(three, (i) => env(i))).toEqual(["look", "look", "look"]);
    const root: PlanNode = { kind: "seq", steps: [three, take] };
    expect(leaves(root, (i) => env(i))).toEqual(["look", "look", "look", "take"]);
    const nested: PlanNode = {
      kind: "repeat",
      body: { kind: "seq", steps: [look, take] },
      times: 2,
    };
    expect(leaves(nested, (i) => env(i))).toEqual(["look", "take", "look", "take"]);
  });

  it("if elige al llegar según lo que el actor percibe y cree, y salta si no hay rama", () => {
    const look: PlanNode = { kind: "do", verb: "look", args: [], manner: [] };
    // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
    const branch: PlanNode = { kind: "if", cond: { kind: "dark" }, then: take, else: look };
    expect(leaves(branch, () => env(0, { dark: true }))).toEqual(["take"]);
    expect(leaves(branch, () => env(0, { dark: false }))).toEqual(["look"]);
    // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
    const onlyThen: PlanNode = { kind: "if", cond: { kind: "dark" }, then: take };
    expect(leaves(onlyThen, () => env(0, { dark: false }))).toEqual([]);
    const after: PlanNode = { kind: "seq", steps: [onlyThen, look] };
    expect(leaves(after, () => env(0, { dark: false }))).toEqual(["look"]);
    expect(leaves(after, () => env(0, { dark: true }))).toEqual(["take", "look"]);
    // Por lo que cree que le salió, no por la verdad.
    const afterOk: PlanNode = {
      kind: "if",
      cond: { kind: "succeeded" },
      // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
      then: take,
      else: look,
    };
    expect(leaves(afterOk, () => env(0, { lastBelieved: "success" }))).toEqual(["take"]);
    expect(leaves(afterOk, () => env(0, { lastBelieved: "failure" }))).toEqual(["look"]);
  });

  it("repeat e if vuelven por JSON, cuentan sus hojas y se validan contra el catálogo", () => {
    const look: PlanNode = { kind: "do", verb: "look", args: [], manner: [] };
    const root: PlanNode = {
      kind: "repeat",
      // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
      body: { kind: "if", cond: { kind: "light" }, then: take, else: look },
      times: 2,
    };
    const p = plan(root);
    expect(parsePlan(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(planLeaves(root).map((l) => l.path.join("."))).toEqual(["0.0", "0.1"]);
    expect(validatePlan(p, catalog)).toEqual([]);
    // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
    const bad = plan({ kind: "if", cond: { kind: "dark" }, then: { ...take, verb: "fly" } });
    expect(validatePlan(bad, catalog).join()).toMatch(/fly.*desconocido/);
    expect(() => parsePlan({ ...p, root: { ...root, times: 0 } })).toThrow();
  });

  it("until anidado en seq sigue con el paso de después", () => {
    const look: PlanNode = { kind: "do", verb: "look", args: [], manner: [] };
    const root: PlanNode = {
      kind: "seq",
      steps: [{ kind: "until", body: look, cond: { kind: "light" }, max: 2 }, take],
    };
    expect(leaves(root, (i) => env(i, { dark: true }))).toEqual(["look", "look", "take"]);
  });
});

describe("referencias", () => {
  it("normaliza palabras: sin tildes, plural ni vocal final, sin las vacías", () => {
    expect(refTokens("El viejo del puesto de té")).toEqual(["viej", "puest", "te"]);
    expect(refTokens("las viejas")).toEqual(refTokens("la vieja"));
  });

  it("única por nombre o rasgos; lo presente pesa más que lo recordado", () => {
    const r = resolveRef(desc("Wu"), village);
    expect(r.status === "unique" && r.chosen).toBe(wu);
    // "la vieja" encaja con los dos, pero Wu está acá.
    const v = resolveRef(desc("el viejo del té"), village);
    expect(v.status === "unique" && v.chosen).toBe(wu);
  });

  it("ambigua: arma la aclaración con lo que distingue a cada uno", () => {
    const away = village.map((k) => ({ ...k, present: false }));
    const r = resolveRef(desc("la vieja"), away);
    expect(r.status).toBe("ambiguous");
    if (r.status !== "ambiguous") return;
    expect(r.clarify.map((c) => c.ref)).toEqual([wu, lin]);
    expect(r.clarify[0]?.distinguishing).toContain("puesto de té");
    expect(r.clarify[1]?.distinguishing).toContain("tejedora");
    expect(r.clarify[0]?.distinguishing).not.toContain("viejo");
  });

  const kid1 = "agent:101" as EntityRef;
  const kid2 = "agent:102" as EntityRef;
  const elder = "agent:103" as EntityRef;
  const strangers: KnownEntity[] = [
    known(kid1, [], { features: ["persona", "niño", "nene"], present: true }),
    known(kid2, [], { features: ["persona", "niño", "nene"], present: true }),
    known(elder, [], { features: ["persona", "viejo"], present: true }),
  ];

  it("en plural, los que encajan son el conjunto y no hay a quién preguntar", () => {
    const g = resolveRef(desc("los niños"), strangers);
    expect(g.status).toBe("group");
    if (g.status !== "group") return;
    expect(g.members).toEqual([kid1, kid2]);
    expect(g.chosen).toBe(kid1);
    // Con número, solo esos; con uno solo que encaja, es único; en singular sigue la pregunta.
    const two = resolveRef(desc("los dos niños"), strangers);
    expect(two.status === "group" && two.members).toEqual([kid1, kid2]);
    const one = resolveRef(desc("dos niños"), strangers.slice(0, 1));
    expect(one.status).toBe("unique");
    expect(resolveRef(desc("el niño"), strangers).status).toBe("ambiguous");
    expect(resolveRef(desc("los gatos"), strangers).status).toBe("unknown");
  });

  it("el plural con relación conserva el conjunto filtrado por parentesco", () => {
    const siblings = strangers.map((k) => ({
      ...k,
      relations: [{ rel: "hermano", of: "self" as const }],
    }));
    const plural = resolveRef(
      desc("mis hermanos", {
        relation: { rel: "hermano", to: "self" },
        quantity: { kind: "all" },
      }),
      [...siblings, ...village],
    );
    expect(plural.status === "group" && plural.members).toEqual([kid1, kid2, elder]);
    const singular = resolveRef(
      desc("mi hermano", {
        relation: { rel: "hermano", to: "self" },
      }),
      siblings,
    );
    expect(singular.status).toBe("ambiguous");
  });

  it("por cantidad declarada: «todos» y «dos» sin artículo", () => {
    const all = resolveRef(desc("los chicos", { quantity: { kind: "all" } }), [
      known(kid1, [], { features: ["chicos"], present: true }),
      known(kid2, [], { features: ["chicos"], present: true }),
    ]);
    expect(all.status).toBe("group");
    const two = resolveRef(desc("hombres", { quantity: { kind: "count", n: 2 } }), [
      known(kid1, [], { features: ["hombre"] }),
      known(kid2, [], { features: ["hombre"] }),
      known(elder, [], { features: ["hombre"] }),
    ]);
    expect(two.status === "group" && two.members).toHaveLength(2);
  });

  it("por relación: 'mi padre' es quien el actor sabe que es su padre", () => {
    const r = resolveRef(desc("mi padre", { relation: { to: "self", rel: "padre" } }), village);
    expect(r.status === "unique" && r.chosen).toBe(dad);
    const none = resolveRef(desc("mi madre", { relation: { to: "self", rel: "madre" } }), village);
    expect(none.status).toBe("unknown");
  });

  it("desconocida si nada encaja, y el tipo filtra", () => {
    expect(resolveRef(desc("el herrero"), village).status).toBe("unknown");
    expect(resolveRef(desc("Wu", { kind: "place" }), village).status).toBe("unknown");
  });

  it("es determinista y no depende del orden de lo conocido", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(village, { minLength: village.length }),
        fc.constantFrom("vieja", "Wu", "el bosque", "Lin la tejedora", "pinos"),
        (shuffled, text) => {
          expect(resolveRef(desc(text), shuffled)).toEqual(resolveRef(desc(text), village));
        },
      ),
    );
  });
});

describe("del borrador al plan", () => {
  const ctx = {
    actor: me,
    source: "player" as const,
    catalog,
    known: village,
    clock: EARTHLIKE_CLOCK,
    causes: [],
  };
  const act = (plan: IntentDraft["plan"], extra: Partial<IntentDraft> = {}): IntentDraft => ({
    kind: "act",
    plan,
    ...extra,
  });

  it("el porqué declarado pasa al plan con el beneficiario resuelto; sin purpose no hay", () => {
    const give = { kind: "do" as const, verb: "give", args: [{ role: "to", ref: desc("Wu") }] };
    const withWhy = planFromDraft(
      act(give, { purpose: { motive: "gift", forWhom: desc("Wu") } }),
      ctx,
    );
    expect(withWhy.kind === "plan" && withWhy.plan.purpose).toEqual({
      motive: "gift",
      forWhom: wu,
    });
    const bare = planFromDraft(act(give, { purpose: { motive: "sustenance" } }), ctx);
    expect(bare.kind === "plan" && bare.plan.purpose).toEqual({ motive: "sustenance" });
    // Un beneficiario que no conoce no frena el plan: queda el motivo solo.
    const stranger = planFromDraft(
      act(give, { purpose: { motive: "gift", forWhom: desc("el herrero") } }),
      ctx,
    );
    expect(stranger.kind === "plan" && stranger.plan.purpose).toEqual({ motive: "gift" });
    const none = planFromDraft(act(give), ctx);
    expect(none.kind === "plan" && "purpose" in none.plan).toBe(false);
  });

  it("resuelve referencias, pasa duraciones a segundos y expande plantillas", () => {
    const r = planFromDraft(
      act({
        kind: "seq",
        steps: [
          { kind: "do", verb: "move", args: [{ role: "to", ref: desc("el bosque") }] },
          {
            kind: "do",
            verb: "work",
            args: [{ role: "for", duration: { amount: 2, unit: "hour" } }],
          },
          {
            kind: "template",
            template: "steal",
            params: { victim: { role: "victim", ref: desc("Wu") } },
          },
        ],
      }),
      ctx,
    );
    expect(r.kind).toBe("plan");
    if (r.kind !== "plan") return;
    const s = r.plan.root;
    expect(s.kind === "seq" && s.steps[0]).toEqual({
      kind: "do",
      verb: "move",
      args: [{ role: "to", entity: forest }],
      manner: [],
    });
    expect(s.kind === "seq" && s.steps[1]).toMatchObject({
      args: [{ role: "for", seconds: 7200 }],
    });
    expect(s.kind === "seq" && s.steps[2]).toEqual({
      kind: "seq",
      steps: [
        { kind: "do", verb: "look", args: [], manner: [] },
        { kind: "do", verb: "wait", args: [{ role: "for", seconds: 120 }], manner: ["covert"] },
        { kind: "do", verb: "take", args: [{ role: "from", entity: wu }], manner: ["covert"] },
      ],
    });
  });

  it("el habla va primero, al presente si no dice a quién", () => {
    const r = planFromDraft(
      act(undefined, { speech: { text: "¿Viste a mi hermana?", to: desc("Wu") } }),
      ctx,
    );
    expect(r.kind === "plan" && r.plan.root).toEqual({
      kind: "do",
      verb: "speak",
      args: [
        { role: "to", entity: wu },
        { role: "content", text: "¿Viste a mi hermana?" },
      ],
      manner: [],
    });
  });

  it("hablarle a quien cree en otro hex antepone ir a ese lugar", () => {
    const known = village.map((k) =>
      k.ref === wu
        ? { ...k, present: false, at: 7 }
        : k.ref === forest
          ? { ...k, hexes: [7, 8] }
          : k,
    );
    const draft = act(undefined, { speech: { text: "Hola", to: desc("Wu") } });
    const r = planFromDraft(draft, { ...ctx, known, here: 3 });
    expect(r.kind === "plan" && r.plan.root).toEqual({
      kind: "seq",
      steps: [
        { kind: "do", verb: "move", args: [{ role: "to", entity: forest }], manner: [] },
        {
          kind: "do",
          verb: "speak",
          args: [
            { role: "to", entity: wu },
            { role: "content", text: "Hola" },
          ],
          manner: [],
        },
      ],
    });
    // En el mismo hex, o sin saber dónde está, no hay desplazamiento.
    const same = planFromDraft(draft, { ...ctx, known, here: 7 });
    expect(same.kind === "plan" && same.plan.root.kind).toBe("do");
  });

  it("hablar sin decir a quién: al único presente, o se pregunta", () => {
    const hi = act(undefined, { speech: { text: "Buen día" } });
    const r = planFromDraft(hi, ctx);
    expect(r.kind === "plan" && r.plan.root.kind === "do" && r.plan.root.args[0]).toEqual({
      role: "to",
      entity: wu,
    });
    const two = village.map((k) => (k.ref === lin ? { ...k, present: true } : k));
    const amb = planFromDraft(hi, { ...ctx, known: two });
    expect(amb.kind === "clarify" && amb.refs[0]?.resolved.candidates.map((c) => c.ref)).toEqual([
      wu,
      lin,
    ]);
    const alone = planFromDraft(hi, {
      ...ctx,
      known: village.map((k) => ({ ...k, present: false })),
    });
    expect(alone.kind).toBe("unknown");
  });

  it("ambiguo pide aclaración; desconocido lo dice; sin plan no inventa", () => {
    const away = village.map((k) => ({ ...k, present: false }));
    const amb = planFromDraft(
      act({ kind: "do", verb: "speak", args: [{ role: "to", ref: desc("la vieja") }] }),
      { ...ctx, known: away },
    );
    expect(amb.kind).toBe("clarify");
    const unk = planFromDraft(
      act({ kind: "do", verb: "speak", args: [{ role: "to", ref: desc("el herrero") }] }),
      ctx,
    );
    expect(unk.kind).toBe("unknown");
    const bad = planFromDraft(
      act({
        kind: "until",
        body: { kind: "do", verb: "look", args: [] },
        cond: { kind: "time", text: "hasta que el gallo cante" },
      }),
      ctx,
    );
    expect(bad.kind === "invalid" && bad.problems.join()).toMatch(/condición/);
    const later = planFromDraft(
      act({
        kind: "onEvent",
        trigger: { kind: "time", text: "si anochece", is: { kind: "dark" } },
        react: { kind: "do", verb: "look", args: [] },
      }),
      ctx,
    );
    expect(later.kind === "invalid" && later.problems.join()).toMatch(/onEvent/);
    const spaced = planFromDraft(
      act({
        kind: "repeat",
        body: { kind: "do", verb: "look", args: [] },
        times: 2,
        every: { amount: 1, unit: "hour" },
      }),
      ctx,
    );
    expect(spaced.kind === "invalid" && spaced.problems.join()).toMatch(/separación/);
    const unbounded = planFromDraft(
      act({ kind: "repeat", body: { kind: "do", verb: "look", args: [] } }),
      ctx,
    );
    expect(unbounded.kind === "invalid" && unbounded.problems.join()).toMatch(/cuántas veces/);
  });

  it("«me acerco a los niños»: si los tiene delante mira y escucha de cerca; si no, va adonde cree que están", () => {
    const kids: KnownEntity[] = [
      known("agent:101" as EntityRef, [], { features: ["persona", "niño"], present: true, at: 5 }),
      known("agent:102" as EntityRef, [], { features: ["persona", "niño"], present: true, at: 5 }),
    ];
    const toKids = act({
      kind: "do",
      verb: "move",
      args: [{ role: "to", ref: desc("los niños", { kind: "person" }) }],
    });
    // La referencia a «los niños» con `kind` person o sin él da lo mismo.
    const bare = act({
      kind: "do",
      verb: "move",
      args: [{ role: "to", ref: desc("los niños") }],
    });
    for (const draft of [toKids, bare]) {
      const here = planFromDraft(draft, { ...ctx, known: [...village, ...kids] });
      expect(here.kind === "plan" && here.plan.root).toMatchObject({ kind: "do", verb: "look" });
      expect(here.kind === "plan" && here.groups?.[0]?.members).toHaveLength(2);
    }
    // Si cree que están en otro hex, va al lugar que lo contiene.
    const away = kids.map((k) => ({ ...k, present: false, at: 9 }));
    const bosque = known(forest, ["el bosque"], { hexes: [9] });
    const there = planFromDraft(toKids, { ...ctx, known: [bosque, ...away] });
    expect(there.kind === "plan" && there.plan.root).toMatchObject({
      verb: "move",
      args: [{ role: "to", entity: forest }],
    });
    // Un lugar que sí encaja sigue siendo un lugar.
    const place = planFromDraft(
      act({ kind: "do", verb: "move", args: [{ role: "to", ref: desc("el bosque") }] }),
      { ...ctx, known: [...village, ...kids] },
    );
    expect(place.kind === "plan" && place.plan.root).toMatchObject({
      args: [{ role: "to", entity: forest }],
    });
    // Hablarles a «los niños»: va hacia el primero y el conjunto queda anotado.
    const talk = planFromDraft(
      act({ kind: "do", verb: "speak", args: [{ role: "to", ref: desc("los niños") }] }),
      { ...ctx, known: [...village, ...kids] },
    );
    expect(talk.kind).toBe("plan");
    expect(talk.kind === "plan" && talk.groups?.[0]?.text).toBe("los niños");
  });

  it("acercarse a personas conserva los modos y valida los roles del borrador", () => {
    const kid = known("agent:101" as EntityRef, [], {
      features: ["niño"],
      present: true,
      at: 5,
    });
    const approach = {
      kind: "do" as const,
      verb: "move",
      args: [{ role: "to", ref: desc("el niño") }],
      manner: ["careful"],
    };
    const here = planFromDraft(act(approach), { ...ctx, known: [kid] });
    expect(here.kind === "plan" && here.plan.root).toMatchObject({
      verb: "look",
      manner: ["careful"],
    });
    const away = planFromDraft(act(approach), {
      ...ctx,
      known: [{ ...kid, present: false, at: 9 }, known(forest, ["el bosque"], { hexes: [9] })],
    });
    expect(away.kind === "plan" && away.plan.root).toMatchObject({
      verb: "move",
      manner: ["careful"],
    });
    const invalid = planFromDraft(
      act({
        ...approach,
        args: [...approach.args, { role: "invented", text: "ignorado" }],
      }),
      { ...ctx, known: [kid] },
    );
    expect(invalid.kind).toBe("invalid");
  });

  it("repeat e if del borrador pasan al plan con la condición normalizada", () => {
    const r = planFromDraft(
      act({
        kind: "repeat",
        times: 3,
        body: {
          kind: "if",
          cond: { kind: "time", text: "si es de noche", is: { kind: "dark" } },
          // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
          then: { kind: "do", verb: "look", args: [] },
          else: { kind: "do", verb: "gather", args: [{ role: "what", text: "hierbas" }] },
        },
      }),
      ctx,
    );
    expect(r.kind === "plan" && r.plan.root).toMatchObject({
      kind: "repeat",
      times: 3,
      body: {
        kind: "if",
        cond: { kind: "dark" },
        // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
        then: { kind: "do", verb: "look" },
        else: { kind: "do", verb: "gather" },
      },
    });
    const noCond = planFromDraft(
      act({
        kind: "if",
        cond: { kind: "time", text: "si se me da la gana" },
        // biome-ignore lint/suspicious/noThenProperty: el nodo `if` de actions §3; nunca se espera con await
        then: { kind: "do", verb: "look", args: [] },
      }),
      ctx,
    );
    expect(noCond.kind === "invalid" && noCond.problems.join()).toMatch(/condición/);
  });

  it("until con la condición normalizada", () => {
    const r = planFromDraft(
      act({
        kind: "until",
        body: { kind: "do", verb: "gather", args: [{ role: "what", text: "hierbas" }] },
        cond: { kind: "time", text: "hasta que anochezca", is: { kind: "dark" } },
      }),
      ctx,
    );
    expect(r.kind === "plan" && r.plan.root).toMatchObject({
      kind: "until",
      cond: { kind: "dark" },
    });
  });

  it("duraciones con el reloj del planeta", () => {
    expect(toSeconds({ amount: 1, unit: "day" }, { ...EARTHLIKE_CLOCK, day: 30000 })).toBe(30000);
    expect(toSeconds({ amount: 0.5, unit: "minute" }, EARTHLIKE_CLOCK)).toBe(30);
  });
});

describe("intento", () => {
  const actor = (
    z: Record<string, number> = {},
    extra: Partial<AttemptActor> = {},
  ): AttemptActor => ({
    id: me,
    z,
    capabilities: {},
    hex: 0,
    ...extra,
  });
  const input = (
    verbId: string,
    node: Partial<AttemptInput["node"]> = {},
    extra: Partial<AttemptInput> = {},
  ): AttemptInput => ({
    def: verb(verbId),
    node: { kind: "do", verb: verbId, args: [], manner: [], ...node },
    planManner: [],
    actor: actor(),
    parties: {},
    scene: { light: 1, terrain: 0, placeKinds: ["village"] },
    has: () => true,
    tick: 1000,
    rng: Rng.root(7),
    ...extra,
  });
  const many = (n: number, f: (i: number) => AttemptInput) =>
    Array.from({ length: n }, (_, i) => attempt({ ...f(i), tick: i }));
  const rate = (rs: ReturnType<typeof many>, p: (r: (typeof rs)[number]) => boolean) =>
    rs.filter(p).length / rs.length;

  it("es determinista: misma clave, mismo resultado", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.integer({ min: 0, max: 1e9 }),
        (seed, tick) => {
          const i = input(
            "move",
            {},
            { rng: Rng.root(seed), tick, scene: { light: 0.3, terrain: 0.5, placeKinds: [] } },
          );
          expect(attempt(i)).toEqual(attempt(i));
        },
      ),
    );
  });

  it("un requisito que falta da la forma sin tirar y el actor se entera", () => {
    const weak = attempt(
      input("move", {}, { actor: actor({}, { capabilities: { locomotion: 0.1 } }) }),
    );
    expect(weak).toMatchObject({
      outcome: "failure",
      margin: null,
      failure: "too_weak",
      believed: "failure",
    });
    const far = attempt(
      input(
        "speak",
        { args: [{ role: "to", entity: wu }] },
        { parties: { to: { id: wu, z: {}, hex: 5 } } },
      ),
    );
    expect(far.failure).toBe("not_here");
    const nowhere = attempt(input("gather"));
    expect(nowhere.failure).toBe("not_here");
    expect(
      attempt(input("gather", {}, { scene: { light: 1, terrain: 0, placeKinds: ["forest"] } }))
        .unmet,
    ).toBeNull();
    const broke = attempt(
      input(
        "take",
        { args: [{ role: "from", entity: wu }] },
        { parties: { from: { id: wu, z: {}, hex: 0 } }, has: (h) => h !== wu },
      ),
    );
    expect(broke.failure).toBe("no_means");
  });

  it("la forma del fracaso sale del factor que más restó", () => {
    const night = many(400, () =>
      input("move", {}, { scene: { light: 0, terrain: 0, placeKinds: [] } }),
    );
    const failed = night.filter((r) => r.margin !== null && r.margin < -0.5);
    expect(failed.length).toBeGreaterThan(20);
    expect(failed.every((r) => r.failure === "lost")).toBe(true);
    const rough = many(400, () =>
      input("move", {}, { scene: { light: 1, terrain: 1, placeKinds: [] } }),
    );
    expect(
      rough.filter((r) => r.margin !== null && r.margin < -0.5).every((r) => r.failure === "slip"),
    ).toBe(true);
    const dim = many(400, () =>
      input(
        "take",
        { args: [{ role: "from", entity: wu }] },
        {
          scene: { light: 0, terrain: 0, placeKinds: [] },
          parties: { from: { id: wu, z: {}, hex: 0 } },
        },
      ),
    );
    expect(
      dim
        .filter((r) => r.margin !== null && r.margin < -0.5)
        .every((r) => r.failure === "wrong_target"),
    ).toBe(true);
  });

  it("más habilidad, más éxitos; la luz y el terreno restan", () => {
    const ok = (z: number, light = 1, terrain = 0) =>
      rate(
        many(600, () =>
          input(
            "gather",
            {},
            {
              actor: actor({ perception: z, intellect: z, control: z }),
              scene: { light, terrain, placeKinds: ["forest"] },
            },
          ),
        ),
        (r) => r.margin !== null && r.margin >= 0.5,
      );
    expect(ok(1.5)).toBeGreaterThan(ok(0) + 0.15);
    expect(ok(0)).toBeGreaterThan(ok(-1.5) + 0.15);
    expect(ok(0, 0.2)).toBeLessThan(ok(0) - 0.1);
    expect(ok(0, 1, 1)).toBeLessThan(ok(0) - 0.05);
  });

  it("hay fracasos que el actor no nota: la verdad y lo creído se separan", () => {
    const rs = many(2000, () =>
      input("look", {}, { scene: { light: 0.3, terrain: 0, placeKinds: [] } }),
    );
    const unnoticed = rs.filter((r) => r.outcome === "failure_unnoticed");
    expect(unnoticed.length).toBeGreaterThan(20);
    expect(unnoticed.every((r) => r.believed === "success")).toBe(true);
    expect(
      rs.filter((r) => r.outcome === "failure_suspected").every((r) => r.believed === "unsure"),
    ).toBe(true);
    // Caminar es evidente: si te perdiste, lo sabés.
    const walks = many(2000, () =>
      input("move", {}, { scene: { light: 0.6, terrain: 1, placeKinds: [] } }),
    );
    expect(walks.some((r) => r.outcome === "failure_unnoticed")).toBe(false);
  });

  it("robar en contienda de sigilo: perderla es que te vean, no fallar", () => {
    const steal = (watcher: number, light: number) =>
      many(1000, () =>
        input(
          "take",
          { args: [{ role: "from", entity: wu }], manner: ["covert"] },
          {
            scene: { light, terrain: 0, placeKinds: [] },
            parties: { from: { id: wu, z: { perception: watcher }, hex: 0 } },
          },
        ),
      );
    const seen = (w: number, l: number) => rate(steal(w, l), (r) => r.noticedBy.includes(wu));
    expect(seen(2, 1)).toBeGreaterThan(seen(-1, 1) + 0.2);
    expect(seen(0, 0)).toBeLessThan(seen(0, 1) - 0.1);
    const rs = steal(1, 1);
    expect(rs.some((r) => r.outcome === "discovered")).toBe(true);
    expect(
      rs
        .filter((r) => r.outcome === "discovered")
        .every((r) => r.margin !== null && r.margin >= -0.5),
    ).toBe(true);
  });

  it("golpear en contienda abierta: el otro resta del margen", () => {
    const hit = (z: number) =>
      rate(
        many(800, () =>
          input(
            "strike",
            { args: [{ role: "target", entity: wu }] },
            {
              parties: { target: { id: wu, z: { perception: z, constitution: z }, hex: 0 } },
            },
          ),
        ),
        (r) => r.margin !== null && r.margin >= 0.5,
      );
    expect(hit(-1.5)).toBeGreaterThan(hit(1.5) + 0.2);
  });

  it("la duración sale del modelo del verbo y de los modos", () => {
    const take = verb("take");
    expect(
      actionDuration(take, { kind: "do", verb: "take", args: [], manner: ["covert"] }, []),
    ).toBe(60);
    const work = verb("work");
    expect(actionDuration(work, { kind: "do", verb: "work", args: [], manner: [] }, [])).toBe(
      14400,
    );
    expect(
      actionDuration(
        work,
        { kind: "do", verb: "work", args: [{ role: "for", seconds: 1e6 }], manner: [] },
        [],
      ),
    ).toBe(43200);
    expect(
      actionDuration(
        verb("move"),
        { kind: "do", verb: "move", args: [], manner: [] },
        ["fast"],
        1000,
      ),
    ).toBe(700);
  });
});
