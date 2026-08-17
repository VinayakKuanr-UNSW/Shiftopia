import 'dotenv/config';
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Live reload.
 *
 * By default the WebView loads the built assets copied into
 * android/app/src/main/assets/public/, so every web change needs a rebuild, a
 * reinstall and a cold start. Setting CAP_SERVER_URL points the WebView at the
 * Vite dev server instead, and web changes appear immediately.
 *
 * Put the URL in .env (gitignored), then sync once:
 *
 *   CAP_SERVER_URL=http://10.0.2.2:8080      # emulator -> host machine localhost
 *   CAP_SERVER_URL=http://192.168.1.23:8080  # physical device -> your LAN IP
 *
 *   npm run dev                 # leave running
 *   npm run android:sync:live   # once, after changing the URL
 *   # then press Run in Android Studio
 *
 * Native code and plugin changes still need a rebuild — only web assets reload.
 *
 * Remove the variable and sync again before building anything you distribute,
 * or the app will try to reach a dev machine that is not there. The variable is
 * unset by default, so a normal checkout always produces a self-contained build.
 */
const devServerUrl = process.env.CAP_SERVER_URL?.trim();

/**
 * Mixed content.
 *
 * The WebView serves the app from https://localhost (Capacitor's default
 * androidScheme), so a fetch to a plain-http local service — the OR-Tools
 * optimizer on http://10.0.2.2:5005, the ML service on :8000 — is mixed
 * content and Chromium drops it before the request leaves the device. That
 * surfaces as a bare "Failed to fetch": nothing in logcat, nothing in the
 * service's log, and the TCP port testing as reachable the whole time.
 *
 * Enabling this is preferable to switching androidScheme to http, which would
 * change the app's origin and so discard everything already in localStorage,
 * including the signed-in session.
 *
 * Capacitor's own documentation says this is not for production, hence the
 * explicit opt-in: unset by default, so a plain checkout and any build we
 * distribute keep mixed content blocked.
 *
 *   CAP_ALLOW_MIXED_CONTENT=true    # in .env, alongside CAP_SERVER_URL
 */
const allowMixedContent = process.env.CAP_ALLOW_MIXED_CONTENT?.trim() === 'true';

const config: CapacitorConfig = {
  appId: 'com.shiftopia.app',
  appName: 'Shiftopia',
  webDir: 'dist',
  plugins: {
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#00000000',
    },
    LocalNotifications: {
      iconColor: '#4F46E5',
    },
  },
  // cleartext is needed because the dev server is plain http, which Android has
  // blocked by default since API 28. It applies only when a dev URL is set.
  ...(devServerUrl ? { server: { url: devServerUrl, cleartext: true } } : {}),
  ...(allowMixedContent ? { android: { allowMixedContent: true } } : {}),
};

export default config;
