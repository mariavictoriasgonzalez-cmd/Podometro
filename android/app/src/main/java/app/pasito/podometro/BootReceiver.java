package app.pasito.podometro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Vuelve a arrancar el contador al encender el móvil o al actualizar la app. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) return;
        if (!ctx.getSharedPreferences(StepService.PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false)) return;
        if (!PasosPlugin.hasActivityPermission(ctx)) return;
        try { StepService.start(ctx); } catch (Exception ignored) { }
    }
}
