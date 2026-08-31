import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const root = process.cwd();
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.join(root, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['./tests/**/*.test.tsx'],
    globals: true,
  },
});
