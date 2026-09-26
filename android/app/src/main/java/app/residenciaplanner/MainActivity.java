package app.residenciaplanner;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin local do widget "Hoje" (precisa ser registrado antes do super.onCreate)
        registerPlugin(TodayWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
