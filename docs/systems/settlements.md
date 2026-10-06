# Asentamientos y edificios

> Principio: **la gente se queda donde algo la retiene.** Un asentamiento nace en un lugar por razones que se pueden señalar (agua, tierra, un vado, una vena de qi, una secta, una mina), crece mientras esas razones alcancen y decae cuando dejan de alcanzar. Está hecho de edificios e infraestructura que son objetos: tienen materiales con origen, dueño, uso y deterioro, y sin alguien que los mantenga se caen.

> Estado: **borrador** (2026-10-06).

Depende de: [planet-gen.md](planet-gen.md) (relieve, hidrología, suelos, qi, desastres), [living-world.md](living-world.md) §1, §6, §9 (desastres, rutas, sucesión y fuego), [economy.md](economy.md) §5-§7 (mercados, comercio, lotes con origen), [perception.md](perception.md) §3 (grafo de espacios), [simulation.md](simulation.md) §4-§6 (zonas, tiers, materialización), [state.md](state.md) §3, §11 (registros, obras públicas), [war.md](war.md) §9 (fortificaciones y asedios), [crafts.md](crafts.md) (sesiones de oficio, formaciones), [technology.md](technology.md) (construcción), [deep-history.md](deep-history.md) §1 (estratos, montículos), [spirits.md](spirits.md) §7 (santuarios), [family-lineage.md](family-lineage.md) §7 (el hogar), [elements.md](elements.md) (fuego y agua con magnitud).
Lo usan: [property.md](property.md) (quién es dueño de la tierra y los edificios), [travel.md](travel.md) (caminos, posadas, puertos), [weather.md](weather.md) (daño por clima), [culture.md](culture.md) (estilos y normas de uso del espacio), organizations (sedes), law (cárceles, tribunales), chronicle (ruinas y legados).

---

## Principios

1. **Cada asentamiento tiene anclas:** las razones por las que la gente está ahí, con causa. No hay asentamientos puestos al azar.
2. **Los edificios son objetos.** Tienen materiales (lotes con origen: el bosque talado, la cantera), dueño, ocupantes, usos, estado por componente y contenido. Construir consume; destruir libera o pierde, siempre por el ledger.
3. **La forma sale de decisiones:** hogares que eligen dónde construir, autoridades que trazan, normas culturales sobre qué va dónde y precios del suelo que salen de creencias.
4. **Todo se deteriora.** El clima, el uso y el abandono degradan; mantener cuesta trabajo y materiales. La infraestructura depende de quien la mantiene: si el dueño se debilita, la obra se cae y aparecen presiones (inundaciones, sed, enfermedades).
5. **Los desastres son procesos:** un incendio necesita ignición, combustible y viento; un derrumbe, una estructura débil y una carga. Reconstruir depende de quién sobrevive, qué le queda y qué quiere.
6. **Ruinas con historia.** Lo abandonado se desarma, se saquea, lo reclama la naturaleza y queda en los estratos. Encima se puede volver a construir.

---

## 1. Qué es un asentamiento

```ts
interface Settlement {
  id: SettlementId;
  names: PlaceNameId[];                      // en capas, por lengua y época (deep-history §11, language #41)
  cells: CellId[];                           // celdas hex que ocupa (y su territorio cercano en `hinterland`)
  hinterland: CellId[];                      // campos, bosques, pastos y canteras de los que vive
  anchors: SettlementAnchor[];               // §2: por qué hay gente acá
  kind: SettlementKind;                      // derivado, no elegido (§3)
  population: PopulationRef;                 // agregado (tier 0) o individuos (tier 1-4), según la zona
  households: HouseholdId[];                 // hogares materializados (family-lineage §7)
  districts: DistrictId[];                   // §4
  buildings: BuildingStockRef;               // §5: edificios individuales o stock agregado
  infrastructure: WorkId[];                  // §8
  markets: MarketId[];                       // economy §5
  institutions: OrgId[];                     // templo, gremios, sede de secta, oficina del magistrado, bandas
  authority: AuthorityRef[];                 // quién manda y con qué reclamo: jefe de aldea, magistrado, secta, señor (state, organizations)
  layout: LayoutPattern;                     // §4
  status: "founding" | "growing" | "stable" | "declining" | "abandoned" | "ruin";
  foundedBy: EventId;                        // el evento de fundación (§2)
  originEventId: EventId;
}

type SettlementKind =
  | "hamlet" | "village" | "market_town" | "town" | "city" | "capital"
  | "port" | "fortress" | "garrison" | "mining_camp" | "sect_town" | "temple_town"
  | "waystation" | "nomad_camp" | "refugee_camp" | "outpost";
```

- **`kind` es una etiqueta derivada** del tamaño, las anclas y las instituciones: una aldea con feria cada cinco días y un gremio es un pueblo de mercado. La etiqueta cultural (cómo lo llaman) puede diferir de la verdad: un "pueblo" en los registros que hace años es una aldea medio vacía.
- **Un asentamiento no es una organización.** Sus instituciones sí lo son (organizations); el asentamiento es el lugar, su gente y sus cosas.

## 2. Dónde nace

### 2.1 Anclas

```ts
type SettlementAnchor =
  | { kind: "water"; source: WaterSourceRef }               // río, manantial, lago, acuífero alcanzable
  | { kind: "farmland"; cells: CellId[]; yield: number }    // suelo y clima que dan excedente
  | { kind: "pasture"; cells: CellId[] }
  | { kind: "defense"; feature: FeatureRef }                // colina, meandro, isla, desfiladero
  | { kind: "crossing"; feature: FeatureRef }               // vado, paso de montaña, confluencia, cruce de rutas
  | { kind: "harbor"; feature: FeatureRef }
  | { kind: "resource"; deposit: DepositRef }               // mina, sal, arcilla, madera, pesca
  | { kind: "qi"; vein: VeinRef }                           // una vena espiritual (cultivation §12)
  | { kind: "sacred"; site: SiteId }                        // santuario, tumba de un santo, montaña sagrada
  | { kind: "institution"; org: OrgId }                     // la secta, el monasterio, la guarnición que trae gente
  | { kind: "administrative"; claim: ClaimId }              // capital de condado puesta por el estado
  | { kind: "market"; market: MarketId };                   // la feria que se volvió permanente
```

- **Cada ancla tiene fuerza** (cuánta gente sostiene) y **se puede perder** (el río cambia de cauce, la mina se agota, la secta se muda, la ruta se desvía). La fuerza total de las anclas da la capacidad del lugar (§3).

### 2.2 Fundar

Fundar es una **decisión de agentes** con utilidad sobre sus creencias:
- **Hogares que migran** por una presión (hambre, guerra, deudas, persecución) eligen un lugar entre los que conocen o les contaron, y pueden elegir mal: una llanura fértil que se inunda cada veinte años, un valle "libre" que es territorio de una bestia.
- **Un estado que coloniza** funda guarniciones, colonias agrícolas o capitales con trazado planificado (state §11).
- **Una secta** abre su montaña y atrae sirvientes, comerciantes y familias de discípulos.
- **Una fiebre** (una mina, un tesoro, una apertura de reino secreto) crea campamentos que pueden quedar o vaciarse.
- **Un mercado o una posada** en un cruce crece hasta volverse pueblo.
- **Refugiados** de una guerra o una calamidad arman campamentos que, si no los dispersan, se vuelven barrios o aldeas.

La fundación es un evento con causas (la presión, la decisión, el conocimiento del lugar) y queda en la memoria del asentamiento: el mito de fundación es la versión deformada (living-world §4).

## 3. Crecer y decaer

- **Capacidad:** la fuerza de las anclas da un techo blando de población: comida del territorio (más lo que entra por comercio), agua, espacio para construir y materiales cerca.
- **Movimiento de gente:** nacimientos y muertes (family-lineage, body-health) y migración por **atractivo creído** (salarios, tierra, seguridad, fama de la ciudad) contra el lugar de origen. Las noticias de oportunidades viajan como cualquier rumor (information).
- **Crecer cuesta:** más gente necesita más campos (se tala, se drena, se aterraza), más agua (pozos más hondos, canales), más casas (materiales) y más comida importada. Si no alcanza, sube el precio, aparecen los barrios precarios y la presión de hambre (causality).
- **Umbrales que cambian el tipo:** una aldea con excedente y un cruce de rutas atrae un mercado periódico; con un mercado permanente aparecen gremios; con amenazas y recursos se amuralla; con un magistrado pasa a ser cabecera.
- **Decaer:** se pierde un ancla, cambia una ruta, una guerra o una plaga se lleva gente, una vena de qi se agota, la secta se va, el estado mueve la capital. El decaimiento tiene inercia: la gente se queda por sus casas, sus tumbas y sus deudas, hasta que una presión la empuja.

## 4. Forma y orden

```ts
interface District {
  id: DistrictId;
  settlement: SettlementId;
  functions: DistrictFunction[];             // residencial, artesanos, mercado, templos, gobierno, enclave de secta, extranjeros, burdeles, puerto, afuera de las murallas
  status: StatusProfile;                     // quién vive (social-structure): ricos, pobres, una casta, una etnia
  streets: SpaceGraphRef;                    // el grafo de espacios de las calles (perception §3)
  landValue: BeliefAggregate;                // precio del suelo como creencia de los que compran y venden
  reputation: BeliefAggregate;               // "barrio peligroso", "barrio de los ricos"
  gates?: GateRef[];                         // barrios con puertas y toque de queda
  originEventId: EventId;
}

type LayoutPattern =
  | "organic"      // creció por caminos y parcelas
  | "linear"       // a lo largo de un camino, río o costa
  | "grid"         // trazado por una autoridad (orientación cosmológica según la cultura)
  | "concentric"   // alrededor de un castillo, templo o colina
  | "terraced"     // en ladera
  | "dispersed";   // granjas sueltas sin centro
```

- **Qué va dónde** sale de normas culturales (culture #40: el templo en alto, las curtiembres río abajo y a sotavento, los cementerios afuera de las murallas), de precios (los oficios sucios donde el suelo es barato), de la ley (barrios de extranjeros, toques de queda) y del qi (el mejor punto de la vena para la secta o el palacio).
- **Geomancia (风水):** es una teoría cultural sobre el lugar (discovery §6) con parte de verdad: hay flujos de qi reales en el campo (planet-gen, elements), y la teoría acierta en algunos y erra en otros. Una ciudad trazada con buena geomancia puede ganar algo real y mucho de creencia (aprobado 2026-10-06): el efecto real es chico y solo existe cuando la teoría coincide con el flujo verdadero; el resto (precio del suelo, prestigio, la idea de que un lugar trae mala suerte) es creencia y mueve conductas igual.
- **Lo planificado se desordena:** un trazado en cuadrícula se llena de construcciones ilegales, patios subdivididos y callejones si la autoridad no controla.

## 5. Edificios

```ts
interface Building {
  id: BuildingId;
  type: BuildingTypeId;                      // content/buildings/: casa de campesino, patio de cuatro alas, taller, posada, templo…
  settlement?: SettlementId;                 // o suelto: una cabaña en el bosque, una torre de vigía
  district?: DistrictId;
  plot: ParcelId;                            // el terreno ([property.md](property.md) §3)
  spaces: SpaceGraphRef;                     // por dentro: cuartos, patios, puertas (perception §3)
  components: BuildingComponent[];           // §5.1
  owner: OwnerRef;                           // derechos en [property.md](property.md); puede ser distinto de quien lo usa
  occupants: AgentId[];                      // quién vive o trabaja ahí
  uses: BuildingUse[];                       // vivienda, taller, tienda, depósito, culto, administración, cultivo…
  fixtures: FixtureId[];                     // fogón, kang, horno, fragua, pozo propio, altar, caldero de alquimia
  contents: InventoryRef;                    // lo que hay adentro (economy: lotes)
  formations?: FormationId[];                // crafts: protección, ocultamiento, reunión de qi
  style: StyleRef;                           // cultura y época (deep-history: secuencias de estilos)
  fuelLoad: number;                          // qué tan bien arde (§9)
  builtBy: EventId;                          // la construcción (§6)
  originEventId: EventId;
}

interface BuildingComponent {
  part: "foundation" | "frame" | "walls" | "roof" | "floor" | "doors" | "interior" | ComponentId;
  materials: LotId[];                        // con origen: madera de tal bosque, piedra de tal cantera, tejas de tal horno
  condition: number;                         // 0-1
  quality: number;                           // de la construcción (§6)
  defects: Defect[];                         // ocultos: cimiento mal asentado, madera verde, mezcla pobre
}
```

- **Tipos en `content/buildings/`:** cada tipo dice qué espacios tiene, qué componentes, qué materiales acepta, qué tecnología pide (technology: el arco, la teja cocida, la bóveda) y qué oficios hacen falta. Hay tipos mortales (casa, granero, molino, horno, posada, casa de té, burdel, baños, escuela, oficina del magistrado, cárcel, cuartel, almacén, establo, salón ancestral, tumba) y de cultivadores (cueva de cultivo, sala de alquimia, salón de formaciones, biblioteca de técnicas, campos espirituales, puertas de montaña).
- **Lo que se ve y lo que es:** la fachada se percibe (tamaño, materiales, cuidado, estilo) y de ahí sale lo que la gente cree sobre el dueño (social-structure: marcas de posición). Los defectos no se ven hasta que fallan o alguien con oficio los busca.

## 6. Construir

- **Es un proyecto** (schemes: `construction`) o una tarea del hogar. Tiene plano (a veces solo en la cabeza del constructor), materiales, mano de obra y tiempo.
- **Materiales con origen:** talar baja la madera del bosque (living-world: sucesión), sacar piedra abre una cantera, cocer ladrillos y tejas consume leña. Todo pasa por el ledger. Reusar piedra de una ruina deja la cadena de origen ("esta columna vino del templo viejo"), que la arqueología puede leer.
- **La obra es una sesión de oficio por pasos** (crafts): cimientos, estructura, muros, techo. La calidad sale de la habilidad (carpintería, albañilería), los materiales y el apuro, y los errores quedan como defectos ocultos.
- **Quién construye:** el propio hogar (construcción vernácula, con los saberes de la cultura), artesanos contratados (gremios, economy), trabajo forzado (corvea del estado, esclavos), discípulos de secta o cultivadores. Un cultivador mueve piedras que diez hombres no mueven y sella con formaciones, pero gasta qi y tiempo de cultivo, y casi nunca lo hace para mortales sin pago.
- **Tiempos y costos realistas:** una casa de adobe en semanas, un templo de piedra en años, una muralla de ciudad en décadas.

## 7. Deterioro y mantenimiento

- **Cada componente se degrada** según su material, el clima (lluvia, helada, humedad, sol; [weather.md](weather.md) §5), las plagas (termitas, podredumbre), el uso y los desastres.
- **Fallas en cadena:** un techo que gotea pudre la estructura, la estructura cede, el edificio se cae. Un derrumbe es un evento con heridos y muertos (body-health) y deja escombros.
- **Mantener** consume materiales y trabajo: reparar tejas después de cada temporada de lluvias, revocar paredes, cambiar vigas. Un hogar pobre posterga, y su casa se degrada más rápido.
- **Formaciones de preservación** frenan el deterioro mientras reciban qi; si la fuente se corta, el edificio "envejece de golpe" lo postergado.

## 8. Infraestructura

```ts
interface Work {
  id: WorkId;
  kind: "well" | "cistern" | "aqueduct" | "canal" | "irrigation" | "dike" | "drain" | "latrine"
      | "road" | "bridge" | "ford_path" | "wall" | "gate" | "granary" | "mill" | "dock" | "lighthouse"
      | "watchtower" | "firebreak" | "formation_grid" | WorkKindId;
  geometry: CellId[] | SpaceRef[];
  capacity: number;                          // agua por día, carga por día, gente que protege
  condition: number;
  owner: OwnerRef;                           // estado, comunidad, secta, privado
  maintainer?: AgentId | OrgId | CommunityRef; // quién la cuida de hecho (puede no ser el dueño)
  builtBy: EventId;
  originEventId: EventId;
}
```

- **Agua:** los pozos llegan al acuífero que da la hidrología de planet-gen; se secan en sequía, se salinizan o se envenenan (a propósito o por las letrinas). Las cisternas guardan lluvia y los acueductos traen agua de lejos.
- **Saneamiento:** letrinas, aguas negras y basura. La densidad sin saneamiento dispara el contagio (body-health). Juntar los desechos como abono es parte de la economía. Las ratas y los perros de la basura vienen solos (living-world §12: comensales).
- **Diques y canales:** protegen e irrigan, pero crean presiones: un río encauzado sedimenta y sube su lecho, y el dique tiene que subir con él. Si se descuida, la inundación es más grande que si nunca se hubiera encauzado.
- **Caminos y puentes:** hacen las rutas (living-world §6, [travel.md](travel.md) §1). Un puente caído desvía el comercio, y con él la suerte de un pueblo.
- **Murallas y puertas:** defienden (war §9), cobran peajes, cierran de noche y filtran quién entra. Mantenerlas cuesta mucho, y por eso muchas ciudades tienen murallas en mal estado justo cuando llega la guerra.
- **Graneros:** reserva pública o privada contra el hambre. Su contenido es verdad, y lo registrado es otra cosa (state §3): un granero "lleno" en los libros puede estar vacío por robo.
- **Quién mantiene:** la obra decae si su mantenedor se debilita. Cuando el estado colapsa, los diques se descuidan y una inundación llega años después: la causa queda en el grafo.

## 9. Fuego

- **Ignición con causa:** fogones, lámparas, rayos, incendios intencionales, guerra, técnicas de fuego. Las chispas son frecuentes; los incendios grandes necesitan combustible, sequedad y viento.
- **Propagación por el grafo de edificios:** cada edificio tiene su `fuelLoad` (paja, madera y papel arden; ladrillo y teja frenan), la distancia y los cortafuegos frenan, y el viento (weather) empuja. Es un frente como el de los incendios forestales (living-world §9), sobre edificios.
- **Respuesta:** vecinos con baldes, tinajas de agua en las esquinas, brigadas, derribar casas para cortar el fuego, cultivadores con técnicas de agua (elements: la magnitud importa, y una técnica chica sobre un incendio grande se evapora).
- **Lo que deja:** contenido destruido (ledger), muertos y heridos, hogares sin casa, deudas y disputas por los terrenos (property), una capa de incendio en los estratos (deep-history) y a veces nuevas normas (edificar con ladrillo, ensanchar calles) si la autoridad aprende.

## 10. Otros desastres

Inundaciones, terremotos, deslaves, tormentas, plagas, asedios y batallas de cultivadores pegan sobre los edificios según su estructura real: un terremoto encuentra los defectos ocultos, una crecida los cimientos bajos. Los desastres vienen de planet-gen, living-world, weather y war; este doc define cómo responden los edificios y la infraestructura.

## 11. Reconstruir

- **Depende de los sobrevivientes:** quién quedó, qué ahorros, qué crédito, qué ayuda (el estado, la secta, el templo, los parientes).
- **Se puede reconstruir igual, mejor, distinto, en otro lugar o no hacerlo.** Los terrenos vacíos los ocupa otro, a veces con trampa (property: usurpación).
- **La memoria queda:** el barrio quemado, la crecida del año del dragón, el puente que se llevó el río forman parte de lo que la gente cree y cuenta.

## 12. Abandono y ruina

- **Por qué se abandona:** se pierde un ancla, una guerra o una plaga, la creencia de que el lugar está maldito (con o sin espíritus reales), una orden del estado (deportación, traslado).
- **Cómo se desarma:** sin mantenimiento el deterioro se acelera; los vecinos se llevan piedra, vigas y tejas (con cadena de origen); la vegetación avanza (sucesión); se instalan bestias, bandidos, refugiados o espíritus (spirits §1: muertes masivas).
- **La ruina es un sitio** con estratos (deep-history §1) y, si fue grande, con legados (chronicle). Reocuparla encima forma montículos con ciudades apiladas.

## 13. La vida del lugar

- **Ritmos:** días de feria, toques de queda, horarios de puertas, fiestas (culture #40), temporadas de trabajo.
- **Lugares donde se juntan noticias:** posadas, casas de té, el pozo, el templo, el mercado (information §6).
- **Vivienda como mercado:** alquiler y compra de casas y cuartos (economy, property). Si falta vivienda, se subdividen patios, se amontonan familias y se arman barrios precarios afuera de las murallas.
- **Vecindad como red:** los vecinos se conocen, se prestan, se vigilan y chismean (npc-psychology: relaciones). Un desconocido en un barrio cerrado se nota.

## 14. Lugares de cultivadores

- **Montañas de secta:** puertas con formaciones, salones, cuevas de cultivo sobre los mejores puntos de la vena, campos espirituales, salas de alquimia, bibliotecas, cárceles. Una secta grande es una ciudad para pocos, con un pueblo de sirvientes y comerciantes al pie.
- **Pueblos bajo protección:** pagan tributo, mano de obra o hijos con talento; la secta los protege (o no) de bestias y bandidos.
- **Edificios que duran siglos** si se alimentan las formaciones; ruinas de sectas caídas con formaciones medio activas que siguen protegiendo o matando.

## 15. Asentamientos móviles

- **Nómadas y pastores:** campamentos que se mueven con las estaciones (living-world §11: trashumancia), con viviendas desmontables que son edificios portátiles. Tienen anclas por temporada: pastos, pozos y lugares de invierno.
- **Ejércitos y caravanas** arman campamentos temporales con su propio saneamiento, sus incendios y sus mercados.

## 16. Verdad, creencia y registro

- **Cada uno conoce su barrio:** el mapa mental del asentamiento es creencia (information §5); un recién llegado no sabe qué calles evitar.
- **Los registros mienten o se atrasan:** el catastro y el registro de hogares del estado (state §3) son otra cosa que la verdad.
- **La reputación de los lugares** es creencia colectiva: "el barrio del río es peligroso" puede ser cierto, exagerado o cosa de hace veinte años.

## 17. El jugador y el narrador

- **Llegar a una ciudad:** los percepts dependen de por dónde se entra y de lo que se ve: la muralla, el olor del barrio de curtiembres, el ruido del mercado. El narrador nombra con el léxico del personaje ("un patio de cuatro alas", "la casa grande del terrateniente").
- **Vivir en un lugar:** alquilar un cuarto, comprar una casa, construir la propia, repararla, perderla en un incendio. Todo con los verbos de siempre (actions) y las sesiones de oficio.
- **Construir de punta a punta** (aprobado 2026-10-06): el personaje puede levantar su casa, su taller o su cueva de cultivo él mismo: conseguir el terreno y los materiales, contratar o hacer el trabajo, y fallar (defectos, plata que no alcanza, un vecino que reclama el terreno). Usa las mismas sesiones de oficio que los NPCs.
- **Los paneles** muestran lo que el personaje cree de su casa y su barrio, nunca el estado real de los componentes (un cimiento malo se descubre cuando falla o cuando un albañil lo revisa).

## 18. Escala (LOD)

| Resolución | Asentamiento | Edificios |
|---|---|---|
| Escena | Grafo de espacios completo donde está el jugador | Individuales con componentes, contenido y espacios internos |
| Local | Barrios con calles; edificios relevantes materializados | Individuales donde hay agentes de tier 3-4; el resto como stock |
| Regional | Barrios agregados; infraestructura como capacidades | Stock por tipo, estado medio y riesgo de incendio |
| Mundo | Población, tipo, anclas, stock agregado | Conteos por tipo y estado |
| Historia | Nodos que nacen, crecen, se queman, se abandonan | Estilos, capas y ruinas |

- **Materialización** (simulation §6): al entrar a un barrio, sus edificios se sintetizan desde el stock (tipo, edad, estado, dueño) respetando los hechos fijados ("la posada donde dormiste sigue ahí").
- **Incendios en agregado** (aprobado 2026-10-06): lejos del jugador, cada barrio tiene un riesgo según densidad, materiales, sequía y viento, y un incendio grande se resuelve como un solo evento con daño por tipo de edificio. Casa por casa solo en escena y local.
- **Detalle de los edificios** (aprobado 2026-10-06): componentes, materiales y defectos individuales solo en los edificios cerca del jugador o de agentes de tier 3-4; el resto es stock por barrio que se materializa al entrar.

## 19. Implementación por fase

- **Fase 1:** la aldea inicial con anclas, una docena de edificios con componentes, grafo de espacios, dueños y contenido; un pozo y un camino.
- **Fase 3:** hogares que construyen y reparan, deterioro por clima y uso, fuego en la aldea con propagación y respuesta, agua y saneamiento con contagio.
- **Fase 5:** varios asentamientos con anclas, crecimiento y migración por atractivo creído, barrios, mercados, caminos y puentes, stock agregado con materialización.
- **Fase 6:** montañas de secta con formaciones, obras públicas del estado (diques, canales, graneros, murallas), pueblos bajo protección.
- **Fase 7:** fundación, crecimiento, decaimiento y abandono en la historia; ruinas con estratos y reuso de materiales; mitos de fundación.
- **Fase 8:** ciudades grandes con LOD de barrios completo, nómadas y campamentos.

## Tests

- **Anclas:** ningún asentamiento sin al menos un ancla con causa; si se pierden todas, el asentamiento decae.
- **Conservación:** construir resta madera, piedra y leña de su origen; un incendio destruye contenido por el ledger; el reuso de piedra conserva la cadena de origen.
- **Incendio determinista:** misma aldea, mismo viento y misma ignición → mismo frente y mismas pérdidas.
- **Derrumbe con causa:** un edificio solo se cae con condición bajo umbral y una carga (lluvia, terremoto, peso).
- **Infraestructura sin mantenedor:** un dique sin mantenimiento llega a fallar; con mantenimiento, no por esa causa.
- **Agregado contra individual:** incendios por año, tasa de deterioro y crecimiento por migración coinciden con tolerancia entre los dos modos (simulation §9).
- **Ruinas:** un asentamiento abandonado deja un sitio con estratos y edificios degradándose; reocuparlo apila capas.

## Decisiones (aprobado 2026-10-06)
- **Edificios individuales solo donde importan;** el resto como stock por barrio que se materializa (§18).
- **El jugador puede construir de punta a punta** con las mismas sesiones de oficio que los NPCs (§17).
- **Incendios lejanos en agregado** por barrio; casa por casa solo cerca del jugador (§18).
- **Geomancia con un efecto real chico** cuando acierta, y mucho efecto de creencia (§4).

## Decisiones tomadas en este borrador (revisables)

- **Anclas explícitas** como única razón de existir de un asentamiento.
- **Edificios con componentes y defectos ocultos,** materiales con origen y grafo de espacios por dentro.
- **Construcción como sesión de oficio,** con calidad y defectos.
- **Infraestructura con mantenedor,** cuyo descuido es una presión.
- **Fuego como frente sobre el grafo de edificios.**
- **Stock agregado con materialización** por barrio.

## Preguntas abiertas

- Calibración: tasas de deterioro por material y clima; hazard de incendio por densidad, materiales y viento; cuánta gente sostiene cada ancla; tiempos de construcción por tipo; umbrales de tipo de asentamiento.
