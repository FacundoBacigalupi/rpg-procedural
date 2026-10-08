# Viaje, transporte y mar

> Principio: **un viaje es la misma simulación, día tras día.** Tres días de camino son tres días de mundo: se come, se cansa, se gasta, se rompe un eje, llueve. Lo que pasa en el camino sale de lo que hay en el camino: los bandidos que existen y acampan cerca, la otra caravana que va para el mismo lado, la bestia cuyo territorio cruza la ruta, la crecida del río. No hay tablas de encuentros.

> Estado: **borrador** (2026-10-06).

Depende de: [living-world.md](living-world.md) §6, §10, §11, §13 (rutas, especies que viajan, migraciones, vínculos con bestias), [planet-gen.md](planet-gen.md) (relieve, ríos, vientos, corrientes, monzones), [settlements.md](settlements.md) §8 (caminos, puentes, puertos, posadas), [economy.md](economy.md) §1, §7, §16 (lotes, comercio, caravanas, flujos agregados), [information.md](information.md) §4, §5 (noticias que viajan, mapas como creencia), [perception.md](perception.md) (quién ve a quién), [body-health.md](body-health.md) (cansancio, nutrición, exposición, enfermedades), [war.md](war.md) §3, §6 (logística, marcha), [crafts.md](crafts.md) (vehículos, barcos, espadas voladoras, formaciones), [cultivation.md](cultivation.md) §11 (vuelo y almacenamiento si el mundo los permite), [simulation.md](simulation.md) §4, §10, §13.2 (zonas, trayectos, cono causal), [player-loop.md](player-loop.md) §4-§7 (ritmo, rutinas, interrupciones, delegación), [contracts.md](contracts.md) (escolta, pasaje, flete), [law.md](law.md) (bandidaje, contrabando, peajes), [state.md](state.md) (postas, salvoconductos, aduanas), [property.md](property.md) (peajes y derechos de paso).
Lo usan: economy (costo de ruta), war (marcha y suministro), information (velocidad de las noticias), body-health (epidemias por rutas), [weather.md](weather.md) (clima del camino), [culture.md](culture.md) (contacto entre culturas), chronicle (los viajes de una vida).

---

## Principios

1. **Duraciones reales y costo diario.** Cada día de viaje consume comida, agua, forraje, plata, salud y desgaste de equipo y animales.
2. **Encuentros desde el estado.** Un encuentro es la coincidencia en lugar y tiempo de agentes y procesos que ya existen. El azar decide cuándo se cruzan, no si existen.
3. **Las rutas son verdad y creencia.** La red real tiene costos; cada viajero va por la que cree conocer (information §5). Perderse es que la creencia y la verdad se separen.
4. **Cada medio tiene su física:** velocidad, carga, consumo, terreno posible. Los animales comen parte de lo que llevan.
5. **La carga se conserva.** Lo que se lleva sale de una tenencia y llega a otra, menos lo que se comió, se pudrió, se rompió o se robó.
6. **El mar es otro terreno**, con vientos, corrientes y estaciones de planet-gen, y su propio saber.
7. **El vuelo cambia el mapa, no lo borra.** Volar cuesta, se ve y tiene lugares donde no se puede o no se debe.
8. **Libertad total, con consecuencias** (aprobado 2026-10-06). Los caminos son la opción barata, no la única: se puede ir a cualquier celda en cualquier dirección, meterse al monte, al pantano o a la montaña, o entrar a una zona a buscar lo que sea. No hay paredes invisibles; los límites son físicos (un acantilado pide trepar, un río pide vadear o nadar, el mar pide barco) y el precio es real (perderse, lastimarse, quedarse sin comida, cruzarse con lo que vive ahí) (§11).

---

## 1. La red de rutas

```ts
interface RouteSegment {
  id: RouteSegmentId;
  from: RouteNodeId; to: RouteNodeId;        // asentamientos, cruces, vados, pasos, puertos, posadas, santuarios
  cells: CellId[];
  kind: "trail" | "track" | "road" | "paved_road" | "imperial_road" | "mountain_path" | "river" | "canal"
      | "sea_lane" | "coastal" | "ford" | "ferry" | "bridge" | "tunnel" | "pass" | SegmentKindId;
  surface: SurfaceProfile;                   // tierra, piedra, barro en lluvia, nieve; qué vehículos pasan
  condition: number;                         // se deteriora y se mantiene como cualquier obra (settlements §7, §8)
  maintainer?: HolderRef;
  works: WorkId[];                           // puentes, postas, muros, faros
  tolls: TollRef[];                          // quién cobra, cuánto, en qué punto (property §2)
  seasonal: SeasonalRule[];                  // cerrado por nieve, crecida, monzón, barro
  traffic: TrafficAggregate;                 // flujo de gente, animales y carga por temporada (economy §16)
  originEventId: EventId;                    // el primer paso repetido, la obra que lo hizo camino
}
```

- **Las rutas nacen del uso** (living-world §6): un sendero aparece donde mucha gente pasa por el camino de menor costo; una autoridad lo vuelve camino (settlements §8). Sin tráfico ni mantenimiento, el camino se vuelve sendero y el sendero desaparece.
- **El costo de un tramo** sale de la pendiente, el terreno, la superficie, el clima del día, el medio y la carga. Los peajes y los riesgos se suman a la decisión, no al costo físico.
- **Los cuellos de botella** (pasos, vados, puentes, estrechos) concentran tráfico, peajes, posadas, bandidos y fortalezas.

## 2. El viaje como plan

```ts
interface Journey {
  id: JourneyId;
  party: AgentId[];                          // el viajero solo, la familia, la caravana, el ejército (war usa lo mismo en grande)
  animals: AnimalId[];
  vehicles: VehicleId[];
  cargo: LotId[];
  plan: ActionPlan;                          // ruta creída, paradas, condiciones ("si el paso está cerrado, por el río")
  pace: "leisurely" | "normal" | "hurried" | "forced";
  schedule: DaySchedule;                     // salir al alba, parar al mediodía, acampar antes de la noche, viajar de noche
  provisions: LotId[];
  escort?: CommitmentId;                     // contrato de escolta (contracts)
  position: { segment: RouteSegmentId; progress: number } | { cell: CellId; offRoute: true };
  believedPosition: BeliefRef;               // dónde cree el grupo que está (§11)
  originEventId: EventId;
}
```

- **Cada día de viaje** resuelve: avance (velocidad del miembro más lento por terreno, superficie, clima, carga, cansancio, ritmo, luz), consumo, desgaste, salud, las decisiones en las bifurcaciones (por creencias) y los encuentros (§3).
- **El ritmo cuesta:** apurarse gana distancia y pierde salud, animales y equipo. Una marcha forzada de tres días deja cojos a los caballos y enfermos a los débiles.
- **Las paradas** son elecciones: una posada (plata, información, riesgo de que te conozcan), un templo, la casa de un pariente, un campamento (elegir lugar, agua, fuego, guardias).
- **Los imprevistos** salen del estado: un eje se rompe porque estaba gastado, el puente cayó la semana pasada, el paso cerró por nieve antes de lo que creían.

## 3. Encuentros desde el estado

Un encuentro no se tira de una tabla: se busca **quién y qué está en el mismo tramo al mismo tiempo**.

- **Otros viajeros:** caravanas, peregrinos, mensajeros, refugiados, monjes, cultivadores de paso. En LOD bajo salen del flujo agregado de la ruta (§16) y se materializan con origen y destino coherentes.
- **Bandidos:** son organizaciones reales con campamento, miembros, hambre y miedo (organizations, law §13). Deciden atacar por utilidad sobre lo que perciben (cuánta carga, cuánta escolta, qué tan pobre o fuerte parece el viajero: social-structure §3). Un camino tiene bandidos porque hay gente sin tierra cerca y tráfico rico que pasa.
- **Bestias:** su territorio, su hambre, su estación (living-world). Una bestia espiritual que defiende su valle no persigue a quien rodea el valle.
- **Autoridad y cobradores:** patrullas, peajes, aduanas, puestos de control (§7).
- **Naturaleza:** crecidas, deslaves, tormentas, nieve, calor; vienen de planet-gen y weather.
- **Espíritus y lugares raros:** un paso embrujado por una masacre (spirits §1), la niebla de una formación vieja, la entrada de un reino secreto que se abre (secret-realms).
- **Ejércitos:** una guerra cercana llena los caminos de soldados, desertores y requisas.
- **Fuera del camino** (§11): cambia quién está. Menos gente y más naturaleza: la fauna real de cada celda (living-world: poblaciones y redes tróficas), territorios de bestias que el camino rodeaba, cazadores y leñadores, ermitaños, prófugos escondidos, cultivadores en retiro que no quieren ser encontrados, ruinas, espíritus de lugar. La tasa sale de las densidades de cada celda, igual que en el camino.

**Cómo se resuelve:**
- En escena y local, los agentes están materializados y se cruzan de verdad en el espacio. Quién ve a quién primero sale de la percepción (perception §5): una emboscada es que te vieron antes.
- En regional, por cada tramo y día se calcula la tasa de cruce con lo que hay (cuántos bandidos activos cerca, cuánta caza tiene la bestia, cuánto tráfico), y el RNG con clave `(segmento, día, viaje)` decide si se cruzan. Si se cruzan, se materializa la entidad real que ya existía en agregado, con su historia.
- **Nunca se inventa:** si no hay bandidos en la región, no hay asalto; si el jugador elimina a la banda, el camino queda limpio hasta que otra banda se forme o llegue.
- **Frecuencia** (aprobado 2026-10-06): se calibra en la sim headless para que el camino sea peligroso pero no una lotería. Un viaje regional típico tiene pocas incidencias y la mayoría no son violentas (otros viajeros, controles, clima); los asaltos se concentran donde hay pobreza, tráfico rico y poca autoridad.

## 4. Posadas, postas y paradas

- **Posadas:** edificios y negocios (settlements §5, §13) con dueño, precios, cuartos, establo y comida. Son centros de noticias: todo viajero trae algo. Las hay honestas, caras, sucias y las "negras" (黑店), donde se envenena y se roba al viajero solo, una banda con fachada.
- **Postas del estado:** caballos de recambio, correos y alojamiento para funcionarios con permiso (state). Hacen que las noticias oficiales viajen rápido y que los edictos lleguen antes que los rumores.
- **Caravasares y patios de carga** en las rutas de comercio largas; templos y monasterios que hospedan por norma; casas de parientes y de clientes del clan.
- **Acampar:** elegir un lugar (agua, refugio, defensa, lejos de huellas de bestias), hacer fuego (se ve y se huele: perception), turnos de guardia. Acampar mal es como se muere en el camino.

## 5. Animales y vehículos

```ts
interface TransportMode {                    // content/transport/
  id: TransportModeId;                       // porteador, mula, caballo, camello, buey con carro, carreta, palanquín, barca, junco…
  speed: SpeedProfile;                       // por terreno y superficie
  capacity: number;                          // carga útil
  consumes: Need[];                          // forraje, agua, descanso (y salarios, si son porteadores)
  terrain: TerrainLimit[];                   // un carro no sube senderos; un camello no sirve en el barro
  crew?: number;
  techRequires?: TechRef[];                  // la rueda, el arnés de collera, el estribo (technology)
}
```

- **Los animales son seres con cuerpo** (body-health, living-world §12): se cansan, se lastiman, se enferman, se asustan, comen. Un caballo bien tratado rinde semanas; uno exprimido se muere en días.
- **La regla del carro** (war §3): el animal come parte de lo que lleva, así que la carga útil cae con la distancia. Por eso el grano no viaja lejos por tierra y sí por río.
- **Vehículos como objetos** (crafts): ejes, ruedas, ballestas, toldos; se rompen y se reparan con oficio y repuestos.
- **Monturas espirituales:** una bestia vinculada por contrato (living-world §13) lleva más rápido y más lejos, pero tiene voluntad, hambre de qi y enemigos.

## 6. La carga

- **Toda carga es lotes** (economy §1) y su viaje queda en `provenance`.
- **Pérdidas con causa:** lo perecible se degrada (con el clima y el embalaje), lo frágil se rompe por el camino malo, los porteadores roban, los peajes se cobran en especie, los bandidos se llevan.
- **El peso frena:** cada kilo cuenta para el ritmo y para la elección de medio.
- **Anillos y bolsas de almacenamiento** (si el mundo los permite: cultivation §11): capacidad finita, vinculados a su dueño (property §12), con el contenido que conserva su origen. Hay lugares donde no funcionan (secret-realms: `no_storage`). Un cultivador con un anillo grande es una caravana en un bolsillo, y por eso lo matan por él.
- **Contrabando:** esconder carga a la aduana es una acción con riesgo de ser descubierta (law §12): dobles fondos, sobornos, rutas de montaña.

## 7. Papeles, fronteras y controles

- **Salvoconductos y permisos de viaje** (路引): en muchos estados los mortales necesitan papeles para salir de su condado. Son documentos (information §4) que se piden, se compran, se falsifican y se pierden.
- **Controles:** puertas de ciudad, aduanas, puestos en pasos. Los guardias leen apariencia, papeles y carga con su percepción y sus prejuicios (social-structure §3); se los soborna, se los engaña, se los evita.
- **Cierres:** cuarentenas por plaga (body-health), fronteras cerradas por guerra, toques de queda, pasos cerrados por un señor que pelea con otro.
- **Fronteras de secta:** entrar al territorio de una secta sin permiso es ofensa; los discípulos patrullan y los pueblos avisan.

## 8. Ríos y canales

- **Corriente abajo es barato y rápido; corriente arriba es lento y caro** (remo, sirga, vela si el viento ayuda). Los ríos navegables deciden dónde hay ciudades y comercio (living-world §6).
- **El río cambia con la estación:** crecidas que aceleran y hunden, estiajes que dejan los barcos varados, hielo. Los vados tienen profundidad según el día (planet-gen: caudal); cruzarlos es un riesgo calculable.
- **Rápidos y esclusas:** los rápidos se pasan con práctico o se rodean por tierra; los canales tienen esclusas, peajes y cuidadores (settlements §8).
- **Barqueros y gremios** que controlan tramos; piratas de río que conocen los recodos; balseros que cobran según lo desesperado que se vea el viajero.

## 9. El mar

```ts
interface Ship {
  id: ShipId;                                // es un objeto con componentes (casco, mástiles, velas, timón, bodega)
  type: ShipTypeId;                          // content/ships/: junco, galera, dhow, bote de pesca, nave de secta
  components: VehicleComponent[];            // con materiales, condición y defectos ocultos (como settlements §5.1)
  crew: AgentId[] | CrewAggregate;
  cargo: LotId[];
  provisions: LotId[];
  owner: HolderRef;
  homePort?: SettlementId;
  originEventId: EventId;                    // el astillero y la madera de tal bosque
}
```

- **Navegar sale de planet-gen:** vientos por bandas de latitud y monzones, corrientes por cuenca. Un buen marino planea con la estación: hay meses para ir y meses para volver. Los barcos de vela no van contra el viento sin bordear, y algunos tipos no pueden.
- **Qué decide el jugador** (aprobado 2026-10-06): la ruta, la estación, el barco y la tripulación (contratarla, mandarla). La sim resuelve vientos, rumbo y errores de estima día a día; no se manejan velas y timón a mano, salvo cuando algo cae a escena (una tormenta, un abordaje, una costa desconocida de noche).
- **Costear o cruzar:** costear es más seguro y más lento, y depende de conocer la costa; cruzar mar abierto pide saber de estrellas, corrientes, brújula (technology) o técnicas, con errores de estima que se acumulan.
- **Naufragio como proceso:** la tormenta (weather) pega sobre la condición real del barco y la pericia de la tripulación. Un casco con defectos se abre; uno bueno con mala tripulación se da vuelta. El naufragio deja un pecio con carga (deep-history: tesoros sumergidos) y sobrevivientes en costas que pueden no conocer.
- **El cuerpo en el mar:** agua dulce, comida que se pudre, escorbuto en viajes largos (body-health: nutrición), enfermedades en barcos llenos.
- **Puertos** (settlements §2: ancla de puerto): prácticos, tasas, aduanas, astilleros, tabernas, reclutadores de tripulación.
- **Piratas:** organizaciones con bases, barcos y presas; cobran protección, roban, secuestran. Prosperan donde hay tráfico rico y ningún estado o secta controla el mar.
- **Bestias marinas y qi del mar:** territorios en profundidad, migraciones con las corrientes, corrientes que llevan qi (planet-gen).

## 10. Viajar como cultivador

- **Vuelo:** espada voladora, técnica de nube, artefacto o montura (cultivation §11, crafts). Cuesta qi por distancia y tiempo, tiene velocidad y techo según el reino y la ley del mundo, y lo afectan el viento, las tormentas y el cansancio. Un cultivador que vuela agotado cae.
- **Se ve:** volar es una emisión visible y de qi (perception §2). Los mortales lo ven y lo cuentan; otros cultivadores lo sienten. Pasar volando sobre una secta es una ofensa en muchas culturas, y algunas lo tratan como ataque.
- **Zonas sin vuelo:** formaciones que lo prohíben, reinos secretos (`no_flight`), regiones de qi caótico, tormentas de qi.
- **Llevar a otros:** cargar pasajeros o carga gasta más; las sectas tienen barcos voladores o bestias grandes para mover discípulos y bienes.
- **Formaciones de teletransporte:** obras de formación (crafts) con extremos fijos, que consumen piedras espirituales por uso y tienen alcance limitado. Pueden fallar si se descuidan, se custodian y cobran. Son raras y caras, y las construyó alguien en la historia (living-world §6).
- **Cuánto domina el vuelo** (aprobado 2026-10-06): es muy rápido, pero visible y caro. La guerra y el comercio grueso siguen yendo por tierra y agua, porque volar con carga cuesta muchísimo qi; las sectas tienen rutas aéreas fijas, barcos voladores para lo que vale la pena y tratados de paso entre ellas (contracts).
- **El abismo:** un viaje de un mes para un mortal es una tarde para un cultivador avanzado. Eso cambia quién puede llegar a tiempo y qué tan lejos llega una consecuencia (simulation §13.2: cono causal).

## 11. Fuera del camino, orientarse y perderse

### 11.1 Ir a campo traviesa (aprobado 2026-10-06)

- **Cualquier dirección:** el plan puede ser un rumbo ("al norte por el monte hasta el río"), un punto creído ("la cueva que vi desde la cresta") o un destino sin camino conocido. `go_to` acepta celdas y rumbos, no solo nodos de ruta (actions). `Journey.position` ya admite `offRoute`.
- **El costo de cada celda** (hoy: el clima del día, `walkingFactor`, escala el tiempo de cruce) sale de planet-gen y living-world: pendiente, vegetación (pradera, bosque abierto, selva, matorral espinoso, bambú), suelo (barro, roca suelta, arena, nieve, hielo), agua (arroyos, pantanos, ríos para vadear), altura y clima del día (weather). Abrirse paso en selva puede ser un par de kilómetros por día; una pradera, casi como un camino.
- **Los medios se filtran solos:** los carros no salen del camino, las mulas pasan donde un caballo no, los porteadores pasan casi por todos lados, un cultivador que vuela ignora el suelo pero no la niebla ni las zonas sin vuelo.
- **Obstáculos físicos con sus verbos:** acantilados (`climb`, con cuerda o rodeando), ríos (`swim`, vado, balsa improvisada con `build`), grietas, cuevas, nieve profunda. Cada uno es una acción con riesgo real (caídas, ahogo, hipotermia).
- **Mantener el rumbo depende de la habilidad:** cada tramo acumula un error de dirección según orientación, visibilidad, hitos, terreno y cansancio. Un buen rastreador con sol y picos a la vista llega derecho; un novato en la selva con niebla camina en círculos sin saberlo (§11.3).
- **Huellas propias:** pasar deja rastro (perception: huellas) que otros pueden seguir y que uno puede usar para volver. Marcar árboles o apilar piedras es una acción. Si mucha gente repite el mismo paso, ahí nace un sendero (§1).

### 11.2 Entrar a buscar (aprobado 2026-10-06)

- **Explorar una zona con un propósito** es una rutina (player-loop §5) hecha de los verbos de siempre: `search`, `track`, `gather`, `hunt`, `fish`, `mine`, `fell`, `look`, `sense_essence` (actions). "Entro al bosque a buscar hierbas hasta que se acabe la comida o encuentre ginseng de cien años" es un plan con condición de corte.
- **Solo se encuentra lo que hay:** hierbas, minerales, animales y bestias son poblaciones y depósitos reales de cada celda (living-world, planet-gen, crafts: materiales con origen). Al buscar se materializan con su origen y su historia; si nadie los puso ahí, no están.
- **Encontrar depende del que busca:** saber qué buscar y dónde (una hierba que crece a la sombra junto al agua), sentidos, rastreo, sentir el qi, la estación y la suerte de la tirada. El que no conoce la planta pasa al lado sin verla o junta la parecida venenosa (perception: errores con forma).
- **Cazar y buscar bestias:** seguir huellas, leer excrementos y marcas de territorio, esperar en el abrevadero, poner trampas. La presa también percibe, huye o caza al cazador; una bestia espiritual vieja sabe que la siguen.
- **Lo que se saca se pierde allá:** la población de la hierba baja, el venado no vuelve a ese valle, la veta se agota. Otros recolectores y cazadores compiten por lo mismo y recuerdan quién se lo llevó.
- **No todo es de nadie** (property): el bosque puede ser comunal con reglas, coto de caza de un señor o dominio de una secta. Sacar sin derecho es robo o caza furtiva si alguien lo ve o lo descubre después.
- **Lo que no se buscaba también aparece:** ruinas, una cueva con huesos, la entrada de un reino secreto, el campamento de alguien que se esconde. Todo existía antes de que el personaje llegara.
- **Lo descubierto entra al mapa creído:** con la fecha, lo que se vio y lo que se supuso. Se le puede poner nombre, guardarlo en secreto o vender la ubicación.

### 11.3 Orientarse y perderse

- **El mapa de cada uno es creencia** (information §5): lo que recorrió, lo que le contaron, el mapa que compró. Cada viajero decide con su mapa.
- **Orientarse es una habilidad** (skills: facetas de orientación y lectura del terreno): sol, estrellas, ríos, picos, marcas en los árboles. Niebla, bosque denso, desierto y noche la ponen a prueba.
- **Perderse** es que la posición creída (`believedPosition`) se separe de la real. El grupo sigue decidiendo con lo que cree hasta que percibe algo que no cuadra (un río que no debería estar ahí). Se corrige preguntando, subiendo a una altura o encontrando algo conocido.
- **Guías:** agentes contratados que conocen el camino, con sus propios intereses: el guía que lleva a la emboscada, el que cobra el doble a mitad del desierto.
- **Preguntar el camino** es una conversación (dialogue): la respuesta es lo que el otro cree, a veces mal y a veces a propósito.

## 12. El cuerpo del viajero

- **Cansancio, pies, espalda:** marchar acumula fatiga y lesiones chicas que crecen si no se tratan (body-health).
- **Exposición:** frío, calor, mojarse, altura, sed en el desierto. Ropa, refugio y fuego deciden (body-health: balance térmico).
- **Enfermedades nuevas:** el viajero llega a lugares con patógenos que su cuerpo no conoce, y lleva los suyos (living-world §10).
- **Comida del camino:** lo que se lleva, lo que se compra (a precio de lugar sin competencia), lo que se caza o se recolecta (con el saber del lugar).

## 13. Viajar en grupo

- **Caravanas** (economy §7): comerciantes que juntan riesgo y escolta. Tienen un jefe, reglas, turnos de guardia y peleas internas por el ritmo y las paradas.
- **Escolta:** un contrato (contracts) con obligaciones en las dos direcciones; el escolta que huye ante el primer bandido incumple, y el comerciante que no paga, también.
- **Compañeros de camino:** relaciones que se forman rápido (npc-psychology) y a veces duran toda la vida; también el desconocido que se suma a la caravana y es un espía.
- **Separarse:** un grupo puede dividirse por una decisión o por un accidente, y cada parte sigue con su propio plan y sus creencias sobre dónde está la otra.

## 14. Lo que lleva el viaje

Noticias y rumores (information §4), enfermedades (body-health), especies (living-world §10), técnicas y saberes (technology: difusión), espías, ejércitos, refugiados, dinero y letras. La velocidad de todo eso es la velocidad de los medios reales que lo cargan.

## 15. El jugador y el narrador

- **Viajar se juega como una rutina** (player-loop §5): el personaje sigue el plan día por día con delegación de lo chico (dónde acampar, qué comer), y el viaje se narra como montaje por tramos.
- **Montaje por defecto** (aprobado 2026-10-06): un viaje largo sin incidentes pasa en un turno; se corta solo si hay un encuentro o algo que el personaje note. Un ajuste permite que pregunte en cada bifurcación o parada para quien quiera más control.
- **Lo mismo a campo traviesa y explorando** (§11): el montaje sigue por celdas, con cortes por hallazgos, huellas frescas, un ruido, un cambio de clima o la comida que se acaba.
- **Se cae a escena** cuando hay un encuentro o algo que el personaje percibe como importante (player-loop §6): una figura en el camino, humo adelante, el guía que mira raro.
- **El mapa del panel** es el mapa creído, con niebla, trazos dudosos y la fecha de lo que se vio (information §5).
- **El narrador** nombra lugares y caminos con el léxico del personaje y nunca revela que está perdido si el personaje no lo percibió.

## 16. Escala (LOD)

| Resolución | Cómo se viaja |
|---|---|
| Escena | Espacio continuo, por minutos: el puente, el vado, la emboscada |
| Local | Por horas, sobre tramos; encuentros con agentes materializados |
| Regional | Por días, con tasas de cruce calculadas desde las entidades reales de cada tramo y materialización al cruzarse |
| Mundo | Flujos por ruta (gente, animales, carga, noticias) como agregados con conservación (economy §16, simulation §10) |
| Historia | Rutas que nacen, cambian y mueren; grandes migraciones y expediciones |

- **Trayectos fuera de zona** (simulation §10): un viajero que sale de la zona activa queda con origen, destino, ruta y llegada estimada, y su viaje se resuelve en la puesta al día con los mismos riesgos en agregado.

## 17. Implementación por fase

- **Fase 1:** caminar entre la aldea y lugares cercanos por tramos con costo; salir del camino al monte cercano con costo por celda; buscar, recolectar y cazar lo que hay; acampar; cansancio y comida.
- **Fase 3:** viajes de varios días con montaje e interrupciones; posadas; animales de carga; carga como lotes con pérdidas.
- **Fase 5:** red de rutas regional con peajes, controles y salvoconductos; encuentros desde el estado (bandidos, bestias, viajeros); caravanas y escolta; perderse y guías; ríos y barcas; flujos agregados por ruta.
- **Fase 6:** vuelo de cultivadores con costo y visibilidad; monturas espirituales; anillos de almacenamiento; fronteras de secta.
- **Fase 7:** rutas que nacen y mueren en la historia; formaciones de teletransporte construidas por la historia.
- **Fase 8:** mar con vientos, corrientes y monzones; barcos como objetos; naufragios y pecios; piratas; navegación de altura.

## Tests

- **Sin encuentros inventados:** un tramo sin bandidos en la región nunca produce un asalto; eliminar una banda baja la tasa del tramo.
- **Conservación:** la carga que llega es la que salió menos consumo, pérdidas y robos registrados.
- **Regla del carro:** la carga útil de un convoy cae con la distancia por el forraje consumido.
- **Determinismo:** misma seed, mismo plan → mismos encuentros y mismo día de llegada.
- **Campo traviesa:** se llega a cualquier celda alcanzable; el error de rumbo crece con menos habilidad y peor visibilidad; lo recolectado baja la población de la celda.
- **Solo lo que hay:** buscar en una celda sin la hierba nunca la encuentra.
- **Perderse:** con niebla y baja orientación, la posición creída se separa de la real y se corrige al percibir un hito.
- **Agregado contra individual:** pérdidas por ruta y tiempos de viaje coinciden con tolerancia entre los dos modos.

## Decisiones (aprobado 2026-10-06)
- **Libertad total:** viajar a cualquier celda fuera de los caminos y entrar a buscar lo que sea, con costo por terreno, rumbo según la habilidad y encuentros de lo que vive ahí (§11).
- **Montaje por defecto** con cortes por encuentro o percepción; ajuste para preguntar en cada bifurcación (§15).
- **Navegación:** el jugador decide ruta, estación, barco y tripulación; la sim resuelve el día a día; tormentas y abordajes caen a escena (§9).
- **Encuentros calibrados** para un camino peligroso pero no una lotería (§3).
- **Vuelo rápido, visible y caro;** el grueso de la guerra y el comercio sigue por tierra y agua (§10).

## Decisiones tomadas en este borrador (revisables)

- **Encuentros como cruces de entidades existentes,** con tasas calculadas desde el estado en regional.
- **Viaje como `Journey` que usan el jugador, los NPCs, las caravanas y los ejércitos** (war §6 usa lo mismo en grande).
- **Barcos y vehículos como objetos con componentes y defectos** igual que los edificios.
- **Vuelo visible, con costo y con zonas prohibidas;** teletransporte raro, fijo y caro.

## Preguntas abiertas

- Calibración: velocidades por medio y terreno; consumo diario por persona y animal; tasas de cruce con bandidos y bestias según densidad y tráfico; costo de qi del vuelo por reino; frecuencia de naufragios por condición y tormenta.
