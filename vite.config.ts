import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// BASE_PATH is a build-time path, never a secret. See docs/deployment.md.
const base = process.env.BASE_PATH || '/'

/**
 * GitHub Pages cannot send custom response headers, so the policy travels in the
 * document. Applied to the built HTML only — the dev server needs a websocket
 * and inline module preamble that production must not allow.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // Vite emits a stylesheet, but React sets `style` attributes for progress bars.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  // `frame-ancestors` is ignored in a meta policy, so it is deliberately absent
  // rather than present and misleading. GitHub Pages cannot send headers; see
  // docs/privacy-and-threat-model.md.
].join('; ')

function cspMetaOnBuild(): Plugin {
  return {
    name: 'habit-quota:csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  base,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/dexie')) return 'dexie'
          if (id.includes('node_modules/zod')) return 'zod'
          if (id.includes('node_modules/react-router')) return 'router'
          if (id.includes('node_modules/react')) return 'react'
          return undefined
        },
      },
    },
  },
  worker: { format: 'es' },
  plugins: [
    react(),
    cspMetaOnBuild(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        // Never cache anything cross-origin: the app makes no network calls at runtime.
        runtimeCaching: [],
      },
      manifest: {
        id: base,
        name: 'Habits — local-first habit tracker',
        short_name: 'Habits',
        description:
          'A private, local-first habit tracker. Data stays in this browser and moves only through backup files you create.',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: base,
        scope: base,
        theme_color: '#0e110f',
        background_color: '#0e110f',
        categories: ['productivity', 'health'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'maskable-icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
