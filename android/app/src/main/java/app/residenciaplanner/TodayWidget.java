package app.residenciaplanner;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

import java.util.Calendar;

/** Widget "Hoje": assuntos e revisões do dia. Só leitura; tocar abre o app. */
public class TodayWidget extends AppWidgetProvider {
    static final String ACTION_NEW_DAY = "app.residenciaplanner.WIDGET_NEW_DAY";

    /** Chamado quando o app manda dados novos. */
    static void refreshAll(Context ctx) {
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, TodayWidget.class));
        if (ids.length == 0) return;
        for (int id : ids) render(ctx, m, id);
        m.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        scheduleNewDay(ctx);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) render(ctx, m, id);
        m.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        scheduleNewDay(ctx);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        String a = intent.getAction();
        if (ACTION_NEW_DAY.equals(a) || Intent.ACTION_TIME_CHANGED.equals(a) || Intent.ACTION_TIMEZONE_CHANGED.equals(a)) refreshAll(ctx);
    }

    private static void render(Context ctx, AppWidgetManager m, int id) {
        WidgetData d = WidgetData.load(ctx);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_today);
        v.setTextViewText(R.id.widget_weekday, d.weekday());
        v.setTextViewText(R.id.widget_day, d.day());
        v.setTextViewText(R.id.widget_month, d.month());
        v.setTextViewText(R.id.widget_subtitle, d.subtitle());
        v.setTextViewText(R.id.widget_empty, d.emptyMessage());

        Intent svc = new Intent(ctx, TodayWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.widget_list, svc);
        v.setEmptyView(R.id.widget_list, R.id.widget_empty);

        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, false));
        v.setPendingIntentTemplate(R.id.widget_list, openApp(ctx, true));
        m.updateAppWidget(id, v);
    }

    private static PendingIntent openApp(Context ctx, boolean template) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        // O modelo da lista recebe um "fill-in" de cada linha, por isso precisa ser mutável
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= template ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE;
        else if (!template && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, template ? 1 : 0, i, flags);
    }

    /** Vira o dia à meia-noite, mesmo sem abrir o app (alarme inexato, sem permissão especial). */
    private static void scheduleNewDay(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar c = Calendar.getInstance();
        c.add(Calendar.DAY_OF_MONTH, 1);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 30);
        c.set(Calendar.MILLISECOND, 0);
        Intent i = new Intent(ctx, TodayWidget.class).setAction(ACTION_NEW_DAY);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        am.set(AlarmManager.RTC, c.getTimeInMillis(), PendingIntent.getBroadcast(ctx, 2, i, flags));
    }
}
