/**
 * Lab `ps` — process table viewer modeled on procps-ng.
 * Process rows come from fake systemd unit PIDs + shell session.
 */

import { listSystemProcesses, type SysProc } from './systemd'

export interface PsResult {
	stdout: string
	stderr: string
	exitCode: number
}

/**
 * Parse BSD + UNIX option mixes:
 *   ps
 *   ps aux
 *   ps -ef
 *   ps -ef --forest
 *   ps -p 1
 *   ps -p 1 -o pid,comm,args
 *   ps ax
 */
export function runPs(args: string[]): PsResult {
	const a = [...args]
	let all = false // a / -A / -e
	let userFmt = false // u
	let full = false // -f
	let forest = false // --forest / f (BSD forest is rare; we treat --forest)
	let longFmt = false // l / -l
	let pids: number[] | null = null
	let oCols: string[] | null = null
	let ttyOnly = true // default: only current terminal

	// Collapse BSD cluster flags: aux, ax, etc.
	const expanded: string[] = []
	for (const tok of a) {
		if (tok.startsWith('--')) {
			expanded.push(tok)
			continue
		}
		if (tok.startsWith('-') && tok.length > 1) {
			// UNIX: -ef, -p, -o
			expanded.push(tok)
			continue
		}
		// BSD style without dash: aux, axuf
		if (/^[a-zA-Z]+$/.test(tok) && !tok.startsWith('-')) {
			for (const ch of tok) expanded.push(ch)
			continue
		}
		expanded.push(tok)
	}

	for (let i = 0; i < expanded.length; i++) {
		const t = expanded[i]
		if (t === 'a' || t === '-a') {
			// BSD a: all with tty; with x → all
			all = true
			ttyOnly = false
			continue
		}
		if (t === 'x') {
			// include processes without controlling tty
			ttyOnly = false
			all = true
			continue
		}
		if (t === 'u') {
			userFmt = true
			all = true
			ttyOnly = false
			continue
		}
		if (t === 'f' && expanded[i - 1] !== '-e' && !expanded.includes('-e')) {
			// could be forest in some; for BSD f is ASCII art forest in full format
			forest = true
			continue
		}
		if (t === '-e' || t === '-A') {
			all = true
			ttyOnly = false
			continue
		}
		if (t === '-f') {
			full = true
			all = true
			ttyOnly = false
			continue
		}
		if (t === '--forest' || t === '-H') {
			forest = true
			continue
		}
		if (t === '-l' || t === 'l') {
			longFmt = true
			continue
		}
		if (t === '-p' || t === 'p') {
			const v = expanded[++i] ?? ''
			pids = v.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
			ttyOnly = false
			continue
		}
		if (t.startsWith('-p')) {
			const v = t.slice(2) || expanded[++i] || ''
			pids = v.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n))
			ttyOnly = false
			continue
		}
		if (t === '-o' || t === 'o') {
			const v = expanded[++i] ?? 'pid,comm'
			oCols = v.split(/[,\s]+/).map((c) => c.toLowerCase())
			continue
		}
		if (t.startsWith('-o')) {
			oCols = t.slice(2).split(/[,\s]+/).map((c) => c.toLowerCase())
			continue
		}
		if (t === '--help' || t === '-h') {
			return { stdout: PS_HELP, stderr: '', exitCode: 0 }
		}
	}

	// Combined UNIX: -ef means -e -f (already handled if separate)
	// Handle token "-ef"
	for (const t of a) {
		if (t === '-ef' || t === '-fe') {
			all = true
			full = true
			ttyOnly = false
		}
		if (t === '-aux' || t === 'aux') {
			all = true
			userFmt = true
			ttyOnly = false
		}
	}
	// Re-scan for glued -ef
	if (a.some((t) => /^-[efH]+$/.test(t))) {
		for (const t of a) {
			if (!t.startsWith('-') || t.startsWith('--')) continue
			if (t.includes('e') || t.includes('A')) {
				all = true
				ttyOnly = false
			}
			if (t.includes('f') && t !== '-f') {
				// -ef
				if (t.includes('e')) full = true
			}
			if (t === '-f') full = true
			if (t.includes('H')) forest = true
		}
	}

	let procs = listSystemProcesses()

	// Update ps args line to show invocation
	const psArgs = ['ps', ...args].join(' ')
	procs = procs.map((p) =>
		p.comm === 'ps' ? { ...p, args: psArgs || 'ps', comm: 'ps' } : p,
	)

	if (pids) {
		procs = procs.filter((p) => pids!.includes(p.pid))
	} else if (ttyOnly && !all && !userFmt && !full) {
		// default: only processes with our pts/0 (and maybe bash/ps)
		procs = procs.filter((p) => p.tty === 'pts/0' || p.tty.startsWith('pts/'))
	}

	if (oCols) {
		return { stdout: formatO(procs, oCols, forest), stderr: '', exitCode: 0 }
	}
	if (userFmt) {
		return { stdout: formatAux(procs, forest), stderr: '', exitCode: 0 }
	}
	if (full) {
		return { stdout: formatEf(procs, forest), stderr: '', exitCode: 0 }
	}
	if (longFmt) {
		return { stdout: formatLong(procs), stderr: '', exitCode: 0 }
	}
	// default simple
	return { stdout: formatDefault(procs), stderr: '', exitCode: 0 }
}

function formatDefault(procs: SysProc[]): string {
	const lines = ['    PID TTY          TIME CMD']
	for (const p of procs) {
		lines.push(
			`${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} ${p.time.padStart(8)} ${p.args}`,
		)
	}
	return lines.join('\n') + '\n'
}

function formatAux(procs: SysProc[], forest: boolean): string {
	const lines = [
		'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
	]
	const byPpid = groupChildren(procs)
	const ordered = forest
		? walkForest(procs, byPpid)
		: procs.map((p) => ({ p, depth: 0 }))

	for (const { p, depth } of ordered) {
		const prefix = forest ? ' '.repeat(depth) + (depth ? '\\_ ' : '') : ''
		const cmd = prefix + p.args
		lines.push(
			`${p.user.padEnd(8)} ${String(p.pid).padStart(5)} ${p.pcpu.toFixed(1).padStart(4)} ${p.pmem.toFixed(1).padStart(4)} ${String(p.vsz).padStart(6)} ${String(p.rss).padStart(5)} ${p.tty.padEnd(8)} ${p.stat.padEnd(4)} ${p.start.padEnd(7)} ${p.time.padStart(8)} ${cmd}`,
		)
	}
	return lines.join('\n') + '\n'
}

function formatEf(procs: SysProc[], forest: boolean): string {
	const lines = ['UID          PID    PPID  C STIME TTY          TIME CMD']
	const byPpid = groupChildren(procs)
	const ordered = forest
		? walkForest(procs, byPpid)
		: procs.map((p) => ({ p, depth: 0 }))
	for (const { p, depth } of ordered) {
		const prefix = forest ? ' '.repeat(depth * 2) + (depth ? '\\_ ' : '') : ''
		lines.push(
			`${p.user.padEnd(8)} ${String(p.pid).padStart(6)} ${String(p.ppid).padStart(7)}  0 ${p.start.padEnd(5)} ${p.tty.padEnd(8)} ${p.time.padStart(8)} ${prefix}${p.args}`,
		)
	}
	return lines.join('\n') + '\n'
}

function formatLong(procs: SysProc[]): string {
	const lines = ['F S   UID   PID  PPID  C PRI  NI ADDR SZ WCHAN  TTY          TIME CMD']
	for (const p of procs) {
		lines.push(
			`0 ${p.stat[0] ?? 'S'} ${String(p.user === 'root' ? 0 : 1000).padStart(5)} ${String(p.pid).padStart(5)} ${String(p.ppid).padStart(5)}  0  80   0 - ${String(Math.floor(p.rss / 4)).padStart(4)} -      ${p.tty.padEnd(8)} ${p.time.padStart(8)} ${p.args}`,
		)
	}
	return lines.join('\n') + '\n'
}

function formatO(procs: SysProc[], cols: string[], forest: boolean): string {
	const header = cols.map((c) => c.toUpperCase()).join(' ')
	const lines = [header]
	const byPpid = groupChildren(procs)
	const ordered = forest ? walkForest(procs, byPpid) : procs.map((p) => ({ p, depth: 0 }))
	for (const { p, depth } of ordered) {
		const cells = cols.map((c) => {
			switch (c) {
				case 'pid':
					return String(p.pid)
				case 'ppid':
					return String(p.ppid)
				case 'comm':
				case 'cmd':
					return p.comm
				case 'args':
				case 'command':
					return (forest && depth ? '  '.repeat(depth) : '') + p.args
				case 'tty':
				case 'tt':
					return p.tty
				case 'user':
				case 'uid':
					return p.user
				case 'stat':
				case 'state':
					return p.stat
				case 'pcpu':
				case '%cpu':
					return p.pcpu.toFixed(1)
				case 'pmem':
				case '%mem':
					return p.pmem.toFixed(1)
				case 'vsz':
					return String(p.vsz)
				case 'rss':
					return String(p.rss)
				case 'etime':
				case 'time':
					return p.time
				default:
					return '-'
			}
		})
		lines.push(cells.join(' '))
	}
	return lines.join('\n') + '\n'
}

function groupChildren(procs: SysProc[]): Map<number, SysProc[]> {
	const m = new Map<number, SysProc[]>()
	for (const p of procs) {
		const list = m.get(p.ppid) ?? []
		list.push(p)
		m.set(p.ppid, list)
	}
	return m
}

function walkForest(
	procs: SysProc[],
	byPpid: Map<number, SysProc[]>,
): { p: SysProc; depth: number }[] {
	const ids = new Set(procs.map((p) => p.pid))
	const out: { p: SysProc; depth: number }[] = []
	const roots = procs.filter((p) => !ids.has(p.ppid) || p.ppid === 0 || p.pid === 1)
	roots.sort((a, b) => a.pid - b.pid)
	const seen = new Set<number>()
	for (const r of roots) {
		visitMarked(r, 0, seen, byPpid, ids, out)
	}
	for (const p of procs) {
		if (!seen.has(p.pid)) out.push({ p, depth: 0 })
	}
	return out
}

function visitMarked(
	p: SysProc,
	depth: number,
	seen: Set<number>,
	byPpid: Map<number, SysProc[]>,
	ids: Set<number>,
	out: { p: SysProc; depth: number }[],
): void {
	if (seen.has(p.pid)) return
	seen.add(p.pid)
	out.push({ p, depth })
	const kids = (byPpid.get(p.pid) ?? []).filter((k) => ids.has(k.pid)).sort((a, b) => a.pid - b.pid)
	for (const k of kids) visitMarked(k, depth + 1, seen, byPpid, ids, out)
}

const PS_HELP = `ps [options]

Report a snapshot of the current processes (FakeShell lab / procps-style).

Examples:
  ps
  ps aux
  ps -ef
  ps -ef --forest
  ps -p 1
  ps -p 1 -o pid,comm,args
  ps ax

Options:
  a, x, u          BSD style (aux = all + user format)
  -e, -A           all processes
  -f               full format
  --forest, -H     ASCII art process tree
  -p PID           select by PID
  -o col,...       user-defined format (pid,ppid,comm,args,tty,user,…)

FakeShell: process list is fake and follows systemd unit main PIDs.
`

/** pgrep -a pattern */
export function runPgrep(args: string[]): PsResult {
	let full = false
	const patterns: string[] = []
	for (const t of args) {
		if (t === '-a') full = true
		else if (!t.startsWith('-')) patterns.push(t)
	}
	if (!patterns.length) {
		return { stdout: '', stderr: 'pgrep: no matching criteria specified\n', exitCode: 2 }
	}
	const procs = listSystemProcesses().filter((p) => p.comm !== 'pgrep')
	const hits = procs.filter((p) =>
		patterns.some((pat) => p.comm.includes(pat) || p.args.includes(pat)),
	)
	if (!hits.length) return { stdout: '', stderr: '', exitCode: 1 }
	const lines = hits.map((p) => (full ? `${p.pid} ${p.args}` : String(p.pid)))
	return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
}

/** pidof name */
export function runPidof(args: string[]): PsResult {
	const names = args.filter((a) => !a.startsWith('-'))
	if (!names.length) {
		return { stdout: '', stderr: 'pidof: missing operand\n', exitCode: 1 }
	}
	const procs = listSystemProcesses()
	const pids: number[] = []
	for (const n of names) {
		for (const p of procs) {
			if (p.comm === n || p.args.split(/[\s/]/).pop() === n) pids.push(p.pid)
		}
	}
	if (!pids.length) return { stdout: '', stderr: '', exitCode: 1 }
	return { stdout: pids.join(' ') + '\n', stderr: '', exitCode: 0 }
}
