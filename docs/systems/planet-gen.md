# Generación del planeta

> El seed genera un planeta entero con una física plausible: placas, montañas, ríos, clima, biomas y un campo de qi que **sale de esa geografía**. Cada rasgo del mapa tiene una causa: la cordillera está ahí porque chocaron dos placas, el desierto porque la cordillera le roba la lluvia, la vena de qi de fuego porque hay un volcán sobre un punto caliente.

Lo que pasa sobre este mapa después de generarlo está en [living-world.md](living-world.md) y [spirits.md](spirits.md).

> Estado: etapas 0-7 **decididas**; §8-§12 son una **ampliación en borrador** (2026-10-06): el planeta cambia después de generarse. Clima de largo plazo con glaciaciones y nivel del mar movidos por los mismos ciclos que las mareas de qi (puentes de tierra, costas sumergidas), suelos con nutrientes que se forman, se agotan y se degradan, y volcanes con presión que producen inviernos volcánicos, más impactos.

Depende de: [causality.md](causality.md) (capas 0-1, qi como campo físico, presiones), [heaven-karma.md](heaven-karma.md) (fuerza del Cielo), [deep-history.md](deep-history.md) (la historia escribe sobre el mapa después), [elements.md](elements.md) (hielo como derivado, fronteras elementales), [metaphysics.md](metaphysics.md) (qué fuente de poder tiene el mundo). Lo usan: [living-world.md](living-world.md) (desastres, migraciones, especies separadas), [economy.md](economy.md) (tierra y cosechas), [technology.md](technology.md) (agricultura y sus consecuencias), [cultivation.md](cultivation.md) (qi disponible), [secret-realms.md](secret-realms.md) (aperturas por mareas), [divination.md](divination.md) (ciclos y presagios), [state.md](state.md) y [war.md](war.md) (hambre, legitimidad, guerras por tierra), [body-health.md](body-health.md) (hambre y epidemias).

## Principios
1. **Causal, no ruido.** El ruido (Perlin/simplex) solo agrega detalle **dentro** de lo que la geología ya decidió. Nunca decide dónde hay un continente o una cordillera.
2. **Determinista y por etapas.** Cada etapa es una función pura `(estado, rng.fork("planet", etapa)) → estado`. Cambiar una etapa no altera el azar de las otras.
3. **Multi-resolución.** Se genera una grilla gruesa del planeta entero. El detalle local se genera **bajo demanda**, coherente con su celda madre (igual que los NPC de tier 1 con las estadísticas).
4. **El mapa es estado mutable.** La planet-gen produce el mapa inicial. Después la historia lo modifica (cráteres de batallas, venas destruidas, bosques talados, ríos desviados) y cada cambio es un evento.
5. **Inspeccionable.** Desde el día uno: exportar mapas PNG por capa (elevación, clima, biomas, qi) para mirar el resultado.
6. **El planeta sigue andando.** Clima, hielo, mar, suelos y volcanes cambian durante la historia y la partida con procesos que conservan agua, nutrientes y presión, usando `rng.fork("planet", proceso, celda, tick)`. Nada cambia sin causa: una era fría tiene su órbita, un campo pobre su historia de cosechas, un año sin verano su volcán.

## Grilla
- **Geodésica hexagonal** (poliedro de Goldberg: icosaedro subdividido; todas las celdas son hexágonos salvo 12 pentágonos). Las celdas tienen áreas casi iguales y no hay distorsión en los polos.
- **Nivel 0, regiones:** la cantidad de celdas escala con el radio para que cada una mida ~150-200 km, la escala de "una región": un valle, una porción de cordillera, un lago. En el rango decidido (radio 2-4 veces el de la Tierra) son ~60.000-250.000 celdas (subdivisión ~80-160). Es la grilla que usa la simulación de qi, clima, ecología y demografía.
- **Nivel 1, local:** cada celda de nivel 0 se subdivide en ~1.000-10.000 hexes de ~1-3 km cuando el jugador (o un NPC de tier alto) está cerca. Se genera con `rng.fork("cell", id)` a partir de los atributos de la madre, respetando sus agregados (la suma del qi local es el qi de la celda, y el promedio de elevación cuadra).
- **Sitios:** cuevas, claros, aldeas y ruinas son entidades ubicadas en hexes locales, no celdas.

```ts
interface RegionCell {
  id: CellId;
  neighbors: CellId[];              // 6 (o 5)
  center: Vec3;                     // en la esfera unitaria
  plate: PlateId;
  crust: "continental" | "oceanic";
  elevation: number;                // metros, relativo al nivel del mar
  rock: RockType;                   // ígnea, sedimentaria, metamórfica → minerales y afinidad
  temperature: { mean: number; seasonalRange: number };
  precipitation: number;            // mm/año
  river?: { flow: number; downstream: CellId };
  lake?: LakeId;
  biome: BiomeId;                   // de content/biomes
  qi: { level: number; capacity: number; regen: number; elements: ElementVector };
  features: FeatureId[];            // volcán, falla, vena de qi, cañón, delta…
  originEventId: EventId;           // evento geológico que la formó (o el de la etapa)
}
```

## Pipeline

### 0. Cosmología y leyes (del seed)
- **Radio:** 2-4 veces el de la Tierra (decidido: mundos enormes, donde un mortal tarda años en cruzar un continente). Para que la gravedad siga siendo vivible, la densidad media es menor (menos núcleo de hierro, más roca ligera). Eso tiene consecuencias: **el metal es más escaso y valioso** que en la Tierra, y la gravedad final (≈1-1,5 g) sale de radio × densidad, no se elige suelta.
- Inclinación del eje (estaciones), duración del día y del año.
- **Sistema estelar, solo lo físicamente plausible.** Nada de cuerpos "porque sí": cada uno tiene un evento de formación.
  - **Por defecto: un sol.** Una binaria es posible (los planetas circumbinarios existen) pero rara, con probabilidad baja, y solo con una configuración estable (planeta orbitando lejos de las dos estrellas, con dos soles de colores y tamaños distintos).
  - **Lunas por su origen:**
    - Una luna grande por impacto temprano (como la nuestra) es el caso común.
    - Cero lunas si no hubo impacto.
    - Lunas extra solo si son pequeñas y capturadas (asteroides), en órbitas que el modelo verifica estables.
    - Nunca dos lunas grandes.
  - Sol y luna dan mareas y estaciones, y en esta metafísica son **fuentes celestes de qi** con elemento propio (sol → fuego/yang, luna → agua/yin). Los eclipses, la luna llena y las conjunciones con una luna pequeña son eventos astronómicos **calculables**: un astrónomo o un cultivador sabio puede predecirlos y aprovecharlos.
- Presupuesto total de qi del mundo y fuerza del Cielo (ver heaven-karma).
- **Mareas de qi:** el qi global no es constante. Oscila con ciclos astronómicos largos (excentricidad de la órbita, precesión, conjunciones con la luna), de siglos a milenios. Las eras de "recuperación" y "decadencia" espiritual tienen así una causa física, combinada con el consumo humano. Son ciclos calculables: un sabio puede saber que se viene una marea alta.
- Balance elemental global: un mundo puede ser rico en metal y pobre en madera. Qué elementos existen y cómo interactúan: [elements.md](elements.md).

### 1. Tectónica simplificada
No es una simulación física completa: es un modelo que produce formas creíbles.
- **Placas:** 8-20 semillas en la esfera, crecimiento por inundación con velocidades distintas (placas de tamaños desiguales). Cada placa es continental u oceánica y tiene un vector de movimiento (rotación alrededor de un polo de Euler).
- **Bordes:** según el movimiento relativo:
  - Convergente continente-continente: cordilleras altas (Himalaya).
  - Convergente océano-continente: fosa + cordillera volcánica costera (Andes).
  - Convergente océano-océano: arco de islas volcánicas.
  - Divergente: rift, dorsal oceánica, valles de rift en continentes.
  - Transformante: fallas, terremotos.
- **Puntos calientes:** cadenas de volcanes en medio de placas (Hawái).
- **Elevación:** base por tipo de corteza + efecto de los bordes con caída por distancia + ruido acotado. Se ajusta para la fracción de tierra que pida el seed (30-70%).
- **Roca:** volcánica cerca de bordes y puntos calientes, metamórfica en cordilleras viejas, sedimentaria en cuencas. Determina los minerales.
- Cada orogenia, rift y volcán es un **evento geológico** con fecha aproximada en tiempo profundo. Las montañas viejas están más erosionadas (menos altas y redondeadas) que las jóvenes.

### 2. Hidrología y erosión
- Precipitación de la etapa 3 (se itera: clima ↔ relieve, 2 pasadas).
- Relleno de depresiones → **lagos** (con desagüe o endorreicos, que son salados).
- Acumulación de flujo → **ríos** que siempre terminan en el mar o en un lago endorreico. Deltas, cañones donde el río corta roca.
- Erosión simplificada (stream power) que suaviza montañas viejas y deposita sedimento en valles y llanuras fértiles.

### 3. Clima
- **Temperatura:** insolación por latitud, menos ~6,5 °C por km de altitud, suavizada cerca del mar. Amplitud estacional según la inclinación del eje y la distancia al océano.
- **Viento:** bandas por latitud (alisios, vientos del oeste, polares), como las celdas de Hadley.
- **Humedad:** se transporta con el viento desde los océanos. Se descarga al subir montañas, que dejan **sombra de lluvia** del otro lado (desiertos). Monzones simplificados en costas con gran contraste estacional.
- **Corrientes oceánicas:** giros por cuenca oceánica según los vientos y la rotación del planeta (horario en un hemisferio, antihorario en el otro), desviados por los continentes.
  - Las corrientes cálidas suben por las costas este de los continentes y llevan calor a latitudes altas (como la corriente del Golfo con Europa).
  - Las frías bajan por las costas oeste, enfrían el aire y frenan la lluvia: desiertos costeros (Atacama, Namib).
  - Donde el agua fría sube a la superficie (afloramiento) hay pesca muy rica: pueblos pescadores con causa.
  - El agua también lleva qi: una corriente cálida que pasa por una vena submarina de fuego lo transporta hacia otras costas.
- **Oscilaciones de pocos años** (tipo El Niño): el acople entre los vientos y la temperatura del océano en cada cuenca oscila con un período de 2-7 años, calculado desde las corrientes y los vientos de esta etapa (determinista, con `rng.fork("planet", "oscillation", cuenca)` solo para la fase inicial). Cada fase cambia la lluvia y la temperatura de las costas y del interior conectado: sequía en un lado de la cuenca, lluvias e inundaciones en el otro, pesca que se va con el afloramiento. Es la variabilidad que se nota en una vida (años buenos y malos) y la que [living-world.md](living-world.md) §1 usa para sequías e inundaciones. Se suma a los ciclos largos de §8 y a los inviernos volcánicos de §10.

### 4. Biomas
- Clasificación tipo **Whittaker** (temperatura × precipitación) + altitud + suelo, desde `content/biomes.json` validado con Zod.
- Esta es la base "mundana". La versión espiritual de cada bioma (bosque espiritual, pantano yin) sale de combinar bioma y qi en la etapa 5.

### 5. Qi: la capa metafísica

(Describe una fuente de tipo campo ambiental, la de xianxia y otras familias. Si las leyes del mundo eligen otra fuente, esta etapa cambia; ver [metaphysics.md](metaphysics.md).)
El qi **se deriva de la geología y el clima**, no se pinta encima:

| Fuente | Elemento | Por qué |
|---|---|---|
| Volcanes, puntos calientes | Fuego | Calor del interior del planeta |
| Vetas minerales, cordilleras metamórficas | Metal | La roca concentra metal |
| Bosques viejos, selvas | Madera | Vida acumulada durante siglos |
| Ríos grandes, lagos, mar | Agua | Flujo de agua |
| Llanuras de sedimento, mesetas | Tierra | Estabilidad del suelo |
| Fallas profundas, cruces de bordes | Mixto, intenso | Grietas por donde sube el qi profundo: **venas espirituales** |
| Picos altos, cielos despejados | Celeste (sol/luna) | Cercanía a las fuentes celestes |

- **Venas espirituales:** líneas de qi que siguen fallas y raíces de cordilleras. Son las fuentes principales, finitas y con tasa de regeneración.
- **Fronteras elementales:** celdas vecinas con elementos que se vencen producen nieblas, termas, géiseres o tormentas permanentes; las que se generan en ciclo forman lugares de qi que se alimentan solos ([elements.md](elements.md) §6).
- **Flujo:** el qi difunde hacia las celdas vecinas con preferencia "cuesta abajo" (valles, cuencas, cuevas). Se resuelve una vez hasta el equilibrio en la generación y después lo sigue la simulación.
- **Anomalías y tesoros naturales (天材地宝):** la acumulación masiva de qi **durante tiempo suficiente** transforma la materia. No se tiran al azar: hay umbrales de concentración × tiempo × elemento, y cuando se cruzan ocurre un **evento de formación natural** con causa (la vena, la cuenca que acumula, los siglos sin que nadie consuma).
  - **Escala pequeña:** piedras espirituales (qi cristalizado en la roca), hierbas milenarias, manantiales de qi líquido, minerales espirituales.
  - **Escala grande, la geografía imposible natural:**
    - Montañas flotantes, donde el qi de tierra invertido anula el peso.
    - Lagos de agua yin que no se congelan ni reflejan.
    - Árboles que tocan las nubes.
    - Mares de nubes estancadas en una cuenca.
    - Bosques de piedra.
  - **Consecuencias en cadena:** los tesoros atraen bestias que se alimentan de su qi y terminan custodiándolos (sin guion: van por el qi). Si alguien los cosecha, se corta el proceso, y el qi local cae.
  - Se generan dos veces: en la planet-gen, con la edad del planeta como "tiempo acumulado", y después de forma continua durante la historia y la partida, cuando una zona sin consumo cruza el umbral. Un lugar raro siempre tiene una razón física y metafísica, y esa razón se puede descubrir.
- **Equilibrio y fuerza del Cielo:** el presupuesto global de la etapa 0 escala todo. Un Cielo fuerte significa menos qi libre.
- **Ledger:** el qi total queda registrado desde acá. La simulación solo lo mueve, consume o regenera desde fuentes.

### 5b. El mundo de abajo y el mar profundo
- **Subsuelo:** cada celda tiene capas de profundidad (superficie, cuevas, profundo). Las cuevas salen de la roca y el agua. Los **ríos subterráneos** conectan regiones por debajo y los ecosistemas de las profundidades no ven el sol. Las venas más intensas nacen abajo y suben por las fallas: **lo más poderoso del planeta está enterrado**, y bajar es peligroso (qi denso, bestias que nunca vieron humanos, oscuridad).
- **Mar profundo:** en un planeta tan grande, los océanos son fronteras casi infranqueables para un mortal. Hay dorsales con venas submarinas, bestias abisales y fosas. Cruzar un océano requiere barcos excepcionales o cultivo alto, así que **continentes enteros pueden no saber que el otro existe**. El contacto entre ellos es un evento histórico.

### 5c. Habitabilidad: el qi enferma a los mortales
El qi muy denso es tóxico para un cuerpo sin meridianos abiertos: fiebre, delirio y muerte con exposición larga. Cada celda tiene una **habitabilidad mortal** que baja con el qi.
- Las sectas viven en montañas de qi alto y los mortales en tierras de qi bajo: la separación entre los dos mundos sale sola.
- Los hijos de cultivadores nacidos en zonas de qi alto tienen ventaja (y los que no despiertan sufren).
- Una marea alta de qi vuelve inhabitables zonas mortales y provoca migraciones. Una baja deja a las sectas sin sustento.

### 6. Recursos y ecología inicial
- Minerales y gemas según la roca. Suelos iniciales según la roca, el sedimento, el clima y la vegetación (§9).
- **Plantas y bestias** espirituales: poblaciones iniciales por celda según bioma, qi y elemento, desde `content/`. Después las maneja la ecología (capa 2).
- Cuevas: según la roca (caliza → kársticas, volcánica → tubos de lava) y el agua.

### 7. Entrega a la historia profunda
La planet-gen **no** crea ruinas, reinos secretos ([secret-realms.md](secret-realms.md)), sellos ni tesoros, porque todo eso necesita a alguien que lo haya hecho. Los produce [deep-history.md](deep-history.md) al simular la aparición de la vida inteligente, el cultivo y las civilizaciones sobre este mapa.

**Nombres:** los lugares no tienen nombre hasta que una cultura los nombra. Cada cultura usa su propio idioma, y el mismo río puede tener tres nombres según quién te hable. El mapa del jugador muestra los nombres que **su personaje** conoce.

## 8. Clima de largo plazo: glaciaciones y nivel del mar

El clima de la etapa 3 es el de un momento. A lo largo de milenios cambia, y con él cambian los hielos, las costas y los caminos entre continentes. Las causas son las mismas que mueven las mareas de qi: los ciclos de la órbita.

```ts
interface GlobalClimateState {
  epoch: Tick;
  orbital: { eccentricity: number; obliquity: number; precessionPhase: number };   // los ciclos de la etapa 0
  qiTide: { phase: number; amplitude: Partial<Record<ElementId, number>> };       // la marea de qi del mismo momento
  tempOffset: number;                       // °C respecto del clima base de la etapa 3
  iceVolume: number;                        // agua guardada como hielo sobre tierra
  seaLevel: number;                         // metros respecto del nivel de la generación
  aerosolLoad: Float32Array;                // por banda de latitud (§10)
  causes: CauseRef[];
}

interface IceCover {                       // por celda de nivel 0
  cell: CellId;
  thickness: number;
  flow: Vec2;                               // el hielo fluye cuesta abajo y talla valles
  since: Tick;
}

interface LandBridge {
  id: LandBridgeId;
  cells: CellId[];                          // plataforma continental expuesta
  connects: [LandmassId, LandmassId];
  opened: Tick;
  closed?: Tick;
  originEventId: EventId;                   // el avance glaciar que bajó el mar
}
```

- **Forzantes.** La insolación por latitud y estación varía con excentricidad, oblicuidad y precesión (ciclos de decenas a cientos de milenios). Cuando los veranos de las latitudes altas son frescos, la nieve no se derrite del todo y empieza a acumularse.
- **Acople con el qi (por mundo).** La marea de qi sale de los mismos ciclos. En la familia xianxia el acople es directo: una marea con mucho yin de agua favorece el frío y el hielo (el hielo es el derivado de agua con frío yin extremo, [elements.md](elements.md) §5), y una marea con mucho yang de fuego favorece el calor. Cuánto pesa el acople es un parámetro de la cosmología: en algunos mundos es cero y el clima solo responde a la órbita.
- **Realimentaciones:** el hielo refleja la luz y enfría más (albedo); el mar más frío guarda menos humedad; al retirarse, el hielo deja tierra oscura que se calienta. Por eso los cambios son lentos al principio y bruscos al final.
- **Conservación del agua.** Océano + hielo + lagos + agua subterránea es constante. El hielo que crece sobre los continentes sale del mar: el **nivel del mar baja** en proporción, y sube cuando el hielo se derrite. La línea de costa se recalcula desde la elevación y el nivel del mar.
- **Mar bajo:** se exponen las plataformas continentales.
  - Aparecen **puentes de tierra** entre continentes e islas. Por ahí cruzan bestias, plantas, pueblos y enfermedades (body-health: choque de poblaciones). Así llegan especies y culturas a lugares que antes no conocían ([living-world.md](living-world.md) §10).
  - Los ríos se alargan sobre la plataforma, y los puertos quedan tierra adentro.
- **Mar alto:**
  - Los puentes se cierran. Las poblaciones que quedaron separadas divergen (bestias que evolucionan, lenguas que se separan: [living-world.md](living-world.md) §2, §3).
  - Las costas se inundan y las ciudades costeras quedan bajo el agua (ruinas sumergidas: [deep-history.md](deep-history.md)). Las islas se parten.
  - Las culturas lo recuerdan como **el diluvio** o la tierra perdida (living-world §4: los mitos son historia deformada).
- **Hielo sobre la tierra:**
  - Los glaciares tallan valles en U, dejan morrenas y lagos al retirarse, y empujan a la gente y las bestias hacia el ecuador.
  - Un dique de hielo que se rompe vacía un lago de golpe: una **inundación glaciar**, desastre con causa ([living-world.md](living-world.md) §1).
  - Bajo el hielo, las venas siguen fluyendo sin nadie que consuma. Cuando el hielo se retira, aparecen **tesoros naturales** que se formaron durante milenios (etapa 5).
- **Escala de tiempo:** un ciclo glacial dura decenas de milenios, así que en una vida mortal el mar casi no se mueve. Lo que sí se ve en una vida son los eventos bruscos (inundaciones glaciares, un puente que se corta en pocas generaciones) y, para un cultivador que vive milenios, la costa de su juventud bajo el agua.
- **Predecible:** los ciclos son calculables. Una escuela de astrónomos que entiende la órbita puede saber que se viene una era fría (divination: pronóstico por conocimiento); casi nadie lo cree.

## 9. Suelos

El suelo es estado de la celda (nivel 0, agregado) y de cada parcela (nivel 1). Se forma muy lento, se agota rápido y se recupera con trabajo y tiempo.

```ts
interface SoilState {
  texture: "sand" | "loam" | "clay" | "silt" | "peat" | "ash" | "rocky";   // de la roca y el sedimento
  depth: number;                            // cm de suelo útil
  organic: number;                          // materia orgánica
  fertility: Partial<Record<NutrientId, number>>;   // nutrientes abstractos por familia (content/)
  salinity: number;
  acidity: number;
  waterCapacity: number;
  compaction: number;
  contamination: { kind: ContaminantId; amount: number; originEventId: EventId }[];  // metales de una mina, sangre de una batalla, toxinas
  qiSaturation: Partial<Record<ElementId, number>>;  // el suelo absorbe qi: tierra espiritual (灵土)
  history: EventId[];                       // quemas, inundaciones, cosechas, abonos, batallas
}
```

- **Formación:** la roca se meteoriza a razón de centímetros por siglo. Hay suelos que se renuevan rápido: la ceniza volcánica (§10) da tierras muy fértiles en pocas décadas, y las crecidas anuales de un río depositan limo cada año. Por eso hay civilizaciones de río y laderas de volcán pobladas a pesar del peligro.
- **Agotamiento:** cada cosecha se lleva nutrientes según el cultivo. Sin devolverlos, el rendimiento baja año a año. Las hierbas espirituales agotan además el qi del suelo.
- **Recuperación:** barbecho, abono, estiércol y heces humanas, rotación con leguminosas, ceniza de roza y quema. Cada método es un proceso que hay que conocer ([technology.md](technology.md): agricultura). Los nutrientes se mueven: del suelo a la cosecha, de la cosecha a quien la come, y vuelven al campo o se pierden río abajo. Una ciudad que no devuelve sus desechos al campo vacía los suelos de su región.
- **Degradación:**
  - **Erosión:** talar una ladera, sobrepastorear o arar sin terrazas hace que la lluvia se lleve el suelo. Lo perdido no vuelve en una vida, y el sedimento llena los ríos y los puertos aguas abajo.
  - **Salinización:** el riego sin drenaje en climas secos deja sal. Los campos más ricos de un imperio de canales se vuelven blancos en pocos siglos.
  - **Compactación y acidez** por mal manejo.
  - **Contaminación** por minas, curtiembres, batallas con venenos o qi corrupto.
- **Desertificación:** un borde seco sobreexplotado pierde vegetación, suelo y humedad local, y el desierto avanza con causa.
- **Suelo espiritual:** donde una vena empapa la tierra durante siglos, el suelo guarda qi (`qiSaturation`) y da hierbas espirituales. Las sectas lo cuidan y lo explotan, y también lo agotan.
- **Consecuencias:** los rendimientos que caen suben la presión de hambre ([causality.md](causality.md) §9). Desde ahí siguen deudas y pérdida de tierras ([economy.md](economy.md)), migración, abandono de aldeas, guerras por tierra buena y colapsos de estados cuyo grano dependía de suelos que se agotaron.
- **El suelo como creencia:** nadie ve la fertilidad. El campesino ve el rendimiento, el color, las malezas, y forma hipótesis ("este campo está cansado", "hay que dejarlo descansar cada tres años") con el mecanismo de [discovery.md](discovery.md). El precio de la tierra sale de la calidad **creída** (economy).

## 10. Volcanes, inviernos volcánicos e impactos

```ts
interface Volcano {
  id: VolcanoId;
  cell: CellId;
  origin: "hotspot" | "subduction" | "rift" | "islandArc";   // de la tectónica (etapa 1)
  magmaPressure: number;                    // la presión que descarga la erupción (living-world §1)
  recharge: number;                         // cuánto sube por año según el flujo de la placa o del punto caliente
  explosivity: number;                      // de la química de la roca: subducción → explosivo, punto caliente → efusivo
  lastEruption?: EventId;
  sealedBy?: { by: AgentId | OrgId; eventId: EventId; strength: number };   // un sello de cultivador (living-world §1)
  fireVein?: VeinId;                        // la vena de fuego que alimenta
}

interface VolcanicWinter {
  originEventId: EventId;                   // la erupción (o el impacto)
  aerosol: number;                          // azufre y polvo en la alta atmósfera
  bands: number[];                          // bandas de latitud afectadas (vientos de la etapa 3)
  decay: number;                            // cae a la mitad en ~1 año; los grandes duran 2-3, los colosales una década
}
```

- **Erupciones con tamaño.** La presión sube con la recarga y se descarga en una erupción cuyo tamaño depende de cuánto se acumuló y de la explosividad. Un volcán que descarga seguido hace erupciones chicas; uno dormido por siglos acumula una grande.
- **Efectos locales:** coladas, flujos piroclásticos, lahares, ceniza que mata cosechas y ganado por un año. Después la ceniza da suelo fértil (§9). Además sube el qi de fuego: la vena descarga y se rearma.
- **Invierno volcánico.** Una erupción explosiva grande lanza azufre a la alta atmósfera, y los vientos lo reparten por bandas de latitud. Baja la temperatura por uno a tres años en medio hemisferio o en todo el planeta:
  - Heladas en verano y cosechas perdidas lejos del volcán, en tierras que nunca lo vieron.
  - Hambre, epidemias en cuerpos debilitados, precios que suben, revueltas.
  - Soles rojos y cielos turbios que las culturas leen como presagios ([divination.md](divination.md) §7) y que erosionan la legitimidad ([state.md](state.md)).
  - Todo eso se encadena por las mismas presiones de siempre: no hay un evento "año sin verano" escrito.
- **Supervolcanes:** cámaras de magma enormes que acumulan durante decenas de milenios. Una erupción así es un evento de historia profunda: invierno de una década, colapso de civilizaciones, cuellos de botella de especies.
- **Sellar un volcán** (living-world §1) no destruye la presión: la retiene (conservación). El sello aguanta mientras dure su fuerza, y si se rompe (el sellador muere, una batalla lo daña, una marea de qi lo debilita) la erupción es más grande que la que se evitó. Es una deuda que hereda quien venga.
- **Impactos.** Los cuerpos menores del sistema estelar (etapa 0) caen con una frecuencia que sale de cuánto escombro hay en órbitas cruzadas. Hay una población de cuerpos con órbitas calculables, así que es determinista.
  - Las chicas son **estrellas caídas**: hierro meteórico (metal escaso y valioso en este planeta) y materiales con qi celeste para [crafts.md](crafts.md).
  - Las grandes, muy raras, dejan un cráter y un invierno de impacto con el mismo modelo de aerosol.
- **Otras fuentes de aerosol:** incendios forestales gigantes y batallas de inmortales que levantan polvo usan el mismo `aerosolLoad`. Es raro que alcancen escala global.

## 11. El jugador y el narrador

- **Nadie ve el estado global.** El personaje percibe el tiempo de su lugar: el frío fuera de estación, la ceniza, el sol rojo, el campo que rinde menos, la costa que su abuelo recordaba más lejos. El narrador recibe eso, nunca `GlobalClimateState`.
- **Lo que se sabe es creencia.** Que existe un puente de tierra hacia otro continente está en mapas y relatos ([information.md](information.md) §5). Que el campo está cansado es una hipótesis del campesino. Que el invierno vino de un volcán lejano lo sabe solo quien conoce la causa (o lo cree un astrólogo que lo atribuye al Cielo).
- **El jugador puede actuar** sobre suelos y volcanes como cualquiera: abonar, dejar en barbecho, terracear, salar el campo de un enemigo, estudiar un volcán, sellarlo si tiene el poder (y heredar el riesgo).
- **El inspector** muestra la verdad: capas de hielo, nivel del mar y costas por época, suelos por parcela, presión de cada volcán, carga de aerosol por banda (`pressures`, [causality.md](causality.md) §10).

## 12. Paso del tiempo y escala

| Proceso | Paso en la partida | Paso en la historia profunda |
|---|---|---|
| Clima global, hielo, nivel del mar | Una vez por año | Por época (cientos a miles de años), con los ciclos orbitales |
| Puentes de tierra y costas | Al cambiar el nivel del mar más de un umbral | Por época |
| Suelos | Por estación en parcelas con agricultores de tier 2+; por año en celdas de nivel 0 | Agregado por celda: tendencia según población y técnica |
| Volcanes | Presión por mes; erupción como evento | Por época, con las grandes registradas como eventos |
| Aerosoles e inviernos | Por estación | Solo los de supervolcanes e impactos grandes |

- **Coherencia entre niveles:** al generar el nivel 1, las parcelas respetan el suelo agregado de su celda, y la historia de la celda (quemas, inundaciones, siglos de arado) se reparte en las parcelas según el uso.
- **Lo que se materializa al acercarse** (causality §5.3): el suelo exacto de una parcela, la morrena de un valle, la playa sumergida frente a una aldea. Siempre se respetan los agregados.

## Rendimiento
- Objetivo: nivel 0 completo en menos de 10-15 s en Node, una sola vez por partida. Se guarda en SQLite.
- Nivel 1: menos de 200 ms por celda, generada al acercarse y cacheada.
- Arrays tipados (`Float32Array` por atributo, indexados por `CellId`), no objetos por celda en los loops calientes.

## Herramientas
- `npm run worldgen -- --seed 123 --out maps/` exporta PNG equirectangulares por capa (placas, elevación, temperatura, lluvia, ríos, biomas, qi por elemento) y un resumen (fracción de tierra, ríos más largos, picos, venas).
- El inspector puede preguntar `why <cellId>`: por qué esta celda tiene esta elevación, clima y qi (la cadena de eventos geológicos).

## Tests
- Determinismo: mismo seed da exactamente el mismo planeta (hash de las capas).
- Etapas aisladas: cambiar parámetros del clima no cambia las placas.
- Cada río termina en el mar o en un lago endorreico, y el caudal no disminuye aguas abajo (salvo evaporación en endorreicos).
- Cada fuente de qi tiene un rasgo geológico o celeste como causa.
- Conservación: el nivel 1 respeta los agregados de su celda madre.
- Rangos sanos en 100 seeds: fracción de tierra, temperatura, sin celdas con valores NaN.
- Conservación del agua: océano + hielo + lagos + subterránea es constante en todo ciclo glacial; el nivel del mar baja exactamente lo que crece el hielo sobre tierra.
- Un puente de tierra existe solo si el nivel del mar está por debajo de la plataforma que lo forma, y tiene como causa el avance glaciar.
- El clima de largo plazo sigue los ciclos orbitales: con acople de qi en cero, la marea de qi no cambia el clima.
- Oscilaciones oceánicas: cada sequía o inundación de pocos años tiene como causa una fase registrada de la oscilación de su cuenca (o un invierno volcánico).
- Suelos: los nutrientes que salen de una parcela entran en la cosecha y siguen su camino (conservación); un suelo no recupera fertilidad sin barbecho, abono, sedimento, ceniza o meteorización.
- Volcanes: ninguna erupción sin presión acumulada; un volcán sellado conserva su presión y, si el sello cae, erupciona más grande.
- Invierno volcánico: la caída de temperatura de cada banda se explica por la carga de aerosol de un evento registrado, y decae.
- Determinismo: mismo seed → mismas eras glaciales, mismas erupciones, mismos suelos tras N años.

## Implementación
Encaja en la **Fase 5** (región y LOD) y la **Fase 7** (worldgen completo), pero conviene adelantar una versión mínima:
- **Mínimo (antes o durante la Fase 1):** grilla + tectónica + elevación + clima (con corrientes oceánicas) + biomas + qi básico + exportar PNG. Sirve para ubicar la aldea en un lugar real del planeta en vez de en el vacío.
- **Después:** hidrología completa, erosión, anomalías, nivel 1 local.
- **Fase 3:** oscilaciones oceánicas de pocos años para la región de la aldea (años buenos y malos); suelos por parcela con nutrientes, agotamiento, barbecho y abono, rendimientos que alimentan la presión de hambre (§9).
- **Fase 5:** suelos agregados por celda, erosión y salinización por uso, volcanes con presión y erupciones con efectos locales y ceniza (§9, §10).
- **Fase 7:** clima de largo plazo por época en la historia profunda: glaciaciones, nivel del mar, puentes de tierra, costas sumergidas; supervolcanes e impactos (§8, §10).
- **Fase 8:** inviernos volcánicos con aerosol por bandas y sus cadenas (hambre, presagios, legitimidad); estrellas caídas como materiales (§10).

## Decisiones tomadas en este borrador (revisables)
- Grilla geodésica hexagonal de ~40.000 celdas en nivel 0, con detalle local bajo demanda.
- Tectónica simplificada (forma creíble), no simulación física.
- El qi se deriva de la geología y el clima, con venas sobre fallas y elementos según el terreno.
- La planet-gen no crea nada artificial (ruinas, tesoros fabricados, reinos secretos: [secret-realms.md](secret-realms.md)): eso es trabajo de la historia. Los tesoros **naturales** sí, por acumulación de qi.
- Planeta grande: radio 2-4 veces el de la Tierra, con densidad baja (gravedad vivible, metal escaso).
- Un sol (binaria rara y estable). Lunas según su origen físico, nunca dos grandes.
- La frecuencia de tesoros no es un parámetro aparte: sale del qi del planeta (presupuesto de la cosmología, fuerza del Cielo, venas). Un mundo rico en qi está lleno de tesoros y uno en decadencia casi no tiene.
- Corrientes oceánicas desde el mínimo: dan climas costeros distintos a la misma latitud, desiertos costeros, zonas de pesca y transporte de qi.
- **Variabilidad de pocos años:** oscilaciones oceánicas por cuenca (2-7 años, tipo El Niño) calculadas desde las corrientes de la etapa 3; dan los años buenos y malos de una vida (aprobado 2026-10-06).
- Mareas de qi por ciclos astronómicos, subsuelo con capas, océanos como fronteras y qi tóxico para mortales.
- La geografía imposible tiene dos orígenes: natural (acumulación de qi) o histórico (batallas de inmortales, sellos, espadas que parten continentes).
- Los nombres los ponen las culturas, no el generador.

- **Glaciaciones por ciclos orbitales**, los mismos que mueven las mareas de qi; el acople clima-qi es un parámetro de la cosmología (directo en xianxia, cero en otros mundos).
- **El nivel del mar sale de la conservación del agua**: hielo sobre tierra baja el mar, y los puentes de tierra y las costas sumergidas salen de ahí.
- **Suelo como estado con nutrientes que se mueven**: se forma lento, se agota con cosechas, se degrada con mal manejo y se recupera con procesos conocidos; la fertilidad nunca la ve nadie, solo el rendimiento.
- **Inviernos volcánicos por aerosol** de erupciones grandes, sin evento "año sin verano" escrito: las consecuencias se encadenan por presiones.
- **Sellar un volcán retiene la presión**, no la destruye.
- **Impactos deterministas** desde una población de cuerpos con órbitas calculables; las estrellas caídas dan hierro meteórico.

## Preguntas abiertas
- Calibración: período y amplitud de las oscilaciones oceánicas por tamaño de cuenca; largo de los ciclos glaciales y su amplitud de nivel del mar; tasas de formación y agotamiento de suelos por textura y cultivo; recarga y explosividad de volcanes; frecuencia de impactos por tamaño.
