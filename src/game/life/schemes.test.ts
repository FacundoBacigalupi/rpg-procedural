import { describe, expect, it } from "vitest";
import { makeId, Rng } from "../../core/index.ts";
import { ENTITY, PERSON, type SchemerView, WorldTruth } from "../../sim/index.ts";
import { SCHEMES, type SchemeSeed, schemeRows, schemesProcess } from "./schemes.ts";

const a = (n: number) => makeId("agent", n);
const ev = (n: number) => makeId("event", n);

const bold: SchemerView = {
  motiveStrength: 1,
  motive: "revenge",
  boldness: 1,
  warmth: 0,
  honor: 0,
  fear: 0,
  intellect: 0.5,
  believedTargetStrength: 0,
  believedLoot: 0.5,
  believedWitnesses: 0,
  affinity: -1,
};
const meek: SchemerView = { ...bold, boldness: 0, warmth: 1, honor: 1, fear: 1 };

const seed: SchemeSeed = {
  key: "s1",
  owner: a(1),
  target: a(2),
  motive: "revenge",
  origin: ev(5),
  startDay: 0,
};

function world(): WorldTruth {
  const t = new WorldTruth();
  for (const n of [1, 2]) {
    t.set(ENTITY, a(n), { id: a(n), originEventId: ev(1), createdAt: 0 } as never);
    t.set(PERSON, a(n), { household: `h${n}` } as never);
  }
  return t;
}

function run(view: SchemerView, days: number) {
  const truth = world();
  const p = schemesProcess({
    seeds: [seed],
    view: () => view,
    placeOf: () => ({ kind: "cell" }) as never,
    day: 10,
  });
  let n = 100;
  let recent: unknown[] = [];
  const kinds: string[] = [];
  const causes: unknown[] = [];
  for (let d = 0; d < days; d++) {
    let sn = 0;
    const r = p.run({
      truth,
      now: d * 10,
      recent,
      rng: Rng.root(7),
      newId: () => makeId("scheme", ++sn),
    } as never);
    recent = [];
    for (const c of r.changes ?? []) {
      const x = c as unknown as { table: string; id: never; value: unknown };
      truth.setRaw(x.table, x.id, x.value);
    }
    for (const e of r.events ?? []) {
      const id = ev(++n);
      kinds.push(e.kind);
      causes.push(e.causes);
      recent.push({ ...e, id });
    }
  }
  return { truth, kinds, causes };
}

describe("life.schemes", () => {
  it("un audaz con motivo traza: entidad scheme:1, pasos con causas y termina", () => {
    const { truth, kinds, causes } = run(bold, 12);
    expect(kinds[0]).toBe("scheme.started");
    expect(kinds.filter((k) => k === "scheme.step")).toHaveLength(4);
    const rows = schemeRows(truth);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.row.scheme.status).toBe("succeeded");
    expect(rows[0]?.row.scheme.log).toHaveLength(4);
    expect(truth.get(ENTITY, makeId("scheme", 1))?.originEventId).toBe(ev(5));
    // el 2.º paso cita al primero y al origen
    expect(JSON.stringify(causes[2])).toContain(String(rows[0]?.row.scheme.log[0]));
    expect(JSON.stringify(causes[1])).toContain(String(ev(5)));
  });

  it("un manso no traza: queda abandonada y no se vuelve a decidir", () => {
    const { truth, kinds } = run(meek, 6);
    expect(kinds).toEqual(["scheme.declined"]);
    expect(schemeRows(truth)[0]?.row.scheme.status).toBe("abandoned");
    expect(truth.ids(SCHEMES)).toHaveLength(1);
  });

  it("determinista: mismas corridas, mismo estado", () => {
    const x = run(bold, 12);
    const y = run(bold, 12);
    expect(JSON.stringify(schemeRows(x.truth))).toBe(JSON.stringify(schemeRows(y.truth)));
    expect(x.kinds).toEqual(y.kinds);
  });
});
