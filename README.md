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

- **Cuenta de Google y datos en la nube.** Cada persona entra con su cuenta de Google, tras aceptar el aviso de privacidad. Sus pasos, caminatas, insignias y ajustes se guardan en Supabase (servidores en París) y los recupera en cualquier móvil. La app funciona sin conexión y sube los datos al volver a tenerla. Desde Ajustes → Cuenta se puede cerrar sesión o borrar la cuenta con todos sus datos.
- **Panel de administración.** Las cuentas marcadas como administración ven en Ajustes → Cuenta → **Ver usuarios** a todas las personas: pasos de los últimos 7 días, actividad, insignias y el detalle de 30 días de cada una.

Los pasos se cuentan en el móvil en todo momento, pero se suben a la nube cuando se abre la app.

## Configuración de Google y Supabase

El proyecto de Supabase es `pasito` (`https://gkdjsjlituvfnxosqdnb.supabase.co`). Su esquema está en `supabase/migrations/`. Cada usuario solo puede leer y escribir lo suyo; la administración puede leer todo.

El servidor no se fía de lo que envía el móvil:
- El nombre registrado, el correo y la foto se copian de la cuenta de Google y no se pueden modificar. Aparte, cada persona elige cómo quiere que la app la llame (para el saludo) y lo puede cambiar cuando quiera; en el panel se ven los dos.
- Los totales de cada día los calcula la base de datos a partir de los pasos minuto a minuto. Descarta los datos imposibles: más de 250 pasos en un minuto, registros a mano de más de 50.000 pasos o fechas futuras.
- Los pasos añadidos a mano se guardan aparte (`manual_steps`) y el panel muestra qué parte de los pasos de cada persona son manuales.
- Las insignias solo las concede el servidor (`refresh_badges`), comprobando los datos guardados. Nadie puede escribirlas directamente.

Para que funcione "Continuar con Google" hay que configurar, una sola vez:

1. **Google Cloud Console** → APIs y servicios:
   - En *Pantalla de consentimiento de OAuth*, crea la app de tipo *Externa*. Mientras esté en modo *Prueba*, solo pueden entrar las cuentas que añadas como *usuarios de prueba* (hasta 100). Para que entre cualquiera, pulsa *Publicar app*.
   - En *Credenciales* → *Crear credenciales* → *ID de cliente de OAuth* → tipo *Aplicación web*. En *URI de redirección autorizados* añade `https://gkdjsjlituvfnxosqdnb.supabase.co/auth/v1/callback`. Copia el ID de cliente y el secreto.
2. **Supabase** → proyecto *pasito*:
   - *Authentication* → *Sign In / Providers* → **Google**: actívalo y pega el ID de cliente y el secreto.
   - *Authentication* → *URL Configuration* → *Redirect URLs*: añade `app.pasito.podometro://login` (y la dirección web de la app si la publicas).
3. Para dar acceso de administración a otra cuenta: *SQL Editor* → `insert into public.admin_emails(email) values ('correo@gmail.com');`

Para descargar todos los datos: *Table Editor* → `day_steps` (o `profiles`, `badges`) → *Export to CSV*.

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

**Guarda bien el `.jks` y su contraseña.** Android solo deja actualizar la app si la nueva versión está firmada con la misma clave. Sin ella habría que desinstalar la app; los datos no se pierden porque están en la cuenta de cada usuario.

Para probar la interfaz en el navegador, sin contador automático: `npm run serve` y abre http://localhost:8000. Para iniciar sesión desde ahí, añade `http://localhost:8000/` a las *Redirect URLs* de Supabase.

## Estructura

| Ruta | Qué es |
|---|---|
| `www/` | La app: `index.html`, `styles.css` y `app.js` (vistas, insignias, mascotas, estadísticas, cuenta y nube) |
| `www/vendor/supabase.js` | Cliente de Supabase (copiado de `@supabase/supabase-js`) |
| `supabase/migrations/` | Tablas, reglas de seguridad y funciones de la base de datos |
| `android/app/src/main/java/app/pasito/podometro/StepService.java` | Servicio en segundo plano que lee el contador de pasos del móvil |
| `…/StepStore.java` | Base de datos de pasos por minuto |
| `…/PasosPlugin.java` | Puente entre la app y el contador (permisos, sincronización, batería) |
| `…/BootReceiver.java` | Vuelve a arrancar el contador al encender el móvil |
