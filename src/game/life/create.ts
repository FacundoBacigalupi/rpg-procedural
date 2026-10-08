// Arma la vida real (player-loop §1-§2, Fase 1): el planeta, la aldea con su gente de la
// pre-corrida, el personaje que sale de ella, y cada sistema sembrado (cuerpos, habilidades,
// lugares, ubicaciones). Todo sale del seed y del contenido; el mismo seed da la misma vida.

import {
  type AgentId,
  type Content,
  EARTHLIKE_CLOCK,
  EventLog,
  externalAccount,
  type HolderRef,
  type HouseholdId,
  holderAccount,
  IdAllocator,
  Ledger,
  type LedgerConfig,
  ledgerUnit,
  makeId,
  type PlaceRef,
  type Seed,
  type SettlementId,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  BODY_PLANS,
  BUILDING_TYPES,
  CONCEPTS,
  COOKED,
  COPPER,
  CULTURE_TRAITS,
  CULTURES,
  DEMOGRAPHY,
  EATEN,
  ENTITY,
  FOODS,
  GOODS,
  generateLanguage,
  HARVEST,
  HARVEST_GOOD,
  houseKey,
  LANGUAGES,
  LOCATION,
  type LocalMap,
  MATERIALS,
  PERSON,
  PLACE,
  PLANS,
  type PlaceFeature,
  type PlaceToName,
  PRESSURE_CURVES,
  RECIPES,
  ROTTED,
  SKILLS,
  SkillCatalog,
  SPEECH_LINES,
  STATUSES,
  seedBodies,
  seedCulture,
  seedParcels,
  seedPersonNames,
  seedPlaceNames,
  seedSettlement,
  seedSkills,
  seedStatus,
  seedVillage,
  settlementSpaces,
  settlementUnits,
  TENURES,
  TRAITS,
  type Trait,
  type VillagePopulation,
  villagePopulation,
  WORK_TYPES,
  WorldTruth,
} from "../../sim/index.ts";
import {
  BIOMES,
  generatePlanet,
  type Planet,
  type PlanetOptions,
  type VillageSite,
  villageSite,
} from "../../worldgen/index.ts";
import { localMapOf } from "./map.ts";
import { type LifeParts, type LifeWorld, lifeWorld, PLAYER } from "./world.ts";

export interface LifeOptions {
  /** Menos celdas para los tests (frecuencia de la grilla); por defecto la del planeta real. */
  readonly frequency?: number;
  /** Entre qué edades sale el personaje de la pre-corrida (player-loop §2). */
  readonly playerAge?: { readonly min: number; readonly max: number };
}

/** Lo que no cambia en la vida: sale del seed y del contenido, no se guarda. */
/** Gramos de grano por persona en la despensa al empezar. */
export const LARDER_PER_MEMBER_G = 100_000;
/** Monedas de cobre por persona al empezar (de la economía previa a la corrida; economy §2). */
export const COINS_PER_PERSON = 40;

export interface LifeTerrain {
  /** Dónde pasan los eventos de la aldea. */
  readonly village: PlaceRef;
  readonly planet: Planet;
  readonly site: VillageSite;
  readonly map: LocalMap;
  readonly population: VillagePopulation;
}

function required<T>(x: T | undefined, what: string): T {
  if (x === undefined) throw new Error(`falta contenido: ${what}`);
  return x;
}

/** El terreno y la pre-corrida de la aldea de este seed. */
export function lifeTerrain(seed: Seed, content: Content, options: LifeOptions = {}): LifeTerrain {
  const planetOptions: PlanetOptions = {
    seed,
    biomes: content.all(BIOMES),
    ...(options.frequency === undefined ? {} : { frequency: options.frequency }),
  };
  const planet = generatePlanet(planetOptions);
  const site = villageSite(planet);
  const population = villagePopulation({
    seed,
    site,
    traits: content.all(TRAITS),
    demography: required(
      content.get(DEMOGRAPHY, "human.preindustrial-village"),
      "demography human.preindustrial-village",
    ),
    ...(options.playerAge === undefined ? {} : { playerAge: options.playerAge }),
  });
  const village: PlaceRef = { kind: "settlement", settlement: population.settlement };
  return { village, planet, site, map: localMapOf(planet, site), population };
}

/** Los contadores de ids siguen a lo que ya existe, para que lo nuevo no choque. */
function idsAfter(truth: WorldTruth, log: EventLog): IdAllocator {
  const next: Record<string, number> = { event: log.lastNumber + 1 };
  for (const { id } of truth.rows().filter((r) => r.table === ENTITY.name)) {
    const [kind, n] = id.split(":");
    if (kind === undefined || n === undefined) continue;
    next[kind] = Math.max(next[kind] ?? 1, Number(n) + 1);
  }
  return new IdAllocator(next);
}

/**
 * Lo mínimo del terreno que hace falta para seguir una vida guardada: el mapa local, el hex de
 * la aldea, los hogares vivos al empezar (de ahí salen los espacios) y quién es el personaje.
 * Se guarda con la vida para que retomar no regenere el planeta; es JSON puro.
 */
export interface ResumeAnchor {
  readonly map: LocalMap;
  readonly hex: number;
  readonly households: readonly HouseholdId[];
  readonly player: AgentId;
  readonly village: PlaceRef;
}

export function anchorOf(terrain: LifeTerrain): ResumeAnchor {
  return {
    map: terrain.map,
    hex: terrain.site.hex,
    households: terrain.population.households.filter((h) => h.end === null).map((h) => h.id),
    player: terrain.population.player,
    village: terrain.village,
  };
}

/** Lo derivado del seed y del contenido que no se guarda, sin tocar el planeta. */
export function resumeParts(
  seed: Seed,
  content: Content,
  anchor: ResumeAnchor,
): Pick<
  LifeParts,
  | "seed"
  | "clock"
  | "map"
  | "catalog"
  | "skills"
  | "traits"
  | "plans"
  | "foods"
  | "goods"
  | "recipes"
  | "statuses"
  | "speech"
  | "pressureCurves"
> {
  return {
    seed,
    clock: EARTHLIKE_CLOCK,
    map: anchor.map,
    catalog: new ActionCatalog(content.all(ACTIONS), content.all(PLANS)),
    skills: new SkillCatalog(content.all(SKILLS), content.all(ACTIONS)),
    traits: content.all(TRAITS),
    plans: content.all(BODY_PLANS),
    foods: content.all(FOODS),
    goods: content.all(GOODS),
    recipes: content.all(RECIPES),
    statuses: content.all(STATUSES),
    speech: content.all(SPEECH_LINES),
    pressureCurves: content.all(PRESSURE_CURVES),
  };
}

/** Las fuentes y sumideros que la vida declara (conservación: nada entra ni sale por otro lado). */
export function ledgerConfigOf(content: Content): LedgerConfig {
  const units = content.all(FOODS).map((f) => ledgerUnit(`good:${f.id}`));
  return {
    externals: {
      [COOKED]: units,
      [EATEN]: units,
      [HARVEST]: [HARVEST_GOOD],
      [ROTTED]: units,
      seed: [...units, COPPER, ...settlementUnits(content.all(MATERIALS))],
    },
  };
}

/**
 * Migra el ledger de una vida guardada antes de que existieran algunas fuentes o sumideros
 * (`harvest`, `rotted`, ...): suma las unidades que faltan y rehace el ledger con el mismo diario,
 * así el saldo no cambia. Si ya declara todo, devuelve el mismo.
 */
export function withDeclaredExternals(ledger: Ledger, content: Content): Ledger {
  const have = ledger.config.externals;
  const merged: Record<string, string[]> = {};
  let changed = false;
  for (const [name, units] of Object.entries(ledgerConfigOf(content).externals)) {
    const known = new Set(have[name] ?? []);
    const missing = units.filter((u) => !known.has(u));
    if (missing.length > 0) changed = true;
    merged[name] = [...(have[name] ?? []), ...missing];
  }
  for (const [name, units] of Object.entries(have)) merged[name] ??= [...units];
  return changed ? Ledger.fromJournal({ externals: merged }, ledger.journal()) : ledger;
}

export function createLife(
  seed: Seed,
  content: Content,
  options: LifeOptions = {},
): { world: LifeWorld; terrain: LifeTerrain } {
  const terrain = lifeTerrain(seed, content, options);
  const { site, map, population: pop } = terrain;
  const traits: readonly Trait[] = content.all(TRAITS);
  const clock = EARTHLIKE_CLOCK;

  const truth = new WorldTruth();
  const log = EventLog.from(pop.events);
  seedVillage(truth, pop);
  truth.set(PLAYER, pop.player, { since: pop.now });

  // Los lugares con nombre salen de las anclas del sitio, con la causa que ya traen.
  const settlement = pop.settlement as SettlementId;
  truth.set(PLACE, settlement, { kind: "village", hexes: [site.hex] });
  let place = 0;
  const named: PlaceToName[] = [];
  for (const a of site.anchors) {
    if (a.kind === "harbor") continue;
    const id = makeId("place", ++place);
    const hexes = a.kind === "water" ? [a.hex] : a.hexes;
    const kind = a.kind === "water" ? "water" : a.kind === "farmland" ? "fields" : "forest";
    truth.set(ENTITY, id, { id, originEventId: a.cause, createdAt: 0 });
    truth.set(PLACE, id, {
      kind,
      hexes,
      ...(a.kind === "water" ? { detail: a.source } : {}),
    });
    const feature: PlaceFeature =
      a.kind === "water" ? a.source : kind === "fields" ? "fields" : "forest";
    named.push({ id, feature, event: a.cause });
  }

  // La lengua de la aldea: sus nombres de gente y de lugar salen de su léxico (language §8, §9).
  const language = generateLanguage(
    seed,
    required(content.get(LANGUAGES, "village.hills"), "lengua village.hills"),
    content.all(CONCEPTS),
  );
  seedPersonNames(truth, language, seed);
  const main = named.find((p) => !["fields", "forest"].includes(p.feature)) ?? named[0];
  seedPlaceNames(truth, language, seed, [
    ...(main ? [{ id: settlement, feature: main.feature, event: pop.foundedEvent }] : []),
    ...named,
  ]);

  // Cada vivo empieza en su casa; el personaje también.
  for (const id of truth.ids(PERSON) as AgentId[]) {
    if (truth.get(ENTITY, id)?.endedAt !== undefined) continue;
    const household = truth.get(PERSON, id)?.household as HouseholdId;
    truth.set(LOCATION, id, { hex: site.hex, space: houseKey(household) });
  }

  const skills = new SkillCatalog(content.all(SKILLS), content.all(ACTIONS));
  const plans = content.all(BODY_PLANS);
  seedSkills(truth, skills, traits, pop.now, clock);
  seedBodies(
    truth,
    required(
      plans.find((p) => p.id === "human"),
      "body-plan human",
    ),
    traits,
    pop.now,
    clock,
  );

  const ids = idsAfter(truth, log);
  const foods = content.all(FOODS);
  const materials = content.all(MATERIALS);
  const ledger = new Ledger(ledgerConfigOf(content));
  // La aldea como edificios con componentes, el pozo y los caminos (settlements §5, §8).
  seedSettlement(truth, ids, log, ledger, {
    seed,
    pop,
    site,
    map,
    content: { materials, buildings: content.all(BUILDING_TYPES), works: content.all(WORK_TYPES) },
  });
  const spaces = settlementSpaces(truth, site.hex);
  // Quién es quién: el estatus de cada hogar, con su causa; de él sale cuánto tenía al empezar.
  const statuses = content.all(STATUSES);
  const standing = seedStatus(truth, ids, log, {
    settlement,
    place: terrain.village,
    now: pop.now,
    households: pop.households,
    defs: statuses,
  });
  // La cultura de la aldea: qué hace la gente y por qué (culture §1, §3).
  const culture = content.all(CULTURES).find((c) => c.id === "village");
  if (!culture) throw new Error("falta contenido: cultura village");
  seedCulture(truth, ids, log, {
    settlement,
    place: terrain.village,
    now: pop.now,
    foundersEvent: pop.foundersEvent,
    culture,
    traits: content.all(CULTURE_TRAITS),
  });
  // Quién tiene qué tierra, con sus testigos y lo que cada vecino cree (property §3, §9).
  seedParcels(truth, ids, log, {
    seed,
    pop,
    site,
    tenures: content.all(TENURES),
    standing,
  });
  const wealthOf = (h: HouseholdId): number => standing.get(h)?.wealth ?? 1;
  // Despensas de arranque: lo que queda de la última cosecha, unos diez meses de grano por boca
  // (~700 g por día, lo que come la rutina). Lo reemplazan las existencias y la cosecha de la
  // aldea cuando settlements y economy las den (ROADMAP: Hito 1b).
  const grain = ledgerUnit("good:grain");
  if (foods.some((f) => f.id === "grain")) {
    const stocked = ids.next("event");
    log.append({
      id: stocked,
      tick: pop.now,
      kind: "settlement.stocked",
      actors: [],
      place: terrain.village,
      data: null,
      emissions: {},
      causes: [{ kind: "event", event: pop.foundersEvent }],
      resolution: "local",
    });
    ledger.post({
      tick: pop.now,
      eventId: stocked,
      transfers: pop.households
        .filter((h) => h.end === null)
        .map((h) => ({
          unit: grain,
          from: externalAccount("seed"),
          to: holderAccount(h.id),
          amount: Math.round(h.members.length * LARDER_PER_MEMBER_G * wealthOf(h.id)),
        }))
        .concat(
          pop.households
            .filter((h) => h.end === null)
            .flatMap((h) =>
              h.members.map((m) => ({
                unit: COPPER,
                from: externalAccount("seed"),
                to: holderAccount(m as unknown as HolderRef),
                amount: Math.round(COINS_PER_PERSON * wealthOf(h.id)),
              })),
            ),
        ),
    });
  }
  const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));

  const world = lifeWorld(
    {
      seed,
      clock,
      truth,
      ids,
      log,
      ledger,
      map,
      spaces,
      catalog,
      skills,
      traits,
      plans,
      foods,
      goods: content.all(GOODS),
      recipes: content.all(RECIPES),
      statuses: content.all(STATUSES),
      speech: content.all(SPEECH_LINES),
      pressureCurves: content.all(PRESSURE_CURVES),
    },
    pop.player,
    terrain.village,
    { now: pop.now, seq: 0, queue: [] },
  );
  return { world, terrain };
}
