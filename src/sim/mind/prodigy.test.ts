import { describe, expect, it } from "vitest";
import type { AgentId, EventId, Tick } from "../../core/index.ts";
import { addMemory, formMemory, type Memories } from "./memory.ts";
import {
  heardProdigy,
  knowsOf,
  PRODIGY_HALF_DAYS,
  prodigyDesire,
  prodigyTales,
} from "./prodigy.ts";

const DAY = 86_400;
const place = { kind: "cell", cell: 3 } as never;
const isProdigy = (k: string) => k.startsWith("heaven.");

function mems(...xs: Parameters<typeof formMemory>[0][]): Memories {
  let m: Memories | undefined;
  for (const x of xs) m = addMemory(m, formMemory(x), 0 as Tick);
  return m as Memories;
}

describe("prodigios que se cuentan (novel2-trib-far-gossip)", () => {
  const seen = {
    eventId: "e:1" as EventId,
    kind: "heaven.tribulation_strikes",
    with: [],
    place,
    at: 0 as Tick,
    intensity: 0.5,
    valence: -0.2,
    clarity: 0.8,
  };

  it("solo los prodigios que todavía cree, uno por evento", () => {
    const m = mems(
      seen,
      { ...seen, eventId: "e:2" as EventId, kind: "action.give" },
      {
        ...seen,
        eventId: "e:3" as EventId,
        clarity: 0.05,
      },
    );
    const tales = prodigyTales(m, isProdigy);
    expect(tales.map((t) => t.root)).toEqual(["e:1"]);
    expect(tales[0]?.seen).toBe(true);
    expect(knowsOf(m, "e:2" as EventId)).toBe(true);
    expect(knowsOf(m, "e:9" as EventId)).toBe(false);
  });

  it("las ganas caen con los días, con quien ya lo sabe y con lo de segunda mano", () => {
    const [tale] = prodigyTales(mems(seen), isProdigy);
    if (!tale) throw new Error("sin relato");
    const base = { tale, sociability: 0.6, trustInListener: 0, listenerKnows: false };
    const fresh = prodigyDesire({ ...base, now: 0 as Tick });
    const old = prodigyDesire({ ...base, now: (PRODIGY_HALF_DAYS * DAY) as Tick });
    expect(fresh).toBeGreaterThan(0);
    expect(old).toBeCloseTo(fresh / 2, 5);
    expect(prodigyDesire({ ...base, now: 0 as Tick, listenerKnows: true })).toBe(0);
    const told = { ...tale, seen: false };
    expect(prodigyDesire({ ...base, tale: told, now: 0 as Tick })).toBeLessThan(fresh);
  });

  it("el oyente lo guarda contado, con menos fuerza y confianza, y se apaga de boca en boca", () => {
    const [tale] = prodigyTales(mems(seen), isProdigy);
    if (!tale) throw new Error("sin relato");
    const x = heardProdigy(tale, "agent:a" as AgentId, 0.5);
    expect(x).toMatchObject({ eventId: "e:1", source: "told", toldBy: "agent:a", with: [] });
    const once = formMemory(x);
    expect(once.confidence).toBeLessThan(tale.confidence);
    expect(once.intensity).toBeLessThan(tale.intensity);
    let hops = 0;
    let m: Memories = { items: [once], gists: [] };
    for (; hops < 10; hops++) {
      const [t] = prodigyTales(m, isProdigy);
      if (!t) break;
      m = { items: [formMemory(heardProdigy(t, "agent:b" as AgentId, 0.5))], gists: [] };
    }
    expect(hops).toBeLessThan(10);
  });
});
