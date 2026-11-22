package app.pasito.podometro;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;

/** Puente entre la web de Pasito y el contador de pasos nativo. */
@CapacitorPlugin(
        name = "Pasos",
        permissions = {
                @Permission(alias = "activity", strings = {Manifest.permission.ACTIVITY_RECOGNITION}),
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        }
)
public class PasosPlugin extends Plugin {

    static boolean hasActivityPermission(Context ctx) {
        return Build.VERSION.SDK_INT < 29
                || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED;
    }

    private String activityState() {
        if (Build.VERSION.SDK_INT < 29) return "granted";
        PermissionState s = getPermissionState("activity");
        return s == null ? "prompt" : s.toString();
    }

    private JSObject statusObj() {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("available", StepService.hasSensor(ctx));
        r.put("permission", activityState());
        r.put("running", StepService.running != null);
        r.put("enabled", ctx.getSharedPreferences(StepService.PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false));
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        r.put("batteryOptimized", pm != null && !pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        return r;
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(statusObj()); }

    /** Pide permisos (si hacen falta) y arranca el contador en segundo plano. */
    @PluginMethod
    public void enable(PluginCall call) {
        List<String> need = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 29 && getPermissionState("activity") != PermissionState.GRANTED) need.add("activity");
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) need.add("notifications");
        if (need.isEmpty()) { startCounting(call); return; }
        requestPermissionForAliases(need.toArray(new String[0]), call, "permsDone");
    }

    @PermissionCallback
    private void permsDone(PluginCall call) {
        if (!hasActivityPermission(getContext())) { call.resolve(statusObj()); return; }
        startCounting(call);
    }

    private void startCounting(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(StepService.PREFS, Context.MODE_PRIVATE).edit().putBoolean("enabled", true).apply();
        try { StepService.start(ctx); } catch (Exception ignored) { }
        new Handler(Looper.getMainLooper()).postDelayed(() -> call.resolve(statusObj()), 500);
    }

    /** Devuelve los cubos de un minuto desde `since` (minuto desde epoch). */
    @PluginMethod
    public void getBuckets(PluginCall call) {
        long since = call.getLong("since", 0L);
        StepService s = StepService.running;
        if (s != null) s.flush();
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            JSArray arr = new JSArray();
            for (long[] b : StepStore.get(getContext()).since(since)) {
                JSArray pair = new JSArray();
                pair.put(b[0]); pair.put(b[1]);
                arr.put(pair);
            }
            JSObject r = new JSObject();
            r.put("buckets", arr);
            r.put("now", System.currentTimeMillis() / 60000L);
            call.resolve(r);
        }, s != null ? 350 : 0);
    }

    @PluginMethod
    public void setGoal(PluginCall call) {
        int goal = call.getInt("goal", 8000);
        getContext().getSharedPreferences(StepService.PREFS, Context.MODE_PRIVATE).edit().putInt("goal", goal).apply();
        call.resolve();
    }

    /** Abre el ajuste para que Android no detenga el contador por ahorro de batería. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
