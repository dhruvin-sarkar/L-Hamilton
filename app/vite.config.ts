import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { join, extname } from 'node:path';

// `import.meta.url` rather than `__dirname`: this package is ESM ("type":
// "module"), where __dirname does not exist and would be undefined at runtime.
const here = fileURLToPath(new URL('.', import.meta.url));
const referenceAssets = fileURLToPath(new URL('../public', import.meta.url));

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.wasm': 'application/wasm',
  '.riv': 'application/octet-stream',
  '.json': 'application/json',
};

/**
 * Dev-only fallback to the reference build's assets.
 *
 * Our own assets in app/public are authoritative and always win. This only
 * catches what they do not cover yet — the WebGL scene needs textures and
 * models to render before every Hamilton equivalent exists, and the reference
 * next door has them.
 *
 * Nothing served through here should reach production: everything in the
 * reference is upstream copyrighted material. Once app/public is complete this
 * plugin can be deleted and nothing should break.
 */
function referenceAssetFallback(): Plugin {
  return {
    name: 'reference-asset-fallback',
    apply: 'serve',
    configureServer(server) {
      if (!existsSync(referenceAssets)) return;
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url || !url.startsWith('/assets/')) return next();

        const file = join(referenceAssets, decodeURIComponent(url));
        // Keep the lookup inside the reference tree.
        if (!file.startsWith(referenceAssets)) return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();

        // MIME matters here: .wasm served as anything else makes
        // WebAssembly.instantiateStreaming reject the Basis/Draco decoders.
        res.setHeader(
          'Content-Type',
          MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        );
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [referenceAssetFallback()],
  server: { port: 5173, open: false },
  build: { outDir: 'dist', emptyOutDir: true },
});
