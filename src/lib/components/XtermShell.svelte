<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { theme, TERM_THEMES, type ThemeId } from '$lib/theme.svelte'

	interface Props {
		onStatus?: (text: string) => void
		/** Incrementing token + command to inject into the terminal */
		inject?: { id: number; cmd: string } | null
		/** When false the pane is hidden (display:none); refit when shown again */
		visible?: boolean
	}

	let { onStatus, inject = null, visible = true }: Props = $props()

	let host: HTMLDivElement | undefined = $state()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let term: any
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let fit: any
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let os: any
	let lineBuffer = ''
	let cursor = 0
	let history: string[] = []
	let histIdx = -1
	let busy = false
	let ro: ResizeObserver | undefined
	let fitTimer: ReturnType<typeof setTimeout> | undefined
	let lastInjectId = -1
	let ready = false
	let lastTheme: ThemeId | null = null
	/** Fake cron daemon interval (runs due crontab jobs) */
	let cronTimer: ReturnType<typeof setInterval> | undefined

	type EditorKind = 'nano' | 'vim'
	type EditorMode = 'insert' | 'normal' | 'cmdline'
	/** GNU nano prompt modes (classic distro bindings) */
	type NanoPrompt =
		| null
		| { kind: 'writeout'; buffer: string }
		| { kind: 'exit-save' }
		| { kind: 'search'; buffer: string }
		| { kind: 'goto'; buffer: string }
		| { kind: 'readfile'; buffer: string }
		| { kind: 'help' }
	let editor: {
		kind: EditorKind
		path: string
		lines: string[]
		row: number
		col: number
		mode: EditorMode
		dirty: boolean
		cmd: string
		/** nano: cutbuffer (like real ^K / ^U) */
		cutBuffer: string
		/** nano: consecutive ^K appends */
		cutAppending: boolean
		/** nano: status message (disappears on next key) */
		message: string
		/** nano: interactive prompt */
		prompt: NanoPrompt
		/** nano: last search string for repeat */
		lastSearch: string
		/** nano: after Write Out, exit (^X → Y → name) */
		exitAfterWrite: boolean
		/** first visible text row (scroll) */
		top: number
		/** horizontal scroll (nano long lines) */
		left: number
		/** vim: yank / delete register */
		yankBuffer: string
		/** vim: pending operator (d, y, g, …) */
		pending: string
		/** vim: show line numbers (:set number) */
		showLineNumbers: boolean
		/** vim: last / search */
		vimSearch: string
		/** vim: typed count (e.g. 3dd, 5j) */
		countBuf: string
		/** vim: simple undo snapshots */
		undoStack: { lines: string[]; row: number; col: number }[]
	} | null = null

	/** less(1) pager — interactive view-only mode */
	type LessPrompt =
		| null
		| { kind: 'search'; buffer: string; dir: 1 | -1 }
		| { kind: 'goto'; buffer: string }
		| { kind: 'help' }
	let pager: {
		path: string
		lines: string[]
		/** first visible line index */
		top: number
		message: string
		prompt: LessPrompt
		lastSearch: string
		lastSearchDir: 1 | -1
	} | null = null

	const LESS_HELP = [
		'                   SUMMARY OF LESS COMMANDS',
		'',
		'      Commands marked with * may be preceded by a number, N.',
		'',
		'  h  H                 Display this help.',
		'  q  Q  :q  :Q  ZZ     Exit.',
		'  e  ^E  j  ^N  CR  *  Forward  one line.',
		'  y  ^Y  k  ^K  ^P  *  Backward one line.',
		'  f  ^F  ^V  SPACE  *  Forward  one window.',
		'  b  ^B  ESC-v      *  Backward one window.',
		'  d  ^D             *  Forward  one half-window.',
		'  u  ^U             *  Backward one half-window.',
		'  g  <  ESC-<       *  Go to first line in file.',
		'  G  >  ESC->       *  Go to last line in file.',
		'  /pattern          *  Search forward for pattern.',
		'  ?pattern          *  Search backward for pattern.',
		'  n                 *  Repeat previous search.',
		'  N                 *  Repeat previous search in reverse.',
		'  =  ^G  :f            Print current file name and position.',
		'',
		'  (FakeShell lab less — subset of GNU less.)',
		'  Press any key to continue.',
	]

	const NANO_VERSION = '7.2'
	const NANO_HELP_TEXT = [
		'GNU nano help text',
		'',
		' The nano editor is designed to be intuitive and easy to use.',
		' It is a small, friendly editor inspired by Pico.',
		'',
		' Main nano shortcuts (classic bindings):',
		'  ^G  Display this help text',
		'  ^X  Close the current file buffer / Exit from nano',
		'  ^O  Write the current file to disk',
		'  ^R  Insert another file into the current one',
		'  ^W  Search for a string or a regular expression',
		'  ^K  Cut the current line and store it in the cutbuffer',
		'  ^U  Uncut from the cutbuffer into the current line',
		'  ^J  Justify the current paragraph',
		'  ^T  Invoke the spell checker, if available',
		'  ^C  Report the current cursor position',
		'  ^_  Go to line and column number',
		'  ^\\  Replace a string or a regular expression',
		'  ^A  Go to the beginning of the current line',
		'  ^E  Go to the end of the current line',
		'  ^Y  Move one page up',
		'  ^V  Move one page down',
		'  ^L  Refresh (redraw) the current screen',
		'',
		'  (FakeShell lab nano — layout and keys match GNU nano 7.x)',
		' Press any key to continue editing.',
	]

	/** Short path for title bars (~ for home). */
	function displayPath(p: string): string {
		if (!p) return ''
		if (p === '/home/user') return '~'
		if (p.startsWith('/home/user/')) return '~' + p.slice('/home/user'.length)
		return p
	}


	function applyTermTheme(id: ThemeId): void {
		if (!term || lastTheme === id) return
		lastTheme = id
		term.options.theme = { ...TERM_THEMES[id] }
	}

	function prompt(): void {
		if (!term || !os) return
		const cwd = os.displayCwd()
		term.write(`\r\n\x1b[32muser@fakeshell-lab\x1b[0m:\x1b[34m${cwd}\x1b[0m$ `)
	}

	/** Full redraw of the input line (used for mid-line edits / history). */
	function redrawLine(): void {
		if (!term) return
		term.write('\r\x1b[K')
		const cwd = os?.displayCwd() ?? '~'
		const p = `\x1b[32muser@fakeshell-lab\x1b[0m:\x1b[34m${cwd}\x1b[0m$ `
		term.write(p + lineBuffer)
		const after = lineBuffer.length - cursor
		if (after > 0) term.write(`\x1b[${after}D`)
	}

	/** Append at end of line without clearing — avoids flicker. */
	function typeAtEnd(ch: string): void {
		lineBuffer += ch
		cursor = lineBuffer.length
		term.write(ch)
	}

	/** Insert mid-line: rewrite only the tail (no full prompt redraw). */
	function insertMid(ch: string): void {
		lineBuffer = lineBuffer.slice(0, cursor) + ch + lineBuffer.slice(cursor)
		const tail = lineBuffer.slice(cursor)
		cursor += ch.length
		term.write('\x1b[K' + tail)
		const back = tail.length - ch.length
		if (back > 0) term.write(`\x1b[${back}D`)
	}

	function backspace(): void {
		if (cursor <= 0) return
		if (cursor === lineBuffer.length) {
			lineBuffer = lineBuffer.slice(0, -1)
			cursor--
			term.write('\b \b')
			return
		}
		lineBuffer = lineBuffer.slice(0, cursor - 1) + lineBuffer.slice(cursor)
		cursor--
		const tail = lineBuffer.slice(cursor)
		term.write('\b\x1b[K' + tail)
		if (tail.length > 0) term.write(`\x1b[${tail.length}D`)
	}

	function tokenize(line: string): string[] {
		const tokens: string[] = []
		let cur = ''
		let quote: '"' | "'" | null = null
		for (let i = 0; i < line.length; i++) {
			const c = line[i]
			if (quote) {
				if (c === quote) quote = null
				else cur += c
				continue
			}
			if (c === '"' || c === "'") {
				quote = c
				continue
			}
			if (/\s/.test(c)) {
				if (cur) {
					tokens.push(cur)
					cur = ''
				}
				continue
			}
			cur += c
		}
		if (cur) tokens.push(cur)
		return tokens
	}

	function inv(s: string): string {
		return `\x1b[7m${s}\x1b[0m`
	}

	/** Exact terminal size — never invent fake mins (that breaks full-screen paint). */
	function termSize(): { cols: number; rows: number } {
		const cols = Math.max(1, term?.cols ?? 80)
		const rows = Math.max(1, term?.rows ?? 24)
		return { cols, rows }
	}

	/** Visible width of a string ignoring ANSI CSI. */
	function stripAnsi(s: string): string {
		return s.replace(/\x1b\[[0-9;]*m/g, '')
	}

	/**
	 * Pad/truncate plain text to exactly `w` cells (no ANSI).
	 * Critical for full-screen TUI: each painted row must be exactly `cols` wide
	 * so layout matches real nano/vim against xterm.cols × xterm.rows.
	 */
	function padLine(s: string, w: number): string {
		const t = s.length > w ? s.slice(0, w) : s
		return t + ' '.repeat(Math.max(0, w - t.length))
	}

	/** Pad/truncate a string that may contain ANSI to exactly `w` visible cells + reset. */
	function padAnsiLine(s: string, w: number): string {
		const plain = stripAnsi(s)
		if (plain.length === w) {
			return s.endsWith('\x1b[0m') || !s.includes('\x1b[') ? s : s + '\x1b[0m'
		}
		if (plain.length > w) {
			// rebuild truncated with ANSI preserved
			let out = ''
			let vis = 0
			for (let i = 0; i < s.length && vis < w; i++) {
				if (s[i] === '\x1b' && s[i + 1] === '[') {
					const m = s.slice(i).match(/^\x1b\[[0-9;]*m/)
					if (m) {
						out += m[0]
						i += m[0].length - 1
						continue
					}
				}
				out += s[i]
				vis++
			}
			return out + '\x1b[0m'
		}
		// pad
		const pad = ' '.repeat(w - plain.length)
		const needsReset = s.includes('\x1b[') && !s.endsWith('\x1b[0m')
		return s + (needsReset ? '\x1b[0m' : '') + pad
	}

	/**
	 * Write a full-screen frame of exactly `rows` lines × `cols` cells.
	 * Disables wraparound so full-width rows don't scroll the buffer.
	 */
	function writeScreen(frameRows: string[], cols: number, rows: number): void {
		if (!term) return
		const lines: string[] = []
		for (let i = 0; i < rows; i++) {
			const raw = frameRows[i] ?? ''
			lines.push(padAnsiLine(raw, cols))
		}
		// ?7l = no wrap; home+clear; paint; re-enable wrap
		// Use \r\n between rows; convertEol is on so be consistent with \n only
		const body = lines.join('\n')
		term.write('\x1b[?7l\x1b[H\x1b[J' + body + '\x1b[?7h')
	}

	/**
	 * Truncate a line to `cols` visible cells without breaking ANSI sequences.
	 * Always ends with reset so colors don't bleed into the next row.
	 */
	function truncateAnsiLine(s: string, cols: number): string {
		if (stripAnsi(s).length <= cols) {
			// ensure color doesn't leak if line omitted reset
			return s.includes('\x1b[') && !s.endsWith('\x1b[0m') ? s + '\x1b[0m' : s
		}
		let out = ''
		let vis = 0
		for (let i = 0; i < s.length; i++) {
			if (s[i] === '\x1b' && s[i + 1] === '[') {
				const m = s.slice(i).match(/^\x1b\[[0-9;]*m/)
				if (m) {
					out += m[0]
					i += m[0].length - 1
					continue
				}
			}
			if (vis >= cols - 1) {
				out += '…\x1b[0m'
				return out
			}
			out += s[i]
			vis++
		}
		return out.endsWith('\x1b[0m') ? out : out + '\x1b[0m'
	}

	/**
	 * Real nano bottom chrome: reverse-video key, then label, two columns.
	 * Result is padded to exactly `cols` visible cells (via padAnsiLine later).
	 */
	function nanoShortcutPair(left: string, right: string, cols: number): string {
		const half = Math.floor(cols / 2)
		const hi = (chunk: string) =>
			chunk.replace(/(\^[A-Z\\_@^]|M-[A-Z0-9])/g, (m) => inv(m))
		const l = padLine(left, half)
		const r = padLine(right, cols - half)
		return hi(l) + hi(r)
	}

	/** Move hardware cursor to editor text cell (1-based screen coords). */
	function placeEditorCursor(screenRow: number, screenCol: number): void {
		if (!term) return
		const r = Math.max(1, Math.min(term.rows, screenRow))
		const c = Math.max(1, Math.min(term.cols, screenCol))
		try {
			term.write(`\x1b[${r};${c}H\x1b[?25h`)
		} catch {
			/* ignore */
		}
	}

	/** Keep editor.top / editor.left so the cursor stays on screen. */
	function editorEnsureVisible(textH: number, textW: number): void {
		if (!editor) return
		if (editor.row < editor.top) editor.top = editor.row
		if (editor.row >= editor.top + textH) editor.top = editor.row - textH + 1
		if (editor.top < 0) editor.top = 0
		const maxTop = Math.max(0, editor.lines.length - textH)
		if (editor.top > maxTop) editor.top = maxTop
		// horizontal
		if (editor.col < editor.left) editor.left = editor.col
		if (editor.col >= editor.left + textW) editor.left = editor.col - textW + 1
		if (editor.left < 0) editor.left = 0
	}

	function paintEditor(): void {
		if (!term || !editor) return
		const { cols, rows } = termSize()
		if (editor.kind === 'nano') paintNano(cols, rows)
		else paintVim(cols, rows)
	}

	/**
	 * Classic Vim (laststatus=2): exactly `rows` screen rows × `cols` cells.
	 * Layout: [textH] + statusline + cmdline  = rows  (textH = rows - 2)
	 */
	function paintVim(cols: number, rows: number): void {
		if (!term || !editor) return
		const { path, lines, row, col, mode, dirty, cmd, message, showLineNumbers } = editor
		const textH = Math.max(1, rows - 2)
		const numW = showLineNumbers ? Math.max(3, String(Math.max(1, lines.length)).length) + 1 : 0
		const textW = Math.max(1, cols - numW)
		editorEnsureVisible(textH, textW)

		const start = editor.top
		const end = Math.min(lines.length, start + textH)
		const hScroll = editor.left
		const frame: string[] = []

		for (let i = start; i < end; i++) {
			const ln = lines[i] ?? ''
			const slice = ln.slice(hScroll, hScroll + textW)
			if (showLineNumbers) {
				const num = String(i + 1).padStart(numW - 1, ' ')
				frame.push(`\x1b[33m${num}\x1b[0m ` + slice)
			} else {
				frame.push(slice)
			}
		}
		while (frame.length < textH) {
			frame.push(`\x1b[1;34m~\x1b[0m`)
		}

		const name = path ? displayPath(path) : '[No Name]'
		const mod = dirty ? ' [+]' : '    '
		const pct =
			lines.length <= 1
				? 'All'
				: row === 0
					? 'Top'
					: row >= lines.length - 1
						? 'Bot'
						: `${Math.min(100, Math.round((row / (lines.length - 1)) * 100))}%`
		const leftSt = `${name}${mod}`
		const rightSt = `${row + 1},${col + 1}       ${pct}`
		const gap = Math.max(1, cols - leftSt.length - rightSt.length)
		const st = (leftSt + ' '.repeat(gap) + rightSt).slice(0, cols)
		frame.push(`\x1b[7m${st}\x1b[0m`)

		let last = ''
		if (mode === 'cmdline') last = ':' + cmd
		else if (message) last = message
		else if (mode === 'insert') last = '-- INSERT --'
		else if (mode === 'normal' && (editor.pending || editor.countBuf))
			last = editor.countBuf + editor.pending
		frame.push(last)

		// Ensure exact row count
		while (frame.length < rows) frame.push('')
		writeScreen(frame.slice(0, rows), cols, rows)

		if (mode === 'cmdline') {
			placeEditorCursor(rows, Math.min(cols, 2 + cmd.length))
		} else if (message && mode === 'normal') {
			placeEditorCursor(rows, 1)
		} else {
			const sr = 1 + (row - start)
			const sc = Math.min(cols, 1 + numW + (col - hScroll))
			placeEditorCursor(sr, Math.max(1, sc))
		}
	}

	/**
	 * Classic GNU nano 7.x — exact grid:
	 *   1 title + textH + 1 status + 2 help  = rows   (textH = rows - 4)
	 * Uses live xterm.cols / xterm.rows only.
	 */
	function paintNano(cols: number, rows: number): void {
		if (!term || !editor) return
		const { path, lines, row, col, dirty, message, prompt } = editor

		if (prompt?.kind === 'help') {
			const bodyH = Math.max(1, rows - 2)
			const frame: string[] = [inv(padLine(`  GNU nano ${NANO_VERSION}`, cols))]
			for (let i = 0; i < bodyH; i++) frame.push(NANO_HELP_TEXT[i] ?? '')
			frame.push(inv(padLine('^X Exit from help', cols)))
			while (frame.length < rows) frame.push('')
			writeScreen(frame.slice(0, rows), cols, rows)
			return
		}

		const textH = Math.max(1, rows - 4)
		const textW = cols
		editorEnsureVisible(textH, textW)
		const start = editor.top
		const end = Math.min(lines.length, start + textH)
		const hScroll = editor.left

		const fileLabel = path ? displayPath(path) : 'New Buffer'
		const modTag = dirty ? 'Modified' : ''
		const leftTitle = `  GNU nano ${NANO_VERSION}  ${fileLabel}`
		const titlePlain = padLine(
			leftTitle +
				' '.repeat(Math.max(1, cols - leftTitle.length - modTag.length - 2)) +
				modTag +
				(modTag ? '  ' : ''),
			cols,
		)

		let statusLine = ''
		if (prompt?.kind === 'writeout') statusLine = `File Name to Write: ${prompt.buffer}`
		else if (prompt?.kind === 'exit-save')
			statusLine =
				'Save modified buffer?  (Answering "No" will DISCARD changes.)  Y Yes  N No  ^C Cancel'
		else if (prompt?.kind === 'search')
			statusLine = `Search [${editor.lastSearch || ''}]: ${prompt.buffer}`
		else if (prompt?.kind === 'goto')
			statusLine = `Enter line number, column number: ${prompt.buffer}`
		else if (prompt?.kind === 'readfile')
			statusLine = `File to insert [from ./]: ${prompt.buffer}`
		else if (message) statusLine = ` ${message} `

		const frame: string[] = [inv(titlePlain)]
		for (let i = start; i < end; i++) {
			const ln = lines[i] ?? ''
			frame.push(ln.slice(hScroll, hScroll + textW))
		}
		while (frame.length < 1 + textH) frame.push('')

		// status row
		frame.push(statusLine ? inv(padLine(statusLine, cols)) : '')

		// two help rows
		if (prompt?.kind === 'exit-save') {
			frame.push(nanoShortcutPair(' Y Yes', ' N No', cols))
			frame.push(nanoShortcutPair('^C Cancel', '', cols))
		} else if (
			prompt?.kind === 'writeout' ||
			prompt?.kind === 'readfile' ||
			prompt?.kind === 'search' ||
			prompt?.kind === 'goto'
		) {
			frame.push(nanoShortcutPair('^G Get Help', '^C Cancel', cols))
			frame.push(nanoShortcutPair('^T Browse', '', cols))
		} else {
			frame.push(
				nanoShortcutPair(
					'^G Get Help  ^O Write Out  ^W Where Is',
					'^K Cut Text  ^J Justify   ^C Cur Pos',
					cols,
				),
			)
			frame.push(
				nanoShortcutPair(
					'^X Exit      ^R Read File  ^\\ Replace',
					'^U Paste Text ^T To Spell  ^_ Go To Line',
					cols,
				),
			)
		}

		while (frame.length < rows) frame.push('')
		writeScreen(frame.slice(0, rows), cols, rows)

		// cursor: title=1, text starts at 2 … status at rows-2, help at rows-1..rows
		const statusRow = rows - 2
		if (
			prompt?.kind === 'writeout' ||
			prompt?.kind === 'search' ||
			prompt?.kind === 'goto' ||
			prompt?.kind === 'readfile'
		) {
			const prefixLen =
				prompt.kind === 'writeout'
					? 'File Name to Write: '.length
					: prompt.kind === 'search'
						? `Search [${editor.lastSearch || ''}]: `.length
						: prompt.kind === 'goto'
							? 'Enter line number, column number: '.length
							: 'File to insert [from ./]: '.length
			placeEditorCursor(statusRow, Math.min(cols, 1 + prefixLen + prompt.buffer.length))
		} else if (prompt?.kind === 'exit-save') {
			placeEditorCursor(statusRow, 1)
		} else {
			const sr = 2 + (row - start)
			const sc = Math.min(cols, Math.max(1, 1 + (col - hScroll)))
			placeEditorCursor(sr, sc)
		}
	}

	function resetShellInput(): void {
		lineBuffer = ''
		cursor = 0
		histIdx = history.length
	}

	// ── less(1) pager ─────────────────────────────────────────────────────

	/** Open less on raw text (systemctl/journalctl pager, like real $SYSTEMD_PAGER). */
	function openPagerContent(title: string, content: string): void {
		if (!term) return
		let lines = content === '' ? [''] : content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
		if (lines.length > 1 && lines[lines.length - 1] === '') lines = lines.slice(0, -1)
		if (!lines.length) lines = ['']
		resetShellInput()
		pager = {
			path: title,
			lines,
			top: 0,
			message: '',
			prompt: null,
			lastSearch: '',
			lastSearchDir: 1,
		}
		busy = true
		try {
			term.write('\x1b[?25l')
		} catch {
			/* ignore */
		}
		paintPager()
	}

	function openPager(path: string): void {
		if (!os || !term) return
		const abs = os.resolvePath(path)
		let content = ''
		try {
			content = os.readFile(abs)
		} catch {
			term.write(`\x1b[31mless: ${path}: No such file or directory\x1b[0m\r\n`)
			return
		}
		openPagerContent(abs, content)
	}

	/**
	 * Real systemctl/journalctl open a full-screen pager when stdout is a TTY.
	 * Skip for --no-pager or tiny one-line answers (is-active, get-default, …).
	 */
	function shouldPageCommand(cmd: string, tokens: string[], text: string): boolean {
		if (cmd !== 'systemctl' && cmd !== 'journalctl' && cmd !== 'man') return false
		if (tokens.includes('--no-pager')) return false
		if (!text) return false
		const lines = text.replace(/\r\n/g, '\n').split('\n')
		// drop trailing empty from final newline
		if (lines.length && lines[lines.length - 1] === '') lines.pop()
		if (lines.length === 0) return false
		// one short line → print inline (e.g. "active", "multi-user.target")
		if (lines.length === 1 && lines[0].length < 100) return false
		// otherwise take over the screen like less on a real system
		return true
	}

	function closePager(): void {
		if (!term) return
		pager = null
		busy = false
		resetShellInput()
		term.write('\x1b[?25h')
		term.write('\x1b[0m')
		term.write('\x1b[H\x1b[J')
		prompt()
		try {
			term.focus()
		} catch {
			/* ignore */
		}
	}

	function pagerPageH(): number {
		const { rows } = termSize()
		return Math.max(1, rows - 1)
	}

	function pagerMaxTop(): number {
		if (!pager) return 0
		return Math.max(0, pager.lines.length - pagerPageH())
	}

	function paintPager(): void {
		if (!term || !pager) return
		const { cols, rows } = termSize()
		const pageH = Math.max(1, rows - 1)

		if (pager.prompt?.kind === 'help') {
			const frame: string[] = []
			for (let i = 0; i < rows - 1; i++) frame.push(LESS_HELP[i] ?? '')
			frame.push(inv(padLine('HELP -- Press any key to continue', cols)))
			writeScreen(frame, cols, rows)
			return
		}

		const top = Math.min(pager.top, pagerMaxTop())
		pager.top = top
		const frame: string[] = []
		for (let i = 0; i < pageH; i++) {
			const ln = pager.lines[top + i]
			if (ln === undefined) frame.push(`\x1b[34m~\x1b[0m`)
			else frame.push(truncateAnsiLine(ln, cols))
		}

		let status: string
		if (pager.prompt?.kind === 'search') {
			const ch = pager.prompt.dir < 0 ? '?' : '/'
			status = `${ch}${pager.prompt.buffer}`
		} else if (pager.prompt?.kind === 'goto') {
			status = `Goto line: ${pager.prompt.buffer}`
		} else if (pager.message) {
			status = pager.message
		} else {
			const atEnd = top >= pagerMaxTop()
			const pct =
				pager.lines.length <= 1
					? 100
					: Math.min(100, Math.round((top / Math.max(1, pagerMaxTop())) * 100))
			const name = pager.path.split('/').pop() || pager.path
			status = atEnd ? `${name} (END)` : `:${name} ${pct}%`
		}
		frame.push(inv(padLine(status, cols)))
		writeScreen(frame, cols, rows)
	}

	function pagerScroll(delta: number): void {
		if (!pager) return
		pager.top = Math.max(0, Math.min(pagerMaxTop(), pager.top + delta))
		pager.message = ''
		paintPager()
	}

	function pagerGotoLine(n: number): void {
		if (!pager) return
		const line = Math.max(1, Math.min(pager.lines.length, n))
		pager.top = Math.max(0, Math.min(pagerMaxTop(), line - 1))
		pager.message = ''
		pager.prompt = null
		paintPager()
	}

	function pagerSearch(pattern: string, dir: 1 | -1, fromNext = true): void {
		if (!pager || !pattern) {
			if (pager) {
				pager.prompt = null
				pager.message = 'Pattern not found  (press RETURN)'
				paintPager()
			}
			return
		}
		pager.lastSearch = pattern
		pager.lastSearchDir = dir
		const start =
			dir > 0
				? pager.top + (fromNext ? 1 : 0)
				: pager.top + (fromNext ? -1 : 0)
		const lines = pager.lines
		if (dir > 0) {
			for (let i = Math.max(0, start); i < lines.length; i++) {
				if (lines[i].includes(pattern)) {
					pager.top = Math.min(pagerMaxTop(), i)
					pager.prompt = null
					pager.message = ''
					paintPager()
					return
				}
			}
			// wrap
			for (let i = 0; i < Math.max(0, start) && i < lines.length; i++) {
				if (lines[i].includes(pattern)) {
					pager.top = Math.min(pagerMaxTop(), i)
					pager.prompt = null
					pager.message = 'Pattern found (wrapped)'
					paintPager()
					return
				}
			}
		} else {
			for (let i = Math.min(lines.length - 1, start); i >= 0; i--) {
				if (lines[i].includes(pattern)) {
					pager.top = Math.min(pagerMaxTop(), i)
					pager.prompt = null
					pager.message = ''
					paintPager()
					return
				}
			}
			for (let i = lines.length - 1; i > start; i--) {
				if (lines[i].includes(pattern)) {
					pager.top = Math.min(pagerMaxTop(), i)
					pager.prompt = null
					pager.message = 'Pattern found (wrapped)'
					paintPager()
					return
				}
			}
		}
		pager.prompt = null
		pager.message = 'Pattern not found'
		paintPager()
	}

	function pagerStatus(): void {
		if (!pager) return
		const bottom = Math.min(pager.lines.length, pager.top + pagerPageH())
		pager.message = `bytes ${pager.lines.join('\n').length}  lines ${pager.lines.length}  ${pager.top + 1}-${bottom}/${pager.lines.length}`
		paintPager()
	}

	function handlePagerData(data: string): void {
		if (!pager || !term) return

		// Help dismiss
		if (pager.prompt?.kind === 'help') {
			pager.prompt = null
			paintPager()
			return
		}

		// Prompt input
		if (pager.prompt?.kind === 'search' || pager.prompt?.kind === 'goto') {
			if (data === '\u0003' || data === '\u001b') {
				pager.prompt = null
				pager.message = ''
				paintPager()
				return
			}
			if (data === '\r') {
				if (pager.prompt.kind === 'search') {
					const { buffer, dir } = pager.prompt
					pagerSearch(buffer, dir, true)
				} else {
					const n = parseInt(pager.prompt.buffer, 10)
					if (Number.isFinite(n)) pagerGotoLine(n)
					else {
						pager.prompt = null
						pager.message = 'Invalid line number'
						paintPager()
					}
				}
				return
			}
			if (data === '\u007f' || data === '\b') {
				pager.prompt.buffer = pager.prompt.buffer.slice(0, -1)
				paintPager()
				return
			}
			if (data >= ' ' && data.length === 1 && !data.startsWith('\x1b')) {
				pager.prompt.buffer += data
				paintPager()
				return
			}
			return
		}

		// Clear one-shot message on next key
		if (pager.message) pager.message = ''

		// Quit
		if (data === 'q' || data === 'Q') {
			closePager()
			return
		}
		if (data === ':' ) {
			// :q style — wait for q
			// simple: ignore lone colon; :q handled if user types q next is just q
			return
		}

		// Help
		if (data === 'h' || data === 'H') {
			pager.prompt = { kind: 'help' }
			paintPager()
			return
		}

		// Status
		if (data === '=' || data === '\u0007') {
			pagerStatus()
			return
		}

		// Navigation
		const page = pagerPageH()
		const half = Math.max(1, Math.floor(page / 2))

		if (data === ' ' || data === 'f' || data === '\u0006' || data === '\x1b[6~' || data === 'z') {
			pagerScroll(page)
			return
		}
		if (data === 'b' || data === '\u0002' || data === '\x1b[5~') {
			pagerScroll(-page)
			return
		}
		if (data === 'd' || data === '\u0004') {
			pagerScroll(half)
			return
		}
		if (data === 'u' || data === '\u0015') {
			pagerScroll(-half)
			return
		}
		if (
			data === 'j' ||
			data === 'e' ||
			data === '\r' ||
			data === '\u000e' ||
			data === '\x1b[B' ||
			data === '\x1bOB'
		) {
			pagerScroll(1)
			return
		}
		if (
			data === 'k' ||
			data === 'y' ||
			data === '\u0010' ||
			data === '\u0019' ||
			data === '\x1b[A' ||
			data === '\x1bOA'
		) {
			pagerScroll(-1)
			return
		}
		if (
			data === 'g' ||
			data === '<' ||
			data === '\x1b[H' ||
			data === '\x1b[1~' ||
			data === '\x1bOH'
		) {
			pager.top = 0
			paintPager()
			return
		}
		if (
			data === 'G' ||
			data === '>' ||
			data === '\x1b[F' ||
			data === '\x1b[4~' ||
			data === '\x1bOF'
		) {
			pager.top = pagerMaxTop()
			paintPager()
			return
		}

		// Search
		if (data === '/') {
			pager.prompt = { kind: 'search', buffer: '', dir: 1 }
			paintPager()
			return
		}
		if (data === '?') {
			pager.prompt = { kind: 'search', buffer: '', dir: -1 }
			paintPager()
			return
		}
		if (data === 'n') {
			if (pager.lastSearch) pagerSearch(pager.lastSearch, pager.lastSearchDir, true)
			else {
				pager.message = 'No previous regular expression'
				paintPager()
			}
			return
		}
		if (data === 'N') {
			if (pager.lastSearch) {
				const rev = pager.lastSearchDir === 1 ? -1 : 1
				pagerSearch(pager.lastSearch, rev as 1 | -1, true)
			} else {
				pager.message = 'No previous regular expression'
				paintPager()
			}
			return
		}

		// Goto line: digit starts number then G — simplified: use `:` prompt via number + G not implemented; use /
		// Accept Ctrl+G status already via = 

		// ESC sequences already handled above partially
		if (data.startsWith('\x1b')) return
	}

	function openEditor(kind: EditorKind, path: string): void {
		if (!os || !term) return
		let content = ''
		const abs = path ? os.resolvePath(path) : ''
		if (abs) {
			try {
				content = os.readFile(abs)
			} catch {
				content = ''
				// New file — don't create until write-out (like real nano)
			}
		}
		// Drop trailing empty line from split of file ending with \n (nano-like)
		let lines = content === '' ? [''] : content.split('\n')
		if (lines.length > 1 && lines[lines.length - 1] === '') lines = lines.slice(0, -1)
		if (!lines.length) lines = ['']
		resetShellInput()
		editor = {
			kind,
			path: abs || '',
			lines,
			row: 0,
			col: 0,
			mode: kind === 'nano' ? 'insert' : 'normal',
			dirty: false,
			cmd: '',
			cutBuffer: '',
			cutAppending: false,
			message: abs ? '' : kind === 'nano' ? 'New Buffer' : '',
			prompt: null,
			lastSearch: '',
			exitAfterWrite: false,
			top: 0,
			left: 0,
			yankBuffer: '',
			pending: '',
			showLineNumbers: false,
			vimSearch: '',
			countBuf: '',
			undoStack: [],
		}
		busy = true
		// Hardware cursor is placed by paint* (real editor feel)
		paintEditor()
	}

	function vimPushUndo(): void {
		if (!editor) return
		editor.undoStack.push({
			lines: editor.lines.map((l) => l),
			row: editor.row,
			col: editor.col,
		})
		if (editor.undoStack.length > 80) editor.undoStack.shift()
	}

	function vimUndo(): void {
		if (!editor || !editor.undoStack.length) {
			vimMsg('Already at oldest change')
			return
		}
		const snap = editor.undoStack.pop()!
		editor.lines = snap.lines
		editor.row = snap.row
		editor.col = snap.col
		editor.dirty = true
		editor.message = ''
		paintEditor()
	}

	function vimTakeCount(): number {
		if (!editor) return 1
		const n = parseInt(editor.countBuf || '1', 10)
		editor.countBuf = ''
		return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 1
	}

	function saveEditorFile(toPath?: string): boolean {
		if (!editor || !os) return false
		const dest = toPath ?? editor.path
		if (!dest) {
			editor.message = '[ No file name ]'
			return false
		}
		try {
			const body = editor.lines.join('\n')
			// Match nano: ensure final newline when writing
			os.writeFile(dest, body.endsWith('\n') ? body : body + '\n')
			editor.path = dest
			editor.dirty = false
			const n = editor.lines.length
			const bytes = new TextEncoder().encode(
				body.endsWith('\n') ? body : body + '\n',
			).length
			// Real nano: "[ Wrote 12 lines ]"  ·  real vim: "file" 12L, 34B written
			editor.message =
				editor.kind === 'nano'
					? `[ Wrote ${n} line${n === 1 ? '' : 's'} ]`
					: `"${displayPath(dest)}" ${n}L, ${bytes}B written`
			// crontab -e: install immediately on write-out (like real crontab after editor)
			if (dest.includes('/cron/crontabs/')) {
				try {
					const r = os.installCrontabFromEditor(dest) as { ok: boolean; message: string }
					if (r?.ok) editor.message = `[ ${r.message} ]`
				} catch {
					/* ignore */
				}
			}
			return true
		} catch {
			editor.message = '[ Error writing file ]'
			return false
		}
	}

	function exitNanoClean(note?: string): void {
		if (!term) return
		const path = editor?.path
		editor = null
		busy = false
		resetShellInput()
		term.write('\x1b[?25h')
		term.write('\x1b[0m')
		term.write('\x1b[H\x1b[J')
		if (note) term.write(`\x1b[90m# ${note}\x1b[0m`)
		if (path) maybeInstallCrontab(path)
		prompt()
		try {
			term.focus()
		} catch {
			/* ignore */
		}
	}

	/** Vim close helper (kept for lab vim). */
	function closeEditor(save: boolean): void {
		if (!editor || !os || !term) return
		if (editor.kind === 'nano') {
			nanoRequestExit()
			return
		}
		if (save && !saveEditorFile()) {
			term.write(`\r\n\x1b[31mwrite failed\x1b[0m`)
		}
		const path = editor.path
		const note = save ? `saved ${path}` : `closed ${path}`
		exitNanoClean(note)
	}

	/** After nano Write Out / exit-save on a crontab spool file, install it. */
	function maybeInstallCrontab(path: string): void {
		if (!os || !path.includes('/cron/crontabs/')) return
		try {
			const r = os.installCrontabFromEditor(path) as { ok: boolean; message: string }
			if (r?.message) {
				// show after editor closes via exitNanoClean note — store for next prompt
				term?.write(`\r\n\x1b[32m${r.message}\x1b[0m`)
			}
		} catch {
			/* ignore */
		}
	}

	/** GNU nano ^X: ask to save if modified. */
	function nanoRequestExit(): void {
		if (!editor) return
		if (editor.dirty) {
			editor.prompt = { kind: 'exit-save' }
			editor.message = ''
			paintEditor()
			return
		}
		exitNanoClean(editor.path ? `closed ${editor.path}` : 'closed New Buffer')
	}

	function nanoMsg(msg: string): void {
		if (!editor) return
		editor.message = msg
		editor.cutAppending = false
		paintEditor()
	}

	function nanoClearMsg(): void {
		if (editor && editor.message) editor.message = ''
	}

	function nanoCutLine(): void {
		if (!editor) return
		const line = editor.lines[editor.row] ?? ''
		if (editor.cutAppending && editor.cutBuffer) {
			editor.cutBuffer += '\n' + line
		} else {
			editor.cutBuffer = line
		}
		editor.cutAppending = true
		if (editor.lines.length === 1) {
			editor.lines[0] = ''
			editor.col = 0
		} else {
			editor.lines.splice(editor.row, 1)
			if (editor.row >= editor.lines.length) editor.row = editor.lines.length - 1
			editor.col = 0
		}
		editor.dirty = true
		editor.message = ''
		paintEditor()
	}

	function nanoUncut(): void {
		if (!editor || !editor.cutBuffer) {
			nanoMsg('[ Cutbuffer is empty ]')
			return
		}
		const parts = editor.cutBuffer.split('\n')
		const line = editor.lines[editor.row] ?? ''
		const left = line.slice(0, editor.col)
		const right = line.slice(editor.col)
		if (parts.length === 1) {
			editor.lines[editor.row] = left + parts[0] + right
			editor.col = left.length + parts[0].length
		} else {
			editor.lines[editor.row] = left + parts[0]
			const mid = parts.slice(1, -1)
			const last = parts[parts.length - 1] + right
			editor.lines.splice(editor.row + 1, 0, ...mid, last)
			editor.row += parts.length - 1
			editor.col = parts[parts.length - 1].length
		}
		editor.dirty = true
		editor.cutAppending = false
		editor.message = ''
		paintEditor()
	}

	function nanoSearch(query: string, fromNext = true): void {
		if (!editor || !query) {
			nanoMsg('[ Cancelled ]')
			return
		}
		editor.lastSearch = query
		const { lines, row, col } = editor
		const startRow = fromNext ? row : 0
		const startCol = fromNext ? col + 1 : 0
		// Forward search wrap
		for (let pass = 0; pass < 2; pass++) {
			const r0 = pass === 0 ? startRow : 0
			for (let r = r0; r < lines.length; r++) {
				const c0 = pass === 0 && r === startRow ? startCol : 0
				const idx = lines[r].indexOf(query, c0)
				if (idx >= 0) {
					editor.row = r
					editor.col = idx
					editor.prompt = null
					editor.message = ''
					paintEditor()
					return
				}
			}
		}
		editor.prompt = null
		nanoMsg('[ Search hit BOTTOM, continuing at TOP — not found ]')
	}

	function nanoGoto(spec: string): void {
		if (!editor) return
		const m = /^(\d+)(?:[,\s]+(\d+))?$/.exec(spec.trim())
		if (!m) {
			editor.prompt = null
			nanoMsg('[ Invalid line ]')
			return
		}
		const line = Math.max(1, parseInt(m[1], 10))
		const c = m[2] ? Math.max(1, parseInt(m[2], 10)) : 1
		editor.row = Math.min(editor.lines.length - 1, line - 1)
		editor.col = Math.min((editor.lines[editor.row] ?? '').length, c - 1)
		editor.prompt = null
		editor.message = ''
		paintEditor()
	}

	function nanoReadFile(name: string): void {
		if (!editor || !os) return
		if (!name.trim()) {
			editor.prompt = null
			nanoMsg('[ Cancelled ]')
			return
		}
		try {
			const data = os.readFile(name.trim())
			const parts = data.replace(/\n$/, '').split('\n')
			const line = editor.lines[editor.row] ?? ''
			const left = line.slice(0, editor.col)
			const right = line.slice(editor.col)
			if (parts.length === 1) {
				editor.lines[editor.row] = left + parts[0] + right
			} else {
				editor.lines[editor.row] = left + parts[0]
				editor.lines.splice(editor.row + 1, 0, ...parts.slice(1, -1), parts[parts.length - 1] + right)
			}
			editor.dirty = true
			editor.prompt = null
			nanoMsg(`[ Inserted ${parts.length} line${parts.length === 1 ? '' : 's'} ]`)
		} catch {
			editor.prompt = null
			nanoMsg('[ File not found ]')
		}
	}

	function nanoCursorPos(): void {
		if (!editor) return
		const chars = editor.lines.reduce((n, l) => n + l.length, 0) + Math.max(0, editor.lines.length - 1)
		const words = editor.lines
			.join(' ')
			.trim()
			.split(/\s+/)
			.filter(Boolean).length
		nanoMsg(
			`[ line ${editor.row + 1}/${editor.lines.length} (${Math.round(((editor.row + 1) / editor.lines.length) * 100)}%), col ${editor.col + 1}/${(editor.lines[editor.row] ?? '').length + 1}, char ${chars}, word ${words} ]`,
		)
	}

	function nanoPage(dir: -1 | 1): void {
		if (!editor || !term) return
		const page = Math.max(1, term.rows - 4)
		editor.row = Math.max(0, Math.min(editor.lines.length - 1, editor.row + dir * page))
		editor.col = Math.min(editor.col, (editor.lines[editor.row] ?? '').length)
		editor.cutAppending = false
		paintEditor()
	}

	function nanoDeleteForward(): void {
		if (!editor) return
		const line = editor.lines[editor.row] ?? ''
		if (editor.col < line.length) {
			editor.lines[editor.row] = line.slice(0, editor.col) + line.slice(editor.col + 1)
			editor.dirty = true
		} else if (editor.row < editor.lines.length - 1) {
			editor.lines[editor.row] = line + (editor.lines[editor.row + 1] ?? '')
			editor.lines.splice(editor.row + 1, 1)
			editor.dirty = true
		}
		editor.cutAppending = false
		paintEditor()
	}

	function nanoHome(): void {
		if (!editor) return
		editor.col = 0
		editor.cutAppending = false
		paintEditor()
	}

	function nanoEnd(): void {
		if (!editor) return
		editor.col = (editor.lines[editor.row] ?? '').length
		editor.cutAppending = false
		paintEditor()
	}

	/** Go to first line / last line of the buffer (document Home/End). */
	function nanoBufferStart(): void {
		if (!editor) return
		editor.row = 0
		editor.col = 0
		editor.cutAppending = false
		paintEditor()
	}

	function nanoBufferEnd(): void {
		if (!editor) return
		editor.row = Math.max(0, editor.lines.length - 1)
		editor.col = (editor.lines[editor.row] ?? '').length
		editor.cutAppending = false
		paintEditor()
	}

	/** Shell line: move caret to start / end and redraw (RTL-safe). */
	function shellLineHome(): void {
		if (cursor === 0) return
		cursor = 0
		redrawLine()
	}

	function shellLineEnd(): void {
		if (cursor === lineBuffer.length) return
		cursor = lineBuffer.length
		redrawLine()
	}

	/** Ctrl+← : jump left by shell word (readline-style). */
	function shellWordLeft(): void {
		if (cursor <= 0) return
		let i = cursor
		while (i > 0 && /\s/.test(lineBuffer[i - 1]!)) i--
		while (i > 0 && !/\s/.test(lineBuffer[i - 1]!)) i--
		cursor = i
		redrawLine()
	}

	/** Ctrl+→ : jump right by shell word. */
	function shellWordRight(): void {
		if (cursor >= lineBuffer.length) return
		let i = cursor
		while (i < lineBuffer.length && !/\s/.test(lineBuffer[i]!)) i++
		while (i < lineBuffer.length && /\s/.test(lineBuffer[i]!)) i++
		cursor = i
		redrawLine()
	}

	function shellHistoryPage(dir: -1 | 1): void {
		if (!history.length) return
		if (dir < 0) {
			// Up / PageUp: step back through history
			if (histIdx < 0 || histIdx >= history.length) histIdx = history.length - 1
			else if (histIdx > 0) histIdx--
			else return // already at oldest
		} else {
			// Down / PageDown
			if (histIdx >= 0 && histIdx < history.length - 1) histIdx++
			else {
				histIdx = history.length
				lineBuffer = ''
				cursor = 0
				redrawLine()
				return
			}
		}
		lineBuffer = history[histIdx] ?? ''
		cursor = lineBuffer.length
		redrawLine()
	}

	function nanoCtrlG(): void {
		if (!editor) return
		editor.prompt = { kind: 'help' }
		paintEditor()
	}

	function nanoCtrlO(): void {
		if (!editor) return
		editor.prompt = { kind: 'writeout', buffer: editor.path || '' }
		editor.message = ''
		paintEditor()
	}

	function nanoCtrlW(): void {
		if (!editor) return
		editor.prompt = { kind: 'search', buffer: editor.lastSearch || '' }
		editor.message = ''
		paintEditor()
	}

	function nanoCtrlR(): void {
		if (!editor) return
		editor.prompt = { kind: 'readfile', buffer: '' }
		editor.message = ''
		paintEditor()
	}

	/** ^C = cursor position (NOT discard). Cancels open prompt. */
	function nanoCtrlC(): void {
		if (!editor) return
		if (editor.prompt && editor.prompt.kind !== 'help') {
			editor.prompt = null
			nanoMsg('[ Cancelled ]')
			return
		}
		nanoCursorPos()
	}

	function nanoCtrlX(): void {
		if (!editor) return
		if (editor.prompt?.kind === 'help') {
			editor.prompt = null
			paintEditor()
			return
		}
		if (editor.prompt) {
			editor.prompt = null
			nanoMsg('[ Cancelled ]')
			return
		}
		nanoRequestExit()
	}

	/** Handle nano prompt input (writeout / search / goto / exit-save / …). */
	function nanoHandlePrompt(data: string): boolean {
		if (!editor?.prompt) return false
		const p = editor.prompt

		if (p.kind === 'help') {
			// Any key closes help (except we already handled ^X)
			editor.prompt = null
			paintEditor()
			return true
		}

		if (p.kind === 'exit-save') {
			if (data === '\u0003') {
				editor.prompt = null
				nanoMsg('[ Cancelled ]')
				return true
			}
			const ch = data.toLowerCase()
			if (ch === 'y') {
				editor.prompt = null
				if (!editor.path) {
					editor.exitAfterWrite = true
					editor.prompt = { kind: 'writeout', buffer: '' }
					paintEditor()
					return true
				}
				if (saveEditorFile()) exitNanoClean(`saved ${editor.path}`)
				else paintEditor()
				return true
			}
			if (ch === 'n') {
				exitNanoClean(editor.path ? `closed ${editor.path}` : 'closed New Buffer')
				return true
			}
			return true
		}

		// Text prompts: writeout / search / goto / readfile
		if (data === '\u0003') {
			editor.prompt = null
			nanoMsg('[ Cancelled ]')
			return true
		}
		if (data === '\r') {
			const buf = p.buffer
			if (p.kind === 'writeout') {
				editor.prompt = null
				if (!buf.trim()) {
					editor.exitAfterWrite = false
					nanoMsg('[ Cancelled ]')
					return true
				}
				const dest = os.resolvePath(buf.trim())
				if (saveEditorFile(dest)) {
					if (editor.exitAfterWrite) {
						editor.exitAfterWrite = false
						exitNanoClean(`saved ${editor.path}`)
					} else {
						paintEditor()
					}
				} else {
					editor.exitAfterWrite = false
					paintEditor()
				}
				return true
			}
			if (p.kind === 'search') {
				nanoSearch(buf)
				return true
			}
			if (p.kind === 'goto') {
				nanoGoto(buf)
				return true
			}
			if (p.kind === 'readfile') {
				nanoReadFile(buf)
				return true
			}
			return true
		}
		if (data === '\u007f' || data === '\b') {
			p.buffer = p.buffer.slice(0, -1)
			paintEditor()
			return true
		}
		if (data >= ' ' && data.length === 1 && !data.startsWith('\x1b')) {
			p.buffer += data
			paintEditor()
			return true
		}
		if (data.length > 1 && !data.startsWith('\x1b')) {
			p.buffer += data
			paintEditor()
			return true
		}
		return true
	}

	function cancelShellLine(showCaret = true): void {
		if (!term) return
		if (showCaret) term.write('^C')
		busy = false
		editor = null
		resetShellInput()
		prompt()
	}

	/** Insert clipboard/text into the shell line (or editor). */
	function pasteIntoShell(text: string): void {
		if (!term || !os) return
		if (pager) {
			// Paste into less search/goto prompt only
			if (pager.prompt?.kind === 'search' || pager.prompt?.kind === 'goto') {
				const flat = text.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ')
				pager.prompt.buffer += flat
				paintPager()
			}
			return
		}
		if (editor) {
			const flat = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
			for (const ch of flat) {
				if (ch === '\n') editorNewline()
				else if (ch >= ' ') editorInsert(ch)
			}
			return
		}
		if (busy) return
		const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
		const parts = normalized.split('\n')
		// Trailing empty part from final \n is not an extra command
		const lines = normalized.endsWith('\n') ? parts.slice(0, -1) : parts
		void (async () => {
			for (let i = 0; i < lines.length; i++) {
				if (busy) {
					// Wait for previous command to finish
					await new Promise<void>((r) => {
						const t = setInterval(() => {
							if (!busy) {
								clearInterval(t)
								r()
							}
						}, 10)
					})
				}
				const segment = lines[i]
				for (const ch of segment) {
					if (ch < ' ') continue
					if (cursor === lineBuffer.length) typeAtEnd(ch)
					else insertMid(ch)
				}
				// Every complete paste line (or all but last if no trailing \n) runs once
				const isLast = i === lines.length - 1
				const shouldRun = normalized.endsWith('\n') || !isLast
				if (shouldRun) {
					const line = lineBuffer
					lineBuffer = ''
					cursor = 0
					term.write('\r\n')
					await runLine(line)
				}
			}
		})()
	}

	async function pasteFromClipboard(): Promise<void> {
		try {
			const text = await navigator.clipboard.readText()
			if (text) pasteIntoShell(text)
		} catch {
			// Fallback: focus is on xterm; browser paste event may still work
			term?.write('\x1b[31m(clipboard permission denied — use browser paste)\x1b[0m')
			prompt()
			if (lineBuffer) term?.write(lineBuffer)
		}
	}

	/**
	 * Browser steals Ctrl+C/V/X and Home/End/Page keys (scrolls the lesson pane).
	 * Handle them here; return false so xterm/browser do not double-process.
	 */
	function onCustomKey(ev: KeyboardEvent): boolean {
		if (ev.type !== 'keydown') return true

		const ctrl = ev.ctrlKey || ev.metaKey
		const shift = ev.shiftKey
		const alt = ev.altKey
		const code = ev.code
		const key = ev.key

		// Ctrl+Shift+V → paste (Linux terminal convention); also Ctrl+Shift+Insert
		const isPaste =
			(ctrl && shift && (code === 'KeyV' || key === 'V' || key === 'v')) ||
			(shift && code === 'Insert' && ctrl)
		if (isPaste) {
			ev.preventDefault()
			ev.stopPropagation()
			void pasteFromClipboard()
			return false
		}

		// Ctrl+← / Ctrl+→ word navigation (shell + nano line)
		const isArrowLeft = code === 'ArrowLeft' || key === 'ArrowLeft'
		const isArrowRight = code === 'ArrowRight' || key === 'ArrowRight'
		if (ctrl && !alt && !shift && (isArrowLeft || isArrowRight)) {
			ev.preventDefault()
			ev.stopPropagation()
			if (pager) return false
			if (editor?.kind === 'nano') {
				// word jump in nano buffer line
				const line = editor.lines[editor.row] ?? ''
				if (isArrowLeft) {
					let i = editor.col
					while (i > 0 && /\s/.test(line[i - 1]!)) i--
					while (i > 0 && !/\s/.test(line[i - 1]!)) i--
					editor.col = i
				} else {
					let i = editor.col
					while (i < line.length && !/\s/.test(line[i]!)) i++
					while (i < line.length && /\s/.test(line[i]!)) i++
					editor.col = i
				}
				paintEditor()
				return false
			}
			if (editor) return false
			if (!busy) {
				if (isArrowLeft) shellWordLeft()
				else shellWordRight()
			}
			return false
		}

		// ── Home / End / PageUp / PageDown (browser would scroll the page) ──
		const isHome = code === 'Home' || key === 'Home'
		const isEnd = code === 'End' || key === 'End'
		const isPgUp = code === 'PageUp' || key === 'PageUp'
		const isPgDn = code === 'PageDown' || key === 'PageDown'

		if (isHome || isEnd || isPgUp || isPgDn) {
			// Always prevent page/lesson scroll while terminal has focus
			ev.preventDefault()
			ev.stopPropagation()

			if (pager) {
				const page = pagerPageH()
				if (isHome) {
					pager.top = 0
					paintPager()
				} else if (isEnd) {
					pager.top = pagerMaxTop()
					paintPager()
				} else if (isPgUp) pagerScroll(-page)
				else pagerScroll(page)
				return false
			}

			if (editor?.kind === 'nano') {
				if (isHome) {
					if (ctrl) nanoBufferStart()
					else nanoHome()
				} else if (isEnd) {
					if (ctrl) nanoBufferEnd()
					else nanoEnd()
				} else if (isPgUp) nanoPage(-1)
				else nanoPage(1)
				return false
			}

			if (editor?.kind === 'vim') {
				if (isHome) {
					editor.col = 0
					paintEditor()
				} else if (isEnd) {
					editor.col = (editor.lines[editor.row] ?? '').length
					paintEditor()
				} else if (isPgUp) {
					editor.row = Math.max(0, editor.row - Math.max(1, (term?.rows ?? 20) - 2))
					editor.col = Math.min(editor.col, (editor.lines[editor.row] ?? '').length)
					paintEditor()
				} else {
					editor.row = Math.min(
						editor.lines.length - 1,
						editor.row + Math.max(1, (term?.rows ?? 20) - 2),
					)
					editor.col = Math.min(editor.col, (editor.lines[editor.row] ?? '').length)
					paintEditor()
				}
				return false
			}

			// Shell input line
			if (!busy) {
				if (isHome) shellLineHome()
				else if (isEnd) shellLineEnd()
				else if (isPgUp) shellHistoryPage(-1)
				else shellHistoryPage(1)
			}
			return false
		}

		if (!ctrl && !alt) return true

		const isC = code === 'KeyC' || key === 'c' || key === 'C'
		const isX = code === 'KeyX' || key === 'x' || key === 'X'
		const isO = code === 'KeyO' || key === 'o' || key === 'O'
		const isS = code === 'KeyS' || key === 's' || key === 'S'
		const isV = code === 'KeyV' || key === 'v' || key === 'V'
		const isA = code === 'KeyA' || key === 'a' || key === 'A'
		const isE = code === 'KeyE' || key === 'e' || key === 'E'

		if (editor) {
			// Nano uses classic distro bindings; handle keys the browser would steal.
			if (editor.kind === 'nano') {
				const isG = code === 'KeyG' || key === 'g' || key === 'G'
				const isK = code === 'KeyK' || key === 'k' || key === 'K'
				const isU = code === 'KeyU' || key === 'u' || key === 'U'
				const isW = code === 'KeyW' || key === 'w' || key === 'W'
				const isR = code === 'KeyR' || key === 'r' || key === 'R'
				const isY = code === 'KeyY' || key === 'y' || key === 'Y'
				const isL = code === 'KeyL' || key === 'l' || key === 'L'
				const isD = code === 'KeyD' || key === 'd' || key === 'D'

				// Alt+G → go to line; Alt+\ / Alt+/ → buffer start/end (classic nano)
				if (alt && isG) {
					ev.preventDefault()
					ev.stopPropagation()
					editor.prompt = { kind: 'goto', buffer: '' }
					editor.message = ''
					paintEditor()
					return false
				}
				if (alt && (key === '\\' || code === 'Backslash')) {
					ev.preventDefault()
					ev.stopPropagation()
					nanoBufferStart()
					return false
				}
				if (alt && (key === '/' || code === 'Slash')) {
					ev.preventDefault()
					ev.stopPropagation()
					nanoBufferEnd()
					return false
				}

				if (!ctrl) return true

				const handle = (fn: () => void) => {
					ev.preventDefault()
					ev.stopPropagation()
					fn()
					return false as const
				}

				if (isX) return handle(() => nanoCtrlX())
				if (isO || isS) return handle(() => nanoCtrlO())
				if (isG) return handle(() => nanoCtrlG())
				if (isC) return handle(() => nanoCtrlC())
				if (isK) return handle(() => nanoCutLine())
				if (isU) return handle(() => nanoUncut())
				if (isW) return handle(() => nanoCtrlW())
				if (isR) return handle(() => nanoCtrlR())
				if (isA) return handle(() => nanoHome())
				if (isE) return handle(() => nanoEnd())
				if (isY) return handle(() => nanoPage(-1))
				if (isV && !shift) return handle(() => nanoPage(1))
				if (isL) return handle(() => paintEditor())
				if (isD) return handle(() => nanoDeleteForward())
				return true
			}

			// vim lab
			if (ctrl && isC) {
				ev.preventDefault()
				ev.stopPropagation()
				closeEditor(false)
				return false
			}
			if (ctrl && isX) {
				ev.preventDefault()
				ev.stopPropagation()
				closeEditor(true)
				return false
			}
			if (ctrl && (isO || isS)) {
				ev.preventDefault()
				ev.stopPropagation()
				if (saveEditorFile()) paintEditor()
				else term?.write(`\r\n\x1b[31msave failed\x1b[0m`)
				return false
			}
			return true
		}

		// Shell: Ctrl+A / Ctrl+E → line start / end
		if (ctrl && isA && !shift) {
			ev.preventDefault()
			ev.stopPropagation()
			if (!busy) shellLineHome()
			return false
		}
		if (ctrl && isE && !shift) {
			ev.preventDefault()
			ev.stopPropagation()
			if (!busy) shellLineEnd()
			return false
		}

		// Shell: Ctrl+C → interrupt / cancel line (must work even when busy)
		if (ctrl && isC && !shift) {
			ev.preventDefault()
			ev.stopPropagation()
			cancelShellLine(true)
			return false
		}

		// Shell: Ctrl+X → cancel line
		if (ctrl && isX && !shift) {
			ev.preventDefault()
			ev.stopPropagation()
			if (term) {
				term.write('^X')
				busy = false
				resetShellInput()
				prompt()
			}
			return false
		}

		// Shell: Ctrl+V (no shift) → paste as convenience
		if (ctrl && isV && !shift) {
			ev.preventDefault()
			ev.stopPropagation()
			void pasteFromClipboard()
			return false
		}

		return true
	}

	function editorInsert(ch: string): void {
		if (!editor) return
		const line = editor.lines[editor.row] ?? ''
		editor.lines[editor.row] = line.slice(0, editor.col) + ch + line.slice(editor.col)
		editor.col += ch.length
		editor.dirty = true
		editor.cutAppending = false
		paintEditor()
	}

	function editorBackspace(): void {
		if (!editor) return
		if (editor.col > 0) {
			const line = editor.lines[editor.row] ?? ''
			editor.lines[editor.row] = line.slice(0, editor.col - 1) + line.slice(editor.col)
			editor.col--
			editor.dirty = true
		} else if (editor.row > 0) {
			const prev = editor.lines[editor.row - 1] ?? ''
			const cur = editor.lines[editor.row] ?? ''
			editor.col = prev.length
			editor.lines[editor.row - 1] = prev + cur
			editor.lines.splice(editor.row, 1)
			editor.row--
			editor.dirty = true
		}
		editor.cutAppending = false
		paintEditor()
	}

	function editorNewline(): void {
		if (!editor) return
		const line = editor.lines[editor.row] ?? ''
		const left = line.slice(0, editor.col)
		const right = line.slice(editor.col)
		editor.lines[editor.row] = left
		editor.lines.splice(editor.row + 1, 0, right)
		editor.row++
		editor.col = 0
		editor.dirty = true
		editor.cutAppending = false
		paintEditor()
	}

	function handleEditorData(data: string): void {
		if (!editor || !term) return

		// ── GNU nano ──
		if (editor.kind === 'nano') {
			handleNanoData(data)
			return
		}

		// ── vim (lab) ──
		handleVimData(data)
	}

	function vimClampCol(): void {
		if (!editor) return
		const len = (editor.lines[editor.row] ?? '').length
		// in normal mode cursor on last char (not past end) when line non-empty
		if (editor.mode === 'normal' && len > 0) {
			editor.col = Math.min(editor.col, len - 1)
		} else {
			editor.col = Math.min(editor.col, len)
		}
		if (editor.col < 0) editor.col = 0
	}

	function vimMsg(msg: string): void {
		if (!editor) return
		editor.message = msg
		paintEditor()
	}

	function vimDeleteLine(count = 1): void {
		if (!editor) return
		vimPushUndo()
		const n = Math.min(count, editor.lines.length - editor.row)
		const yanked = editor.lines.slice(editor.row, editor.row + n)
		editor.yankBuffer = yanked.join('\n')
		if (editor.lines.length <= n) {
			editor.lines = ['']
			editor.row = 0
			editor.col = 0
		} else {
			editor.lines.splice(editor.row, n)
			if (editor.row >= editor.lines.length) editor.row = editor.lines.length - 1
			editor.col = 0
		}
		editor.dirty = true
		editor.pending = ''
		editor.countBuf = ''
		vimClampCol()
		paintEditor()
	}

	function vimYankLine(count = 1): void {
		if (!editor) return
		const n = Math.min(count, editor.lines.length - editor.row)
		const yanked = editor.lines.slice(editor.row, editor.row + n)
		editor.yankBuffer = yanked.join('\n')
		editor.pending = ''
		editor.countBuf = ''
		editor.message = n === 1 ? '1 line yanked' : `${n} lines yanked`
		paintEditor()
	}

	function vimPut(after: boolean): void {
		if (!editor) return
		vimPushUndo()
		const text = editor.yankBuffer
		const multiLine = text.includes('\n') || text.length !== 1
		if (!multiLine && text.length === 1) {
			const line = editor.lines[editor.row] ?? ''
			const at = after ? editor.col + 1 : editor.col
			editor.lines[editor.row] = line.slice(0, at) + text + line.slice(at)
			editor.col = at
		} else {
			const parts = text.split('\n')
			const at = after ? editor.row + 1 : editor.row
			editor.lines.splice(at, 0, ...parts)
			editor.row = Math.min(editor.lines.length - 1, at)
			editor.col = 0
		}
		editor.dirty = true
		editor.message = ''
		paintEditor()
	}

	function vimSearch(dir: 1 | -1): void {
		if (!editor || !editor.vimSearch) {
			vimMsg('E35: No previous regular expression')
			return
		}
		const q = editor.vimSearch
		const n = editor.lines.length
		for (let step = 1; step <= n; step++) {
			const r = (editor.row + dir * step + n * 10) % n
			const idx = dir > 0
				? (editor.lines[r] ?? '').indexOf(q, r === editor.row ? editor.col + 1 : 0)
				: (editor.lines[r] ?? '').lastIndexOf(q, r === editor.row ? editor.col - 1 : undefined)
			if (idx >= 0) {
				editor.row = r
				editor.col = idx
				editor.message = ''
				paintEditor()
				return
			}
		}
		vimMsg(`E486: Pattern not found: ${q}`)
	}

	function handleVimData(data: string): void {
		if (!editor || !term) return
		editor.message = ''

		// Ctrl+C / Ctrl+X → quit variants (lab convenience)
		if (data === '\u0003') {
			if (editor.dirty) vimMsg('E37: No write since last change (add ! to override)')
			else closeEditor(false)
			return
		}

		if (editor.mode === 'cmdline') {
			if (data === '\r') {
				const c = editor.cmd.trim()
				const parts = c.split(/\s+/)
				const head = parts[0] ?? ''
				if (head === 'w' || head === 'write') {
					const dest = parts[1]
					if (dest) editor.path = dest.startsWith('/') || dest.startsWith('~')
						? (os?.resolvePath(dest) ?? dest)
						: (os?.resolvePath(dest) ?? dest)
					if (!editor.path) {
						editor.mode = 'normal'
						editor.cmd = ''
						vimMsg('E32: No file name')
						return
					}
					if (saveEditorFile()) {
						editor.mode = 'normal'
						editor.cmd = ''
						editor.message = `"${displayPath(editor.path)}" ${editor.lines.length}L written`
						paintEditor()
					} else {
						editor.mode = 'normal'
						editor.cmd = ''
						vimMsg('E212: Can\'t open file for writing')
					}
				} else if (head === 'q' || head === 'quit') {
					if (editor.dirty) {
						editor.mode = 'normal'
						editor.cmd = ''
						vimMsg('E37: No write since last change (add ! to override)')
					} else closeEditor(false)
				} else if (head === 'q!' || head === 'quit!') {
					closeEditor(false)
				} else if (head === 'wq' || head === 'x' || head === 'xit') {
					if (!editor.path) {
						editor.mode = 'normal'
						editor.cmd = ''
						vimMsg('E32: No file name')
					} else closeEditor(true)
				} else if (c === 'set number' || c === 'set nu') {
					editor.showLineNumbers = true
					editor.mode = 'normal'
					editor.cmd = ''
					paintEditor()
				} else if (c === 'set nonumber' || c === 'set nonu') {
					editor.showLineNumbers = false
					editor.mode = 'normal'
					editor.cmd = ''
					paintEditor()
				} else if (c === 'help' || c === 'h') {
					editor.mode = 'normal'
					editor.cmd = ''
					vimMsg('lab vim: i a o O A I | hjkl 0 $ gg G | dd yy p | /n | :w :q :wq :set number')
				} else if (c.startsWith('/')) {
					editor.vimSearch = c.slice(1)
					editor.mode = 'normal'
					editor.cmd = ''
					vimSearch(1)
				} else {
					editor.mode = 'normal'
					editor.cmd = ''
					vimMsg(`E492: Not an editor command: ${c}`)
				}
				return
			}
			if (data === '\u001b') {
				editor.mode = 'normal'
				editor.cmd = ''
				paintEditor()
				return
			}
			if (data === '\u007f' || data === '\b') {
				editor.cmd = editor.cmd.slice(0, -1)
				paintEditor()
				return
			}
			if (data >= ' ' && data.length === 1) {
				editor.cmd += data
				paintEditor()
			}
			return
		}

		if (editor.mode === 'normal') {
			// count digits (not after pending op that needs count first — vim allows 3dd)
			if (/^[1-9]$/.test(data) || (data === '0' && editor.countBuf)) {
				editor.countBuf += data
				paintEditor()
				return
			}

			// pending operators
			if (editor.pending === 'd') {
				if (data === 'd') {
					vimDeleteLine(vimTakeCount())
					return
				}
				editor.pending = ''
				editor.countBuf = ''
			}
			if (editor.pending === 'y') {
				if (data === 'y') {
					vimYankLine(vimTakeCount())
					return
				}
				editor.pending = ''
				editor.countBuf = ''
			}
			if (editor.pending === 'g') {
				if (data === 'g') {
					const c = vimTakeCount()
					editor.row = c > 1 ? Math.min(editor.lines.length - 1, c - 1) : 0
					editor.col = 0
					editor.pending = ''
					paintEditor()
					return
				}
				editor.pending = ''
				editor.countBuf = ''
			}

			if (data === 'u') {
				vimUndo()
				return
			}
			if (data === 'i') {
				vimPushUndo()
				editor.mode = 'insert'
				editor.countBuf = ''
				paintEditor()
				return
			}
			if (data === 'I') {
				vimPushUndo()
				editor.col = 0
				editor.mode = 'insert'
				paintEditor()
				return
			}
			if (data === 'a') {
				vimPushUndo()
				const len = (editor.lines[editor.row] ?? '').length
				editor.col = Math.min(editor.col + 1, len)
				editor.mode = 'insert'
				paintEditor()
				return
			}
			if (data === 'A') {
				vimPushUndo()
				editor.col = (editor.lines[editor.row] ?? '').length
				editor.mode = 'insert'
				paintEditor()
				return
			}
			if (data === 'o') {
				vimPushUndo()
				editor.lines.splice(editor.row + 1, 0, '')
				editor.row++
				editor.col = 0
				editor.mode = 'insert'
				editor.dirty = true
				paintEditor()
				return
			}
			if (data === 'O') {
				vimPushUndo()
				editor.lines.splice(editor.row, 0, '')
				editor.col = 0
				editor.mode = 'insert'
				editor.dirty = true
				paintEditor()
				return
			}
			if (data === ':') {
				editor.mode = 'cmdline'
				editor.cmd = ''
				paintEditor()
				return
			}
			if (data === '/') {
				editor.mode = 'cmdline'
				editor.cmd = '/'
				paintEditor()
				return
			}
			if (data === 'n') {
				vimSearch(1)
				return
			}
			if (data === 'N') {
				vimSearch(-1)
				return
			}
			if (data === 'd') {
				editor.pending = 'd'
				paintEditor()
				return
			}
			if (data === 'y') {
				editor.pending = 'y'
				paintEditor()
				return
			}
			if (data === 'g') {
				editor.pending = 'g'
				paintEditor()
				return
			}
			if (data === 'p') {
				vimPut(true)
				return
			}
			if (data === 'P') {
				vimPut(false)
				return
			}
			if (data === '0' || data === '^' || data === '\x1b[H') {
				editor.col = 0
				paintEditor()
				return
			}
			if (data === '$' || data === '\x1b[F') {
				const len = (editor.lines[editor.row] ?? '').length
				editor.col = len > 0 ? len - 1 : 0
				paintEditor()
				return
			}
			if (data === 'w') {
				const line = editor.lines[editor.row] ?? ''
				let c = editor.col + 1
				while (c < line.length && /\s/.test(line[c])) c++
				while (c < line.length && !/\s/.test(line[c])) c++
				if (c >= line.length && editor.row < editor.lines.length - 1) {
					editor.row++
					editor.col = 0
				} else editor.col = Math.min(c, Math.max(0, line.length - 1))
				paintEditor()
				return
			}
			if (data === 'b') {
				const line = editor.lines[editor.row] ?? ''
				let c = editor.col - 1
				while (c > 0 && /\s/.test(line[c])) c--
				while (c > 0 && !/\s/.test(line[c - 1])) c--
				editor.col = Math.max(0, c)
				paintEditor()
				return
			}
			if (data === 'x') {
				const line = editor.lines[editor.row] ?? ''
				if (editor.col < line.length) {
					vimPushUndo()
					editor.yankBuffer = line[editor.col]
					editor.lines[editor.row] = line.slice(0, editor.col) + line.slice(editor.col + 1)
					editor.dirty = true
					vimClampCol()
					paintEditor()
				}
				return
			}
			if (data === 'X') {
				if (editor.col > 0) {
					vimPushUndo()
					const line = editor.lines[editor.row] ?? ''
					editor.yankBuffer = line[editor.col - 1]
					editor.lines[editor.row] = line.slice(0, editor.col - 1) + line.slice(editor.col)
					editor.col--
					editor.dirty = true
					paintEditor()
				}
				return
			}
			if (data === 'h' || data === '\x1b[D') {
				const n = vimTakeCount()
				editor.col = Math.max(0, editor.col - n)
				paintEditor()
				return
			}
			if (data === 'l' || data === '\x1b[C') {
				const n = vimTakeCount()
				const maxC = Math.max(0, (editor.lines[editor.row] ?? '').length - 1)
				editor.col = Math.min(maxC, editor.col + n)
				paintEditor()
				return
			}
			if (data === 'k' || data === '\x1b[A') {
				const n = vimTakeCount()
				editor.row = Math.max(0, editor.row - n)
				vimClampCol()
				paintEditor()
				return
			}
			if (data === 'j' || data === '\x1b[B') {
				const n = vimTakeCount()
				editor.row = Math.min(editor.lines.length - 1, editor.row + n)
				vimClampCol()
				paintEditor()
				return
			}
			if (data === 'G') {
				const c = editor.countBuf ? vimTakeCount() : 0
				editor.row = c > 0 ? Math.min(editor.lines.length - 1, c - 1) : editor.lines.length - 1
				editor.col = 0
				vimClampCol()
				paintEditor()
				return
			}
			// Ctrl+F / Ctrl+B
			if (data === '\u0006' || data === '\x1b[6~') {
				const page = Math.max(1, (term.rows ?? 24) - 4)
				editor.row = Math.min(editor.lines.length - 1, editor.row + page)
				vimClampCol()
				paintEditor()
				return
			}
			if (data === '\u0002' || data === '\x1b[5~') {
				const page = Math.max(1, (term.rows ?? 24) - 4)
				editor.row = Math.max(0, editor.row - page)
				vimClampCol()
				paintEditor()
				return
			}
			if (data === 'Z') {
				if (editor.pending === 'Z') {
					closeEditor(true) // ZZ
					return
				}
				editor.pending = 'Z'
				paintEditor()
				return
			}
			if (editor.pending === 'Z') {
				if (data === 'Q') {
					closeEditor(false) // ZQ
					return
				}
				editor.pending = ''
			}
			return
		}

		// insert mode
		if (data === '\u001b') {
			editor.mode = 'normal'
			editor.col = Math.max(0, editor.col - 1)
			vimClampCol()
			paintEditor()
			return
		}
		if (data === '\r') {
			editorNewline()
			return
		}
		if (data === '\u007f' || data === '\b') {
			editorBackspace()
			return
		}
		if (data === '\x1b[A') {
			editor.row = Math.max(0, editor.row - 1)
			vimClampCol()
			paintEditor()
			return
		}
		if (data === '\x1b[B') {
			editor.row = Math.min(editor.lines.length - 1, editor.row + 1)
			vimClampCol()
			paintEditor()
			return
		}
		if (data === '\x1b[D') {
			editor.col = Math.max(0, editor.col - 1)
			paintEditor()
			return
		}
		if (data === '\x1b[C') {
			editor.col = Math.min((editor.lines[editor.row] ?? '').length, editor.col + 1)
			paintEditor()
			return
		}
		if (data >= ' ' && !data.startsWith('\x1b')) {
			if (data.length > 1) {
				for (const ch of data) {
					if (ch >= ' ') editorInsert(ch)
				}
			} else {
				editorInsert(data)
			}
		}
	}

	/** Classic GNU nano key handling (distro default, not --modernbindings). */
	function handleNanoData(data: string): void {
		if (!editor || !term) return

		// Prompt takes priority
		if (editor.prompt) {
			// Ctrl sequences while prompting
			if (data === '\u0018') {
				nanoCtrlX()
				return
			}
			if (data === '\u0003') {
				nanoCtrlC()
				return
			}
			if (data === '\u0007') {
				nanoCtrlG()
				return
			}
			nanoHandlePrompt(data)
			return
		}

		nanoClearMsg()

		// Control characters (also partially via customKeyHandler)
		if (data === '\u0018') {
			// ^X
			nanoCtrlX()
			return
		}
		if (data === '\u000f' || data === '\u0013') {
			// ^O Write Out / ^S Save
			nanoCtrlO()
			return
		}
		if (data === '\u0007') {
			// ^G Help
			nanoCtrlG()
			return
		}
		if (data === '\u0003') {
			// ^C Cur Pos
			nanoCtrlC()
			return
		}
		if (data === '\u000b') {
			// ^K Cut
			nanoCutLine()
			return
		}
		if (data === '\u0015') {
			// ^U Uncut
			nanoUncut()
			return
		}
		if (data === '\u0017') {
			// ^W Where Is
			nanoCtrlW()
			return
		}
		if (data === '\u0012') {
			// ^R Read File
			nanoCtrlR()
			return
		}
		if (data === '\u0001') {
			// ^A Home
			nanoHome()
			return
		}
		if (data === '\u0005') {
			// ^E End
			nanoEnd()
			return
		}
		if (data === '\u0019') {
			// ^Y Page up
			nanoPage(-1)
			return
		}
		if (data === '\u0016') {
			// ^V Page down
			nanoPage(1)
			return
		}
		if (data === '\u000c') {
			// ^L Refresh
			paintEditor()
			return
		}
		if (data === '\u0004') {
			// ^D Delete
			nanoDeleteForward()
			return
		}
		if (data === '\u001f' || data === '\u001d') {
			// ^_ Go To Line (and some terminals)
			editor.prompt = { kind: 'goto', buffer: '' }
			paintEditor()
			return
		}
		if (data === '\u001c') {
			// ^\ Replace — not fully implemented; message like nano stubs
			nanoMsg('[ Replace not implemented in lab nano — use search ^W ]')
			return
		}
		if (data === '\u0014') {
			// ^T To Spell
			nanoMsg('[ To Spell is not available in lab nano ]')
			return
		}
		if (data === '\n' || data === '\u000a') {
			// ^J Justify
			nanoMsg('[ Justify is not available in lab nano ]')
			return
		}

		// Enter
		if (data === '\r') {
			editor.cutAppending = false
			editorNewline()
			return
		}
		// Backspace
		if (data === '\u007f' || data === '\b' || data === '\u0008') {
			editor.cutAppending = false
			editorBackspace()
			return
		}
		// Arrows / Home / End / PgUp / PgDn / Delete
		if (data === '\x1b[A' || data === '\x1bOA') {
			editor.row = Math.max(0, editor.row - 1)
			editor.col = Math.min(editor.col, (editor.lines[editor.row] ?? '').length)
			editor.cutAppending = false
			paintEditor()
			return
		}
		if (data === '\x1b[B' || data === '\x1bOB') {
			editor.row = Math.min(editor.lines.length - 1, editor.row + 1)
			editor.col = Math.min(editor.col, (editor.lines[editor.row] ?? '').length)
			editor.cutAppending = false
			paintEditor()
			return
		}
		if (data === '\x1b[D' || data === '\x1bOD') {
			if (editor.col > 0) editor.col--
			else if (editor.row > 0) {
				editor.row--
				editor.col = (editor.lines[editor.row] ?? '').length
			}
			editor.cutAppending = false
			paintEditor()
			return
		}
		if (data === '\x1b[C' || data === '\x1bOC') {
			const len = (editor.lines[editor.row] ?? '').length
			if (editor.col < len) editor.col++
			else if (editor.row < editor.lines.length - 1) {
				editor.row++
				editor.col = 0
			}
			editor.cutAppending = false
			paintEditor()
			return
		}
		// Home / End — many encodings (normal + application cursor mode)
		if (
			data === '\x1b[H' ||
			data === '\x1b[1~' ||
			data === '\x1b[7~' ||
			data === '\x1bOH' ||
			data === '\x1b[1;2H' // Shift+Home → still line home
		) {
			nanoHome()
			return
		}
		if (
			data === '\x1b[F' ||
			data === '\x1b[4~' ||
			data === '\x1b[8~' ||
			data === '\x1bOF' ||
			data === '\x1b[1;2F'
		) {
			nanoEnd()
			return
		}
		// Ctrl+Home / Ctrl+End → buffer start/end
		if (data === '\x1b[1;5H' || data === '\x1b[1;5~') {
			nanoBufferStart()
			return
		}
		if (data === '\x1b[1;5F' || data === '\x1b[4;5~') {
			nanoBufferEnd()
			return
		}
		// Page Up / Page Down
		if (data === '\x1b[5~' || data === '\x1b[5;2~') {
			nanoPage(-1)
			return
		}
		if (data === '\x1b[6~' || data === '\x1b[6;2~') {
			nanoPage(1)
			return
		}
		if (data === '\x1b[3~') {
			nanoDeleteForward()
			return
		}
		// Alt+G → goto; Alt+\ → top; Alt+/ → bottom (classic nano)
		if (data === '\x1bg' || data === '\x1bG') {
			editor.prompt = { kind: 'goto', buffer: '' }
			paintEditor()
			return
		}
		if (data === '\x1b\\' || data === '\x1b\x1c') {
			nanoBufferStart()
			return
		}
		if (data === '\x1b/' || data === '\x1b?') {
			nanoBufferEnd()
			return
		}

		// Printable / paste
		if (data >= ' ' && !data.startsWith('\x1b')) {
			editor.cutAppending = false
			if (data.length > 1) {
				for (const ch of data) {
					if (ch === '\n' || ch === '\r') editorNewline()
					else if (ch >= ' ') editorInsert(ch)
				}
			} else {
				editorInsert(data)
			}
		}
	}

	/**
	 * Submit the current input line once. Clears the buffer immediately so a
	 * second Enter / \r\n paste cannot re-run the same command.
	 */
	function submitLine(raw?: string): void {
		if (!term || !os || busy || editor) return
		const line = raw !== undefined ? raw : lineBuffer
		// Clear before async work — prevents double-run on repeated Enter
		lineBuffer = ''
		cursor = 0
		histIdx = history.length
		term.write('\r\n')
		void runLine(line)
	}

	async function runLine(line: string): Promise<void> {
		if (!term || !os || editor || pager) return
		if (busy) return
		busy = true
		let openedEditor = false
		try {
			const trimmed = line.trim()
			if (trimmed === 'clear') {
				term.clear()
			} else if (trimmed) {
				history.push(line)
				histIdx = history.length
				const tokens = tokenize(trimmed)
				const cmd = tokens[0]
				const fileArg = tokens[1]

				if (cmd === 'nano' || cmd === 'vim' || cmd === 'vi') {
					// Real nano allows no filename (New Buffer); vim lab still prefers a path
					if (cmd === 'nano') {
						openEditor('nano', fileArg ?? '')
						openedEditor = true
						return
					}
					if (fileArg) {
						openEditor('vim', os.resolvePath(fileArg))
						openedEditor = true
						return
					}
					term.write(`\x1b[31m${cmd}: missing file operand\x1b[0m\r\n`)
				} else if (cmd === 'less' || cmd === 'more') {
					if (!fileArg) {
						term.write(
							`\x1b[31m${cmd}: missing filename (try: ${cmd} FILE)\x1b[0m\r\n`,
						)
					} else {
						openPager(fileArg)
						if (pager) {
							openedEditor = true // keep busy; pager owns the UI
							return
						}
					}
				} else if (cmd === 'systemctl' || cmd === 'journalctl' || cmd === 'man') {
					// Capture output and open full-screen less (like real systemd $PAGER)
					let stdout = ''
					let stderr = ''
					await os.run(line, {
						onStdout: (s: string) => {
							stdout += s
						},
						onStderr: (s: string) => {
							stderr += s
						},
					})
					if (stderr) term.write(`\x1b[31m${stderr}\x1b[0m`)
					if (shouldPageCommand(cmd, tokens, stdout)) {
						const title =
							cmd === 'man'
								? `man ${tokens.slice(1).join(' ') || 'man'}`
								: tokens.join(' ')
						openPagerContent(title, stdout)
						if (pager) {
							openedEditor = true
							return
						}
					} else if (stdout) {
						term.write(stdout)
					}
				} else {
					const result = await os.run(line)
					// crontab -e → open nano on spool file
					if (
						result.exitCode === 42 &&
						typeof result.stdout === 'string' &&
						result.stdout.startsWith('__NANOOS_EDIT__:')
					) {
						const body = result.stdout.trim().replace(/\n$/, '')
						const parts = body.split(':')
						// __NANOOS_EDIT__:nano:/path/with/colons?
						const kind = parts[1] === 'vim' ? 'vim' : 'nano'
						const editPath = parts.slice(2).join(':')
						openEditor(kind, editPath)
						openedEditor = true
						return
					}
				}
			}
		} catch (e) {
			term.write(`\x1b[31m${String(e)}\x1b[0m\r\n`)
		} finally {
			if (!openedEditor && !editor && !pager) {
				busy = false
				resetShellInput()
				prompt()
			}
		}
	}

	async function doInject(cmd: string): Promise<void> {
		if (!term || !ready || busy || editor || pager) return
		// Show the command, then submit once (submitLine writes \r\n itself)
		term.write(cmd)
		submitLine(cmd)
	}

	$effect(() => {
		if (inject && inject.id !== lastInjectId && ready) {
			lastInjectId = inject.id
			void doInject(inject.cmd)
		}
	})

	$effect(() => {
		const id = theme.current
		if (ready) applyTermTheme(id)
	})

	/** After hide/show, xterm dimensions are 0 — must fit + refresh + focus */
	function refitVisible(): void {
		if (!term || !fit || !host) return
		// Double rAF: wait for layout after display:none → visible
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				try {
					const w = host!.clientWidth
					const h = host!.clientHeight
					if (w < 2 || h < 2) return
					fit.fit()
					term.refresh(0, Math.max(0, term.rows - 1))
					if (pager) paintPager()
					else if (editor) paintEditor()
					else {
						// Ensure cursor is on a sane prompt line after reopen
						term.scrollToBottom()
						term.focus()
					}
				} catch {
					/* ignore */
				}
			})
		})
	}

	$effect(() => {
		if (!ready) return
		if (!visible) {
			// Closing the pane: drop editor/pager so shell is usable after reopen
			if (editor) {
				editor = null
				busy = false
				resetShellInput()
			}
			if (pager) {
				pager = null
				busy = false
				resetShellInput()
			}
			return
		}
		refitVisible()
	})

	onMount(() => {
		let cancelled = false

		void (async () => {
			if (!host) return
			const [{ Terminal }, { FitAddon }, { FakeShell, completeLine }] = await Promise.all([
				import('xterm'),
				import('xterm-addon-fit'),
				import('$lib/fakeshell'),
			])
			await import('xterm/css/xterm.css')
			if (cancelled || !host) return

			// Ensure Vazir Code metrics are ready before xterm measures cells
			const termFont =
				'"Vazir Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
			try {
				if (document.fonts?.load) {
					await document.fonts.load(`14px ${termFont}`)
					await document.fonts.ready
				}
			} catch {
				/* ignore — fall back to system mono metrics */
			}
			if (cancelled || !host) return

			const initial = theme.current
			term = new Terminal({
				cursorBlink: true,
				fontFamily: termFont,
				fontSize: 14,
				lineHeight: 1.25,
				theme: { ...TERM_THEMES[initial] },
				convertEol: true,
				// RTL for output; input line edits avoid full-line redraw to prevent flicker
				bidi: true,
				bidiLatinIslands: true,
				bidiKeepGuillemetsAsTyped: true,
				bidiStripZwOnPaste: false,
				// Reduce paint cost while typing
				screenReaderMode: false,
			})
			fit = new FitAddon()
			term.loadAddon(fit)
			term.open(host)
			fit.fit()
			lastTheme = initial

			// Intercept Ctrl+X/O/S before the browser steals them (cut/open/save)
			term.attachCustomKeyEventHandler(onCustomKey)

			// Debounce fit — parent layout thrash was causing visible flicker.
			// After fit, re-paint full-screen UIs so nano/vim/less match new cols×rows.
			ro = new ResizeObserver(() => {
				if (fitTimer) clearTimeout(fitTimer)
				fitTimer = setTimeout(() => {
					try {
						const w = host!.clientWidth
						const h = host!.clientHeight
						if (w < 2 || h < 2) return
						fit?.fit()
						term?.refresh(0, Math.max(0, (term?.rows ?? 1) - 1))
						if (editor) paintEditor()
						else if (pager) paintPager()
					} catch {
						/* ignore */
					}
				}, 80)
			})
			ro.observe(host)

			os = new FakeShell()
			os.onConsole((stream: string, text: string) => {
				if (!term || editor || pager) return
				if (stream === 'system') term.write(`\x1b[90m${text}\x1b[0m`)
				else if (stream === 'stderr') term.write(`\x1b[31m${text}\x1b[0m`)
				else {
					// Don't echo interactive editor markers
					if (text.startsWith('__NANOOS_EDIT__')) return
					term.write(text)
				}
			})

			onStatus?.('در حال راه‌اندازی FakeShell…')
			await os.boot()
			if (cancelled) return
			onStatus?.(`${os.info.name} ${os.info.version} · آماده`)
			prompt()
			term.focus()
			ready = true

			// Fake cron daemon: check every 15s for due jobs (* * * * * etc.)
			const runCronTick = () => {
				if (!os || !term || !ready || editor || pager || busy) return
				void (async () => {
					try {
						const notes = (await os.runDueCronJobs()) as string[]
						if (notes?.length) {
							for (const n of notes) {
								term.write(`\r\n\x1b[90m# ${n}\x1b[0m`)
							}
							// re-show prompt if we were idle
							if (!busy && !editor && !pager) {
								prompt()
								if (lineBuffer) term.write(lineBuffer)
							}
						}
					} catch {
						/* ignore */
					}
				})()
			}
			cronTimer = setInterval(runCronTick, 15_000)
			// First tick shortly after boot so @reboot / current minute can fire
			setTimeout(runCronTick, 2_000)

			// Browser paste (right-click / menu / some Ctrl+V paths)
			term.textarea?.addEventListener('paste', (ev: ClipboardEvent) => {
				ev.preventDefault()
				ev.stopPropagation()
				const text = ev.clipboardData?.getData('text/plain')
				if (text) pasteIntoShell(text)
			})

			term.onData((data: string) => {
				if (!term || !os) return
				if (pager) {
					if (data === '\u0003') {
						closePager()
						return
					}
					handlePagerData(data)
					return
				}
				if (editor) {
					handleEditorData(data)
					return
				}

				// Ctrl+C must work even while a command is "busy"
				if (data === '\u0003') {
					cancelShellLine(true)
					return
				}

				if (busy) return

				// Enter — some platforms send \r, \n, or \r\n (never run twice)
				if (data === '\r' || data === '\n' || data === '\r\n') {
					submitLine()
					return
				}

				// Paste / multi-char (not ESC sequences, not a lone line-ending)
				if (data.length > 1 && !data.startsWith('\x1b')) {
					// If paste ends with Enter, strip trailing newlines and submit once
					const normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
					if (normalized.endsWith('\n') && !normalized.slice(0, -1).includes('\n')) {
						// single line + enter
						const line = normalized.replace(/\n+$/, '')
						for (const ch of line) {
							if (ch >= ' ') {
								if (cursor === lineBuffer.length) typeAtEnd(ch)
								else insertMid(ch)
							}
						}
						submitLine()
						return
					}
					pasteIntoShell(data)
					return
				}

				if (data === '\u007f' || data === '\b') {
					backspace()
					return
				}

				if (data === '\t') {
					const result = completeLine(lineBuffer, os.workingDirectory, os.vfs)
					if (result.candidates.length === 1) {
						const prev = lineBuffer
						lineBuffer = result.line
						cursor = lineBuffer.length
						if (lineBuffer.startsWith(prev) && cursor === lineBuffer.length) {
							term.write(lineBuffer.slice(prev.length))
						} else {
							redrawLine()
						}
					} else if (result.candidates.length > 1) {
						if (result.line !== lineBuffer) {
							lineBuffer = result.line
							cursor = lineBuffer.length
						}
						term.write('\r\n' + result.candidates.join('  ') + '\r\n')
						prompt()
						term.write(lineBuffer)
					}
					return
				}

				if (data === '\u000c') {
					term.clear()
					prompt()
					term.write(lineBuffer)
					return
				}

				if (data === '\u0001') {
					// Ctrl+A → start of line
					shellLineHome()
					return
				}
				if (data === '\u0005') {
					// Ctrl+E → end of line
					shellLineEnd()
					return
				}

				if (data.startsWith('\x1b')) {
					if (data === '\x1b[A' || data === '\x1bOA') {
						shellHistoryPage(-1)
						return
					}
					if (data === '\x1b[B' || data === '\x1bOB') {
						shellHistoryPage(1)
						return
					}
					if (data === '\x1b[D' || data === '\x1bOD') {
						if (cursor > 0) {
							cursor--
							redrawLine()
						}
						return
					}
					if (data === '\x1b[C' || data === '\x1bOC') {
						if (cursor < lineBuffer.length) {
							cursor++
							redrawLine()
						}
						return
					}
					// Ctrl+← / Ctrl+→ (and variants)
					if (
						data === '\x1b[1;5D' ||
						data === '\x1b[5D' ||
						data === '\x1b[1;5A' || // some terminals
						data === '\x1b\x1b[D' ||
						data === '\x1b[1;3D' // Alt+Left fallback
					) {
						shellWordLeft()
						return
					}
					if (
						data === '\x1b[1;5C' ||
						data === '\x1b[5C' ||
						data === '\x1b\x1b[C' ||
						data === '\x1b[1;3C'
					) {
						shellWordRight()
						return
					}
					// Home / End (all common CSI forms)
					if (
						data === '\x1b[H' ||
						data === '\x1b[1~' ||
						data === '\x1b[7~' ||
						data === '\x1bOH'
					) {
						shellLineHome()
						return
					}
					if (
						data === '\x1b[F' ||
						data === '\x1b[4~' ||
						data === '\x1b[8~' ||
						data === '\x1bOF'
					) {
						shellLineEnd()
						return
					}
					// Page Up / Page Down → history (like many shells)
					if (data === '\x1b[5~') {
						shellHistoryPage(-1)
						return
					}
					if (data === '\x1b[6~') {
						shellHistoryPage(1)
						return
					}
					return
				}

				if (data >= ' ') {
					if (cursor === lineBuffer.length) typeAtEnd(data)
					else insertMid(data)
				}
			})
		})()

		return () => {
			cancelled = true
		}
	})

	onDestroy(() => {
		if (fitTimer) clearTimeout(fitTimer)
		if (cronTimer) clearInterval(cronTimer)
		ro?.disconnect()
		term?.dispose()
	})
</script>

<div class="term-wrap" bind:this={host}></div>

<style>
	.term-wrap {
		width: 100%;
		height: 100%;
		/* Never force a min taller than the pane — that blew up stacked layout */
		min-width: 0;
		min-height: 0;
		max-width: 100%;
		max-height: 100%;
		padding: 0.5rem;
		box-sizing: border-box;
		background: var(--term-bg);
		overflow: hidden;
		/* Size containment only — strict + min-height was expanding parents */
		contain: size layout;
		font-family: var(--mono);
	}

	.term-wrap :global(.xterm) {
		height: 100%;
		max-width: 100%;
		overflow: hidden;
		font-family: var(--mono);
	}

	.term-wrap :global(.xterm-viewport) {
		overflow-y: auto !important;
	}

	/* Avoid CSS transition on background while typing */
	.term-wrap :global(.xterm-screen) {
		transition: none !important;
	}
</style>
