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
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: [
        'brand/lulab-desk-monogram-v2.png',
        'icons/favicon-16x16-v2.png',
        'icons/favicon-32x32-v2.png',
        'icons/icon-64x64-v2.png',
        'icons/apple-touch-icon-v2.png',
        'icons/pwa-192x192-v2.png',
        'icons/pwa-512x512-v2.png',
        'icons/maskable-512x512-v2.png'
      ],
      manifest: {
        name: 'LuLab Desk',
        short_name: 'LuLab',
        description: 'Gestionale semplice per il laboratorio LuLab',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: githubPagesBase,
        scope: githubPagesBase,
        lang: 'it',
        icons: [
          { src: `${githubPagesBase}icons/pwa-192x192-v2.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${githubPagesBase}icons/pwa-512x512-v2.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${githubPagesBase}icons/maskable-512x512-v2.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,png}']
      }
    })
  ]
})
