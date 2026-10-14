# Investigación de modelado organizacional

> Read this in: [English](../../research/README.md).

Investigación solicitada el 2026-09-26 para precisar el [roadmap organizacional](../ROADMAP.md)
de Lila. Las fuentes de proveedores y proyectos se leyeron en esa fecha; lo que se afirma del estado
de Lila se revisó contra el commit `3c3ae07` (v1.0.0-beta.25) el 2026-10-14. Cubre ADONIS y alternativas open source en tres áreas complementarias. No modifica el
roadmap aprobado, autoriza dependencias ni implementa funciones del producto.

| Investigación | Preguntas |
| --- | --- |
| [Capacidades de ADONIS](ADONIS-CAPABILITIES.md) | ¿Qué modelos, objetos, relaciones, vistas, análisis y gobierno están documentados? ¿Qué depende de edición, módulo o integración? |
| [Repositorios open source](OPEN-SOURCE-REPOSITORIES.md) | ¿Cómo gestionan Archi, Essential y Modelio objetos reutilizables, relaciones y vistas? ¿Qué es realmente abierto? |
| [GRC e integraciones open source](OPEN-SOURCE-GRC-INTEGRATIONS.md) | ¿Cómo representan riesgos, controles, evaluaciones y evidencias? ¿Qué motores externos son relevantes para Lila? |

## Primera síntesis

Los tres informes están completos como investigación documental. No demuestran que exista un
reemplazo open source único de ADONIS ni cobertura completa de todas sus ediciones.

- **ADONIS:** referencia funcional para modelado, análisis y gobierno conectados. El informe
  propone precisar vista textual de instrucciones, consultas/datasets guardados, liberación
  independiente de documentos y paneles configurables en el roadmap.
- **Archi:** priorizar la distinción documentada entre objeto reutilizable y aparición gráfica,
  junto con consulta inversa de usos. Separar colaboración Git de coedición en tiempo real.
- **Essential:** estudiar relaciones organizacionales tipadas y vistas derivadas; comprobar
  límites comerciales de editores/API y licencia por componente antes de adoptarlo.
- **Modelio:** candidato para pruebas de intercambio BPMN y referencia de consultas entre modelos;
  no suponer que colaboración de pago o complementos opcionales pertenecen a la edición abierta.
- **CISO Assistant:** estudiar relaciones riesgo/control/evidencia y un posible adaptador externo.
  Community y comercial tienen funciones distintas. Resolver también la ambigüedad de edición
  del API de SimpleRisk; la licencia OSS actual de la aplicación eramba sigue sin verificarse.
- **Flowable:** conservarlo como candidato de ejecución externa, sujeto a adaptador versionado
  y pruebas de portabilidad. Esta investigación no selecciona ni agrega un motor de ejecución.

Son conclusiones de síntesis basadas en los informes enlazados arriba. Evidencia, versiones,
fuentes y pruebas pendientes quedan detalladas allí. Las mejoras sugeridas al roadmap no se
convierten automáticamente en compromisos de implementación.

## Cómo leer los hallazgos

- **Documentado**: respaldado por la fuente primaria citada; no significa probado en el producto.
- **Código inspeccionado**: el repositorio o código citado demuestra el detalle de implementación.
- **Verificado en la práctica**: requiere una prueba registrada; una captura o descripción comercial no basta.
- **No verificado**: faltan evidencias, hay ambigüedad de edición, material inaccesible o intercambio sin probar.
- **Recomendación**: inferencia para Lila, no afirmación sobre la implementación del proveedor.

Revisar versión, componente y edición junto a cada afirmación. Una edición alojada gratuita, un
repositorio público y un producto completamente open source son cosas distintas. No atribuir
funciones comerciales a la edición abierta sin evidencia. Las fechas describen la fuente o la
inspección, no garantizan que la versión anunciada sea el último build disponible.

## Cómo aplicar la investigación a Lila

Usar hallazgos para preparar contratos y ejemplos de aceptación concretos. Evaluar por separado:
aprender del diseño, admitir un formato, integrar un servicio externo o adoptar código. Una
referencia útil no justifica automáticamente un fork o una dependencia.

Siguen vigentes las [decisiones del proyecto](../DECISIONS.md): ADR-020 fija restricciones de
dependencias y ADR-029 la dirección del repositorio. La ejecución de workflows sigue externa;
el motor de simulación permanece independiente. Adoptar componentes requiere revisar su licencia
y ajuste técnico de manera específica.

Las pruebas posteriores usarán datos sintéticos: roles compartidos entre dos procesos, una
aplicación reutilizada, un documento y una cadena riesgo/control/evidencia. Probar conservación
de identidad, renombrado/borrado, sincronización tabla/diagrama, pérdidas de intercambio y
permisos. Registrar fallos como evidencia, sin deducir soporte por compartir notación o extensión.
