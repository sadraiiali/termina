/**
 * Fake systemd for FakeShell lab.
 *
 * Modeled on real systemd CLI surface (systemctl / journalctl) and unit
 * concepts from systemd upstream — NOT a port of the full C codebase.
 * All state is in-memory; reset via resetSystemd().
 *
 * Reference shapes (public CLI, not vendored sources):
 *   systemctl list-units, status, start/stop/restart/reload,
 *   enable/disable, is-active, is-enabled, get-default, set-default,
 *   daemon-reload, cat, show, list-unit-files, isolate
 *   journalctl -u -b -n -p -f (follow simulated as dump)
 */

export interface SysResult {
	stdout: string
	stderr: string
	exitCode: number
}

type UnitType = 'service' | 'socket' | 'target' | 'timer' | 'mount' | 'path'
type ActiveState = 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating'
type SubState =
	| 'running'
	| 'dead'
	| 'exited'
	| 'failed'
	| 'listening'
	| 'waiting'
	| 'mounted'
	| 'active' // targets
type LoadState = 'loaded' | 'not-found' | 'bad-setting' | 'error' | 'masked'
type Enablement = 'enabled' | 'disabled' | 'static' | 'masked' | 'indirect' | 'alias'

export interface Unit {
	name: string
	type: UnitType
	description: string
	load: LoadState
	active: ActiveState
	sub: SubState
	/** WantedBy / enable state for service files */
	enabled: Enablement
	/** Fake main PID when running */
	mainPid: number
	/** Unit file fragment text (for systemctl cat) */
	fragment: string
	/** Since when active (ms epoch) */
	activeSince: number | null
	/** Journal unit tag */
	journalUnit: string
}

interface JournalEntry {
	ts: number
	prio: number // 0 emerg … 7 debug (syslog)
	unit: string
	message: string
	bootId: string
}

interface SystemdState {
	hostname: string
	defaultTarget: string
	bootId: string
	bootTime: number
	units: Map<string, Unit>
	/** Ordered journal */
	journal: JournalEntry[]
	nextPid: number
}

const BOOT_ID = 'a15d0000cafe0000beef0000nano0001'

function now(): number {
	return Date.now()
}

function unitKey(name: string): string {
	let n = name.trim()
	if (!n) return n
	// allow ssh → ssh.service
	if (!n.includes('.')) n = `${n}.service`
	return n
}

function mkService(
	name: string,
	description: string,
	opts: Partial<Pick<Unit, 'active' | 'sub' | 'enabled' | 'fragment'>> = {},
): Unit {
	const active = opts.active ?? 'active'
	const sub = opts.sub ?? (active === 'active' ? 'running' : 'dead')
	const bare = name.replace(/\.service$/, '')
	const fragment =
		opts.fragment ??
		`# /lib/systemd/system/${name}
[Unit]
Description=${description}
After=network.target

[Service]
Type=simple
ExecStart=/usr/sbin/${bare}
Restart=on-failure

[Install]
WantedBy=multi-user.target
`
	return {
		name,
		type: 'service',
		description,
		load: 'loaded',
		active,
		sub,
		enabled: opts.enabled ?? 'enabled',
		mainPid: active === 'active' ? 0 : 0, // filled later
		fragment,
		activeSince: active === 'active' ? now() - 3600_000 : null,
		journalUnit: name,
	}
}

function defaultUnits(): Map<string, Unit> {
	const m = new Map<string, Unit>()
	const add = (u: Unit) => m.set(u.name, u)

	// PID 1
	add({
		name: 'systemd.service',
		type: 'service',
		description: 'systemd System and Service Manager (FakeShell lab fake)',
		load: 'loaded',
		active: 'active',
		sub: 'running',
		enabled: 'static',
		mainPid: 1,
		fragment: '# synthetic\n',
		activeSince: now() - 7200_000,
		journalUnit: 'systemd',
	})

	add(
		mkService('ssh.service', 'OpenBSD Secure Shell server', {
			active: 'active',
			sub: 'running',
			enabled: 'enabled',
			fragment: `# /lib/systemd/system/ssh.service
[Unit]
Description=OpenBSD Secure Shell server
After=network.target

[Service]
Type=notify
ExecStart=/usr/sbin/sshd -D
ExecReload=/bin/kill -HUP $MAINPID

[Install]
WantedBy=multi-user.target
`,
		}),
	)
	// alias
	m.set('sshd.service', { ...m.get('ssh.service')!, name: 'sshd.service', enabled: 'alias' })

	add(
		mkService('nginx.service', 'A high performance web server and a reverse proxy server', {
			active: 'inactive',
			sub: 'dead',
			enabled: 'disabled',
			fragment: `# /lib/systemd/system/nginx.service
[Unit]
Description=A high performance web server and a reverse proxy server
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
PIDFile=/run/nginx.pid
ExecStart=/usr/sbin/nginx
ExecReload=/usr/sbin/nginx -s reload
ExecStop=/bin/kill -s QUIT $MAINPID

[Install]
WantedBy=multi-user.target
`,
		}),
	)

	add(
		mkService('cron.service', 'Regular background program processing daemon', {
			active: 'active',
			sub: 'running',
			enabled: 'enabled',
		}),
	)
	add(
		mkService('networking.service', 'Raise network interfaces', {
			active: 'active',
			sub: 'exited',
			enabled: 'enabled',
		}),
	)
	add(
		mkService('systemd-journald.service', 'Journal Service', {
			active: 'active',
			sub: 'running',
			enabled: 'static',
		}),
	)
	add(
		mkService('systemd-logind.service', 'User Login Management', {
			active: 'active',
			sub: 'running',
			enabled: 'static',
		}),
	)
	add(
		mkService('dbus.service', 'D-Bus System Message Bus', {
			active: 'active',
			sub: 'running',
			enabled: 'static',
		}),
	)
	add(
		mkService('docker.service', 'Docker Application Container Engine', {
			active: 'inactive',
			sub: 'dead',
			enabled: 'disabled',
		}),
	)
	add(
		mkService('fail2ban.service', 'Fail2Ban Service', {
			active: 'inactive',
			sub: 'dead',
			enabled: 'disabled',
		}),
	)

	// Targets
	const targets: [string, string, Enablement][] = [
		['multi-user.target', 'Multi-User System', 'static'],
		['graphical.target', 'Graphical Interface', 'static'],
		['rescue.target', 'Rescue Mode', 'static'],
		['emergency.target', 'Emergency Mode', 'static'],
		['poweroff.target', 'Power-Off', 'static'],
		['reboot.target', 'Reboot', 'static'],
		['network.target', 'Network', 'static'],
		['network-online.target', 'Network is Online', 'static'],
		['sysinit.target', 'System Initialization', 'static'],
		['basic.target', 'Basic System', 'static'],
	]
	for (const [name, desc, en] of targets) {
		add({
			name,
			type: 'target',
			description: desc,
			load: 'loaded',
			active: name === 'multi-user.target' || name === 'basic.target' || name === 'sysinit.target' || name === 'network.target' || name === 'network-online.target' ? 'active' : 'inactive',
			sub: name.endsWith('.target') && (name === 'multi-user.target' || name === 'basic.target' || name === 'sysinit.target' || name.startsWith('network')) ? 'active' : 'dead',
			enabled: en,
			mainPid: 0,
			fragment: `# /lib/systemd/system/${name}\n[Unit]\nDescription=${desc}\n`,
			activeSince: name === 'multi-user.target' ? now() - 7200_000 : null,
			journalUnit: name,
		})
	}
	// Fix target substate to systemd-like
	for (const u of m.values()) {
		if (u.type === 'target') {
			u.sub = u.active === 'active' ? 'active' : 'dead'
		}
	}

	add({
		name: 'cron.timer',
		type: 'timer',
		description: 'Regular background program processing timer',
		load: 'loaded',
		active: 'active',
		sub: 'waiting',
		enabled: 'enabled',
		mainPid: 0,
		fragment: '# timer unit\n',
		activeSince: now() - 7200_000,
		journalUnit: 'cron.timer',
	})

	add({
		name: 'ssh.socket',
		type: 'socket',
		description: 'OpenBSD Secure Shell server socket',
		load: 'loaded',
		active: 'inactive',
		sub: 'dead',
		enabled: 'disabled',
		mainPid: 0,
		fragment: '# socket unit\n',
		activeSince: null,
		journalUnit: 'ssh.socket',
	})

	// Assign main PIDs for active services
	let pid = 200
	for (const u of m.values()) {
		if (u.type === 'service' && u.active === 'active' && u.mainPid === 0 && u.name !== 'systemd.service') {
			u.mainPid = pid++
		}
	}

	return m
}

function seedJournal(bootId: string, bootTime: number): JournalEntry[] {
	const entries: JournalEntry[] = []
	const push = (offsetMs: number, prio: number, unit: string, message: string) => {
		entries.push({
			ts: bootTime + offsetMs,
			prio,
			unit,
			message,
			bootId,
		})
	}
	push(0, 6, 'kernel', 'Linux version FakeShell 0.1.0 (lab) #1 SMP browser')
	push(100, 6, 'systemd', 'systemd 255 (FakeShell-lab fake) running in system mode')
	push(200, 6, 'systemd', 'Detected virtualization browser.')
	push(500, 6, 'systemd', 'Set hostname to <fakeshell-lab>.')
	push(1000, 6, 'systemd', 'Reached target Local File Systems.')
	push(1200, 6, 'systemd', 'Starting Network...')
	push(1500, 6, 'networking.service', 'Configured eth0 (192.168.1.42/24).')
	push(1800, 6, 'systemd', 'Reached target Network.')
	push(2000, 6, 'ssh.service', 'Server listening on 0.0.0.0 port 22.')
	push(2100, 6, 'ssh.service', 'Server listening on :: port 22.')
	push(2500, 6, 'cron.service', 'Cron started.')
	push(3000, 6, 'systemd', 'Reached target Multi-User System.')
	push(3200, 6, 'systemd', 'Startup finished in 3.200s (lab).')
	push(5000, 5, 'sshd', 'Accepted publickey for user from 192.168.1.10 port 54321')
	push(8000, 4, 'nginx.service', 'nginx.service: Unit not started (disabled).')
	push(12000, 3, 'kernel', 'lab: sample warning — disk simulation at 25%')
	return entries
}

let STATE: SystemdState = createState()

function createState(): SystemdState {
	const bootTime = now() - 7200_000
	const units = defaultUnits()
	return {
		hostname: 'fakeshell-lab',
		defaultTarget: 'multi-user.target',
		bootId: BOOT_ID,
		bootTime,
		units,
		journal: seedJournal(BOOT_ID, bootTime),
		nextPid: 400,
	}
}

export function resetSystemd(): void {
	STATE = createState()
}

function getUnit(name: string): Unit | undefined {
	const k = unitKey(name)
	return STATE.units.get(k)
}

function requireUnit(name: string): { unit?: Unit; err?: SysResult } {
	const u = getUnit(name)
	if (!u || u.load === 'not-found') {
		return {
			err: {
				stdout: '',
				stderr: `Unit ${unitKey(name)} could not be found.\n`,
				exitCode: 4,
			},
		}
	}
	return { unit: u }
}

function log(unit: string, prio: number, message: string): void {
	STATE.journal.push({
		ts: now(),
		prio,
		unit: unit.includes('.') ? unit : `${unit}.service`,
		message,
		bootId: STATE.bootId,
	})
	// cap journal size
	if (STATE.journal.length > 500) {
		STATE.journal = STATE.journal.slice(-400)
	}
}

function fmtTime(ts: number): string {
	const d = new Date(ts)
	const mon = d.toLocaleString('en-US', { month: 'short' })
	const day = String(d.getDate()).padStart(2, ' ')
	const t = d.toTimeString().slice(0, 8)
	return `${mon} ${day} ${t}`
}

/** systemd-style ANSI (when stdout is a TTY / lab pager). */
const C = {
	reset: '\x1b[0m',
	bold: '\x1b[1m',
	dim: '\x1b[2m',
	// classic systemd palette
	green: '\x1b[0;32m',
	red: '\x1b[0;31m',
	yellow: '\x1b[0;33m',
	white: '\x1b[0;37m',
	hiGreen: '\x1b[1;32m',
	hiRed: '\x1b[1;31m',
}

function colorActive(state: ActiveState): string {
	if (state === 'active') return C.green + state + C.reset
	if (state === 'failed') return C.red + state + C.reset
	if (state === 'activating' || state === 'deactivating') return C.yellow + state + C.reset
	return C.white + state + C.reset
}

function colorBullet(state: ActiveState): string {
	if (state === 'active') return C.green + '●' + C.reset
	if (state === 'failed') return C.red + '●' + C.reset
	if (state === 'activating') return C.yellow + '●' + C.reset
	return C.white + '○' + C.reset
}

function ago(ts: number | null): string {
	if (ts == null) return 'n/a'
	const s = Math.max(0, Math.floor((now() - ts) / 1000))
	if (s < 60) return `${s}s ago`
	if (s < 3600) return `${Math.floor(s / 60)}min ago`
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`
	return `${Math.floor(s / 86400)}d ago`
}

// ─── systemctl ──────────────────────────────────────────────────────────────

export function runSystemctl(args: string[]): SysResult {
	const a = args.filter((x) => x !== '--')
	// strip global flags we accept
	const flags = new Set<string>()
	const pos: string[] = []
	for (let i = 0; i < a.length; i++) {
		const t = a[i]
		if (t === '--system' || t === '--user' || t === '--no-pager' || t === '--no-legend' || t === '-q' || t === '--quiet') {
			flags.add(t)
			continue
		}
		if (t === '--type' || t === '-t') {
			pos.push(t, a[++i] ?? '')
			continue
		}
		if (t === '--all' || t === '-a' || t === '--failed' || t === '-l' || t === '--full') {
			flags.add(t)
			continue
		}
		pos.push(t)
	}

	const verb = pos[0] ?? 'list-units'
	const rest = pos.slice(1)

	// help / version
	if (verb === '--help' || verb === '-h' || verb === 'help') {
		return { stdout: SYSTEMCTL_HELP, stderr: '', exitCode: 0 }
	}
	if (verb === '--version') {
		return {
			stdout: 'systemd 255 (FakeShell-lab fake)\n+PAM +AUDIT +SELINUX -APPARMOR +IMA +SMACK +SECCOMP +GCRYPT +GNUTLS +OPENSSL +ACL +BLKID +CURL +ELFUTILS +FIDO2 +IDN2 -IDN +IPTC +KMOD +LIBCRYPTSETUP +LIBFDISK +PCRE2 -PWQUALITY +P11KIT +QRENCODE +TPM2 +BZIP2 +LZ4 +XZ +ZLIB +ZSTD -BPF_FRAMEWORK -XKBCOMMON +UTMP +SYSVINIT default-hierarchy=unified\n',
			stderr: '',
			exitCode: 0,
		}
	}

	switch (verb) {
		case 'list-units':
			return listUnits(rest, flags)
		case 'list-unit-files':
			return listUnitFiles(rest)
		case 'status':
			return statusCmd(rest)
		case 'start':
			return startStop('start', rest)
		case 'stop':
			return startStop('stop', rest)
		case 'restart':
			return restartCmd(rest)
		case 'reload':
			return reloadCmd(rest)
		case 'enable':
			return enableCmd(rest, true)
		case 'disable':
			return enableCmd(rest, false)
		case 'is-active':
			return isActive(rest)
		case 'is-enabled':
			return isEnabled(rest)
		case 'is-failed':
			return isFailed(rest)
		case 'get-default':
			return { stdout: STATE.defaultTarget + '\n', stderr: '', exitCode: 0 }
		case 'set-default':
			return setDefault(rest)
		case 'daemon-reload':
			log('systemd', 6, 'Reloading unit files (lab no-op success).')
			return { stdout: '', stderr: '', exitCode: 0 }
		case 'cat':
			return catUnit(rest)
		case 'show':
			return showUnit(rest)
		case 'show-environment':
			return {
				stdout: `LANG=fa_IR.UTF-8\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n`,
				stderr: '',
				exitCode: 0,
			}
		case 'isolate':
			return isolateCmd(rest)
		case 'reboot':
			log('systemd', 6, 'Reboot requested (lab: simulated).')
			return {
				stdout: '',
				stderr: 'Failed to reboot: FakeShell lab cannot reboot the host.\n(Simulated: would run systemctl isolate reboot.target)\n',
				exitCode: 1,
			}
		case 'poweroff':
		case 'halt':
			return {
				stdout: '',
				stderr: `Failed to ${verb}: FakeShell lab cannot power off the host.\n`,
				exitCode: 1,
			}
		case 'suspend':
		case 'hibernate':
			return {
				stdout: '',
				stderr: `Failed to ${verb}: not supported in FakeShell lab.\n`,
				exitCode: 1,
			}
		default:
			// systemctl ssh → treat as status shorthand? real systemctl doesn't.
			// If looks like unit name, show status
			if (verb.includes('.') || getUnit(verb)) {
				return statusCmd([verb, ...rest])
			}
			return {
				stdout: '',
				stderr: `Unknown command verb '${verb}'.\n`,
				exitCode: 1,
			}
	}
}

const SYSTEMCTL_HELP = `systemctl [OPTIONS...] COMMAND [NAME...]

Query or send control commands to the systemd manager (FakeShell lab fake).

Unit Commands:
  list-units [PATTERN...]     List loaded units
  list-unit-files [PATTERN...]
                              List installed unit files
  status [UNIT...]            Show runtime status
  show [UNIT...]              Show properties
  cat UNIT...                 Show unit file
  start UNIT...               Start (activate) one or more units
  stop UNIT...                Stop (deactivate) one or more units
  restart UNIT...             Start or restart one or more units
  reload UNIT...              Reload one or more units
  enable UNIT...              Enable one or more units
  disable UNIT...             Disable one or more units
  is-active UNIT...           Check whether units are active
  is-enabled UNIT...          Check whether units are enabled
  is-failed UNIT...           Check whether units are failed

Unit File Commands:
  daemon-reload               Reload systemd manager configuration

System Commands:
  get-default                 Get the name of the default target
  set-default TARGET          Set the default target
  isolate TARGET              Start one unit and stop all others
  show-environment            Dump environment

FakeShell: in-memory fake systemd — not the real PID 1 daemon.
`

function listUnits(rest: string[], flags: Set<string>): SysResult {
	let typeFilter: string | null = null
	const patterns: string[] = []
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === '--type' || rest[i] === '-t') {
			typeFilter = rest[++i] ?? null
			continue
		}
		if (rest[i].startsWith('--type=')) {
			typeFilter = rest[i].slice('--type='.length)
			continue
		}
		if (!rest[i].startsWith('-')) patterns.push(rest[i])
	}

	const all = flags.has('--all') || flags.has('-a')
	const failedOnly = flags.has('--failed')

	let units = [...STATE.units.values()]
	// hide aliases duplicate display for list (sshd.service alias)
	units = units.filter((u) => u.enabled !== 'alias')
	if (typeFilter) {
		const types = typeFilter.split(',')
		units = units.filter((u) => types.includes(u.type))
	}
	if (failedOnly) units = units.filter((u) => u.active === 'failed')
	else if (!all) {
		// default: show active + failed + those with interesting state
		units = units.filter(
			(u) => u.active === 'active' || u.active === 'failed' || u.active === 'activating',
		)
	}
	if (patterns.length) {
		units = units.filter((u) => patterns.some((p) => matchPat(u.name, p)))
	}

	units.sort((a, b) => a.name.localeCompare(b.name))

	const legend = flags.has('--no-legend')
	const lines: string[] = []
	if (!legend) {
		lines.push(
			'  UNIT                        LOAD   ACTIVE   SUB       DESCRIPTION',
		)
	}
	for (const u of units) {
		const mark = colorBullet(u.active)
		// pad name without counting ANSI
		const name = u.name.padEnd(27)
		const load = u.load.padEnd(6)
		const activePlain = u.active.padEnd(8)
		const activeCol =
			u.active === 'active'
				? C.green + activePlain + C.reset
				: u.active === 'failed'
					? C.red + activePlain + C.reset
					: activePlain
		const sub = u.sub.padEnd(9)
		lines.push(`${mark} ${name} ${load} ${activeCol} ${sub} ${u.description}`)
	}
	if (!legend) {
		lines.push('')
		lines.push(
			`${C.dim}Legend: LOAD   → Reflects whether the unit definition was properly loaded.${C.reset}`,
		)
		lines.push(
			`${C.dim}        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.${C.reset}`,
		)
		lines.push(
			`${C.dim}        SUB    → The low-level unit activation state, values depend on unit type.${C.reset}`,
		)
		lines.push('')
		lines.push(
			`${units.length} loaded units listed. Pass --all to see loaded but inactive units, too.`,
		)
		lines.push(`To show all installed unit files use 'systemctl list-unit-files'.`)
	}
	return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
}

function matchPat(name: string, pat: string): boolean {
	// simple glob *
	if (!pat.includes('*')) return name.includes(pat) || name === unitKey(pat)
	const re = new RegExp('^' + pat.split('*').map(escapeRe).join('.*') + '$')
	return re.test(name)
}

function escapeRe(s: string): string {
	return s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function listUnitFiles(rest: string[]): SysResult {
	let typeFilter: string | null = null
	const patterns: string[] = []
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === '--type' || rest[i] === '-t') {
			typeFilter = rest[++i] ?? null
			continue
		}
		if (rest[i].startsWith('--type=')) {
			typeFilter = rest[i].slice('--type='.length)
			continue
		}
		if (!rest[i].startsWith('-')) patterns.push(rest[i])
	}

	let units = [...STATE.units.values()].filter((u) => u.enabled !== 'alias')
	if (typeFilter) {
		const types = typeFilter.split(',')
		units = units.filter((u) => types.includes(u.type))
	}
	if (patterns.length) {
		units = units.filter((u) => patterns.some((p) => matchPat(u.name, p)))
	}
	units.sort((a, b) => a.name.localeCompare(b.name))

	const lines = ['UNIT FILE                              STATE     PRESET']
	for (const u of units) {
		const state = u.enabled === 'static' ? 'static' : u.enabled
		lines.push(`${u.name.padEnd(38)} ${state.padEnd(9)} ${state === 'enabled' ? 'enabled' : 'disabled'}`)
	}
	lines.push('')
	lines.push(`${units.length} unit files listed.`)
	return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
}

function statusCmd(rest: string[]): SysResult {
	const names = rest.filter((r) => !r.startsWith('-'))
	if (!names.length) {
		// systemctl status → overall
		return {
			stdout:
				`${C.green}●${C.reset} ${C.bold}fakeshell-lab${C.reset}\n` +
				`    State: ${C.green}running${C.reset}\n` +
				`     Jobs: 0 queued\n` +
				`   Failed: 0 units\n` +
				`    Since: ${fmtTime(STATE.bootTime)}; ${ago(STATE.bootTime)}\n` +
				`   CGroup: /\n` +
				`           └─1 /usr/lib/systemd/systemd (FakeShell lab fake)\n`,
			stderr: '',
			exitCode: 0,
		}
	}

	const chunks: string[] = []
	let exit = 0
	for (const n of names) {
		const { unit, err } = requireUnit(n)
		if (err || !unit) {
			chunks.push(err!.stderr)
			exit = 4
			continue
		}
		const dot = colorBullet(unit.active)
		const since =
			unit.activeSince != null
				? `; ${fmtTime(unit.activeSince)}; ${ago(unit.activeSince)}`
				: ''
		const activeStr =
			unit.active === 'active'
				? `${C.green}active${C.reset} (${unit.sub})`
				: unit.active === 'failed'
					? `${C.red}failed${C.reset} (${unit.sub})`
					: `${unit.active} (${unit.sub})`
		const lines = [
			`${dot} ${C.bold}${unit.name}${C.reset} - ${unit.description}`,
			`     Loaded: ${unit.load} (/lib/systemd/system/${unit.name}; ${unit.enabled}; vendor preset: enabled)`,
			`     Active: ${activeStr}${since}`,
		]
		if (unit.mainPid > 0 && unit.active === 'active') {
			lines.push(
				`   Main PID: ${unit.mainPid} (${unit.name.replace(/\.service$/, '')})`,
			)
			lines.push(`      Tasks: 1 (limit: 4915)`)
			lines.push(`     Memory: 12.0M (lab)`)
			lines.push(`        CPU: 120ms`)
		}
		lines.push(`     CGroup: /system.slice/${unit.name}`)
		if (unit.mainPid > 0 && unit.active === 'active') {
			lines.push(
				`             └─${unit.mainPid} /usr/sbin/${unit.name.replace(/\.service$/, '')}`,
			)
		}
		// recent journal
		const logs = STATE.journal
			.filter((e) => e.unit === unit.name || e.unit === unit.journalUnit)
			.slice(-5)
		if (logs.length) {
			lines.push(``)
			for (const e of logs) {
				const pfx =
					e.prio <= 3 ? C.red : e.prio <= 4 ? C.yellow : C.dim
				lines.push(
					`${pfx}${fmtTime(e.ts)} ${STATE.hostname} ${e.unit}[lab]: ${e.message}${C.reset}`,
				)
			}
		}
		chunks.push(lines.join('\n') + '\n')
		if (unit.active !== 'active') exit = Math.max(exit, 3)
	}
	return { stdout: chunks.join('\n'), stderr: '', exitCode: exit }
}

function startStop(op: 'start' | 'stop', rest: string[]): SysResult {
	const names = rest.filter((r) => !r.startsWith('-') && r !== '--now')
	if (!names.length) {
		return { stdout: '', stderr: `Too few arguments.\n`, exitCode: 1 }
	}
	for (const n of names) {
		const { unit, err } = requireUnit(n)
		if (err || !unit) return err!
		if (unit.type === 'target' && op === 'stop') {
			return {
				stdout: '',
				stderr: `Failed to stop ${unit.name}: Operation refused in lab for targets (use isolate).\n`,
				exitCode: 1,
			}
		}
		if (op === 'start') {
			if (unit.active === 'active' && unit.sub === 'running') {
				log(unit.name, 6, `${unit.name}: already running`)
				continue
			}
			unit.active = 'active'
			unit.sub =
				unit.type === 'service'
					? unit.name.includes('networking')
						? 'exited'
						: 'running'
					: unit.type === 'target'
						? 'active'
						: unit.type === 'timer'
							? 'waiting'
							: 'listening'
			if (unit.type === 'service' && unit.sub === 'running') {
				unit.mainPid = STATE.nextPid++
			}
			unit.activeSince = now()
			log(unit.name, 6, `Started ${unit.description}.`)
		} else {
			unit.active = 'inactive'
			unit.sub = 'dead'
			unit.mainPid = 0
			unit.activeSince = null
			log(unit.name, 6, `Stopped ${unit.description}.`)
		}
	}
	return { stdout: '', stderr: '', exitCode: 0 }
}

function restartCmd(rest: string[]): SysResult {
	const r1 = startStop('stop', rest)
	if (r1.exitCode !== 0) return r1
	return startStop('start', rest)
}

function reloadCmd(rest: string[]): SysResult {
	const names = rest.filter((r) => !r.startsWith('-'))
	if (!names.length) return { stdout: '', stderr: 'Too few arguments.\n', exitCode: 1 }
	for (const n of names) {
		const { unit, err } = requireUnit(n)
		if (err || !unit) return err!
		if (unit.active !== 'active') {
			return {
				stdout: '',
				stderr: `Failed to reload ${unit.name}: Job failed because unit is not loaded/active.\n`,
				exitCode: 1,
			}
		}
		log(unit.name, 6, `Reloaded ${unit.description}.`)
	}
	return { stdout: '', stderr: '', exitCode: 0 }
}

function enableCmd(rest: string[], enable: boolean): SysResult {
	const nowFlag = rest.includes('--now')
	const names = rest.filter((r) => !r.startsWith('-'))
	if (!names.length) return { stdout: '', stderr: 'Too few arguments.\n', exitCode: 1 }
	const lines: string[] = []
	for (const n of names) {
		const { unit, err } = requireUnit(n)
		if (err || !unit) return err!
		if (unit.enabled === 'static' || unit.enabled === 'alias') {
			lines.push(
				enable
					? `The unit files have no installation config (WantedBy=, RequiredBy=, …).\n`
					: ``,
			)
			if (unit.enabled === 'static') {
				return {
					stdout: lines.join(''),
					stderr: enable
						? `${unit.name} is static and cannot be enabled/disabled.\n`
						: `${unit.name} is static.\n`,
					exitCode: 1,
				}
			}
		}
		unit.enabled = enable ? 'enabled' : 'disabled'
		if (enable) {
			lines.push(`Created symlink /etc/systemd/system/multi-user.target.wants/${unit.name} → /lib/systemd/system/${unit.name}.\n`)
		} else {
			lines.push(`Removed /etc/systemd/system/multi-user.target.wants/${unit.name}.\n`)
		}
		log('systemd', 6, `${enable ? 'Enabled' : 'Disabled'} ${unit.name}.`)
		if (nowFlag) {
			startStop(enable ? 'start' : 'stop', [unit.name])
		}
	}
	return { stdout: lines.join(''), stderr: '', exitCode: 0 }
}

function isActive(rest: string[]): SysResult {
	const names = rest.filter((r) => !r.startsWith('-'))
	if (!names.length) return { stdout: '', stderr: 'Too few arguments.\n', exitCode: 1 }
	const outs: string[] = []
	let exit = 0
	for (const n of names) {
		const u = getUnit(n)
		const state = u?.active ?? 'inactive'
		outs.push(colorActive(state))
		if (state !== 'active') exit = 3
	}
	return { stdout: outs.join('\n') + '\n', stderr: '', exitCode: exit }
}

function isEnabled(rest: string[]): SysResult {
	const names = rest.filter((r) => !r.startsWith('-'))
	if (!names.length) return { stdout: '', stderr: 'Too few arguments.\n', exitCode: 1 }
	const outs: string[] = []
	let exit = 0
	for (const n of names) {
		const u = getUnit(n)
		if (!u) {
			outs.push('not-found')
			exit = 1
			continue
		}
		outs.push(u.enabled)
		if (u.enabled !== 'enabled' && u.enabled !== 'static') exit = 1
	}
	return { stdout: outs.join('\n') + '\n', stderr: '', exitCode: exit }
}

function isFailed(rest: string[]): SysResult {
	const names = rest.filter((r) => !r.startsWith('-'))
	if (!names.length) return { stdout: '', stderr: 'Too few arguments.\n', exitCode: 1 }
	const outs: string[] = []
	let exit = 1 // 0 if any failed? real: 0 if failed
	let anyFailed = false
	for (const n of names) {
		const u = getUnit(n)
		const failed = u?.active === 'failed'
		outs.push(failed ? 'failed' : 'active')
		if (failed) anyFailed = true
	}
	exit = anyFailed ? 0 : 1
	return { stdout: outs.join('\n') + '\n', stderr: '', exitCode: exit }
}

function setDefault(rest: string[]): SysResult {
	const t = rest.find((r) => !r.startsWith('-'))
	if (!t) return { stdout: '', stderr: 'Too few arguments.\n', exitCode: 1 }
	const name = t.includes('.') ? t : `${t}.target`
	const u = getUnit(name)
	if (!u || u.type !== 'target') {
		return {
			stdout: '',
			stderr: `Failed to set ${name} as default: Unit not found or not a target.\n`,
			exitCode: 1,
		}
	}
	STATE.defaultTarget = name
	return {
		stdout: `Created symlink /etc/systemd/system/default.target → /lib/systemd/system/${name}.\n`,
		stderr: '',
		exitCode: 0,
	}
}

function isolateCmd(rest: string[]): SysResult {
	const t = rest.find((r) => !r.startsWith('-'))
	if (!t) return { stdout: '', stderr: 'Too few arguments.\n', exitCode: 1 }
	const name = unitKey(t).endsWith('.target') ? unitKey(t) : `${t.replace(/\.service$/, '')}.target`
	const key = name.includes('.') ? name : `${name}.target`
	const u = getUnit(key)
	if (!u) {
		return { stdout: '', stderr: `Failed to isolate ${key}: Unit not found.\n`, exitCode: 1 }
	}
	// Mark this target active; simplified
	for (const x of STATE.units.values()) {
		if (x.type === 'target' && x.name !== key && !['sysinit.target', 'basic.target', 'network.target', 'network-online.target'].includes(x.name)) {
			if (['graphical.target', 'multi-user.target', 'rescue.target', 'emergency.target'].includes(x.name)) {
				x.active = 'inactive'
				x.sub = 'dead'
			}
		}
	}
	u.active = 'active'
	u.sub = 'active'
	u.activeSince = now()
	log('systemd', 6, `Isolated ${key}.`)
	return { stdout: '', stderr: '', exitCode: 0 }
}

function catUnit(rest: string[]): SysResult {
	const names = rest.filter((r) => !r.startsWith('-'))
	if (!names.length) return { stdout: '', stderr: 'Too few arguments.\n', exitCode: 1 }
	const parts: string[] = []
	for (const n of names) {
		const { unit, err } = requireUnit(n)
		if (err || !unit) return err!
		parts.push(`# /lib/systemd/system/${unit.name}`)
		parts.push(unit.fragment.trimEnd())
		parts.push('')
	}
	return { stdout: parts.join('\n') + '\n', stderr: '', exitCode: 0 }
}

function showUnit(rest: string[]): SysResult {
	const names = rest.filter((r) => !r.startsWith('-') && !r.includes('='))
	const props = rest.filter((r) => r.startsWith('--property=') || r === '-p')
	void props
	if (!names.length) {
		return {
			stdout: `Id=fakeshell-lab\nVersion=255 (FakeShell-lab fake)\nVirtualization=browser\nArchitecture=x86-64\n`,
			stderr: '',
			exitCode: 0,
		}
	}
	const parts: string[] = []
	for (const n of names) {
		const { unit, err } = requireUnit(n)
		if (err || !unit) return err!
		parts.push(
			[
				`Id=${unit.name}`,
				`Names=${unit.name}`,
				`Description=${unit.description}`,
				`LoadState=${unit.load}`,
				`ActiveState=${unit.active}`,
				`SubState=${unit.sub}`,
				`UnitFileState=${unit.enabled}`,
				`FragmentPath=/lib/systemd/system/${unit.name}`,
				`ActiveEnterTimestamp=${unit.activeSince ? new Date(unit.activeSince).toISOString() : 'n/a'}`,
				`MainPID=${unit.mainPid}`,
				`Type=${unit.type}`,
			].join('\n'),
		)
	}
	return { stdout: parts.join('\n\n') + '\n', stderr: '', exitCode: 0 }
}

// ─── journalctl ─────────────────────────────────────────────────────────────

export function runJournalctl(args: string[]): SysResult {
	const a = [...args]
	if (a.includes('-h') || a.includes('--help')) {
		return { stdout: JOURNALCTL_HELP, stderr: '', exitCode: 0 }
	}
	if (a.includes('--version')) {
		return {
			stdout: 'systemd 255 (FakeShell-lab fake)\n+PAGER +LZIP …\n',
			stderr: '',
			exitCode: 0,
		}
	}

	let unit: string | null = null
	let boot = false
	let lines = 1000
	let priority: number | null = null
	let follow = false
	let noPager = false
	let reverse = false
	let catalog = false

	for (let i = 0; i < a.length; i++) {
		const t = a[i]
		if (t === '-u' || t === '--unit') {
			unit = unitKey(a[++i] ?? '')
			continue
		}
		if (t.startsWith('--unit=')) {
			unit = unitKey(t.slice('--unit='.length))
			continue
		}
		if (t === '-b' || t === '--boot') {
			boot = true
			continue
		}
		if (t === '-n' || t === '--lines') {
			lines = Math.max(1, parseInt(a[++i] ?? '10', 10) || 10)
			continue
		}
		if (t.startsWith('--lines=')) {
			lines = Math.max(1, parseInt(t.slice('--lines='.length), 10) || 10)
			continue
		}
		if (t === '-p' || t === '--priority') {
			priority = parsePrio(a[++i] ?? 'err')
			continue
		}
		if (t.startsWith('--priority=')) {
			priority = parsePrio(t.slice('--priority='.length))
			continue
		}
		if (t === '-f' || t === '--follow') {
			follow = true
			continue
		}
		if (t === '--no-pager') {
			noPager = true
			continue
		}
		if (t === '-r' || t === '--reverse') {
			reverse = true
			continue
		}
		if (t === '-x') {
			catalog = true
			continue
		}
		if (t === '-xe') {
			catalog = true
			// also imply recent
			if (!a.includes('-n') && !a.some((x) => x.startsWith('--lines'))) lines = 50
			continue
		}
	}
	void noPager
	void follow // lab: dump recent and note that -f is simulated

	let entries = [...STATE.journal]
	if (boot) entries = entries.filter((e) => e.bootId === STATE.bootId)
	if (unit) {
		const u = unit
		entries = entries.filter(
			(e) => e.unit === u || e.unit === u.replace(/\.service$/, '') || e.unit.startsWith(u.replace(/\.service$/, '')),
		)
	}
	if (priority != null) {
		const p = priority
		entries = entries.filter((e) => e.prio <= p)
	}
	if (reverse) entries = entries.reverse()
	// take last N (unless reverse already flipped)
	if (!reverse) entries = entries.slice(-lines)
	else entries = entries.slice(0, lines)

	if (!entries.length) {
		return {
			stdout: '-- No entries --\n',
			stderr: follow ? '(FakeShell: -f follow not streaming; showing current buffer)\n' : '',
			exitCode: 0,
		}
	}

	const out = entries.map((e) => {
		const host = STATE.hostname
		const ident = e.unit.replace(/\.service$/, '')
		const cat = catalog && e.prio <= 3 ? ' — lab explanatory text for this error event.' : ''
		return `${fmtTime(e.ts)} ${host} ${ident}[lab]: ${e.message}${cat}`
	})

	let stdout = out.join('\n') + '\n'
	if (follow) {
		stdout +=
			'-- FakeShell: journalctl -f is not a live stream; showing snapshot. Run again for new lines. --\n'
	}
	return { stdout, stderr: '', exitCode: 0 }
}

function parsePrio(s: string): number {
	const map: Record<string, number> = {
		emerg: 0,
		alert: 1,
		crit: 2,
		err: 3,
		error: 3,
		warning: 4,
		warn: 4,
		notice: 5,
		info: 6,
		debug: 7,
	}
	if (map[s] != null) return map[s]
	const n = parseInt(s, 10)
	return Number.isFinite(n) ? Math.min(7, Math.max(0, n)) : 3
}

const JOURNALCTL_HELP = `journalctl [OPTIONS...] [MATCHES...]

Query the systemd journal (FakeShell lab fake).

Options:
  -u --unit=UNIT        Show logs from unit
  -b --boot             Current boot only
  -n --lines=N          Number of journal entries to show
  -p --priority=PRIO    Filter by priority (err, warning, info, …)
  -f --follow           Follow (lab: snapshot + note)
  -r --reverse          Newest first
  -x                    Add catalog explanations for errors
  --no-pager            Do not pipe to pager

FakeShell: in-memory journal — not persistent binary journald storage.
`

// ─── helpers for seed / ps ──────────────────────────────────────────────────

/** Process rows for the lab `ps` command (kept in sync with unit main PIDs). */
export interface SysProc {
	pid: number
	ppid: number
	user: string
	tty: string
	stat: string
	/** CPU % fake */
	pcpu: number
	/** MEM % fake */
	pmem: number
	vsz: number
	rss: number
	start: string
	time: string
	comm: string
	args: string
}

export function listSystemProcesses(): SysProc[] {
	const procs: SysProc[] = [
		{
			pid: 1,
			ppid: 0,
			user: 'root',
			tty: '?',
			stat: 'Ss',
			pcpu: 0.1,
			pmem: 0.3,
			vsz: 168_000,
			rss: 12_000,
			start: 'boot',
			time: '00:00:02',
			comm: 'systemd',
			args: '/usr/lib/systemd/systemd',
		},
		{
			pid: 2,
			ppid: 0,
			user: 'root',
			tty: '?',
			stat: 'S',
			pcpu: 0,
			pmem: 0,
			vsz: 0,
			rss: 0,
			start: 'boot',
			time: '00:00:00',
			comm: 'kthreadd',
			args: '[kthreadd]',
		},
	]

	for (const u of STATE.units.values()) {
		if (u.enabled === 'alias') continue
		if (u.type !== 'service' || u.active !== 'active' || u.mainPid <= 1) continue
		const bare = u.name.replace(/\.service$/, '')
		const isExited = u.sub === 'exited'
		procs.push({
			pid: u.mainPid,
			ppid: 1,
			user: bare === 'ssh' || bare === 'nginx' || bare === 'cron' ? 'root' : 'root',
			tty: '?',
			stat: isExited ? 'Ss' : 'Ss',
			pcpu: isExited ? 0 : 0.2 + (u.mainPid % 7) * 0.1,
			pmem: isExited ? 0.1 : 0.4 + (u.mainPid % 5) * 0.2,
			vsz: 40_000 + u.mainPid * 10,
			rss: 2_000 + u.mainPid,
			start: '10:00',
			time: isExited ? '00:00:00' : `00:00:0${u.mainPid % 10}`,
			comm: bare.length > 15 ? bare.slice(0, 15) : bare,
			args: `/usr/sbin/${bare}`,
		})
	}

	// user shell session
	procs.push({
		pid: 42,
		ppid: 1,
		user: 'user',
		tty: 'pts/0',
		stat: 'Ss',
		pcpu: 0.0,
		pmem: 0.2,
		vsz: 12_000,
		rss: 3_200,
		start: '10:01',
		time: '00:00:00',
		comm: 'bash',
		args: '-bash',
	})
	procs.push({
		pid: 128,
		ppid: 42,
		user: 'user',
		tty: 'pts/0',
		stat: 'R+',
		pcpu: 0.5,
		pmem: 0.1,
		vsz: 8_000,
		rss: 1_500,
		start: '10:02',
		time: '00:00:00',
		comm: 'ps',
		args: 'ps',
	})

	return procs.sort((a, b) => a.pid - b.pid)
}

export function systemdHostname(): string {
	return STATE.hostname
}
