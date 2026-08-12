/**
 * Mini Bash helpers for FakeShell lab: printf/print formatting,
 * variable expansion, and a line-oriented script runner support.
 */

export interface ScriptContext {
	/** $0 */
	name: string
	/** $1..$n */
	args: string[]
	/** $? */
	lastExit: number
	/** Set when `exit` is executed inside a script */
	exitRequested?: number
}

/** Expand $VAR, ${VAR}, $?, $#, $0..$9, $@, $* in a string (outside single quotes handled by caller). */
export function expandVars(
	input: string,
	env: Record<string, string>,
	ctx?: ScriptContext | null,
): string {
	let out = ''
	for (let i = 0; i < input.length; i++) {
		const c = input[i]
		if (c !== '$') {
			out += c
			continue
		}
		const next = input[i + 1]
		if (next === '{') {
			const end = input.indexOf('}', i + 2)
			if (end < 0) {
				out += c
				continue
			}
			const key = input.slice(i + 2, end)
			out += lookupVar(key, env, ctx)
			i = end
			continue
		}
		if (next === '?' || next === '#' || next === '@' || next === '*') {
			out += lookupVar(next, env, ctx)
			i++
			continue
		}
		if (next && /[0-9]/.test(next)) {
			// $0 .. $9 (simple; multi-digit not required for lab)
			out += lookupVar(next, env, ctx)
			i++
			continue
		}
		if (next && /[A-Za-z_]/.test(next)) {
			let j = i + 1
			while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++
			out += lookupVar(input.slice(i + 1, j), env, ctx)
			i = j - 1
			continue
		}
		out += c
	}
	return out
}

function lookupVar(key: string, env: Record<string, string>, ctx?: ScriptContext | null): string {
	if (key === '?') return String(ctx?.lastExit ?? 0)
	if (key === '#') return String(ctx?.args.length ?? 0)
	if (key === '@' || key === '*') return (ctx?.args ?? []).join(' ')
	if (/^\d+$/.test(key)) {
		const n = parseInt(key, 10)
		if (n === 0) return ctx?.name ?? 'bash'
		return ctx?.args[n - 1] ?? ''
	}
	return env[key] ?? ''
}

/**
 * Expand variables in a full shell line while respecting quotes.
 * Double-quoted segments expand; single-quoted do not.
 */
export function expandLine(
	line: string,
	env: Record<string, string>,
	ctx?: ScriptContext | null,
): string {
	let out = ''
	let quote: '"' | "'" | null = null
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (quote === "'") {
			// Single-quoted: literal, keep closing quote for the tokenizer
			if (c === "'") {
				quote = null
				out += c
			} else {
				out += c
			}
			continue
		}
		if (quote === '"') {
			if (c === '"') {
				quote = null
				out += c // keep closing quote balanced with the opener
				continue
			}
			if (c === '\\' && i + 1 < line.length) {
				const n = line[i + 1]
				if (n === '"' || n === '\\' || n === '$' || n === '`') {
					out += n
					i++
					continue
				}
			}
			if (c === '$') {
				const rest = line.slice(i)
				const m = rest.match(
					/^\$\{([A-Za-z0-9_?@*#]+)\}|^\$([A-Za-z_][A-Za-z0-9_]*|[0-9]|[?#@*])/,
				)
				if (m) {
					const key = m[1] ?? m[2]
					out += lookupVar(key, env, ctx)
					i += m[0].length - 1
					continue
				}
			}
			out += c
			continue
		}
		// unquoted
		if (c === "'" || c === '"') {
			quote = c
			out += c // keep opening quote for the tokenizer
			continue
		}
		if (c === '$') {
			const rest = line.slice(i)
			const m = rest.match(
				/^\$\{([A-Za-z0-9_?@*#]+)\}|^\$([A-Za-z_][A-Za-z0-9_]*|[0-9]|[?#@*])/,
			)
			if (m) {
				const key = m[1] ?? m[2]
				// re-quote if value has spaces so tokenizer keeps one arg
				const val = lookupVar(key, env, ctx)
				if (/[\s"']/.test(val)) out += `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
				else out += val
				i += m[0].length - 1
				continue
			}
		}
		out += c
	}
	return out
}

/** bash `printf FORMAT [ARGS...]` — subset: %s %d %i %c %% and \n \t \r \\ */
export function formatPrintf(format: string, args: string[]): string {
	// Interpret common backslash escapes in the format string
	let fmt = ''
	for (let i = 0; i < format.length; i++) {
		const c = format[i]
		if (c === '\\' && i + 1 < format.length) {
			const n = format[++i]
			if (n === 'n') fmt += '\n'
			else if (n === 't') fmt += '\t'
			else if (n === 'r') fmt += '\r'
			else if (n === '\\') fmt += '\\'
			else if (n === '0') fmt += '\0'
			else fmt += n
			continue
		}
		fmt += c
	}

	let out = ''
	let ai = 0
	for (let i = 0; i < fmt.length; i++) {
		const c = fmt[i]
		if (c !== '%') {
			out += c
			continue
		}
		if (fmt[i + 1] === '%') {
			out += '%'
			i++
			continue
		}
		// skip flags/width lightly: %-10s style
		let j = i + 1
		while (j < fmt.length && /[-+0 #]/.test(fmt[j])) j++
		while (j < fmt.length && /[0-9]/.test(fmt[j])) j++
		if (fmt[j] === '.') {
			j++
			while (j < fmt.length && /[0-9]/.test(fmt[j])) j++
		}
		const spec = fmt[j]
		if (!spec) {
			out += '%'
			break
		}
		const arg = args[ai] ?? ''
		ai++
		if (spec === 's') out += arg
		else if (spec === 'd' || spec === 'i') out += String(parseInt(arg, 10) || 0)
		else if (spec === 'c') out += arg.charAt(0) || ''
		else if (spec === 'b') {
			// %b — expand escapes in arg
			out += arg.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
		} else out += arg
		i = j
	}
	return out
}

/** echo with -n / -e (basic) */
export function formatEcho(args: string[]): { text: string; newline: boolean } {
	let newline = true
	let escape = false
	const out: string[] = []
	let i = 0
	for (; i < args.length; i++) {
		const a = args[i]
		if (a === '--') {
			i++
			break
		}
		if (a === '-n') {
			newline = false
			continue
		}
		if (a === '-e') {
			escape = true
			continue
		}
		if (a === '-E') {
			escape = false
			continue
		}
		if (a.startsWith('-') && a.length > 1 && /^-[neE]+$/.test(a)) {
			if (a.includes('n')) newline = false
			if (a.includes('e')) escape = true
			if (a.includes('E')) escape = false
			continue
		}
		break
	}
	const parts = args.slice(i)
	let text = parts.join(' ')
	if (escape) {
		text = text
			.replace(/\\n/g, '\n')
			.replace(/\\t/g, '\t')
			.replace(/\\r/g, '\r')
			.replace(/\\\\/g, '\\')
	}
	return { text, newline }
}

/** Evaluate a single `test` / `[` / `[[` expression (tokens without brackets). */
export function evalTest(tokens: string[], exists: (p: string) => boolean, isDir: (p: string) => boolean, isFile: (p: string) => boolean): boolean {
	if (tokens.length === 0) return false

	// ! expr
	if (tokens[0] === '!') return !evalTest(tokens.slice(1), exists, isDir, isFile)

	// unary
	if (tokens.length === 2) {
		const [op, arg] = tokens
		if (op === '-z') return arg.length === 0
		if (op === '-n') return arg.length > 0
		if (op === '-e') return exists(arg)
		if (op === '-f') return isFile(arg)
		if (op === '-d') return isDir(arg)
		if (op === '-r' || op === '-w' || op === '-x') return exists(arg)
	}

	// binary
	if (tokens.length === 3) {
		const [a, op, b] = tokens
		if (op === '=' || op === '==') return a === b
		if (op === '!=') return a !== b
		if (op === '-eq') return toNum(a) === toNum(b)
		if (op === '-ne') return toNum(a) !== toNum(b)
		if (op === '-lt') return toNum(a) < toNum(b)
		if (op === '-le') return toNum(a) <= toNum(b)
		if (op === '-gt') return toNum(a) > toNum(b)
		if (op === '-ge') return toNum(a) >= toNum(b)
	}

	// single string: true if non-empty
	if (tokens.length === 1) return tokens[0].length > 0

	return false
}

function toNum(s: string): number {
	const n = Number(s)
	return Number.isFinite(n) ? n : 0
}

/** Evaluate `(( arithmetic ))` with only digits and basic ops — returns boolean (nonzero). */
export function evalArithmetic(expr: string, env: Record<string, string>, ctx?: ScriptContext | null): boolean {
	let e = expandVars(expr.trim(), env, ctx)
	// replace bare identifiers with env numeric values
	e = e.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) => {
		if (name === 'true') return '1'
		if (name === 'false') return '0'
		const v = env[name]
		if (v !== undefined && /^-?\d+(\.\d+)?$/.test(v)) return v
		return '0'
	})
	// only allow safe chars
	if (!/^[\d\s()+\-*/%<>=!&|]+$/.test(e)) return false
	try {
		// eslint-disable-next-line no-new-func
		const v = Function(`"use strict"; return (${e});`)()
		return Boolean(v)
	} catch {
		return false
	}
}

/** Split script text into logical lines (join lines ending with \\). */
export function splitScriptLines(source: string): string[] {
	const raw = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
	const lines: string[] = []
	let buf = ''
	for (const line of raw) {
		if (/\\$/.test(line)) {
			buf += line.slice(0, -1)
			continue
		}
		buf += line
		lines.push(buf)
		buf = ''
	}
	if (buf) lines.push(buf)
	return lines
}

/** Detect simple VAR=value assignment (no command name). */
export function parseAssignment(line: string): { name: string; value: string } | null {
	const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
	if (!m) return null
	// reject `cmd=foo bar` style command with args after space outside quotes — keep simple
	const rest = m[2]
	// strip matching quotes
	let value = rest
	if (
		(value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
		(value.startsWith("'") && value.endsWith("'") && value.length >= 2)
	) {
		value = value.slice(1, -1)
	}
	return { name: m[1], value }
}

/**
 * Extract condition from `if COND; then` / `if COND then` forms.
 * Returns null if not an if-line.
 */
export function parseIfLine(line: string): { cond: string } | null {
	const t = line.trim()
	if (!t.startsWith('if ') && t !== 'if') return null
	let body = t.slice(2).trim()
	// strip trailing ; then / then
	body = body.replace(/;\s*then\s*$/i, '').replace(/\s+then\s*$/i, '').trim()
	if (!body) return null
	return { cond: body }
}

export function parseElifLine(line: string): { cond: string } | null {
	const t = line.trim()
	if (!t.startsWith('elif ')) return null
	let body = t.slice(5).trim()
	body = body.replace(/;\s*then\s*$/i, '').replace(/\s+then\s*$/i, '').trim()
	return { cond: body }
}

/** `for name in a b c; do` */
export function parseForLine(line: string): { name: string; items: string[] } | null {
	const t = line.trim()
	const m = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/i.exec(t)
	if (!m) return null
	let rest = m[2].replace(/;\s*do\s*$/i, '').replace(/\s+do\s*$/i, '').trim()
	// tokenize items simply by whitespace (values already expanded)
	const items = rest.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
	return {
		name: m[1],
		items: items.map((s) => {
			if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
				return s.slice(1, -1)
			}
			return s
		}),
	}
}

/** Whether a path looks like a runnable shell script for the lab. */
export function looksLikeShellScript(path: string, content: string): boolean {
	if (/\.(sh|bash)$/i.test(path)) return true
	const first = content.split(/\n/)[0] ?? ''
	return /^#!\s*\S*(bash|sh)\b/.test(first) || /^#!\s*\/usr\/bin\/env\s+(bash|sh)\b/.test(first)
}
