package app.residenciaplanner;

import android.content.Context;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ponte app → widget: guarda os próximos dias e redesenha o widget. */
@CapacitorPlugin(name = "TodayWidget")
public class TodayWidgetPlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Sem dados para o widget.");
            return;
        }
        Context ctx = getContext();
        ctx.getSharedPreferences(WidgetData.PREFS, Context.MODE_PRIVATE).edit().putString(WidgetData.KEY, data).apply();
        TodayWidget.refreshAll(ctx);
        call.resolve();
    }
}
