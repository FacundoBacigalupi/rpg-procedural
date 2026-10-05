# Información, creencias y rumores

> Estado: **borrador de diseño**. Cómo lo que alguien percibió se vuelve **creencia**, cómo las creencias viajan de persona a persona (y por cartas, mapas, pregoneros y espías) y cómo se deforman en el camino. Es la capa 4 de [causality.md](causality.md): una masacre que nadie conoce no genera venganza.

Depende de: [perception.md](perception.md) (de dónde sale todo lo que se sabe de primera mano), [npc-psychology.md](npc-psychology.md) (memoria, confianza, esquemas, teoría de la mente), [living-world.md](living-world.md) (rutas, lenguas, escrituras, el conocimiento es físico). Lo usan: [schemes.md](schemes.md) (cebos, calumnias, rastrear rumores), reputación, mitos, economía, organizaciones, el narrador.

## Principios
1. **Creer no es saber.** Cada agente tiene su propio conjunto de creencias, con confianza y fuentes. La verdad está en `WorldTruth` y nadie la consulta.
2. **Toda creencia tiene origen.** Viene de un percept, de una inferencia propia o de alguien que la contó (o de un texto, un mapa, un edicto). Se puede rastrear hacia atrás, con la distorsión y el olvido que haya en la cadena.
3. **Contar es una acción.** Nadie pasa información "porque sí": la cuenta porque le conviene, porque le importa al otro, porque le gusta chismear o porque quiere engañar. Lo decide la utilidad, como cualquier acción.
4. **La información viaja con cosas físicas.** Personas, cartas, palomas, talismanes, libros. No hay difusión mágica: una noticia llega a la ciudad cuando llega el primero que la trae.
5. **La deformación tiene forma.** Los rumores no cambian al azar: se simplifican, se exageran y se acomodan a lo que cada uno espera, con reglas deterministas.

## 1. Creencias (`sim/knowledge`)
Una creencia es una **proposición** de un catálogo cerrado de tipos (en `content/`), con un valor que puede ser incierto.

```ts
interface Belief {
  id: BeliefId;
  holder: AgentId;                       // NPC, jugador, organización (ver §9)
  prop: Proposition;                     // sobre qué es
  value: Distribution<unknown>;          // p.ej. reino: {QG8: .3, QG9: .6, FE1: .1}; vivo: {true: .9}
  confidence: number;                    // derivado de la distribución, para decidir rápido
  asOf: Time;                            // a qué momento del mundo se refiere (no cuándo se enteró)
  learnedAt: Time;
  sources: BeliefSource[];               // percepts, inferencias, quién lo contó, qué texto
  salience: number;                      // decae como la memoria; se olvida
  guarded?: SecrecyLevel;                // si el holder la considera secreta (ver §7)
}

type Proposition =
  | { kind: "attr"; subject: EntityRef; attr: AttrKey }          // reino de X, dónde está X, X vive
  | { kind: "event"; template: EventPattern }                    // "X mató a Y", "la secta cayó"
  | { kind: "relation"; from: EntityRef; to: EntityRef; dim: RelDim } // "X odia a Y"
  | { kind: "trait"; subject: EntityRef; trait: TraitKey }       // "X es codicioso" (reputación)
  | { kind: "location"; what: EntityRef | ResourceKind; where: PlaceRef } // "hay una hierba en la cueva"
  | { kind: "price"; good: GoodId; market: PlaceRef }
  | { kind: "route"; from: PlaceRef; to: PlaceRef }               // mapas
  | { kind: "law"; key: LawKey };                                 // hipótesis sobre las leyes del mundo (ver discovery.md)
```

- **`asOf` importa.** "Wu está en Qingshui" es verdad sobre hace tres meses. Las creencias envejecen: el sistema no las marca falsas, pero el agente con buena teoría de la mente sabe que lo que sabe puede estar viejo.
- **Ignorancia ≠ creencia falsa.** No tener una creencia sobre algo es distinto de creer algo falso, y el razonamiento los trata distinto (preguntar vs actuar).
- **Entidades fantasma.** Una creencia puede referirse a algo que **no existe**: el "anciano Fang" que alguien inventó al mentir, un tesoro que nunca hubo. Viven solo en el espacio de las creencias, como `PhantomRef`, con el `originEventId` de la mentira o el error que las creó. No violan la causalidad porque no son entidades del mundo, y son lo que hace funcionar un cebo.

### De percept a creencia
- Cada campo de un percept con confianza suficiente actualiza (o crea) creencias del observador, con el percept como fuente.
- **Inferencia:** reglas de un catálogo cerrado convierten creencias en otras: "X entró a la casa" + "falta el jade" → "X robó el jade" (con confianza). Cuántas reglas encadena y qué tan bien depende de `intellect`, de las habilidades (un investigador conoce reglas que un campesino no) y de los esquemas (el desconfiado infiere malicia con menos evidencia).
- Las inferencias quedan registradas como fuente, así que el inspector puede mostrar "lo dedujo de esto".

### Revisión de creencias
Cuando llega información nueva sobre algo que ya cree, el agente la combina:
```
nuevo = combinar(previo, evidencia, peso = credibilidad(fuente) × plausibilidad(evidencia | previo))
```
- **Credibilidad de la fuente:** confianza y respeto hacia quien la cuenta, efecto halo (rango, fuerza, belleza), su historial (si ya mintió y lo pescó) y si tiene motivos para mentir (según la teoría de la mente del que escucha).
- **Plausibilidad:** cuánto choca con lo que ya cree. Una noticia muy improbable necesita mucha evidencia.
- **Sesgos** (npc-psychology): la confirmación pesa más lo que encaja con sus esquemas. Las creencias atadas a la **identidad** ("mi maestro es justo") resisten la evidencia en contra hasta que se quiebran de golpe.
- **Fuentes contadas dos veces.** El que escucha no sabe si dos personas que le dicen lo mismo lo vieron por separado o lo escucharon del mismo chismoso. Si no recuerda las fuentes, las cuenta como independientes: un solo rumor repetido por cinco bocas parece un hecho. Es el efecto "todos lo dicen".

## 2. Contar: actos de habla con información
Compartir es una decisión de la utilidad con los mismos actos de habla del diálogo (npc-psychology §8): contar, preguntar, mentir, exagerar, advertir, presumir, negar, enseñar, callar.

### Por qué alguien cuenta algo
El valor de contar una creencia `b` a un oyente `L` sale de:
- **Novedad e intensidad:** lo raro y lo emocional se cuenta más (una muerte, un escándalo, un tesoro).
- **Relevancia para el oyente** según lo que el que habla cree de él: advertir a un amigo, avisarle a la familia.
- **Valor social del chisme:** compartir información crea vínculo (`sociability`) y da estatus (el que sabe las novedades).
- **Interés propio:** conseguir algo a cambio, manipular, dañar a un rival, quedar bien.

### Por qué alguien calla
- Es un secreto propio o ajeno (§7), le teme a las consecuencias o protege a alguien.
- La información tiene valor y compartirla lo diluye (la ubicación de un tesoro, una técnica).
- No confía en el oyente o cree que lo va a usar en su contra.

### Mentir
Una mentira es contar una proposición que el que habla **no cree**, elegida para instalar una creencia útil para él. El contenido sale del sim (qué creencia falsa le conviene), nunca del LLM.
- Si el jugador miente, el parser traduce su texto a una proposición del catálogo (puede referirse a entidades fantasma). El LLM no crea entidades del mundo: una mentira solo crea una creencia en quien la escucha.
- Mantener una mentira cuesta: hay que recordarla y no contradecirla. Cada mentira activa queda en las creencias del mentiroso como `liesTold`, y contradecirse es detectable (perception §6).

### Preguntar
Preguntar también es una acción y revela qué te interesa: el que pregunta mucho por la cueva del barranco le está diciendo algo al que escucha. Es una fuente de información en sí misma, y una forma de que un intrigante detecte a quien lo investiga.

## 3. Deformación en la transmisión
Cada vez que una creencia pasa de una persona a otra se aplican transformaciones deterministas (`rng.fork("rumor", beliefId, tellerId, listenerId)`), cuyo tamaño depende del que cuenta (`memory`, `control`, temperamento, cuánto la recuerda) y del contexto (apuro, alcohol, emoción):

| Transformación | Qué hace | Ejemplo |
|---|---|---|
| **Simplificación** | Se pierden detalles y matices; queda el núcleo | "Lo hirió en una pelea de deudas, de noche, borracho" → "lo hirió" |
| **Exageración** | Las magnitudes crecen, sobre todo las emocionales | Tres bandidos → una banda; Qi Gathering 7 → Foundation Establishment |
| **Atribución** | El autor se desliza hacia alguien más saliente o más esperado | El que mató fue "el de la secta", aunque fue un mercenario |
| **Asimilación** | La historia se acomoda a los esquemas y prejuicios del que la cuenta | En boca de alguien que odia al Filo de Hierro, ellos son los culpables |
| **Fusión** | Dos historias parecidas se mezclan en una | Dos ataques de bestias distintos se vuelven "la bestia del norte" |
| **Moralización** | Se agrega una causa o lección que nadie vio | "Murió porque ofendió al Cielo" |
| **Olvido de la fuente** | El que escucha recuerda el contenido pero no de quién | "Dicen que…" |

- Las transformaciones nunca inventan cosas fuera de lo que el que cuenta cree o espera: los valores nuevos salen de sus creencias y esquemas (igual que los errores de percepción).
- La misma mecánica, corrida durante siglos, produce los **mitos** de [living-world.md](living-world.md) §4.

### El rumor como linaje
Para el inspector, la crónica y los mitos, cada creencia contada guarda su `rumorId` y el salto del que vino. Así se forma un **árbol de variantes** de cada rumor, con su raíz en el evento real (o en la mentira que lo creó):

```ts
interface RumorLineage {
  id: RumorId;
  root: EventId | LieEventId;       // qué pasó de verdad, o quién lo inventó
  variants: Array<{ beliefId: BeliefId; parent?: BeliefId; teller?: AgentId; hops: number }>;
}
```
"¿Quién te lo dijo?" sigue este árbol hacia arriba en la memoria del que responde, que puede haber olvidado la fuente o mentir sobre ella.

## 4. Canales y medios
La información solo viaja si algo la lleva:

| Medio | Velocidad | Alcance | Riesgos y requisitos |
|---|---|---|---|
| **Conversación** | Lo que tarda la gente en encontrarse | Uno a uno o un grupo chico | Ser escuchado (perception) |
| **Lugares de reunión** (mercado, casa de té, posada, pozo, templo) | Rápida dentro del asentamiento | Muchos oyentes | Mucha deformación; los cuentan como "todo el mundo dice" |
| **Viajeros y caravanas** | La de las rutas (living-world §6) | Entre asentamientos | La noticia llega con quien la trae, ya deformada por los saltos |
| **Cuentacuentos, canciones, teatro** | Lenta pero persistente | Enorme, entre generaciones | Máxima deformación; fuente de mitos y de fama |
| **Cartas** | La del portador | Un destinatario | Objeto físico: se pierde, se intercepta, se falsifica. Requiere saber escribir y leer |
| **Postas oficiales** | Rápida (relevos) | Red del estado o de una organización | Solo para quien tiene acceso; se puede espiar |
| **Palomas y bestias mensajeras** | Muy rápida en distancias medias | Rutas fijas (vuelven a casa) | Las cazan, se interceptan, poco texto |
| **Talismanes de mensaje** | Casi instantánea | Según el poder del talismán | Caros (esencia), se pueden rastrear o escuchar con sentido espiritual |
| **Edictos, carteles, pregoneros** | Lo que tarda en llegar el edicto | Todo un territorio | El cartel requiere lectores; el pregonero no. Es la voz oficial, y puede ser propaganda |
| **Textos** (libros, tablillas de jade, archivos) | Lenta, pero dura siglos | Quien los encuentre | Ver living-world §7; se copian con errores |
| **Redes de espías** (§8) | Variable | Lo que la organización paga por saber | Agentes que pueden ser descubiertos, comprados o dobles |

### Frentes de noticias (escala de región)
A escala de región no se simulan conversaciones. Una noticia avanza como un **frente** por el grafo de asentamientos y rutas:
- Llega a cada lugar en `tiempo = costo de la ruta / velocidad del medio más rápido que la lleva`, salvo que nadie viaje por ahí (rutas cortadas por guerra, invierno, una plaga).
- Llega con una deformación que crece con los saltos.
- Dentro del asentamiento, la fracción que la conoce crece con una curva logística según su intensidad y lo conectado que es el lugar.
- Cuando se materializa un NPC en ese lugar, sus creencias se muestrean de esa fracción y de esa versión (como los testigos en perception §12).

## 5. Mapas: la geografía como creencia
El mapa del jugador (y el de cada NPC) es un **conjunto de creencias** `location` y `route`, no el mapa real:
- **Conocimiento directo:** lo que recorriste o viste desde una altura, con buena confianza y `asOf` del momento en que lo viste.
- **Contado:** "el paso del este está a dos días" es una creencia vaga y quizás vieja.
- **Mapas como objetos:** un mapa es un ítem dibujado por alguien con **sus** creencias de ese momento, con su `originEventId`, su autor y su fecha. Copia los errores del autor, envejece (el río cambió de curso, la aldea ya no existe, el puente se cayó), puede estar incompleto a propósito (un mapa de secta que omite la entrada secreta) o ser **falso** (un cebo, una venta fraudulenta).
- **Leer un mapa** transfiere sus creencias al lector con la credibilidad del mapa, que depende de quién lo hizo y de cómo lo consiguió. Leer requiere entender sus convenciones y su escritura.
- **Nombres:** cada lugar aparece con el nombre en la lengua de quien lo nombró (living-world §3). El mismo río puede figurar tres veces en mapas de culturas distintas, y darse cuenta de que es el mismo es una inferencia.
- **En la UI:** el mapa del jugador dibuja lo que su personaje cree, con niebla donde no sabe, trazo dudoso donde la confianza es baja y la fecha de lo que vio.

## 6. Alfabetización y escritura
- Cada cultura tiene (o no) una o más **escrituras**, generadas con su lengua (living-world §3). Leer un texto requiere conocer **la lengua y la escritura**: un texto en una lengua muerta no se puede leer sin aprenderla.
- La **alfabetización** es una habilidad aprendida con procedencia (quién te enseñó). Su frecuencia depende de la cultura, la clase social y la época: en muchos lugares solo leen los funcionarios, los monjes y los cultivadores.
- Quien no lee depende de quien le lee, y eso es una vulnerabilidad: el escriba puede mentir sobre lo que dice la carta.
- **Autenticidad:** sellos, firmas, caligrafía y sellos de esencia autentican un texto. Falsificar es una habilidad, y detectar la falsificación otra (comparar con un original que se conozca).
- **Cifrados:** las organizaciones usan códigos para sus cartas. Romper un cifrado es una tarea de intelecto y tiempo.

## 7. Secretos
- Un secreto es una creencia marcada como peligrosa de compartir para quien la tiene o para alguien que le importa. Tiene un **peso** (cuánto daño hace si se sabe) y un **miedo a la exposición** (npc-psychology §9c).
- Las organizaciones tienen secretos con **niveles de acceso**: qué saben los discípulos externos, los internos, los ancianos y el líder.
- Guardar un secreto cuesta: tentación de contarlo (valor social), riesgo de soltarlo bajo emoción, alcohol, tortura o una técnica de lectura del alma.
- El secreto de uno es la mercancía del otro: chantaje e intrigas (schemes §2).

## 8. La información como bien
- **Vale lo que le sirve al que la compra** y pierde valor a medida que se difunde (la ubicación de un tesoro vale mucho mientras la sepan pocos).
- Hay **informantes, corredores de información y casas de inteligencia** (情报) que la compran, la verifican, la venden y la inventan. Su reputación de exactitud es su capital.
- **Espías:** agentes de una organización infiltrados en otra. Su lealtad es una relación más (pueden quebrarse, ser comprados o ser dobles). Lo que reportan es lo que creen, con sus sesgos.
- **Propaganda y censura:** una organización (secta, estado, religión) siembra creencias a propósito con pregoneros, cuentacuentos pagos y edictos, y persigue las que le molestan. Es una intriga a escala de población: se modela con los mismos métodos de schemes, en agregado.
- Conecta con [economy.md](economy.md) (pendiente): el comerciante gana porque sabe precios que el otro no sabe.

## 9. Conocimiento colectivo y reputación
- **Conocimiento colectivo:** cada asentamiento o cultura (tier 0) tiene un conjunto de creencias con la **fracción** que las sostiene: "el valle norte está maldito" (80%), "los Zhao son usureros" (60%), qué hierbas son venenosas, qué se festeja y por qué. Es de donde se muestrean las creencias de los NPCs materializados, y se vuelve memoria colectiva y mito con el tiempo.
- **Creencias de organizaciones:** una secta "cree" lo que creen sus líderes y lo que tiene en sus archivos. Decide con eso (causality §3, capas 5-6).
- **Reputación:** es la distribución de creencias `trait` sobre alguien en una población: fuerte, generoso, cruel, mentiroso, peligroso. No es un número global: tenés una reputación por comunidad, y puede ser distinta en cada una.
  - Se forma por patrones percibidos (npc-psychology §9c) y por historias contadas, y viaja como cualquier rumor.
  - **Apodos:** cuando una historia sobre alguien se difunde lo suficiente, su versión más contada le pone un nombre ("el Carnicero de Yunshan"). El apodo sale del rumor dominante, deformado o no.
  - **Alias:** con otra identidad (disfraz, nombre falso) se arma otra reputación, separada mientras nadie vincule las dos (perception §7).
  - La fama atrae: retadores, discípulos, enemigos, pedidos de ayuda. Todo eso son agentes que creen algo de vos.

## 10. El jugador y el narrador
- El jugador ve **lo que su personaje cree**: un diario de creencias con su confianza, de dónde salieron y de cuándo son. Las creencias falsas aparecen igual que las verdaderas.
- Preguntar "¿quién te lo dijo?", "¿estás seguro?" o "¿cuándo fue eso?" son acciones normales que consultan las fuentes del NPC (que puede mentir u olvidar).
- El narrador recibe las creencias relevantes del personaje con sus confianzas y fuentes. Para hablar de un rumor usa el lenguaje de la incertidumbre ("dicen que", "según el herbolario") y nunca lo corrige con la verdad.
- Lo que el jugador **cree** que dijo su personaje es lo que el parser registró como acto de habla: si la traducción tiene dudas, se le muestra antes de resolver (no se le atribuyen dichos que no eligió).

## 11. Escala (LOD)
- **Tier 3-4:** creencias completas con distribuciones, fuentes, inferencias y teoría de la mente.
- **Tier 2:** creencias con confianza escalar, top-N por saliencia, fuentes resumidas (solo la última).
- **Tier 0-1:** conocimiento colectivo por fracciones y frentes de noticias.
- **Olvido:** las creencias pierden saliencia como las memorias. Las de baja saliencia y baja relevancia se borran; las que importan se comprimen en un gist ("los Zhao no son de confiar").
- **Linajes de rumores:** se compactan cuando nadie vivo sostiene variantes, dejando la raíz y la variante dominante (que puede seguir viva como mito).

## Implementación
- **Fase 2:** creencias con fuentes y confianza, de percept a creencia, contar/preguntar/mentir/callar, credibilidad y revisión, el diario del jugador.
- **Fase 3:** chisme por utilidad, deformación en la transmisión, linajes de rumores, reputación por comunidad, secretos, conocimiento colectivo de la aldea, cartas.
- **Fase 4:** lectura de aura y de alma como fuentes; talismanes de mensaje.
- **Fase 5:** frentes de noticias por rutas, mapas como creencias y como objetos, alfabetización y escrituras.
- **Fase 6:** espías, corredores de información, propaganda, secretos de organizaciones con niveles de acceso, cifrados.
- **Fase 7:** conocimiento colectivo → mitos a escala de siglos.

## Tests
- Determinismo: mismo seed y mismas acciones dan las mismas creencias y los mismos rumores deformados.
- Ninguna creencia sin fuente (percept, inferencia, transmisión o texto), y ninguna transmisión sin un evento de comunicación con un medio físico.
- Ningún agente lee `WorldTruth` para decidir.
- Las deformaciones solo introducen valores que estaban en las creencias o los esquemas del que cuenta.
- Frentes de noticias: una ruta cortada retrasa o frena la noticia en un escenario controlado.
- Fuentes contadas dos veces: un rumor de una sola fuente repetido por varias bocas sube la confianza de quien no recuerda las fuentes, y no la de quien sí.
- Agregado: la fracción que conoce una noticia en tier 0 coincide (en promedio) con la que sale de simular conversaciones individuales.

## Decisiones tomadas en este borrador (revisables)
- Creencias como proposiciones de un **catálogo cerrado** con valores en distribución, no texto libre.
- Entidades fantasma: las mentiras y los errores pueden referirse a cosas que no existen, solo en el espacio de las creencias.
- Las transformaciones de los rumores son reglas deterministas sesgadas por quien cuenta, y la misma mecánica produce los mitos.
- Toda transmisión necesita un medio físico; a escala de región se modela como frentes por las rutas.
- El mapa del jugador es un conjunto de creencias; los mapas son objetos con autor y fecha.
- La reputación es por comunidad, no global.

## Preguntas abiertas
- Tamaño del catálogo de tipos de proposición y de reglas de inferencia para la Fase 2: empezar con pocos y crecer.
- ¿Todas las creencias con distribución o solo las numéricas y de identidad? (costo de memoria en tier 2)
