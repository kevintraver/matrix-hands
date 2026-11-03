import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production builds may only talk to their own origin. MediaPipe ships a usage logger that posts to
 * Google every minute; this policy blocks it, so the camera feed and anything derived from it stay
 * on the device. Dev builds skip it because the React preamble is an inline script.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
].join('; ');

const contentSecurityPolicy = (): Plugin => ({
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  // A module worker, so MediaPipe loads its ES-module wasm loader with import().
  worker: { format: 'es' },
});
