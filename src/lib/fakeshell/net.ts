/**
 * Fake iproute2 + netfilter (iptables) for FakeShell lab.
 *
 * Structure mirrors real Linux tools (iproute2 `ip`, iptables userspace):
 *   - link / addr / route objects  →  ip
 *   - table → chain → rule        →  iptables / ip6tables
 *
 * All data is in-memory and offline. No real kernel netlink/netfilter.
 * Reset via resetNetLab() (called on shell `reset`).
 */

export interface NetResult {
	stdout: string
	stderr: string
	exitCode: number
	outputFile?: string
	fileBody?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared fake “kernel” networking state (like netdev + fib + netfilter)
// ═══════════════════════════════════════════════════════════════════════════

const HOSTNAME = 'fakeshell-lab'

interface NetDev {
	index: number
	name: string
	type: 'loopback' | 'ether'
	mac: string
	mtu: number
	flags: string[]
	state: 'UP' | 'DOWN' | 'UNKNOWN'
	/** IPv4 CIDRs */
	inet: string[]
	/** IPv6 CIDRs */
	inet6: string[]
}

interface Route4 {
	dst: string // 'default' or 'a.b.c.d/nn'
	via?: string
	dev: string
	proto: string
	scope?: string
	src?: string
	metric?: number
}

interface Neigh4 {
	ip: string
	dev: string
	lladdr: string
	state: string
}

/** iptables rule — subset of real xtables rule-spec fields */
export interface IptRule {
	/** original argv tokens after chain name (for -S / delete-by-spec) */
	spec: string[]
	/** human line for -L */
	line: string
	pkts: number
	bytes: number
}

type Policy = 'ACCEPT' | 'DROP' | 'REJECT' | 'RETURN'

interface Chain {
	name: string
	policy: Policy
	builtin: boolean
	rules: IptRule[]
}

type TableName = 'filter' | 'nat' | 'mangle' | 'raw'

interface Table {
	name: TableName
	chains: Map<string, Chain>
}

interface NetLabState {
	devs: NetDev[]
	routes: Route4[]
	neigh: Neigh4[]
	/** IPv4 iptables */
	v4: Map<TableName, Table>
	/** IPv6 ip6tables */
	v6: Map<TableName, Table>
}

function defaultDevs(): NetDev[] {
	return [
		{
			index: 1,
			name: 'lo',
			type: 'loopback',
			mac: '00:00:00:00:00:00',
			mtu: 65536,
			flags: ['LOOPBACK', 'UP', 'LOWER_UP'],
			state: 'UNKNOWN',
			inet: ['127.0.0.1/8'],
			inet6: ['::1/128'],
		},
		{
			index: 2,
			name: 'eth0',
			type: 'ether',
			mac: '52:54:00:a1:5d:42',
			mtu: 1500,
			flags: ['BROADCAST', 'MULTICAST', 'UP', 'LOWER_UP'],
			state: 'UP',
			inet: ['192.168.1.42/24'],
			inet6: ['fe80::5054:ff:fea1:5d42/64'],
		},
	]
}

function defaultRoutes(): Route4[] {
	return [
		{
			dst: 'default',
			via: '192.168.1.1',
			dev: 'eth0',
			proto: 'dhcp',
			metric: 100,
		},
		{
			dst: '192.168.1.0/24',
			dev: 'eth0',
			proto: 'kernel',
			scope: 'link',
			src: '192.168.1.42',
			metric: 100,
		},
	]
}

function defaultNeigh(): Neigh4[] {
	return [
		{ ip: '192.168.1.1', dev: 'eth0', lladdr: '52:54:00:12:34:56', state: 'REACHABLE' },
		{ ip: '192.168.1.10', dev: 'eth0', lladdr: '52:54:00:aa:bb:cc', state: 'STALE' },
	]
}

function makeChain(name: string, policy: Policy, builtin: boolean): Chain {
	return { name, policy, builtin, rules: [] }
}

function makeTable(name: TableName, chains: [string, Policy][]): Table {
	const m = new Map<string, Chain>()
	for (const [n, p] of chains) m.set(n, makeChain(n, p, true))
	return { name, chains: m }
}

function defaultIptables(v6: boolean): Map<TableName, Table> {
	// Same table/chain layout as real iptables/ip6tables
	const filter = makeTable('filter', [
		['INPUT', 'ACCEPT'],
		['FORWARD', 'ACCEPT'],
		['OUTPUT', 'ACCEPT'],
	])
	const nat = makeTable('nat', [
		['PREROUTING', 'ACCEPT'],
		['INPUT', 'ACCEPT'],
		['OUTPUT', 'ACCEPT'],
		['POSTROUTING', 'ACCEPT'],
	])
	const mangle = makeTable('mangle', [
		['PREROUTING', 'ACCEPT'],
		['INPUT', 'ACCEPT'],
		['FORWARD', 'ACCEPT'],
		['OUTPUT', 'ACCEPT'],
		['POSTROUTING', 'ACCEPT'],
	])
	const raw = makeTable('raw', [
		['PREROUTING', 'ACCEPT'],
		['OUTPUT', 'ACCEPT'],
	])

	// Seed a few educational rules (like a desktop after first setup)
	if (!v6) {
		filter.chains.get('INPUT')!.rules.push(
			mkRule(['-i', 'lo', '-j', 'ACCEPT'], 'ACCEPT     all  --  anywhere             anywhere'),
			mkRule(
				['-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'],
				'ACCEPT     all  --  anywhere             anywhere             state RELATED,ESTABLISHED',
			),
			mkRule(
				['-p', 'tcp', '--dport', '22', '-j', 'ACCEPT'],
				'ACCEPT     tcp  --  anywhere             anywhere             tcp dpt:ssh',
			),
		)
		filter.chains.get('OUTPUT')!.rules.push(
			mkRule(['-j', 'ACCEPT'], 'ACCEPT     all  --  anywhere             anywhere'),
		)
	} else {
		filter.chains.get('INPUT')!.rules.push(
			mkRule(['-i', 'lo', '-j', 'ACCEPT'], 'ACCEPT     all      anywhere      anywhere'),
			mkRule(
				['-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT'],
				'ACCEPT     all      anywhere      anywhere      state RELATED,ESTABLISHED',
			),
		)
	}

	return new Map<TableName, Table>([
		['filter', filter],
		['nat', nat],
		['mangle', mangle],
		['raw', raw],
	])
}

function mkRule(spec: string[], line: string): IptRule {
	return {
		spec,
		line,
		pkts: Math.floor(Math.random() * 200),
		bytes: Math.floor(Math.random() * 50000),
	}
}

let STATE: NetLabState = createState()

function createState(): NetLabState {
	return {
		devs: defaultDevs(),
		routes: defaultRoutes(),
		neigh: defaultNeigh(),
		v4: defaultIptables(false),
		v6: defaultIptables(true),
	}
}

/** Reset fake netdev + fib + netfilter (call from shell `reset`). */
export function resetNetLab(): void {
	STATE = createState()
}

// ═══════════════════════════════════════════════════════════════════════════
// DNS (shared by ping/curl)
// ═══════════════════════════════════════════════════════════════════════════

const DNS: Record<string, string> = {
	localhost: '127.0.0.1',
	[HOSTNAME]: '192.168.1.42',
	'fakeshell-lab.local': '192.168.1.42',
	'google.com': '142.250.185.78',
	'www.google.com': '142.250.185.78',
	'github.com': '140.82.121.4',
	'www.github.com': '140.82.121.4',
	'example.com': '93.184.216.34',
	'www.example.com': '93.184.216.34',
	'cloudflare.com': '104.16.132.229',
	'1.1.1.1': '1.1.1.1',
	'8.8.8.8': '8.8.8.8',
}

function resolveHost(host: string): string | null {
	const h = host.trim().toLowerCase().replace(/\.$/, '')
	if (!h) return null
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h
	if (DNS[h]) return DNS[h]
	if (h.includes('.')) {
		let hash = 0
		for (let i = 0; i < h.length; i++) hash = (hash * 33 + h.charCodeAt(i)) >>> 0
		return `203.0.${10 + (hash % 200)}.${(hash % 254) + 1}`
	}
	return null
}

function nowTs(): string {
	const d = new Date()
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ═══════════════════════════════════════════════════════════════════════════
// ip  —  fake iproute2 (same OBJECT model as real `ip`)
// Source model: iproute2 ip/ip.c → object handlers (link, address, route, …)
// ═══════════════════════════════════════════════════════════════════════════

export function runIp(args: string[]): NetResult {
	const a = args.filter((x) => x !== '--')
	if (a.length === 0 || a[0] === 'help' || a[0] === '-h' || a[0] === '--help') {
		return {
			stdout:
				`Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\n` +
				`where  OBJECT := { link | address | addr | route | neigh | rule }\n` +
				`       OPTIONS := { -4 | -6 | -s | -br | -o | -d }\n` +
				`\n` +
				`FakeShell: fake iproute2 (in-memory netdev/fib, not netlink).\n`,
			stderr: '',
			exitCode: 0,
		}
	}

	const filtered = a.filter(
		(x) => !['-4', '-6', '-s', '-d', '-o', '-br', '-c', '-j', '-n', '-a'].includes(x),
	)
	const obj = filtered[0] ?? ''
	const sub = filtered.slice(1)
	const brief = a.includes('-br')
	const stats = a.includes('-s')

	const isAddr = obj === 'a' || obj.startsWith('addr') || obj === 'address'
	const isLink = obj === 'l' || obj.startsWith('link')
	const isRoute = obj === 'r' || (obj.startsWith('route') && !obj.startsWith('rule'))
	const isNeigh = obj === 'n' || obj.startsWith('neigh') || obj.startsWith('neighbor')
	const isRule = obj.startsWith('rule')

	// COMMAND: show | list | add | del | set | help (most show)
	const cmd = sub[0] && !sub[0].startsWith('-') ? sub[0] : 'show'

	if (isAddr) {
		if (cmd === 'help') {
			return {
				stdout: 'Usage: ip addr {add|del|show|flush} ...\n',
				stderr: '',
				exitCode: 0,
			}
		}
		if (cmd === 'add' || cmd === 'del' || cmd === 'delete' || cmd === 'flush') {
			// Mutate fake addresses for lab demos
			return ipAddrMutate(cmd, sub.slice(1))
		}
		return { stdout: formatIpAddr(brief, stats), stderr: '', exitCode: 0 }
	}

	if (isLink) {
		if (cmd === 'help') {
			return {
				stdout: 'Usage: ip link {show|set|add|delete} ...\n',
				stderr: '',
				exitCode: 0,
			}
		}
		if (cmd === 'set') return ipLinkSet(sub.slice(1))
		return { stdout: formatIpLink(brief, stats), stderr: '', exitCode: 0 }
	}

	if (isRoute) {
		if (cmd === 'help') {
			return {
				stdout: 'Usage: ip route {list|add|del|get} ...\n',
				stderr: '',
				exitCode: 0,
			}
		}
		if (cmd === 'add' || cmd === 'del' || cmd === 'delete') {
			return ipRouteMutate(cmd, sub.slice(1))
		}
		return { stdout: formatIpRoute(), stderr: '', exitCode: 0 }
	}

	if (isNeigh) {
		return {
			stdout: STATE.neigh
				.map((n) => `${n.ip} dev ${n.dev} lladdr ${n.lladdr} ${n.state}`)
				.join('\n') + (STATE.neigh.length ? '\n' : ''),
			stderr: '',
			exitCode: 0,
		}
	}

	if (isRule) {
		return {
			stdout: '0:\tfrom all lookup local\n32766:\tfrom all lookup main\n32767:\tfrom all lookup default\n',
			stderr: '',
			exitCode: 0,
		}
	}

	return {
		stdout: '',
		stderr: `Object "${obj}" is unknown, try "ip help".\n`,
		exitCode: 1,
	}
}

function formatIpAddr(brief: boolean, _stats: boolean): string {
	if (brief) {
		return (
			STATE.devs
				.map((d) => {
					const addrs = [...d.inet, ...d.inet6].join(' ')
					const st = d.state.padEnd(12)
					return `${d.name.padEnd(16)} ${st} ${addrs}`
				})
				.join('\n') + '\n'
		)
	}
	const lines: string[] = []
	for (const d of STATE.devs) {
		const fl = d.flags.join(',')
		const qdisc = d.name === 'lo' ? 'noqueue' : 'fq_codel'
		const mode = d.name === 'lo' ? '' : 'mode DEFAULT '
		lines.push(
			`${d.index}: ${d.name}: <${fl}> mtu ${d.mtu} qdisc ${qdisc} state ${d.state} group default qlen 1000`,
		)
		if (d.type === 'loopback') {
			lines.push(`    link/loopback ${d.mac} brd 00:00:00:00:00:00`)
		} else {
			lines.push(`    link/ether ${d.mac} brd ff:ff:ff:ff:ff:ff`)
		}
		for (const ip of d.inet) {
			const scope = d.name === 'lo' ? 'host' : 'global dynamic'
			lines.push(`    inet ${ip} ${d.name === 'lo' ? '' : 'brd 192.168.1.255 '}scope ${scope} ${d.name}`)
			lines.push(`       valid_lft forever preferred_lft forever`)
		}
		for (const ip of d.inet6) {
			const scope = ip.startsWith('fe80') ? 'link' : 'host'
			lines.push(`    inet6 ${ip} scope ${scope}`)
			lines.push(`       valid_lft forever preferred_lft forever`)
		}
		void mode
	}
	return lines.join('\n') + '\n'
}

function formatIpLink(brief: boolean, _stats: boolean): string {
	if (brief) {
		return (
			STATE.devs
				.map((d) => {
					const fl = `<${d.flags.join(',')}>`
					return `${d.name.padEnd(16)} ${d.state.padEnd(12)} ${d.mac} ${fl}`
				})
				.join('\n') + '\n'
		)
	}
	const lines: string[] = []
	for (const d of STATE.devs) {
		const fl = d.flags.join(',')
		const qdisc = d.name === 'lo' ? 'noqueue' : 'fq_codel'
		lines.push(
			`${d.index}: ${d.name}: <${fl}> mtu ${d.mtu} qdisc ${qdisc} state ${d.state} mode DEFAULT group default qlen 1000`,
		)
		if (d.type === 'loopback') {
			lines.push(`    link/loopback ${d.mac} brd 00:00:00:00:00:00`)
		} else {
			lines.push(`    link/ether ${d.mac} brd ff:ff:ff:ff:ff:ff`)
		}
	}
	return lines.join('\n') + '\n'
}

function formatIpRoute(): string {
	return (
		STATE.routes
			.map((r) => {
				let s = r.dst
				if (r.via) s += ` via ${r.via}`
				s += ` dev ${r.dev} proto ${r.proto}`
				if (r.scope) s += ` scope ${r.scope}`
				if (r.src) s += ` src ${r.src}`
				if (r.metric != null) s += ` metric ${r.metric}`
				return s
			})
			.join('\n') + (STATE.routes.length ? '\n' : '')
	)
}

function ipAddrMutate(cmd: string, args: string[]): NetResult {
	// ip addr add 10.0.0.1/24 dev eth0
	const devIdx = args.indexOf('dev')
	const devName = devIdx >= 0 ? args[devIdx + 1] : 'eth0'
	const cidr = args.find((a) => a.includes('/') || /^\d+\.\d+\.\d+\.\d+$/.test(a))
	const dev = STATE.devs.find((d) => d.name === devName)
	if (!dev) {
		return { stdout: '', stderr: `Cannot find device "${devName}"\n`, exitCode: 1 }
	}
	if (cmd === 'flush') {
		dev.inet = dev.name === 'lo' ? ['127.0.0.1/8'] : []
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	if (!cidr) {
		return { stdout: '', stderr: 'Error: any valid prefix is expected rather than "null".\n', exitCode: 1 }
	}
	const addr = cidr.includes('/') ? cidr : `${cidr}/32`
	if (cmd === 'add') {
		if (!dev.inet.includes(addr)) dev.inet.push(addr)
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	dev.inet = dev.inet.filter((x) => x !== addr)
	return { stdout: '', stderr: '', exitCode: 0 }
}

function ipLinkSet(args: string[]): NetResult {
	// ip link set eth0 up|down
	const name = args[0]
	const dev = STATE.devs.find((d) => d.name === name)
	if (!dev) return { stdout: '', stderr: `Cannot find device "${name}"\n`, exitCode: 1 }
	if (args.includes('up')) {
		dev.state = name === 'lo' ? 'UNKNOWN' : 'UP'
		if (!dev.flags.includes('UP')) dev.flags.push('UP')
		if (!dev.flags.includes('LOWER_UP')) dev.flags.push('LOWER_UP')
	}
	if (args.includes('down')) {
		dev.state = 'DOWN'
		dev.flags = dev.flags.filter((f) => f !== 'UP' && f !== 'LOWER_UP')
	}
	return { stdout: '', stderr: '', exitCode: 0 }
}

function ipRouteMutate(cmd: string, args: string[]): NetResult {
	// ip route add default via 1.2.3.4 dev eth0
	// ip route del default
	const dst = args[0] === 'default' || args[0]?.includes('/') || args[0]?.match(/^\d/) ? args[0] : 'default'
	if (cmd.startsWith('del')) {
		STATE.routes = STATE.routes.filter((r) => r.dst !== dst)
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	const viaIdx = args.indexOf('via')
	const devIdx = args.indexOf('dev')
	const via = viaIdx >= 0 ? args[viaIdx + 1] : undefined
	const dev = devIdx >= 0 ? args[devIdx + 1] : 'eth0'
	STATE.routes = STATE.routes.filter((r) => r.dst !== dst)
	STATE.routes.push({ dst, via, dev, proto: 'static', metric: 100 })
	return { stdout: '', stderr: '', exitCode: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// iptables / ip6tables  —  fake netfilter (same CLI as real iptables)
// Source model: iptables/ip6tables userspace → table → chain → rules
// ═══════════════════════════════════════════════════════════════════════════

export function runIptables(args: string[], ipv6 = false): NetResult {
	const tables = ipv6 ? STATE.v6 : STATE.v4
	const bin = ipv6 ? 'ip6tables' : 'iptables'
	const a = [...args]

	if (a.includes('-V') || a.includes('--version')) {
		return {
			stdout: `${bin} v1.8.10 (FakeShell-lab fake nf_tables)\n`,
			stderr: '',
			exitCode: 0,
		}
	}
	if (a.includes('-h') || a.includes('--help') || a.length === 0) {
		return {
			stdout: iptHelp(bin),
			stderr: '',
			exitCode: 0,
		}
	}

	// Parse global flags
	let tableName: TableName = 'filter'
	let numeric = false
	let verbose = false
	let lineNumbers = false
	let exact = false

	const pos: string[] = []
	for (let i = 0; i < a.length; i++) {
		const t = a[i]
		if (t === '-t' || t === '--table') {
			tableName = (a[++i] as TableName) || 'filter'
			continue
		}
		if (t === '-n' || t === '--numeric') {
			numeric = true
			continue
		}
		if (t === '-v' || t === '--verbose') {
			verbose = true
			continue
		}
		if (t === '-x' || t === '--exact') {
			exact = true
			continue
		}
		if (t === '--line-numbers') {
			lineNumbers = true
			continue
		}
		if (t === '-w' || t === '--wait') {
			if (a[i + 1] && /^\d+$/.test(a[i + 1])) i++
			continue
		}
		pos.push(t)
	}

	if (!tables.has(tableName)) {
		return {
			stdout: '',
			stderr: `${bin}: v1.8.10/FakeShell: can't initialize iptables table \`${tableName}': Table does not exist\n`,
			exitCode: 3,
		}
	}
	const table = tables.get(tableName)!

	// Command letter (can be -L, -A, --list, …)
	const cmdTok = pos[0] ?? ''
	const cmd = normalizeIptCmd(cmdTok)
	const rest = pos.slice(1)

	if (!cmd) {
		return {
			stdout: '',
			stderr: `${bin}: no command specified\nTry \`${bin} -h' or '${bin} --help' for more information.\n`,
			exitCode: 2,
		}
	}

	switch (cmd) {
		case 'L':
		case 'list':
			return iptList(table, rest, { numeric, verbose, lineNumbers, exact, bin })
		case 'S':
		case 'list-rules':
			return iptSave(table, rest[0])
		case 'A':
		case 'append':
			return iptAppend(table, rest, false)
		case 'I':
		case 'insert':
			return iptInsert(table, rest)
		case 'D':
		case 'delete':
			return iptDelete(table, rest)
		case 'F':
		case 'flush':
			return iptFlush(table, rest[0])
		case 'P':
		case 'policy':
			return iptPolicy(table, rest)
		case 'N':
		case 'new-chain':
			return iptNewChain(table, rest[0])
		case 'X':
		case 'delete-chain':
			return iptDeleteChain(table, rest[0])
		case 'Z':
		case 'zero':
			return iptZero(table, rest[0])
		case 'C':
		case 'check':
			return iptCheck(table, rest)
		case 'E':
		case 'rename-chain':
			return {
				stdout: '',
				stderr: `${bin}: chain rename not supported in lab\n`,
				exitCode: 1,
			}
		default:
			return {
				stdout: '',
				stderr: `${bin}: unknown option \`${cmdTok}'\n`,
				exitCode: 2,
			}
	}
}

function normalizeIptCmd(tok: string): string {
	const map: Record<string, string> = {
		'-L': 'L',
		'--list': 'list',
		'-S': 'S',
		'--list-rules': 'list-rules',
		'-A': 'A',
		'--append': 'append',
		'-I': 'I',
		'--insert': 'insert',
		'-D': 'D',
		'--delete': 'delete',
		'-F': 'F',
		'--flush': 'flush',
		'-P': 'P',
		'--policy': 'policy',
		'-N': 'N',
		'--new-chain': 'new-chain',
		'--new': 'new-chain',
		'-X': 'X',
		'--delete-chain': 'delete-chain',
		'-Z': 'Z',
		'--zero': 'zero',
		'-C': 'C',
		'--check': 'check',
		'-E': 'E',
		'--rename-chain': 'rename-chain',
	}
	return map[tok] ?? (tok.startsWith('-') ? tok.slice(1) : tok)
}

function iptHelp(bin: string): string {
	return (
		`${bin} v1.8.10 (FakeShell-lab fake)\n\n` +
		`Usage: ${bin} -[ACD] chain rule-specification [options]\n` +
		`       ${bin} -I chain [rulenum] rule-specification [options]\n` +
		`       ${bin} -L|-S|-F|-Z [chain] [options]\n` +
		`       ${bin} -P chain target\n` +
		`       ${bin} -N chain\n` +
		`       ${bin} -X [chain]\n` +
		`\n` +
		`Options:\n` +
		`  --ipv4      -4              (iptables)\n` +
		`  --ipv6      -6              (ip6tables)\n` +
		`  --table     -t table        table (filter|nat|mangle|raw)\n` +
		`  --append    -A chain        append rule\n` +
		`  --list      -L [chain]      list rules\n` +
		`  --list-rules -S [chain]     print rules in -A form\n` +
		`  --delete    -D chain        delete rule\n` +
		`  --insert    -I chain        insert rule\n` +
		`  --flush     -F [chain]      flush rules\n` +
		`  --policy    -P chain target set policy\n` +
		`  --numeric   -n              numeric output\n` +
		`  --verbose   -v              verbose\n` +
		`  --line-numbers              line numbers on -L\n` +
		`\n` +
		`This is an offline fake netfilter for learning — not the real kernel.\n`
	)
}

function ruleLineFromSpec(spec: string[]): string {
	// Build a classic -L style line from rule-spec
	let target = 'ACCEPT'
	let proto = 'all'
	let src = 'anywhere'
	let dst = 'anywhere'
	const extra: string[] = []

	for (let i = 0; i < spec.length; i++) {
		const t = spec[i]
		if ((t === '-j' || t === '--jump') && spec[i + 1]) {
			target = spec[++i]
			continue
		}
		if ((t === '-p' || t === '--protocol') && spec[i + 1]) {
			proto = spec[++i]
			continue
		}
		if ((t === '-s' || t === '--source') && spec[i + 1]) {
			src = spec[++i]
			continue
		}
		if ((t === '-d' || t === '--destination') && spec[i + 1]) {
			dst = spec[++i]
			continue
		}
		if ((t === '-i' || t === '--in-interface') && spec[i + 1]) {
			extra.push(`in:${spec[++i]}`)
			continue
		}
		if ((t === '-o' || t === '--out-interface') && spec[i + 1]) {
			extra.push(`out:${spec[++i]}`)
			continue
		}
		if (t === '--dport' && spec[i + 1]) {
			extra.push(`tcp dpt:${spec[++i]}`)
			continue
		}
		if (t === '--sport' && spec[i + 1]) {
			extra.push(`spt:${spec[++i]}`)
			continue
		}
		if (t === '--state' && spec[i + 1]) {
			extra.push(`state ${spec[++i]}`)
			continue
		}
		if (t === '-m' && spec[i + 1]) {
			i++ // module name
			continue
		}
		if (t.startsWith('--')) {
			if (spec[i + 1] && !spec[i + 1].startsWith('-')) {
				extra.push(`${t.slice(2)}:${spec[++i]}`)
			} else extra.push(t)
			continue
		}
	}

	const base = `${target.padEnd(10)} ${proto.padEnd(4)} --  ${src.padEnd(20)} ${dst.padEnd(20)}`
	return extra.length ? `${base} ${extra.join(' ')}` : base
}

function iptAppend(table: Table, rest: string[], insertAtTop: boolean): NetResult {
	const chainName = rest[0]
	if (!chainName) {
		return { stdout: '', stderr: "iptables v1.8.10: no chain specified\n", exitCode: 2 }
	}
	const chain = table.chains.get(chainName)
	if (!chain) {
		return {
			stdout: '',
			stderr: `iptables: No chain/target/match by that name.\n`,
			exitCode: 1,
		}
	}
	const spec = rest.slice(1)
	if (!spec.includes('-j') && !spec.includes('--jump')) {
		return {
			stdout: '',
			stderr: 'iptables v1.8.10: no target via -j/--jump\n',
			exitCode: 2,
		}
	}
	const rule = mkRule(spec, ruleLineFromSpec(spec))
	if (insertAtTop) chain.rules.unshift(rule)
	else chain.rules.push(rule)
	return { stdout: '', stderr: '', exitCode: 0 }
}

function iptInsert(table: Table, rest: string[]): NetResult {
	const chainName = rest[0]
	if (!chainName) {
		return { stdout: '', stderr: "iptables v1.8.10: no chain specified\n", exitCode: 2 }
	}
	const chain = table.chains.get(chainName)
	if (!chain) {
		return { stdout: '', stderr: `iptables: No chain/target/match by that name.\n`, exitCode: 1 }
	}
	let rulenum = 1
	let specStart = 1
	if (rest[1] && /^\d+$/.test(rest[1])) {
		rulenum = parseInt(rest[1], 10)
		specStart = 2
	}
	const spec = rest.slice(specStart)
	const rule = mkRule(spec, ruleLineFromSpec(spec))
	const idx = Math.max(0, Math.min(chain.rules.length, rulenum - 1))
	chain.rules.splice(idx, 0, rule)
	return { stdout: '', stderr: '', exitCode: 0 }
}

function iptDelete(table: Table, rest: string[]): NetResult {
	const chainName = rest[0]
	if (!chainName) {
		return { stdout: '', stderr: "iptables v1.8.10: no chain specified\n", exitCode: 2 }
	}
	const chain = table.chains.get(chainName)
	if (!chain) {
		return { stdout: '', stderr: `iptables: No chain/target/match by that name.\n`, exitCode: 1 }
	}
	if (rest[1] && /^\d+$/.test(rest[1])) {
		const n = parseInt(rest[1], 10)
		if (n < 1 || n > chain.rules.length) {
			return {
				stdout: '',
				stderr: `iptables: Index of deletion too big.\n`,
				exitCode: 1,
			}
		}
		chain.rules.splice(n - 1, 1)
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	// delete by matching spec
	const spec = rest.slice(1)
	const key = spec.join(' ')
	const idx = chain.rules.findIndex((r) => r.spec.join(' ') === key)
	if (idx < 0) {
		return {
			stdout: '',
			stderr: `iptables: Bad rule (does a matching rule exist in that chain?).\n`,
			exitCode: 1,
		}
	}
	chain.rules.splice(idx, 1)
	return { stdout: '', stderr: '', exitCode: 0 }
}

function iptFlush(table: Table, chainName?: string): NetResult {
	if (!chainName) {
		for (const c of table.chains.values()) c.rules = []
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	const chain = table.chains.get(chainName)
	if (!chain) {
		return { stdout: '', stderr: `iptables: No chain/target/match by that name.\n`, exitCode: 1 }
	}
	chain.rules = []
	return { stdout: '', stderr: '', exitCode: 0 }
}

function iptPolicy(table: Table, rest: string[]): NetResult {
	const [chainName, target] = rest
	if (!chainName || !target) {
		return {
			stdout: '',
			stderr: 'iptables v1.8.10: -P requires chain and target\n',
			exitCode: 2,
		}
	}
	const chain = table.chains.get(chainName)
	if (!chain || !chain.builtin) {
		return {
			stdout: '',
			stderr: `iptables: Can't set policy for non-built-in chain.\n`,
			exitCode: 1,
		}
	}
	const t = target.toUpperCase()
	if (t !== 'ACCEPT' && t !== 'DROP' && t !== 'REJECT') {
		return {
			stdout: '',
			stderr: `iptables: Invalid policy \`${target}'\n`,
			exitCode: 2,
		}
	}
	chain.policy = t as Policy
	return { stdout: '', stderr: '', exitCode: 0 }
}

function iptNewChain(table: Table, name?: string): NetResult {
	if (!name) {
		return { stdout: '', stderr: 'iptables v1.8.10: no chain name\n', exitCode: 2 }
	}
	if (table.chains.has(name)) {
		return { stdout: '', stderr: `iptables: Chain already exists.\n`, exitCode: 1 }
	}
	table.chains.set(name, makeChain(name, 'RETURN', false))
	return { stdout: '', stderr: '', exitCode: 0 }
}

function iptDeleteChain(table: Table, name?: string): NetResult {
	if (!name) {
		// delete all user chains
		for (const [n, c] of [...table.chains.entries()]) {
			if (!c.builtin && c.rules.length === 0) table.chains.delete(n)
		}
		return { stdout: '', stderr: '', exitCode: 0 }
	}
	const chain = table.chains.get(name)
	if (!chain) {
		return { stdout: '', stderr: `iptables: No chain/target/match by that name.\n`, exitCode: 1 }
	}
	if (chain.builtin) {
		return { stdout: '', stderr: `iptables: Can't delete built-in chain.\n`, exitCode: 1 }
	}
	if (chain.rules.length) {
		return {
			stdout: '',
			stderr: `iptables: Directory not empty (chain still has rules — flush first).\n`,
			exitCode: 1,
		}
	}
	table.chains.delete(name)
	return { stdout: '', stderr: '', exitCode: 0 }
}

function iptZero(table: Table, chainName?: string): NetResult {
	const chains = chainName
		? [table.chains.get(chainName)].filter(Boolean) as Chain[]
		: [...table.chains.values()]
	if (chainName && !table.chains.has(chainName)) {
		return { stdout: '', stderr: `iptables: No chain/target/match by that name.\n`, exitCode: 1 }
	}
	for (const c of chains) {
		for (const r of c.rules) {
			r.pkts = 0
			r.bytes = 0
		}
	}
	return { stdout: '', stderr: '', exitCode: 0 }
}

function iptCheck(table: Table, rest: string[]): NetResult {
	const chainName = rest[0]
	const chain = chainName ? table.chains.get(chainName) : undefined
	if (!chain) {
		return { stdout: '', stderr: `iptables: No chain/target/match by that name.\n`, exitCode: 1 }
	}
	const key = rest.slice(1).join(' ')
	const ok = chain.rules.some((r) => r.spec.join(' ') === key)
	return { stdout: '', stderr: '', exitCode: ok ? 0 : 1 }
}

function iptList(
	table: Table,
	rest: string[],
	opt: { numeric: boolean; verbose: boolean; lineNumbers: boolean; exact: boolean; bin: string },
): NetResult {
	const only = rest[0] && !rest[0].startsWith('-') ? rest[0] : undefined
	if (only && !table.chains.has(only)) {
		return {
			stdout: '',
			stderr: `iptables: No chain/target/match by that name.\n`,
			exitCode: 1,
		}
	}

	const chains = only
		? [table.chains.get(only)!]
		: [...table.chains.values()]

	const out: string[] = []
	for (const chain of chains) {
		const refs = chain.builtin ? 0 : 0
		out.push(`Chain ${chain.name} (policy ${chain.policy} ${refs} references)`)
		if (opt.verbose) {
			const hdr = opt.lineNumbers
				? 'num   pkts bytes target     prot opt in     out     source               destination'
				: ' pkts bytes target     prot opt in     out     source               destination'
			out.push(hdr)
		} else {
			const hdr = opt.lineNumbers
				? 'num  target     prot opt source               destination'
				: 'target     prot opt source               destination'
			out.push(hdr)
		}
		chain.rules.forEach((r, i) => {
			const num = opt.lineNumbers ? `${String(i + 1).padStart(3)}  ` : ''
			if (opt.verbose) {
				const pk = opt.exact ? String(r.pkts) : humanNum(r.pkts)
				const by = opt.exact ? String(r.bytes) : humanNum(r.bytes)
				out.push(`${num}${pk.padStart(5)} ${by.padStart(5)} ${r.line}`)
			} else {
				out.push(`${num}${r.line}`)
			}
		})
		out.push('')
	}
	void opt.numeric
	return { stdout: out.join('\n').replace(/\n$/, '') + '\n', stderr: '', exitCode: 0 }
}

function humanNum(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M'
	if (n >= 1000) return (n / 1000).toFixed(0) + 'K'
	return String(n)
}

function iptSave(table: Table, chainName?: string): NetResult {
	const chains = chainName
		? [table.chains.get(chainName)].filter(Boolean) as Chain[]
		: [...table.chains.values()]
	if (chainName && !table.chains.has(chainName)) {
		return { stdout: '', stderr: `iptables: No chain/target/match by that name.\n`, exitCode: 1 }
	}
	const lines: string[] = []
	for (const c of chains) {
		if (c.builtin) lines.push(`-P ${c.name} ${c.policy}`)
		else lines.push(`-N ${c.name}`)
	}
	for (const c of chains) {
		for (const r of c.rules) {
			lines.push(`-A ${c.name} ${r.spec.join(' ')}`)
		}
	}
	return { stdout: lines.join('\n') + (lines.length ? '\n' : ''), stderr: '', exitCode: 0 }
}

// ═══════════════════════════════════════════════════════════════════════════
// ping
// ═══════════════════════════════════════════════════════════════════════════

export async function runPing(
	args: string[],
	onOut: (s: string) => void,
	signal?: AbortSignal,
): Promise<NetResult> {
	let count = 4
	let host = ''
	const rest = [...args]

	for (let i = 0; i < rest.length; i++) {
		const a = rest[i]
		if (a === '-c' && rest[i + 1]) {
			count = Math.min(20, Math.max(1, parseInt(rest[i + 1], 10) || 4))
			i++
			continue
		}
		if (a === '-n' || a === '-q' || a === '-v') continue
		if (a === '-W' || a === '-w' || a === '-i' || a === '-s') {
			i++
			continue
		}
		if (a.startsWith('-')) continue
		host = a
		break
	}

	if (!host) {
		return {
			stdout: '',
			stderr: 'ping: usage error: Destination address required\n',
			exitCode: 2,
		}
	}

	const ip = resolveHost(host)
	if (!ip) {
		return {
			stdout: '',
			stderr: `ping: ${host}: Name or service not known\n`,
			exitCode: 2,
		}
	}

	const display = host === ip ? ip : host
	let stdoutAll = ''
	const write = (s: string) => {
		stdoutAll += s
		onOut(s)
	}

	write(`PING ${display} (${ip}) 56(84) bytes of data.\n`)

	let transmitted = 0
	let received = 0
	const rtts: number[] = []
	const start = Date.now()

	for (let seq = 1; seq <= count; seq++) {
		if (signal?.aborted) break
		transmitted++
		let h = 0
		for (let i = 0; i < ip.length; i++) h = (h + ip.charCodeAt(i) * seq) % 997
		const rtt = 8 + (h % 33) + Math.random() * 4
		rtts.push(rtt)
		received++
		write(`64 bytes from ${ip}: icmp_seq=${seq} ttl=64 time=${rtt.toFixed(1)} ms\n`)
		if (seq < count) await sleep(350, signal)
	}

	const elapsed = Date.now() - start
	const loss = transmitted === 0 ? 0 : ((transmitted - received) / transmitted) * 100
	const min = rtts.length ? Math.min(...rtts) : 0
	const max = rtts.length ? Math.max(...rtts) : 0
	const avg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0
	const mdev = rtts.length
		? Math.sqrt(rtts.reduce((s, t) => s + (t - avg) ** 2, 0) / rtts.length)
		: 0

	write(`\n--- ${display} ping statistics ---\n`)
	write(
		`${transmitted} packets transmitted, ${received} received, ${loss.toFixed(0)}% packet loss, time ${elapsed}ms\n`,
	)
	if (received > 0) {
		write(
			`rtt min/avg/max/mdev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${mdev.toFixed(3)} ms\n`,
		)
	}

	return { stdout: stdoutAll, stderr: '', exitCode: received > 0 ? 0 : 1 }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve()
			return
		}
		const t = setTimeout(resolve, ms)
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(t)
				resolve()
			},
			{ once: true },
		)
	})
}

// ═══════════════════════════════════════════════════════════════════════════
// curl
// ═══════════════════════════════════════════════════════════════════════════

export function runCurl(args: string[]): NetResult {
	let silent = false
	let headOnly = false
	let outputFile: string | null = null
	let method = 'GET'
	let url = ''
	let includeHeaders = false

	const rest = [...args]
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i]
		if (a === '-s' || a === '--silent') {
			silent = true
			continue
		}
		if (a === '-I' || a === '--head') {
			headOnly = true
			method = 'HEAD'
			continue
		}
		if (a === '-i' || a === '--include') {
			includeHeaders = true
			continue
		}
		if (a === '-L' || a === '--location' || a === '-v' || a === '-k' || a === '--insecure') continue
		if (a === '-o' || a === '--output') {
			outputFile = rest[++i] ?? null
			continue
		}
		if (a === '-O') {
			outputFile = '__remote__'
			continue
		}
		if (a === '-X' || a === '--request') {
			method = (rest[++i] ?? 'GET').toUpperCase()
			continue
		}
		if (a === '-H' || a === '--header' || a === '-A' || a === '--user-agent') {
			i++
			continue
		}
		if (a === '-m' || a === '--max-time') {
			i++
			continue
		}
		if (a === '-d' || a === '--data' || a === '--data-raw') {
			method = method === 'GET' ? 'POST' : method
			i++
			continue
		}
		if (a.startsWith('-')) continue
		if (!url) url = a
	}

	if (!url) {
		return {
			stdout: '',
			stderr:
				"curl: try 'curl --help' or 'curl --manual' for more information\n" +
				'curl: no URL specified!\n',
			exitCode: 2,
		}
	}

	let full = url
	if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(full)) full = 'http://' + full

	let parsed: URL
	try {
		parsed = new URL(full)
	} catch {
		return {
			stdout: '',
			stderr: `curl: (3) URL using bad/illegal format or missing URL\n`,
			exitCode: 3,
		}
	}

	const host = parsed.hostname
	const ip = resolveHost(host)
	if (!ip && parsed.protocol !== 'file:') {
		return {
			stdout: '',
			stderr: `curl: (6) Could not resolve host: ${host}\n`,
			exitCode: 6,
		}
	}

	const { status, statusText, contentType, body } = fakeHttpResponse(parsed, method)

	if (outputFile === '__remote__') {
		const parts = parsed.pathname.split('/').filter(Boolean)
		outputFile = parts[parts.length - 1] || 'index.html'
	}

	const hdr =
		`HTTP/1.1 ${status} ${statusText}\r\n` +
		`Date: ${new Date().toUTCString()}\r\n` +
		`Server: FakeShell-lab/0.1 (fake)\r\n` +
		`Content-Type: ${contentType}\r\n` +
		`Content-Length: ${new TextEncoder().encode(body).length}\r\n` +
		`Connection: close\r\n` +
		`\r\n`

	let stdout = ''
	if (headOnly) stdout = hdr.replace(/\r\n/g, '\n')
	else if (includeHeaders) stdout = hdr.replace(/\r\n/g, '\n') + body
	else stdout = body

	let stderr = ''
	if (!silent && !headOnly) {
		const n = new TextEncoder().encode(body).length
		stderr =
			`  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n` +
			`                                 Dload  Upload   Total   Spent    Left  Speed\n` +
			`\r100  ${String(n).padStart(4)}  100  ${String(n).padStart(4)}    0     0   ${n * 10}      0 --:--:-- --:--:-- --:--:--  ${n * 10}\n`
	}

	const fileBody = headOnly ? hdr.replace(/\r\n/g, '\n') : body
	return {
		stdout: outputFile ? '' : stdout,
		stderr,
		exitCode: status >= 400 ? 22 : 0,
		outputFile: outputFile ?? undefined,
		fileBody: outputFile ? fileBody : undefined,
	}
}

function fakeHttpResponse(
	url: URL,
	method: string,
): { status: number; statusText: string; contentType: string; body: string } {
	const path = url.pathname || '/'
	const host = url.hostname.toLowerCase()

	if (method === 'HEAD') {
		return {
			status: 200,
			statusText: 'OK',
			contentType: 'text/html; charset=UTF-8',
			body: '',
		}
	}

	if (path.endsWith('.json') || path.includes('/api/')) {
		const body =
			JSON.stringify(
				{
					ok: true,
					lab: true,
					host,
					path,
					message: 'FakeShell fake HTTP response',
					time: nowTs(),
					ip: resolveHost(host),
				},
				null,
				2,
			) + '\n'
		return { status: 200, statusText: 'OK', contentType: 'application/json', body }
	}

	if (host.includes('example.com')) {
		return {
			status: 200,
			statusText: 'OK',
			contentType: 'text/html; charset=UTF-8',
			body:
				`<!doctype html>\n<html>\n<head><title>Example Domain</title></head>\n` +
				`<body>\n<div>\n<h1>Example Domain</h1>\n` +
				`<p>This domain is for use in illustrative examples in documents.</p>\n` +
				`</div>\n</body>\n</html>\n`,
		}
	}

	if (host.includes('google.com')) {
		return {
			status: 200,
			statusText: 'OK',
			contentType: 'text/html; charset=ISO-8859-1',
			body:
				`<!doctype html><html><head><title>Google</title></head>` +
				`<body><h1>Google (FakeShell lab fake)</h1></body></html>\n`,
		}
	}

	if (host.includes('github.com')) {
		return {
			status: 200,
			statusText: 'OK',
			contentType: 'text/html; charset=utf-8',
			body:
				`<!DOCTYPE html><html><head><title>GitHub</title></head>` +
				`<body><h1>GitHub (FakeShell lab fake)</h1></body></html>\n`,
		}
	}

	return {
		status: 200,
		statusText: 'OK',
		contentType: 'text/html; charset=UTF-8',
		body:
			`<!doctype html>\n<html lang="en">\n` +
			`<head><meta charset="utf-8"><title>${host}</title></head>\n` +
			`<body>\n  <h1>FakeShell lab — fake HTTP</h1>\n` +
			`  <p>Host: <code>${host}</code></p>\n` +
			`  <p>Path: <code>${path}</code></p>\n` +
			`  <p>Resolved: <code>${resolveHost(host) ?? '?'}</code></p>\n` +
			`</body>\n</html>\n`,
	}
}

// Full manuals: see man.ts (man ip, man iptables, man ping, man curl, …)
