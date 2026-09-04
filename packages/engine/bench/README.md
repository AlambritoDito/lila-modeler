# Benchmark de rendimiento

`npm run bench` ejecuta el benchmark reproducible de LILA-031: un proceso lineal con cinco tareas
constantes y 100 000 casos a través de la API pública `simulate`. Antes de medir hace tres corridas
de 2 000 casos para calentar el JIT; esas corridas quedan fuera del tiempo informado.

El objetivo de aceptación en la máquina de desarrollo de Brito es menos de 1 segundo. La prueba de
regresión usa el mismo runner y un margen deliberadamente holgado de 3 segundos para runners de CI
compartidos. El benchmark verifica los conteos de proceso y de cada tarea para evitar que una
optimización aparente sea en realidad trabajo omitido; comprueba además los seis flujos, los
500 000 completados de tarea, el processing constante y el ciclo exacto de 5 segundos. El comando
sale con código distinto de cero si excede el objetivo local de 1 segundo o si el reloj no es
finito y monótono.

Ejecutar con Node 22 o 24, desde la raíz del repositorio y sin otras cargas intensivas:

```bash
npm run bench
```

El tiempo cubre la simulación y el agregado de métricas. No incluye parseo BPMN, lectura de disco,
arranque de Node/tsx ni el warmup de JIT.
