/**
 * Webxdc (and file://) open real files like /index.html.
 * SvelteKit routes are / — without this rewrite the client shows 404.
 *
 * @type {import('@sveltejs/kit').Reroute}
 */
export function reroute({ url }) {
	let path = url.pathname;

	// /index.html → /   |   /foo/index.html → /foo/
	if (path === '/index.html' || path.endsWith('/index.html')) {
		path = path.slice(0, -'index.html'.length);
		if (!path || path === '') path = '/';
	} else if (path.endsWith('.html')) {
		path = path.slice(0, -'.html'.length);
		if (!path) path = '/';
	}

	// Some hosts serve the entry under a trailing-slash path
	if (path.length > 1 && path.endsWith('/')) {
		path = path.slice(0, -1);
	}

	return path;
}
