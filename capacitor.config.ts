import type { CapacitorConfig } from '@capacitor/cli';

/** App Android off-line (build: npm run android:sync). */
const config: CapacitorConfig = {
  appId: 'app.residenciaplanner',
  appName: 'Residência Planner',
  webDir: 'dist-app',
  android: { backgroundColor: '#f1eee8' },
};

export default config;
