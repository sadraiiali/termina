<script lang="ts">
	import { onMount } from 'svelte'
	import { CHAPTERS, getChapter } from '$lib/course/catalog'
	import { theme } from '$lib/theme.svelte'
	import ChapterNav from '$lib/components/ChapterNav.svelte'
	import LessonPanel from '$lib/components/LessonPanel.svelte'
	import XtermShell from '$lib/components/XtermShell.svelte'
	import ThemeToggle from '$lib/components/ThemeToggle.svelte'
	import Icon from '$lib/components/Icon.svelte'
	import CommandPalette, { type PaletteItem } from '$lib/components/CommandPalette.svelte'

	const STORAGE_KEY = 'linux-lab-chapter'
	const TERM_W_KEY = 'linux-lab-term-w'
	const TERM_H_KEY = 'linux-lab-term-h'
	const MIN_TERM_W = 260
	const MIN_TERM_H = 140
	const SIDEBAR_W = 280
	const RESIZE_RAIL = 10
	/** Lesson column must stay at least this wide (desktop split) */
	const MIN_MAIN_W = 360
	/** Lesson row must keep at least this much height (stacked) */
	const MIN_MAIN_H = 200
	/** Terminal never claims more than this share of the viewport */
	const MAX_TERM_RATIO_W = 0.5
	const MAX_TERM_RATIO_H = 0.55
	/** In-memory chapter cache — avoids blank/flash on revisit */
	const mdCache = new Map<string, string>()

	function readStoredSize(key: string, fallback: number): number {
		try {
			const v = Number(localStorage.getItem(key))
			if (Number.isFinite(v) && v > 0) return v
		} catch {
			/* ignore */
		}
		return fallback
	}

	let activeId = $state(CHAPTERS[0].id)
	let markdown = $state('')
	/** True only until the first chapter has body text */
	let booting = $state(true)
	/** Soft indicator while fetching a chapter not yet cached */
	let fetching = $state(false)
	let status = $state('…')
	let termOpen = $state(true)
	let inject = $state<{ id: number; cmd: string } | null>(null)
	let injectSeq = 0
	let navOpen = $state(true)
	let loadGen = 0
	let contentEl: HTMLElement | undefined = $state()
	let appEl: HTMLElement | undefined = $state()
	let paletteOpen = $state(false)
	/** Desktop: terminal column width (px) — always clamped to leave room for lesson */
	let termWidth = $state(420)
	/** Tablet: terminal row height (px) */
	let termHeight = $state(300)
	let resizing = $state(false)
	/**
	 * When true, chapter list overlays instead of taking row space.
	 * Used on tablet and when text+terminal split leaves main too narrow.
	 */
	let sidebarOverlay = $state(false)

	const chapter = $derived(getChapter(activeId) ?? CHAPTERS[0])
	const themeLabel = $derived(theme.current === 'dark' ? 'تیره' : 'روشن')

	function clamp(n: number, min: number, max: number): number {
		if (!Number.isFinite(n)) return min
		if (max < min) return min
		return Math.min(max, Math.max(min, n))
	}

	function isStackedLayout(): boolean {
		return typeof window !== 'undefined' && window.matchMedia('(max-width: 1200px)').matches
	}

	function viewportW(): number {
		if (typeof window === 'undefined') return 1280
		return appEl?.clientWidth || window.innerWidth || 1280
	}

	function viewportH(): number {
		if (typeof window === 'undefined') return 800
		return appEl?.clientHeight || window.innerHeight || 800
	}

	/**
	 * Max terminal width that still leaves a usable lesson column.
	 * Always reserves MIN_MAIN_W (+ rail). Sidebar is assumed undocked for the
	 * hard cap so a large terminal cannot overflow the row.
	 */
	function maxTermWidth(): number {
		const w = viewportW()
		const hard = w - MIN_MAIN_W - RESIZE_RAIL
		const ratio = Math.floor(w * MAX_TERM_RATIO_W)
		return Math.max(MIN_TERM_W, Math.min(ratio, hard))
	}

	function maxTermHeight(): number {
		const h = viewportH()
		const hard = h - MIN_MAIN_H
		const ratio = Math.floor(h * MAX_TERM_RATIO_H)
		return Math.max(MIN_TERM_H, Math.min(ratio, hard))
	}

	/**
	 * Keep term size sane so the main pane never collapses to 0
	 * (common after aggressive resize or bad localStorage values).
	 */
	function clampTermSizes(): void {
		if (typeof window === 'undefined') return
		const mw = maxTermWidth()
		const mh = maxTermHeight()
		const nw = clamp(termWidth, MIN_TERM_W, mw)
		const nh = clamp(termHeight, MIN_TERM_H, mh)
		if (nw !== termWidth) termWidth = nw
		if (nh !== termHeight) termHeight = nh
	}

	function persistTermSize(): void {
		try {
			localStorage.setItem(TERM_W_KEY, String(Math.round(termWidth)))
			localStorage.setItem(TERM_H_KEY, String(Math.round(termHeight)))
		} catch {
			/* ignore */
		}
	}

	/** Decide whether the chapter list should overlay (not steal lesson width). */
	function updateSidebarOverlay(): void {
		if (typeof window === 'undefined') return
		const w = viewportW()
		if (w <= 1200) {
			sidebarOverlay = true
			return
		}
		// Side-by-side: would a docked sidebar crush the lesson column?
		const term = termOpen ? termWidth : 0
		const rail = termOpen ? RESIZE_RAIL : 0
		const mainWithSidebar = w - SIDEBAR_W - term - rail
		sidebarOverlay = mainWithSidebar < MIN_MAIN_W
	}

	function refreshLayout(): void {
		// Overlay first (affects available width conceptually), then clamp
		updateSidebarOverlay()
		clampTermSizes()
		// Re-check: clamp may shrink term enough to re-dock sidebar
		updateSidebarOverlay()
	}

	function endResize(): void {
		document.body.classList.remove('term-resizing')
		resizing = false
		persistTermSize()
		refreshLayout()
	}

	function onTermResizePointerDown(e: PointerEvent): void {
		if (!termOpen || e.button !== 0) return
		e.preventDefault()
		e.stopPropagation()

		const el = e.currentTarget as HTMLElement
		try {
			el.setPointerCapture(e.pointerId)
		} catch {
			/* ignore */
		}
		resizing = true
		document.body.classList.add('term-resizing')

		const stacked = isStackedLayout()
		const startX = e.clientX
		const startY = e.clientY
		const startW = termWidth
		const startH = termHeight

		const termEl = appEl?.querySelector('.term-pane') as HTMLElement | null
		const termRect = termEl?.getBoundingClientRect()
		const handleRect = el.getBoundingClientRect()
		const termIsRightOfHandle = termRect
			? termRect.left + termRect.width / 2 > handleRect.left + handleRect.width / 2
			: getComputedStyle(document.documentElement).direction !== 'rtl'

		const onMove = (ev: PointerEvent) => {
			// Recompute caps every move (viewport / overlay can change mid-drag)
			if (stacked) {
				termHeight = clamp(startH + (startY - ev.clientY), MIN_TERM_H, maxTermHeight())
			} else {
				const dx = ev.clientX - startX
				const delta = termIsRightOfHandle ? -dx : dx
				termWidth = clamp(startW + delta, MIN_TERM_W, maxTermWidth())
			}
		}

		const onUp = (ev: Event) => {
			if (ev instanceof PointerEvent) {
				try {
					el.releasePointerCapture(ev.pointerId)
				} catch {
					/* ignore */
				}
			}
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
			window.removeEventListener('pointercancel', onUp)
			window.removeEventListener('blur', onBlur)
			endResize()
		}
		const onBlur = () => onUp(new Event('blur'))

		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		window.addEventListener('pointercancel', onUp)
		window.addEventListener('blur', onBlur)
	}

	// Keep layout healthy when sizes / open state change
	$effect(() => {
		void termWidth
		void termHeight
		void termOpen
		refreshLayout()
	})

	function scrollLessonTop(): void {
		if (contentEl) contentEl.scrollTop = 0
	}

	async function loadChapter(id: string): Promise<void> {
		if (!getChapter(id)) return

		// Update nav/header immediately (no wait for network)
		activeId = id
		try {
			localStorage.setItem(STORAGE_KEY, id)
		} catch {
			/* ignore */
		}

		const cached = mdCache.get(id)
		if (cached !== undefined) {
			markdown = cached
			booting = false
			fetching = false
			scrollLessonTop()
			return
		}

		const gen = ++loadGen
		fetching = true
		try {
			const base = import.meta.env.BASE_URL || './'
			const res = await fetch(`${base}course/fa/${id}/README.md`)
			if (!res.ok) throw new Error(String(res.status))
			const text = await res.text()
			if (gen !== loadGen) return // newer navigation won
			mdCache.set(id, text)
			markdown = text
			scrollLessonTop()
		} catch {
			if (gen !== loadGen) return
			markdown = `# خطا\n\nبارگذاری فصل ممکن نشد.`
		} finally {
			if (gen === loadGen) {
				fetching = false
				booting = false
			}
		}
	}

	function selectChapter(id: string): void {
		if (id === activeId && markdown) return
		void loadChapter(id)
	}

	function runPractice(cmd: string): void {
		injectSeq += 1
		inject = { id: injectSeq, cmd }
		termOpen = true
	}

	function nextChapter(): void {
		const idx = CHAPTERS.findIndex((c) => c.id === activeId)
		if (idx >= 0 && idx < CHAPTERS.length - 1) void loadChapter(CHAPTERS[idx + 1].id)
	}

	function prevChapter(): void {
		const idx = CHAPTERS.findIndex((c) => c.id === activeId)
		if (idx > 0) void loadChapter(CHAPTERS[idx - 1].id)
	}

	function toggleTheme(): void {
		theme.toggle()
	}

	function setThemeDark(): void {
		theme.set('dark')
	}

	function setThemeLight(): void {
		theme.set('light')
	}

	const paletteItems = $derived.by((): PaletteItem[] => {
		const actions: PaletteItem[] = [
			{
				id: 'theme-toggle',
				group: 'ظاهر',
				label: theme.current === 'dark' ? 'تغییر به تم روشن' : 'تغییر به تم تیره',
				hint: 'Theme',
				keywords: 'theme dark light تم روشن تیره',
				run: toggleTheme,
			},
			{
				id: 'theme-dark',
				group: 'ظاهر',
				label: 'تم تیره',
				hint: 'Dark',
				keywords: 'dark تم تیره',
				run: setThemeDark,
			},
			{
				id: 'theme-light',
				group: 'ظاهر',
				label: 'تم روشن',
				hint: 'Light',
				keywords: 'light تم روشن',
				run: setThemeLight,
			},
			{
				id: 'toggle-nav',
				group: 'نمای صفحه',
				label: navOpen ? 'مخفی کردن فهرست' : 'نمایش فهرست',
				hint: 'Sidebar',
				keywords: 'sidebar nav فهرست',
				run: () => {
					navOpen = !navOpen
				},
			},
			{
				id: 'toggle-term',
				group: 'نمای صفحه',
				label: termOpen ? 'مخفی کردن ترمینال' : 'نمایش ترمینال',
				hint: 'Terminal',
				keywords: 'terminal ترمینال',
				run: () => {
					termOpen = !termOpen
				},
			},
			{
				id: 'next-chapter',
				group: 'ناوبری',
				label: 'فصل بعدی',
				hint: 'Next',
				keywords: 'next بعدی',
				run: nextChapter,
			},
			{
				id: 'prev-chapter',
				group: 'ناوبری',
				label: 'فصل قبلی',
				hint: 'Prev',
				keywords: 'prev previous قبلی',
				run: prevChapter,
			},
		]

		const chapters: PaletteItem[] = CHAPTERS.map((ch) => ({
			id: `ch-${ch.id}`,
			group: 'فصل‌ها',
			label: `${String(ch.order).padStart(2, '0')} — ${ch.titleFa}`,
			hint: ch.titleEn,
			keywords: `${ch.titleFa} ${ch.titleEn} ${ch.id}`,
			run: () => selectChapter(ch.id),
		}))

		return [...actions, ...chapters]
	})

	onMount(() => {
		theme.hydrate()
		// Restore sizes then clamp (bad localStorage could zero out the layout)
		termWidth = readStoredSize(TERM_W_KEY, 420)
		termHeight = readStoredSize(TERM_H_KEY, 300)
		refreshLayout()

		let start = CHAPTERS[0].id
		try {
			const saved = localStorage.getItem(STORAGE_KEY)
			if (saved && getChapter(saved)) start = saved
		} catch {
			/* ignore */
		}
		void loadChapter(start)

		const onKey = (e: KeyboardEvent) => {
			// Physical KeyK (layout-independent) + Farsi layout where that key types «ن»
			const isPaletteKey =
				e.code === 'KeyK' || e.key === 'k' || e.key === 'K' || e.key === 'ن'
			const isPalette = (e.ctrlKey || e.metaKey) && isPaletteKey
			if (isPalette) {
				e.preventDefault()
				e.stopPropagation()
				paletteOpen = !paletteOpen
				return
			}
		}
		const onWinResize = () => refreshLayout()
		window.addEventListener('keydown', onKey, true)
		window.addEventListener('resize', onWinResize)
		return () => {
			window.removeEventListener('keydown', onKey, true)
			window.removeEventListener('resize', onWinResize)
			document.body.classList.remove('term-resizing')
		}
	})
</script>

<div
	class="app"
	class:nav-open={navOpen}
	class:nav-collapsed={!navOpen}
	class:term-collapsed={!termOpen}
	class:is-resizing={resizing}
	class:sidebar-overlay={sidebarOverlay}
	bind:this={appEl}
	style={`--term-w: ${Math.round(termWidth)}px; --term-h: ${Math.round(termHeight)}px;`}
>
	<!-- Always mounted: open/close is pure CSS transition via .nav-open -->
	<button
		type="button"
		class="nav-backdrop"
		class:is-open={navOpen}
		aria-label="بستن فهرست"
		tabindex={navOpen ? 0 : -1}
		onclick={() => (navOpen = false)}
	></button>
	<aside class="sidebar" class:is-open={navOpen} aria-hidden={!navOpen}>
		<ChapterNav chapters={CHAPTERS} {activeId} onSelect={selectChapter} />
	</aside>

	<main class="main">
		<header class="topbar">
			<button type="button" class="icon-btn" onclick={() => (navOpen = !navOpen)} title="فهرست" aria-label="فهرست">
				<Icon name="bars-3" size="1.15rem" />
			</button>
			<div class="crumb">
				<span class="muted">درس</span>
				<strong>{chapter.titleFa}</strong>
			</div>
			<div class="actions">
				<button
					type="button"
					class="icon-btn"
					onclick={() => (paletteOpen = true)}
					title="جستجو (Ctrl+K)"
					aria-label="جستجو (Ctrl+K)"
				>
					<Icon name="magnifying-glass" size="1.15rem" />
				</button>
				<ThemeToggle />
				<button type="button" class="ghost" onclick={prevChapter}>قبلی</button>
				<button type="button" class="ghost" onclick={nextChapter}>بعدی</button>
				<button
					type="button"
					class="ghost"
					onclick={() => (termOpen = !termOpen)}
					title="ترمینال"
				>
					{termOpen ? 'مخفی کردن ترمینال' : 'نمایش ترمینال'}
				</button>
			</div>
		</header>

		<section class="content" class:fetching bind:this={contentEl}>
			{#if booting && !markdown}
				<p class="loading">در حال بارگذاری درس…</p>
			{:else}
				<LessonPanel {chapter} {markdown} onRun={runPractice} />
			{/if}
		</section>

		<footer class="status-bar">
			<span>{status}</span>
			<span class="muted">تم: {themeLabel} · Ctrl+K · xterm · FakeShell</span>
		</footer>
	</main>

	<!-- Always in DOM when terminal open: own grid/flex cell (not absolute) -->
	<div
		class="term-resize"
		class:is-hidden={!termOpen}
		role="separator"
		aria-orientation="vertical"
		aria-label="تغییر اندازه ترمینال"
		title="کشیدن برای تغییر اندازه"
		onpointerdown={onTermResizePointerDown}
	>
		<span class="term-resize-grip" aria-hidden="true"></span>
	</div>

	<section class="term-pane" class:hidden={!termOpen}>
		<div class="term-head">
			<span>ترمینال تعاملی</span>
			<span class="muted ltr">user@fakeshell-lab</span>
		</div>
		<div class="term-body">
			<XtermShell onStatus={(t) => (status = t)} {inject} visible={termOpen} />
		</div>
	</section>
</div>

<CommandPalette bind:open={paletteOpen} items={paletteItems} onClose={() => {}} />

<style>
	/*
	 * Flex split (not grid): terminal is flex-basis: var(--term-w) with a hard
	 * max-width; lesson is flex:1 min-width:0. Growing the terminal can never
	 * push the lesson column to 0 or overflow the viewport.
	 */
	.app {
		--sidebar-w: 280px;
		/* --term-w / --term-h set from style attribute (user-resizable, clamped) */
		--resize-rail: 10px;
		--main-min: 360px;
		box-sizing: border-box;
		display: flex;
		flex-direction: row;
		flex-wrap: nowrap;
		align-items: stretch;
		height: 100dvh;
		max-height: 100dvh;
		width: 100%;
		max-width: 100vw;
		background: var(--bg);
		overflow: hidden;
		position: relative;
	}

	.app.is-resizing {
		user-select: none;
	}

	.app.nav-collapsed {
		--sidebar-w: 0px;
	}

	/* Chapter list floats — do not steal lesson width when main would be tiny */
	.app.sidebar-overlay {
		--sidebar-w: 0px;
	}

	/* Backdrop never participates in flex sizing */
	.nav-backdrop {
		display: none;
		position: fixed;
		inset: 0;
		z-index: 45;
		border: none;
		padding: 0;
		margin: 0;
		flex: none;
		width: auto;
		height: auto;
		background: color-mix(in srgb, var(--bg) 45%, transparent);
		cursor: pointer;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			opacity 0.28s ease,
			visibility 0.28s ease;
	}

	.app.sidebar-overlay .nav-backdrop {
		display: block;
	}

	.app.sidebar-overlay .nav-backdrop.is-open {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
	}

	/* Docked sidebar: fixed flex basis */
	.sidebar {
		box-sizing: border-box;
		flex: 0 0 var(--sidebar-w);
		width: var(--sidebar-w);
		max-width: var(--sidebar-w);
		min-width: 0;
		height: 100%;
		max-height: 100%;
		overflow: hidden;
		opacity: 1;
		visibility: visible;
		transition:
			opacity 0.22s ease,
			visibility 0.22s ease,
			flex-basis 0.28s cubic-bezier(0.22, 1, 0.36, 1),
			width 0.28s cubic-bezier(0.22, 1, 0.36, 1),
			max-width 0.28s cubic-bezier(0.22, 1, 0.36, 1);
	}

	.app.nav-collapsed .sidebar {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}

	/* Overlay drawer — out of flow, does not affect main/term widths */
	.app.sidebar-overlay .sidebar,
	.app.sidebar-overlay.nav-collapsed .sidebar {
		position: fixed;
		top: 0;
		right: 0;
		flex: none;
		width: min(300px, 88vw);
		max-width: min(300px, 88vw);
		height: 100dvh;
		max-height: 100dvh;
		z-index: 50;
		box-shadow: var(--shadow-lg);
		border: none;
		opacity: 1;
		visibility: visible;
		pointer-events: none;
		transform: translate3d(105%, 0, 0);
		transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
		will-change: transform;
	}

	.app.sidebar-overlay.nav-open .sidebar,
	.app.sidebar-overlay .sidebar.is-open {
		transform: translate3d(0, 0, 0);
		pointer-events: auto;
	}

	/* Lesson column — always eats remaining space; never collapses to 0 */
	.main {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		flex: 1 1 0%;
		/* min-width:0 so flex can shrink; JS clamp keeps term from eating it */
		min-width: 0;
		width: auto;
		max-width: 100%;
		height: 100%;
		max-height: 100%;
		min-height: 0;
		overflow: hidden;
		border-left: 1px solid var(--border);
		border-right: 1px solid var(--border);
		background: var(--bg);
	}

	/* Resize rail */
	.term-resize {
		box-sizing: border-box;
		flex: 0 0 var(--resize-rail);
		width: var(--resize-rail);
		min-width: var(--resize-rail);
		max-width: var(--resize-rail);
		height: 100%;
		align-self: stretch;
	}

	.app.term-collapsed .term-resize {
		flex-basis: 0;
		width: 0;
		min-width: 0;
		max-width: 0;
		overflow: hidden;
		border: none;
	}

	/* Terminal column — fixed basis, hard max so it cannot steal the row */
	.term-pane {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		/* shrink allowed as last resort if clamp races a resize */
		flex: 0 1 var(--term-w, 420px);
		width: var(--term-w, 420px);
		min-width: 0;
		max-width: min(var(--term-w, 420px), 50%);
		height: 100%;
		max-height: 100%;
		overflow: hidden;
		background: var(--term-bg);
	}

	.app.term-collapsed .term-pane,
	.term-pane.hidden {
		flex: 0 0 0 !important;
		width: 0 !important;
		min-width: 0 !important;
		max-width: 0 !important;
		overflow: hidden !important;
		border: none !important;
	}

	.topbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: var(--chrome-height);
		min-height: var(--chrome-height);
		max-height: var(--chrome-height);
		padding: 0 0.85rem;
		box-sizing: border-box;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
		flex-shrink: 0;
	}

	.icon-btn {
		box-sizing: border-box;
		border: 1px solid var(--border);
		background: var(--panel-2);
		color: var(--text);
		border-radius: 8px;
		width: var(--control-height);
		min-width: var(--control-height);
		height: var(--control-height);
		min-height: var(--control-height);
		padding: 0;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.crumb {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0;
		min-width: 0;
		line-height: 1.2;
	}

	.crumb .muted {
		font-size: 0.7rem;
		line-height: 1.1;
	}

	.crumb strong {
		font-size: 0.9rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: 1.25;
	}

	.actions {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
	}

	.ghost {
		box-sizing: border-box;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text);
		border-radius: 8px;
		height: var(--control-height);
		min-height: var(--control-height);
		padding: 0 0.65rem;
		cursor: pointer;
		font-size: 0.8rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		flex-shrink: 0;
	}

	.ghost:hover {
		background: var(--panel-2);
	}

	.content {
		flex: 1 1 0;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		background: var(--bg);
	}

	.content.fetching :global(.lesson .body) {
		opacity: 0.55;
		transition: opacity 0.12s ease;
	}

	.content:not(.fetching) :global(.lesson .body) {
		opacity: 1;
		transition: opacity 0.12s ease;
	}

	.loading {
		padding: 2rem;
		color: var(--muted);
		text-align: center;
	}

	.status-bar {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.35rem 0.85rem;
		font-size: 0.78rem;
		border-top: 1px solid var(--border);
		background: var(--panel);
		color: var(--muted);
		flex-shrink: 0;
	}

	/* Prefer display:none when closed so xterm can fully release layout */
	.term-pane.hidden {
		display: none !important;
		pointer-events: none;
		visibility: hidden;
	}

	/* Resize rail chrome (size is set above via flex-basis) */
	.term-resize {
		box-sizing: border-box;
		position: relative;
		z-index: 8;
		margin: 0;
		padding: 0;
		border: none;
		cursor: col-resize;
		touch-action: none;
		background: var(--panel-2);
		border-inline-start: 1px solid var(--border);
		border-inline-end: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.12s ease;
	}

	.term-resize.is-hidden {
		display: none !important;
	}

	/* Grip dots — so the handle is obvious */
	.term-resize-grip {
		display: block;
		width: 4px;
		height: 36px;
		border-radius: 4px;
		background: repeating-linear-gradient(
			to bottom,
			var(--muted) 0 3px,
			transparent 3px 6px
		);
		opacity: 0.85;
		pointer-events: none;
	}

	.term-resize:hover,
	.app.is-resizing .term-resize {
		background: var(--accent-soft);
	}

	.term-resize:hover .term-resize-grip,
	.app.is-resizing .term-resize-grip {
		background: repeating-linear-gradient(
			to bottom,
			var(--accent) 0 3px,
			transparent 3px 6px
		);
		opacity: 1;
	}

	:global(body.term-resizing) {
		cursor: col-resize !important;
		user-select: none !important;
	}

	:global(body.term-resizing *) {
		cursor: col-resize !important;
		user-select: none !important;
	}

	.term-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		height: var(--chrome-height);
		min-height: var(--chrome-height);
		max-height: var(--chrome-height);
		padding: 0 0.75rem;
		box-sizing: border-box;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.term-body {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		width: 100%;
		max-width: 100%;
		overflow: hidden;
	}

	.muted {
		color: var(--muted);
		font-size: 0.8rem;
	}

	.ltr {
		direction: ltr;
	}

	/*
	 * Tablet / small laptop:
	 * - Lesson on top, terminal below
	 * - Sidebar = pure CSS slide-over (no mount/unmount)
	 */
	@media (max-width: 1200px) {
		.app {
			flex-direction: column;
			flex-wrap: nowrap;
		}

		/* Flex order: main, resize bar, terminal — overlay chrome out of flow */
		.main {
			order: 1;
			flex: 1 1 0;
			min-width: 0;
			min-height: 200px;
			width: 100%;
			max-width: 100%;
			height: auto;
			max-height: none;
			border: none;
		}
		.term-resize {
			order: 2;
			flex: 0 0 12px;
			width: 100%;
			max-width: 100%;
			min-width: 0;
			height: 12px;
			min-height: 12px;
			max-height: 12px;
			cursor: row-resize;
			border-inline: none;
			border-top: 1px solid var(--border);
			border-bottom: 1px solid var(--border);
			background: var(--panel-2);
		}
		.term-pane {
			order: 3;
			position: relative;
			flex: 0 0 var(--term-h, 300px);
			width: 100%;
			max-width: 100%;
			height: var(--term-h, 300px);
			min-height: 140px;
			max-height: min(var(--term-h, 300px), 55vh);
			z-index: auto;
			border: none;
			box-shadow: none;
			transform: none !important;
			pointer-events: auto;
		}

		.sidebar,
		.nav-backdrop {
			order: 0;
			/* fixed overlays must not reserve flex space */
			flex: 0 0 0 !important;
			width: 0 !important;
			height: 0 !important;
			min-width: 0 !important;
			min-height: 0 !important;
			max-width: none;
			overflow: visible;
		}

		.term-resize.is-hidden {
			display: none !important;
		}

		.nav-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 45;
			width: auto !important;
			height: auto !important;
			border: none;
			padding: 0;
			margin: 0;
			background: color-mix(in srgb, var(--bg) 45%, transparent);
			cursor: pointer;
			opacity: 0;
			visibility: hidden;
			pointer-events: none;
			transition:
				opacity 0.28s ease,
				visibility 0.28s ease;
		}

		.nav-backdrop.is-open {
			opacity: 1;
			visibility: visible;
			pointer-events: auto;
		}

		/* Pure CSS drawer — always mounted; only .nav-open toggles transform */
		.sidebar,
		.app.nav-collapsed .sidebar {
			position: fixed;
			top: 0;
			right: 0;
			width: min(300px, 88vw) !important;
			max-width: min(300px, 88vw);
			height: 100dvh !important;
			max-height: 100dvh;
			z-index: 50;
			box-shadow: var(--shadow-lg);
			border: none;
			opacity: 1;
			visibility: visible;
			pointer-events: none;
			transform: translate3d(105%, 0, 0);
			transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
			will-change: transform;
		}

		.app.nav-open .sidebar,
		.sidebar.is-open {
			transform: translate3d(0, 0, 0);
			pointer-events: auto;
		}

		.term-pane.hidden {
			display: none !important;
			flex: 0 !important;
			height: 0 !important;
			min-height: 0 !important;
			max-height: 0 !important;
			pointer-events: none;
		}

		.term-resize-grip {
			width: 40px;
			height: 4px;
			background: repeating-linear-gradient(
				to right,
				var(--muted) 0 3px,
				transparent 3px 6px
			);
		}

		.term-resize:hover .term-resize-grip,
		.app.is-resizing .term-resize-grip {
			background: repeating-linear-gradient(
				to right,
				var(--accent) 0 3px,
				transparent 3px 6px
			);
		}

		:global(body.term-resizing),
		:global(body.term-resizing *) {
			cursor: row-resize !important;
		}
	}

	@media (max-width: 640px) {
		.term-pane {
			min-height: 140px;
		}

		.sidebar {
			width: min(100%, 320px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.app,
		.sidebar,
		.nav-backdrop {
			transition: none !important;
		}
	}
</style>
