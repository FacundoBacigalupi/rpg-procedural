import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, type EntityRef, loadContent, makeId } from "../../core/index.ts";
import { TRAITS } from "../family/index.ts";
import { SKILLS } from "../skills/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  type ActionPlan,
  assessPlan,
  type BeliefView,
  believesPossible,
  type CapabilityKey,
  clarifyQuestion,
  type IntentDraft,
  type KnownEntity,
  PLANS,
  planFromDraft,
  renderWarnings,
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

const me = makeId("agent", 1);
const wu = makeId("agent", 2);
const lin = makeId("agent", 3);
const forest = makeId("place", 1);
const fields = makeId("place", 2);

const names = new Map<EntityRef, string>([
  [wu, "Wu"],
  [lin, "Lin"],
]);

function view(over: Partial<BeliefView> = {}): BeliefView {
  return {
    hex: 3,
    capability: () => 1,
    skill: () => ({ level: 0.5, spread: 0.1 }),
    hexOf: (r) => (r === wu ? 3 : r === lin ? 9 : undefined),
    hexesOf: (r) => (r === forest ? [7, 8] : r === fields ? [4] : undefined),
    placeKindsAt: (h) => (h === 7 ? ["forest"] : h === 4 ? ["fields"] : ["village"]),
    holds: () => undefined,
    nameOf: (r) => names.get(r) ?? "alguien",
    ...over,
  };
}

const plan = (root: ActionPlan["root"]): ActionPlan => ({
  actor: me,
  source: "player",
  root,
  manner: [],
  causes: [],
});
const take = (from: EntityRef): ActionPlan["root"] => ({
  kind: "do",
  verb: "take",
  args: [{ role: "from", entity: from }],
  manner: [],
});

describe("factibilidad creída", () => {
  it("sin nada que objetar no avisa", () => {
    expect(assessPlan(plan(take(wu)), catalog, view())).toEqual([]);
  });

  it("el cuerpo como lo siente: avisa y bloquea a un NPC", () => {
    const w = assessPlan(
      plan(take(wu)),
      catalog,
      view({ capability: (c: CapabilityKey) => (c === "manipulation" ? 0.1 : 1) }),
    );
    expect(w.map((x) => x.kind)).toContain("body");
    expect(believesPossible(w)).toBe(false);
  });

  it("nunca aprendió: avisa pero no bloquea (se puede intentar sin saber)", () => {
    const w = assessPlan(plan(take(wu)), catalog, view({ skill: () => undefined }));
    expect(w.map((x) => x.kind)).toEqual(["untrained"]);
    expect(believesPossible(w)).toBe(true);
    expect(renderWarnings(w)).toContain("nunca aprendiste");
    const low = assessPlan(
      plan(take(wu)),
      catalog,
      view({ skill: () => ({ level: 0.02, spread: 0.2 }) }),
    );
    expect(low.map((x) => x.kind)).toEqual(["unskilled"]);
  });

  it("cree que la persona está lejos o no sabe dónde, en términos del personaje", () => {
    const far = assessPlan(plan(take(lin)), catalog, view());
    expect(far.map((x) => x.kind)).toEqual(["far"]);
    expect(far[0]?.text).toContain("Lin");
    const lost = assessPlan(plan(take(lin)), catalog, view({ hexOf: () => null }));
    expect(lost.map((x) => x.kind)).toEqual(["unknown_whereabouts"]);
    // Quien no conoce a la persona no tiene de qué avisar.
    expect(assessPlan(plan(take(lin)), catalog, view({ hexOf: () => undefined }))).toEqual([]);
  });

  it("no cree tener con qué: el suyo y el del otro", () => {
    const give: ActionPlan["root"] = {
      kind: "do",
      verb: "give",
      args: [{ role: "to", entity: wu }],
      manner: [],
    };
    const own = assessPlan(
      plan(give),
      catalog,
      view({ holds: (h) => (h === "self" ? false : undefined) }),
    );
    expect(own.map((x) => x.kind)).toEqual(["no_means"]);
    expect(believesPossible(own)).toBe(false);
    const theirs = assessPlan(
      plan(take(wu)),
      catalog,
      view({ holds: (h) => (h === wu ? false : undefined) }),
    );
    expect(theirs[0]?.text).toContain("Wu");
  });

  it("ir al lugar antes cambia dónde cree estar", () => {
    const seq = (steps: ActionPlan["root"][]): ActionPlan["root"] => ({ kind: "seq", steps });
    const g: ActionPlan["root"] = { kind: "do", verb: "gather", args: [], manner: [] };
    const mv = (to: EntityRef): ActionPlan["root"] => ({
      kind: "do",
      verb: "move",
      args: [{ role: "to", entity: to }],
      manner: [],
    });
    expect(assessPlan(plan(g), catalog, view()).map((x) => x.kind)).toEqual(["wrong_place"]);
    expect(assessPlan(plan(seq([mv(forest), g])), catalog, view())).toEqual([]);
    // Ir a un sitio que no conoce borra la posición creída: no se avisa de lo que no se sabe.
    expect(assessPlan(plan(seq([mv(lin), g])), catalog, view())).toEqual([]);
    // Ir al bosque y arar: ahí no hay campo; en los campos sí.
    const till: ActionPlan["root"] = {
      kind: "do",
      verb: "work",
      args: [{ role: "for", seconds: 3600 }],
      manner: [],
    };
    expect(assessPlan(plan(seq([mv(forest), till])), catalog, view()).map((x) => x.kind)).toEqual([
      "wrong_place",
    ]);
    expect(assessPlan(plan(seq([mv(fields), till])), catalog, view())).toEqual([]);
  });

  it("es determinista y bloquea justo bajo el mínimo del cuerpo (propiedad)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean(), (cap, trained) => {
        const v = view({
          capability: () => cap,
          skill: () => (trained ? { level: 0.4, spread: 0.1 } : undefined),
        });
        const a = assessPlan(plan(take(wu)), catalog, v);
        const b = assessPlan(plan(take(wu)), catalog, v);
        expect(a).toEqual(b);
        expect(believesPossible(a)).toBe(cap >= 0.3);
      }),
    );
  });
});

describe("referencias fantasma, actos de habla y aclaraciones", () => {
  const known = (ref: EntityRef, ns: string[], extra: Partial<KnownEntity> = {}): KnownEntity => ({
    ref,
    kind: ref.startsWith("place:") ? "place" : "person",
    names: ns,
    features: [],
    relations: [],
    present: false,
    via: [],
    ...extra,
  });
  const ghost = makeId("agent", 9);
  const cast: KnownEntity[] = [
    known(wu, ["Wu"], { features: ["viejo"], present: true }),
    known(lin, ["Lin"], { features: ["vieja"] }),
    known(ghost, ["el maestro"], { features: ["maestro de la secta"], phantom: true }),
  ];
  const ctx = {
    actor: me,
    source: "player" as const,
    catalog,
    known: cast,
    clock: EARTHLIKE_CLOCK,
    causes: [],
  };
  const desc = (text: string) => ({ text, features: [] });
  const speech = (s: NonNullable<IntentDraft["speech"]>): IntentDraft => ({
    kind: "act",
    speech: s,
  });

  it("una creencia sobre algo que no existe se usa igual y queda marcada aparte", () => {
    const r = planFromDraft(
      {
        kind: "act",
        plan: { kind: "do", verb: "take", args: [{ role: "from", ref: desc("el maestro") }] },
      },
      ctx,
    );
    expect(r.kind).toBe("plan");
    if (r.kind !== "plan") return;
    expect(r.phantoms).toEqual(["plan.from"]);
    expect(r.plan.root.kind === "do" && r.plan.root.args[0]).toEqual({
      role: "from",
      entity: ghost,
    });
  });

  it("el acto de habla viaja como argumento de speak con las referencias resueltas", () => {
    const r = planFromDraft(
      speech({
        text: "¿Dónde anda Lin?",
        to: desc("Wu"),
        act: { kind: "ask", about: desc("Lin") },
      }),
      ctx,
    );
    expect(r.kind === "plan" && r.plan.root.kind === "do" && r.plan.root.args[1]).toEqual({
      role: "content",
      text: "¿Dónde anda Lin?",
      act: { kind: "ask", about: lin },
    });
    // Sin destinatario, al único presente, y el acto también viaja.
    const hi = planFromDraft(speech({ text: "Buenas", act: { kind: "greet" } }), ctx);
    expect(hi.kind === "plan" && hi.plan.root.kind === "do" && hi.plan.root.args[1]).toMatchObject({
      act: { kind: "greet" },
    });
  });

  it("contar algo de quien no conoce frena; preguntar por quien no conoce no", () => {
    const tell = planFromDraft(
      speech({
        text: "Murió Zhao",
        to: desc("Wu"),
        act: { kind: "tell", about: desc("Zhao"), claim: "dead" },
      }),
      ctx,
    );
    expect(tell.kind).toBe("unknown");
    const ask = planFromDraft(
      speech({ text: "¿Y Zhao?", to: desc("Wu"), act: { kind: "ask", about: desc("Zhao") } }),
      ctx,
    );
    expect(
      ask.kind === "plan" && ask.plan.root.kind === "do" && ask.plan.root.args[1],
    ).toMatchObject({ act: { kind: "ask", about: null } });
  });

  it("la aclaración se pregunta con lo que el personaje percibió", () => {
    const twins = [
      known(wu, ["Wu"], { features: ["viejo", "vende té"] }),
      known(lin, ["Lin"], { features: ["viejo", "duerme detrás"] }),
    ];
    const r = planFromDraft(
      {
        kind: "act",
        plan: { kind: "do", verb: "take", args: [{ role: "from", ref: desc("el viejo") }] },
      },
      { ...ctx, known: twins },
    );
    expect(r.kind).toBe("clarify");
    if (r.kind !== "clarify") return;
    const resolved = r.refs[0]?.resolved;
    expect(resolved?.status).toBe("ambiguous");
    if (resolved?.status !== "ambiguous") return;
    const q = clarifyQuestion(resolved.clarify);
    expect(q).toContain("vende té");
    expect(q).toContain("duerme detrás");
    expect(q.startsWith("¿")).toBe(true);
    expect(clarifyQuestion(resolved.clarify)).toBe(q);
  });
});
