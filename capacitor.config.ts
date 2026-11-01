import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.julianlorenzon.stickler",
  appName: "Stickler",
  webDir: "dist",
  backgroundColor: "#161819",
  server: {
    androidScheme: "https",
  },
  android: {
    // Android 15 forces edge-to-edge; keep the WebView clear of the status and navigation bars
    adjustMarginsForEdgeToEdge: "auto",
  },
};

export default config;
