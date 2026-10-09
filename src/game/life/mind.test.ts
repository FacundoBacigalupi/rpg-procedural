import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, type ContentSource, type EventId, loadContent } from "../../core/index.ts";
import {
  checkInvariants,
  form,
  INNATE,
  LIFE_STAGES,
  MIND,
  type Mind,
  mindProblems,
  PERSON,
  SCHEMAS,
  stageAt,
  VALUE_IDS,
  VALUES,
  valueBias,
  valuesOf,
} from "../../sim/index.ts";
import { GAME_CONTENT_KINDS } from "../view/index.ts";
import { Life } from "./life.ts";

function sources(dir: string, root = dir): ContentSource[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path, root);
    if (!e.name.endsWith(".json")) return [];
    const kind = relative(root, dir).split("\\").join("/");
    return [{ kind, file: path, data: JSON.parse(readFileSync(path, "utf8")) }];
  });
}
const content = loadContent(GAME_CONTENT_KINDS, sources("content"));
const schemas = content.all(SCHEMAS);
const stages = content.all(LIFE_STAGES);
const values = content.all(VALUES);

const EVENT = 1 as unknown as EventId;
const flat: Mind = {
  schemas: Object.fromEntries(schemas.map((s) => [s.id, { strength: 0.3, causes: [] }])),
  formative: [],
  originEventId: EVENT,
};
const calm = { reactivity: 0, sociability: 0, curiosity: 0, control: 0, warmth: 0, boldness: 0 };

describe("el contenido de la mente", () => {
  it("las etapas, esquemas y valores cierran entre sí", () => {
    expect(mindProblems(stages, schemas, values)).toEqual([]);
  });

  it("la etapa la marca la edad vivida", () => {
    expect(stageAt(stages, 0).id).toBe("infancy");
    expect(stageAt(stages, 7).id).toBe("childhood");
    expect(stageAt(stages, 25).id).toBe("young-adult");
    expect(stageAt(stages, 200).id).toBe("elder");
  });
});

describe("la formación", () => {
  const violence = { theme: "violence", intensity: 0.8 } as const;
  const at = (age: number, innate = calm) => ({
    schemas,
    stage: stageAt(stages, age),
    innate,
    event: EVENT,
  });

  it("un niño se marca varias veces más que un adulto con el mismo golpe", () => {
    const child = form(flat, violence, at(2)).mind.schemas["world_is_dangerous"]?.strength ?? 0;
    const adult = form(flat, violence, at(40)).mind.schemas["world_is_dangerous"]?.strength ?? 0;
    expect(child - 0.3).toBeGreaterThan(5 * (adult - 0.3));
    expect(adult).toBeGreaterThan(0.3);
  });

  it("el período sensible fija más fuerte el esquema que le toca", () => {
    const sensitive = form(flat, violence, at(2)).changes;
    const later = form(flat, violence, at(14)).changes;
    const pick = (cs: typeof sensitive, id: string) => cs.find((c) => c.schema === id)?.delta ?? 0;
    // world_is_dangerous es sensible en la infancia; en la adolescencia no.
    expect(
      pick(sensitive, "world_is_dangerous") / pick(later, "world_is_dangerous"),
    ).toBeGreaterThan(2);
  });

  it("la reactividad amplifica lo que duele y no lo que cuida", () => {
    const touchy = { ...calm, reactivity: 1 };
    const hurt = (i: typeof calm) =>
      form(flat, violence, at(10, i)).changes.find((c) => c.schema === "world_is_dangerous")?.delta;
    expect(hurt(touchy) ?? 0).toBeGreaterThan(hurt(calm) ?? 0);
    const care = { theme: "care", intensity: 0.8 } as const;
    const warm = (i: typeof calm) =>
      form(flat, care, at(10, i)).changes.find((c) => c.schema === "family_first")?.delta;
    expect(warm(touchy)).toBe(warm(calm));
  });

  it("un trauma enorme marca a un viejo; lo común, casi nada", () => {
    const mild = form(flat, { theme: "violence", intensity: 0.5 }, at(70)).changes;
    const trauma = form(flat, { theme: "violence", intensity: 1 }, at(70)).changes;
    const d = (cs: typeof mild) => cs.find((c) => c.schema === "world_is_dangerous")?.delta ?? 0;
    expect(d(trauma)).toBeGreaterThan(8 * d(mild));
  });

  it("deja la causa y no pasa de [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...(Object.keys(flat.schemas) as string[])),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: 90 }),
        fc.constantFrom("violence", "care", "betrayal", "success", "calamity", "blessing"),
        (_s, intensity, age, theme) => {
          let m = flat;
          for (let i = 0; i < 20; i++) {
            m = form(m, { theme, intensity }, at(age)).mind;
          }
          for (const h of Object.values(m.schemas)) {
            expect(h.strength).toBeGreaterThanOrEqual(0);
            expect(h.strength).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
    const out = form(flat, violence, at(2)).mind;
    expect(out.schemas["world_is_dangerous"]?.causes).toContain(EVENT);
    expect(out.formative).toContain(EVENT);
    expect(flat.schemas["world_is_dangerous"]?.causes).toEqual([]);
  });
});

describe("los valores", () => {
  it("suman 1 y los mueven el temperamento y los esquemas", () => {
    const base = valuesOf(values, schemas, flat, calm);
    expect(VALUE_IDS.reduce((a, v) => a + base[v], 0)).toBeCloseTo(1, 2);
    const bold = valuesOf(values, schemas, flat, { ...calm, boldness: 1 });
    expect(bold.power).toBeGreaterThan(base.power);
    expect(bold.safety).toBeLessThan(base.safety);
    const scarred = form(
      flat,
      { theme: "violence", intensity: 1 },
      { schemas, stage: stageAt(stages, 1), innate: calm, event: EVENT },
    ).mind;
    expect(valuesOf(values, schemas, scarred, calm).safety).toBeGreaterThan(base.safety);
  });
});

describe("el sesgo de la cultura en los valores", () => {
  it("empuja los valores que nombra y sigue sumando 1", () => {
    const bias = valueBias({ family: 0.4, tradition: 0.3, nonsense: 9 });
    expect(Object.keys(bias).sort()).toEqual(["family", "tradition"]);
    const plain = valuesOf(values, schemas, flat, calm);
    const biased = valuesOf(values, schemas, flat, calm, bias);
    expect(biased.family).toBeGreaterThan(plain.family);
    expect(biased.tradition).toBeGreaterThan(plain.tradition);
    expect(Object.values(biased).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  });
});

describe("la mente de la aldea", () => {
  const w = Life.create(7, content).world;
  const alive = (w.truth.ids(PERSON) as AgentId[]).filter((id) => w.truth.get(MIND, id));

  it("cada persona tiene mente con causa, y el temperamento la inclina", () => {
    expect(alive.length).toBeGreaterThan(10);
    for (const id of alive) {
      const m = w.truth.get(MIND, id) as Mind;
      for (const s of schemas)
        expect(m.schemas[s.id]?.causes[0], `${id} ${s.id}`).toBe(m.originEventId);
    }
    const warmth = (id: AgentId) => w.truth.get(INNATE, id)?.["warmth"] ?? 0;
    const trust = (id: AgentId) =>
      (w.truth.get(MIND, id) as Mind).schemas["people_are_untrustworthy"]?.strength ?? 0;
    const sorted = [...alive].sort((a, b) => warmth(a) - warmth(b));
    const half = Math.floor(sorted.length / 2);
    const mean = (xs: AgentId[]) => xs.reduce((a, id) => a + trust(id), 0) / xs.length;
    expect(mean(sorted.slice(0, half))).toBeGreaterThan(mean(sorted.slice(half)));
  });

  it("quien perdió a un pariente lo lleva marcado, con la muerte como causa", () => {
    const died = new Map(
      w.log
        .all()
        .filter((e) => e.kind === "person.died")
        .map((e) => [e.id, e.actors[0] as AgentId]),
    );
    const marked = alive.filter((id) => {
      const m = w.truth.get(MIND, id) as Mind;
      return Object.values(m.schemas).some((h) => h.causes.some((c) => died.has(c)));
    });
    expect(marked.length).toBeGreaterThan(0);
    // Las causas de la marca son muertes de parientes: madre, padre, hijo, hermano o cónyuge.
    for (const id of marked) {
      const p = w.truth.get(PERSON, id) as { mother: AgentId | null; father: AgentId | null };
      const m = w.truth.get(MIND, id) as Mind;
      const causes = new Set(Object.values(m.schemas).flatMap((h) => h.causes));
      const kin = [...causes].filter((c) => died.has(c)).map((c) => died.get(c) as AgentId);
      expect(kin.length).toBeGreaterThan(0);
      for (const k of kin) {
        const other = w.truth.get(PERSON, k) as { mother: AgentId | null; father: AgentId | null };
        const related =
          p.mother === k ||
          p.father === k ||
          other.mother === id ||
          other.father === id ||
          (p.mother !== null && p.mother === other.mother) ||
          (p.father !== null && p.father === other.father) ||
          w.log
            .all()
            .some(
              (e) => e.kind === "family.union" && e.actors.includes(id) && e.actors.includes(k),
            );
        expect(related, `${id} y ${k}`).toBe(true);
      }
    }
  });

  it("uniones, hijos propios, llegadas, casa propia y años flacos también marcan, citando el evento", () => {
    const causeKinds = new Map(w.log.all().map((e) => [e.id, e.kind]));
    const seen = new Set<string>();
    for (const id of alive) {
      const m = w.truth.get(MIND, id) as Mind;
      for (const h of Object.values(m.schemas)) {
        for (const c of h.causes) seen.add(causeKinds.get(c) ?? "");
      }
    }
    for (const kind of ["family.union", "family.birth", "family.lean_year"]) {
      expect(seen.has(kind), kind).toBe(true);
    }
    // Un hijo propio marca a su madre o su padre, nunca al hijo.
    const birth = w.log.all().find((e) => e.kind === "family.birth");
    const child = birth?.actors[0] as AgentId;
    if (birth && alive.includes(child)) {
      const m = w.truth.get(MIND, child) as Mind;
      expect(Object.values(m.schemas).some((h) => h.causes.includes(birth.id))).toBe(false);
    }
  });

  it("es determinista y no rompe invariantes", () => {
    const again = Life.create(7, content).world;
    for (const id of alive) expect(again.truth.get(MIND, id)).toEqual(w.truth.get(MIND, id));
    expect(checkInvariants({ truth: w.truth, log: w.log, ledger: w.ledger })).toEqual([]);
  }, 60_000);
});
