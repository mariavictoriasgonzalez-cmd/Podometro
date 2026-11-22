package app.pasito.podometro;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/** Guarda los pasos en "cubos" de un minuto (minuto desde epoch -> pasos). */
public class StepStore extends SQLiteOpenHelper {
    private static StepStore instance;

    public static synchronized StepStore get(Context ctx) {
        if (instance == null) instance = new StepStore(ctx.getApplicationContext());
        return instance;
    }

    private StepStore(Context ctx) { super(ctx, "pasos.db", null, 1); }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE buckets (minute INTEGER PRIMARY KEY, steps INTEGER NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldV, int newV) { }

    public synchronized void add(long minute, int steps) {
        if (steps <= 0) return;
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("INSERT INTO buckets(minute, steps) VALUES(?, ?) ON CONFLICT(minute) DO UPDATE SET steps = steps + excluded.steps",
                new Object[]{minute, steps});
    }

    public synchronized List<long[]> since(long minute) {
        List<long[]> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT minute, steps FROM buckets WHERE minute >= ? ORDER BY minute", new String[]{String.valueOf(minute)})) {
            while (c.moveToNext()) out.add(new long[]{c.getLong(0), c.getLong(1)});
        }
        return out;
    }

    public synchronized long today() {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0);
        long from = cal.getTimeInMillis() / 60000L;
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT COALESCE(SUM(steps), 0) FROM buckets WHERE minute >= ?", new String[]{String.valueOf(from)})) {
            return c.moveToFirst() ? c.getLong(0) : 0;
        }
    }
}
