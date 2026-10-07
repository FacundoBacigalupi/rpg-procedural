// Arma la vida real (player-loop §1-§2, Fase 1): el planeta, la aldea con su gente de la
// pre-corrida, el personaje que sale de ella, y cada sistema sembrado (cuerpos, habilidades,
// lugares, ubicaciones). Todo sale del seed y del contenido; el mismo seed da la misma vida.

import {
  type AgentId,
  type Content,
  EARTHLIKE_CLOCK,
  EventLog,
  externalAccount,
  type HouseholdId,
  holderAccount,
  IdAllocator,
  Ledger,
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
  DEMOGRAPHY,
  EATEN,
  ENTITY,
  FOODS,
  houseKey,
  LOCATION,
  type LocalMap,
  PERSON,
  PLACE,
  PLANS,
  SKILLS,
  SkillCatalog,
  seedBodies,
  seedSkills,
  seedVillage,
  TRAITS,
  type Trait,
  type VillagePopulation,
  villagePopulation,
  villageSpaces,
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
export const LARDER_PER_MEMBER_G = 200_000;

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
  "seed" | "clock" | "map" | "spaces" | "catalog" | "skills" | "traits" | "plans" | "foods"
> {
  return {
    seed,
    clock: EARTHLIKE_CLOCK,
    map: anchor.map,
    spaces: villageSpaces({ hex: anchor.hex, households: anchor.households }),
    catalog: new ActionCatalog(content.all(ACTIONS), content.all(PLANS)),
    skills: new SkillCatalog(content.all(SKILLS), content.all(ACTIONS)),
    traits: content.all(TRAITS),
    plans: content.all(BODY_PLANS),
    foods: content.all(FOODS),
  };
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
  }

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

  const households = pop.households.filter((h) => h.end === null).map((h) => h.id);
  const spaces = villageSpaces({ hex: site.hex, households });
  const ids = idsAfter(truth, log);
  const foods = content.all(FOODS);
  const units = foods.map((f) => ledgerUnit(`good:${f.id}`));
  const ledger = new Ledger({ externals: { [EATEN]: units, seed: units } });
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
          amount: h.members.length * LARDER_PER_MEMBER_G,
        })),
    });
  }
  const catalog = new ActionCatalog(content.all(ACTIONS), content.all(PLANS));

  const world = lifeWorld(
    { seed, clock, truth, ids, log, ledger, map, spaces, catalog, skills, traits, plans, foods },
    pop.player,
    terrain.village,
    { now: pop.now, seq: 0, queue: [] },
  );
  return { world, terrain };
}
