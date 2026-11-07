import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true lets a phone on the same Wi-Fi open the dev server.
  server: { host: true },
})
