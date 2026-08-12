export type ThemeId = 'dark' | 'light'

const STORAGE_KEY = 'linux-lab-theme'

function readStored(): ThemeId {
	if (typeof localStorage === 'undefined') return 'dark'
	try {
		const v = localStorage.getItem(STORAGE_KEY)
		if (v === 'light' || v === 'dark') return v
	} catch {
		/* ignore */
	}
	return 'dark'
}

function applyDom(theme: ThemeId): void {
	if (typeof document === 'undefined') return
	document.documentElement.dataset.theme = theme
	document.documentElement.style.colorScheme = theme
}

/** Reactive theme state (Svelte 5 runes module). */
class ThemeStore {
	#theme = $state<ThemeId>(typeof document !== 'undefined' ? readStored() : 'dark')

	constructor() {
		if (typeof document !== 'undefined') {
			applyDom(this.#theme)
		}
	}

	get current(): ThemeId {
		return this.#theme
	}

	get isDark(): boolean {
		return this.#theme === 'dark'
	}

	set(theme: ThemeId): void {
		this.#theme = theme
		applyDom(theme)
		try {
			localStorage.setItem(STORAGE_KEY, theme)
		} catch {
			/* ignore */
		}
	}

	toggle(): void {
		this.set(this.#theme === 'dark' ? 'light' : 'dark')
	}

	/** Sync from DOM/localStorage after mount (hydration-safe). */
	hydrate(): void {
		const t = readStored()
		this.#theme = t
		applyDom(t)
	}
}

export const theme = new ThemeStore()

export const TERM_THEMES = {
	dark: {
		background: '#0b1220',
		foreground: '#e6edf3',
		cursor: '#58a6ff',
		selectionBackground: '#264f78',
		black: '#484f58',
		red: '#ff7b72',
		green: '#3fb950',
		yellow: '#d29922',
		blue: '#58a6ff',
		magenta: '#bc8cff',
		cyan: '#39c5cf',
		white: '#b1bac4',
	},
	light: {
		background: '#f6f8fc',
		foreground: '#1a2332',
		cursor: '#2563eb',
		selectionBackground: '#bfdbfe',
		black: '#1f2937',
		red: '#dc2626',
		green: '#16a34a',
		yellow: '#ca8a04',
		blue: '#2563eb',
		magenta: '#7c3aed',
		cyan: '#0891b2',
		white: '#374151',
	},
} as const
