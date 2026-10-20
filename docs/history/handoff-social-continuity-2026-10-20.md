# Lote social y funerario: evidencia previa a integrar #652

**Estado vigente (2026-10-20, Claude/Codex; lote social y funerario en verificación):**
base `5f45bb6` (#650), rama coordinadora `feat/f3-social-continuity`.
Núcleos de gastos funerarios y productos de culto integrados, sucesión opt-in
`bandits.succession`, puente `council.issues.bandits` desde recuerdos conocidos,
y reserva de saldos entre prácticas diarias de ofrendas. Sin cambios de motor,
defaults ni contenido global. El taller de culto requiere paquete opcional y
registro persistido de lotes; diseño en crafts y pendientes 2a/2b del ROADMAP.
La defensa del consejo todavía no ejecuta guardias: agenda y deliberación no
equivalen a una orden materializada. Percepción de asaltos y defensa tienen
pendientes independientes.

Verificación intermedia `social-continuity-check-2` sobre código hasta `08de244`
(solo docs posteriores durante la corrida): typecheck y lint pasaron;
3223 tests aprobados, uno falló en `tools/sim/repro.test.ts` por fixture sin
`heardClaims`. Fix `8c26d18`, 25 tests puntuales de repro/narration aprobados.
Ese check no certifica el puente de consejo `3e32262` ni el cableado funerario
posterior. Logs/exit nativo en `sim-reports/social-continuity-*.log/.exit`.
Los reportes previos de `.claude/worktrees/` y nuevos worktrees en `.worktrees/`
se conservan; exclusión local en `.git/info/exclude` para que el lint no revise
reportes ni copias del código. No borrar directorios ni junctions.

[Estados anteriores y resultados históricos](../history/handoff-through-2026-10-17.md).

Código final del lote: `d4e5395` (producción `487abdd`). Incluye cableado funerario `9272a50`, recuerdos de
asaltos para testigos NPC `c9976b8`, correcciones de tipos en fixtures y prueba
SQLite reubicada en `test/integration/life-funerals.test.ts` por capas.
La revisión independiente encontró presencia funeraria comprobada contra un
PlaceRef agregado: `487abdd` exige LOCATION.hex/space reales y declara reads.
Siete pruebas funerarias aprobadas (exit 0), incluida presencia remota/ausente,
reservas y continuidad SQLite. Log: `sim-reports/funeral-presence-check.log`.
Verificación amplia sobre `487abdd`: typecheck/lint/capas aprobados; 3239 tests
aprobados y 2 fallidos del mismo fixture de `full-profile-run.test.ts` (faltaba
`world.map` para el reporte nuevo). Duración Vitest: 1033,85 s; exit nativo 1,
log/exit `sim-reports/social-continuity-final-check.*`. `d4e5395` solo corrige
ese fixture: 15 tests de full-profile-run/oscillation-metrics aprobados, exit 0
(`social-continuity-fixture-check.*`); typecheck y lint repetidos, exit 0
(`social-continuity-final-typecheck.log`, `social-continuity-final-lint.log`).
Evidencia combinada: todos los archivos cubiertos; no se repitió la suite
completa tras el cambio exclusivo del fixture. No describir el check amplio
como verde. La corrida anterior interrumpida no cuenta como aprobación.
Git fetch y consulta de PR exitosos con permisos ampliados el 2026-10-20;
PR #651 de dependencias fuera del lote; PR #652 del lote social preparado para
integración con la evidencia anterior. Sin cambios de defaults ni motor.
Siguiente tras integrar #652: `perfil2-item-claims-design`, primer pendiente no
bloqueado de Fase 3; partir contrato puro, contienda de take y transferencia
de give antes de implementar. Los tres worktrees temáticos se conservan y sus
commits del lote ya están incorporados a la rama coordinadora; no reintegrarlos.
