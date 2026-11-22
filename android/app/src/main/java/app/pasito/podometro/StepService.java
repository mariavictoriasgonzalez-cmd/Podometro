package app.pasito.podometro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import java.text.NumberFormat;
import java.util.Locale;

/**
 * Servicio en primer plano que escucha el contador de pasos por hardware del móvil
 * (Sensor.TYPE_STEP_COUNTER). Ese sensor consume muy poca batería y entrega los pasos por lotes.
 */
public class StepService extends Service implements SensorEventListener {
    static final String CHANNEL = "pasos";
    static final int NOTIF_ID = 42;
    static final String PREFS = "pasito";
    static volatile StepService running;

    private SensorManager sm;
    private Sensor sensor;
    private SharedPreferences prefs;
    private long lastNotifMinute = -1;

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, StepService.class);
        ContextCompat.startForegroundService(ctx, i);
    }

    public static boolean hasSensor(Context ctx) {
        SensorManager sm = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        return sm != null && sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH : 0;
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(), type);
        } catch (Exception e) {
            // Sin permiso todavía: no podemos funcionar en segundo plano.
            stopSelf();
            return START_NOT_STICKY;
        }
        if (sm == null) {
            sm = (SensorManager) getSystemService(SENSOR_SERVICE);
            sensor = sm != null ? sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) : null;
            if (sensor == null) { stopSelf(); return START_NOT_STICKY; }
            // Lotes de hasta 1 minuto: ahorra batería sin perder resolución por minuto.
            sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL, 60_000_000);
        }
        running = this;
        return START_STICKY;
    }

    /** Pide al sensor que entregue ya los pasos pendientes del lote. */
    public void flush() {
        if (sm != null) sm.flush(this);
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        float value = e.values[0];
        long bootAt = System.currentTimeMillis() - SystemClock.elapsedRealtime();
        long savedBoot = prefs.getLong("bootAt", 0);
        float last = prefs.getFloat("last", -1f);
        boolean rebooted = Math.abs(bootAt - savedBoot) > 60_000;
        int delta;
        if (last < 0) delta = 0;                         // primera lectura: solo fijamos la referencia
        else if (rebooted || value < last) delta = (int) value; // el contador se reinicia al reiniciar el móvil
        else delta = (int) (value - last);
        prefs.edit().putFloat("last", value).putLong("bootAt", bootAt).apply();
        if (delta <= 0 || delta > 100_000) return;

        long wall = System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - e.timestamp) / 1_000_000L;
        long minute = wall / 60_000L;
        StepStore.get(this).add(minute, delta);

        long nowMin = System.currentTimeMillis() / 60_000L;
        if (nowMin != lastNotifMinute) {
            lastNotifMinute = nowMin;
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification());
        }
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Contador de pasos", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Muestra tus pasos de hoy mientras Pasito cuenta en segundo plano");
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    Notification buildNotification() {
        long steps = StepStore.get(this).today();
        int goal = prefs.getInt("goal", 8000);
        String n = NumberFormat.getIntegerInstance(new Locale("es", "ES")).format(steps);
        int pct = goal > 0 ? (int) Math.min(999, steps * 100 / goal) : 0;
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_steps)
                .setContentTitle(n + " pasos hoy")
                .setContentText(steps >= goal ? "¡Objetivo cumplido! 🎉" : pct + "% de tu objetivo")
                .setProgress(100, Math.min(100, pct), false)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setContentIntent(pi)
                .build();
    }

    @Override
    public void onDestroy() {
        if (sm != null) sm.unregisterListener(this);
        running = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
