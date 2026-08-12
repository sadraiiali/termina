import { createContainer, VirtualFS } from 'almostnode'
import type { FileTreeNode, KernelInfo, ProcessOptions, ProcessResult } from './types'
import { clearSnapshot, loadSnapshot, saveSnapshot } from './persist'
import { seedDemoWorkspace } from './seed'
import {
	evalArithmetic,
	evalTest,
	expandLine,
	expandVars,
	formatEcho,
	formatPrintf,
	looksLikeShellScript,
	parseAssignment,
	parseElifLine,
	parseForLine,
	parseIfLine,
	splitScriptLines,
	type ScriptContext,
} from './bash'
import { resetNetLab, runCurl, runIp, runIptables, runPing } from './net'
import { getManPage } from './man'
import { resetSystemd, runJournalctl, runSystemctl } from './systemd'
import { runPidof, runPgrep, runPs } from './ps'
import {
	appendCronLog,
	crontabPath,
	ensureCronSpool,
	resetCronLab,
	runCrontab,
	tickCron,
	writeCrontab,
} from './cron'
import { resetAptLab, runApt } from './apt'
import {
	createSyscallHost,
	O_CREAT,
	O_RDONLY,
	O_TRUNC,
	O_WRONLY,
	SYS,
	SysError,
	type SyscallKernel,
} from './sys'
import {
	buildMinimalWasiHello,
	getWasiPilot,
	listWasiPilots,
} from './sys/wasi-pilots'

export type ConsoleListener = (stream: 'stdout' | 'stderr' | 'system', text: string) => void

/**
 * FakeShell — TypeScript fake Linux learning shell for Termina.
 *
 * Written entirely in this repo (`src/lib/fakeshell`). Not a real OS or bash:
 * commands, VFS (almostnode), fake apt/systemd/net, and optional WASI pilots
 * are implemented in TS for browser lab use.
 */
export class FakeShell {
	readonly info: KernelInfo = {
		name: 'FakeShell',
		version: '0.3.0',
		runtime: 'TypeScript fake shell (almostnode VFS + lab syscalls/WASI)',
		platform: 'browser',
		arch:
			typeof navigator !== 'undefined'
				? (navigator.userAgentData?.platform ?? 'web')
				: 'web',
	}

	private container!: ReturnType<typeof createContainer>
	private cwd = '/home/user'
	private listeners = new Set<ConsoleListener>()
	private booted = false
	private persistTimer: ReturnType<typeof setTimeout> | null = null
	private history: string[] = []
	/** Active bash script context ($0 $1 $? …) */
	private scriptCtx: ScriptContext | null = null
	/** Fake syscall kernel (Linux numbers + WASI host) */
	private _sys: SyscallKernel | null = null
	private env: Record<string, string> = {
		HOME: '/home/user',
		USER: 'user',
		LOGNAME: 'user',
		SHELL: '/bin/bash',
		PATH: '/usr/local/bin:/usr/bin:/bin',
		TERM: 'xterm-256color',
		LANG: 'fa_IR.UTF-8',
		HOSTNAME: 'fakeshell-lab',
	}

	get vfs(): VirtualFS {
		return this.container.vfs
	}

	/** Fake OS syscall interface (open/read/write/stat/… + WASI). */
	get sys(): SyscallKernel {
		if (!this._sys) throw new Error('FakeShell not booted')
		return this._sys
	}

	get workingDirectory(): string {
		return this.cwd
	}

	get commandHistory(): string[] {
		return [...this.history]
	}

	onConsole(listener: ConsoleListener): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private emit(stream: 'stdout' | 'stderr' | 'system', text: string): void {
		for (const l of this.listeners) l(stream, text)
	}

	async boot(options?: { reset?: boolean }): Promise<void> {
		if (this.booted && !options?.reset) return

		if (options?.reset) {
			await clearSnapshot()
		}

		this.container = createContainer({
			cwd: this.cwd,
			onConsole: (method, args) => {
				const line = args.map(stringify).join(' ') + '\n'
				const stream = method === 'error' || method === 'warn' ? 'stderr' : 'stdout'
				this.emit(stream, line)
			},
		})

		const snapshot = options?.reset ? null : await loadSnapshot().catch(() => null)
		if (snapshot) {
			try {
				const restored = VirtualFS.fromSnapshot(snapshot)
				this.replayVfs(restored, this.container.vfs)
				this.emit('system', 'Restored filesystem from IndexedDB.\n')
			} catch {
				seedDemoWorkspace(this.container.vfs)
				this.emit('system', 'Corrupt snapshot — seeded learning workspace.\n')
			}
		} else {
			seedDemoWorkspace(this.container.vfs)
			this.emit('system', 'Seeded learning workspace at /home/user.\n')
		}

		this.cwd = this.container.vfs.existsSync('/home/user')
			? '/home/user'
			: '/'

		// Fake Linux/WASI syscall host over this VFS
		this._sys = createSyscallHost(this.container.vfs, this.env, {
			trace: (msg) => this.emit('system', `[sys] ${msg}\n`),
			execLabCommand: async (argv, env, cwd) => {
				const prevCwd = this.cwd
				const prevEnv = { ...this.env }
				try {
					this.cwd = cwd
					Object.assign(this.env, env)
					const r = await this.run(argv.join(' '), { noHistory: true, expandVars: false })
					return r.exitCode
				} finally {
					this.cwd = prevCwd
					// restore env keys we had
					for (const k of Object.keys(this.env)) {
						if (!(k in prevEnv)) delete this.env[k]
					}
					Object.assign(this.env, prevEnv)
				}
			},
		})
		// keep syscall cwd in sync with shell
		this._sys.current.cwd = this.cwd
		this._sys.current.env = this.env

		// Install WASI pilot modules into VFS so wasi-* / runwasm always work
		this.installWasiPilots(
			'all',
			undefined,
			() => {},
			() => {},
		)

		this.booted = true
		this.emit(
			'system',
			`${this.info.name} ${this.info.version} booted (${this.info.runtime})\n` +
				`FakeShell: TypeScript lab shell (not real Linux/bash)\n` +
				`WASI pilots: /usr/lib/fakeshell/  ·  editors: lab nano/vim\n` +
				`Type help · man sys · cat ~/TOOLS.txt   cwd=${this.cwd}\n`,
		)
	}

	private replayVfs(source: VirtualFS, target: VirtualFS, dir = '/'): void {
		let names: string[]
		try {
			names = source.readdirSync(dir)
		} catch {
			return
		}
		for (const name of names) {
			const p = dir === '/' ? `/${name}` : `${dir}/${name}`
			const st = source.statSync(p)
			if (st.isDirectory()) {
				if (!target.existsSync(p)) target.mkdirSync(p, { recursive: true })
				this.replayVfs(source, target, p)
			} else {
				const data = source.readFileSync(p)
				target.writeFileSync(p, data)
			}
		}
	}

	schedulePersist(): void {
		if (this.persistTimer) clearTimeout(this.persistTimer)
		this.persistTimer = setTimeout(() => {
			void saveSnapshot(this.vfs).catch((e) =>
				this.emit('stderr', `persist failed: ${String(e)}\n`),
			)
		}, 400)
	}

	async persistNow(): Promise<void> {
		await saveSnapshot(this.vfs)
		this.emit('system', 'Filesystem saved to IndexedDB.\n')
	}

	resolvePath(input: string): string {
		// Prefer syscall kernel resolution (same path rules as open/chdir)
		if (this._sys) {
			try {
				return this._sys.resolve(input || '.')
			} catch {
				/* fall through */
			}
		}
		if (!input || input === '.') return this.cwd
		if (input === '~' || input.startsWith('~/')) {
			const rest = input === '~' ? '' : input.slice(2)
			return normalize(rest ? `/home/user/${rest}` : '/home/user')
		}
		if (input.startsWith('/')) return normalize(input)
		return normalize(`${this.cwd}/${input}`)
	}

	listTree(root = '/home/user', maxDepth = 6): FileTreeNode {
		return this.buildTree(this.resolvePath(root), maxDepth)
	}

	private buildTree(path: string, depth: number): FileTreeNode {
		const name = path === '/' ? '/' : (path.split('/').filter(Boolean).pop() ?? path)
		if (!this.vfs.existsSync(path)) {
			return { name, path, type: 'file' }
		}
		const st = this.vfs.statSync(path)
		if (!st.isDirectory() || depth <= 0) {
			return { name, path, type: st.isDirectory() ? 'directory' : 'file' }
		}
		const children = this.vfs
			.readdirSync(path)
			.filter((n) => n !== 'node_modules')
			.sort((a, b) => a.localeCompare(b))
			.map((n) => {
				const child = path === '/' ? `/${n}` : `${path}/${n}`
				return this.buildTree(child, depth - 1)
			})
		return { name, path, type: 'directory', children }
	}

	readFile(path: string): string {
		if (this._sys) {
			return this._sys.readFileText(path)
		}
		const p = this.resolvePath(path)
		return this.vfs.readFileSync(p, 'utf8')
	}

	writeFile(path: string, content: string): void {
		if (this._sys) {
			this._sys.writeFileText(path, content, O_WRONLY | O_CREAT | O_TRUNC)
			this.schedulePersist()
			return
		}
		const p = this.resolvePath(path)
		this.vfs.writeFileSync(p, content)
		this.schedulePersist()
	}

	mkdir(path: string): void {
		if (this._sys) {
			// recursive mkdir like shell mkdir -p
			const abs = this.resolvePath(path)
			const parts = abs.split('/').filter(Boolean)
			let cur = ''
			for (const part of parts) {
				cur += '/' + part
				try {
					this._sys.stat(cur)
				} catch {
					this._sys.mkdir(cur)
				}
			}
			this.schedulePersist()
			return
		}
		this.vfs.mkdirSync(this.resolvePath(path), { recursive: true })
		this.schedulePersist()
	}

	displayCwd(): string {
		if (this.cwd === '/home/user') return '~'
		if (this.cwd.startsWith('/home/user/')) return '~' + this.cwd.slice('/home/user'.length)
		return this.cwd
	}

	/**
	 * Run a shell-ish command string (subset of bash + node/npm).
	 * Supports simple chains: `cmd1 && cmd2`, `cmd1 || cmd2`, `cmd1; cmd2`
	 * (not inside quotes). Nested chains work left-to-right.
	 */
	async run(line: string, options?: ProcessOptions): Promise<ProcessResult> {
		let trimmed = line.trim()
		if (!trimmed) return { stdout: '', stderr: '', exitCode: 0 }

		if (!options?.noHistory) {
			this.history.push(trimmed)
			if (this.history.length > 200) this.history.shift()
		}

		// Multi-command lines: `a && b`, `a || b`, `a; b` (not inside quotes)
		if (!options?.noChain) {
			const chain = splitShellChain(trimmed)
			if (chain.length > 1) {
				let last: ProcessResult = { stdout: '', stderr: '', exitCode: 0 }
				let stdoutAll = ''
				let stderrAll = ''
				for (let i = 0; i < chain.length; i++) {
					const seg = chain[i]
					// op is the operator *before* this segment
					if (seg.op === '&&' && last.exitCode !== 0) continue
					if (seg.op === '||' && last.exitCode === 0) continue
					// ';' or first segment: always run
					last = await this.run(seg.cmd, {
						...options,
						noHistory: true,
						noChain: true,
					})
					stdoutAll += last.stdout
					stderrAll += last.stderr
				}
				return { stdout: stdoutAll, stderr: stderrAll, exitCode: last.exitCode }
			}
		}

		// If a custom stream handler is provided it owns display/collection.
		// Emitting as well caused every line (echo, scripts, node) to print twice.
		/** Set when command line has `>` / `>>` — stdout goes to VFS via syscall host. */
		let redirOut: { path: string; append: boolean } | null = null
		let redirBuf = ''
		const onOut = (s: string) => {
			if (redirOut) {
				redirBuf += s
				return
			}
			if (options?.onStdout) options.onStdout(s)
			else this.emit('stdout', s)
		}
		const onErr = (s: string) => {
			if (options?.onStderr) options.onStderr(s)
			else this.emit('stderr', s)
		}
		const setExit = (code: number) => {
			if (this.scriptCtx) this.scriptCtx.lastExit = code
		}
		/** Apply `>` / `>>` after the command finishes (writes through sys/VFS). */
		const applyRedir = (r: ProcessResult): ProcessResult => {
			setExit(r.exitCode)
			if (!redirOut) return r
			// interactive editors: do not capture into a file
			if (r.exitCode === 42 && r.stdout.startsWith('__NANOOS_EDIT__')) return r
			try {
				let text = redirBuf.length ? redirBuf : (r.stdout ?? '')
				if (redirOut.append) {
					try {
						text = this.readFile(redirOut.path) + text
					} catch {
						/* new file */
					}
				}
				const abs = this.resolvePath(redirOut.path)
				const parent = dirname(abs)
				if (parent && parent !== '/' && !this.vfs.existsSync(parent)) {
					this.mkdir(parent)
				}
				this.writeFile(redirOut.path, text)
				return { stdout: '', stderr: r.stderr, exitCode: r.exitCode }
			} catch (e) {
				const err = `bash: ${redirOut.path}: ${String(e)}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}
		const ok = (stdout = '', code = 0): ProcessResult => {
			setExit(code)
			return { stdout, stderr: '', exitCode: code }
		}
		const fail = (stderr: string, code = 1): ProcessResult => {
			onErr(stderr)
			setExit(code)
			return { stdout: '', stderr, exitCode: code }
		}
		const wrap = (r: ProcessResult): ProcessResult => {
			setExit(r.exitCode)
			return r
		}

		// Expand $VAR / $? etc. (quote-aware) before tokenize
		if (options?.expandVars !== false) {
			trimmed = expandLine(trimmed, this.env, this.scriptCtx).trim()
		}

		// VAR=value  or  export VAR=value
		const exportAsgn = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed)
		if (exportAsgn) {
			const name = exportAsgn[1]
			let value = exportAsgn[2]
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1)
			}
			value = expandVars(value, this.env, this.scriptCtx)
			this.env[name] = value
			return ok()
		}
		if (/^export\s+[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
			return ok()
		}
		// Pure NAME=value line (no command + args)
		const asgn = parseAssignment(trimmed)
		if (
			asgn &&
			/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed) &&
			!/^[A-Za-z_][A-Za-z0-9_]*=.*\s+\S/.test(trimmed)
		) {
			const value = expandVars(asgn.value, this.env, this.scriptCtx)
			this.env[asgn.name] = value
			return ok()
		}

		const [cmd, ...rawRest] = tokenize(trimmed)
		if (!cmd) return ok()

		// `echo hi > file` / `>>` — strip redirects; body runs with buffered stdout
		const stripped = parseStdoutRedirect(rawRest)
		redirOut = stripped.redir
		redirBuf = ''
		// Bash-like path globs: rm a.* → expand against VFS (flags left alone)
		const rest = this.expandArgs(stripped.args)

		// Keep syscall process cwd/env aligned with the shell for this command
		if (this._sys) {
			this._sys.current.cwd = this.cwd
			this._sys.current.env = this.env
		}

		// Single exit path so `>` / `>>` always flush via applyRedir
		const result = await (async (): Promise<ProcessResult> => {
		if (cmd === 'help') {
			const help =
				`FakeShell — TypeScript fake Linux shell (not real bash/Linux)\n` +
				`  help                 این راهنما\n` +
				`  uname [-a]           اطلاعات هسته\n` +
				`  whoami | id | hostname | date | cal\n` +
				`  pwd | cd [dir]       مسیر کاری\n` +
				`  ls [-la] [path]      فهرست پوشه\n` +
				`  tree [path]          درخت پوشه‌ها\n` +
				`  cat <file…>          نمایش فایل\n` +
				`  nano [file]          GNU nano (سازگار با distro)\n` +
				`  vim|vi <file>        vim آموزشی\n` +
				`  cal [month] [year]   تقویم ماه/سال\n` +
				`  head/tail [-n N] f   ابتدا/انتهای فایل\n` +
				`  wc <file>            شمارش خطوط/کلمات\n` +
				`  grep <pat> <file>    جستجو در فایل\n` +
				`  echo [-ne] | print | printf\n` +
				`  CMD > file | >> file  خروجی به فایل (syscall VFS)\n` +
				`  true | false | test | [ ] | exit\n` +
				`  export VAR=value     متغیر محیطی\n` +
				`  bash|sh <script>     اجرای اسکریپت\n` +
				`  ./script.sh          اجرای مستقیم اسکریپت\n` +
				`  source|. <script>    بارگذاری در شل فعلی\n` +
				`  mkdir | touch | rm | cp | mv | chmod\n` +
				`  ip | iptables | ping | curl   شبکه/فایروال (fake)\n` +
				`  apt | apt-get | dpkg          بسته‌ها (fake Ubuntu)\n` +
				`  systemctl | journalctl        systemd (fake)\n` +
				`  crontab [-l|-e|-r|file]       زمان‌بندی (کار می‌کند)\n` +
				`  less|more <file>     صفحه‌بند فایل\n` +
				`  globs: * ?          مثلاً  rm a.*   ls *.txt\n` +
				`  man [sec] <cmd>      راهنمای کامل (man -k)\n` +
				`  history              تاریخچه دستورات\n` +
				`  node | npm           اجرای JS در کرنل\n` +
				`  save | reset         ذخیره / ریست VFS\n` +
				`  sys …               دیباگ syscall / WASI host\n` +
				`  wasi-hello | wasi-echo | wasi-cat   WASI pilots\n` +
				`  clear                پاک کردن ترمینال\n` +
				`\n` +
				`Syscall host: open/read/write/stat/chdir/… + WASI preview1 over VFS.\n` +
				`File cmds + redirects use the same host. WASI: sys install-demo all\n` +
				`Note: mini-shell in browser — not full GNU/Linux.\n`
			onOut(help)
			return ok(help)
		}

		if (cmd === 'uname') {
			const u = this._sys?.uname() ?? {
				sysname: 'FakeShell',
				nodename: this.env.HOSTNAME || 'fakeshell-lab',
				release: '0.1.0-lab',
				version: '#1 SMP browser syscall-shim',
				machine: 'wasm32',
			}
			const all = rest.includes('-a')
			const s = all
				? `${u.sysname} ${u.nodename} ${u.release} ${u.version} ${u.machine}\n`
				: `${u.sysname}\n`
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}

		if (cmd === 'whoami') {
			const s = this.env.USER + '\n'
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}

		if (cmd === 'hostname') {
			const s = this.env.HOSTNAME + '\n'
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}

		if (cmd === 'id') {
			const s = `uid=1000(${this.env.USER}) gid=1000(${this.env.USER}) groups=1000(${this.env.USER}),27(sudo)\n`
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}

		if (cmd === 'date') {
			const s = new Date().toString() + '\n'
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}

		if (cmd === 'cal') {
			try {
				const s = formatCal(rest)
				onOut(s)
				return { stdout: s, stderr: '', exitCode: 0 }
			} catch (e) {
				const err = `cal: ${String(e)}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'env' || cmd === 'printenv') {
			const s =
				Object.entries(this.env)
					.map(([k, v]) => `${k}=${v}`)
					.join('\n') + '\n'
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}

		if (cmd === 'which') {
			const name = rest[0]
			if (!name) {
				const err = 'which: missing argument\n'
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
			const builtins = new Set([
				'help',
				'cd',
				'pwd',
				'ls',
				'cat',
				'cal',
				'date',
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
				'nano',
				'vim',
				'vi',
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
			])
			const s = builtins.has(name) ? `/usr/bin/${name}\n` : ''
			if (s) onOut(s)
			else {
				return fail(`which: no ${name} in (${this.env.PATH})\n`)
			}
			return ok(s)
		}

		if (cmd === 'history') {
			const s = this.history.map((h, i) => `  ${i + 1}  ${h}`).join('\n') + '\n'
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}

		if (cmd === 'ps') {
			const r = runPs(rest)
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		if (cmd === 'pgrep') {
			const r = runPgrep(rest)
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		if (cmd === 'pidof') {
			const r = runPidof(rest)
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		if (cmd === 'df') {
			const s =
				`Filesystem     1K-blocks    Used Available Use% Mounted on\n` +
				`fakeshell-vfs        524288  128000    396288  25% /\n` +
				`tmpfs             65536       0     65536   0% /tmp\n`
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}

		if (cmd === 'man') {
			const r = getManPage(rest)
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		if (cmd === 'pwd') {
			onOut(this.cwd + '\n')
			return { stdout: this.cwd + '\n', stderr: '', exitCode: 0 }
		}

		if (cmd === 'cd') {
			const arg = rest[0] ?? this.env.HOME
			try {
				if (this._sys) {
					const rc = this._sys.chdir(arg)
					if (rc < 0) {
						const e = `cd: no such directory: ${arg}\n`
						onErr(e)
						return { stdout: '', stderr: e, exitCode: 1 }
					}
					this.cwd = this._sys.getcwd()
				} else {
					const target = this.resolvePath(arg)
					if (!this.vfs.existsSync(target) || !this.vfs.statSync(target).isDirectory()) {
						const e = `cd: no such directory: ${arg}\n`
						onErr(e)
						return { stdout: '', stderr: e, exitCode: 1 }
					}
					this.cwd = target
				}
				this.env.PWD = this.cwd
				return { stdout: '', stderr: '', exitCode: 0 }
			} catch {
				const e = `cd: no such directory: ${arg}\n`
				onErr(e)
				return { stdout: '', stderr: e, exitCode: 1 }
			}
		}

		// Syscall debug / WASM host helpers
		if (cmd === 'sys') {
			return await this.runSysDebug(rest, onOut, onErr)
		}

		// Shell shortcuts for WASI pilots (auto-install into VFS, then runwasm)
		if (cmd === 'wasi-hello' || cmd === 'wasi-echo' || cmd === 'wasi-cat') {
			return await this.runWasiShellCmd(cmd, rest, onOut, onErr)
		}

		if (cmd === 'ls') {
			const flags = rest.filter((a) => a.startsWith('-')).join('')
			const pathArg = rest.find((a) => !a.startsWith('-'))
			const long = flags.includes('l')
			const all = flags.includes('a')
			const target = this.resolvePath(pathArg ?? '.')
			try {
				let isDir = false
				if (this._sys) {
					isDir = !!this._sys.stat(pathArg ?? '.').isDirectory
				} else {
					isDir = this.vfs.statSync(target).isDirectory()
				}
				if (isDir) {
					let names = this._sys
						? this._sys.readdir(pathArg ?? '.')
						: this.vfs.readdirSync(target)
					if (all) names = ['.', '..', ...names]
					else names = names.filter((n) => !n.startsWith('.'))
					names.sort()
					if (long) {
						const lines = names.map((n) => {
							if (n === '.' || n === '..') {
								return `drwxr-xr-x  2 ${this.env.USER} ${this.env.USER}  4096 Jan  1 12:00 ${n}`
							}
							const full = target === '/' ? `/${n}` : `${target}/${n}`
							let entDir = false
							let size = 4096
							if (this._sys) {
								const ent = this._sys.stat(full)
								entDir = !!ent.isDirectory
								if (!entDir) size = Number(ent.size) || 0
							} else {
								const ent = this.vfs.statSync(full)
								entDir = ent.isDirectory()
								if (!entDir) {
									try {
										size = this.vfs.readFileSync(full).byteLength
									} catch {
										size = 0
									}
								}
							}
							const mode = entDir ? 'drwxr-xr-x' : '-rw-r--r--'
							return `${mode}  1 ${this.env.USER} ${this.env.USER} ${String(size).padStart(5)} Jan  1 12:00 ${n}`
						})
						const listing = lines.join('\n') + '\n'
						onOut(listing)
						return { stdout: listing, stderr: '', exitCode: 0 }
					}
					const listing = names.join('  ') + '\n'
					onOut(listing)
					return { stdout: listing, stderr: '', exitCode: 0 }
				}
				onOut(target + '\n')
				return { stdout: target + '\n', stderr: '', exitCode: 0 }
			} catch (e) {
				const err = `ls: cannot access '${pathArg ?? '.'}': ${String(e)}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'tree') {
			const target = this.resolvePath(rest[0] ?? '.')
			try {
				const lines: string[] = [target]
				const walk = (dir: string, prefix: string) => {
					let names: string[]
					try {
						names = this.vfs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort()
					} catch {
						return
					}
					names.forEach((n, i) => {
						const last = i === names.length - 1
						const full = dir === '/' ? `/${n}` : `${dir}/${n}`
						lines.push(`${prefix}${last ? '└── ' : '├── '}${n}`)
						try {
							if (this.vfs.statSync(full).isDirectory()) {
								walk(full, prefix + (last ? '    ' : '│   '))
							}
						} catch {
							/* ignore */
						}
					})
				}
				if (this.vfs.statSync(target).isDirectory()) walk(target, '')
				const s = lines.join('\n') + '\n'
				onOut(s)
				return { stdout: s, stderr: '', exitCode: 0 }
			} catch (e) {
				const err = `tree: ${String(e)}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'cat') {
			const files = rest.filter((a) => !a.startsWith('-'))
			if (!files.length) {
				const err = 'cat: missing file operand\n'
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
			let all = ''
			let code = 0
			for (const f of files) {
				try {
					const data = this.readFile(f)
					const out = data.endsWith('\n') ? data : data + '\n'
					onOut(out)
					all += out
				} catch {
					const err = `cat: ${f}: No such file or directory\n`
					onErr(err)
					code = 1
				}
			}
			return { stdout: all, stderr: '', exitCode: code }
		}

		// Interactive editors are handled by the terminal UI (XtermShell)
		if (cmd === 'nano' || cmd === 'vim' || cmd === 'vi') {
			const path = rest[0] ?? ''
			if ((cmd === 'vim' || cmd === 'vi') && !path) {
				const err = `${cmd}: missing file operand\nTry '${cmd} filename'\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
			// Signal interactive host via special exit code + marker in stdout
			// nano may open with empty path → New Buffer (like real GNU nano)
			const marker = `__NANOOS_EDIT__:${cmd === 'nano' ? 'nano' : 'vim'}:${path}\n`
			return { stdout: marker, stderr: '', exitCode: 42 }
		}

		if (cmd === 'head' || cmd === 'tail') {
			let n = 10
			const args = [...rest]
			const ni = args.findIndex((a) => a === '-n')
			if (ni >= 0) {
				n = parseInt(args[ni + 1] ?? '10', 10) || 10
				args.splice(ni, 2)
			} else if (args[0]?.startsWith('-') && /^-?\d+$/.test(args[0].slice(1))) {
				n = parseInt(args[0].slice(1), 10) || 10
				args.shift()
			}
			const file = args[0]
			if (!file) {
				const err = `${cmd}: missing file\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
			try {
				const lines = this.readFile(file).split('\n')
				if (lines[lines.length - 1] === '') lines.pop()
				const slice = cmd === 'head' ? lines.slice(0, n) : lines.slice(-n)
				const s = slice.join('\n') + '\n'
				onOut(s)
				return { stdout: s, stderr: '', exitCode: 0 }
			} catch {
				const err = `${cmd}: ${file}: No such file or directory\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'wc') {
			const file = rest[rest.length - 1]
			if (!file || file.startsWith('-')) {
				const err = 'wc: missing file\n'
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
			try {
				const data = this.readFile(file)
				const lines = data === '' ? 0 : data.split('\n').length - (data.endsWith('\n') ? 1 : 0)
				const words = data.trim() ? data.trim().split(/\s+/).length : 0
				const bytes = new TextEncoder().encode(data).length
				const s = ` ${lines} ${words} ${bytes} ${file}\n`
				onOut(s)
				return { stdout: s, stderr: '', exitCode: 0 }
			} catch {
				const err = `wc: ${file}: No such file or directory\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'grep') {
			const pat = rest[0]
			const file = rest[1]
			if (!pat || !file) {
				const err = 'grep: usage: grep PATTERN FILE\n'
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 2 }
			}
			try {
				const lines = this.readFile(file).split('\n')
				const matched = lines.filter((l) => l.includes(pat))
				const s = matched.length ? matched.join('\n') + '\n' : ''
				if (s) onOut(s)
				return { stdout: s, stderr: '', exitCode: matched.length ? 0 : 1 }
			} catch {
				const err = `grep: ${file}: No such file or directory\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 2 }
			}
		}

		if (cmd === 'echo') {
			const { text, newline } = formatEcho(rest)
			const s = text + (newline ? '\n' : '')
			if (s) onOut(s)
			return ok(s)
		}

		if (cmd === 'printf') {
			const format = rest[0] ?? ''
			const s = formatPrintf(format, rest.slice(1))
			if (s) onOut(s)
			return ok(s)
		}

		// ksh/zsh-style print ≈ echo (course / user shorthand for printf-like output)
		if (cmd === 'print') {
			if (rest[0]?.includes('%') && rest.length >= 1) {
				const s = formatPrintf(rest[0], rest.slice(1))
				if (s) onOut(s)
				return ok(s)
			}
			const { text, newline } = formatEcho(rest)
			const s = text + (newline ? '\n' : '')
			if (s) onOut(s)
			return ok(s)
		}

		if (cmd === 'true' || cmd === ':') {
			return ok()
		}

		if (cmd === 'false') {
			return ok('', 1)
		}

		if (cmd === 'exit') {
			const code = rest[0] !== undefined ? parseInt(rest[0], 10) || 0 : 0
			if (this.scriptCtx) this.scriptCtx.exitRequested = code
			return ok('', code)
		}

		if (cmd === 'test' || cmd === '[') {
			let tokens = rest
			if (cmd === '[') {
				if (tokens[tokens.length - 1] !== ']') {
					return fail('[: missing `]`\n', 2)
				}
				tokens = tokens.slice(0, -1)
			}
			const pass = evalTest(
				tokens,
				(p) => this.vfs.existsSync(this.resolvePath(p)),
				(p) => {
					const abs = this.resolvePath(p)
					try {
						return this.vfs.existsSync(abs) && this.vfs.statSync(abs).isDirectory()
					} catch {
						return false
					}
				},
				(p) => {
					const abs = this.resolvePath(p)
					try {
						return this.vfs.existsSync(abs) && !this.vfs.statSync(abs).isDirectory()
					} catch {
						return false
					}
				},
			)
			return ok('', pass ? 0 : 1)
		}

		if (cmd === 'chmod') {
			// Lab VFS has no real mode bits — succeed so scripts using chmod +x work
			if (!rest.length) return fail('chmod: missing operand\n')
			return ok()
		}

		if (cmd === 'sleep') {
			const sec = Math.min(5, Math.max(0, parseFloat(rest[0] ?? '0') || 0))
			if (sec > 0) await new Promise((r) => setTimeout(r, sec * 1000))
			return ok()
		}

		// ── Fake network stack (iproute2 + netfilter + ICMP/HTTP) ──
		if (cmd === 'ip') {
			const r = runIp(rest)
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		if (cmd === 'iptables' || cmd === 'ip6tables') {
			const r = runIptables(rest, cmd === 'ip6tables')
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		if (cmd === 'ping') {
			return wrap(await runPing(rest, onOut, options?.signal))
		}

		if (cmd === 'curl') {
			const r = runCurl(rest)
			if (r.outputFile && r.fileBody !== undefined) {
				try {
					const dest = this.resolvePath(r.outputFile)
					this.vfs.writeFileSync(dest, r.fileBody)
					this.schedulePersist()
					if (r.stderr) onErr(r.stderr)
					return { stdout: '', stderr: r.stderr, exitCode: r.exitCode }
				} catch (e) {
					return fail(`curl: (${String(e)}) Failed writing body\n`, 23)
				}
			}
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		// sudo: strip and re-run (lab always allows)
		if (cmd === 'sudo') {
			if (!rest.length) return fail('sudo: a command is required\n')
			return wrap(
				await this.run(rest.join(' '), {
					...options,
					noHistory: true,
					expandVars: false,
					noChain: true,
				}),
			)
		}

		// Fake apt / apt-get / apt-cache / dpkg
		if (cmd === 'apt' || cmd === 'apt-get' || cmd === 'apt-cache' || cmd === 'dpkg') {
			const r = runApt(cmd, rest)
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			if (r.vfsWrites) {
				for (const [p, body] of Object.entries(r.vfsWrites)) {
					try {
						const abs = this.resolvePath(p)
						const parent = dirname(abs)
						if (parent && parent !== '/' && !this.vfs.existsSync(parent)) {
							this.mkdir(parent)
						}
						this.vfs.writeFileSync(abs, body)
					} catch {
						/* ignore */
					}
				}
				this.schedulePersist()
			}
			if (r.vfsUnlinks) {
				for (const p of r.vfsUnlinks) {
					try {
						const abs = this.resolvePath(p)
						if (this.vfs.existsSync(abs)) this.vfs.unlinkSync(abs)
					} catch {
						/* ignore */
					}
				}
				this.schedulePersist()
			}
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		// ── Fake systemd (systemctl / journalctl) ──
		if (cmd === 'systemctl') {
			const r = runSystemctl(rest)
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}
		if (cmd === 'journalctl') {
			const r = runJournalctl(rest)
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		// ── Working crontab (Vixie-style; jobs fire via tickCron) ──
		if (cmd === 'crontab') {
			// Resolve install-from-file paths against cwd
			const fixed = rest.map((a, i) => {
				if (a.startsWith('-')) return a
				// first non-option token that is not after -u
				const prev = rest[i - 1]
				if (prev === '-u' || prev === '--user') return a
				if (!a.startsWith('-') && !rest.slice(0, i).some((x) => x === '-e' || x === '-l' || x === '-r')) {
					// might be file
					if (a.includes('/') || a.endsWith('.cron') || a.endsWith('.txt') || !a.startsWith('-')) {
						try {
							const abs = this.resolvePath(a)
							if (this.vfs.existsSync(abs)) return abs
						} catch {
							/* keep */
						}
					}
				}
				return a
			})
			const r = runCrontab(fixed, this.vfs, this.env.USER || 'user')
			if (r.editPath) {
				// Signal host to open nano on spool file
				const marker = `__NANOOS_EDIT__:nano:${r.editPath}\n`
				return { stdout: marker, stderr: '', exitCode: 42 }
			}
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			if (r.exitCode === 0 && rest.some((x) => !x.startsWith('-') && x !== '-u')) {
				// installed from file
				onOut('') // quiet success like real crontab
			}
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		}

		if (cmd === 'bash' || cmd === 'sh') {
			return wrap(await this.runBashCommand(rest, onOut, onErr, options))
		}

		if (cmd === 'source' || cmd === '.') {
			const script = rest[0]
			if (!script) return fail(`${cmd}: filename argument required\n`)
			return wrap(await this.runScriptFile(script, rest.slice(1), onOut, onErr, options, true))
		}

		// ./script.sh or /path/script.sh or *.wasm WASI module
		if (cmd.startsWith('./') || cmd.startsWith('/') || cmd.startsWith('~/')) {
			const path = this.resolvePath(cmd)
			try {
				if (this.vfs.existsSync(path) && !this.vfs.statSync(path).isDirectory()) {
					if (path.endsWith('.wasm') || cmd.endsWith('.wasm')) {
						const argv = [path, ...rest]
						return wrap(await this.runWasiFromVfs(path, argv, onOut, onErr))
					}
					const content = this.vfs.readFileSync(path, 'utf8')
					if (looksLikeShellScript(path, content) || content.includes('echo') || content.includes('printf')) {
						return wrap(await this.runScriptFile(cmd, rest, onOut, onErr, options, false))
					}
				}
			} catch {
				/* fall through to not found */
			}
		}

		if (cmd === 'mkdir') {
			try {
				// mkdir [-p|--parents] [-v] DIR…
				const parents =
					rest.includes('-p') ||
					rest.includes('--parents') ||
					rest.some((a) => /^-[^\-]*p/.test(a))
				const verbose = rest.includes('-v') || rest.includes('--verbose')
				const targets = rest.filter((a) => !a.startsWith('-'))
				if (!targets.length) throw new Error('missing operand')
				let out = ''
				for (const t of targets) {
					const abs = this.resolvePath(t)
					if (this.vfs.existsSync(abs)) {
						if (!parents) {
							// real mkdir: fail if exists (unless -p)
							const st = this.vfs.statSync(abs)
							if (st.isDirectory()) {
								// without -p, "File exists"
								throw new Error(`cannot create directory '${t}': File exists`)
							}
						}
						// -p and exists as dir: success, no-op
						continue
					}
					if (parents) {
						this.mkdir(t) // recursive
					} else {
						// only create last component; parent must exist
						const parent = dirname(abs)
						if (parent !== '/' && !this.vfs.existsSync(parent)) {
							throw new Error(
								`cannot create directory '${t}': No such file or directory`,
							)
						}
						if (this._sys) {
							this._sys.mkdir(t)
						} else {
							this.vfs.mkdirSync(abs, { recursive: false })
						}
						this.schedulePersist()
					}
					if (verbose) out += `mkdir: created directory '${t}'\n`
				}
				if (out) onOut(out)
				return { stdout: out, stderr: '', exitCode: 0 }
			} catch (e) {
				const err = `mkdir: ${String(e).replace(/^Error:\s*/, '')}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'touch') {
			try {
				const name = rest[0] ?? ''
				if (!name) throw new Error('missing operand')
				if (this._sys) {
					try {
						this._sys.access(name)
					} catch {
						this._sys.writeFileText(name, '', O_WRONLY | O_CREAT)
					}
				} else {
					const p = this.resolvePath(name)
					if (!this.vfs.existsSync(p)) this.vfs.writeFileSync(p, '')
				}
				this.schedulePersist()
				return { stdout: '', stderr: '', exitCode: 0 }
			} catch (e) {
				const err = `touch: ${String(e)}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'rm') {
			try {
				const recursive = rest.includes('-r') || rest.includes('-rf') || rest.includes('-fr')
				const targets = rest.filter((a) => !a.startsWith('-'))
				if (!targets.length) throw new Error('missing operand')
				let code = 0
				for (const t of targets) {
					try {
						if (this._sys) {
							let st
							try {
								st = this._sys.stat(t)
							} catch {
								onErr(`rm: cannot remove '${t}': No such file or directory\n`)
								code = 1
								continue
							}
							if (st.isDirectory) {
								if (!recursive) {
									onErr(`rm: cannot remove '${t}': Is a directory\n`)
									code = 1
									continue
								}
								this.rmrf(this.resolvePath(t))
							} else {
								this._sys.unlink(t)
							}
						} else {
							const p = this.resolvePath(t)
							if (!this.vfs.existsSync(p)) {
								onErr(`rm: cannot remove '${t}': No such file or directory\n`)
								code = 1
								continue
							}
							const st = this.vfs.statSync(p)
							if (st.isDirectory()) {
								if (!recursive) {
									onErr(`rm: cannot remove '${t}': Is a directory\n`)
									code = 1
									continue
								}
								this.rmrf(p)
							} else {
								this.vfs.unlinkSync(p)
							}
						}
					} catch (e) {
						onErr(`rm: cannot remove '${t}': ${String(e)}\n`)
						code = 1
					}
				}
				this.schedulePersist()
				return { stdout: '', stderr: '', exitCode: code }
			} catch (e) {
				const err = `rm: ${String(e)}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'cp') {
			try {
				const src = rest[0]
				const dest = rest[1]
				if (!src || !dest) throw new Error('usage: cp SOURCE DEST')
				if (this._sys) {
					const text = this._sys.readFileText(src)
					this._sys.writeFileText(dest, text)
				} else {
					const sp = this.resolvePath(src)
					const dp = this.resolvePath(dest)
					const data = this.vfs.readFileSync(sp)
					this.vfs.writeFileSync(dp, data)
				}
				this.schedulePersist()
				return { stdout: '', stderr: '', exitCode: 0 }
			} catch (e) {
				const err = `cp: ${String(e)}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'mv') {
			try {
				const src = rest[0]
				const dest = rest[1]
				if (!src || !dest) throw new Error('usage: mv SOURCE DEST')
				if (this._sys) {
					this._sys.rename(src, dest)
				} else {
					const sp = this.resolvePath(src)
					const dp = this.resolvePath(dest)
					const data = this.vfs.readFileSync(sp)
					this.vfs.writeFileSync(dp, data)
					this.vfs.unlinkSync(sp)
				}
				this.schedulePersist()
				return { stdout: '', stderr: '', exitCode: 0 }
			} catch (e) {
				const err = `mv: ${String(e)}\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		if (cmd === 'save') {
			await this.persistNow()
			return { stdout: 'saved\n', stderr: '', exitCode: 0 }
		}

		if (cmd === 'reset') {
			this.booted = false
			this.history = []
			resetNetLab()
			resetSystemd()
			resetCronLab()
			resetAptLab()
			await this.boot({ reset: true })
			return { stdout: 'reset complete\n', stderr: '', exitCode: 0 }
		}

		if (cmd === 'clear') {
			return { stdout: '', stderr: '', exitCode: 0 }
		}

		if (cmd === 'node') {
			return this.runNode(rest, onOut, onErr)
		}

		try {
			const r = await this.container.run(trimmed, {
				cwd: this.cwd,
				onStdout: onOut,
				onStderr: onErr,
				signal: options?.signal,
			})
			this.schedulePersist()
			return r
		} catch (e) {
			const err = `${cmd}: command not found\n`
			onErr(err)
			return { stdout: '', stderr: err, exitCode: 127 }
		}
		})()
		return applyRedir(result)
	}

	/**
	 * `sys` — inspect and exercise the fake Linux/WASI syscall host.
	 * Usage:
	 *   sys help | call NAME [args…] | open PATH | read PATH | write PATH TEXT
	 *   sys stat PATH | chdir PATH | getcwd | uname | pid | fds | trace on|off
	 *   sys nr NAME | numbers | wasi-demo
	 */
	private async runSysDebug(
		args: string[],
		onOut: (s: string) => void,
		onErr: (s: string) => void,
	): Promise<ProcessResult> {
		const ok = (s: string) => {
			onOut(s)
			return { stdout: s, stderr: '', exitCode: 0 }
		}
		const fail = (s: string, code = 1) => {
			onErr(s)
			return { stdout: '', stderr: s, exitCode: code }
		}
		if (!this._sys) return fail('sys: kernel not booted\n')
		const k = this._sys
		const sub = args[0] ?? 'help'

		if (sub === 'help' || sub === '-h' || sub === '--help') {
			const names = k.listNamedSyscalls().join(', ')
			return ok(
				`sys — FakeShell fake Linux/WASI syscall host\n` +
					`  sys help                 this text\n` +
					`  sys call NAME [args…]    syscallNamed (open/read/write/…)\n` +
					`  sys open PATH [flags]    open(2); flags octal default 0\n` +
					`  sys read PATH [N]        open+read+close (print text)\n` +
					`  sys write PATH TEXT…     open creat/trunc + write\n` +
					`  sys stat PATH            stat(2)\n` +
					`  sys readdir [PATH]       readdir\n` +
					`  sys chdir PATH | getcwd\n` +
					`  sys uname | pid | fds | errno\n` +
					`  sys nr NAME              Linux x86_64 number for NAME\n` +
					`  sys numbers              dump SYS table (subset)\n` +
					`  sys trace on|off         log open/… to system stream\n` +
					`  sys wasi-demo            tiny WASI hello (in-memory)\n` +
					`  sys install-demo [NAME] [PATH]\n` +
					`      NAME: hello | echo | cat | all   (default: all)\n` +
					`      installs pilot .wasm into lab VFS\n` +
					`  sys runwasm PATH [arg…]  run WASI module from VFS\n` +
					`  sys pilots               list built-in WASI pilots\n` +
					`  sys pipe-demo            pipe(2) write/read\n` +
					`Shell shortcuts (auto-install):\n` +
					`  wasi-hello | wasi-echo ARGS… | wasi-cat FILE…\n` +
					`Named: ${names}\n`,
			)
		}

		try {
			if (sub === 'trace') {
				const on = (args[1] ?? 'on') !== 'off'
				k.traceEnabled = on
				return ok(`trace ${on ? 'on' : 'off'}\n`)
			}
			if (sub === 'errno') {
				return ok(`${k.errno}\n`)
			}
			if (sub === 'pid') {
				return ok(
					`pid=${k.getpid()} ppid=${k.getppid()} uid=${k.getuid()} gid=${k.getgid()}\n`,
				)
			}
			if (sub === 'getcwd' || sub === 'pwd') {
				return ok(k.getcwd() + '\n')
			}
			if (sub === 'chdir' || sub === 'cd') {
				const path = args[1]
				if (!path) return fail('sys chdir: missing path\n')
				k.chdir(path)
				this.cwd = k.getcwd()
				this.env.PWD = this.cwd
				return ok('')
			}
			if (sub === 'uname') {
				const u = k.uname()
				return ok(
					`${u.sysname} ${u.nodename} ${u.release} ${u.version} ${u.machine}\n`,
				)
			}
			if (sub === 'fds') {
				const lines: string[] = []
				for (const [fd, f] of k.current.fds) {
					if (f.closed) continue
					lines.push(`${fd}\t${f.kind}\t${f.path}\toff=${f.offset}\tflags=${f.flags}`)
				}
				return ok(lines.join('\n') + '\n')
			}
			if (sub === 'stat') {
				const path = args[1]
				if (!path) return fail('sys stat: missing path\n')
				const st = k.stat(path)
				return ok(
					JSON.stringify(
						{
							path: st.path,
							mode: '0o' + (st.mode as number).toString(8),
							size: st.size,
							isFile: st.isFile,
							isDirectory: st.isDirectory,
							mtime: st.mtime,
						},
						null,
						2,
					) + '\n',
				)
			}
			if (sub === 'readdir') {
				const path = args[1] ?? '.'
				const names = k.readdir(path)
				return ok(names.join('\n') + '\n')
			}
			if (sub === 'open') {
				const path = args[1]
				if (!path) return fail('sys open: missing path\n')
				const flags = args[2] ? parseInt(args[2], 8) : O_RDONLY
				const fd = k.open(path, flags)
				return ok(`${fd}\n`)
			}
			if (sub === 'close') {
				const fd = parseInt(args[1] ?? '', 10)
				if (Number.isNaN(fd)) return fail('sys close: need fd\n')
				k.close(fd)
				return ok('0\n')
			}
			if (sub === 'read') {
				const path = args[1]
				if (!path) return fail('sys read: missing path\n')
				const n = args[2] ? parseInt(args[2], 10) : undefined
				if (n !== undefined && !Number.isNaN(n)) {
					const fd = k.open(path, O_RDONLY)
					try {
						const data = k.read(fd, n)
						const text = new TextDecoder().decode(data)
						return ok(text + (text.endsWith('\n') ? '' : '\n'))
					} finally {
						k.close(fd)
					}
				}
				const text = k.readFileText(path)
				return ok(text + (text.endsWith('\n') ? '' : '\n'))
			}
			if (sub === 'write') {
				const path = args[1]
				if (!path) return fail('sys write: missing path\n')
				const text = args.slice(2).join(' ')
				const n = k.writeFileText(path, text + (text.endsWith('\n') ? '' : '\n'))
				this.schedulePersist()
				return ok(`${n}\n`)
			}
			if (sub === 'nr') {
				const name = args[1] as keyof typeof SYS
				if (!name || !(name in SYS)) {
					return fail(`sys nr: unknown name (try sys numbers)\n`)
				}
				return ok(`${name} = ${SYS[name]}\n`)
			}
			if (sub === 'numbers') {
				const lines = Object.entries(SYS)
					.sort((a, b) => (a[1] as number) - (b[1] as number))
					.map(([n, v]) => `${String(v).padStart(4)}  ${n}`)
				return ok(lines.join('\n') + '\n')
			}
			if (sub === 'call') {
				const name = args[1]
				if (!name) return fail('sys call: missing NAME\n')
				const rest = args.slice(2)
				// parse numeric args; leave strings
				const parsed = rest.map((a) => (/^-?\d+$/.test(a) ? parseInt(a, 10) : a))
				const bag: { buf?: Uint8Array; r?: number; w?: number } = {}
				const rc = k.syscallNamed(name, ...parsed, bag)
				let out = `${rc}\n`
				if (bag.buf) out += new TextDecoder().decode(bag.buf) + '\n'
				if (bag.r !== undefined) out += `pipe r=${bag.r} w=${bag.w}\n`
				return ok(out)
			}
			if (sub === 'pipe-demo') {
				const [r, w] = k.pipe()
				k.write(w, 'hello-from-pipe')
				const data = k.read(r, 64)
				k.close(r)
				k.close(w)
				return ok(`pipe r=${r} w=${w} data=${new TextDecoder().decode(data)}\n`)
			}
			if (sub === 'wasi-demo') {
				return await this.runWasiDemo(onOut, onErr)
			}
			if (sub === 'pilots') {
				const lines = listWasiPilots().map(
					(p) =>
						`${p.id.padEnd(8)} ${p.defaultPath}\n` +
						`         ${p.summary}\n` +
						`         e.g. ${p.example}`,
				)
				return ok(lines.join('\n\n') + '\n')
			}
			if (sub === 'install-demo') {
				// sys install-demo [hello|echo|all] [optional path for single]
				const a1 = args[1]
				const a2 = args[2]
				if (!a1 || a1 === 'all') {
					return this.installWasiPilots('all', undefined, onOut, onErr)
				}
				if (a1.startsWith('/') || a1.startsWith('~') || a1.startsWith('.')) {
					// legacy: sys install-demo /tmp/foo.wasm  → hello at that path
					return this.installWasiPilots('hello', a1, onOut, onErr)
				}
				return this.installWasiPilots(a1, a2, onOut, onErr)
			}
			if (sub === 'runwasm' || sub === 'wasm') {
				const path = args[1]
				if (!path) {
					return fail('sys runwasm: usage: sys runwasm PATH [arg…]\n')
				}
				const wasmArgs = [path, ...args.slice(2)]
				return await this.runWasiFromVfs(path, wasmArgs, onOut, onErr)
			}
			return fail(`sys: unknown subcommand '${sub}' (try sys help)\n`)
		} catch (e) {
			if (e instanceof SysError) {
				return fail(`sys: ${e.code} (${e.errno}) ${e.message}\n`)
			}
			return fail(`sys: ${String(e)}\n`)
		}
	}

	/**
	 * `wasi-hello` | `wasi-echo` | `wasi-cat` — ensure pilot on disk, then runwasm.
	 * wasi-cat resolves file args to absolute paths for the preopen-root WASI host.
	 */
	private async runWasiShellCmd(
		cmd: 'wasi-hello' | 'wasi-echo' | 'wasi-cat',
		args: string[],
		onOut: (s: string) => void,
		onErr: (s: string) => void,
	): Promise<ProcessResult> {
		const id = cmd === 'wasi-hello' ? 'hello' : cmd === 'wasi-echo' ? 'echo' : 'cat'
		const pilot = getWasiPilot(id)
		if (!pilot) {
			const e = `${cmd}: unknown pilot\n`
			onErr(e)
			return { stdout: '', stderr: e, exitCode: 1 }
		}
		// install if missing
		const path = pilot.defaultPath
		try {
			if (!this.vfs.existsSync(this.resolvePath(path))) {
				const inst = this.installWasiPilots(id, undefined, () => {}, onErr)
				if (inst.exitCode !== 0) return inst
			}
		} catch {
			const inst = this.installWasiPilots(id, undefined, () => {}, onErr)
			if (inst.exitCode !== 0) return inst
		}

		let wasmArgs: string[]
		if (id === 'cat') {
			if (!args.length) {
				const e = 'wasi-cat: missing file operand\n'
				onErr(e)
				return { stdout: '', stderr: e, exitCode: 1 }
			}
			// absolute paths so path_open(dirfd=3=/) works
			wasmArgs = [path, ...args.map((a) => this.resolvePath(a))]
		} else if (id === 'echo') {
			wasmArgs = [path, ...args]
		} else {
			wasmArgs = [path]
		}
		return await this.runWasiFromVfs(path, wasmArgs, onOut, onErr)
	}

	/** Install one or all built-in WASI pilot modules into the lab VFS. */
	private installWasiPilots(
		name: string,
		customPath: string | undefined,
		onOut: (s: string) => void,
		onErr: (s: string) => void,
	): ProcessResult {
		if (!this._sys) {
			const e = 'sys: not booted\n'
			onErr(e)
			return { stdout: '', stderr: e, exitCode: 1 }
		}
		try {
			const pilots =
				name === 'all'
					? listWasiPilots()
					: (() => {
							const p = getWasiPilot(name)
							if (!p) return null
							return [p]
						})()
			if (!pilots) {
				const err = `sys install-demo: unknown pilot '${name}' (try: hello, echo, all)\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
			const lines: string[] = []
			for (const p of pilots) {
				const path = customPath && pilots.length === 1 ? customPath : p.defaultPath
				const abs = this.resolvePath(path)
				const parent = dirname(abs)
				if (parent && parent !== '/' && !this.vfs.existsSync(parent)) {
					this.mkdir(parent)
				}
				this.vfs.writeFileSync(abs, p.bytes)
				const n = this._sys.readFileBytes(path).byteLength
				lines.push(`installed ${p.id}: ${n} bytes → ${abs}`)
				lines.push(`  try: ${p.example.replace(p.defaultPath, path)}`)
			}
			this.schedulePersist()
			const msg = lines.join('\n') + '\n'
			onOut(msg)
			return { stdout: msg, stderr: '', exitCode: 0 }
		} catch (e) {
			const err = `sys install-demo: ${String(e)}\n`
			onErr(err)
			return { stdout: '', stderr: err, exitCode: 1 }
		}
	}

	/** Load WASM bytes from VFS and run as WASI preview1 against SyscallKernel. */
	private async runWasiFromVfs(
		path: string,
		argv: string[],
		onOut: (s: string) => void,
		onErr: (s: string) => void,
	): Promise<ProcessResult> {
		if (!this._sys) {
			const e = 'sys: not booted\n'
			onErr(e)
			return { stdout: '', stderr: e, exitCode: 1 }
		}
		const shellPid = 1
		try {
			const { runWasiModule } = await import('./sys/wasi')
			const bytes = this._sys.readFileBytes(path)
			if (bytes.byteLength < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61) {
				const err = `sys runwasm: ${path}: not a WASM module\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
			const r = await runWasiModule(this._sys, bytes, argv)
			// print guest stdout/stderr as the process would
			if (r.stdout) onOut(r.stdout)
			if (r.stderr) onErr(r.stderr)
			return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
		} catch (e) {
			const err = `sys runwasm: ${String(e)}\n`
			onErr(err)
			return { stdout: '', stderr: err, exitCode: 1 }
		} finally {
			try {
				this._sys.setCurrent(shellPid)
				this._sys.current.cwd = this.cwd
				this._sys.current.env = this.env
			} catch {
				/* ignore */
			}
		}
	}

	/** Tiny hand-written WASI WASM: fd_write(1,"hi\\n"); proc_exit(0) */
	private async runWasiDemo(
		onOut: (s: string) => void,
		onErr: (s: string) => void,
	): Promise<ProcessResult> {
		if (!this._sys) {
			const e = 'sys: not booted\n'
			onErr(e)
			return { stdout: '', stderr: e, exitCode: 1 }
		}
		try {
			const { runWasiModule } = await import('./sys/wasi')
			const wasm = buildMinimalWasiHello()
			const r = await runWasiModule(this._sys, wasm, ['wasi-demo'])
			const out =
				`WASI demo exit=${r.exitCode}\n` +
				`stdout: ${JSON.stringify(r.stdout)}\n` +
				`stderr: ${JSON.stringify(r.stderr)}\n`
			onOut(out)
			return { stdout: out, stderr: '', exitCode: r.exitCode }
		} catch (e) {
			const err = `sys wasi-demo: ${String(e)}\n`
			onErr(err)
			return { stdout: '', stderr: err, exitCode: 1 }
		} finally {
			try {
				this._sys.setCurrent(1)
				this._sys.current.cwd = this.cwd
				this._sys.current.env = this.env
			} catch {
				/* ignore */
			}
		}
	}

	/** `bash` / `sh` entry: -c CMD | SCRIPT [args…] */
	private async runBashCommand(
		args: string[],
		onOut: (s: string) => void,
		onErr: (s: string) => void,
		options?: ProcessOptions,
	): Promise<ProcessResult> {
		if (args[0] === '-c') {
			const code = args.slice(1).join(' ')
			if (!code) {
				const err = 'bash: -c: option requires an argument\n'
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 2 }
			}
			// Run one or more commands separated by `;` or newlines
			return this.runScriptSource('bash', code, [], onOut, onErr, options, true)
		}
		if (!args[0]) {
			const msg =
				'FakeShell bash: interactive REPL not available — use `bash SCRIPT` or `bash -c CMD`\n'
			onErr(msg)
			return { stdout: '', stderr: msg, exitCode: 2 }
		}
		return this.runScriptFile(args[0], args.slice(1), onOut, onErr, options, false)
	}

	/** Load script file from VFS and execute. */
	private async runScriptFile(
		pathArg: string,
		scriptArgs: string[],
		onOut: (s: string) => void,
		onErr: (s: string) => void,
		options?: ProcessOptions,
		sourceIntoShell?: boolean,
	): Promise<ProcessResult> {
		const abs = this.resolvePath(pathArg)
		let content: string
		try {
			if (!this.vfs.existsSync(abs) || this.vfs.statSync(abs).isDirectory()) {
				const err = `bash: ${pathArg}: No such file or directory\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 127 }
			}
			content = this.vfs.readFileSync(abs, 'utf8')
		} catch (e) {
			const err = `bash: ${pathArg}: ${String(e)}\n`
			onErr(err)
			return { stdout: '', stderr: err, exitCode: 1 }
		}
		return this.runScriptSource(abs, content, scriptArgs, onOut, onErr, options, !!sourceIntoShell)
	}

	/**
	 * Line-oriented mini-bash: assignments, if/elif/else/fi, for/do/done,
	 * and any interactive builtin via recursive `run()`.
	 */
	private async runScriptSource(
		name: string,
		source: string,
		scriptArgs: string[],
		onOut: (s: string) => void,
		onErr: (s: string) => void,
		options?: ProcessOptions,
		_sourceIntoShell?: boolean,
	): Promise<ProcessResult> {
		const prevCtx = this.scriptCtx
		const ctx: ScriptContext = { name, args: scriptArgs, lastExit: 0 }
		this.scriptCtx = ctx

		let stdoutAll = ''
		let stderrAll = ''
		let exitCode = 0

		const collectOut = (s: string) => {
			stdoutAll += s
			onOut(s)
		}
		const collectErr = (s: string) => {
			stderrAll += s
			onErr(s)
		}

		const lines = splitScriptLines(source)

		const pathExists = (p: string) => this.vfs.existsSync(this.resolvePath(p))
		const pathIsDir = (p: string) => {
			const abs = this.resolvePath(p)
			try {
				return this.vfs.existsSync(abs) && this.vfs.statSync(abs).isDirectory()
			} catch {
				return false
			}
		}
		const pathIsFile = (p: string) => {
			const abs = this.resolvePath(p)
			try {
				return this.vfs.existsSync(abs) && !this.vfs.statSync(abs).isDirectory()
			} catch {
				return false
			}
		}

		const evalCond = async (condRaw: string): Promise<boolean> => {
			const cond = expandLine(condRaw.trim(), this.env, this.scriptCtx).trim()
			const brack = /^\[\[\s+([\s\S]*?)\s+\]\]$/.exec(cond)
			const brack1 = /^\[\s+([\s\S]*?)\s+\]$/.exec(cond)
			if (brack || brack1) {
				const inner = (brack ?? brack1)![1]
				return evalTest(tokenize(inner), pathExists, pathIsDir, pathIsFile)
			}
			const arith = /^\(\((.+)\)\)$/.exec(cond)
			if (arith) return evalArithmetic(arith[1], this.env, this.scriptCtx)
			if (cond.startsWith('test ') || cond.startsWith('[ ')) {
				const r = await this.run(cond, {
					noHistory: true,
					onStdout: () => {},
					onStderr: () => {},
					signal: options?.signal,
				})
				return r.exitCode === 0
			}
			const r = await this.run(cond, {
				noHistory: true,
				onStdout: collectOut,
				onStderr: collectErr,
				signal: options?.signal,
			})
			return r.exitCode === 0
		}

		/** First index of a keyword at depth 0 of if/for, scanning [from, end). */
		const findEnd = (from: number, end: number, keywords: string[]): number => {
			let depthIf = 0
			let depthFor = 0
			for (let j = from; j < end; j++) {
				const word = lines[j].trim().split(/\s+/)[0] ?? ''
				if (word === 'if') depthIf++
				else if (word === 'for' || word === 'while') depthFor++
				else if (word === 'fi') {
					if (depthIf === 0 && keywords.includes('fi')) return j
					if (depthIf > 0) depthIf--
				} else if (word === 'done') {
					if (depthFor === 0 && keywords.includes('done')) return j
					if (depthFor > 0) depthFor--
				} else if (depthIf === 0 && depthFor === 0 && keywords.includes(word)) {
					return j
				}
			}
			return end
		}

		const runRange = async (from: number, end: number): Promise<void> => {
			let i = from
			while (i < end) {
				if (ctx.exitRequested !== undefined) return
				const t = lines[i].trim()
				i++
				if (!t || t.startsWith('#')) continue

				const ifLine = parseIfLine(t)
				if (ifLine) {
					const fiAt = findEnd(i, end, ['fi'])
					let cursor = i
					if (!/then\s*$/i.test(t) && lines[cursor]?.trim() === 'then') cursor++

					let executed = false
					if (await evalCond(ifLine.cond)) {
						const stop = findEnd(cursor, fiAt, ['else', 'elif', 'fi'])
						await runRange(cursor, stop)
						executed = true
					} else {
						let pos = findEnd(cursor, fiAt, ['else', 'elif', 'fi'])
						while (pos < fiAt && !executed) {
							const w = lines[pos].trim()
							if (w === 'else' || w.startsWith('else ')) {
								await runRange(pos + 1, fiAt)
								executed = true
								break
							}
							const elif = parseElifLine(w)
							if (elif) {
								let body = pos + 1
								if (lines[body]?.trim() === 'then') body++
								if (await evalCond(elif.cond)) {
									const stop = findEnd(body, fiAt, ['else', 'elif', 'fi'])
									await runRange(body, stop)
									executed = true
									break
								}
								pos = findEnd(body, fiAt, ['else', 'elif', 'fi'])
								continue
							}
							break
						}
					}
					i = fiAt + 1
					continue
				}

				const forLine = parseForLine(expandLine(t, this.env, this.scriptCtx))
				if (forLine) {
					let bodyStart = i
					if (!/do\s*$/i.test(t) && lines[bodyStart]?.trim() === 'do') bodyStart++
					const doneAt = findEnd(bodyStart, end, ['done'])
					for (const item of forLine.items) {
						if (ctx.exitRequested !== undefined) break
						this.env[forLine.name] = item
						await runRange(bodyStart, doneAt)
					}
					i = doneAt + 1
					continue
				}

				const word = t.split(/\s+/)[0] ?? ''
				if (['then', 'do', 'else', 'elif', 'fi', 'done'].includes(word)) continue

				for (const part of splitBySemicolon(t)) {
					if (!part.trim()) continue
					const r = await this.run(part, {
						noHistory: true,
						onStdout: collectOut,
						onStderr: collectErr,
						signal: options?.signal,
					})
					exitCode = r.exitCode
					ctx.lastExit = r.exitCode
					if (ctx.exitRequested !== undefined) {
						exitCode = ctx.exitRequested
						return
					}
				}
			}
		}

		try {
			await runRange(0, lines.length)
			if (ctx.exitRequested !== undefined) exitCode = ctx.exitRequested
		} finally {
			this.scriptCtx = prevCtx
			if (prevCtx) prevCtx.lastExit = exitCode
		}

		this.schedulePersist()
		return { stdout: stdoutAll, stderr: stderrAll, exitCode }
	}

	/**
	 * Expand shell globs in path arguments (`*`, `?`).
	 * Flags (`-la`) and non-glob tokens are left unchanged.
	 * If a pattern matches nothing, the literal token is kept (bash nullglob off).
	 */
	expandArgs(args: string[]): string[] {
		const out: string[] = []
		for (const arg of args) {
			if (!arg || arg.startsWith('-') || !/[*?]/.test(arg)) {
				out.push(arg)
				continue
			}
			const matches = this.expandGlob(arg)
			if (matches.length === 0) out.push(arg)
			else out.push(...matches)
		}
		return out
	}

	/** Expand a single glob pattern relative to cwd (or absolute). */
	expandGlob(pattern: string): string[] {
		// Split into directory part and name pattern (e.g. docs/*.txt, a.*, /tmp/a.*)
		let dirPart: string
		let namePat: string
		if (pattern.includes('/')) {
			const i = pattern.lastIndexOf('/')
			dirPart = pattern.slice(0, i) || '/'
			namePat = pattern.slice(i + 1)
		} else {
			dirPart = '.'
			namePat = pattern
		}

		// If directory part itself has globs, only support simple name globs for now
		if (/[*?]/.test(dirPart) && dirPart !== '.') {
			return []
		}

		const absDir = this.resolvePath(dirPart === '.' ? this.cwd : dirPart)
		let names: string[]
		try {
			if (!this.vfs.existsSync(absDir) || !this.vfs.statSync(absDir).isDirectory()) return []
			names = this.vfs.readdirSync(absDir)
		} catch {
			return []
		}

		const re = globToRegExp(namePat)
		const matched = names.filter((n) => re.test(n)).sort((a, b) => a.localeCompare(b))

		// Return paths in the same style as the user typed (relative when possible)
		return matched.map((n) => {
			if (dirPart === '.' || dirPart === '') return n
			if (dirPart === '/') return `/${n}`
			return `${dirPart.replace(/\/$/, '')}/${n}`
		})
	}

	private rmrf(path: string): void {
		const st = this.vfs.statSync(path)
		if (st.isDirectory()) {
			for (const n of this.vfs.readdirSync(path)) {
				const child = path === '/' ? `/${n}` : `${path}/${n}`
				this.rmrf(child)
			}
			// almostnode may not have rmdir — try unlink empty via rewrite by leaving dir
			try {
				const vfs = this.vfs as VirtualFS & { rmdirSync?: (p: string) => void }
				vfs.rmdirSync?.(path)
			} catch {
				/* ignore */
			}
		} else {
			this.vfs.unlinkSync(path)
		}
	}

	private runNode(
		args: string[],
		onOut: (s: string) => void,
		onErr: (s: string) => void,
	): ProcessResult {
		if (args.length === 0) {
			const err = 'node: missing script (try: node index.js)\n'
			onErr(err)
			return { stdout: '', stderr: err, exitCode: 1 }
		}

		if (args[0] === '-e' || args[0] === '--eval') {
			const code = args.slice(1).join(' ')
			try {
				const result = this.container.execute(code, `${this.cwd}/[eval]`)
				const exported =
					result.exports !== undefined ? stringify(result.exports) + '\n' : ''
				if (exported) onOut(exported)
				this.schedulePersist()
				return { stdout: exported, stderr: '', exitCode: 0 }
			} catch (e) {
				const err = String(e) + '\n'
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
		}

		const file = this.resolvePath(args[0])
		try {
			if (!this.vfs.existsSync(file)) {
				const err = `node: cannot find module '${file}'\n`
				onErr(err)
				return { stdout: '', stderr: err, exitCode: 1 }
			}
			this.container.execute(
				`process.chdir(${JSON.stringify(dirname(file))});`,
				`${this.cwd}/[chdir]`,
			)
			this.container.runFile(file)
			this.schedulePersist()
			return { stdout: '', stderr: '', exitCode: 0 }
		} catch (e) {
			const err = String(e) + '\n'
			onErr(err)
			return { stdout: '', stderr: err, exitCode: 1 }
		}
	}

	execute(code: string, filename = '/tmp/snippet.js'): { exports: unknown } {
		return this.container.execute(code, filename)
	}

	/**
	 * Run due crontab jobs for the current user (called by the terminal ticker).
	 * Returns summary lines for optional display.
	 */
	async runDueCronJobs(): Promise<string[]> {
		ensureCronSpool(this.vfs, this.env.USER || 'user')
		const cmds = tickCron(this.vfs, this.env.USER || 'user', new Date())
		const notes: string[] = []
		for (const c of cmds) {
			try {
				appendCronLog(this.vfs, `(${this.env.USER}) CMD (${c})`)
				const r = await this.run(c, { noHistory: true })
				appendCronLog(
					this.vfs,
					`(${this.env.USER}) END (${c}) exit=${r.exitCode}`,
				)
				notes.push(`cron: ran: ${c}`)
			} catch (e) {
				appendCronLog(this.vfs, `(${this.env.USER}) FAIL (${c}) ${String(e)}`)
				notes.push(`cron: fail: ${c}`)
			}
		}
		if (cmds.length) this.schedulePersist()
		return notes
	}

	/** After crontab -e save: validate & keep spool (file already written by editor). */
	installCrontabFromEditor(path: string): { ok: boolean; message: string } {
		try {
			const body = this.vfs.readFileSync(path, 'utf8') as string
			// re-write to normalize
			writeCrontab(this.vfs, body, this.env.USER || 'user')
			const n = body.split('\n').filter((l) => {
				const t = l.trim()
				return t && !t.startsWith('#')
			}).length
			this.schedulePersist()
			return {
				ok: true,
				message: `crontab: installing new crontab (${n} active line${n === 1 ? '' : 's'})`,
			}
		} catch (e) {
			return { ok: false, message: `crontab: install failed: ${String(e)}` }
		}
	}

	getCrontabEditPath(): string {
		ensureCronSpool(this.vfs, this.env.USER || 'user')
		return crontabPath(this.env.USER || 'user')
	}
}

function stringify(v: unknown): string {
	if (typeof v === 'string') return v
	if (v instanceof Error) return v.stack ?? v.message
	try {
		return JSON.stringify(v)
	} catch {
		return String(v)
	}
}

/** Convert a simple shell glob (`*`, `?`) to a RegExp. */
function globToRegExp(glob: string): RegExp {
	let re = '^'
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i]
		if (c === '*') re += '.*'
		else if (c === '?') re += '.'
		else if (/[.+^${}()|[\]\\]/.test(c)) re += '\\' + c
		else re += c
	}
	re += '$'
	return new RegExp(re)
}

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
] as const

/** util-linux-style `cal` (JS implementation for the lab shell). */
function formatCal(args: string[]): string {
	const now = new Date()
	let year = now.getFullYear()
	let month = now.getMonth() + 1 // 1-12
	let wholeYear = false

	const nums = args.filter((a) => a !== '-y' && a !== '--year')
	if (args.includes('-y') || args.includes('--year')) wholeYear = true

	if (nums.length === 1) {
		const n = parseInt(nums[0], 10)
		if (!Number.isFinite(n)) throw new Error(`not a valid year or month: ${nums[0]}`)
		if (n >= 1 && n <= 12 && !wholeYear) {
			// cal 3 → month 3 of current year
			month = n
		} else {
			year = n
			wholeYear = true
		}
	} else if (nums.length >= 2) {
		month = parseInt(nums[0], 10)
		year = parseInt(nums[1], 10)
		if (!(month >= 1 && month <= 12)) throw new Error(`${nums[0]} is neither a month number (1..12) nor a name`)
		if (!Number.isFinite(year) || year < 1 || year > 9999) throw new Error(`not a valid year ${nums[1]}`)
		wholeYear = false
	} else if (wholeYear) {
		// cal -y → current year
	}

	if (wholeYear) {
		const blocks: string[] = []
		for (let m = 1; m <= 12; m++) blocks.push(formatMonth(year, m).trimEnd())
		// 3 months per row
		const rows: string[] = [`${String(year).padStart(33)}\n`]
		for (let r = 0; r < 4; r++) {
			const a = blocks[r * 3].split('\n')
			const b = blocks[r * 3 + 1].split('\n')
			const c = blocks[r * 3 + 2].split('\n')
			const h = Math.max(a.length, b.length, c.length)
			for (let i = 0; i < h; i++) {
				const la = (a[i] ?? '').padEnd(22)
				const lb = (b[i] ?? '').padEnd(22)
				const lc = c[i] ?? ''
				rows.push((la + '  ' + lb + '  ' + lc).trimEnd())
			}
			rows.push('')
		}
		return rows.join('\n').replace(/\n+$/, '\n')
	}

	return formatMonth(year, month)
}

function formatMonth(year: number, month: number): string {
	const title = `${MONTH_NAMES[month - 1]} ${year}`
	const width = 20
	const pad = Math.max(0, Math.floor((width - title.length) / 2))
	const header = ' '.repeat(pad) + title
	const days = 'Su Mo Tu We Th Fr Sa'
	// Day of week for the 1st (0=Sun)
	const first = new Date(year, month - 1, 1).getDay()
	const dim = new Date(year, month, 0).getDate()
	const cells: string[] = []
	for (let i = 0; i < first; i++) cells.push('  ')
	for (let d = 1; d <= dim; d++) cells.push(String(d).padStart(2, ' '))
	const lines: string[] = [header, days]
	for (let i = 0; i < cells.length; i += 7) {
		lines.push(cells.slice(i, i + 7).join(' '))
	}
	return lines.join('\n') + '\n'
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

function dirname(path: string): string {
	const i = path.lastIndexOf('/')
	if (i <= 0) return '/'
	return path.slice(0, i)
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

/**
 * Split a line on `&&`, `||`, `;` outside quotes.
 * Returns segments with the operator that precedes each command.
 */
function splitShellChain(line: string): { cmd: string; op: '&&' | '||' | ';' | null }[] {
	const segs: { cmd: string; op: '&&' | '||' | ';' | null }[] = []
	let cur = ''
	let quote: '"' | "'" | null = null
	let op: '&&' | '||' | ';' | null = null
	const push = () => {
		const c = cur.trim()
		if (c) segs.push({ cmd: c, op })
		cur = ''
	}
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		const n = line[i + 1]
		if (quote) {
			if (c === quote) quote = null
			cur += c
			continue
		}
		if (c === '"' || c === "'") {
			quote = c
			cur += c
			continue
		}
		if (c === '&' && n === '&') {
			push()
			op = '&&'
			i++
			continue
		}
		if (c === '|' && n === '|') {
			push()
			op = '||'
			i++
			continue
		}
		if (c === ';') {
			push()
			op = ';'
			continue
		}
		cur += c
	}
	push()
	// first segment has no preceding op
	if (segs.length) segs[0].op = null
	return segs
}

/**
 * Strip shell stdout redirects from argv.
 * Supports: `> path`, `>> path`, `>path`, `>>path` (last redirect wins).
 */
function parseStdoutRedirect(args: string[]): {
	args: string[]
	redir: { path: string; append: boolean } | null
} {
	const out: string[] = []
	let redir: { path: string; append: boolean } | null = null
	for (let i = 0; i < args.length; i++) {
		const a = args[i]
		if (a === '>>' && args[i + 1] !== undefined) {
			redir = { path: args[++i], append: true }
			continue
		}
		if (a === '>' && args[i + 1] !== undefined) {
			redir = { path: args[++i], append: false }
			continue
		}
		if (a.startsWith('>>') && a.length > 2) {
			redir = { path: a.slice(2), append: true }
			continue
		}
		if (a.startsWith('>') && !a.startsWith('>>') && a.length > 1) {
			redir = { path: a.slice(1), append: false }
			continue
		}
		out.push(a)
	}
	return { args: out, redir }
}

/** Split `cmd1; cmd2` outside quotes. */
function splitBySemicolon(line: string): string[] {
	const parts: string[] = []
	let cur = ''
	let quote: '"' | "'" | null = null
	for (let i = 0; i < line.length; i++) {
		const c = line[i]
		if (quote) {
			if (c === quote) quote = null
			cur += c
			continue
		}
		if (c === '"' || c === "'") {
			quote = c
			cur += c
			continue
		}
		if (c === ';') {
			parts.push(cur)
			cur = ''
			continue
		}
		cur += c
	}
	if (cur.trim()) parts.push(cur)
	return parts
}

declare global {
	interface Navigator {
		userAgentData?: { platform?: string }
	}
}
