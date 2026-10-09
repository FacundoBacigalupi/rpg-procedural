import { describe, expect, it } from "vitest";
import type { EntityRef } from "../../core/index.ts";
import { diffSnapshots, formatSnapshotDiff, isEmptyDiff, snapshotTruth } from "./snapshot.ts";
import { table, WorldTruth } from "./truth.ts";

const T = table<{ n: number }>("demo.t");
const a = "agent:1" as EntityRef;
const b = "agent:2" as EntityRef;
const c = "agent:3" as EntityRef;

describe("diffSnapshots", () => {
  it("separa nacidos, idos, cambiados y presiones; sin cambios queda vacío", () => {
    const w = new WorldTruth();
    w.set(T, a, { n: 1 });
    w.set(T, b, { n: 2 });
    const s1 = snapshotTruth(w, 1, { "hunger@v": 0.2, "x@v": 0.5 });
    expect(
      isEmptyDiff(diffSnapshots(s1, snapshotTruth(w, 2, { "hunger@v": 0.2, "x@v": 0.5 }))),
    ).toBe(true);
    w.set(T, a, { n: 9 });
    w.deleteRaw("demo.t", b);
    w.set(T, c, { n: 3 });
    const d = diffSnapshots(s1, snapshotTruth(w, 5, { "hunger@v": 0.4, "y@v": 0.1 }));
    expect(d.added).toEqual([{ table: "demo.t", id: c }]);
    expect(d.removed).toEqual([{ table: "demo.t", id: b }]);
    expect(d.changed.map((x) => x.id)).toEqual([a]);
    expect(d.pressures.map((p) => p.key)).toEqual(["hunger@v", "x@v", "y@v"]);
    expect(formatSnapshotDiff(d)).toContain("t1 → t5");
  });
});
