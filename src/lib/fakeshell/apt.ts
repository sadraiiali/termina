/**
 * Fake apt / apt-get for the FakeShell browser lab.
 * Mimics common Ubuntu/Debian course commands (update, install, remove, search…).
 * Not a real package manager — packages are metadata + optional VFS side-effects.
 */

export interface AptPackage {
	name: string
	version: string
	section: string
	description: string
	/** Depends (names only) */
	depends?: string[]
	/** Size estimate for “Need to get” lines */
	sizeKb?: number
	/** Optional files created under VFS on install (path → content) */
	files?: Record<string, string>
}

export interface AptResult {
	stdout: string
	stderr: string
	exitCode: number
	/** Paths to write into VFS after a successful install */
	vfsWrites?: Record<string, string>
	/** Paths to remove on purge/remove */
	vfsUnlinks?: string[]
}

/** Catalog of common learning packages (fake). */
const CATALOG: AptPackage[] = [
	{
		name: 'nginx',
		version: '1.24.0-2ubuntu1',
		section: 'httpd',
		description: 'small, powerful, scalable web/proxy server',
		depends: ['libc6'],
		sizeKb: 512,
		files: {
			'/etc/nginx/nginx.conf':
				`user www-data;\nworker_processes auto;\n# FakeShell lab fake nginx config\nevents { worker_connections 768; }\nhttp {\n  server {\n    listen 80 default_server;\n    root /var/www/html;\n    index index.html;\n  }\n}\n`,
			'/var/www/html/index.html':
				`<!doctype html><html><head><title>Welcome to nginx!</title></head>` +
				`<body><h1>Welcome to nginx!</h1><p>FakeShell lab (fake install).</p></body></html>\n`,
			'/usr/sbin/nginx': '#!/bin/sh\necho "nginx: lab stub (not a real daemon)"\n',
		},
	},
	{
		name: 'apache2',
		version: '2.4.58-1ubuntu1',
		section: 'httpd',
		description: 'Apache HTTP Server',
		depends: ['libc6'],
		sizeKb: 890,
		files: {
			'/etc/apache2/apache2.conf': '# Apache lab stub config (FakeShell)\n',
			'/var/www/html/index.html':
				`<html><body><h1>It works!</h1><p>Apache (FakeShell lab fake).</p></body></html>\n`,
		},
	},
	{
		name: 'curl',
		version: '8.5.0-2ubuntu1',
		section: 'web',
		description: 'command line tool for transferring data with URL syntax',
		sizeKb: 420,
	},
	{
		name: 'wget',
		version: '1.21.4-1ubuntu1',
		section: 'web',
		description: 'retrieves files from the web',
		sizeKb: 310,
	},
	{
		name: 'git',
		version: '1:2.43.0-1ubuntu1',
		section: 'vcs',
		description: 'fast, scalable, distributed revision control system',
		sizeKb: 12000,
	},
	{
		name: 'vim',
		version: '2:9.1.0016-1ubuntu1',
		section: 'editors',
		description: 'Vi IMproved - enhanced vi editor',
		sizeKb: 3500,
	},
	{
		name: 'nano',
		version: '7.2-2ubuntu1',
		section: 'editors',
		description: "small, friendly text editor inspired by Pico",
		sizeKb: 280,
	},
	{
		name: 'htop',
		version: '3.3.0-4build1',
		section: 'utils',
		description: 'interactive processes viewer',
		sizeKb: 180,
	},
	{
		name: 'tree',
		version: '2.1.1-2',
		section: 'utils',
		description: 'displays an indented directory tree, in color',
		sizeKb: 56,
	},
	{
		name: 'net-tools',
		version: '2.10-0.1ubuntu4',
		section: 'net',
		description: 'NET-3 networking toolkit (ifconfig, netstat, …)',
		sizeKb: 240,
	},
	{
		name: 'iputils-ping',
		version: '3:20240117-1build1',
		section: 'net',
		description: 'Tools to test the reachability of network hosts',
		sizeKb: 64,
	},
	{
		name: 'openssh-server',
		version: '1:9.6p1-3ubuntu13',
		section: 'net',
		description: 'secure shell (SSH) server, for secure access from remote machines',
		depends: ['openssh-client'],
		sizeKb: 800,
		files: {
			'/etc/ssh/sshd_config': '# OpenSSH lab stub (FakeShell)\nPort 22\nPermitRootLogin no\n',
		},
	},
	{
		name: 'openssh-client',
		version: '1:9.6p1-3ubuntu13',
		section: 'net',
		description: 'secure shell (SSH) client, for secure access to remote machines',
		sizeKb: 1200,
	},
	{
		name: 'ufw',
		version: '0.36.2-6',
		section: 'admin',
		description: 'program for managing a Netfilter firewall',
		sizeKb: 200,
	},
	{
		name: 'fail2ban',
		version: '1.0.2-3',
		section: 'net',
		description: 'ban hosts that cause multiple authentication errors',
		sizeKb: 450,
	},
	{
		name: 'python3',
		version: '3.12.3-0ubuntu1',
		section: 'python',
		description: 'interactive high-level object-oriented language (default python3 version)',
		sizeKb: 90,
	},
	{
		name: 'nodejs',
		version: '18.19.1-1ubuntu1',
		section: 'javascript',
		description: 'evented I/O for V8 javascript - runtime executable',
		sizeKb: 18000,
	},
	{
		name: 'docker.io',
		version: '24.0.7-0ubuntu4',
		section: 'admin',
		description: 'Linux container runtime',
		sizeKb: 65000,
	},
	{
		name: 'build-essential',
		version: '12.10ubuntu1',
		section: 'devel',
		description: 'Informational list of build-essential packages',
		depends: ['gcc', 'g++', 'make'],
		sizeKb: 5,
	},
	{
		name: 'gcc',
		version: '4:13.2.0-7ubuntu1',
		section: 'devel',
		description: 'GNU C compiler',
		sizeKb: 40,
	},
	{
		name: 'g++',
		version: '4:13.2.0-7ubuntu1',
		section: 'devel',
		description: 'GNU C++ compiler',
		sizeKb: 40,
	},
	{
		name: 'make',
		version: '4.3-4.1build2',
		section: 'devel',
		description: 'utility for directing compilation',
		sizeKb: 180,
	},
	{
		name: 'libc6',
		version: '2.39-0ubuntu8',
		section: 'libs',
		description: 'GNU C Library: Shared libraries',
		sizeKb: 2800,
	},
	{
		name: 'ca-certificates',
		version: '20240203',
		section: 'misc',
		description: 'Common CA certificates',
		sizeKb: 150,
	},
	{
		name: 'sudo',
		version: '1.9.15p5-3ubuntu5',
		section: 'admin',
		description: 'Provide limited super user privileges to specific users',
		sizeKb: 1900,
	},
	{
		name: 'cron',
		version: '3.0pl1-184ubuntu1',
		section: 'admin',
		description: 'process scheduling daemon',
		sizeKb: 100,
	},
	{
		name: 'rsyslog',
		version: '8.2312.0-3ubuntu9',
		section: 'admin',
		description: 'reliable system and kernel logging daemon',
		sizeKb: 700,
	},
	{
		name: 'tmux',
		version: '3.4-1build1',
		section: 'admin',
		description: 'terminal multiplexer',
		sizeKb: 420,
	},
	{
		name: 'jq',
		version: '1.7.1-3build1',
		section: 'utils',
		description: 'lightweight and flexible command-line JSON processor',
		sizeKb: 380,
	},
	{
		name: 'unzip',
		version: '6.0-28ubuntu4',
		section: 'utils',
		description: 'De-archiver for .zip files',
		sizeKb: 170,
	},
]

const byName = new Map(CATALOG.map((p) => [p.name, p]))

/** Packages “already installed” on a fresh lab image */
const DEFAULT_INSTALLED = new Set([
	'libc6',
	'ca-certificates',
	'sudo',
	'cron',
	'nano',
	'vim',
	'curl',
	'iputils-ping',
	'net-tools',
	'python3',
])

let installed = new Set(DEFAULT_INSTALLED)
let lastUpdate: Date | null = new Date()
/** Simulated cache of package lists after apt update */
let listsFresh = true

export function resetAptLab(): void {
	installed = new Set(DEFAULT_INSTALLED)
	lastUpdate = new Date()
	listsFresh = true
}

function findPkg(name: string): AptPackage | undefined {
	const n = name.replace(/:amd64$/, '').replace(/=.+$/, '')
	return byName.get(n)
}

function expandDeps(names: string[]): { toInstall: AptPackage[]; missing: string[] } {
	const need = new Set<string>()
	const missing: string[] = []
	const queue = [...names]
	while (queue.length) {
		const n = queue.pop()!
		const p = findPkg(n)
		if (!p) {
			missing.push(n)
			continue
		}
		if (installed.has(p.name) || need.has(p.name)) continue
		need.add(p.name)
		for (const d of p.depends ?? []) {
			if (!installed.has(d) && !need.has(d)) queue.push(d)
		}
	}
	const toInstall = [...need].map((n) => byName.get(n)!).filter(Boolean)
	return { toInstall, missing }
}

function formatProgress(name: string, i: number, total: number): string {
	const pct = Math.round(((i + 1) / total) * 100)
	const bar = '='.repeat(Math.floor(pct / 5)).padEnd(20, ' ')
	return `Progress: [${bar}] ${pct}% (${i + 1}/${total}) ${name}`
}

function helpText(prog: string): string {
	return (
		`Usage: ${prog} [options] command\n` +
		`\n` +
		`apt is a command-line interface for package management (FakeShell lab fake).\n` +
		`\n` +
		`Common commands:\n` +
		`  update       Update list of available packages\n` +
		`  upgrade      Upgrade installed packages (lab: no-op success)\n` +
		`  install      Install packages\n` +
		`  remove       Remove packages\n` +
		`  purge        Remove packages and config files\n` +
		`  search       Search package descriptions\n` +
		`  show         Show package details\n` +
		`  list         List packages (installed / upgradable)\n` +
		`  policy       Show package priorities / installed version\n` +
		`  autoremove   Remove unused dependencies (lab: message only)\n` +
		`  clean        Clear local cache (lab: message only)\n` +
		`\n` +
		`LAB NOTES\n` +
		`  This is not real dpkg/apt. Packages are simulated for courses.\n` +
		`  Example:  sudo apt update && sudo apt install -y nginx\n`
	)
}

/**
 * Run apt or apt-get.
 * @param prog  'apt' | 'apt-get' | 'apt-cache' | 'dpkg'
 */
export function runApt(prog: string, args: string[]): AptResult {
	const a = [...args]
	// strip common global flags
	const yes =
		a.includes('-y') ||
		a.includes('--yes') ||
		a.includes('--assume-yes') ||
		// noninteractive style
		true // lab always non-interactive
	void yes
	const filtered = a.filter(
		(x) =>
			!['-y', '--yes', '--assume-yes', '-q', '--quiet', '-qq', '--no-install-recommends'].includes(
				x,
			),
	)

	// dpkg -l / -s
	if (prog === 'dpkg') {
		return runDpkg(filtered)
	}

	// apt-cache search|show|policy
	if (prog === 'apt-cache') {
		const sub = filtered[0] ?? 'help'
		const rest = filtered.slice(1)
		if (sub === 'search') return cmdSearch(rest)
		if (sub === 'show' || sub === 'showpkg') return cmdShow(rest)
		if (sub === 'policy') return cmdPolicy(rest)
		if (sub === 'depends') return cmdDepends(rest)
		return { stdout: '', stderr: `E: Invalid operation ${sub}\n`, exitCode: 100 }
	}

	const sub = filtered[0] ?? 'help'
	const rest = filtered.slice(1)

	if (sub === 'help' || sub === '-h' || sub === '--help') {
		return { stdout: helpText(prog), stderr: '', exitCode: 0 }
	}
	if (sub === 'update') return cmdUpdate()
	if (sub === 'upgrade' || sub === 'full-upgrade' || sub === 'dist-upgrade') return cmdUpgrade()
	if (sub === 'install') return cmdInstall(rest)
	if (sub === 'remove') return cmdRemove(rest, false)
	if (sub === 'purge') return cmdRemove(rest, true)
	if (sub === 'search') return cmdSearch(rest)
	if (sub === 'show') return cmdShow(rest)
	if (sub === 'list') return cmdList(rest)
	if (sub === 'policy') return cmdPolicy(rest)
	if (sub === 'autoremove' || sub === 'auto-remove') {
		return {
			stdout: 'Reading package lists... Done\nBuilding dependency tree... Done\n0 to remove.\n',
			stderr: '',
			exitCode: 0,
		}
	}
	if (sub === 'clean' || sub === 'autoclean') {
		return {
			stdout: 'Del /var/cache/apt/archives/ (lab: cache cleared)\n',
			stderr: '',
			exitCode: 0,
		}
	}
	if (sub === 'depends') return cmdDepends(rest)

	return {
		stdout: '',
		stderr: `E: Invalid operation ${sub}\n`,
		exitCode: 100,
	}
}

function cmdUpdate(): AptResult {
	listsFresh = true
	lastUpdate = new Date()
	const lines = [
		'Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease',
		'Get:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]',
		'Get:3 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]',
		'Get:4 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages [1,401 kB]',
		'Fetched 1,653 kB in 0s (lab fake)',
		'Reading package lists... Done',
		'Building dependency tree... Done',
		`${CATALOG.length} packages can be upgraded. Run 'apt list --upgradable' to see them.`,
		'',
	]
	return { stdout: lines.join('\n'), stderr: '', exitCode: 0 }
}

function cmdUpgrade(): AptResult {
	return {
		stdout:
			'Reading package lists... Done\n' +
			'Building dependency tree... Done\n' +
			'Calculating upgrade... Done\n' +
			'0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n',
		stderr: '',
		exitCode: 0,
	}
}

function cmdInstall(args: string[]): AptResult {
	const names = args.filter((a) => !a.startsWith('-'))
	if (!names.length) {
		return {
			stdout: '',
			stderr: 'E: Missing package name for install\n',
			exitCode: 100,
		}
	}
	if (!listsFresh) {
		// still proceed, like with stale lists
	}
	const { toInstall, missing } = expandDeps(names)
	if (missing.length) {
		return {
			stdout: 'Reading package lists... Done\nBuilding dependency tree... Done\n',
			stderr:
				`E: Unable to locate package ${missing[0]}\n` +
				(missing.length > 1 ? `E: Unable to locate package ${missing.slice(1).join(', ')}\n` : ''),
			exitCode: 100,
		}
	}
	const already = names.filter((n) => installed.has(findPkg(n)?.name ?? n))
	const fresh = toInstall.filter((p) => !installed.has(p.name))
	if (!fresh.length) {
		const n = findPkg(names[0])?.name ?? names[0]
		return {
			stdout:
				'Reading package lists... Done\n' +
				'Building dependency tree... Done\n' +
				`${n} is already the newest version (${findPkg(n)?.version ?? '?'}).\n` +
				'0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n',
			stderr: '',
			exitCode: 0,
		}
	}

	const totalKb = fresh.reduce((s, p) => s + (p.sizeKb ?? 100), 0)
	const lines: string[] = [
		'Reading package lists... Done',
		'Building dependency tree... Done',
		'The following NEW packages will be installed:',
		'  ' + fresh.map((p) => p.name).join(' '),
		`0 upgraded, ${fresh.length} newly installed, 0 to remove and 0 not upgraded.`,
		`Need to get ${totalKb} kB of archives.`,
		`After this operation, ${Math.round(totalKb * 2.2)} kB of additional disk space will be used.`,
		`Get:1 http://archive.ubuntu.com/ubuntu noble/main amd64 ${fresh[0].name} amd64 ${fresh[0].version} [${fresh[0].sizeKb ?? 100} kB]`,
	]
	for (let i = 1; i < fresh.length; i++) {
		const p = fresh[i]
		lines.push(
			`Get:${i + 1} http://archive.ubuntu.com/ubuntu noble/main amd64 ${p.name} amd64 ${p.version} [${p.sizeKb ?? 100} kB]`,
		)
	}
	lines.push(`Fetched ${totalKb} kB in 0s (lab fake)`)
	const vfsWrites: Record<string, string> = {}
	for (let i = 0; i < fresh.length; i++) {
		const p = fresh[i]
		lines.push(`Selecting previously unselected package ${p.name}.`)
		lines.push(`(Reading database ... ${120000 + i * 3} files and directories currently installed.)`)
		lines.push(`Preparing to unpack .../${p.name}_${p.version}_amd64.deb ...`)
		lines.push(`Unpacking ${p.name} (${p.version}) ...`)
		lines.push(`Setting up ${p.name} (${p.version}) ...`)
		lines.push(formatProgress(p.name, i, fresh.length))
		installed.add(p.name)
		if (p.files) Object.assign(vfsWrites, p.files)
	}
	lines.push('')
	void already

	return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0, vfsWrites }
}

function cmdRemove(args: string[], purge: boolean): AptResult {
	const names = args.filter((a) => !a.startsWith('-')).map((n) => findPkg(n)?.name ?? n)
	if (!names.length) {
		return { stdout: '', stderr: 'E: Missing package name\n', exitCode: 100 }
	}
	const toRemove = names.filter((n) => installed.has(n))
	const notInst = names.filter((n) => !installed.has(n))
	if (!toRemove.length) {
		return {
			stdout: 'Reading package lists... Done\n',
			stderr: `Package '${names[0]}' is not installed, so not removed\n`,
			exitCode: 0,
		}
	}
	const lines: string[] = [
		'Reading package lists... Done',
		'Building dependency tree... Done',
		`The following packages will be REMOVED:`,
		'  ' + toRemove.join(' ') + (purge ? ' (purge)' : ''),
		`0 upgraded, 0 newly installed, ${toRemove.length} to remove and 0 not upgraded.`,
	]
	const vfsUnlinks: string[] = []
	for (const n of toRemove) {
		const p = findPkg(n)
		lines.push(`Removing ${n} (${p?.version ?? '?'}) ...`)
		if (purge) lines.push(`Purging configuration files for ${n} ...`)
		installed.delete(n)
		if (p?.files) {
			for (const f of Object.keys(p.files)) vfsUnlinks.push(f)
		}
	}
	lines.push('')
	void notInst
	return { stdout: lines.join('\n'), stderr: '', exitCode: 0, vfsUnlinks }
}

function cmdSearch(args: string[]): AptResult {
	const q = (args[0] ?? '').toLowerCase()
	if (!q) {
		return { stdout: '', stderr: 'E: You must give at least one search pattern\n', exitCode: 100 }
	}
	const hits = CATALOG.filter(
		(p) =>
			p.name.includes(q) ||
			p.description.toLowerCase().includes(q) ||
			p.section.includes(q),
	)
	if (!hits.length) {
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	const lines = hits.map((p) => {
		const mark = installed.has(p.name) ? 'i' : 'p'
		return `${mark} ${p.name}/${p.section} ${p.version} [amd64]\n  ${p.description}`
	})
	return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
}

function cmdShow(args: string[]): AptResult {
	const name = args[0]
	if (!name) {
		return { stdout: '', stderr: 'E: No packages found\n', exitCode: 100 }
	}
	const p = findPkg(name)
	if (!p) {
		return { stdout: '', stderr: `E: No packages found\n`, exitCode: 100 }
	}
	const lines = [
		`Package: ${p.name}`,
		`Version: ${p.version}`,
		`Priority: optional`,
		`Section: ${p.section}`,
		`Maintainer: FakeShell Lab <lab@fakeshell.local>`,
		`Installed-Size: ${Math.round((p.sizeKb ?? 100) * 2.2)}`,
		`Depends: ${(p.depends ?? ['libc6']).join(', ')}`,
		`Download-Size: ${p.sizeKb ?? 100} kB`,
		`APT-Sources: http://archive.ubuntu.com/ubuntu noble/main amd64 Packages`,
		`Description: ${p.description}`,
		`Homepage: https://example.invalid/${p.name}`,
		``,
	]
	return { stdout: lines.join('\n'), stderr: '', exitCode: 0 }
}

function cmdList(args: string[]): AptResult {
	const upgradable = args.includes('--upgradable')
	const instOnly = args.includes('--installed') || !args.some((a) => a.startsWith('--'))
	if (upgradable) {
		return {
			stdout: 'Listing... Done\n',
			stderr: '',
			exitCode: 0,
		}
	}
	const names = instOnly
		? [...installed].sort()
		: CATALOG.map((p) => p.name).sort()
	const lines = ['Listing... Done']
	for (const n of names) {
		const p = findPkg(n)
		if (!p) continue
		const tag = installed.has(n) ? 'installed' : 'available'
		lines.push(`${p.name}/${p.section} ${p.version} amd64 [${tag}]`)
	}
	return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
}

function cmdPolicy(args: string[]): AptResult {
	const name = args[0]
	if (!name) {
		return {
			stdout:
				`Package files:\n` +
				` 100 /var/lib/dpkg/status\n` +
				`     release a=now\n` +
				` 500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages\n` +
				`     release v=24.04,o=Ubuntu,a=noble,n=noble,l=Ubuntu,c=main,b=amd64\n`,
			stderr: '',
			exitCode: 0,
		}
	}
	const p = findPkg(name)
	if (!p) {
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	const inst = installed.has(p.name) ? p.version : '(none)'
	const lines = [
		`${p.name}:`,
		`  Installed: ${inst}`,
		`  Candidate: ${p.version}`,
		`  Version table:`,
		` *** ${p.version} 500`,
		`        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages`,
		installed.has(p.name) ? `        100 /var/lib/dpkg/status` : '',
		``,
	].filter(Boolean)
	return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
}

function cmdDepends(args: string[]): AptResult {
	const p = findPkg(args[0] ?? '')
	if (!p) {
		return { stdout: '', stderr: `E: No packages found\n`, exitCode: 100 }
	}
	const deps = p.depends ?? ['libc6']
	return {
		stdout: `${p.name}\n` + deps.map((d) => `  Depends: ${d}`).join('\n') + '\n',
		stderr: '',
		exitCode: 0,
	}
}

function runDpkg(args: string[]): AptResult {
	if (args[0] === '-l' || args[0] === '--list') {
		const lines = [
			'Desired=Unknown/Install/Remove/Purge/Hold',
			'| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend',
			'|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)',
			'||/ Name           Version                      Architecture Description',
			'+++-==============-============================-============-=================================',
		]
		for (const n of [...installed].sort()) {
			const p = findPkg(n)
			if (!p) continue
			const desc = p.description.slice(0, 33)
			lines.push(`ii  ${p.name.padEnd(14)} ${p.version.padEnd(28)} amd64        ${desc}`)
		}
		return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 }
	}
	if (args[0] === '-s' || args[0] === '--status') {
		return cmdShow(args.slice(1))
	}
	if (args[0] === '-L') {
		const p = findPkg(args[1] ?? '')
		if (!p || !installed.has(p.name)) {
			return {
				stdout: '',
				stderr: `dpkg-query: package '${args[1]}' is not installed\n`,
				exitCode: 1,
			}
		}
		const files = p.files ? Object.keys(p.files) : [`/usr/share/doc/${p.name}/copyright`]
		return { stdout: files.join('\n') + '\n', stderr: '', exitCode: 0 }
	}
	return {
		stdout: '',
		stderr: 'dpkg: lab supports: dpkg -l | dpkg -s PKG | dpkg -L PKG\n',
		exitCode: 1,
	}
}

/** Seed /etc/apt and dpkg status for realism (called from seed.ts). */
export function seedAptFiles(write: (path: string, content: string) => void, mkdir: (path: string) => void): void {
	mkdir('/etc/apt')
	mkdir('/etc/apt/sources.list.d')
	mkdir('/var/lib/apt/lists')
	mkdir('/var/cache/apt/archives')
	mkdir('/var/lib/dpkg')
	mkdir('/var/lib/dpkg/info')
	write(
		'/etc/apt/sources.list',
		`# FakeShell lab — fake Ubuntu noble mirrors\n` +
			`deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse\n` +
			`deb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse\n` +
			`deb http://security.ubuntu.com/ubuntu noble-security main restricted universe multiverse\n`,
	)
	write(
		'/etc/apt/apt.conf.d/20auto-upgrades',
		`APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "0";\n`,
	)
	const statusLines = [
		'# FakeShell lab dpkg status (subset)\n',
	]
	for (const n of [...DEFAULT_INSTALLED].sort()) {
		const p = findPkg(n)
		if (!p) continue
		statusLines.push(
			`Package: ${p.name}\nStatus: install ok installed\nVersion: ${p.version}\nArchitecture: amd64\nDescription: ${p.description}\n\n`,
		)
	}
	write('/var/lib/dpkg/status', statusLines.join(''))
}
