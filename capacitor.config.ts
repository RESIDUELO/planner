import type { CapacitorConfig } from '@capacitor/cli';

/** App Android off-line (build: npm run android:sync). */
const config: CapacitorConfig = {
  appId: 'app.residenciaplanner',
  appName: 'Residência Planner',
  webDir: 'dist-app',
  android: { backgroundColor: '#f1eee8' },
  // O app não usa viewport-fit=cover: fica sempre entre as barras do sistema
  plugins: { SystemBars: { insetsHandling: 'native' } },
};

export default config;
