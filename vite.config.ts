import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_'],
  build: mode === 'vscode' ? { target: 'es2022', outDir: 'vscode/media', emptyOutDir: true, cssCodeSplit: false, rollupOptions: { output: { entryFileNames: 'assets/index.js', assetFileNames: 'assets/index.[ext]' } } } : { target: 'es2022' }
}));
