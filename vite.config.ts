import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Porta de HMR distinta das usadas pelo portal B2B (24678) e pelo admin B2B (24679) e pelo comprasWeb (24680),
      // para que os projetos possam rodar ao mesmo tempo.
      hmr: process.env.DISABLE_HMR === 'true' ? false : { port: 24681 },
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
