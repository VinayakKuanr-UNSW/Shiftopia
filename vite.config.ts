import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { componentTagger } from 'lovable-tagger';
import { visualizer } from 'rollup-plugin-visualizer';
import viteCompression from 'vite-plugin-compression';
import webfontDl from 'vite-plugin-webfont-dl';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  // The Capacitor WebView serves the built assets from a local file origin, so
  // absolute `/assets/...` URLs resolve against the device root and 404. Only
  // the android build needs relative paths; the web deploy keeps `/`.
  base: mode === 'android' ? './' : '/',
  // `cap sync` copies the production bundle into
  // android/app/src/main/assets/public/, which puts a second index.html and a
  // full set of built assets inside the project root. Vite's dependency
  // scanner crawls every html it finds, so it walked into that copy, failed to
  // resolve a transitive dep of the *bundled* output (@emotion/is-prop-valid),
  // and gave up on pre-bundling entirely — then re-optimized and force-reloaded
  // the page, which reads as "[vite] server connection lost".
  //
  // Pin the scan to the real entry point, and keep the file watcher out of
  // android/ and dist/ so a sync or a build does not churn HMR.
  server: {
    host: '::',
    port: 8080,
    hmr: {
      overlay: false,
    },
    watch: {
      ignored: ['**/android/**', '**/dist/**', '**/dist-web/**'],
    },
  },
  plugins: [
    react(),
    mode === 'development' && componentTagger(),
    // PWA is web-only. The android build ships inside a Capacitor native shell
    // that already serves local assets, so a service worker there would cache
    // a second copy of the app and fight the shell over updates.
    mode !== 'android' && VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        name: 'Shiftopia — Workforce Scheduling',
        short_name: 'Shiftopia',
        description:
          'AI-powered workforce scheduling, shift bidding, swaps, and compliance management.',
        theme_color: '#5048E5',
        background_color: '#0F172A',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // The main bundle exceeds the 2 MB default; raise so it is precached.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // SPA: serve the cached shell for client-side routes when offline.
        navigateFallback: 'index.html',
      },
    }),
    mode !== 'production' && visualizer({
      filename: './dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
    // Pre-compressed twins are for an HTTP server doing content negotiation.
    // The Capacitor WebView reads assets straight off local disk, so they are
    // dead weight in the APK — and worse, Android's packager strips the .gz
    // suffix and then sees `foo.js` and `foo.js.gz` as the same resource,
    // failing the build with "Duplicate resources".
    mode !== 'android' && viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
    }),
    mode !== 'android' && viteCompression({
      algorithm: 'brotliCompress',
      ext: '.br',
    }),
    webfontDl(),
    // Source-map upload runs only when SENTRY_AUTH_TOKEN is present (i.e. in CI
    // for prod builds). Local prod builds without the token still produce
    // source maps but skip the upload, so they never fail the build.
    mode === 'production' && process.env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      release: { name: process.env.VITE_SENTRY_RELEASE },
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@modules': path.resolve(__dirname, './src/modules'),
      '@platform': path.resolve(__dirname, './src/platform'),
      '@design-system': path.resolve(__dirname, './src/design-system'),
    },
  },
  optimizeDeps: {
    include: ['framer-motion', 'lucide-react', '@radix-ui/react-dialog', 'dompurify'],
    // Pin the scan to the real entry point. `cap sync` copies the production
    // bundle to android/app/src/main/assets/public/ and Gradle copies it again
    // to android/app/build/intermediates/, so otherwise the scanner has two
    // extra index.html files to find.
    //
    // NOTE: this alone does NOT fix the scan (verified — neither do
    // `!android/**` negations, nor optimizeDeps.exclude). What actually fixes
    // it is having @emotion/is-prop-valid installed: it is a declared OPTIONAL
    // peer of framer-motion that appears in the *built* output, and a single
    // unresolvable import anywhere the scanner reaches aborts the whole scan.
    //
    // Symptom when it breaks: "Failed to run dependency scan. Skipping
    // dependency pre-bundling", then a mid-session re-optimize and forced
    // reload — which surfaces in the browser as "[vite] server connection
    // lost" plus a failed lazy route chunk.
    entries: ['index.html'],
  },
  ...(mode === 'production' && {
    esbuild: {
      drop: ['console', 'debugger'],
    },
  }),
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-data': ['@tanstack/react-query', 'zustand'],
          'vendor-dnd': ['react-dnd', 'react-dnd-html5-backend'],
          'vendor-ui': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
          ],
          'vendor-charts': ['recharts'],
          'vendor-animations': ['framer-motion'],
          'vendor-utils': ['date-fns', 'lucide-react', 'clsx', 'tailwind-merge'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
