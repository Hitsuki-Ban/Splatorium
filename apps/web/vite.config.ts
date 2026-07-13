import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    license: { fileName: '.vite/license.json' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // LAN 内の他 PC からもアクセスできるようにする
    host: true,
    // ローカル開発サーバーは固定ポート 6173 を使用する
    port: 6173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
