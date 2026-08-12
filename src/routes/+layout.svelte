<script lang="ts">
	import { assets } from '$app/paths'
	import '../app.css'

	let { children } = $props()
</script>

<svelte:head>
	<title>Termina — آموزش ترمینال لینوکس</title>
	<meta
		name="description"
		content="آموزش تعاملی ترمینال لینوکس به فارسی با FakeShell و xterm.js"
	/>
	<meta name="theme-color" content="#14532d" media="(prefers-color-scheme: dark)" />
	<meta name="theme-color" content="#166534" media="(prefers-color-scheme: light)" />
	<meta name="application-name" content="Termina" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Termina" />
	<link rel="canonical" href="https://github.com/sadraiiali/termina" />
	<meta property="og:url" content="https://github.com/sadraiiali/termina" />
	<meta
		property="og:description"
		content="Termina by sadraiiali — interactive Linux terminal lab. Course content from AsaEdgerunner/linux-terminal-mastery"
	/>

	<link rel="icon" href="{assets}/favicon.svg" type="image/svg+xml" />
	<link rel="icon" href="{assets}/favicon.ico" sizes="any" />
	<link rel="icon" href="{assets}/favicon-32.png" type="image/png" sizes="32x32" />
	<link rel="icon" href="{assets}/favicon-16.png" type="image/png" sizes="16x16" />
	<link rel="apple-touch-icon" href="{assets}/apple-touch-icon.png" sizes="180x180" />
	<link rel="manifest" href="{assets}/site.webmanifest" />
</svelte:head>

{@render children()}
