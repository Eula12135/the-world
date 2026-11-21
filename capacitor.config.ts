import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.theworld.app',
  appName: 'The World',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    adjustMarginsForEdgeToEdge: 'disable',
  },
};

export default config;
