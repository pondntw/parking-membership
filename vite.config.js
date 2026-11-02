import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // PGlite locates its .wasm and .data files relative to its own module.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
});
