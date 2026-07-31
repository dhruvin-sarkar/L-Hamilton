import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// `import.meta.url` rather than `__dirname`: this package is ESM ("type":
// "module"), where __dirname does not exist and would be undefined at runtime.
const here = fileURLToPath(new URL('.', import.meta.url));
const ownAssets = fileURLToPath(new URL('./public', import.meta.url));
const referenceAssets = fileURLToPath(new URL('../public', import.meta.url));

// Assets come from app/public. During local development a reference build sits
// next door and is used instead, which is how the WebGL scene has textures to
// render before our own exist.
//
// The fallback matters: that reference is not in version control, so a fresh
// clone has only app/public. Without this check publicDir would point at a
// missing directory and every asset request would 404 with no obvious cause.
const publicDir = existsSync(referenceAssets) ? referenceAssets : ownAssets;

export default defineConfig({
  root: here,
  publicDir,
  server: { port: 5173, open: false },
  build: { outDir: 'dist', emptyOutDir: true },
});
