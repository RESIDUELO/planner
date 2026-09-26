package app.residenciaplanner;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

/** Monta as linhas da lista rolável do widget "Hoje". */
public class TodayWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context ctx;
        private List<WidgetData.Row> rows = new ArrayList<>();

        Factory(Context ctx) {
            this.ctx = ctx;
        }

        @Override public void onCreate() { }

        @Override
        public void onDataSetChanged() {
            rows = WidgetData.load(ctx).rows();
        }

        @Override public void onDestroy() { rows.clear(); }

        @Override public int getCount() { return rows.size(); }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_row);
            if (position >= rows.size()) return v;
            WidgetData.Row r = rows.get(position);
            boolean header = r.type == WidgetData.HEADER;
            v.setViewVisibility(R.id.row_header, header ? View.VISIBLE : View.GONE);
            v.setViewVisibility(R.id.row_item, header ? View.GONE : View.VISIBLE);
            if (header) {
                v.setTextViewText(R.id.row_header, r.text);
            } else {
                boolean subject = r.type == WidgetData.SUBJECT && r.color != 0;
                v.setViewVisibility(R.id.row_dot, subject ? View.VISIBLE : View.INVISIBLE);
                if (subject) v.setInt(R.id.row_dot, "setColorFilter", r.color);
                v.setViewVisibility(R.id.row_area, r.area.isEmpty() ? View.GONE : View.VISIBLE);
                v.setTextViewText(R.id.row_area, r.area);
                v.setTextViewText(R.id.row_name, r.text);
                int ink = ctx.getResources().getColor(r.done || r.color == 0 && r.type == WidgetData.SUBJECT ? R.color.rp_ink3 : R.color.rp_ink, null);
                v.setTextColor(R.id.row_name, ink);
                v.setViewVisibility(R.id.row_check, r.done ? View.VISIBLE : View.GONE);
            }
            // Tocar em qualquer linha abre o app (usa o modelo definido no TodayWidget)
            v.setOnClickFillInIntent(R.id.row_root, new Intent());
            return v;
        }

        @Override public RemoteViews getLoadingView() { return null; }

        @Override public int getViewTypeCount() { return 1; }

        @Override public long getItemId(int position) { return position; }

        @Override public boolean hasStableIds() { return false; }
    }
}
