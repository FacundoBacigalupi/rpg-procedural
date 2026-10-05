# Metafísica: las leyes de cada mundo

> Cada partida es una experiencia muy distinta porque **las leyes del mundo cambian**: de dónde sale el poder, cómo se usa, qué cuesta, qué hay arriba (un Cielo, dioses, nada) y qué pasa al morir. El xianxia es la familia más común, pero no la única: un mundo puede ser de magia y espadas occidental, otro uno de pactos oscuros y magia escasa, otro uno donde los dioses caminan entre los mortales.

Depende de: [causality.md](causality.md) (las leyes son la capa 0). Condiciona: [planet-gen.md](planet-gen.md), [heaven-karma.md](heaven-karma.md), [spirits.md](spirits.md), [npc-psychology.md](npc-psychology.md) (la práctica altera la psique), [living-world.md](living-world.md).

## Principio: el motor no es xianxia
- El código usa conceptos **genéricos**:
  - `Essence`: la energía (qi, mana, éter, fe, sangre…).
  - `Practice`: la forma de usarla (cultivo, hechicería, pactos, runas…).
  - `Law`: la ley superior (el Cielo, un panteón, nada).
  - `Soul`: el alma y su destino al morir.
- Los docs que hablan de qi, el Cielo, tribulaciones y las Fuentes Amarillas describen **la familia xianxia**, que es la primera que se implementa. Sus mecánicas (campo que fluye, ley que se opone, karma) son instancias de los ejes de abajo.
- Las invariantes no cambian en ningún mundo: causalidad, conservación (de la esencia también), determinismo, verdad vs creencia.

## Dos niveles: la ley y las escuelas
- **La ley (verdad):** cómo funciona realmente el poder en ese mundo. La genera el seed y vive en `WorldTruth`.
- **Las escuelas (conocimiento):** cómo cada civilización **entiende** y sistematiza esa ley. Son descubiertas por la historia, parciales y a veces equivocadas. Dentro de una misma familia hay escuelas rivales (dos sectas que cultivan por caminos distintos, dos órdenes de magos), pero **todas pertenecen a la familia del mundo**: no hay cultivadores y magos occidentales en el mismo mundo. Los "reinos" con nombre (Qi Gathering, Foundation Establishment, o "mago de tercer círculo") son una **clasificación cultural** encima de la ley, no la ley misma.

## Los ejes que genera el seed

### 1. Fuente(s) de la esencia
Puede haber una o varias, cada una con su propia física:
- **Campo ambiental** que nace de la geología (el qi de planet-gen; el mana de las líneas ley).
- **Celeste:** sol, luna, estrellas; poder que sube y baja con el cielo.
- **Vital:** sangre, fuerza de vida. Se obtiene de seres vivos (oscuro por naturaleza).
- **Espiritual:** almas, emociones, fe. Los dioses comen oración.
- **Conceptual:** palabras, nombres verdaderos, runas. Saber el nombre de algo da poder sobre él.
- **Otorgada:** la concede un ser (dios, patrón, demonio) a cambio de algo.
- **Escasa o ninguna:** mundos de magia baja, donde el poder es raro, sutil y temido.

### 2. Cómo se accede
- **Cultivo interno:** absorber y refinar en el cuerpo y el alma (xianxia).
- **Hechicería:** dar forma a la esencia externa con fórmulas, gestos y estudio (el mago de biblioteca).
- **Linaje:** el poder viene en la sangre (hechiceros natos, linajes de dragón).
- **Pacto:** un ser te presta poder (brujo, clérigo, chamán).
- **Artificio:** runas, encantamientos, alquimia, formaciones. El poder vive en objetos.
- **Ritual:** poder colectivo, lento, con muchos participantes.

### 3. Estructura de progresión
- **Reinos discretos** con rupturas (xianxia).
- **Maestría continua** (cuanto más practicás, mejor, sin saltos).
- **Círculos o grados** de complejidad (hechizos de nivel creciente).
- **Sin escalera:** el poder es conocimiento, recursos y pactos, no "nivel".

### 4. Costo y riesgo
Siempre hay uno, y es lo que hace que experimentar cueste:
- Desviación y daño interno.
- Corrupción del cuerpo o el alma.
- Vida acortada (el poder te consume) o alargada (el poder te conserva).
- Locura, pérdida de la memoria o de las emociones.
- Deudas con el patrón.
- Agotamiento físico.
- Atención de algo que mira desde afuera.

### 5. La ley superior
- **Ley que se opone** (el Cielo de xianxia): ver [heaven-karma.md](heaven-karma.md).
- **Panteón:** dioses reales que son **agentes** con intereses, territorios y rivalidades. Su poder depende de la fe, así que compiten por creyentes. Pueden morir, nacer o ascender desde mortales.
- **Física indiferente:** no hay nadie arriba; las reglas son reglas.
- **Dios muerto o ausente:** el orden se está deshaciendo y hay restos que se pueden cosechar.
- **Algo afuera:** entidades más allá del mundo que el poder atrae.

El karma literal existe solo si la ley lo lleva (Cielo, ciertos panteones). En un mundo de física indiferente no hay karma, solo consecuencias.

### 6. Almas y muerte
- **Ciclo con olvido** (las Fuentes Amarillas, reencarnación): ver [spirits.md](spirits.md).
- **Más allás:** reinos de los muertos gobernados por dioses, juicio, recompensa.
- **Disolución:** el alma vuelve a la esencia del mundo.
- **Sin alma:** la conciencia es del cuerpo y no queda nada.

Las reglas de formación de espíritus (resistir la fuerza que se lleva al alma, sostenerse con esencia) se adaptan a cada caso. Si no hay alma, no hay espíritus.

### 7. Otros ejes
- **Longevidad:** el poder alarga la vida (inmortales) o no (el viejo mago muere a los 80).
- **Techo de poder:** desde magia baja (un buen mago enciende velas y cura fiebres) hasta poder que parte montañas.
- **Quién puede usarlo:** todos con entrenamiento, una minoría con talento, solo ciertos linajes, solo los elegidos.
- **Especies inteligentes:** una (humanos) o varias, surgidas por evolución en ambientes distintos o creadas por poderes (los "elfos" de ese mundo tienen un origen en la historia). También se generan, no se eligen de una lista. **El jugador puede nacer en cualquier especie inteligente del mundo** (incluidas bestias despiertas donde existan), con su cuerpo, longevidad, cultura y forma de relacionarse con el poder.

## Familias (atractores, no plantillas)
El seed no elige una plantilla cerrada: muestrea los ejes con **correlaciones** que hacen que ciertos paquetes sean coherentes y frecuentes. Las familias son zonas densas del espacio:

| Familia | Combinación típica |
|---|---|
| **Xianxia** (la más común) | Campo ambiental + cultivo interno + reinos + ley que se opone + ciclo con olvido + longevidad |
| **Alta fantasía occidental** | Mana ambiental o celeste + hechicería y pactos clericales + círculos + panteón activo + más allás + varias especies |
| **Fantasía oscura / baja** | Vital o otorgada + pactos + sin escalera + corrupción + algo afuera + poder escaso |
| **Mitológica** | Espiritual (fe) + pactos y rituales + panteón que camina entre mortales |
| **Rúnica** | Conceptual + artificio + maestría continua + física indiferente |

- **Xianxia es la familia más común** (la mayoría de los mundos); el resto se reparte entre las demás.
- **Sin mundos mixtos:** cada mundo pertenece a una sola familia. Dentro de ella, los ejes varían (fuente, costo, ley, almas), así que dos mundos xianxia también se sienten distintos.
- Cuanto menos frecuente la combinación dentro de una familia, más rara la partida.

## Coherencia
Un validador revisa que la combinación tenga sentido y deriva consecuencias:
- Si el poder alarga la vida y la fuente es finita, hay competencia por la fuente.
- Si los dioses viven de la fe, buscan creyentes: religiones activas, misioneros, guerras santas.
- Si el poder es vital, cultivar implica matar o sangrar: estigma, leyes, cazadores.
- Si no hay alma, la muerte es definitiva y los NPCs le temen distinto (la psicología lee las leyes).

## Lo que cambia según la familia
- **planet-gen:** la etapa 5 calcula las fuentes elegidas (un campo geológico, uno celeste o ninguno). Los tesoros naturales y la toxicidad para mortales existen si la fuente es ambiental.
- **Narrador:** recibe el **vocabulario** del mundo (qi o mana, secta o academia u orden, ruptura o ascenso de círculo) y el tono de la familia. Los nombres salen del generador de lenguas. Nunca mezcla términos de otra familia.
- **Psicología:** valores, miedos y esquemas iniciales se adaptan a lo que el mundo hace posible (miedo a la muerte sin alma, devoción en mundos de dioses reales).
- **Contenido (`content/`):** ingredientes, criaturas y técnicas se generan por familia, no se comparten en una sola lista xianxia.

## Implementación
- **Fases 1-4:** solo la familia xianxia, pero con interfaces genéricas (`Essence`, `Practice`, `Law`, `Soul`) para no casarse con ella.
- **Fase 7 (worldgen completo):** el generador de leyes con los ejes y el validador. Segunda familia: alta fantasía occidental.
- **Después:** el resto de los ejes y familias, de a una.

## Tests
- Determinismo: mismo seed, mismas leyes.
- Toda combinación generada pasa el validador de coherencia (correr miles de seeds).
- La conservación de esencia vale en todas las familias.
- El narrador nunca recibe vocabulario de otra familia.

## Decisiones (2026-10-05)
- Xianxia es la familia más común. Peso exacto a calibrar (orientativo: ~60%).
- Sin mundos mixtos: una familia por mundo.
- Especies no humanas jugables.

## Preguntas abiertas
- Peso exacto de cada familia.
