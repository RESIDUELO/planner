package app.residenciaplanner;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Dados que o app manda para o widget (ver web/src/local/widget.tsx):
 * { v, exam: {name, date} | null, days: { "AAAA-MM-DD": { s: [{n, a, c, d}], r: [{n, d}] } } }
 * O dia mostrado é sempre o de hoje, pelo relógio do aparelho.
 */
final class WidgetData {
    static final String PREFS = "rp_widget";
    static final String KEY = "data";

    static final String[] WEEKDAYS = {"DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"};
    static final String[] MONTHS = {"jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"};

    static final int HEADER = 0, SUBJECT = 1, REVIEW = 2;

    static final class Row {
        final int type;
        final String text;
        final String area;
        final int color;
        final boolean done;

        Row(int type, String text, String area, int color, boolean done) {
            this.type = type;
            this.text = text;
            this.area = area;
            this.color = color;
            this.done = done;
        }
    }

    final JSONObject json;
    final Calendar today = Calendar.getInstance();

    private WidgetData(JSONObject json) {
        this.json = json;
    }

    static WidgetData load(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject j = null;
        try {
            String raw = p.getString(KEY, null);
            if (raw != null) j = new JSONObject(raw);
        } catch (Exception ignored) {
            // dados inválidos: o widget pede para abrir o app
        }
        return new WidgetData(j);
    }

    static String iso(Calendar c) {
        return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    String weekday() {
        return WEEKDAYS[today.get(Calendar.DAY_OF_WEEK) - 1];
    }

    String day() {
        return String.valueOf(today.get(Calendar.DAY_OF_MONTH));
    }

    String month() {
        return MONTHS[today.get(Calendar.MONTH)];
    }

    /** "UNOESTE/HRPP · FALTAM 70 DIAS" */
    String subtitle() {
        JSONObject exam = json == null ? null : json.optJSONObject("exam");
        if (exam == null) return "RESIDÊNCIA PLANNER";
        String name = exam.optString("name", "");
        String date = exam.optString("date", "");
        long left = daysUntil(date);
        String when = left > 1 ? "FALTAM " + left + " DIAS" : left == 1 ? "A PROVA É AMANHÃ" : left == 0 ? "A PROVA É HOJE" : "PROVA REALIZADA";
        return (name.isEmpty() ? "" : name.toUpperCase(new Locale("pt", "BR")) + " · ") + when;
    }

    private long daysUntil(String isoDate) {
        try {
            String[] p = isoDate.split("-");
            Calendar exam = Calendar.getInstance();
            exam.clear();
            exam.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]));
            Calendar t = Calendar.getInstance();
            t.clear();
            t.set(today.get(Calendar.YEAR), today.get(Calendar.MONTH), today.get(Calendar.DAY_OF_MONTH));
            return Math.round((exam.getTimeInMillis() - t.getTimeInMillis()) / 86_400_000.0);
        } catch (Exception e) {
            return -1;
        }
    }

    /** Linhas da lista de hoje. Vazia quando não há planner ou os dados estão velhos demais. */
    List<Row> rows() {
        List<Row> out = new ArrayList<>();
        if (json == null) return out;
        JSONObject days = json.optJSONObject("days");
        JSONObject d = days == null ? null : days.optJSONObject(iso(today));
        if (d == null) return out;
        JSONArray s = d.optJSONArray("s");
        JSONArray r = d.optJSONArray("r");
        out.add(new Row(HEADER, "ASSUNTOS", "", 0, false));
        if (s == null || s.length() == 0) out.add(new Row(SUBJECT, "Dia livre", "", 0, false));
        else for (int i = 0; i < s.length(); i++) {
            JSONObject o = s.optJSONObject(i);
            out.add(new Row(SUBJECT, o.optString("n"), o.optString("a"), parseColor(o.optString("c")), o.optBoolean("d")));
        }
        if (r != null && r.length() > 0) {
            out.add(new Row(HEADER, "REVISÕES", "", 0, false));
            for (int i = 0; i < r.length(); i++) {
                JSONObject o = r.optJSONObject(i);
                out.add(new Row(REVIEW, o.optString("n"), "", 0, o.optBoolean("d")));
            }
        }
        return out;
    }

    String emptyMessage() {
        if (json == null) return "Abra o app para montar seu planner.";
        if (json.optJSONObject("exam") == null) return "Abra o app para montar seu planner.";
        return "Abra o app para atualizar o planner.";
    }

    private static int parseColor(String hex) {
        try {
            return android.graphics.Color.parseColor(hex);
        } catch (Exception e) {
            return 0xFFA29C92;
        }
    }
}
