# Clima diario y estaciones

> Principio: **el tiempo de cada día es física que viaja.** Una tormenta nace donde el mar está caliente y el aire inestable, se mueve con los vientos de su latitud y llega mañana al valle de al lado. Por eso se puede ver venir, por eso alguien puede pronosticarla y por eso llover acá deja menos agua para otro lado. El clima de planet-gen dice qué es normal; el tiempo dice qué pasó hoy.

> Estado: **borrador** (2026-10-06).

Depende de: [planet-gen.md](planet-gen.md) §0, §3, §8, §10 (órbita y estaciones, temperatura, vientos, humedad, corrientes, oscilaciones de pocos años, clima de largo plazo, aerosoles), [elements.md](elements.md) §6 (campos de qi que oscilan con estaciones y astros), [causality.md](causality.md) §2 (qué puede ser aleatorio), [simulation.md](simulation.md) §4, §6, §9, §14 (resoluciones, materialización con hechos fijados, contrato del modo agregado, determinismo), [living-world.md](living-world.md) §1, §5, §8, §9, §11 (sequías e inundaciones, calendarios, poblaciones, fuego, migraciones), [heaven-karma.md](heaven-karma.md) (calamidades, nubes de tribulación, inclinación de tiradas del entorno), [divination.md](divination.md) §3, §7 (proyección, presagios), [perception.md](perception.md) (visibilidad, ruido, huellas).
Lo usan: [economy.md](economy.md) (cosechas, perecibles, precios por estación), [travel.md](travel.md) (costo por celda, ríos, pasos, mar, vuelo), [war.md](war.md) (temporada de campaña, barro, niebla, lluvia sobre arcos), [body-health.md](body-health.md) §7 (exposición, enfermedades estacionales), [settlements.md](settlements.md) §7, §9, §10 (deterioro, viento en los incendios, daño por tormentas), [npc-psychology.md](npc-psychology.md) (ánimo por estación, inviernos largos), [state.md](state.md) (sequías que erosionan la legitimidad, rituales de lluvia), culture (#40: fiestas y calendarios), religion (#42: dioses de la lluvia), [chronicle.md](chronicle.md) (los años del hambre).

---

## Principios

1. **Capas de lo lento a lo rápido:** clima normal de planet-gen → anomalía de la estación (oscilaciones, aerosoles, marea de qi) → sistemas de tiempo que se mueven (frentes, ciclones, monzón) → tiempo local de cada celda por hora → microclima en escena. Cada capa se apoya en la de arriba.
2. **El tiempo es ruido permitido, pero coherente** (causality §2): el azar elige dónde nace una tormenta entre los lugares donde puede nacer, no si un día de verano en el desierto nieva.
3. **Los sistemas de tiempo son entidades** con origen, trayectoria y fin. Se los puede ver venir y pronosticar.
4. **El agua se conserva:** lo que llueve sale de la humedad que trajo el viento; lo que cae va al suelo, a la nieve, a los ríos y vuelve al aire.
5. **El tiempo no mira al jugador.** Su RNG va por región y día, así que estar o no estar en un lugar no cambia si llueve ahí.
6. **Alterar el tiempo es mover energía y agua** que ya existen, con un costo proporcional y consecuencias en otro lado.

---

## 1. Las capas

```ts
interface ClimateNormals {                   // de planet-gen §3, por celda y por día del año
  cell: CellId;
  temp: { mean: number; dailyRange: number; sd: number };
  precip: { probability: number; meanAmount: number; type: "rain" | "snow" | "mixed" };
  wind: { prevailing: Vec2; gustiness: number };
  humidity: number;
  regime: ClimateRegimeId;                   // cuatro estaciones, seca/húmeda, monzón, polar, ecuatorial…
}

interface SeasonalAnomaly {                  // por región y estación
  region: RegionId;
  season: SeasonKey;
  tempOffset: number;
  precipFactor: number;
  causes: CauseRef[];                        // fase de la oscilación de la cuenca, invierno volcánico, marea de qi, calamidad del Cielo
}

interface WeatherSystem {
  id: WeatherSystemId;
  kind: "frontal_low" | "cold_front" | "warm_front" | "blocking_high" | "tropical_cyclone"
      | "convective_cluster" | "monsoon_surge" | "cold_outbreak" | "heat_dome" | "dust_storm"
      | "qi_storm" | WeatherKindId;
  center: Vec2; radius: number;
  track: Vec2[];                             // posiciones pasadas; la futura sale del viento que lo arrastra
  intensity: number;
  moisture: number;                          // agua que lleva; llover la gasta
  energy: number;                            // calor del mar, contraste de masas de aire, qi
  phase: "forming" | "mature" | "decaying";
  originEventId: EventId;                    // las condiciones que lo hicieron nacer
}

interface CellWeather {                      // lo que se vive en una celda en una hora
  cell: CellId; tick: Tick;
  temp: number; humidity: number; pressure: number;
  wind: Vec2; gusts: number;
  cloud: number; visibility: number;         // niebla, lluvia, polvo, humo, noche
  precip: { type: PrecipType; rate: number }; // lluvia, llovizna, nieve, aguanieve, granizo, lluvia helada
  lightning: number;
  qi?: QiWeather;                            // §8
  systems: WeatherSystemId[];
}
```

- **Clima normal:** sale de planet-gen y cambia muy despacio con el clima de largo plazo (§8 de planet-gen).
- **Anomalía de la estación:** años buenos y malos con causa. La fase de la oscilación de la cuenca da sequía en una costa e inundaciones en la otra; un invierno volcánico enfría medio hemisferio; la marea de qi empuja hacia el frío o el calor según el mundo.
- **Sistemas de tiempo:** nacen, se mueven y mueren (§2).
- **Tiempo local:** cada celda combina los sistemas que la tocan con su relieve: niebla en los valles al amanecer, brisa de mar de día y de tierra de noche, lluvia de ladera al barlovento y sombra de lluvia del otro lado, nieve de lago, inversión térmica con humo atrapado en una ciudad de hondonada.
- **Microclima** (escena): la sombra, el interior de una cueva, el lado del viento de una roca, el cuarto con brasero. Es lo que el cuerpo siente (body-health §7).

## 2. Sistemas de tiempo: nacer, moverse, morir

- **Dónde pueden nacer:** cada tipo tiene condiciones físicas. Ciclones tropicales sobre mar caliente en su estación y lejos del ecuador; bajas frontales donde chocan masas de aire frío y cálido; tormentas de convección en tardes calientes y húmedas; olas de frío desde las tierras polares en invierno; tormentas de polvo sobre desiertos con viento fuerte y suelo seco (y más si se aró la estepa).
- **El azar elige entre lo posible:** cada día y región, el RNG con clave `("weather", región, día)` decide si nace un sistema donde las condiciones lo permiten y con qué intensidad. Nunca nace donde no puede.
- **Se mueven con el viento que los arrastra** (bandas de planet-gen §3): en latitudes medias, de oeste a este; los ciclones tropicales se curvan hacia los polos. El relieve los frena, los parte o los bloquea.
- **Viven de su fuente:** un ciclón muere al entrar en tierra porque pierde el mar caliente; un frente se disuelve cuando las masas de aire se mezclan; un anticiclón de bloqueo se queda semanas y da sequías u olas de calor.
- **Cada sistema registra su origen** y sus efectos llevan su id en `causes`: la crecida del río tiene como causa la baja que pasó, y la baja, el mar caliente de ese otoño.

## 3. El agua

```ts
interface CellWater {
  cell: CellId;
  atmosphere: number;                        // humedad disponible
  soilMoisture: number;
  snowpack: number;                          // se acumula en invierno y se derrite en primavera
  surface: number;                           // charcos, anegamiento
  groundwater: number;
}
```

- **Balance por celda:** evaporación (calor, viento, superficie de agua, vegetación) sube humedad; la lluvia la baja y la reparte entre suelo, escorrentía y acuíferos. La escorrentía alimenta los ríos de planet-gen §2.
- **Nieve:** guarda el invierno para la primavera. El deshielo da las crecidas de primavera y el agua del verano en los valles de montaña. Un invierno con poca nieve es un verano seco abajo.
- **Sequía** es una presión (causality): déficit acumulado de lluvia y humedad del suelo. Se descarga en cosechas perdidas, incendios (living-world §9), pozos secos, migraciones y conflictos por el agua.
- **Inundación:** el caudal supera la capacidad del cauce. La empeoran la tala río arriba, el suelo saturado, el deshielo rápido y los diques mal mantenidos (settlements §8); los diques que aguantan pasan el agua al pueblo de abajo.
- **Los cuerpos de agua se congelan** con días bajo cero: ríos que se vuelven caminos, puertos cerrados, hielo delgado que se rompe bajo una caravana.

## 4. Estaciones

- **Salen de la órbita** (planet-gen §0): la inclinación del eje da las estaciones y su amplitud; la excentricidad hace un hemisferio más extremo que el otro. Cada mundo tiene su año, que puede no durar 365 días.
- **Cada región tiene su régimen:** cuatro estaciones en latitudes medias, seca y húmeda en los trópicos, monzón en costas con gran contraste, noche y día polares. Lo que llamamos "estación" es el régimen local, no la fecha.
- **Fenología:** brotes, floraciones, frutos, caída de hojas, celo y partos de los animales, migraciones (living-world §11), ríos que se congelan y se abren. Siguen el tiempo real del año, no el calendario: una primavera tardía atrasa todo.
- **El año agrícola** (economy, technology): siembra, cuidado, cosecha, barbecho, todo atado al tiempo real. Una helada tardía mata los brotes; una lluvia en la cosecha pudre el grano en el campo.
- **Calendarios culturales** (living-world §5): una cultura fija sus términos solares (como los 24 节气) y sus fiestas a partir de su observación del clima de origen. Si migra o hereda un calendario de otra región, el calendario le dice que siembre cuando no conviene, y los campesinos que miran el cielo y no el almanaque cosechan mejor. El calendario es creencia; el tiempo, verdad.

## 5. Lo que el tiempo mueve

| Sistema | Efecto |
|---|---|
| Agricultura (economy) | Rendimiento por lluvia, temperatura y momento; heladas, granizo, sequía, anegamiento, plagas que siguen a la humedad (living-world §8: la langosta después de lluvias tras sequía) |
| Viaje ([travel.md](travel.md)) | Costo por celda (barro, nieve, calor), visibilidad para orientarse, ríos crecidos o helados, pasos cerrados, viento y tormentas en el mar, techo y riesgo del vuelo |
| Guerra (war) | Temporada de campaña, barro que frena los carros, lluvia que afloja las cuerdas de los arcos, niebla para emboscar, viento para el humo y el fuego, cuarteles de invierno, ejércitos que mueren de frío |
| Cuerpo (body-health) | Exposición (§7), golpes de calor, hipotermia; enfermedades por estación: fiebres con las lluvias y los mosquitos, catarros de invierno, cólera en las crecidas |
| Edificios (settlements) | Deterioro por humedad, helada y sol; techos que se vuelan; viento que empuja incendios; nieve que hunde techos |
| Fuego (living-world §9) | Días de fuego: seco, caliente y ventoso; el rayo como chispa |
| Percepción (perception) | La lluvia tapa sonidos y olores y borra huellas; la nieve las guarda; la niebla acorta la vista; el viento lleva el olor hacia un lado |
| Ánimo (npc-psychology) | Inviernos largos y oscuros bajan el ánimo; el calor irrita; la primera lluvia tras la sequía alegra; las fiestas de estación juntan a la gente |
| Economía (economy) | Precios que suben antes de la cosecha y bajan después; perecibles que se pudren con calor y humedad; puertos cerrados en invierno |
| Qi (elements §6) | Los campos de qi oscilan con la estación y la hora; un verano fuerte refuerza el fuego del lugar |

## 6. Extremos

Tifones, ventiscas, granizadas, tornados, olas de calor y de frío, tormentas de polvo, lluvia helada, el invierno blanco de las estepas que mata el ganado bajo el hielo (dzud), las crecidas repentinas en cañones secos. Todos son sistemas o combinaciones de sistemas con las condiciones de §2; ninguno se sortea aparte. Dejan huella en la crónica, en los mitos (living-world §4: el gran viento que hundió la flota) y en los tabúes ("no se acampa en el lecho seco").

## 7. Pronóstico

El futuro del tiempo es una proyección (divination §3): los sistemas que ya existen se mueven con el viento que hay. Por eso el pronóstico de mañana puede ser bueno y el de dentro de un mes, casi nada.

- **Saber popular:** cielos rojos, golondrinas bajas, halos en la luna, dolor de rodillas, el olor a lluvia. Cada señal es contenido cultural con una correlación **real** calculada contra el modelo (la presión que cae antes de una baja, la humedad que sube): algunos refranes aciertan, otros son superstición pura, y la gente cree en los dos.
- **Oficio:** marinos, pastores, campesinos y cazadores leen el cielo con una faceta de habilidad (skills) que mejora mirando y equivocándose.
- **Registros y astronomía:** quien anota lluvias y temperaturas durante años puede ver el ciclo de la oscilación de la cuenca y anticipar un año seco (discovery, technology). Casi nadie le cree.
- **Sentidos de cultivador:** percibir humedad, viento y qi a distancia según el reino (perception): una lectura real de la verdad, con alcance limitado.
- **Adivinación** (divination): las lecturas que se apoyan en el estado aciertan como la proyección; las que no, como el azar con sesgo. Los adivinos de lluvia son un oficio con clientela y con fama que sube o baja según aciertan.
- **Cada pronóstico es una creencia** de quien lo hace, y los demás deciden con ella: sembrar antes, no zarpar, adelantar la cosecha.

## 8. Tormentas de qi

```ts
interface QiWeather {
  density: ElementVector;                    // qi en el aire de la celda esta hora
  turbulence: number;                        // qué tan caótico está el campo
  phenomena: QiPhenomenonId[];               // niebla espiritual, rayos de trueno, viento yin, lluvia de fuego, nieve de escarcha espiritual…
}
```

- **Son sistemas de tiempo** (`kind: "qi_storm"`) con fuente física: una marea de qi alta, la confluencia de venas, una vena que descarga, una conjunción de astros (elements §6), un reino secreto que colapsa (secret-realms), una batalla de inmortales, una tribulación cercana, una calamidad del Cielo (heaven-karma). El qi que llevan sale de algún lado y queda en otro (conservación).
- **Se mueven y se mezclan con el tiempo mundano:** una tormenta de qi de agua sobre un frente da lluvias torrenciales; una de fuego en verano, incendios; una de trueno, rayos que buscan el metal y a los cultivadores.
- **Efectos:** desordenan el qi del cuerpo y dañan meridianos de quien no lo resiste (body-health §12), mutan plantas y bestias (living-world §2), desarman formaciones y talismanes, hacen caer a los que vuelan (travel §10), ciegan los sentidos espirituales. También son oportunidad: un cultivador del mismo elemento puede absorber como nunca, si aguanta.
- **Dejan huella:** hierbas que nacen después de la tormenta, minerales cargados, bestias que despiertan, lugares que quedan con el elemento torcido.
- **Las nubes de tribulación** (heaven-karma) son un evento físico local que se mezcla con el tiempo del lugar: tapan el sol, juntan el viento y se ven desde lejos.

## 9. Alterar el tiempo

- **Se mueve lo que hay:** llamar la lluvia junta la humedad que ya existe en el aire de la región (no se puede llover en el desierto sin agua que traer); dispersar nubes la manda a otro lado; levantar viento o calmar el mar mueve la energía de un sistema. Lo que llueve acá no llueve abajo: el valle vecino tiene su sequía con causa.
- **Costo en qi proporcional a la energía y el agua que se mueven:** una niebla en un patio es barata; frenar un tifón está al alcance de muy pocos y los deja vacíos. El reino, el elemento del practicante y el campo del lugar cambian el costo (cultivation, elements).
- **Formas:** técnicas, artefactos, formaciones que sostienen un clima (el valle de una secta en eterna primavera consume qi sin parar y corre el mal tiempo a sus vecinos), rituales con espíritus o dioses locales que tienen el poder real de hacerlo (spirits), si el mundo los tiene.
- **Los rituales de lluvia mortales** (求雨) casi nunca tienen efecto físico: son creencia, fiesta, presión política y a veces coincidencia con una lluvia que ya venía (que el pueblo cuenta como milagro).
- **Consecuencias:** quien hace llover se vuelve importante y odiado a la vez (los de abajo pierden su agua); la gente lo ve y lo cuenta; según la ley de cada mundo, torcer el tiempo a gran escala puede ser desequilibrio que el Cielo nota (heaven-karma: atención, calamidades) y deja karma por los daños que causa río abajo.
- **El tiempo como arma:** una tormenta sobre un ejército, niebla para una flota, sequía sobre las tierras de un enemigo. Las sectas grandes lo hacen y los estados las contratan o les temen (war, state).

## 10. Creencias sobre el tiempo

- **Quién manda la lluvia:** reyes dragón (龙王) con templos en cada río, el Cielo que castiga al soberano con sequía (state §8: legitimidad), los ancestros enojados. Algunos de esos dioses pueden existir de verdad como espíritus locales (spirits) con poder chico y real.
- **Culpables:** en la sequía se busca a quién culpar: la viuda, el extranjero, el cultivador del monte, el emperador. Es una presión de multitudes (npc-psychology) con consecuencias.
- **Presagios** (divination §7): granizo en verano, rayos sobre el palacio, el sol rojo del invierno volcánico.

## 11. El jugador y el narrador

- **Lo que se siente y se ve:** el personaje percibe el tiempo de su lugar con sus sentidos (frío, viento, el olor a lluvia, las nubes del oeste), nunca el estado de los sistemas. El narrador recibe esa percepción.
- **El panel** muestra lo que el personaje ve del cielo y su propio pronóstico como creencia ("cree que mañana llueve, por las golondrinas").
- **El tiempo da forma a la narración:** el montaje de un viaje o de una estación cuenta la lluvia y el barro porque pasaron, no como decorado.
- **El jugador puede actuar** sobre el tiempo como cualquiera: guardar agua, adelantar la cosecha, esperar el viento, aprender a leer el cielo y, con poder, mover una tormenta y pagar lo que cueste.

## 12. Escala (LOD)

| Resolución | Cómo se calcula el tiempo |
|---|---|
| Escena | Por minuto: ráfagas, el comienzo de la lluvia, el rayo, microclima |
| Local | Por hora en cada celda, con relieve y sistemas que la tocan |
| Regional | Por hora o día por celda con sistemas sinópticos que se mueven |
| Mundo | Sistemas grandes por día y totales por estación y celda (lluvia, temperatura, días de helada) para cosechas, ríos y fuego |
| Historia | Anomalías por estación y año (años buenos y malos) y extremos registrados como eventos |

- **Hechos fijados al bajar de escala** (simulation §6): si la historia o el modo agregado ya dijo que ese verano fue de sequía y se perdió la cosecha, el tiempo diario que se genera al acercarse cumple ese total. El detalle se genera condicionado al agregado, nunca lo contradice.
- **Determinismo** (simulation §14): `rng.fork("weather", región, día)`; las alteraciones (§9) son eventos del estado que cambian los sistemas, no la semilla.

## 13. Implementación por fase

- **Fase 1:** tiempo diario por celda en la región de la aldea: estaciones de la órbita, temperatura, lluvia, viento y nieve desde las normales con anomalía; efecto en cultivos, exposición y percepción.
- **Fase 3:** balance de agua por celda (suelo, nieve, ríos); sequías como presión; año agrícola atado al tiempo real; ánimo por estación; pronóstico popular con correlación calculada.
- **Fase 4:** tormentas de qi con fuente; campos de qi por estación; alterar el tiempo con costo y desplazamiento del agua.
- **Fase 5:** sistemas sinópticos que se mueven por la región; tiempo local por relieve; efectos en viaje y guerra; inundaciones con diques; generación del detalle condicionada a los agregados.
- **Fase 7:** anomalías por año en la historia; extremos registrados; calendarios culturales que se desajustan; mitos de grandes tormentas.
- **Fase 8:** ciclones tropicales, monzones y tiempo del mar en todo el planeta; inviernos volcánicos que reparten aerosol por bandas.

## Tests

- **Coherencia con el clima:** sobre muchos años, el promedio de los días generados coincide con las normales de planet-gen más las anomalías, con tolerancia.
- **Conservación del agua:** humedad, lluvia, suelo, nieve, ríos y acuíferos suman lo mismo en cada región cerrada.
- **Nada imposible:** ningún sistema nace donde sus condiciones no se cumplen (ciclón sobre tierra fría, nieve a 35 °C).
- **Determinismo e independencia del jugador:** misma seed → mismo tiempo; mover al jugador de lugar no cambia el tiempo de ninguna celda.
- **Hechos fijados:** el detalle diario generado al acercarse respeta el total de la estación que ya se usó en agregado.
- **Alterar el tiempo:** la lluvia llamada en una celda reduce la humedad disponible río abajo en la misma cantidad.
- **Pronóstico:** la precisión de la proyección cae con el plazo; los refranes con correlación alta aciertan más que los de correlación nula.

## Decisiones tomadas en este borrador (revisables)

- **Sistemas de tiempo como entidades que se mueven,** con origen y trayectoria, en vez de tiempo independiente por celda.
- **Balance de agua por celda** que une lluvia, nieve, suelo y ríos.
- **Detalle diario condicionado a los agregados** al materializar.
- **Refranes con correlación real calculada** contra el modelo.
- **Alterar el tiempo mueve agua y energía existentes,** con costo y efecto en otro lado.

## Preguntas abiertas

- Calibración: tamaño y cantidad de sistemas por región y estación; variabilidad diaria por régimen; costo de qi por unidad de agua y de energía movida; frecuencia de tormentas de qi; umbrales de sequía e inundación.
