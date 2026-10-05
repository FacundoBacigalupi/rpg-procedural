# Generación del planeta

> El seed genera un planeta entero con una física plausible: placas, montañas, ríos, clima, biomas y un campo de qi que **sale de esa geografía**. Cada rasgo del mapa tiene una causa: la cordillera está ahí porque chocaron dos placas, el desierto porque la cordillera le roba la lluvia, la vena de qi de fuego porque hay un volcán sobre un punto caliente.

Depende de: [causality.md](causality.md) (capas 0-1, qi como campo físico), [heaven-karma.md](heaven-karma.md) (fuerza del Cielo), [deep-history.md](deep-history.md) (la historia escribe sobre el mapa después).

## Principios
1. **Causal, no ruido.** El ruido (Perlin/simplex) solo agrega detalle **dentro** de lo que la geología ya decidió. Nunca decide dónde hay un continente o una cordillera.
2. **Determinista y por etapas.** Cada etapa es una función pura `(estado, rng.fork("planet", etapa)) → estado`. Cambiar una etapa no altera el azar de las otras.
3. **Multi-resolución.** Se genera una grilla gruesa del planeta entero. El detalle local se genera **bajo demanda**, coherente con su celda madre (igual que los NPC de tier 1 con las estadísticas).
4. **El mapa es estado mutable.** La planet-gen produce el mapa inicial. Después la historia lo modifica (cráteres de batallas, venas destruidas, bosques talados, ríos desviados) y cada cambio es un evento.
5. **Inspeccionable.** Desde el día uno: exportar mapas PNG por capa (elevación, clima, biomas, qi) para mirar el resultado.

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
- Balance elemental global: un mundo puede ser rico en metal y pobre en madera.

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
- **Corrientes oceánicas:** opcional, una aproximación por giros que entibia o enfría costas.

### 4. Biomas
- Clasificación tipo **Whittaker** (temperatura × precipitación) + altitud + suelo, desde `content/biomes.json` validado con Zod.
- Esta es la base "mundana". La versión espiritual de cada bioma (bosque espiritual, pantano yin) sale de combinar bioma y qi en la etapa 5.

### 5. Qi: la capa metafísica
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

### 6. Recursos y ecología inicial
- Minerales y gemas según la roca. Suelos fértiles según el sedimento.
- **Plantas y bestias** espirituales: poblaciones iniciales por celda según bioma, qi y elemento, desde `content/`. Después las maneja la ecología (capa 2).
- Cuevas: según la roca (caliza → kársticas, volcánica → tubos de lava) y el agua.

### 7. Entrega a la historia profunda
La planet-gen **no** crea ruinas, reinos secretos, sellos ni tesoros, porque todo eso necesita a alguien que lo haya hecho. Los produce [deep-history.md](deep-history.md) al simular la aparición de la vida inteligente, el cultivo y las civilizaciones sobre este mapa.

**Nombres:** los lugares no tienen nombre hasta que una cultura los nombra. Cada cultura usa su propio idioma, y el mismo río puede tener tres nombres según quién te hable. El mapa del jugador muestra los nombres que **su personaje** conoce.

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

## Implementación
Encaja en la **Fase 5** (región y LOD) y la **Fase 7** (worldgen completo), pero conviene adelantar una versión mínima:
- **Mínimo (antes o durante la Fase 1):** grilla + tectónica + elevación + clima simple + biomas + qi básico + exportar PNG. Sirve para ubicar la aldea en un lugar real del planeta en vez de en el vacío.
- **Después:** hidrología completa, erosión, anomalías, nivel 1 local, corrientes oceánicas.

## Decisiones tomadas en este borrador (revisables)
- Grilla geodésica hexagonal de ~40.000 celdas en nivel 0, con detalle local bajo demanda.
- Tectónica simplificada (forma creíble), no simulación física.
- El qi se deriva de la geología y el clima, con venas sobre fallas y elementos según el terreno.
- La planet-gen no crea nada artificial (ruinas, tesoros fabricados, reinos secretos): eso es trabajo de la historia. Los tesoros **naturales** sí, por acumulación de qi.
- Planeta grande: radio 2-4 veces el de la Tierra, con densidad baja (gravedad vivible, metal escaso).
- Un sol (binaria rara y estable). Lunas según su origen físico, nunca dos grandes.
- La geografía imposible tiene dos orígenes: natural (acumulación de qi) o histórico (batallas de inmortales, sellos, espadas que parten continentes).
- Los nombres los ponen las culturas, no el generador.

## Preguntas abiertas
- Calibrar los umbrales de formación de tesoros (qué tan comunes son) con la simulación headless.
- ¿Corrientes oceánicas en el mínimo o después?
