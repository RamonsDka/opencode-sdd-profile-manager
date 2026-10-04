# MVP, módulos y hoja de ruta

## Entrega actual: v0.1.0

Esta entrega contiene código ejecutable y precompilado, no solo una propuesta. Incluye las reglas, interfaz, automatización dentro de OpenCode, instaladores, respaldo del chat, utilidades de recuperación y pruebas descritas en el README.

Se denomina **MVP** porque la distribución aún necesita validación nativa de Windows/macOS y una campaña más amplia sobre bases grandes. No se presenta como versión estable 1.0.

## Fases y puertas de salida

| Fase | Resultado | Estado | Puerta de salida |
|---|---|---|---|
| 0. Descubrimiento | Auditoría de referencia, CLI, SDK, esquema y UI | Completada | Versiones y hallazgos documentados |
| 1. Definición | PRD, arquitectura, reglas y decisiones | Completada | Criterios de aceptación trazables |
| 2. Núcleo | Familias, cuota, candados, plan y ejecución | Completada | Pruebas de protección y errores |
| 3. TUI | Lista, perfiles, configuración, previa, detalle y respaldos | Completada | Renderizador real y comando en host |
| 4. Distribución MVP | ZIP precompilado e instalación preservando configuración | Completada en Linux | Build, TypeScript y smoke de instalación |
| 5. Beta multiplataforma | Windows 11/Terminal/PowerShell y macOS | Pendiente | Instalar, limpiar datos ficticios, restaurar y desinstalar en cada OS |
| 6. Escala | Exportación en streaming, cancelación interactiva y métricas de latencia/RAM | Pendiente | Bases grandes y fallos inyectados con límites medidos |
| 7. Integraciones | Adaptador OpenCode 2 y acceso opcional desde SDD Manager | Pendiente | Contratos y versiones fijados; no romper v1 |
| 8. Versión 1.0 | Publicación firmada, matriz de compatibilidad y regresiones | Pendiente | Cierre de los riesgos de la beta |

## Trabajo por módulos

1. **Motor:** conservar las invariantes al añadir reglas por antigüedad, presupuestos o límites por proyecto. Toda regla nueva debe pasar por el mismo plan explicable.
2. **Persistencia:** migraciones de schema explícitas; nunca resetear candados ante un error. Incorporar observación de cambios y espacio de estado por servidor si se habilitan conexiones remotas.
3. **Adaptador:** mantener la API del producto independiente del SDK. Un adaptador v2 no debe reutilizar contratos 1.x por parecido de nombres.
4. **Respaldo:** pasar a archivos incrementales; comprobar restauración de familias completas; investigar APIs de eventos antes de ofrecer recuperación total.
5. **Interfaz:** modo de tamaño físico si existe una medición honesta; filtro por proyecto en listado global; barra lateral de detalles; mayor cobertura de ratón y tecnologías de terminal.
6. **Distribución:** comprobar las rutas con espacios, nombres Unicode, XDG y configuración personalizada en Windows/macOS; probar coexistencia real con versiones concretas del SDD Manager.

## Ideas priorizadas

| Prioridad | Idea | Valor |
|---|---|---|
| Alta | Copias en streaming | Menor RAM para conversaciones enormes |
| Alta | Cancelación visible de lotes | Detener entre familias sin perder recibos |
| Alta | Pruebas nativas Windows | Plataforma principal del usuario |
| Media | Cuotas particulares por proyecto | Conservar más historial donde importa |
| Media | Previsualización de conversación | Revisar contenido antes de quitar candado |
| Media | Búsqueda y exportación de historial de limpieza | Seguimiento más cómodo |
| Baja | Cifrado opcional de respaldos | Proteger conversaciones fuera del perfil de usuario |
| Dependiente del host | Borrado condicional atómico | Eliminar la carrera entre comprobación y DELETE |

## Qué revisar en la primera prueba del usuario

Comprobar que aparece `/session-vault`, que se ven los proyectos esperados, que un candado persiste al reiniciar y que los perfiles producen el cupo esperado. Después, realizar una limpieza manual pequeña en sesiones prescindibles; finalmente activar el automático. Si la versión de OpenCode es otra, consultar `opencode --version` antes de asumir compatibilidad.
