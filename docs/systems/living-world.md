# El mundo vivo

> Lo que le pasa al planeta y a sus pueblos después de generado: desastres, bestias que evolucionan, culturas que salen del terreno, mitos que son historia deformada, rutas y conocimiento que se pierde. Nada se escribe a mano: todo sale de las capas de [causality.md](causality.md) corriendo sobre el mapa de [planet-gen.md](planet-gen.md).

## 1. Desastres con causa
No hay tabla de catástrofes: cada desastre es la descarga de una presión que el estado ya acumulaba.

| Desastre | Presión que lo causa | Se puede prever |
|---|---|---|
| Terremoto | Tensión acumulada en una falla activa (crece con el movimiento de placas) | Sí: fallas conocidas, temblores previos |
| Erupción | Presión en un volcán activo (punto caliente o borde); las grandes dan un invierno volcánico lejos ([planet-gen.md](planet-gen.md) §10) | Sí: humo, temblores, animales que huyen |
| Tsunami | Terremoto submarino | Minutos u horas antes, si sabés leer el mar |
| Sequía, inundación | Ciclos climáticos de varios años (oscilaciones del océano, mareas de qi); inundaciones glaciares ([planet-gen.md](planet-gen.md) §8) | Sí, por quien estudió los ciclos |
| Plaga, epidemia | Densidad de población + rutas comerciales + higiene + cosechas malas | Sí: síntomas que viajan por los caminos |
| Calamidad de qi | Sobreexplotación de una región (ver heaven-karma) | Sí: el qi baja, las bestias mutan |

- Los cultivadores fuertes pueden **provocarlos** (una batalla que rompe una falla) o **frenarlos** (sellar un volcán). Las dos cosas mueven karma.
- Un desastre deja huella: migraciones, hambre, guerras por recursos, tabúes ("no construyas en el valle"), mitos.

## 2. Bestias que evolucionan y despiertan
- **Adaptación por selección:** cada población de bestias tiene rasgos heredables (afinidad elemental según [elements.md](elements.md), tamaño, resistencia). Generación tras generación, el entorno favorece variantes: cerca de un volcán prosperan los lobos con afinidad al fuego. Las especies regionales **emergen**, no se escriben en una tabla. `content/` solo define los linajes base.
- **Despertar:** una bestia muy longeva con mucho qi puede despertar inteligencia. A partir de ahí es un **agente** con psicología (la misma de [npc-psychology.md](npc-psychology.md), con otros valores y necesidades), cultiva y con el tiempo puede tomar forma humana.
- **Reinos de bestias:** bestias despiertas que reúnen a otras forman facciones con territorio, intereses y memoria. Recuerdan a los humanos que cazaron a sus crías: las guerras entre humanos y bestias tienen causa.

## 3. La geografía hace a las culturas
Cuando la historia profunda crea un pueblo, sus rasgos culturales salen de **dónde vive y qué le pasó**:
- **Economía → valores:** nómadas del desierto (movilidad, hospitalidad, honor de clan), imperios de río (burocracia, obras hidráulicas, jerarquía), pueblos de montaña (aislamiento, tradición), costeros (comercio, apertura).
- **Comida, vestimenta, arquitectura** según clima y recursos (madera, piedra, barro).
- **Valores colectivos** con el mismo catálogo que los NPCs, como sesgo inicial para quienes nacen ahí.
- **Lenguas generadas de verdad** (decidido: máximo detalle):
  - Cada protolengua tiene **fonología** (inventario de sonidos, estructura de sílabas), **raíces** con significado y **morfología** básica (cómo se forman palabras compuestas).
  - **Evolución:** cuando un pueblo se separa (montañas, mares, migración), su lengua cambia con reglas de cambio fonético a lo largo de los siglos. Las lenguas hermanas se parecen y sus parientes lejanos apenas.
  - **Contacto:** el comercio y la conquista prestan palabras entre lenguas.
  - **Nombres con significado:** "Qingshui" significa "agua clara" en esa lengua. Un lugar conserva nombres viejos deformados de pueblos que ya no existen, y eso es una pista arqueológica.
  - **Escritura:** algunas culturas la inventan (o la heredan); los textos viejos están en lenguas muertas que hay que aprender a leer.
  - El LLM no inventa palabras: usa las del léxico generado (las traduce o las cita).

## 4. Los mitos son historia deformada
- La memoria colectiva usa la **misma mecánica** que la memoria de los NPCs: se transmite contada, se distorsiona y se comprime en gist. A escala de siglos, una batalla real entre dos inmortales se vuelve "el dios dragón contra la diosa del sol".
- Cada mito guarda un **puntero causal** al evento real (en `WorldTruth`). El jugador que investiga (comparar versiones de pueblos distintos, encontrar ruinas, leer textos antiguos) puede reconstruir qué pasó.
- **Los mitos apuntan a lugares reales:** "donde cayó la lanza del dios" puede ser un cráter con un fragmento de arma de verdad.
- Los mitos cambian la conducta (tabúes, peregrinaciones, odios entre pueblos), así que son causa y no solo decoración.

## 5. Creencias sobre el Cielo y calendarios
- Cada pueblo interpreta el Cielo, las tribulaciones, los eclipses y la muerte según lo que vivió: adorarlo (el Cielo castiga a los soberbios), desafiarlo (el camino del cultivo es rebelión), negarlo (no hay Cielo, hay leyes), temerle.
- **Religiones** como organizaciones que nacen de eventos (un profeta que vio una tribulación, un milagro que fue un cultivador) y compiten.
- **Calendarios:** cada cultura cuenta los años desde su propio evento fundador. "Año 314 del Calendario de la Grulla Celestial" sale solo, y la misma fecha tiene números distintos según quién la diga.

## 6. Rutas que nacen del terreno
- Las rutas son caminos de **menor costo** sobre el mapa (pendiente, ríos navegables, pasos, costas, peligro) entre lugares que tienen algo que intercambiar.
- Las ciudades crecen en **cruces**: confluencias, desembocaduras, pasos de montaña, puertos naturales.
- Los **cuellos de botella** (un paso, un estrecho) valen mucho, así que se fortifican, se cobran peajes y provocan guerras.
- Más tarde aparece infraestructura construida por la historia (caminos, canales, formaciones de teletransporte), que cambia el costo de viajar y redibuja el mapa del comercio.
- Las rutas también llevan plagas, rumores, técnicas y ejércitos.

## 7. El conocimiento es físico
- Una técnica, un mapa o una receta existen **en algún soporte**: manuscrito, tablilla de jade, inscripción, la memoria de alguien. Sin soporte, se pierde.
- Los soportes se degradan (papel que se pudre, jade que dura milenios), se queman, se roban y se copian (con errores: una técnica mal copiada es peligrosa).
- Un maestro que muere sin discípulos se lleva lo que sabía. **Las técnicas perdidas son reales**, y una ruina puede guardar algo que el mundo olvidó.
- El conocimiento se conserva como cualquier recurso: copiarlo crea un objeto nuevo con `originEventId`, y nada aparece sin fuente.

## Implementación
- **Fase 3:** plagas y hambrunas (demografía + rutas), conocimiento con soporte.
- **Fase 5:** rutas por costo mínimo, ciudades en cruces.
- **Fase 7 (historia):** desastres geológicos y climáticos, culturas por geografía, mitos y calendarios, religiones, lenguas.
- **Fase 8:** reinos de bestias, evolución de linajes a escala de mundo.

## Tests
- Ningún desastre sin presión previa medible en el estado.
- Todo mito tiene un evento real como origen.
- Ningún conocimiento sin soporte ni fuente.
- Determinismo de la evolución de bestias con el mismo seed.

## Preguntas abiertas
- Ninguna por ahora.
