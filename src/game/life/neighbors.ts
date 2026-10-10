// La ruina o el apuro de un vecino se sabe en la aldea (economy §3, information §2). Una vez por
// día, cada hogar calcula su `standing` con el presupuesto real (`householdFlowsOf`) y quien estuvo
// en el mismo hex que algún miembro de otro hogar se entera de cómo anda: apretado o en la ruina
// queda anotado en `NEIGHBOR_STANDING` de quien lo vio (con el día); si lo ve cómodo o ajustado,
// borra lo que creía. Lo que sabe es una creencia con fecha: no se actualiza si no se cruzan.
// Solo escribe su propia tabla: sin RNG, sin eventos y sin mover monedas ni gente. No se usa la
// verdad más allá de lo que se ve al cruzarse (el hex compartido ese día).

import type { AgentId, HolderRef, PlanetClock } from "../../core/index.ts";
import { holderAccount } from "../../core/index.ts";
import {
  deleteComponent,
  ENTITY,
  type GoodDef,
  LOCATION,
  PERSON,
  type ProcessDef,
  type StateChange,
  setComponent,
  table,
} from "../../sim/index.ts";
import { type HouseholdStanding, householdFlowsOf, standingOf } from "./budget.ts";
import { loansOf } from "./loans.ts";
import { rentsOf } from "./rents.ts";
import { incomeOfHousehold } from "./trades.ts";

export const NEIGHBORS_PROCESS = "life.neighbors";

/** Lo que alguien cree de cómo anda un hogar vecino, y desde qué día. */
export interface NeighborView {
  readonly standing: "tight" | "broke";
  readonly day: number;
}
export interface NeighborStandings {
  readonly homes: Readonly<Record<string, NeighborView>>;
}
export const NEIGHBOR_STANDING = table<NeighborStandings>("economy.neighbor_standing");

export interface NeighborsOptions {
  readonly clock: PlanetClock;
  readonly goods: readonly GoodDef[];
}

/** Lo que `observer` cree que le pasa a `home` (undefined: nada que se sepa de él). */
export function neighborStandingKnown(
  book: NeighborStandings | undefined,
  home: string,
): NeighborView | undefined {
  return book?.homes[home];
}

/** Aplica lo visto hoy de un hogar al libro de quien lo vio (puro). */
export function noticeStanding(
  book: NeighborStandings | undefined,
  home: string,
  seen: HouseholdStanding,
  day: number,
): NeighborStandings | undefined {
  const homes = { ...(book?.homes ?? {}) };
  if (seen === "tight" || seen === "broke") homes[home] = { standing: seen, day };
  else if (home in homes) delete homes[home];
  else return book;
  return { homes };
}

export function neighborsProcess(o: NeighborsOptions): ProcessDef {
  return {
    id: NEIGHBORS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [PERSON.name, ENTITY.name, LOCATION.name, NEIGHBOR_STANDING.name],
    writes: [NEIGHBOR_STANDING.name],
    run(ctx) {
      const truth = ctx.truth;
      if (!ctx.ledger) return {};
      const today = Math.floor(ctx.now / o.clock.day);
      // Quién está dónde y de qué hogar es cada uno (solo vivos).
      const byHex = new Map<number, { id: AgentId; home: string | undefined }[]>();
      for (const id of [...truth.ids(PERSON)].sort() as AgentId[]) {
        if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
        const at = truth.get(LOCATION, id);
        if (!at) continue;
        const list = byHex.get(at.hex) ?? [];
        list.push({ id, home: truth.get(PERSON, id)?.household });
        byHex.set(at.hex, list);
      }
      const standings = new Map<string, HouseholdStanding>();
      const standingOfHome = (home: string): HouseholdStanding => {
        const known = standings.get(home);
        if (known) return known;
        const s = standingOf(
          householdFlowsOf(
            truth,
            {
              goods: o.goods,
              ledger: ctx.ledger,
              now: ctx.now,
              day: o.clock.day,
              year: o.clock.year,
              incomePerDay: incomeOfHousehold(truth, home, today),
              loans: loansOf(truth, holderAccount(home as unknown as HolderRef)),
              rents: rentsOf(truth, home),
            },
            home,
          ),
        );
        standings.set(home, s);
        return s;
      };
      const changes: StateChange[] = [];
      for (const hex of [...byHex.keys()].sort((a, b) => a - b)) {
        const here = byHex.get(hex) ?? [];
        const homesHere = [
          ...new Set(here.flatMap((p) => (p.home === undefined ? [] : [p.home]))),
        ].sort();
        if (homesHere.length < 2) continue;
        for (const watcher of here) {
          let book = truth.get(NEIGHBOR_STANDING, watcher.id);
          const before = book;
          for (const home of homesHere) {
            if (home === watcher.home) continue;
            book = noticeStanding(book, home, standingOfHome(home), today);
          }
          if (book === before) continue;
          changes.push(
            book && Object.keys(book.homes).length > 0
              ? setComponent(NEIGHBOR_STANDING, watcher.id, book)
              : deleteComponent(NEIGHBOR_STANDING, watcher.id),
          );
        }
      }
      return { changes };
    },
  };
}
