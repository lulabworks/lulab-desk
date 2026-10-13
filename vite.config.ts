import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const githubPagesBase = '/lulab-desk/'

export default defineConfig({
  base: githubPagesBase,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('date-fns')) return 'dates'
          if (id.includes('react')) return 'react'
          return 'vendor'
        }
      }
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'brand/logo-lulab.png',
        'icons/favicon-16x16.png',
        'icons/favicon-32x32.png',
        'icons/icon-64x64.png',
        'icons/apple-touch-icon.png',
        'icons/pwa-192x192.png',
        'icons/pwa-512x512.png',
        'icons/maskable-512x512.png'
      ],
      manifest: {
        name: 'LuLab Desk',
        short_name: 'LuLab',
        description: 'Gestionale semplice per il laboratorio LuLab',
        theme_color: '#1f4938',
        background_color: '#f4f1ea',
        display: 'standalone',
        start_url: githubPagesBase,
        scope: githubPagesBase,
        lang: 'it',
        icons: [
          { src: `${githubPagesBase}icons/pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${githubPagesBase}icons/pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${githubPagesBase}icons/maskable-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: `${githubPagesBase}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,woff2}']
      }
    })
  ]
})
