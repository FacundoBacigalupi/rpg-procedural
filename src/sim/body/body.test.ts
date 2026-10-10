import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AgentId,
  EARTHLIKE_CLOCK,
  type EventId,
  EventLog,
  IdAllocator,
  loadContent,
  makeId,
  Rng,
} from "../../core/index.ts";
import { TRAITS } from "../family/index.ts";
import { Scheduler } from "../scheduler/index.ts";
import { ENTITY, WorldTruth } from "../world/index.ts";
import {
  advanceBody,
  type Blow,
  BODY_PLANS,
  BODY_STATE,
  type Body,
  type BodyPlanDef,
  blowFromMishap,
  blowFromStrike,
  bodyProcess,
  bodySigns,
  capabilitiesOf,
  type DeathCause,
  FOODS,
  ingest,
  injure,
  massOf,
  newBody,
  setActivity,
  treat,
} from "./index.ts";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const content = loadContent(
  [BODY_PLANS, FOODS, TRAITS],
  [
    { kind: "body-plans", file: "b.json", data: json("content/body-plans/human.json") },
    { kind: "foods", file: "f.json", data: json("content/foods/wild.json") },
    { kind: "traits", file: "t.json", data: json("content/traits/human.json") },
  ],
);
const plan = content.all(BODY_PLANS)[0] as BodyPlanDef;
const HOUR = 3600;
const DAY = EARTHLIKE_CLOCK.day;
const me = makeId("agent", 1);
const hit = makeId("event", 7) as EventId;

const fresh = (): Body => newBody(plan, 55, 0);
const blow = (over: Partial<Blow>): Blow => ({
  kind: "cut",
  force: 0.5,
  cause: hit,
  at: 0,
  ...over,
});

/** Avanza día por día dándole de comer y beber lo que pide (sin hambre ni sed de por medio). */
function careFor(b: Body, days: number, opts: { food?: boolean; water?: boolean } = {}) {
  const happenings = [];
  let body = b;
  for (let d = 0; d < days && !body.death; d++) {
    const r = advanceBody(plan, me, body, body.updatedAt + DAY);
    happenings.push(...r.happenings);
    body = r.body;
    if (!body.death) {
      body = ingest(
        plan,
        body,
        opts.food === false ? 0 : 1800,
        opts.water === false ? 0 : body.water,
      );
    }
  }
  return { body, happenings };
}

describe("contenido", () => {
  it("el plan humano carga y sus zonas cubren el cuerpo", () => {
    expect(plan.zones.map((z) => z.id)).toContain("head");
    const loco = plan.zones.reduce((s, z) => s + (z.functions.locomotion ?? 0), 0);
    expect(loco).toBeCloseTo(1, 5);
  });

  it("la masa sale de talla, constitución y edad", () => {
    const traits = content.all(TRAITS);
    const adult = massOf(plan, { height: 154, constitution: 0.5 }, traits, "female", 30);
    expect(adult).toBeCloseTo(55, 5);
    const stunted = massOf(plan, { height: 154, constitution: 0.5 }, traits, "female", 30, 0.9);
    expect(stunted).toBeCloseTo(55 * 0.81, 5);
    expect(massOf(plan, { height: 170, constitution: 0.7 }, traits, "male", 30)).toBeGreaterThan(
      adult,
    );
    expect(massOf(plan, { height: 154, constitution: 0.5 }, traits, "female", 6)).toBeLessThan(25);
  });
});

describe("reservas", () => {
  it("el sudor sostenido suma agua perdida y sin sudor no cambia nada", () => {
    const base = advanceBody(plan, me, fresh(), DAY).body.water;
    const same = advanceBody(plan, me, fresh(), DAY, undefined, 0).body.water;
    const sweaty = advanceBody(plan, me, fresh(), DAY, undefined, 0.1).body.water;
    expect(same).toBe(base);
    expect(sweaty - base).toBeCloseTo(2.4, 1);
  });
  it("un día sano en reposo no pasa nada y gasta lo esperable", () => {
    const { body, happenings } = advanceBody(plan, me, fresh(), DAY);
    expect(happenings).toEqual([]);
    expect(body.consciousness).toBe("alert");
    expect(body.water).toBeCloseTo(2.4, 1);
    expect(body.glycogen).toBeLessThan(fresh().glycogen);
    expect(body.fat).toBe(fresh().fat);
  });

  it("el agua va a la medida de la masa: un bebé no se deshidrata en una noche", () => {
    const baby = newBody(plan, 4, 0);
    const { body } = advanceBody(plan, me, setActivity(baby, "sleep"), 9 * HOUR);
    expect(body.death).toBeNull();
    expect(body.water).toBeLessThan(0.4 * plan.physiology.lethalDehydration * 4);
  });

  it("sin comer se vacía el glucógeno, después la grasa, después el músculo, y muere de hambre", () => {
    let body = fresh();
    let prev = body;
    let died = null;
    for (let h = 0; h < 200 * 24 && !body.death; h++) {
      const r = advanceBody(plan, me, body, body.updatedAt + HOUR);
      body = r.body;
      if (body.fat < prev.fat) expect(body.glycogen).toBe(0);
      if (body.muscle < prev.muscle) expect(body.fat).toBe(0);
      for (const x of r.happenings) if (x.kind === "died") died = x;
      if (!body.death) body = ingest(plan, body, 0, body.water);
      prev = body;
    }
    expect(died?.kind === "died" && died.cause).toBe("starvation");
    const days = (body.updatedAt / DAY) | 0;
    expect(days).toBeGreaterThan(40);
    expect(days).toBeLessThan(110);
    expect(died?.kind === "died" && died.causes).toEqual([
      { kind: "state", entity: me, key: "body.food" },
    ]);
  });

  it("sin agua muere de sed en pocos días", () => {
    const { body, happenings } = careFor(fresh(), 10, { water: false });
    expect(body.death?.cause).toBe("dehydration");
    expect(body.death?.at).toBeGreaterThan(2.5 * DAY);
    expect(body.death?.at).toBeLessThan(5 * DAY);
    expect(happenings.some((h) => h.kind === "collapsed")).toBe(true);
  });

  it("dormir paga la deuda de sueño y descansar baja la fatiga", () => {
    let body = setActivity(fresh(), "heavy");
    body = advanceBody(plan, me, body, 8 * HOUR).body;
    expect(body.fatigue).toBeGreaterThan(0.5);
    expect(body.sleepDebt).toBeGreaterThan(2);
    body = advanceBody(plan, me, setActivity(body, "sleep"), 16 * HOUR).body;
    expect(body.fatigue).toBe(0);
    expect(body.sleepDebt).toBe(0);
  });

  it("comer llena el glucógeno y lo que sobra va a grasa", () => {
    const hungry = { ...fresh(), glycogen: 0 };
    const fed = ingest(plan, hungry, 3000, 1);
    expect(fed.glycogen).toBe(plan.physiology.glycogenKcal);
    expect(fed.fat).toBeCloseTo(hungry.fat + 0.9 * 1200, 6);
  });
});

describe("sangre", () => {
  const at = (blood: number) => advanceBody(plan, me, { ...fresh(), blood }, 1).body;

  it("los umbrales: 15% no se nota, 30% palidez y mareo, 40% cae, 50% muere", () => {
    expect(at(0.85).consciousness).toBe("alert");
    expect(bodySigns(plan, at(0.85)).general).not.toContain("pale");
    expect(at(0.69).consciousness).toBe("dazed");
    expect(bodySigns(plan, at(0.69)).general).toContain("pale");
    expect(at(0.59).consciousness).toBe("unconscious");
    expect(at(0.49).death?.cause).toBe("exsanguination");
  });

  it("una arteria abierta en la pierna mata en horas si nadie la venda; vendada, no", () => {
    let body: Body | undefined;
    for (let s = 0; !body; s++) {
      const r = injure(plan, fresh(), blow({ force: 0.8, zone: "left_leg" }), Rng.root(s));
      if (r.wound.arterial) body = r.body;
    }
    const open = advanceBody(plan, me, body, 6 * HOUR);
    expect(open.body.death?.cause).toBe("exsanguination");
    expect(open.happenings.find((h) => h.kind === "died")).toMatchObject({
      causes: [{ kind: "event", event: hit }],
    });
    const wound = body.wounds[0]?.id as number;
    const bound = advanceBody(plan, me, treat(body, wound, "bandage"), 6 * HOUR);
    expect(bound.body.death).toBeNull();
  });

  it("más sangrado sin tratar nunca deja más sangre", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const make = (bleeding: number) => {
            const r = injure(plan, fresh(), blow({ force: 0.3, zone: "right_arm" }), Rng.root(1));
            return {
              ...r.body,
              wounds: r.body.wounds.map((w) => ({ ...w, bleeding, virulence: 0 })),
            };
          };
          const end = (bleeding: number) => advanceBody(plan, me, make(bleeding), 12 * HOUR).body;
          const x = end(lo);
          const y = end(hi);
          expect(y.blood).toBeLessThanOrEqual(x.blood + 1e-12);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("heridas e infección", () => {
  it("limpiar nunca sube la infección, en ningún momento", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        (seed, force) => {
          const r = injure(
            plan,
            fresh(),
            blow({ force, zone: "abdomen", kind: "puncture" }),
            Rng.root(seed),
          );
          const id = r.wound.id;
          let dirty = r.body;
          let clean = treat(r.body, id, "clean");
          for (let d = 0; d < 12 && !dirty.death && !clean.death; d++) {
            dirty = ingest(plan, advanceBody(plan, me, dirty, dirty.updatedAt + DAY).body, 1800, 3);
            clean = ingest(plan, advanceBody(plan, me, clean, clean.updatedAt + DAY).body, 1800, 3);
            const i = (b: Body) => b.wounds[0]?.infection ?? 0;
            // Quien muere queda congelado en su instante: si los dos mueren el mismo día, el sucio
            // (que muere antes) se queda con menos infección que el limpio, que siguió unas horas.
            if (dirty.death || clean.death) break;
            if (dirty.wounds[0]?.stage !== "healed" && clean.wounds[0]?.stage !== "healed") {
              expect(i(clean)).toBeLessThanOrEqual(i(dirty) + 1e-9);
            }
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  /** Fracción de muertes y por qué, sobre muchas heridas iguales con distinto rng. */
  function mortality(b: Partial<Blow>, cleaned: boolean, n = 400) {
    const causes: Partial<Record<DeathCause, number>> = {};
    for (let s = 0; s < n; s++) {
      const r = injure(plan, fresh(), blow(b), Rng.root(s).fork("body", me, hit));
      const start = cleaned ? treat(r.body, r.wound.id, "clean") : r.body;
      const { body } = careFor(start, 60);
      if (body.death) causes[body.death.cause] = (causes[body.death.cause] ?? 0) + 1;
    }
    const deaths = Object.values(causes).reduce((s, x) => s + x, 0);
    return { rate: deaths / n, causes };
  }

  it("una herida grave sin tratar mata a ~1 de cada 3, sobre todo por infección", () => {
    const { rate, causes } = mortality({ kind: "cut", force: 0.7, zone: "left_leg" }, false);
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.45);
    expect(causes.sepsis ?? 0).toBeGreaterThan(causes.exsanguination ?? 0);
  });

  it("una herida leve y limpia casi nunca mata", () => {
    const { rate } = mortality({ kind: "cut", force: 0.12, zone: "right_arm" }, true);
    expect(rate).toBeLessThan(0.02);
  });

  it("lo que cierra deja cicatriz si fue hondo", () => {
    const r = injure(
      plan,
      fresh(),
      blow({ kind: "blunt", force: 0.6, zone: "right_arm" }),
      Rng.root(3),
    );
    const clean = treat(r.body, r.wound.id, "clean");
    const { body, happenings } = careFor(
      { ...clean, wounds: clean.wounds.map((w) => ({ ...w, virulence: 0 })) },
      120,
    );
    expect(body.wounds[0]?.stage).toBe("healed");
    expect(happenings.some((h) => h.kind === "healed")).toBe(true);
    if ((body.wounds[0]?.severity ?? 0) >= 0.3) expect(body.scars).toHaveLength(1);
  });

  it("un golpe muy fuerte en la cabeza mata en el acto; uno fuerte deja sin sentido", () => {
    let killed = false;
    let knocked = false;
    for (let s = 0; s < 50; s++) {
      const r = injure(plan, fresh(), blow({ kind: "blunt", force: 1, zone: "head" }), Rng.root(s));
      if (r.died === "brain_trauma") killed = true;
      else if (r.body.consciousness === "unconscious") knocked = true;
    }
    expect(killed && knocked).toBe(true);
  });
});

describe("capacidades y síntomas", () => {
  it("una pierna rota hace cojear; un brazo herido baja la manipulación", () => {
    const leg = {
      ...injure(plan, fresh(), blow({ kind: "blunt", force: 0.8, zone: "left_leg" }), Rng.root(2))
        .body,
    };
    const broken = {
      ...leg,
      wounds: leg.wounds.map((w) => ({ ...w, fracture: true, bleeding: 0 })),
    };
    const caps = capabilitiesOf(plan, broken);
    expect(caps.locomotion).toBeLessThan(0.7);
    expect(caps.manipulation).toBeGreaterThan(caps.locomotion);
    expect(bodySigns(plan, broken).general).toContain("limping");
    const arm = injure(
      plan,
      fresh(),
      blow({ kind: "cut", force: 0.6, zone: "right_arm" }),
      Rng.root(2),
    ).body;
    expect(capabilitiesOf(plan, arm).manipulation).toBeLessThan(0.85);
  });

  it("sin sentido no puede nada", () => {
    const caps = capabilitiesOf(plan, { ...fresh(), consciousness: "unconscious" });
    expect(Object.values(caps).every((v) => v === 0)).toBe(true);
  });

  it("los síntomas son etiquetas: nunca un número del cuerpo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 20 }),
        (seed, hours) => {
          const r = injure(plan, fresh(), blow({ force: 0.6 }), Rng.root(seed));
          const b = advanceBody(plan, me, r.body, hours * HOUR).body;
          expect(JSON.stringify(bodySigns(plan, b))).not.toMatch(/\d/);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("los golpes de la resolución y los percances se vuelven heridas", () => {
    const strike = {
      kind: "strike",
      target: me,
      committed: true,
      hit: true,
      glancing: true,
      force: 0.5,
      offBalance: false,
    } as const;
    expect(blowFromStrike(strike, hit, 0)?.force).toBeCloseTo(0.2, 9);
    expect(blowFromStrike({ ...strike, hit: false }, hit, 0)).toBeNull();
    const fell = { kind: "move", from: 0, to: 1, reached: 1, stumbled: true } as const;
    expect(blowFromMishap(fell, hit, 0, Rng.root(1))?.kind).toBe("blunt");
    expect(blowFromMishap({ ...fell, stumbled: false }, hit, 0, Rng.root(1))).toBeNull();
  });
});

describe("en el scheduler", () => {
  function run(seed: number) {
    const truth = new WorldTruth();
    const ids = new IdAllocator();
    const log = new EventLog();
    const place = { kind: "settlement", settlement: makeId("settlement", 1) } as const;
    const genesis = ids.next("event");
    log.append({
      id: genesis,
      tick: 0,
      kind: "genesis",
      actors: [],
      place,
      data: null,
      emissions: {},
      causes: [{ kind: "seed" }],
      resolution: "local",
    });
    const wounded: AgentId[] = [];
    for (let n = 0; n < 6; n++) {
      const id = ids.next("agent");
      truth.set(ENTITY, id, { id, originEventId: genesis, createdAt: 0 });
      let body = newBody(plan, 50 + n * 3, 0);
      if (n % 2 === 0) {
        const struck = ids.next("event");
        log.append({
          id: struck,
          tick: 0,
          kind: "strike",
          actors: [id],
          place,
          data: null,
          emissions: {},
          causes: [{ kind: "event", event: genesis }],
          resolution: "local",
        });
        const rng = Rng.root(seed).fork("body", id, struck);
        const hurt = injure(
          plan,
          body,
          blow({ force: 0.9, cause: struck, zone: "left_leg", kind: "cut" }),
          rng,
        ).body;
        // Una arteria abierta y sin vendar: muere desangrado dentro de la ventana.
        body = { ...hurt, wounds: hurt.wounds.map((w) => ({ ...w, arterial: true, bleeding: 3 })) };
        wounded.push(id);
      }
      truth.set(BODY_STATE, id, body);
    }
    const scheduler = new Scheduler({
      rng: Rng.root(seed),
      clock: EARTHLIKE_CLOCK,
      truth,
      ids,
      log,
      processes: [bodyProcess({ plans: [plan], placeOf: () => place })],
      resolution: "local",
      scopes: (kind, t) => (kind === "agent" ? (t.ids(BODY_STATE) as AgentId[]) : []),
    });
    scheduler.advanceTo(2 * DAY);
    return { truth, log, wounded };
  }

  it("es determinista y toda muerte cita su herida y cierra la entidad", () => {
    const a = run(11);
    const b = run(11);
    expect(JSON.stringify(a.truth.rows())).toBe(JSON.stringify(b.truth.rows()));
    const deaths = a.log.all().filter((e) => e.kind === "body.died");
    expect(deaths.length).toBeGreaterThan(0);
    for (const d of deaths) {
      const who = d.actors[0] as AgentId;
      expect(a.wounded).toContain(who);
      expect(a.truth.get(ENTITY, who)?.endEventId).toBe(d.id);
      expect(d.causes.some((c) => c.kind === "event")).toBe(true);
      // La cadena llega hasta el golpe que la empezó.
      expect(a.log.ancestors(d.id).some((e) => a.log.get(e)?.kind === "strike")).toBe(true);
    }
  });

  it("el calor da más sed y el frío más hambre que el confort", () => {
    const run = (c: number) => advanceBody(plan, me, fresh(), DAY, () => c).body;
    const mild = run(18);
    const hot = run(36);
    const cold = run(-5);
    expect(hot.water).toBeGreaterThan(mild.water);
    expect(cold.glycogen + cold.fat).toBeLessThan(mild.glycogen + mild.fat);
    expect(advanceBody(plan, me, fresh(), DAY).body).toEqual(mild);
  });
});
