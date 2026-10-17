// Bandas de bandidos que nacen del hambre (organizations §11 «Hambre y armas»), cableadas a la
// vida. Opt-in (`LifeParts.bandits`, requiere `famine`); apagado no existe ni corre ni cambia
// hashes. Cada día de mundo:
// - nacimiento: en un asentamiento con hambruna (`FAMINE.state === "famine"`) sin banda activa ni
//   disuelta hace poco, los adultos más desesperados (su propia despensa) eligen cabecilla por
//   fuerza y los demás juran según su hambre, su confianza en él y su lealtad al consejo
//   (`band.founded`, causa: la escasez del asentamiento);
// - asaltos: cada `raidEveryDays` días la banda le saca grano al hogar con más sobrante (el botín
//   es el tesoro, la cuenta del ledger de la banda) si su fuerza vence a los defensores
//   (`band.raided` / `band.raid_repulsed`); tras un asalto bueno puede capturar al más débil del
//   hogar, que entra a la banda con poca lealtad (`band.member_captured`);
// - reparto: cada `shareEveryDays` días el tesoro paga la ración a los hogares de los miembros;
//   si no alcanza sube la lealtad perdida y la banda pasa hambre (`band.shared` / `band.went_hungry`),
//   y quien queda con poca lealtad puede desertar (`band.member_left`);
// - disolución: el cabecilla cae, quedan pocos, pasa hambre demasiado tiempo o la hambruna terminó:
//   el tesoro que queda se reparte entre los hogares de los miembros (conservación) y se cierran
//   las membresías (`band.dissolved`).
// Decide sobre lo que cada uno siente de sí y de los demás; no lee la verdad ajena para decidir
// quién se suma. Todos los eventos llevan causa y el ledger queda auditable.

import {
  type AgentId,
  type EntityRef,
  type EventId,
  type HolderRef,
  holderAccount,
  type PlaceRef,
  type SettlementId,
  type Transfer,
} from "../../core/index.ts";
import {
  ageStrength,
  BANDS,
  type Band,
  type BandCandidate,
  type BandRules,
  bandAccounting,
  bandStrength,
  chooseBandSuccessor,
  DEFAULT_BAND_RULES,
  deserts,
  desperation,
  dissolveBand,
  dissolveReason,
  draftEvent,
  ENTITY,
  type EventDraft,
  foundBand,
  type GoodDef,
  gatherFounders,
  goodUnit,
  HOUSEHOLD,
  isActive,
  isMember,
  joinBand,
  leaderOf,
  leaveBand,
  loyaltyOf,
  memberAgents,
  ORG,
  ORG_LOYALTY,
  PERSON,
  type PostingDraft,
  type ProcessDef,
  RELATIONS,
  type ReadonlyWorldTruth,
  raidChance,
  raidLoot,
  type StateChange,
  setComponent,
  shareOut,
  shiftLoyalty,
  succeedBand,
} from "../../sim/index.ts";
import { FAMINE } from "./famineRow.ts";
import { GRAIN_EATEN_PER_PERSON_DAY_G } from "./larder.ts";

export const BANDITS_PROCESS = "life.bandits";
export const BAND_FOUNDED_EVENT = "band.founded";
export const BAND_RAIDED_EVENT = "band.raided";
export const BAND_REPULSED_EVENT = "band.raid_repulsed";
export const BAND_CAPTURED_EVENT = "band.member_captured";
export const BAND_SHARED_EVENT = "band.shared";
export const BAND_HUNGRY_EVENT = "band.went_hungry";
export const BAND_MEMBER_LEFT_EVENT = "band.member_left";
export const BAND_DISSOLVED_EVENT = "band.dissolved";
export const BAND_SUCCESSION_EVENT = "band.leader_succeeded";

export interface BanditsOptions {
  /** Opt-in: tras caer el cabecilla, un juramentado leal ocupa la vacante por fuerza. */
  readonly succession?: boolean;
  readonly rules?: Partial<BandRules>;
  /** Fuerza (0-1) de una persona; por defecto sale de su edad (`ageStrength`). */
  readonly strengthOf?: (truth: ReadonlyWorldTruth, who: AgentId, ageYears: number) => number;
  readonly goods?: readonly GoodDef[];
  /** Ticks por día de mundo. */
  readonly day: number;
  /** Ticks por año de mundo (para la edad). */
  readonly year: number;
  readonly placeOf: (truth: ReadonlyWorldTruth, who: AgentId) => PlaceRef;
}

/** Las bandas existentes, en orden de id. */
export function bandRows(truth: ReadonlyWorldTruth): { id: string; band: Band }[] {
  return [...truth.ids(BANDS)]
    .sort()
    .map((id) => ({ id: id as string, band: truth.get(BANDS, id) as Band }));
}

/** ¿Es `who` miembro activo de alguna banda? */
export function inAnyBand(truth: ReadonlyWorldTruth, who: AgentId): boolean {
  return bandRows(truth).some((r) => isActive(r.band) && isMember(r.band.org, who));
}

const REASON_KEY = "food-scarcity";

export function banditsProcess(o: BanditsOptions): ProcessDef {
  const rules: BandRules = { ...DEFAULT_BAND_RULES, ...o.rules };
  const grainDef = (o.goods ?? []).find((g) => g.id === "grain");
  return {
    id: BANDITS_PROCESS,
    system: "life",
    scope: "world",
    cadence: { local: "day", scene: "day" },
    representation: "individual",
    phase: "decide",
    reads: [
      BANDS.name,
      FAMINE.name,
      ORG.name,
      ORG_LOYALTY.name,
      ENTITY.name,
      PERSON.name,
      HOUSEHOLD.name,
      RELATIONS.name,
    ],
    writes: [BANDS.name, ENTITY.name],
    run(ctx) {
      const ledger = ctx.ledger;
      if (!ledger || !grainDef) return {};
      const truth = ctx.truth;
      const unit = goodUnit(grainDef);
      const today = Math.floor(ctx.now / o.day);
      const moved = new Map<string, number>();
      const bal = (acct: string): number =>
        (ledger.balance(acct as never, unit as never) ?? 0) + (moved.get(acct) ?? 0);
      const postings: PostingDraft[] = [];
      const post = (ev: EventId, transfers: readonly Transfer[]): void => {
        for (const t of transfers) {
          moved.set(t.from, (moved.get(t.from) ?? 0) - t.amount);
          moved.set(t.to, (moved.get(t.to) ?? 0) + t.amount);
        }
        postings.push({ event: ev, transfers });
      };
      const alive = (id: AgentId) => truth.get(ENTITY, id)?.endedAt === undefined;
      const ageOf = (id: AgentId): number =>
        (ctx.now - (truth.get(PERSON, id)?.born ?? ctx.now)) / o.year;
      const strengthOf = (id: AgentId): number =>
        o.strengthOf ? o.strengthOf(truth, id, ageOf(id)) : ageStrength(ageOf(id));
      const homeOf = (id: AgentId): string | undefined =>
        truth.get(PERSON, id)?.household as string | undefined;
      const acct = (h: string): string => holderAccount(h as unknown as HolderRef);
      const changes: StateChange[] = [];
      const events: EventDraft[] = [];

      // Hogares vivos y su gente por asentamiento.
      const peopleOf = new Map<SettlementId, AgentId[]>();
      const homesOf = new Map<SettlementId, string[]>();
      const household = new Map<string, AgentId[]>();
      for (const hid of [...truth.ids(HOUSEHOLD)].sort()) {
        const h = truth.get(HOUSEHOLD, hid);
        if (!h || truth.get(ENTITY, hid)?.endedAt !== undefined) continue;
        const living = h.members.filter((m) => truth.get(PERSON, m) && alive(m));
        if (living.length === 0) continue;
        household.set(hid as string, [...living]);
        homesOf.set(h.settlement, [...(homesOf.get(h.settlement) ?? []), hid as string]);
        peopleOf.set(h.settlement, [...(peopleOf.get(h.settlement) ?? []), ...living]);
      }
      const councilOf = (settlement: SettlementId): string | undefined =>
        [...truth.ids(ORG)].sort().find((id) => truth.get(ORG, id)?.settlement === settlement) as
          | string
          | undefined;

      const bands = new Map<string, { before: Band; after: Band }>();
      for (const r of bandRows(truth)) bands.set(r.id, { before: r.band, after: r.band });
      const bandedNow = new Set<string>();
      for (const { after } of bands.values())
        if (isActive(after)) for (const m of memberAgents(after)) bandedNow.add(m as string);

      const famineAt = (s: SettlementId) => truth.get(FAMINE, s as never);

      for (const [id, u] of [...bands].sort(([a], [b]) => (a < b ? -1 : 1))) {
        let band = u.after;
        if (!isActive(band)) continue;
        const settlement = band.org.settlement;
        const vault = holderAccount(id as unknown as HolderRef);

        // Muertes.
        for (const m of band.org.members) {
          if (m.until !== undefined || alive(m.agent)) continue;
          const dead = truth.get(ENTITY, m.agent);
          const cause = dead?.endEventId ?? band.org.originEventId;
          band = leaveBand(band, m.agent, {
            at: dead?.endedAt ?? ctx.now,
            kind: "death",
            event: cause,
          });
          bandedNow.delete(m.agent as string);
          events.push({
            kind: BAND_MEMBER_LEFT_EVENT,
            actors: [m.agent],
            place: o.placeOf(truth, m.agent),
            data: { band: id, agent: m.agent, exit: "death" },
            emissions: {},
            causes: [{ kind: "event", event: cause }],
          });
        }

        // La vacante conserva la causa de la muerte; no crea personas ni mueve el tesoro.
        if (
          o.succession &&
          leaderOf(band) === null &&
          memberAgents(band).length >= rules.minFounders
        ) {
          const successor = chooseBandSuccessor(
            band,
            memberAgents(band)
              .filter(
                (m) =>
                  truth.get(PERSON, m) !== undefined &&
                  truth.get(ENTITY, m) !== undefined &&
                  alive(m),
              )
              .map((agent) => ({ agent, strength: strengthOf(agent) })),
            rules,
          );
          const vacancy = band.org.positions.find((p) => p.id === "head")?.vacatedBy;
          if (successor !== null && vacancy !== undefined) {
            const event = draftEvent(events.length);
            band = succeedBand(band, successor, ctx.now, event);
            events.push({
              kind: BAND_SUCCESSION_EVENT,
              actors: [successor],
              place: o.placeOf(truth, successor),
              data: { band: id, successor },
              emissions: {},
              causes: [{ kind: "event", event: vacancy }],
            });
          }
        }

        // La paz: la hambruna del lugar terminó.
        const calm = (famineAt(settlement)?.state ?? "none") === "none";
        if (calm && band.peaceSince === null) band = { ...band, peaceSince: ctx.now };
        else if (!calm && band.peaceSince !== null) band = { ...band, peaceSince: null };

        const members = memberAgents(band);
        const leader = leaderOf(band);
        const foundedDay = Math.floor(band.founded / o.day);

        // Asalto.
        if (
          leader !== null &&
          members.length > 0 &&
          today > foundedDay &&
          (today - foundedDay) % Math.max(1, rules.raidEveryDays) === 0
        ) {
          let victim: { home: string; surplus: number } | null = null;
          for (const home of homesOf.get(settlement) ?? []) {
            const people = household.get(home) ?? [];
            if (people.some((p) => bandedNow.has(p as string))) continue;
            const surplus = bal(acct(home)) - rules.victimKeep;
            if (surplus <= 0) continue;
            if (victim === null || surplus > victim.surplus) victim = { home, surplus };
          }
          if (victim) {
            const people = household.get(victim.home) ?? [];
            const adults = people.filter((p) => ageOf(p) >= rules.minAge);
            const attack = bandStrength(members.map(strengthOf));
            const defense = bandStrength(adults.map(strengthOf));
            const chance = raidChance(attack, defense);
            const win = ctx.rng.fork("raid", id, today).chance(chance);
            const base = { band: id, victim: victim.home, attack, defense, chance };
            const raidCauses = [
              {
                kind: "state" as const,
                entity: victim.home as unknown as EntityRef,
                key: "grain-stock",
              },
              { kind: "event" as const, event: band.org.originEventId },
            ];
            const loot = win
              ? raidLoot(rules.raidTake, bal(acct(victim.home)), rules.victimKeep)
              : 0;
            if (win && loot > 0) {
              const ev = draftEvent(events.length);
              events.push({
                kind: BAND_RAIDED_EVENT,
                actors: [leader],
                place: o.placeOf(truth, leader),
                data: { ...base, amount: loot },
                emissions: {},
                causes: raidCauses,
              });
              post(ev, [{ from: acct(victim.home) as never, to: vault, unit, amount: loot }]);
              band = bandAccounting({ ...band, raids: band.raids + 1, lastRaid: ctx.now }, loot, 0);
              // Captura: el más débil del hogar (de edad para pelear o cargar), si no es de otra banda.
              const weak = [...people]
                .filter((p) => ageOf(p) >= rules.minAge && !bandedNow.has(p as string))
                .sort((a, b) => strengthOf(a) - strengthOf(b) || (a < b ? -1 : 1))[0];
              if (
                weak !== undefined &&
                memberAgents(band).length < rules.maxMembers &&
                ctx.rng.fork("capture", id, today).chance(rules.captureChance)
              ) {
                const cev = draftEvent(events.length);
                band = joinBand(band, weak, "captured", ctx.now, cev, rules);
                bandedNow.add(weak as string);
                events.push({
                  kind: BAND_CAPTURED_EVENT,
                  actors: [leader, weak],
                  place: o.placeOf(truth, weak),
                  data: { band: id, agent: weak, via: "captured", victim: victim.home },
                  emissions: {},
                  causes: [{ kind: "event", event: ev }],
                });
              }
            } else {
              band = { ...band, lastRaid: ctx.now };
              events.push({
                kind: BAND_REPULSED_EVENT,
                actors: [leader],
                place: o.placeOf(truth, leader),
                data: base,
                emissions: {},
                causes: raidCauses,
              });
            }
          }
        }

        // Reparto de la ración (y deserciones).
        const sinceShare = today - Math.floor(band.lastShare / o.day);
        if (sinceShare >= Math.max(1, rules.shareEveryDays) && memberAgents(band).length > 0) {
          const crew = memberAgents(band);
          const vaultNow = bal(vault);
          const out = shareOut(vaultNow, crew.length, sinceShare, rules);
          const shareEv = draftEvent(events.length);
          if (out.each > 0) {
            const perHome = new Map<string, number>();
            for (const m of crew) {
              const home = homeOf(m);
              if (home !== undefined) perHome.set(home, (perHome.get(home) ?? 0) + out.each);
            }
            const transfers: Transfer[] = [...perHome]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([home, amount]) => ({ from: vault, to: acct(home) as never, unit, amount }));
            const total = transfers.reduce((s, t) => s + t.amount, 0);
            events.push({
              kind: BAND_SHARED_EVENT,
              actors: crew.slice(0, 1),
              place: o.placeOf(truth, crew[0] as AgentId),
              data: {
                band: id,
                each: out.each,
                members: crew.length,
                days: sinceShare,
                fed: out.fed,
                total,
              },
              emissions: {},
              causes: [{ kind: "event", event: band.org.originEventId }],
            });
            post(shareEv, transfers);
            band = bandAccounting(band, 0, total);
          }
          let loyal = band.loyalty;
          let hungryEv: EventId | undefined;
          if (!out.fed) {
            hungryEv = out.each > 0 ? draftEvent(events.length) : shareEv;
            events.push({
              kind: BAND_HUNGRY_EVENT,
              actors: crew.slice(0, 1),
              place: o.placeOf(truth, crew[0] as AgentId),
              data: {
                band: id,
                days: sinceShare,
                short: out.each,
                unfedDays: band.unfedDays + sinceShare,
              },
              emissions: {},
              causes: [{ kind: "event", event: band.org.originEventId }],
            });
          }
          for (const m of crew)
            loyal = shiftLoyalty(
              loyal,
              m,
              out.fed ? rules.fedGain : -rules.unfedLoss,
              ctx.now,
              hungryEv ?? shareEv,
            );
          band = {
            ...band,
            loyalty: loyal,
            lastShare: ctx.now,
            unfedDays: out.fed ? 0 : band.unfedDays + sinceShare,
          };
          for (const m of crew) {
            if (m === leaderOf(band)) continue;
            if (
              !deserts(
                loyaltyOf(band.loyalty, m),
                ctx.rng.fork("desert", id, today, m as string),
                rules,
              )
            )
              continue;
            const dev = hungryEv ?? shareEv;
            band = leaveBand(band, m, { at: ctx.now, kind: "desertion", event: dev });
            bandedNow.delete(m as string);
            events.push({
              kind: BAND_MEMBER_LEFT_EVENT,
              actors: [m],
              place: o.placeOf(truth, m),
              data: { band: id, agent: m, exit: "desertion" },
              emissions: {},
              causes: [{ kind: "event", event: band.org.originEventId }],
            });
          }
        }

        // Disolución.
        const leaderAlive = (() => {
          const l = leaderOf(band);
          return l !== null && alive(l);
        })();
        const reason = dissolveReason(
          band,
          { leaderAlive, members: memberAgents(band).length, now: ctx.now, day: o.day },
          rules,
        );
        if (reason) {
          const crew = memberAgents(band);
          const dev = draftEvent(events.length);
          const left = bal(vault);
          const vac = band.org.positions.find((p) => p.vacatedBy !== undefined)?.vacatedBy;
          const homes = [
            ...new Set(crew.map(homeOf).filter((h): h is string => h !== undefined)),
          ].sort();
          events.push({
            kind: BAND_DISSOLVED_EVENT,
            actors: crew.slice(0, 1),
            place: o.placeOf(truth, (crew[0] ?? band.org.founders[0]) as AgentId),
            data: { band: id, reason, members: crew.length, raids: band.raids, treasury: left },
            emissions: {},
            causes: [
              reason === "leader_fell" && vac
                ? { kind: "event", event: vac }
                : reason === "famine_over"
                  ? { kind: "state", entity: settlement as unknown as EntityRef, key: REASON_KEY }
                  : { kind: "event", event: band.org.originEventId },
            ],
          });
          // Lo que queda se reparte entre los hogares de los miembros (conservación). Si no hay
          // hogar a quien dárselo, la banda queda con el tesoro y no se disuelve todavía.
          if (left > 0 && homes.length > 0) {
            const each = Math.floor(left / homes.length);
            const transfers: Transfer[] = homes.map((h, k) => ({
              from: vault,
              to: acct(h) as never,
              unit,
              amount: each + (k === 0 ? left - each * homes.length : 0),
            }));
            post(dev, transfers);
            band = bandAccounting(band, 0, left);
          }
          if (left === 0 || homes.length > 0) {
            band = dissolveBand(band, ctx.now, dev, reason);
            for (const m of crew) bandedNow.delete(m as string);
          }
        }
        u.after = band;
      }

      // Nacimiento: asentamientos con hambruna, sin banda activa ni una disuelta hace poco.
      for (const settlement of [...peopleOf.keys()].sort()) {
        if (famineAt(settlement)?.state !== "famine") continue;
        const busy = [...bands.values()].some(
          ({ after }) =>
            after.org.settlement === settlement &&
            (isActive(after) ||
              (after.dissolved !== undefined &&
                ctx.now - after.dissolved.at < rules.rebirthDays * o.day)),
        );
        if (busy) continue;
        const council = councilOf(settlement);
        const councilLoyalty = council ? truth.get(ORG_LOYALTY, council as never) : undefined;
        const councilMembers = new Set(
          council
            ? (truth.get(ORG, council as never)?.members ?? [])
                .filter((m) => m.until === undefined)
                .map((m) => m.agent as string)
            : [],
        );
        const cands: BandCandidate[] = [];
        for (const who of peopleOf.get(settlement) ?? []) {
          if (bandedNow.has(who as string) || councilMembers.has(who as string)) continue;
          const home = homeOf(who);
          if (home === undefined) continue;
          const mouths = (household.get(home) ?? []).length;
          const days = bal(acct(home)) / Math.max(1, mouths * GRAIN_EATEN_PER_PERSON_DAY_G);
          cands.push({
            agent: who,
            ageYears: ageOf(who),
            strength: strengthOf(who),
            desperation: desperation(days),
            villageLoyalty: loyaltyOf(councilLoyalty, who),
          });
        }
        const founding = gatherFounders(
          cands,
          (who, leader) =>
            Math.max(0, truth.get(RELATIONS, who)?.toward[leader as string]?.dims.trust ?? 0),
          ctx.rng.fork("birth", settlement as string, today),
          rules,
        );
        if (!founding) continue;
        const bandId = ctx.newId("org");
        const origin = draftEvent(events.length);
        const band = foundBand({
          id: bandId,
          settlement,
          founding,
          originEventId: origin,
          bornOf: origin,
          at: ctx.now,
          rules,
        });
        changes.push(
          setComponent(
            ENTITY,
            bandId as never,
            { id: bandId, originEventId: origin, createdAt: ctx.now } as never,
          ),
        );
        bands.set(bandId as string, { before: band, after: band });
        for (const m of memberAgents(band)) bandedNow.add(m as string);
        events.push({
          kind: BAND_FOUNDED_EVENT,
          actors: band.org.founders as AgentId[],
          place: o.placeOf(truth, founding.leader.agent),
          data: {
            band: bandId,
            settlement,
            leader: founding.leader.agent,
            members: band.org.founders.length,
            famine: famineAt(settlement)?.value,
          },
          emissions: {},
          causes: [{ kind: "state", entity: settlement as unknown as EntityRef, key: REASON_KEY }],
        });
      }

      for (const [id, u] of bands)
        if (u.after !== u.before || !truth.get(BANDS, id as never))
          changes.push(setComponent(BANDS, id as never, u.after));

      return changes.length === 0 && events.length === 0
        ? {}
        : { changes, events, ...(postings.length > 0 ? { postings } : {}) };
    },
  };
}
