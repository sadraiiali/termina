/**
 * Fake Vixie/cron crontab for FakeShell lab — jobs actually run.
 *
 * CLI mirrors real crontab(1):
 *   crontab [-u user] -l | -e | -r | -i | file
 *
 * Schedule engine: classic 5-field specs + @reboot/@hourly/@daily/…
 * Host ticks via tickCron() while the terminal is open.
 *
 * Spool: /var/spool/cron/crontabs/<user>   Log: /var/log/cron
 */

import type { VirtualFS } from 'almostnode'

export interface CronResult {
	stdout: string
	stderr: string
	exitCode: number
	/** Open nano on this path (crontab -e) */
	editPath?: string
}

export interface CronJob {
	raw: string
	spec: string
	command: string
	minutes: number[] | null
	hours: number[] | null
	dom: number[] | null
	months: number[] | null
	dow: number[] | null
	special?: 'reboot' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly'
}

const SPOOL_DIR = '/var/spool/cron/crontabs'
export const CRON_LOG = '/var/log/cron'

/** last fire key: job.raw → "YYYY-MM-DDTHH:mm" minute bucket */
const lastFire = new Map<string, string>()
let rebootDone = false

export function crontabPath(user = 'user'): string {
	return `${SPOOL_DIR}/${user}`
}

export function resetCronLab(): void {
	lastFire.clear()
	rebootDone = false
}

export function ensureCronSpool(vfs: VirtualFS, user = 'user'): void {
	mkdirp(vfs, SPOOL_DIR)
	mkdirp(vfs, '/var/log')
	const path = crontabPath(user)
	if (!vfs.existsSync(path)) {
		vfs.writeFileSync(
			path,
			`# FakeShell user crontab for ${user}
# m h  dom mon dow   command
#
# Field order (same as real cron):
#  minute (0-59)
#  hour   (0-23)
#  dom    (1-31)
#  month  (1-12)
#  dow    (0-7)  0 and 7 = Sunday
#
# Examples — uncomment to enable (jobs run in the lab while the page is open):
# * * * * * date >> /tmp/cron-every-minute.log
# */2 * * * * echo tick >> /tmp/cron-tick.log
# @hourly echo hourly >> /tmp/cron-hourly.log
`,
		)
	}
	if (!vfs.existsSync(CRON_LOG)) vfs.writeFileSync(CRON_LOG, '')
}

function mkdirp(vfs: VirtualFS, dir: string): void {
	const parts = dir.split('/').filter(Boolean)
	let p = ''
	for (const part of parts) {
		p += '/' + part
		try {
			if (!vfs.existsSync(p)) vfs.mkdirSync(p, { recursive: true })
		} catch {
			try {
				vfs.mkdirSync(p, { recursive: true })
			} catch {
				/* ignore */
			}
		}
	}
}

export function readCrontab(vfs: VirtualFS, user = 'user'): string {
	ensureCronSpool(vfs, user)
	try {
		return String(vfs.readFileSync(crontabPath(user), 'utf8'))
	} catch {
		return ''
	}
}

export function writeCrontab(vfs: VirtualFS, content: string, user = 'user'): void {
	ensureCronSpool(vfs, user)
	const body = content.endsWith('\n') ? content : content + '\n'
	vfs.writeFileSync(crontabPath(user), body)
}

export function appendCronLog(vfs: VirtualFS, line: string): void {
	ensureCronSpool(vfs)
	const ts = new Date().toString()
	let prev = ''
	try {
		prev = String(vfs.readFileSync(CRON_LOG, 'utf8'))
	} catch {
		prev = ''
	}
	vfs.writeFileSync(CRON_LOG, prev + `${ts}: ${line}\n`)
}

// ─── crontab(1) CLI ─────────────────────────────────────────────────────────

export function runCrontab(
	args: string[],
	vfs: VirtualFS,
	user = 'user',
): CronResult {
	const a = [...args]
	let u = user
	// crontab -u name …
	for (let i = 0; i < a.length; i++) {
		if ((a[i] === '-u' || a[i] === '--user') && a[i + 1]) {
			u = a[i + 1]
			a.splice(i, 2)
			i--
		}
	}

	if (a.includes('-h') || a.includes('--help')) {
		return { stdout: CRONTAB_HELP, stderr: '', exitCode: 0 }
	}
	if (a.includes('-l') || a.includes('--list')) {
		const body = readCrontab(vfs, u)
		if (!body.trim() || onlyComments(body)) {
			return {
				stdout: '',
				stderr: `no crontab for ${u}\n`,
				exitCode: 1,
			}
		}
		return { stdout: body.endsWith('\n') ? body : body + '\n', stderr: '', exitCode: 0 }
	}
	if (a.includes('-r') || a.includes('--remove')) {
		const interactive = a.includes('-i')
		// lab: -i always confirms yes (no TTY prompt UI)
		void interactive
		ensureCronSpool(vfs, u)
		try {
			vfs.writeFileSync(crontabPath(u), '')
		} catch {
			/* ignore */
		}
		// clear last-fire for this user's jobs
		for (const k of [...lastFire.keys()]) {
			if (k.startsWith(u + '\0')) lastFire.delete(k)
		}
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	if (a.includes('-e') || a.includes('--edit')) {
		ensureCronSpool(vfs, u)
		return {
			stdout: '',
			stderr: '',
			exitCode: 0,
			editPath: crontabPath(u),
		}
	}

	// crontab file  → install
	const file = a.find((x) => !x.startsWith('-'))
	if (file) {
		const path = file.startsWith('/') ? file : /* relative resolved by caller */ file
		let content: string
		try {
			// caller passes absolute via resolve — try as given
			if (!vfs.existsSync(path)) {
				return {
					stdout: '',
					stderr: `crontab: can't open '${file}': No such file or directory\n`,
					exitCode: 1,
				}
			}
			content = String(vfs.readFileSync(path, 'utf8'))
		} catch (e) {
			return {
				stdout: '',
				stderr: `crontab: ${String(e)}\n`,
				exitCode: 1,
			}
		}
		// validate lines
		const err = validateCrontab(content)
		if (err) {
			return { stdout: '', stderr: `crontab: ${err}\n`, exitCode: 1 }
		}
		writeCrontab(vfs, content, u)
		return {
			stdout: '',
			stderr: '',
			exitCode: 0,
		}
	}

	return {
		stdout: '',
		stderr: 'crontab: usage error: one of -e, -l, -r or file must be specified\n' + CRONTAB_HELP,
		exitCode: 1,
	}
}

function onlyComments(body: string): boolean {
	return body
		.split('\n')
		.every((l) => {
			const t = l.trim()
			return !t || t.startsWith('#')
		})
}

function validateCrontab(content: string): string | null {
	for (const raw of content.split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(line) && !line.startsWith('@') && !/\s/.test(line.split('=')[0] ?? '')) {
			// NAME=value
			continue
		}
		if (line.startsWith('@')) {
			if (!/^@(reboot|hourly|daily|midnight|weekly|monthly|yearly|annually)\s+\S/.test(line)) {
				return `invalid special schedule near: ${line}`
			}
			continue
		}
		if (!/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+\S/.test(line)) {
			return `invalid cron line near: ${line}`
		}
	}
	return null
}

const CRONTAB_HELP = `usage:	crontab [-u user] file
	crontab [ -u user ] [ -i ] { -e | -l | -r }
		(default operation is replace, per 1003.2)
	-e	(edit user's crontab)
	-l	(list user's crontab)
	-r	(delete user's crontab)
	-i	(prompt before deleting)
	-u user	(operate on user's crontab)

FakeShell: jobs run while the lab page is open (fake cron daemon).
`

// ─── Schedule engine ────────────────────────────────────────────────────────

export function parseCrontab(content: string): CronJob[] {
	const jobs: CronJob[] = []
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line || line.startsWith('#')) continue
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(line) && !line.includes(' ') && !line.startsWith('@')) {
			continue
		}
		const job = parseJobLine(line)
		if (job) jobs.push(job)
	}
	return jobs
}

function parseJobLine(line: string): CronJob | null {
	const special =
		/^@(reboot|hourly|daily|midnight|weekly|monthly|yearly|annually)\s+(.+)$/i.exec(line)
	if (special) {
		let sp = special[1].toLowerCase()
		if (sp === 'midnight') sp = 'daily'
		if (sp === 'annually') sp = 'yearly'
		return {
			raw: line,
			spec: '@' + sp,
			command: special[2].trim(),
			minutes: null,
			hours: null,
			dom: null,
			months: null,
			dow: null,
			special: sp as CronJob['special'],
		}
	}

	const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line)
	if (!m) return null
	return {
		raw: line,
		spec: `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`,
		command: m[6].trim(),
		minutes: expandField(m[1], 0, 59),
		hours: expandField(m[2], 0, 23),
		dom: expandField(m[3], 1, 31),
		months: expandField(m[4], 1, 12),
		dow: expandField(m[5], 0, 7),
	}
}

/** Expand cron field → list of ints, or null for '*'. */
export function expandField(field: string, min: number, max: number): number[] | null {
	if (field === '*') return null
	const out = new Set<number>()
	for (const part of field.split(',')) {
		const stepMatch = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
		if (!stepMatch) continue
		const base = stepMatch[1]
		const step = stepMatch[2] ? parseInt(stepMatch[2], 10) : 1
		let lo = min
		let hi = max
		if (base !== '*') {
			if (base.includes('-')) {
				const [a, b] = base.split('-').map((x) => parseInt(x, 10))
				lo = a
				hi = b
			} else {
				lo = hi = parseInt(base, 10)
			}
		}
		const st = Number.isFinite(step) && step > 0 ? step : 1
		for (let n = lo; n <= hi; n += st) {
			if (n >= min && n <= max) out.add(n)
			if (max === 7 && n === 7) out.add(0) // Sunday
		}
	}
	return [...out]
}

function matches(job: CronJob, d: Date): boolean {
	if (job.special) {
		const mi = d.getMinutes()
		const h = d.getHours()
		const dom = d.getDate()
		const mon = d.getMonth() + 1
		const dow = d.getDay()
		switch (job.special) {
			case 'reboot':
				return false // handled separately once
			case 'hourly':
				return mi === 0
			case 'daily':
				return mi === 0 && h === 0
			case 'weekly':
				return mi === 0 && h === 0 && dow === 0
			case 'monthly':
				return mi === 0 && h === 0 && dom === 1
			case 'yearly':
				return mi === 0 && h === 0 && dom === 1 && mon === 1
			default:
				return false
		}
	}
	const mi = d.getMinutes()
	const h = d.getHours()
	const dom = d.getDate()
	const mon = d.getMonth() + 1
	const dow = d.getDay()
	const inList = (list: number[] | null, n: number) => list === null || list.includes(n)
	// dow 7 = Sunday
	const dowOk =
		job.dow === null || job.dow.includes(dow) || (dow === 0 && job.dow.includes(7))
	return (
		inList(job.minutes, mi) &&
		inList(job.hours, h) &&
		inList(job.dom, dom) &&
		inList(job.months, mon) &&
		dowOk
	)
}

function minuteKey(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Return commands that should fire at `now` and have not yet fired this minute.
 */
export function dueCommands(
	content: string,
	user: string,
	now: Date = new Date(),
): string[] {
	const jobs = parseCrontab(content)
	const bucket = minuteKey(now)
	const out: string[] = []

	// @reboot once per lab session
	if (!rebootDone) {
		for (const j of jobs) {
			if (j.special === 'reboot') {
				out.push(j.command)
				lastFire.set(user + '\0' + j.raw, bucket)
			}
		}
		rebootDone = true
	}

	for (const j of jobs) {
		if (j.special === 'reboot') continue
		if (!matches(j, now)) continue
		const id = user + '\0' + j.raw
		if (lastFire.get(id) === bucket) continue
		lastFire.set(id, bucket)
		out.push(j.command)
	}
	return out
}

/**
 * Tick: load user crontab, return due shell commands to execute.
 */
export function tickCron(vfs: VirtualFS, user = 'user', now: Date = new Date()): string[] {
	try {
		const body = readCrontab(vfs, user)
		return dueCommands(body, user, now)
	} catch {
		return []
	}
}
