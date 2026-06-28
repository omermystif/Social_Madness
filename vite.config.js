import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server:  { port: 5181, strictPort: true },
  preview: { port: 5181, strictPort: true },
  build: {
    target:        'es2020',
    sourcemap:     false,     // do not ship sources to prod
    minify:        'esbuild', // fastest, smallest for this bundle size
    cssCodeSplit:  true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        // Split React core into its own long-lived chunk so app-level updates
        // don't bust the (much larger) React/ReactDOM cache.
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
