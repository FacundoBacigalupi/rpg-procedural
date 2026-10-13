import { describe, expect, it } from "vitest";
import { makeId } from "../../core/index.ts";
import { table, WorldTruth } from "../world/index.ts";
import { BatchTruth } from "./batch.ts";

const rows = table<{ n: number }>("test.batch_ids");

describe("BatchTruth.ids", () => {
  it("sin filas propias iguala a la base y con filas las mezcla en orden", () => {
    const t = new WorldTruth();
    const [a, b] = [1, 2].map((n) => makeId("agent", n));
    t.set(rows, b as never, { n: 2 });
    const batch = new BatchTruth(t);
    expect(batch.ids(rows)).toEqual(t.ids(rows));
    batch.apply({ op: "set", table: rows.name, id: a as never, value: { n: 1 } });
    expect(batch.ids(rows)).toEqual([a, b]);
  });
});
