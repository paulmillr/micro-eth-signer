#!/usr/bin/env node
// Packs each HTML demo into one self-contained file under examples/dist/:
// dist/explorer.app.html and dist/tx.app.html. The
// importmap is dropped and the page's module script is replaced with its
// esbuild-bundled equivalent (library, built artifacts and node_modules deps
// all inlined), so the output opens from file:// or any static host with no
// checkout, build step or server at the repo root. The RPC endpoint must
// still allow CORS requests from the page's origin (Origin: null for file://).
// Requires built artifacts first: npm run build (in the repo root).
//
// ETH_RPC_URL=http://… bakes that endpoint into the output as the default
// (bare IPv4 gets http:// filled in); ?rpc= still overrides it at runtime.
//
// The output is home-screen friendly: injected meta tags plus a data:-URL
// manifest and icon (nothing leaves the single file) make iOS 'Add to Home
// Screen' open standalone with a proper title and icon. Limits: no offline —
// a service worker can't be inlined — and iOS may ignore the data:-URL icon
// (falls back to a page screenshot). An https page can't call an http RPC
// (mixed content): serve over plain http on a LAN, or put the node behind TLS.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { withScheme } from './explorer/core.js';

const dir = dirname(fileURLToPath(import.meta.url));
const out = join(dir, 'dist');
mkdirSync(out, { recursive: true });
const bakedRpc = process.env.ETH_RPC_URL && withScheme(process.env.ETH_RPC_URL);
// replaces the importmap: read by the module script (via core.js RPC_URL)
// and by tx.html's synchronous rpc-input prefill
const bakedScript = bakedRpc
  ? `\n    <script>globalThis.BUILD_RPC_URL = ${JSON.stringify(bakedRpc)};</script>`
  : '';

const ACCENT = '#2563eb'; // the pages' --accent
const DEMOS = {
  explorer: {
    shortName: 'Explorer',
    // a drawn Ξ: <text> glyphs go through font fallback and render differently
    // (or badly) per device, shapes do not
    art:
      '<rect x="45" y="49" width="90" height="17" fill="#fff"/>' +
      '<rect x="57" y="82" width="66" height="17" fill="#fff"/>' +
      '<rect x="45" y="115" width="90" height="17" fill="#fff"/>',
  },
  tx: {
    shortName: 'Tx',
    art: '<text x="90" y="90" dy=".36em" font-size="72" text-anchor="middle" fill="#fff" font-family="Georgia,serif">Tx</text>',
  },
};
function pwaHead(title, { shortName, art }) {
  const icon = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">` +
      `<rect width="180" height="180" rx="40" fill="${ACCENT}"/>${art}</svg>`
  )}`;
  const manifest = encodeURIComponent(
    JSON.stringify({
      name: title,
      short_name: shortName,
      display: 'standalone',
      theme_color: ACCENT,
      background_color: '#ffffff',
      icons: [{ src: icon, sizes: 'any', type: 'image/svg+xml' }],
    })
  );
  return [
    `<meta name="theme-color" content="${ACCENT}" />`,
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    `<meta name="apple-mobile-web-app-title" content="${shortName}" />`,
    `<link rel="manifest" href="data:application/manifest+json,${manifest}" />`,
    `<link rel="apple-touch-icon" href="${icon}" />`,
  ]
    .map((line) => `\n    ${line}`)
    .join('');
}

for (const name of ['explorer', 'tx']) {
  const html = readFileSync(join(dir, name, 'index.html'), 'utf8');
  const module = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!module) throw new Error(`${name}: module script not found`);
  const bundled = await build({
    stdin: { contents: module[1], resolveDir: join(dir, name), sourcefile: `${name}.js` },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    write: false,
  });
  // a '</script>' inside a JS string literal would close the inline tag early
  const script = bundled.outputFiles[0].text.replaceAll('</script>', '<\\/script>');
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] || name;
  const single = html
    .replace('</title>', () => `</title>${pwaHead(title, DEMOS[name])}`)
    // the serving instructions in the header comment no longer apply
    .replace(
      /Requires built artifacts[\s\S]*?examples\/\w+\/index\.html/,
      'Self-contained build (examples/_build-dist.js): open this file directly'
    )
    .replace(/\n\s*<script type="importmap">[\s\S]*?<\/script>/, () => bakedScript)
    .replace(/<script type="module">[\s\S]*?<\/script>/, () => `<script type="module">${script}</script>`);
  writeFileSync(join(out, `${name}.app.html`), single);
  console.log(
    `dist/${name}.app.html: ${(single.length / 1024).toFixed(0)} KB` +
      (bakedRpc ? ` · default RPC ${bakedRpc}` : '')
  );
}
