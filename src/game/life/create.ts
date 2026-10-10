// Arma la vida real (player-loop §1-§2, Fase 1): el planeta, la aldea con su gente de la
// pre-corrida, el personaje que sale de ella, y cada sistema sembrado (cuerpos, habilidades,
// lugares, ubicaciones). Todo sale del seed y del contenido; el mismo seed da la misma vida.

import {
  type AgentId,
  type Content,
  EARTHLIKE_CLOCK,
  type EventId,
  EventLog,
  externalAccount,
  type HolderRef,
  type HouseholdId,
  holderAccount,
  IdAllocator,
  Ledger,
  type LedgerConfig,
  type LedgerUnit,
  ledgerUnit,
  makeId,
  type PlaceRef,
  Rng,
  type Seed,
  type SettlementId,
  type Transfer,
} from "../../core/index.ts";
import {
  ACTIONS,
  ActionCatalog,
  ADDRESSES,
  assignStatuses,
  BODY_PLANS,
  BUILDING_TYPES,
  type ChosenTaste,
  CONCEPTS,
  COOKED,
  COPPER,
  CULTURE_TRAITS,
  CULTURES,
  DEBRIS_SINK,
  DEMOGRAPHY,
  DIETS,
  DIVINATION_CONCERNS,
  DIVINATION_METHODS,
  DOCTRINES,
  dailyProductivity,
  dayOf,
  EATEN,
  ECOLOGY,
  ENTITY,
  ETIQUETTE,
  FOODS,
  GATHERED_SOURCE,
  GOODS,
  generateLanguage,
  goodUnit,
  HABITS_CONTENT,
  HARVEST,
  HARVEST_GOOD,
  type Household,
  harvestSeason,
  houseKey,
  initialCell,
  LANGUAGES,
  type Language,
  LIFE_STAGES,
  LINEAGES,
  LOCATION,
  type LocalMap,
  liveSettlementSpaces,
  MATERIALS,
  NUTRIENT_PROFILES,
  PARCEL_SOIL,
  PERSON,
  type Person,
  PLACE,
  PLANS,
  type PlaceFeature,
  type PlaceToName,
  PRESSURE_CURVES,
  pickTrajectory,
  RECIPES,
  REGISTERS,
  RELATION_BONDS,
  RELATION_DIMS,
  RELIGIONS,
  ROTTED,
  resolveTastes,
  SCHEMAS,
  SKILLS,
  SkillCatalog,
  SMOKE_SINK,
  SOIL,
  SOIL_START,
  SPEECH_LINES,
  STATUSES,
  type StatusDef,
  seedBodies,
  seedCommunityAccent,
  seedCulture,
  seedMinds,
  seedParcels,
  seedPeopleCulture,
  seedPeopleReligion,
  seedPersonNames,
  seedPlaceNames,
  seedRelations,
  seedReligion,
  seedSettlement,
  seedSkills,
  seedStatus,
  seedTastes,
  seedVillage,
  settlementUnits,
  startingParcel,
  TABOOS,
  TASTES,
  type TasteDef,
  type TasteSpec,
  TENURES,
  type TemperamentSpec,
  TRADE_RECIPES,
  TRAITS,
  TRAJECTORIES,
  type Trait,
  temperamentFit,
  VALUES,
  VILLAGE_SEPARATION,
  type VillagePopulation,
  validateTemperament,
  villagePopulation,
  WAGES_SINK,
  WORK_TYPES,
  WORKSHOP,
  WORKSHOP_WASTE,
  WorldTruth,
} from "../../sim/index.ts";
import {
  BIOMES,
  generatePlanet,
  type LocalTerrain,
  type Planet,
  type PlanetOptions,
  type VillageSite,
  villageSite,
} from "../../worldgen/index.ts";
import type { ConverseForm } from "./converse.ts";
import { ecologyHexes } from "./ecology.ts";
import { checkInventory, INVENTORY_BELIEF } from "./inventory-belief.ts";
import { larderNeeded } from "./larder.ts";
import { localMapOf } from "./map.ts";
import type { HouseholdNeeds } from "./moldgossip.ts";
import { ROUTINE } from "./routine.ts";
import { TRADE_START_BATCHES, tradeOfHousehold } from "./trades.ts";
import { hexKindsFromTerrain, type WaterSourcesConfig } from "./waterSources.ts";
import { type LifeParts, type LifeWorld, lifeWorld, PLAYER } from "./world.ts";

/** Lo que se pide del personaje en modo novela: se busca entre los nacimientos (game-modes §2.2). */
export interface BirthQuery {
  readonly sex?: "female" | "male";
  readonly position?: "holder" | "common" | "dependent";
  /** Rangos por eje de temperamento: pesan en la búsqueda (paso 1, §2.2), no la cortan. */
  readonly temperament?: TemperamentSpec;
}

export interface LifeOptions {
  /** El personaje pedido (modo novela); sin él, sale de la pre-corrida como en el realista. */
  readonly birth?: BirthQuery;
  /** Menos celdas para los tests (frecuencia de la grilla); por defecto la del planeta real. */
  readonly frequency?: number;
  /** Entre qué edades sale el personaje de la pre-corrida (player-loop §2). */
  readonly playerAge?: { readonly min: number; readonly max: number };
  /** Gustos pedidos del personaje (modo novela): se fijan sobre los que el mundo le generó. */
  readonly tastes?: readonly TasteSpec[];
  /** Opt-in: presión de escasez y su descarga (`life.famine`); apagado por defecto. */
  readonly famine?: LifeParts["famine"];
  /** Opt-in: hogares que deciden irse por la hambruna (`life.migration`); apagado por defecto. */
  readonly migration?: LifeParts["migration"];
  /** Opt-in: el agravio que llega por rumor mueve la relación del tercero; apagado por defecto. */
  readonly rumorGrievance?: boolean;
  /** Opt-in: estafa de calidad en el trato (el vendedor infla por temperamento y necesidad); apagado por defecto. */
  readonly scam?: boolean;
  /** Opt-in bajo `scam`: unidad del relleno que el vendedor mezcla en el lote; apagado por defecto. */
  readonly scamFiller?: LedgerUnit;
  /** Opt-in: fuentes de agua; si no trae `hexKinds`, salen del terreno local (`hexKindsFromTerrain`). */
  readonly waterSources?: WaterSourcesConfig;
  /** Opt-in: la confianza de RELATIONS en los préstamos se lee con decaimiento (`relationDecay`). */
  readonly relationDecay?: boolean;
  /** Opt-in: la mora de los préstamos abre una servidumbre por deudas (`LifeParts.loanBondage`); apagado por defecto. */
  readonly loanBondage?: LifeParts["loanBondage"];
  /** Opt-in: la reconstrucción «distinta» puede cambiar de material; apagado por defecto. */
  readonly swapMaterials?: boolean;
  /** Opt-in: el chisme de moldes mueve la decisión con precios del catálogo (`LifeParts.moldHintsFromCatalog`); apagado por defecto. */
  readonly moldHintsFromCatalog?: boolean;
  /** Opt-in: necesidades del hogar de las que sale `moldHints.tradeWant` (`tradeWantFromNeeds`); apagado por defecto. */
  readonly tradeNeeds?: HouseholdNeeds;
  /** Opt-in: vista de oficios (`TRADE_VIEW`); con `misread`/`people` además cree oficios equivocados / anota personas. Apagado por defecto. */
  readonly tradeView?: LifeParts["tradeView"];
  /** Opt-in: los lotes comerciados llevan la marca del vendedor y el comprador la verifica (`life.marks`). Apagado por defecto. */
  readonly marks?: boolean;
}

/** Los procesos opt-in que la configuración de la vida pasa al mundo (vacío si no pide ninguno). */
export function optInParts(
  options: LifeOptions,
  terrain?: Pick<LocalTerrain, "sea" | "lake" | "water">,
): Pick<
  LifeParts,
  | "famine"
  | "migration"
  | "rumorGrievance"
  | "scam"
  | "scamFiller"
  | "waterSources"
  | "relationDecay"
  | "loanBondage"
  | "swapMaterials"
  | "moldHintsFromCatalog"
  | "tradeView"
  | "marks"
  | "tradeNeeds"
> {
  return {
    ...(options.waterSources
      ? {
          waterSources:
            options.waterSources.hexKinds || !terrain
              ? options.waterSources
              : { ...options.waterSources, hexKinds: hexKindsFromTerrain(terrain) },
        }
      : {}),
    ...(options.relationDecay ? { relationDecay: true } : {}),
    ...(options.loanBondage ? { loanBondage: options.loanBondage } : {}),
    ...(options.famine ? { famine: options.famine } : {}),
    ...(options.migration ? { migration: options.migration } : {}),
    ...(options.rumorGrievance ? { rumorGrievance: true } : {}),
    ...(options.scam ? { scam: true } : {}),
    ...(options.scam && options.scamFiller ? { scamFiller: options.scamFiller } : {}),
    ...(options.swapMaterials ? { swapMaterials: true } : {}),
    ...(options.moldHintsFromCatalog ? { moldHintsFromCatalog: true } : {}),
    ...(options.tradeView ? { tradeView: options.tradeView } : {}),
    ...(options.marks ? { marks: true } : {}),
    ...(options.tradeNeeds ? { tradeNeeds: options.tradeNeeds } : {}),
  };
}

/**
 * Los gustos pedidos contra el catálogo de gustos del contenido (dominio -> objetos). Lo que el
 * mundo no conoce o se contradice no se ignora en silencio: falla con la razón (game-modes §2.4).
 * El origen es el evento de fundación hasta que exista la concepción condicionada (ROADMAP).
 */
export function chosenTastesOf(
  specs: readonly TasteSpec[],
  defs: readonly TasteDef[],
  origin: EventId,
): ChosenTaste[] {
  if (specs.length === 0) return [];
  const catalog = new Map<string, Set<string>>();
  for (const d of defs) {
    const items = catalog.get(d.domain) ?? new Set<string>();
    items.add(d.id);
    catalog.set(d.domain, items);
  }
  const { tastes, rejected } = resolveTastes(specs, catalog, origin);
  if (rejected.length > 0) {
    throw new Error(`gustos pedidos inválidos: ${rejected.map((r) => r.reason).join("; ")}`);
  }
  return tastes;
}

/** Lo que no cambia en la vida: sale del seed y del contenido, no se guarda. */
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

/** Las condiciones duras de una búsqueda de nacimiento (la edad la pone `playerAge`). */
function birthFilter(q: BirthQuery, defs: readonly StatusDef[]) {
  return (p: Person, alive: readonly Household[]): boolean => {
    if (q.sex !== undefined && p.sex !== q.sex) return false;
    if (q.position === undefined) return true;
    const seats = alive.map((h) => ({ id: h.id, members: h.members.length, since: h.since }));
    const status = assignStatuses(seats, defs).get(p.household)?.status;
    return defs.find((d) => d.id === status)?.role === q.position;
  };
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
  const query = options.birth;
  const hard = query !== undefined && (query.sex !== undefined || query.position !== undefined);
  const birth = hard ? birthFilter(query, content.all(STATUSES)) : undefined;
  const wish = query?.temperament;
  if (wish !== undefined) {
    const problems = validateTemperament(wish, content.all(TRAITS));
    if (problems.length > 0) {
      throw new Error(`temperamento pedido inválido: ${problems.join("; ")}`);
    }
  }
  const population = villagePopulation({
    seed,
    site,
    traits: content.all(TRAITS),
    demography: required(
      content.get(DEMOGRAPHY, "human.preindustrial-village"),
      "demography human.preindustrial-village",
    ),
    ...(options.playerAge === undefined ? {} : { playerAge: options.playerAge }),
    ...(birth ? { playerFits: birth } : {}),
    ...(wish && Object.keys(wish).length > 0
      ? { playerFit: (p: Person) => temperamentFit(p.innate, wish) }
      : {}),
  });
  const village: PlaceRef = { kind: "settlement", settlement: population.settlement };
  return { village, planet, site, map: localMapOf(planet, site), population };
}

/**
 * Insumos de arranque de los hogares con oficio (los mismos que `tradeOfHousehold` elige en la
 * corrida): unas tandas desde la fuente `seed`, poco a propósito.
 */
function tradeStock(pop: LifeTerrain["population"], seed: Seed, content: Content): Transfer[] {
  const recipes = content.all(TRADE_RECIPES);
  const goods = new Map(content.all(GOODS).map((g) => [g.id, g]));
  const born = new Map(pop.people.map((p) => [p.id, p.born]));
  const out: Transfer[] = [];
  for (const h of pop.households.filter((x) => x.end === null)) {
    const adults = h.members.filter(
      (m) => (pop.now - (born.get(m) ?? pop.now)) / EARTHLIKE_CLOCK.year >= ROUTINE.workAge,
    ).length;
    const r = tradeOfHousehold(seed, h.id, adults, recipes);
    if (!r) continue;
    for (const i of r.inputs) {
      const def = goods.get(i.good);
      if (!def) continue;
      out.push({
        unit: goodUnit(def),
        from: externalAccount("seed"),
        to: holderAccount(h.id),
        amount: i.amount * TRADE_START_BATCHES,
      });
    }
  }
  return out;
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

/** La lengua de la aldea y su etiqueta de habla (se rehace igual del seed y del contenido). */
function villageForm(seed: Seed, content: Content, language?: Language): ConverseForm {
  const concepts = content.all(CONCEPTS);
  return {
    language:
      language ??
      generateLanguage(
        seed,
        required(content.get(LANGUAGES, "village.hills"), "lengua village.hills"),
        concepts,
      ),
    concepts,
    registers: content.all(REGISTERS),
    addresses: content.all(ADDRESSES),
    taboos: content.all(TABOOS),
    etiquette: content.all(ETIQUETTE),
    culture: "village",
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
  | "nutrientProfiles"
  | "diets"
  | "goods"
  | "recipes"
  | "tradeRecipes"
  | "statuses"
  | "cultureTraits"
  | "speech"
  | "pressureCurves"
  | "schemas"
  | "values"
  | "stages"
  | "relationDims"
  | "relationBonds"
  | "habits"
  | "lineages"
  | "materials"
  | "trajectories"
  | "divinations"
  | "concerns"
  | "tastes"
  | "form"
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
    nutrientProfiles: content.all(NUTRIENT_PROFILES),
    diets: content.all(DIETS),
    goods: content.all(GOODS),
    materials: content.all(MATERIALS),
    recipes: content.all(RECIPES),
    tradeRecipes: content.all(TRADE_RECIPES),
    statuses: content.all(STATUSES),
    cultureTraits: content.all(CULTURE_TRAITS),
    speech: content.all(SPEECH_LINES),
    pressureCurves: content.all(PRESSURE_CURVES),
    schemas: content.all(SCHEMAS),
    values: content.all(VALUES),
    stages: content.all(LIFE_STAGES),
    relationDims: content.all(RELATION_DIMS),
    relationBonds: content.all(RELATION_BONDS),
    habits: content.all(HABITS_CONTENT),
    lineages: content.all(LINEAGES),
    trajectories: content.all(TRAJECTORIES),
    divinations: content.all(DIVINATION_METHODS),
    concerns: content.all(DIVINATION_CONCERNS),
    tastes: content.all(TASTES),
    form: villageForm(seed, content),
  };
}

/** Las fuentes y sumideros que la vida declara (conservación: nada entra ni sale por otro lado). */
export function ledgerConfigOf(content: Content): LedgerConfig {
  const units = content.all(FOODS).map((f) => ledgerUnit(`good:${f.id}`));
  const tradeUnits = [
    ...new Set(
      content
        .all(TRADE_RECIPES)
        .flatMap((r) => [r.output.good, ...r.inputs.map((i) => i.good)])
        .map((g) => ledgerUnit(`good:${g}`)),
    ),
  ];
  return {
    externals: {
      [COOKED]: units,
      [EATEN]: units,
      [HARVEST]: [HARVEST_GOOD],
      [ROTTED]: [...units, ...tradeUnits.filter((u) => !units.includes(u))],
      seed: [
        ...units,
        ...tradeUnits.filter((u) => !units.includes(u)),
        COPPER,
        ...settlementUnits(content.all(MATERIALS)),
      ],
      [WORKSHOP]: tradeUnits,
      [WORKSHOP_WASTE]: tradeUnits,
      [GATHERED_SOURCE]: settlementUnits(content.all(MATERIALS)),
      [DEBRIS_SINK]: settlementUnits(content.all(MATERIALS)),
      [WAGES_SINK]: [COPPER],
      [SMOKE_SINK]: settlementUnits(content.all(MATERIALS)),
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
  truth.set(SOIL, settlement, { fertility: SOIL_START, seen: 0 });
  truth.set(PARCEL_SOIL, settlement, { soil: startingParcel(SOIL_START), seen: 0 });
  const trajectory = pickTrajectory(content.all(TRAJECTORIES), map.climate.annualPrecipMm);
  if (trajectory) {
    const hexes = ecologyHexes(map);
    const productivity = dailyProductivity({
      tempMeanC: map.climate.annualMeanC,
      annualPrecipMm: map.climate.annualPrecipMm,
      soilFertility: SOIL_START,
      hexes,
    });
    truth.set(ECOLOGY, settlement, {
      cell: initialCell(content.all(LINEAGES), {
        annualMeanC: map.climate.annualMeanC,
        annualPrecipMm: map.climate.annualPrecipMm,
        hexes,
        shelter: map.forest.filter(Boolean).length / Math.max(1, map.forest.length),
        productivity,
      }),
      forest: { stage: trajectory.climax, stageAge: 0, fuel: 0.5, trajectory },
      fireHazard: 0,
      day: 0,
      yearDays: 0,
    });
  }
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
  const spaces = liveSettlementSpaces(
    truth,
    site.hex,
    [],
    new Map(materials.map((m) => [m.id, m])),
  );
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
  const community = seedCulture(truth, ids, log, {
    settlement,
    place: terrain.village,
    now: pop.now,
    foundersEvent: pop.foundersEvent,
    culture,
    traits: content.all(CULTURE_TRAITS),
  });
  // Cómo suena su habla: el acento de la lengua madre con la deriva de la separación (language §5).
  seedCommunityAccent(truth, ids, log, {
    seed,
    settlement,
    place: terrain.village,
    now: pop.now,
    foundersEvent: pop.foundersEvent,
    language: language.id,
    generations: VILLAGE_SEPARATION,
  });
  // Lo que cada uno sigue de ella: los hijos copian a sus padres (culture §4).
  seedPeopleCulture(truth, ids, log, {
    seed,
    now: pop.now,
    place: terrain.village,
    community,
    traits: content.all(CULTURE_TRAITS),
  });
  // La religión popular, parte de esa cultura: ancestros, el pozo, una fiesta, tabúes (religion §2, §6).
  const religion = content.all(RELIGIONS).find((r) => r.culture === culture.id);
  if (!religion) throw new Error("falta contenido: religión de la cultura village");
  const villageFaith = seedReligion(truth, ids, log, {
    settlement,
    place: terrain.village,
    now: pop.now,
    foundersEvent: pop.foundersEvent,
    religion,
    doctrines: content.all(DOCTRINES),
  });
  // Lo que cada uno cree y cumple de ella: los hijos siguen a sus padres (religion §1).
  seedPeopleReligion(truth, ids, log, {
    seed,
    now: pop.now,
    place: terrain.village,
    religion: villageFaith,
  });
  // Lo adquirido de cada mente: esquemas de base desde el temperamento (npc-psychology §1-§2).
  seedMinds(truth, ids, log, {
    seed,
    now: pop.now,
    place: terrain.village,
    foundersEvent: pop.foundersEvent,
    schemas: content.all(SCHEMAS),
    history: {
      people: pop.people,
      events: pop.events,
      yearTicks: clock.year,
      stages: content.all(LIFE_STAGES),
    },
  });
  // Qué le gusta y qué rechaza a cada uno: temperamento, cuerpo, cultura y lo conocido de chico (§16).
  const tasteDefs = content.all(TASTES);
  const chosenTastes = chosenTastesOf(options.tastes ?? [], tasteDefs, pop.foundersEvent);
  seedTastes(truth, ids, log, {
    seed,
    ...(chosenTastes.length > 0 ? { chosen: new Map([[pop.player, chosenTastes]]) } : {}),
    now: pop.now,
    place: terrain.village,
    foundersEvent: pop.foundersEvent,
    defs: tasteDefs,
    taboos: villageFaith.practices.filter((p) => p.kind === "taboo"),
  });
  // Lo que cada uno siente por su parentela y su casa (npc-psychology §6).
  seedRelations(truth, ids, log, {
    seed,
    now: pop.now,
    place: terrain.village,
    foundersEvent: pop.foundersEvent,
    dims: content.all(RELATION_DIMS),
    bonds: content.all(RELATION_BONDS),
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
  // Despensas de arranque: lo que cada hogar guardó de la última cosecha para llegar a la próxima
  // (`larderNeeded`: sus brazos en el campo contra sus bocas, día por día del año que viene).
  const season = harvestSeason(map.climate, clock, Rng.root(seed));
  const startDay = dayOf(clock, pop.now + Math.round((map.lonDeg / 360) * clock.day));
  const birthOf = new Map(pop.people.map((p) => [p.id, p.born]));
  const larderOf = (h: { members: readonly AgentId[]; id: HouseholdId }): number =>
    Math.round(
      larderNeeded(
        h.members.map((m) => (pop.now - (birthOf.get(m) ?? pop.now)) / clock.year),
        clock,
        season,
        startDay,
      ) * wealthOf(h.id),
    );
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
          amount: larderOf(h),
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
        )
        .concat(tradeStock(pop, seed, content)),
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
      nutrientProfiles: content.all(NUTRIENT_PROFILES),
      diets: content.all(DIETS),
      goods: content.all(GOODS),
      recipes: content.all(RECIPES),
      tradeRecipes: content.all(TRADE_RECIPES),
      statuses: content.all(STATUSES),
      cultureTraits: content.all(CULTURE_TRAITS),
      speech: content.all(SPEECH_LINES),
      pressureCurves: content.all(PRESSURE_CURVES),
      schemas: content.all(SCHEMAS),
      values: content.all(VALUES),
      stages: content.all(LIFE_STAGES),
      relationDims: content.all(RELATION_DIMS),
      relationBonds: content.all(RELATION_BONDS),
      habits: content.all(HABITS_CONTENT),
      lineages: content.all(LINEAGES),
      materials,
      trajectories: content.all(TRAJECTORIES),
      divinations: content.all(DIVINATION_METHODS),
      concerns: content.all(DIVINATION_CONCERNS),
      tastes: content.all(TASTES),
      form: villageForm(seed, content, language),
      ...optInParts(options, site.terrain),
    },
    pop.player,
    terrain.village,
    { now: pop.now, seq: 0, queue: [] },
  );
  const me = truth.get(PERSON, pop.player);
  if (me) {
    world.truth.set(
      INVENTORY_BELIEF,
      pop.player,
      checkInventory(
        world.ledger.holdings(holderAccount(pop.player as unknown as HolderRef)),
        world.ledger.holdings(holderAccount(me.household as unknown as HolderRef)),
        pop.now,
      ),
    );
  }
  return { world, terrain };
}
