/**
 * Fake Linux syscall kernel for FakeShell.
 * Maps open/read/write/stat/… onto almostnode VirtualFS + in-memory process/FD tables.
 */

import type { VirtualFS } from 'almostnode'
import {
	EBADF,
	EEXIST,
	EISDIR,
	EINVAL,
	EIO,
	ENOENT,
	ENOSYS,
	ENOTDIR,
	ENOTEMPTY,
	SysError,
	err,
} from './errno'
import {
	AT_FDCWD,
	AT_REMOVEDIR,
	O_APPEND,
	O_CREAT,
	O_DIRECTORY,
	O_EXCL,
	O_RDONLY,
	O_RDWR,
	O_TRUNC,
	O_WRONLY,
	SEEK_CUR,
	SEEK_END,
	SEEK_SET,
	SYS,
} from './numbers'

export type FdKind = 'file' | 'dir' | 'stdin' | 'stdout' | 'stderr' | 'pipe' | 'sock'

export interface FileDesc {
	fd: number
	kind: FdKind
	path: string
	flags: number
	/** byte offset for files */
	offset: number
	/** pipe / sock buffer (optional) */
	buf?: Uint8Array[]
	/** closed? */
	closed: boolean
}

export interface Proc {
	pid: number
	ppid: number
	uid: number
	gid: number
	cwd: string
	env: Record<string, string>
	fds: Map<number, FileDesc>
	/** argv for WASI */
	argv: string[]
	exitCode: number | null
}

export interface SyscallHost {
	/** Underlying VFS */
	vfs: VirtualFS
	/** Shell / global env (mutated by setenv) */
	env: Record<string, string>
	/** Optional: execute a lab shell command (for execve of known cmds) */
	execLabCommand?: (argv: string[], env: Record<string, string>, cwd: string) => Promise<number>
	/** Logging hook */
	trace?: (msg: string) => void
}

let nextPid = 1000
let nextIno = 10000

function norm(cwd: string, path: string): string {
	if (!path || path === '.') return cwd
	if (path === '~' || path.startsWith('~/')) {
		const rest = path === '~' ? '' : path.slice(2)
		path = rest ? `/home/user/${rest}` : '/home/user'
	}
	const abs = path.startsWith('/') ? path : `${cwd}/${path}`
	const parts = abs.split('/')
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

export class SyscallKernel {
	readonly host: SyscallHost
	private procs = new Map<number, Proc>()
	/** current process for syscall() dispatch */
	private currentPid = 1
	/** last errno for WASI-style callers */
	errno = 0
	/** enable verbose syscall log */
	traceEnabled = false

	constructor(host: SyscallHost) {
		this.host = host
		this.bootstrapInit()
	}

	private log(msg: string): void {
		if (this.traceEnabled) this.host.trace?.(msg)
	}

	private bootstrapInit(): void {
		const p = this.spawnProcess({
			pid: 1,
			ppid: 0,
			cwd: this.host.env.HOME || '/home/user',
			argv: ['/sbin/init'],
			env: { ...this.host.env },
		})
		// fd 3 preopen is set in spawnProcess
		this.currentPid = p.pid
	}

	/** Reset FD tables / pids (on lab reset). */
	reset(): void {
		this.procs.clear()
		nextPid = 1000
		this.bootstrapInit()
	}

	get current(): Proc {
		const p = this.procs.get(this.currentPid)
		if (!p) err(ESRCH_SAFE(), 'ESRCH', 'no current process')
		return p
	}

	setCurrent(pid: number): void {
		if (!this.procs.has(pid)) err(3, 'ESRCH', `pid ${pid}`)
		this.currentPid = pid
	}

	spawnProcess(opts: {
		pid?: number
		ppid?: number
		cwd?: string
		argv?: string[]
		env?: Record<string, string>
	}): Proc {
		const pid = opts.pid ?? nextPid++
		const fds = new Map<number, FileDesc>()
		fds.set(0, {
			fd: 0,
			kind: 'stdin',
			path: '/dev/stdin',
			flags: O_RDONLY,
			offset: 0,
			closed: false,
			buf: [],
		})
		fds.set(1, {
			fd: 1,
			kind: 'stdout',
			path: '/dev/stdout',
			flags: O_WRONLY,
			offset: 0,
			closed: false,
			buf: [],
		})
		fds.set(2, {
			fd: 2,
			kind: 'stderr',
			path: '/dev/stderr',
			flags: O_WRONLY,
			offset: 0,
			closed: false,
			buf: [],
		})
		// WASI preopen root at fd 3
		fds.set(3, {
			fd: 3,
			kind: 'dir',
			path: '/',
			flags: O_RDONLY | O_DIRECTORY,
			offset: 0,
			closed: false,
		})
		const proc: Proc = {
			pid,
			ppid: opts.ppid ?? this.currentPid,
			uid: 1000,
			gid: 1000,
			cwd: opts.cwd ?? this.host.env.HOME ?? '/home/user',
			env: { ...this.host.env, ...(opts.env ?? {}) },
			fds,
			argv: opts.argv ?? [],
			exitCode: null,
		}
		this.procs.set(pid, proc)
		return proc
	}

	/** Resolve path for current process. */
	resolve(path: string, dirfd: number = AT_FDCWD): string {
		const p = this.current
		if (path.startsWith('/')) return norm('/', path)
		if (dirfd === AT_FDCWD || dirfd < 0) return norm(p.cwd, path)
		const fd = p.fds.get(dirfd)
		if (!fd || fd.closed) err(EBADF, 'EBADF', 'bad dirfd')
		if (fd.kind !== 'dir' && fd.kind !== 'file') return norm(p.cwd, path)
		const base = fd.kind === 'dir' ? fd.path : dirname(fd.path)
		return norm(base, path)
	}

	// ─── core syscalls ────────────────────────────────────────────────────

	open(path: string, flags: number, _mode = 0o644, dirfd = AT_FDCWD): number {
		const abs = this.resolve(path, dirfd)
		this.log(`open(${abs}, ${flags.toString(8)})`)
		const vfs = this.host.vfs
		const exists = vfs.existsSync(abs)
		const creat = !!(flags & O_CREAT)
		const excl = !!(flags & O_EXCL)
		const trunc = !!(flags & O_TRUNC)
		const append = !!(flags & O_APPEND)
		const wantDir = !!(flags & O_DIRECTORY)

		if (!exists) {
			if (!creat) err(ENOENT, 'ENOENT', abs)
			if (wantDir) err(ENOTDIR, 'ENOTDIR', abs)
			vfs.writeFileSync(abs, '')
		} else if (creat && excl) {
			err(EEXIST, 'EEXIST', abs)
		}

		let st
		try {
			st = vfs.statSync(abs)
		} catch {
			err(ENOENT, 'ENOENT', abs)
		}
		if (wantDir && !st.isDirectory()) err(ENOTDIR, 'ENOTDIR', abs)
		if (!st.isDirectory() && (flags & O_WRONLY || flags & O_RDWR || trunc)) {
			if (trunc) vfs.writeFileSync(abs, '')
		}
		if (st.isDirectory() && (flags & O_WRONLY || (flags & O_RDWR) === O_RDWR) && !wantDir) {
			// allow open dir O_RDONLY only
			const acc = flags & 3
			if (acc !== O_RDONLY) err(EISDIR, 'EISDIR', abs)
		}

		const p = this.current
		const fdn = this.allocFd(p)
		let offset = 0
		if (append && st.isFile()) offset = st.size
		const kind: FdKind = st.isDirectory() ? 'dir' : 'file'
		p.fds.set(fdn, {
			fd: fdn,
			kind,
			path: abs,
			flags,
			offset,
			closed: false,
		})
		return fdn
	}

	close(fd: number): number {
		const p = this.current
		const f = p.fds.get(fd)
		if (!f || f.closed) err(EBADF, 'EBADF')
		if (fd <= 2) {
			// keep stdio conceptually open but allow re-open
			f.closed = true
			return 0
		}
		p.fds.delete(fd)
		return 0
	}

	read(fd: number, length: number): Uint8Array {
		const f = this.getFd(fd)
		if (f.kind === 'stdin' || f.kind === 'pipe') {
			const chunks = f.buf ?? []
			if (!chunks.length) return new Uint8Array(0)
			const data = chunks.shift()!
			if (data.byteLength > length) {
				chunks.unshift(data.slice(length))
				return data.slice(0, length)
			}
			return data
		}
		if (f.kind === 'dir') err(EISDIR, 'EISDIR', f.path)
		if (f.kind !== 'file') err(EBADF, 'EBADF')
		const acc = f.flags & 3
		if (acc === O_WRONLY) err(EBADF, 'EBADF', 'not open for read')
		let data: Uint8Array
		try {
			data = toU8(this.host.vfs.readFileSync(f.path))
		} catch {
			err(EIO, 'EIO', f.path)
		}
		const start = f.offset
		const end = Math.min(data.byteLength, start + length)
		const slice = data.slice(start, end)
		f.offset = end
		return slice
	}

	/** Read entire file via open/read/close (UTF-8 string). */
	readFileText(path: string): string {
		return new TextDecoder().decode(this.readFileBytes(path))
	}

	/** Read entire file via open/read/close (raw bytes). */
	readFileBytes(path: string): Uint8Array {
		const fd = this.open(path, O_RDONLY)
		try {
			const chunks: Uint8Array[] = []
			for (;;) {
				const part = this.read(fd, 65536)
				if (!part.byteLength) break
				chunks.push(part)
			}
			return concatU8(chunks)
		} finally {
			this.close(fd)
		}
	}

	/** Write entire file via open/write/close. */
	writeFileText(path: string, content: string, flags = O_WRONLY | O_CREAT | O_TRUNC): number {
		const fd = this.open(path, flags)
		try {
			return this.write(fd, content)
		} finally {
			this.close(fd)
		}
	}

	write(fd: number, data: Uint8Array | string): number {
		const f = this.getFd(fd)
		const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
		if (f.kind === 'stdout' || f.kind === 'stderr') {
			if (!f.buf) f.buf = []
			f.buf.push(bytes.slice())
			return bytes.byteLength
		}
		if (f.kind === 'stdin' || f.kind === 'pipe') {
			if (!f.buf) f.buf = []
			f.buf.push(bytes.slice())
			return bytes.byteLength
		}
		if (f.kind !== 'file') err(EBADF, 'EBADF')
		const acc = f.flags & 3
		if (acc === O_RDONLY) err(EBADF, 'EBADF', 'not open for write')
		let existing = new Uint8Array(0)
		try {
			if (this.host.vfs.existsSync(f.path) && !(f.flags & O_TRUNC && f.offset === 0)) {
				const raw = toU8(this.host.vfs.readFileSync(f.path))
				existing = new Uint8Array(raw.byteLength)
				existing.set(raw)
			}
		} catch {
			/* empty */
		}
		let offset = f.offset
		if (f.flags & O_APPEND) offset = existing.byteLength
		const need = offset + bytes.byteLength
		const out = new Uint8Array(Math.max(existing.byteLength, need))
		out.set(existing, 0)
		out.set(bytes, offset)
		this.host.vfs.writeFileSync(f.path, out)
		f.offset = offset + bytes.byteLength
		return bytes.byteLength
	}

	/** Drain stdout/stderr buffers (for capturing process output). */
	drain(fd: number): string {
		const f = this.current.fds.get(fd)
		if (!f?.buf?.length) return ''
		const dec = new TextDecoder()
		const s = f.buf.map((b) => dec.decode(b)).join('')
		f.buf = []
		return s
	}

	lseek(fd: number, offset: number, whence: number): number {
		const f = this.getFd(fd)
		if (f.kind !== 'file') err(EBADF, 'EBADF')
		let base = 0
		if (whence === SEEK_SET) base = 0
		else if (whence === SEEK_CUR) base = f.offset
		else if (whence === SEEK_END) {
			const st = this.host.vfs.statSync(f.path)
			base = st.size
		} else err(EINVAL, 'EINVAL')
		const next = base + offset
		if (next < 0) err(EINVAL, 'EINVAL')
		f.offset = next
		return next
	}

	stat(path: string, dirfd = AT_FDCWD) {
		const abs = this.resolve(path, dirfd)
		try {
			const st = this.host.vfs.statSync(abs)
			return {
				dev: st.dev,
				ino: st.ino || nextIno++,
				mode: st.mode || (st.isDirectory() ? 0o040755 : 0o100644),
				nlink: st.nlink,
				uid: st.uid,
				gid: st.gid,
				size: st.size,
				blksize: st.blksize,
				blocks: st.blocks,
				atime: st.atimeMs,
				mtime: st.mtimeMs,
				ctime: st.ctimeMs,
				isFile: st.isFile(),
				isDirectory: st.isDirectory(),
				path: abs,
			}
		} catch {
			err(ENOENT, 'ENOENT', abs)
		}
	}

	fstat(fd: number) {
		const f = this.getFd(fd)
		if (f.kind === 'stdin' || f.kind === 'stdout' || f.kind === 'stderr') {
			return {
				dev: 0,
				ino: fd,
				mode: 0o020666,
				nlink: 1,
				uid: 0,
				gid: 0,
				size: 0,
				blksize: 4096,
				blocks: 0,
				atime: Date.now(),
				mtime: Date.now(),
				ctime: Date.now(),
				isFile: false,
				isDirectory: false,
				path: f.path,
			}
		}
		return this.stat(f.path)
	}

	access(path: string, _mode = 0, dirfd = AT_FDCWD): number {
		const abs = this.resolve(path, dirfd)
		if (!this.host.vfs.existsSync(abs)) err(ENOENT, 'ENOENT', abs)
		return 0
	}

	getcwd(): string {
		return this.current.cwd
	}

	chdir(path: string): number {
		const abs = this.resolve(path)
		try {
			const st = this.host.vfs.statSync(abs)
			if (!st.isDirectory()) err(ENOTDIR, 'ENOTDIR', abs)
		} catch (e) {
			if (e instanceof SysError) throw e
			err(ENOENT, 'ENOENT', abs)
		}
		this.current.cwd = abs
		return 0
	}

	mkdir(path: string, _mode = 0o755, dirfd = AT_FDCWD): number {
		const abs = this.resolve(path, dirfd)
		try {
			if (this.host.vfs.existsSync(abs)) err(EEXIST, 'EEXIST', abs)
			this.host.vfs.mkdirSync(abs, { recursive: true })
		} catch (e) {
			if (e instanceof SysError) throw e
			err(EIO, 'EIO', abs)
		}
		return 0
	}

	rmdir(path: string, dirfd = AT_FDCWD): number {
		const abs = this.resolve(path, dirfd)
		try {
			this.host.vfs.rmdirSync(abs)
		} catch (e) {
			const msg = String(e)
			if (msg.includes('ENOTEMPTY') || msg.includes('not empty')) err(ENOTEMPTY, 'ENOTEMPTY', abs)
			if (msg.includes('ENOENT')) err(ENOENT, 'ENOENT', abs)
			err(EIO, 'EIO', abs)
		}
		return 0
	}

	unlink(path: string, dirfd = AT_FDCWD, flags = 0): number {
		const abs = this.resolve(path, dirfd)
		try {
			const st = this.host.vfs.statSync(abs)
			if (st.isDirectory()) {
				if (flags & AT_REMOVEDIR) return this.rmdir(abs)
				err(EISDIR, 'EISDIR', abs)
			}
			this.host.vfs.unlinkSync(abs)
		} catch (e) {
			if (e instanceof SysError) throw e
			err(ENOENT, 'ENOENT', abs)
		}
		return 0
	}

	rename(oldp: string, newp: string, olddirfd = AT_FDCWD, newdirfd = AT_FDCWD): number {
		const a = this.resolve(oldp, olddirfd)
		const b = this.resolve(newp, newdirfd)
		try {
			this.host.vfs.renameSync(a, b)
		} catch {
			// fallback copy+unlink
			try {
				const data = this.host.vfs.readFileSync(a)
				this.host.vfs.writeFileSync(b, data)
				this.host.vfs.unlinkSync(a)
			} catch {
				err(ENOENT, 'ENOENT', a)
			}
		}
		return 0
	}

	readdir(path: string, dirfd = AT_FDCWD): string[] {
		const abs = this.resolve(path, dirfd)
		try {
			return this.host.vfs.readdirSync(abs)
		} catch {
			err(ENOENT, 'ENOENT', abs)
		}
	}

	getpid(): number {
		return this.current.pid
	}
	getppid(): number {
		return this.current.ppid
	}
	getuid(): number {
		return this.current.uid
	}
	getgid(): number {
		return this.current.gid
	}

	uname() {
		return {
			sysname: 'FakeShell',
			nodename: this.host.env.HOSTNAME || 'fakeshell-lab',
			release: '0.1.0-lab',
			version: '#1 SMP browser syscall-shim',
			machine: 'wasm32',
			domainname: '(none)',
		}
	}

	writev_stdout(bufs: Uint8Array[]): number {
		let n = 0
		for (const b of bufs) n += this.write(1, b)
		return n
	}

	/** pipe(2): returns [readFd, writeFd] */
	pipe(): [number, number] {
		const p = this.current
		// share buffer array between ends
		const buf: Uint8Array[] = []
		// allocate + register immediately so the second allocFd differs
		const r = this.allocFd(p)
		p.fds.set(r, {
			fd: r,
			kind: 'pipe',
			path: `pipe:[${r}]`,
			flags: O_RDONLY,
			offset: 0,
			closed: false,
			buf,
		})
		const w = this.allocFd(p)
		p.fds.set(w, {
			fd: w,
			kind: 'pipe',
			path: `pipe:[${w}]`,
			flags: O_WRONLY,
			offset: 0,
			closed: false,
			buf,
		})
		return [r, w]
	}

	dup(fd: number): number {
		const f = this.getFd(fd)
		const p = this.current
		const n = this.allocFd(p)
		p.fds.set(n, { ...f, fd: n, buf: f.buf })
		return n
	}

	dup2(oldfd: number, newfd: number): number {
		const f = this.getFd(oldfd)
		const p = this.current
		if (oldfd === newfd) return newfd
		const existing = p.fds.get(newfd)
		if (existing && !existing.closed && newfd > 2) p.fds.delete(newfd)
		p.fds.set(newfd, { ...f, fd: newfd, buf: f.buf, closed: false })
		return newfd
	}

	/**
	 * Linux-style numeric syscall dispatcher.
	 * String paths cannot go through registers — use syscallNamed / methods for those.
	 * Returns non-negative result, or -errno on failure.
	 */
	syscall(nr: number, a0: number = 0, a1: number = 0, a2: number = 0, _a3: number = 0): number {
		try {
			this.errno = 0
			switch (nr) {
				case SYS.getpid:
					return this.getpid()
				case SYS.getppid:
					return this.getppid()
				case SYS.getuid:
				case SYS.geteuid:
					return this.getuid()
				case SYS.getgid:
				case SYS.getegid:
					return this.getgid()
				case SYS.gettid:
					return this.getpid()
				case SYS.close:
					return this.close(a0)
				case SYS.lseek:
					return this.lseek(a0, a1, a2)
				case SYS.dup:
					return this.dup(a0)
				case SYS.dup2:
					return this.dup2(a0, a1)
				case SYS.dup3:
					return this.dup2(a0, a1)
				case SYS.exit:
				case SYS.exit_group:
					this.current.exitCode = a0
					return 0
				case SYS.getcwd:
					return this.getcwd().length
				case SYS.sched_yield:
					return 0
				case SYS.brk:
					return a0
				case SYS.fsync:
				case SYS.ioctl:
					return 0
				case SYS.umask:
					return 0o022
				case SYS.getrandom:
					return a1 // pretend filled a1 bytes
				case SYS.clock_gettime:
				case SYS.gettimeofday:
					return 0
				case SYS.nanosleep:
					return 0
				default:
					err(ENOSYS, 'ENOSYS', `syscall ${nr}`)
			}
		} catch (e) {
			if (e instanceof SysError) {
				this.errno = e.errno
				return -e.errno
			}
			this.errno = EIO
			return -EIO
		}
	}

	/**
	 * Named syscall API for TS tools (paths as strings).
	 * Prefer this over numeric syscall() from lab command code.
	 */
	syscallNamed(name: string, ...args: unknown[]): number {
		try {
			this.errno = 0
			switch (name) {
				case 'open':
				case 'openat':
					return this.open(
						String(args[0]),
						Number(args[1] ?? 0),
						Number(args[2] ?? 0o644),
						args[3] !== undefined ? Number(args[3]) : AT_FDCWD,
					)
				case 'close':
					return this.close(Number(args[0]))
				case 'read': {
					const data = this.read(Number(args[0]), Number(args[1] ?? 4096))
					// optional out-bag: third arg object { buf }
					const bag = args[2] as { buf?: Uint8Array } | undefined
					if (bag && typeof bag === 'object') bag.buf = data
					return data.byteLength
				}
				case 'write':
					return this.write(Number(args[0]), args[1] as Uint8Array | string)
				case 'lseek':
					return this.lseek(Number(args[0]), Number(args[1]), Number(args[2] ?? 0))
				case 'chdir':
					return this.chdir(String(args[0]))
				case 'getcwd':
					return 0
				case 'mkdir':
				case 'mkdirat':
					return this.mkdir(String(args[0]), Number(args[1] ?? 0o755))
				case 'rmdir':
					return this.rmdir(String(args[0]))
				case 'unlink':
				case 'unlinkat':
					return this.unlink(String(args[0]))
				case 'rename':
				case 'renameat':
					return this.rename(String(args[0]), String(args[1]))
				case 'access':
				case 'faccessat':
					return this.access(String(args[0]), Number(args[1] ?? 0))
				case 'stat':
				case 'lstat':
				case 'newfstatat':
					this.stat(String(args[0]))
					return 0
				case 'fstat':
					this.fstat(Number(args[0]))
					return 0
				case 'getpid':
					return this.getpid()
				case 'getppid':
					return this.getppid()
				case 'getuid':
					return this.getuid()
				case 'getgid':
					return this.getgid()
				case 'dup':
					return this.dup(Number(args[0]))
				case 'dup2':
					return this.dup2(Number(args[0]), Number(args[1]))
				case 'pipe':
				case 'pipe2': {
					const ends = this.pipe()
					const bag = args[0] as { r?: number; w?: number } | undefined
					if (bag && typeof bag === 'object') {
						bag.r = ends[0]
						bag.w = ends[1]
					}
					return 0
				}
				case 'exit':
				case 'exit_group':
					this.current.exitCode = Number(args[0] ?? 0)
					return 0
				default:
					err(ENOSYS, 'ENOSYS', name)
			}
		} catch (e) {
			if (e instanceof SysError) {
				this.errno = e.errno
				return -e.errno
			}
			this.errno = EIO
			return -EIO
		}
	}

	/** List implemented named syscalls (for `sys help`). */
	listNamedSyscalls(): string[] {
		return [
			'open',
			'openat',
			'close',
			'read',
			'write',
			'lseek',
			'chdir',
			'getcwd',
			'mkdir',
			'mkdirat',
			'rmdir',
			'unlink',
			'unlinkat',
			'rename',
			'renameat',
			'access',
			'faccessat',
			'stat',
			'lstat',
			'fstat',
			'newfstatat',
			'getpid',
			'getppid',
			'getuid',
			'getgid',
			'dup',
			'dup2',
			'pipe',
			'pipe2',
			'exit',
			'exit_group',
			'readdir',
			'uname',
		]
	}

	private getFd(fd: number): FileDesc {
		const f = this.current.fds.get(fd)
		if (!f || f.closed) err(EBADF, 'EBADF', `fd ${fd}`)
		return f
	}

	private allocFd(p: Proc): number {
		// 0–2 stdio, 3 often preopen root — allocate from 4 upward
		let n = 4
		while (p.fds.has(n)) n++
		return n
	}
}

function dirname(path: string): string {
	const i = path.lastIndexOf('/')
	if (i <= 0) return '/'
	return path.slice(0, i)
}

function ESRCH_SAFE(): number {
	return 3
}

function toU8(data: unknown): Uint8Array {
	if (data instanceof Uint8Array) return data
	if (typeof data === 'string') return new TextEncoder().encode(data)
	if (data && typeof data === 'object' && ArrayBuffer.isView(data)) {
		const v = data as ArrayBufferView
		return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
	}
	return new Uint8Array(0)
}

function concatU8(parts: Uint8Array[]): Uint8Array {
	let n = 0
	for (const p of parts) n += p.byteLength
	const out = new Uint8Array(n)
	let o = 0
	for (const p of parts) {
		out.set(p, o)
		o += p.byteLength
	}
	return out
}

