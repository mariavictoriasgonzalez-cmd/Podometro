# 👟 Pasito · Podómetro

App de Android que cuenta tus pasos sola, en segundo plano, sin pulsar nada. Guarda el historial y las estadísticas, y tiene una mascota (a elegir entre seis) que te anima. Tus hitos te dan insignias.

## Qué hace

- **Cuenta los pasos en segundo plano.** Usa el contador de pasos que lleva el propio móvil, que gasta muy poca batería. Funciona con la app cerrada y vuelve a arrancar sola si reinicias el teléfono. Una notificación discreta muestra los pasos de hoy.
- **Tiempo caminando y caminatas automáticas.** Los pasos se guardan minuto a minuto. Un minuto con 15 pasos o más cuenta como "caminando". Si caminas 5 minutos seguidos o más, aparece una caminata con su hora, duración y ritmo. No hay cronómetro que pulsar.
- **Hoy:** anillo de progreso, pasos, tiempo caminando, km, kcal y ritmo; gráfico hora a hora; semana, racha, total y próxima insignia.
- **Historial:** calendario de calor por mes y lista de días agrupados por semanas.
- **Estadísticas** (7 días, 30 días o 3 meses): pasos por día con la línea del objetivo, comparación con el periodo anterior, día favorito de la semana, franja horaria y récords.
- **Logros:** niveles e insignias por hitos diarios, retos semanales, pasos acumulados, rachas y logros especiales. **Todos los hitos se pueden ajustar.**
- **Mascotas:** Pipo, Misi (gata), Toby (perro), Copo (pingüino), Rex (dino) y Luna (unicornio). Se les puede cambiar el nombre y el color. Cambian de humor según tu día: duermen, te saludan, caminan contigo y celebran tus objetivos.
- **Color de fondo** a elegir (crema, cielo, menta, lavanda, rosa, limón o nube), con su versión para el tema oscuro.
- **Añadir pasos a mano** para corregir o completar un día.

Los datos se guardan solo en el móvil. En Ajustes se puede exportar e importar una copia de seguridad.

## Instalar en Android

1. Copia `Pasito.apk` al móvil y ábrelo. Android pedirá permiso para instalar apps de origen desconocido.
2. Al abrir Pasito, acepta el permiso de **actividad física** y el de notificaciones.
3. Recomendado: en Ajustes de Pasito, pulsa **Quitar restricción de batería**. Algunos móviles (Xiaomi, Huawei, Samsung…) cierran las apps en segundo plano. En ese caso, busca también "Inicio automático" o "Apps sin restricciones" en los ajustes del teléfono.

El contador empieza a contar desde que lo activas. Los pasos anteriores a instalar la app no se pueden recuperar.

## Compilar

Hace falta Node 20 o más, JDK 21 y el Android SDK (plataforma 36).

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

Para firmar la versión release, crea `android/keystore.properties`. Ninguno de estos ficheros se sube al repositorio:

```
storeFile=../pasito-release.jks
storePassword=…
keyAlias=pasito
keyPassword=…
```

**Guarda bien el `.jks` y su contraseña.** Android solo deja actualizar la app si la nueva versión está firmada con la misma clave. Sin ella habría que desinstalar, y se perderían los datos (exporta antes una copia).

Para probar la interfaz en el navegador, sin contador automático: `npm run serve` y abre http://localhost:8000.

## Estructura

| Ruta | Qué es |
|---|---|
| `www/` | La app: `index.html`, `styles.css` y `app.js` (vistas, insignias, mascotas, estadísticas) |
| `android/app/src/main/java/app/pasito/podometro/StepService.java` | Servicio en segundo plano que lee el contador de pasos del móvil |
| `…/StepStore.java` | Base de datos de pasos por minuto |
| `…/PasosPlugin.java` | Puente entre la app y el contador (permisos, sincronización, batería) |
| `…/BootReceiver.java` | Vuelve a arrancar el contador al encender el móvil |
