// Todos los tipos de `content/` que conoce el juego (content/README): quien carga la carpeta
// entera usa esta lista, así una carpeta nueva no rompe a los que no la registraron.

import type { ContentKind } from "../core/index.ts";
import { BIOMES } from "../worldgen/index.ts";
import { ACTIONS, PARSER_EXAMPLES, PLANS } from "./actions/index.ts";
import { BODY_PLANS, FOODS } from "./body/index.ts";
import { PRESSURE_CURVES } from "./causality/index.ts";
import { RECIPES } from "./crafts/index.ts";
import { GOODS } from "./economy/index.ts";
import { DEMOGRAPHY, TRAITS } from "./family/index.ts";
import { CONCEPTS, LANGUAGES } from "./language/index.ts";
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
] as readonly ContentKind[];
