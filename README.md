# 👟 Pasito · Podómetro

App web (PWA) para registrar tus pasos del día a día, con historial, estadísticas, una mascota que te anima (**Pipo**) e insignias por hitos.

## Qué incluye

- **Hoy**: anillo de progreso hacia tu objetivo diario, pasos, tiempo activo, km, kcal y ritmo (pasos/min). Pipo cambia de humor y de mensaje según cómo vas.
- **Caminata en directo**: cuenta los pasos con el acelerómetro del móvil, cronometra el tiempo, permite pausar y mantiene la pantalla encendida.
- **Añadir a mano**: apunta pasos y duración de cualquier día (por ejemplo, copiados del contador del móvil o del reloj). Se pueden editar y borrar.
- **Historial**: calendario de calor por mes y lista de días agrupados por semanas, con detalle de cada caminata.
- **Estadísticas** (7 días / 30 días / 3 meses): gráfico de pasos con línea de objetivo, comparación con el periodo anterior, total, tiempo activo, ritmo medio y km/h, mejor día, día de la semana favorito, franja horaria en la que más caminas y récords personales.
- **Logros**: niveles (Paseante → Leyenda) e insignias:
  - Hitos diarios (1k, 5k, 8k, 10k, 15k, 20k): cuentan cuántas veces los consigues.
  - Retos semanales (35k, 50k, 70k, 100k de lunes a domingo).
  - Pasos acumulados (10k → 1M).
  - Rachas (3, 7, 14 y 30 días seguidos cumpliendo el objetivo).
  - Especiales: Primer paso, Madrugador, Noctámbulo, Gran paseo, Finde activo, Doble o nada.
  - **Todos los hitos se pueden ajustar** en Ajustes: añadir o quitar los que quieras.
- **Ajustes**: objetivo diario y semanal, nombre y color de la mascota, zancada y peso (para km y kcal), sensibilidad del sensor, tema claro u oscuro, exportar e importar copia de seguridad y datos de ejemplo.

Los datos se guardan solo en el dispositivo (localStorage). Funciona sin conexión.

## Probarla

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

Para usarla en el móvil hay que servirla por **HTTPS** (el sensor de movimiento lo exige), por ejemplo activando GitHub Pages en el repositorio. Después, desde el navegador: «Añadir a pantalla de inicio».

### Limitaciones del contador

Un navegador solo puede leer el acelerómetro con la app abierta y la pantalla encendida, así que los pasos se cuentan durante las caminatas que inicias. Para los pasos del resto del día, usa «Añadir». Leer automáticamente Apple Salud o Google Health Connect requeriría convertirla en app nativa.

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Estructura y barra de pestañas |
| `styles.css` | Diseño (tema claro y oscuro) |
| `app.js` | Toda la lógica: sensor, datos, vistas, insignias y mascota |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación como app y modo sin conexión |
