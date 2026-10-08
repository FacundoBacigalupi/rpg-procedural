// Todos los tipos de `content/` que conoce el juego (content/README): quien carga la carpeta
// entera usa esta lista, así una carpeta nueva no rompe a los que no la registraron.

import type { ContentKind } from "../core/index.ts";
import { BIOMES } from "../worldgen/index.ts";
import { ACTIONS, PARSER_EXAMPLES, PLANS } from "./actions/index.ts";
import { BODY_PLANS, FOODS } from "./body/index.ts";
import { PRESSURE_CURVES } from "./causality/index.ts";
import { RECIPES } from "./crafts/index.ts";
import { CULTURE_TRAITS, CULTURES } from "./culture/index.ts";
import { SPEECH_LINES } from "./dialogue/index.ts";
import { GOODS } from "./economy/index.ts";
import { ELEMENT_SYSTEMS } from "./elements/index.ts";
import { DEMOGRAPHY, TRAITS } from "./family/index.ts";
import { CONCEPTS, LANGUAGES } from "./language/index.ts";
import { LIFE_STAGES, SCHEMAS, VALUES } from "./mind/index.ts";
import { TENURES } from "./property/index.ts";
import { RELATION_BONDS, RELATION_DIMS } from "./relations/index.ts";
import { DOCTRINES, RELIGIONS } from "./religion/index.ts";
import { BUILDING_TYPES, MATERIALS, WORK_TYPES } from "./settlements/index.ts";
import { SKILLS } from "./skills/index.ts";
import { STATUSES } from "./social/index.ts";

export const CONTENT_KINDS: readonly ContentKind[] = [
  BIOMES,
  TRAITS,
  DEMOGRAPHY,
  SKILLS,
  BODY_PLANS,
  FOODS,
  GOODS,
  PRESSURE_CURVES,
  ACTIONS,
  PLANS,
  PARSER_EXAMPLES,
  MATERIALS,
  BUILDING_TYPES,
  WORK_TYPES,
  LANGUAGES,
  CONCEPTS,
  RECIPES,
  STATUSES,
  SPEECH_LINES,
  TENURES,
  CULTURE_TRAITS,
  CULTURES,
  DOCTRINES,
  RELIGIONS,
  ELEMENT_SYSTEMS,
  SCHEMAS,
  VALUES,
  LIFE_STAGES,
  RELATION_DIMS,
  RELATION_BONDS,
] as readonly ContentKind[];
