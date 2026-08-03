import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins:[react()],
  base:'/poio/web/',
  build:{outDir:'dist',emptyOutDir:true},
  server:{port:5174,strictPort:true},
});
