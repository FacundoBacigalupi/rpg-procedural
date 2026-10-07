import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EARTHLIKE_CLOCK, loadContent, makeId, Rng } from "../../core/index.ts";
import {
  ACTIONS,
  type ActionDef,
  type Attempt,
  type AttemptInput,
  attempt,
  PLANS,
} from "../actions/index.ts";
import { INNATE, PERSON, TRAITS } from "../family/index.ts";
import { ENTITY, WorldTruth } from "../world/index.ts";
import {
  ageFactor,
  ceilingOf,
  challengeFit,
  feedbackOf,
  LEARNING_EDGE,
  type Learner,
  learnFromAttempt,
  levelOf,
  opposingSkill,
  practice,
  SKILL_STATE,
  SKILLS,
  SkillCatalog,
  type SkillState,
  seedSkills,
  upbringingSkills,
  verbSkill,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const sources = (skills: unknown = json("content/skills/core.json")) => [
  { kind: "actions", file: "a.json", data: json("content/actions/core.json") },
  { kind: "skills", file: "s.json", data: skills },
  { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
];
const content = loadContent([ACTIONS, PLANS, SKILLS, TRAITS], sources());
const verbs = content.all(ACTIONS);
const catalog = new SkillCatalog(content.all(SKILLS), verbs);
const verb = (id: string) => verbs.find((v) => v.id === id) as ActionDef;
const skill = (id: string) => catalog.skill(id) as NonNullable<ReturnType<SkillCatalog["skill"]>>;

const me = makeId("agent", 1);
const adult: Learner = { z: {}, capabilities: {}, ageYears: 25 };
const YEAR = EARTHLIKE_CLOCK.year;

/** Una tirada armada a mano: lo que importa para aprender. */
const roll = (over: Partial<Attempt>): Attempt => ({
  outcome: "success",
  margin: 1,
  expected: LEARNING_EDGE,
  factors: [],
  failure: null,
  unmet: null,
  noticedBy: [],
  believed: "success",
  cues: [],
  ...over,
});

const hoursOf = (s: SkillState | undefined) => s?.hours ?? 0;

describe("catálogo", () => {
  it("el contenido carga y todo verbo que tira usa una habilidad, salvo comer, beber, guardar, esperar y descansar", () => {
    const without = verbs.filter((v) => !catalog.forVerb(v.id)).map((v) => v.id);
    expect(without.sort()).toEqual(["drink", "eat", "rest", "store", "wait"]);
    expect(catalog.forVerb("look")?.skill.id).toBe("observation");
    expect(catalog.opposing("strike")?.skill.id).toBe("brawling");
    expect(catalog.opposing("take")?.skill.id).toBe("observation");
    const w = catalog.forVerb("strike")?.weights ?? {};
    expect(Object.values(w).reduce((s, x) => s + x, 0)).toBeCloseTo(1);
  });

  it("un verbo que nombra una habilidad inexistente no carga", () => {
    const skills = json("content/skills/core.json").filter(
      (s: { id: string }) => s.id !== "sleight",
    );
    expect(() => loadContent([ACTIONS, PLANS, SKILLS, TRAITS], sources(skills))).toThrow(
      /skills\/sleight no existe/,
    );
  });

  it("una aptitud que no es un rasgo no carga", () => {
    const skills = json("content/skills/core.json");
    skills[0].aptitudes[0].trait = "luck";
    expect(() => loadContent([ACTIONS, PLANS, SKILLS, TRAITS], sources(skills))).toThrow(/luck/);
  });

  it("un verbo que pide una faceta que la habilidad no tiene no arma el catálogo", () => {
    const bad = {
      ...verb("look"),
      skill: { id: "observation", facets: { composure: 1 }, intensity: 1 },
    };
    expect(() => new SkillCatalog(content.all(SKILLS), [bad])).toThrow(/composure/);
  });
});

describe("techo", () => {
  it("el talento sube el techo; el cuerpo baja solo las facetas del cuerpo", () => {
    const def = skill("sleight");
    const gifted: Learner = { ...adult, z: { control: 1.5, perception: 1.5 } };
    expect(ceilingOf(def, "execution", gifted)).toBeGreaterThan(ceilingOf(def, "execution", adult));
    const maimed: Learner = { ...adult, capabilities: { manipulation: 0.4 } };
    expect(ceilingOf(def, "execution", maimed)).toBeLessThan(ceilingOf(def, "execution", adult));
    expect(ceilingOf(def, "judgment", maimed)).toBe(ceilingOf(def, "judgment", adult));
  });

  it("la vejez baja la ejecución y no el juicio", () => {
    expect(ageFactor("execution", 75)).toBeLessThan(ageFactor("execution", 30));
    expect(ageFactor("judgment", 75)).toBe(ageFactor("judgment", 30));
    expect(ageFactor("judgment", 8)).toBeLessThan(ageFactor("judgment", 30));
  });

  it("ninguna práctica sube una faceta por encima de su techo", () => {
    const def = skill("brawling");
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            hours: fc.double({ min: 0, max: 5000, noNaN: true }),
            fb: fc.double({ min: 0, max: 1.5, noNaN: true }),
            fit: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { maxLength: 30 },
        ),
        fc.double({ min: -3, max: 3, noNaN: true }),
        (steps, t) => {
          const who: Learner = { ...adult, z: { constitution: t, perception: t } };
          let s: SkillState | undefined;
          for (const st of steps) {
            s = practice(def, s, who, {
              weights: { execution: 0.5, reading: 0.3, judgment: 0.2 },
              hours: st.hours,
              feedback: { execution: st.fb, reading: st.fb, judgment: st.fb },
              fit: st.fit,
              tick: 0,
            });
          }
          for (const f of def.facets) {
            expect(levelOf(s, f)).toBeLessThanOrEqual(ceilingOf(def, f, who) + 1e-12);
            expect(levelOf(s, f)).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });

  it("perder una capacidad deja el nivel arriba del techo y la práctica lo baja hacia él", () => {
    const def = skill("sleight");
    const dep = (hours: number) => ({
      weights: { execution: 1 },
      hours,
      feedback: { execution: 1 },
      fit: 1,
      tick: 0,
    });
    const trained = practice(def, undefined, adult, dep(20_000));
    const maimed: Learner = { ...adult, capabilities: { manipulation: 0.3 } };
    const ceiling = ceilingOf(def, "execution", maimed);
    const before = levelOf(trained, "execution");
    expect(before).toBeGreaterThan(ceiling);
    const a = practice(def, trained, maimed, dep(50));
    const b = practice(def, a, maimed, dep(50));
    const late = practice(def, b, maimed, dep(5_000));
    expect(levelOf(a, "execution")).toBeLessThan(before);
    // Más rápido al principio.
    expect(before - levelOf(a, "execution")).toBeGreaterThan(
      levelOf(a, "execution") - levelOf(b, "execution"),
    );
    expect(levelOf(late, "execution")).toBeGreaterThanOrEqual(ceiling);
    expect(levelOf(late, "execution")).toBeCloseTo(ceiling, 2);
    // El pico se guarda para la recuperación (Fase 3).
    expect(late.facets.execution?.peak).toBe(before);
  });
});

describe("curva", () => {
  const def = skill("farming");
  const dep = (hours: number, fit = 1) => ({
    weights: { execution: 0.6, reading: 0.2, judgment: 0.2 },
    hours,
    feedback: { execution: 1, reading: 1, judgment: 1 },
    fit,
    tick: 0,
  });

  it("un tramo largo da lo mismo que muchos chicos (forma cerrada)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.double({ min: 1, max: 400, noNaN: true }),
        (n, h) => {
          let pieces: SkillState | undefined;
          for (let i = 0; i < n; i++) pieces = practice(def, pieces, adult, dep(h));
          const whole = practice(def, undefined, adult, dep(n * h));
          for (const f of def.facets) expect(levelOf(pieces, f)).toBeCloseTo(levelOf(whole, f), 9);
          expect(hoursOf(pieces)).toBeCloseTo(n * h, 6);
        },
      ),
    );
  });

  it("rápido al principio, lento cerca del techo; el talento acelera", () => {
    const a = practice(def, undefined, adult, dep(500));
    const b = practice(def, a, adult, dep(500));
    expect(levelOf(a, "execution")).toBeGreaterThan(
      levelOf(b, "execution") - levelOf(a, "execution"),
    );
    const gifted: Learner = { ...adult, z: { constitution: 2, control: 2, intellect: 2 } };
    expect(levelOf(practice(def, undefined, gifted, dep(500)), "execution")).toBeGreaterThan(
      levelOf(a, "execution"),
    );
  });

  it("los tiempos son de una vida: competente en meses, maestro en décadas", () => {
    const at = (hours: number) => levelOf(practice(def, undefined, adult, dep(hours)), "execution");
    // Dos horas diarias de práctica ideal: competente antes del año.
    expect(at(1000)).toBeGreaterThan(0.25);
    expect(at(100)).toBeLessThan(0.15);
    // Diez años de jornadas no alcanzan el techo de un talento promedio.
    expect(at(20_000)).toBeLessThan(ceilingOf(def, "execution", adult));
  });

  it("la rutina enseña cada vez menos y queda por debajo de la práctica en el borde", () => {
    // La misma tarea fácil: el margen esperado sube con el nivel y la tarea deja de enseñar.
    const routine = (years: number) => {
      let s: SkillState | undefined;
      for (let i = 0; i < years * 12; i++) {
        const level = levelOf(s, "execution");
        s = practice(def, s, adult, dep(100, challengeFit(1.2 + 2.5 * level)));
      }
      return levelOf(s, "execution");
    };
    const deliberate = (years: number) =>
      levelOf(
        practice(def, undefined, adult, dep(years * 1200, challengeFit(LEARNING_EDGE))),
        "execution",
      );
    // Veinticinco años más de rutina dan menos que los primeros cinco.
    expect(routine(30) - routine(5)).toBeLessThan((routine(5) - routine(0)) / 3);
    // Y el que practica en el borde le saca una ventaja que la rutina no cierra.
    expect(deliberate(5) - routine(5)).toBeGreaterThan(0.1);
    expect(deliberate(30) - routine(30)).toBeGreaterThan(0.08);
  });
});

describe("aprender de lo percibido", () => {
  const move = verb("move");

  it("con el mismo fracaso real, el que lo notó aprende y el que no, no", () => {
    const seen = learnFromAttempt(
      catalog,
      undefined,
      adult,
      move,
      roll({ outcome: "failure", margin: -1, believed: "failure" }),
      3600,
      5,
    );
    const unseen = learnFromAttempt(
      catalog,
      undefined,
      adult,
      move,
      roll({ outcome: "failure_unnoticed", margin: -1, believed: "success" }),
      3600,
      5,
    );
    expect(unseen).toBeNull();
    expect(levelOf(seen?.["wayfinding"], "reading")).toBeGreaterThan(0);
    expect(seen?.["wayfinding"]?.lastPracticed).toBe(5);
  });

  it("fracasar entendiendo enseña más que acertar sin entender", () => {
    const understood = learnFromAttempt(
      catalog,
      undefined,
      adult,
      move,
      roll({ outcome: "failure", margin: -1, believed: "failure", cues: ["light"] }),
      3600,
      0,
    );
    const lucky = learnFromAttempt(
      catalog,
      undefined,
      adult,
      move,
      roll({ outcome: "success", margin: 1 }),
      3600,
      0,
    );
    for (const f of ["execution", "reading", "judgment"] as const) {
      expect(levelOf(understood?.["wayfinding"], f)).toBeGreaterThan(
        levelOf(lucky?.["wayfinding"], f),
      );
    }
    expect(
      feedbackOf(roll({ outcome: "failure", margin: -1, believed: "failure", cues: ["light"] }))
        .understood,
    ).toBe(true);
    expect(
      feedbackOf(roll({ outcome: "failure_suspected", margin: -1, believed: "unsure" })).amount,
    ).toBeLessThan(
      feedbackOf(roll({ outcome: "failure", margin: -1, believed: "failure" })).amount,
    );
  });

  it("lo que no se tiró no es práctica; esperar no entrena nada", () => {
    expect(
      learnFromAttempt(
        catalog,
        undefined,
        adult,
        move,
        roll({ margin: null, expected: null, outcome: "failure", believed: "failure" }),
        60,
        0,
      ),
    ).toBeNull();
    expect(learnFromAttempt(catalog, undefined, adult, verb("wait"), roll({}), 3600, 0)).toBeNull();
  });

  it("lejos del borde casi no enseña", () => {
    const at = (expected: number) =>
      levelOf(
        learnFromAttempt(catalog, undefined, adult, move, roll({ expected }), 3600, 0)?.[
          "wayfinding"
        ],
        "execution",
      );
    expect(at(LEARNING_EDGE)).toBeGreaterThan(at(LEARNING_EDGE + 3));
    expect(at(LEARNING_EDGE)).toBeGreaterThan(at(LEARNING_EDGE - 3));
  });

  it("un golpe enseña más por segundo que una hora de arar (intensidad)", () => {
    const blow = learnFromAttempt(catalog, undefined, adult, verb("strike"), roll({}), 5, 0);
    expect(blow?.["brawling"]?.hours).toBeCloseTo((5 / 3600) * 60);
  });

  it("practicar una habilidad no toca las otras", () => {
    const start = upbringingSkills(catalog, {}, 0, 20 * YEAR, EARTHLIKE_CLOCK);
    const after = learnFromAttempt(catalog, start, adult, move, roll({}), 3600, 0);
    expect(after?.["farming"]).toBe(start["farming"]);
    expect(levelOf(after?.["wayfinding"], "reading")).toBeGreaterThan(
      levelOf(start["wayfinding"], "reading"),
    );
  });

  it("es determinista", () => {
    const r = roll({ outcome: "partial", margin: 0, believed: "partial", cues: ["terrain"] });
    expect(learnFromAttempt(catalog, undefined, adult, move, r, 1800, 9)).toEqual(
      learnFromAttempt(catalog, undefined, adult, move, r, 1800, 9),
    );
  });
});

describe("en la tirada", () => {
  const input = (skillLevel: number, oppSkill = 0, tick = 0): AttemptInput => ({
    def: verb("strike"),
    node: {
      kind: "do",
      verb: "strike",
      args: [{ role: "target", entity: makeId("agent", 2) }],
      manner: [],
    },
    planManner: [],
    actor: { id: me, z: {}, capabilities: {}, hex: 0, skill: skillLevel },
    parties: { target: { id: makeId("agent", 2), z: {}, hex: 0, skill: oppSkill } },
    scene: { light: 1, terrain: 0, placeKinds: ["village"] },
    has: () => true,
    tick,
    rng: Rng.root(3),
  });
  const hits = (skillLevel: number, opp = 0) =>
    Array.from({ length: 400 }, (_, i) => attempt(input(skillLevel, opp, i))).filter(
      (r) => (r.margin ?? -9) >= 0.5,
    ).length;

  it("lo practicado suma al factor y al margen esperado", () => {
    const novice = attempt(input(0));
    const expert = attempt(input(0.6));
    expect(expert.expected ?? 0).toBeCloseTo((novice.expected ?? 0) + 1.5);
    expect(hits(0.6)).toBeGreaterThan(hits(0) + 100);
  });

  it("la habilidad del otro resta en la contienda abierta", () => {
    expect(hits(0.3, 0.6)).toBeLessThan(hits(0.3, 0) - 100);
  });

  it("verbSkill y opposingSkill leen las facetas del verbo", () => {
    const s = upbringingSkills(catalog, {}, 0, 30 * YEAR, EARTHLIKE_CLOCK);
    expect(verbSkill(catalog, s, "move")).toBeGreaterThan(0.3);
    expect(verbSkill(catalog, s, "wait")).toBe(0);
    expect(verbSkill(catalog, undefined, "move")).toBe(0);
    expect(opposingSkill(catalog, s, "take")).toBeCloseTo(levelOf(s["observation"], "reading"));
  });
});

describe("infancia en la aldea", () => {
  it("crece con la edad, se estanca en la adultez y la vejez baja la ejecución", () => {
    const at = (age: number) =>
      upbringingSkills(catalog, {}, 0, Math.round(age * YEAR), EARTHLIKE_CLOCK);
    const kid = at(8);
    const teen = at(15);
    const adultS = at(40);
    const old = at(85);
    expect(levelOf(teen["wayfinding"], "execution")).toBeGreaterThan(
      levelOf(kid["wayfinding"], "execution"),
    );
    expect(levelOf(adultS["farming"], "judgment")).toBeGreaterThan(
      levelOf(teen["farming"], "judgment"),
    );
    expect(levelOf(old["farming"], "execution")).toBeLessThan(
      levelOf(adultS["farming"], "execution"),
    );
    expect(levelOf(old["farming"], "judgment")).toBeGreaterThanOrEqual(
      levelOf(adultS["farming"], "judgment"),
    );
    // Nadie le enseña a robar a un chico de la aldea; a los 6 todavía no trabaja el campo.
    expect(teen["sleight"]).toBeUndefined();
    expect(at(6)["farming"]).toBeUndefined();
    // Lo cotidiano a los 15: más que novato, lejos de maestro.
    expect(levelOf(teen["wayfinding"], "reading")).toBeGreaterThan(0.2);
    expect(levelOf(teen["wayfinding"], "reading")).toBeLessThan(0.5);
  });

  it("el talento se nota", () => {
    const plain = upbringingSkills(catalog, {}, 0, 30 * YEAR, EARTHLIKE_CLOCK);
    const sharp = upbringingSkills(
      catalog,
      { perception: 2, curiosity: 1 },
      0,
      30 * YEAR,
      EARTHLIKE_CLOCK,
    );
    expect(levelOf(sharp["observation"], "reading")).toBeGreaterThan(
      levelOf(plain["observation"], "reading"),
    );
  });

  it("seedSkills siembra a los vivos de la aldea, determinista", () => {
    const seed = () => {
      const truth = new WorldTruth();
      const traits = content.all(TRAITS);
      const people = [
        { id: makeId("agent", 1), born: 0, ended: false },
        { id: makeId("agent", 2), born: 10 * YEAR, ended: false },
        { id: makeId("agent", 3), born: 0, ended: true },
      ];
      for (const p of people) {
        truth.set(ENTITY, p.id, {
          id: p.id,
          originEventId: makeId("event", 1),
          createdAt: p.born,
          ...(p.ended ? { endedAt: 20 * YEAR, endEventId: makeId("event", 2) } : {}),
        });
        truth.set(PERSON, p.id, {
          sex: "female",
          born: p.born,
          mother: null,
          father: null,
          household: makeId("household", 1),
          spouse: null,
        });
        truth.set(INNATE, p.id, Object.fromEntries(traits.map((t) => [t.id, t.mean])));
      }
      seedSkills(truth, catalog, traits, 30 * YEAR, EARTHLIKE_CLOCK);
      return truth;
    };
    const truth = seed();
    expect(truth.ids(SKILL_STATE)).toEqual([makeId("agent", 1), makeId("agent", 2)]);
    const older = truth.get(SKILL_STATE, makeId("agent", 1));
    const younger = truth.get(SKILL_STATE, makeId("agent", 2));
    expect(levelOf(older?.["farming"], "judgment")).toBeGreaterThan(
      levelOf(younger?.["farming"], "judgment"),
    );
    expect(seed().rows()).toEqual(truth.rows());
  });
});
