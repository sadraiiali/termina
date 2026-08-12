import type { VirtualFS } from 'almostnode'
import { listManPages } from './man'

/** Built-in FakeShell commands (for Tab completion). */
export const SHELL_COMMANDS = [
	'help',
	'uname',
	'pwd',
	'cd',
	'ls',
	'cat',
	'nano',
	'vim',
	'vi',
	'echo',
	'printf',
	'print',
	'true',
	'false',
	'test',
	'bash',
	'sh',
	'source',
	'export',
	'exit',
	'chmod',
	'sleep',
	'mkdir',
	'touch',
	'rm',
	'cp',
	'mv',
	'head',
	'tail',
	'wc',
	'grep',
	'tree',
	'whoami',
	'hostname',
	'id',
	'date',
	'cal',
	'env',
	'printenv',
	'which',
	'man',
	'clear',
	'history',
	'ip',
	'iptables',
	'ip6tables',
	'ping',
	'curl',
	'less',
	'more',
	'apt',
	'apt-get',
	'apt-cache',
	'dpkg',
	'sudo',
	'systemctl',
	'journalctl',
	'crontab',
	'ps',
	'pgrep',
	'pidof',
	'sys',
	'wasi-hello',
	'wasi-echo',
	'wasi-cat',
	'node',
	'npm',
	'save',
	'reset',
] as const

export interface CompleteResult {
	line: string
	candidates: string[]
}

/**
 * Bash-like completion for FakeShell.
 */
export function completeLine(line: string, cwd: string, vfs: VirtualFS): CompleteResult {
	const match = /^(.*?)(\S*)$/.exec(line)
	if (!match) return { line, candidates: [] }
	const before = match[1]
	const token = match[2]
	const tokens = line.trimStart().split(/\s+/).filter(Boolean)
	const endsWithSpace = /\s$/.test(line)

	if (
		tokens[0] === 'npm' &&
		((tokens.length === 1 && endsWithSpace) || tokens.length >= 2)
	) {
		const subs = ['install', 'run', 'start', 'test', 'ls', 'init']
		const prefix =
			tokens.length === 1 && endsWithSpace
				? ''
				: tokens.length >= 2 && !endsWithSpace
					? tokens[tokens.length - 1]
					: ''
		const cands = subs.filter((s) => s.startsWith(prefix))
		return applyCandidates(before, token, prefix, cands, line)
	}

	// apt / apt-get completion
	if (
		(tokens[0] === 'apt' || tokens[0] === 'apt-get') &&
		((tokens.length === 1 && endsWithSpace) || tokens.length >= 2)
	) {
		const verbs = [
			'update',
			'upgrade',
			'install',
			'remove',
			'purge',
			'search',
			'show',
			'list',
			'policy',
			'autoremove',
			'clean',
			'help',
		]
		const pkgs = [
			'nginx',
			'apache2',
			'curl',
			'wget',
			'git',
			'vim',
			'nano',
			'htop',
			'tree',
			'openssh-server',
			'ufw',
			'python3',
			'nodejs',
			'docker.io',
			'build-essential',
		]
		const afterVerb =
			tokens.length >= 2 &&
			!tokens[1].startsWith('-') &&
			(endsWithSpace || tokens.length > 2)
		const verb = tokens[1]
		const prefix =
			endsWithSpace || tokens.length === 1
				? ''
				: tokens.length >= 2 && !endsWithSpace
					? tokens[tokens.length - 1]
					: ''
		const pool =
			afterVerb && (verb === 'install' || verb === 'remove' || verb === 'purge' || verb === 'show')
				? pkgs
				: verbs
		const cands = pool.filter((s) => s.startsWith(prefix))
		return applyCandidates(before, token, prefix, cands, line)
	}

	// systemctl <verb> completion
	if (
		tokens[0] === 'systemctl' &&
		((tokens.length === 1 && endsWithSpace) || tokens.length >= 2)
	) {
		const verbs = [
			'list-units',
			'list-unit-files',
			'status',
			'start',
			'stop',
			'restart',
			'reload',
			'enable',
			'disable',
			'is-active',
			'is-enabled',
			'is-failed',
			'get-default',
			'set-default',
			'daemon-reload',
			'cat',
			'show',
			'isolate',
			'show-environment',
		]
		const units = [
			'ssh',
			'ssh.service',
			'nginx',
			'nginx.service',
			'cron',
			'docker',
			'multi-user.target',
			'graphical.target',
		]
		const prefix =
			tokens.length === 1 && endsWithSpace
				? ''
				: tokens.length >= 2 && !endsWithSpace
					? tokens[tokens.length - 1]
					: ''
		// after verb + space, complete units
		const afterVerb =
			tokens.length >= 2 &&
			(endsWithSpace || tokens.length > 2) &&
			verbs.includes(tokens[1] ?? '')
		const cands = (afterVerb || tokens.length > 2 ? units : verbs).filter((s) =>
			s.startsWith(prefix),
		)
		return applyCandidates(before, token, prefix, cands, line)
	}

	// man <page> completion
	if (
		tokens[0] === 'man' &&
		((tokens.length === 1 && endsWithSpace) || tokens.length >= 2)
	) {
		const pages = listManPages()
		const prefix =
			tokens.length === 1 && endsWithSpace
				? ''
				: tokens.length >= 2 && !endsWithSpace
					? tokens[tokens.length - 1]
					: ''
		if (/^\d+$/.test(prefix) && !endsWithSpace) {
			return { line, candidates: [] }
		}
		const cands = pages.filter((s) => s.startsWith(prefix))
		return applyCandidates(before, token, prefix, cands, line)
	}

	if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace && !before.trim())) {
		const prefix = token
		const cands = SHELL_COMMANDS.filter((c) => c.startsWith(prefix))
		return applyCandidates(before, token, prefix, cands as unknown as string[], line)
	}

	const prefix = endsWithSpace ? '' : token
	const pathCands = listPathCandidates(prefix, cwd, vfs)
	return applyCandidates(before, token, prefix, pathCands, line)
}

function applyCandidates(
	_before: string,
	token: string,
	prefix: string,
	cands: string[],
	original: string,
): CompleteResult {
	if (cands.length === 0) return { line: original, candidates: [] }
	const head = original.slice(0, original.length - token.length)
	if (cands.length === 1) {
		return { line: head + cands[0], candidates: cands }
	}
	const common = commonPrefix(cands)
	if (common.length > prefix.length) {
		return { line: head + common, candidates: cands }
	}
	return { line: original, candidates: cands }
}

function listPathCandidates(prefix: string, cwd: string, vfs: VirtualFS): string[] {
	let dir: string
	let base: string
	if (prefix.includes('/')) {
		const i = prefix.lastIndexOf('/')
		dir = prefix.slice(0, i) || (prefix.startsWith('/') ? '/' : '.')
		base = prefix.slice(i + 1)
	} else {
		dir = '.'
		base = prefix
	}

	const absDir = resolve(cwd, dir === '.' ? cwd : dir === '' ? '/' : dir)
	let names: string[]
	try {
		if (!vfs.existsSync(absDir) || !vfs.statSync(absDir).isDirectory()) return []
		names = vfs.readdirSync(absDir)
	} catch {
		return []
	}

	return names
		.filter((n) => n.startsWith(base) && !n.startsWith('.'))
		.sort()
		.map((n) => {
			const full = absDir === '/' ? `/${n}` : `${absDir}/${n}`
			let display: string
			if (prefix.startsWith('/')) {
				display = full
			} else if (prefix.includes('/')) {
				const parent = prefix.slice(0, prefix.lastIndexOf('/') + 1)
				display = parent + n
			} else {
				display = n
			}
			try {
				if (vfs.statSync(full).isDirectory()) display += '/'
			} catch {
				/* ignore */
			}
			return display
		})
}

function resolve(cwd: string, path: string): string {
	if (path === '.' || path === '') return cwd
	if (path.startsWith('/')) return normalize(path)
	return normalize(`${cwd}/${path}`)
}

function normalize(path: string): string {
	const parts = path.split('/')
	const out: string[] = []
	for (const p of parts) {
		if (!p || p === '.') continue
		if (p === '..') {
			out.pop()
			continue
		}
		out.push(p)
	}
	return '/' + out.join('/')
}

function commonPrefix(items: string[]): string {
	if (items.length === 0) return ''
	let p = items[0]
	for (const s of items.slice(1)) {
		let i = 0
		while (i < p.length && i < s.length && p[i] === s[i]) i++
		p = p.slice(0, i)
		if (!p) break
	}
	return p
}
