# PRD — Requisitos del producto

## Problema y objetivo

Las conversaciones de OpenCode se acumulan entre proyectos. El usuario necesita conservar el trabajo reciente, proteger excepciones importantes y retirar conversaciones antiguas sin gestionar IDs manualmente. La pantalla debe entenderse sin conocimientos de SQL.

**Objetivo del MVP:** convertir una política de conservación en un listado explicable, aplicable de forma manual o automática, con candados persistentes y copia previa del chat.

## Usuario principal y experiencia

Desarrollador que usa OpenCode y SDD Profile Manager, principalmente en Windows. Prefiere opciones recomendadas, texto en español, navegación rápida y una interfaz oscura azul. El producto no necesita un proveedor de IA, claves API ni consumo de tokens para gestionar las sesiones.

Recorrido inicial: instalar → `/session-vault` → revisar lista → poner candados → elegir perfil → vista previa → confirmar una limpieza → activar automático si interesa.

## Requisitos y criterios de aceptación

| ID | Requisito | Criterio de aceptación | Estado |
|---|---|---|---|
| R01 | Abrir desde el chat | `/session-vault` abre una ventana nativa sin turno de modelo | Implementado y comprobado en host |
| R02 | Lista útil | Título, ID abreviado, proyecto, fecha efectiva y tamaño lógico bajo demanda | Implementado |
| R03 | Última actividad | Orden `time.updated`; actividad de hijas eleva su familia | Probado |
| R04 | Candados | Persisten entre aperturas; un candado en hija protege la familia | Probado |
| R05 | Cinco perfiles | 10, 15%, 25%, 40%, Mod 1–100 | Probado |
| R06 | Porcentajes estables | Después de limpiar no se reduce otra vez el cupo automáticamente | Probado |
| R07 | Ámbito | Todas las familias o las del proyecto actual | Probado |
| R08 | Vista previa | Expone candidatas y motivos de conservación antes de confirmar | Implementado |
| R09 | Limpieza segura | Revalida plan, actividad, familia y configuración; respalda y verifica antes | Probado |
| R10 | Automático | Activación explícita, intervalo y lotes; funciona con OpenCode abierto | Implementado; reglas probadas |
| R11 | Historial y respaldos | Manifiestos locales y extracción de conversación para importar | Probado con CLI real |
| R12 | Instalación simple | ZIP precompilado; preserva JSONC y plugins existentes | Instalador probado en Linux |
| R13 | Recuperación de espacio | Herramienta opcional de inspección/compactación offline | Incluida |

## Reglas del producto

- Unidad de retención: **familia**, no mensaje ni proyecto completo.
- Actividad efectiva: máximo `time.updated` de sus miembros.
- Orden de desempate: ID estable, para que dos fechas iguales no produzcan resultados distintos.
- Candados fuera del denominador de porcentaje y fuera del cupo.
- Cupo porcentual: `máximo(1, techo(familias_sin_candado × porcentaje / 100))` al seleccionar/recalcular perfil. Se persiste.
- El ámbito global tiene un cupo compartido. El ámbito por proyecto mantiene cupos independientes por ID de proyecto.
- Actividad reciente, ocupación, apertura y archivo pueden hacer que se conserve más que el cupo. La protección gana.
- No se retiran candados automáticamente si desaparece una sesión: conservar el ID permite que una conversación reimportada mantenga su protección.
- Error de inventario, configuración o respaldo: se detiene la operación; no se interpreta como lista vacía.

## Valores recomendados

| Ajuste | Predeterminado | Motivo |
|---|---|---|
| Perfil | Últimas 10 | Coincide con el objetivo inicial y es fácil de entender |
| Automático | Pausado | Permite revisar candados en el primer uso |
| Actividad reciente | 24 horas | Evita retirar trabajo recién usado |
| Intervalo | 30 minutos | Limita trabajo repetitivo |
| Lote | 10 familias | Acota impacto y tiempo de una ejecución |
| Archivadas | Conservadas | No asumir que archivo significa descarte |
| Ámbito | Global | Controla la acumulación entre proyectos |

## Métricas de éxito

Cero eliminaciones de familias con candado en los escenarios admitidos; cero borrados tras fallo de copia; resultado idempotente al repetir la misma política sin nueva actividad; apertura del listado sin IA; identificación clara de candidatos; recuperación de texto y partes mediante exportación/importación del host.

La latencia y el consumo de RAM deben medirse con bases representativas. La prueba de 10.000 sesiones verifica cálculo correcto, no constituye un benchmark de producción ni una promesa de rendimiento en Windows.

## Fuera del MVP

Adaptador OpenCode 2; servicio independiente de la TUI; coordinación distribuida con servidores que no cargan el plugin; restauración de todos los eventos internos; tamaño físico exacto por sesión; recolección de `tool-output`; sincronización de candados entre equipos; integración del menú del SDD Manager; cifrado de respaldos.
