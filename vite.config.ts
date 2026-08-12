import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const vendorXterm = path.resolve(root, 'vendor/xterm.js');

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// webxdc apps are static bundles
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: undefined,
				precompress: false,
				strict: true
			}),
			paths: {
				// webxdc runs from a zip-like sandbox; root-absolute asset URLs break.
				relative: true
			},
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					// blob/unsafe-eval: almostnode / WASM-style runtimes
					'script-src': ['self', 'unsafe-inline', 'unsafe-eval', 'blob:'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'font-src': ['self', 'data:'],
					'connect-src': ['self', 'blob:'],
					'worker-src': ['self', 'blob:'],
					'object-src': ['none'],
					'base-uri': ['self']
				}
			},
			prerender: {
				entries: ['*'],
				handleHttpError: 'warn'
			}
		})
	],
	// file:./vendor/xterm.js (or a symlink under node_modules) resolves outside the
	// default allow list — permit the vendored package so dev can serve lib/xterm.js.
	server: {
		fs: {
			allow: [root, vendorXterm]
		},
		// Reference Linux sources under vendor/linux-cmds include recursive symlinks
		// (e.g. systemd test/testdata → testdata). Watching them crashes Vite with ELOOP.
		watch: {
			ignored: [
				'**/vendor/linux-cmds/**',
				'**/vendor/xterm.js/node_modules/**',
				'**/vendor/xterm.js/out/**'
			]
		}
	},
	resolve: {
		alias: {
			// Prefer the local vendored build explicitly
			xterm: vendorXterm,
			'xterm/css/xterm.css': path.join(vendorXterm, 'css/xterm.css')
		}
	},
	optimizeDeps: {
		include: ['xterm', 'xterm-addon-fit']
	}
});
