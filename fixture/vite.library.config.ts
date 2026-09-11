import {defineConfig} from 'vite';
export default defineConfig({
  build:{
    outDir:'lib',
    lib:{entry:'src/annotations/index.ts',formats:['es'],fileName:'index',cssFileName:'annotations'},
    rollupOptions:{external:['react','react-dom','react/jsx-runtime','@floating-ui/react']}
  }
});
