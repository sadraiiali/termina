/**
 * WASI preview1 import object backed by SyscallKernel.
 * Lets future WASM modules (compiled coreutils, etc.) call into the lab VFS.
 *
 * Spec: https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md
 */

import type { SyscallKernel } from './kernel'
import { O_CREAT, O_DIRECTORY, O_EXCL, O_RDONLY, O_RDWR, O_TRUNC, O_WRONLY } from './numbers'
import { SysError } from './errno'

/** WASI errno */
const WasiErrno = {
	SUCCESS: 0,
	BADF: 8,
	EXIST: 20,
	INVAL: 28,
	IO: 29,
	ISDIR: 31,
	NOENT: 44,
	NOTDIR: 54,
	NOSYS: 52,
	NOTCAPABLE: 76,
	PERM: 63,
} as const

function mapErr(e: unknown): number {
	if (e instanceof SysError) {
		switch (e.code) {
			case 'ENOENT':
				return WasiErrno.NOENT
			case 'EBADF':
				return WasiErrno.BADF
			case 'EEXIST':
				return WasiErrno.EXIST
			case 'EISDIR':
				return WasiErrno.ISDIR
			case 'ENOTDIR':
				return WasiErrno.NOTDIR
			case 'EINVAL':
				return WasiErrno.INVAL
			case 'EPERM':
			case 'EACCES':
				return WasiErrno.PERM
			case 'ENOSYS':
				return WasiErrno.NOSYS
			default:
				return WasiErrno.IO
		}
	}
	return WasiErrno.IO
}

function readIov(
	view: DataView,
	iovPtr: number,
	iovLen: number,
): { bufPtr: number; bufLen: number }[] {
	const out: { bufPtr: number; bufLen: number }[] = []
	for (let i = 0; i < iovLen; i++) {
		const base = iovPtr + i * 8
		out.push({ bufPtr: view.getUint32(base, true), bufLen: view.getUint32(base + 4, true) })
	}
	return out
}

/**
 * Build `{ wasi_snapshot_preview1: { ... } }` for WebAssembly.instantiate.
 */
export function createWasiPreview1(
	sys: SyscallKernel,
	options?: {
		args?: string[]
		env?: Record<string, string>
		memory?: () => WebAssembly.Memory
	},
): { wasi_snapshot_preview1: Record<string, Function> } {
	let memory: WebAssembly.Memory | null = null
	const getMem = () => {
		if (options?.memory) return options.memory()
		if (!memory) throw new Error('WASI memory not set — call setMemory() after instantiate')
		return memory
	}
	const view = () => new DataView(getMem().buffer)
	const u8 = () => new Uint8Array(getMem().buffer)

	const args = options?.args ?? (sys.current.argv.length ? sys.current.argv : ['wasm'])
	const envObj = options?.env ?? sys.current.env
	const envList = Object.entries(envObj).map(([k, v]) => `${k}=${v}`)

	const api: Record<string, Function> = {
		/** Must be called after module instantiate if memory is exported */
		__setMemory(m: WebAssembly.Memory) {
			memory = m
		},

		args_sizes_get(argcPtr: number, argvBufSizePtr: number): number {
			try {
				const v = view()
				v.setUint32(argcPtr, args.length, true)
				let sz = 0
				for (const a of args) sz += a.length + 1
				v.setUint32(argvBufSizePtr, sz, true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		args_get(argvPtr: number, argvBufPtr: number): number {
			try {
				const v = view()
				const bytes = u8()
				let buf = argvBufPtr
				for (let i = 0; i < args.length; i++) {
					v.setUint32(argvPtr + i * 4, buf, true)
					const enc = new TextEncoder().encode(args[i] + '\0')
					bytes.set(enc, buf)
					buf += enc.length
				}
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		environ_sizes_get(environCountPtr: number, environBufSizePtr: number): number {
			try {
				const v = view()
				v.setUint32(environCountPtr, envList.length, true)
				let sz = 0
				for (const e of envList) sz += e.length + 1
				v.setUint32(environBufSizePtr, sz, true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		environ_get(environPtr: number, environBufPtr: number): number {
			try {
				const v = view()
				const bytes = u8()
				let buf = environBufPtr
				for (let i = 0; i < envList.length; i++) {
					v.setUint32(environPtr + i * 4, buf, true)
					const enc = new TextEncoder().encode(envList[i] + '\0')
					bytes.set(enc, buf)
					buf += enc.length
				}
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		clock_time_get(_id: number, _precision: bigint, timePtr: number): number {
			try {
				const ns = BigInt(Date.now()) * 1_000_000n
				const v = view()
				// little-endian u64
				v.setUint32(timePtr, Number(ns & 0xffffffffn), true)
				v.setUint32(timePtr + 4, Number((ns >> 32n) & 0xffffffffn), true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		random_get(bufPtr: number, bufLen: number): number {
			try {
				const bytes = u8()
				for (let i = 0; i < bufLen; i++) bytes[bufPtr + i] = (Math.random() * 256) | 0
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
			try {
				const v = view()
				const bytes = u8()
				const iovs = readIov(v, iovsPtr, iovsLen)
				let total = 0
				for (const iov of iovs) {
					const chunk = bytes.subarray(iov.bufPtr, iov.bufPtr + iov.bufLen)
					total += sys.write(fd, chunk)
				}
				v.setUint32(nwrittenPtr, total, true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number): number {
			try {
				const v = view()
				const bytes = u8()
				const iovs = readIov(v, iovsPtr, iovsLen)
				let total = 0
				for (const iov of iovs) {
					const data = sys.read(fd, iov.bufLen)
					bytes.set(data, iov.bufPtr)
					total += data.byteLength
					if (data.byteLength < iov.bufLen) break
				}
				v.setUint32(nreadPtr, total, true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		fd_close(fd: number): number {
			try {
				sys.close(fd)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		fd_seek(fd: number, offset: bigint, whence: number, newOffsetPtr: number): number {
			try {
				// WASI whence: 0 set, 1 cur, 2 end — same as Linux
				const off = Number(offset)
				const pos = sys.lseek(fd, off, whence)
				const v = view()
				const b = BigInt(pos)
				v.setUint32(newOffsetPtr, Number(b & 0xffffffffn), true)
				v.setUint32(newOffsetPtr + 4, Number((b >> 32n) & 0xffffffffn), true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		fd_fdstat_get(fd: number, statPtr: number): number {
			try {
				sys.fstat(fd) // validate
				const v = view()
				// fs_filetype at 0: 2=dir 4=regular_file 1=character
				const st = sys.fstat(fd)
				let ft = 4
				if (st.isDirectory) ft = 3
				if (fd <= 2) ft = 2 // character device-ish
				v.setUint8(statPtr, ft)
				// fs_flags u16
				v.setUint16(statPtr + 2, 0, true)
				// fs_rights_base u64 — all
				v.setUint32(statPtr + 8, 0xffffffff, true)
				v.setUint32(statPtr + 12, 0xffffffff, true)
				v.setUint32(statPtr + 16, 0xffffffff, true)
				v.setUint32(statPtr + 20, 0xffffffff, true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		path_open(
			dirfd: number,
			_dirflags: number,
			pathPtr: number,
			pathLen: number,
			oflags: number,
			_fsRightsBase: bigint,
			_fsRightsInheriting: bigint,
			fdflags: number,
			fdPtr: number,
		): number {
			try {
				const bytes = u8()
				const path = new TextDecoder().decode(bytes.subarray(pathPtr, pathPtr + pathLen))
				// WASI oflags: CREAT=1, DIRECTORY=2, EXCL=4, TRUNC=8
				// Default open is read-only (cat pilot); upgrade to RDWR when creating/truncating
				let flags = O_RDONLY
				if (oflags & 1) flags = O_RDWR | O_CREAT
				if (oflags & 2) flags |= O_DIRECTORY
				if (oflags & 4) flags |= O_EXCL
				if (oflags & 8) flags = (flags & ~3) | O_RDWR | O_TRUNC
				void fdflags
				// dirfd 3 is preopen "/" — keep as dirfd so resolve uses that base
				const dfd = dirfd === -100 ? -100 : dirfd
				const fd = sys.open(path, flags, 0o644, dfd)
				view().setUint32(fdPtr, fd, true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		path_create_directory(dirfd: number, pathPtr: number, pathLen: number): number {
			try {
				const path = new TextDecoder().decode(u8().subarray(pathPtr, pathPtr + pathLen))
				sys.mkdir(path, 0o755, dirfd === 3 ? -100 : dirfd)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		path_unlink_file(dirfd: number, pathPtr: number, pathLen: number): number {
			try {
				const path = new TextDecoder().decode(u8().subarray(pathPtr, pathPtr + pathLen))
				sys.unlink(path, dirfd === 3 ? -100 : dirfd)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		path_remove_directory(dirfd: number, pathPtr: number, pathLen: number): number {
			try {
				const path = new TextDecoder().decode(u8().subarray(pathPtr, pathPtr + pathLen))
				sys.rmdir(path, dirfd === 3 ? -100 : dirfd)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		path_filestat_get(
			dirfd: number,
			_flags: number,
			pathPtr: number,
			pathLen: number,
			bufPtr: number,
		): number {
			try {
				const path = new TextDecoder().decode(u8().subarray(pathPtr, pathPtr + pathLen))
				const st = sys.stat(path, dirfd === 3 ? -100 : dirfd)
				const v = view()
				// minimal filestat: zero + size at offset 32
				for (let i = 0; i < 64; i++) v.setUint8(bufPtr + i, 0)
				v.setUint32(bufPtr + 32, st.size >>> 0, true)
				v.setUint32(bufPtr + 36, 0, true)
				// filetype at 16?
				v.setUint8(bufPtr + 16, st.isDirectory ? 3 : 4)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},

		fd_prestat_get(fd: number, bufPtr: number): number {
			// preopen: fd 3 = root /
			if (fd !== 3) return WasiErrno.BADF
			const v = view()
			v.setUint8(bufPtr, 0) // prestat dir
			v.setUint32(bufPtr + 4, 1, true) // name len "/"
			return WasiErrno.SUCCESS
		},

		fd_prestat_dir_name(fd: number, pathPtr: number, pathLen: number): number {
			if (fd !== 3) return WasiErrno.BADF
			const name = '/'
			const enc = new TextEncoder().encode(name)
			if (pathLen < enc.length) return WasiErrno.INVAL
			u8().set(enc, pathPtr)
			return WasiErrno.SUCCESS
		},

		proc_exit(code: number): void {
			sys.current.exitCode = code
			// WASI expects trap; throw
			throw new WasiExit(code)
		},

		// Stubs that return SUCCESS / NOSYS so modules don't crash immediately
		sched_yield: () => WasiErrno.SUCCESS,
		poll_oneoff: () => WasiErrno.NOSYS,
		fd_advise: () => WasiErrno.SUCCESS,
		fd_allocate: () => WasiErrno.NOSYS,
		fd_datasync: () => WasiErrno.SUCCESS,
		fd_sync: () => WasiErrno.SUCCESS,
		fd_fdstat_set_flags: () => WasiErrno.SUCCESS,
		fd_filestat_get: (fd: number, bufPtr: number) => {
			try {
				const st = sys.fstat(fd)
				const v = view()
				for (let i = 0; i < 64; i++) v.setUint8(bufPtr + i, 0)
				v.setUint32(bufPtr + 32, st.size >>> 0, true)
				v.setUint8(bufPtr + 16, st.isDirectory ? 3 : 4)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},
		fd_filestat_set_size: () => WasiErrno.SUCCESS,
		fd_filestat_set_times: () => WasiErrno.SUCCESS,
		fd_readdir: () => WasiErrno.NOSYS,
		fd_renumber: () => WasiErrno.NOSYS,
		fd_tell: (fd: number, offsetPtr: number) => {
			try {
				const f = sys.current.fds.get(fd)
				if (!f) return WasiErrno.BADF
				const v = view()
				const b = BigInt(f.offset)
				v.setUint32(offsetPtr, Number(b & 0xffffffffn), true)
				v.setUint32(offsetPtr + 4, Number((b >> 32n) & 0xffffffffn), true)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},
		path_filestat_set_times: () => WasiErrno.SUCCESS,
		path_link: () => WasiErrno.NOSYS,
		path_readlink: () => WasiErrno.INVAL,
		path_rename: (oldFd: number, oldPtr: number, oldLen: number, newFd: number, newPtr: number, newLen: number) => {
			try {
				const o = new TextDecoder().decode(u8().subarray(oldPtr, oldPtr + oldLen))
				const n = new TextDecoder().decode(u8().subarray(newPtr, newPtr + newLen))
				sys.rename(o, n, oldFd === 3 ? -100 : oldFd, newFd === 3 ? -100 : newFd)
				return WasiErrno.SUCCESS
			} catch (e) {
				return mapErr(e)
			}
		},
		path_symlink: () => WasiErrno.NOSYS,
		sock_accept: () => WasiErrno.NOSYS,
		sock_recv: () => WasiErrno.NOSYS,
		sock_send: () => WasiErrno.NOSYS,
		sock_shutdown: () => WasiErrno.NOSYS,
	}

	// Preopen root as fd 3
	try {
		const p = sys.current
		if (!p.fds.has(3)) {
			p.fds.set(3, {
				fd: 3,
				kind: 'dir',
				path: '/',
				flags: O_RDONLY | O_DIRECTORY,
				offset: 0,
				closed: false,
			})
		}
	} catch {
		/* ignore */
	}

	return { wasi_snapshot_preview1: api }
}

export class WasiExit extends Error {
	readonly code: number
	constructor(code: number) {
		super(`WASI exit ${code}`)
		this.code = code
		this.name = 'WasiExit'
	}
}

/**
 * Instantiate a WASI WASM module against the lab kernel.
 */
export async function runWasiModule(
	sys: SyscallKernel,
	wasmBytes: BufferSource | Uint8Array,
	args: string[] = ['wasm'],
): Promise<{ exitCode: number; stdout: string; stderr: string; pid: number }> {
	const proc = sys.spawnProcess({ argv: args, env: { ...sys.host.env } })
	sys.setCurrent(proc.pid)

	const wasi = createWasiPreview1(sys, { args, env: proc.env })
	const bytes =
		wasmBytes instanceof Uint8Array
			? wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength)
			: wasmBytes
	const result = await WebAssembly.instantiate(bytes as BufferSource, wasi)
	const exp = result.instance.exports as {
		memory?: WebAssembly.Memory
		_start?: () => void
	}
	if (exp.memory) {
		const setMem = (
			wasi.wasi_snapshot_preview1 as { __setMemory?: (m: WebAssembly.Memory) => void }
		).__setMemory
		setMem?.(exp.memory)
	}
	let exitCode = 0
	try {
		if (typeof exp._start === 'function') exp._start()
	} catch (e) {
		if (e instanceof WasiExit) exitCode = e.code
		else throw e
	}
	const stdout = sys.drain(1)
	const stderr = sys.drain(2)
	const code = proc.exitCode ?? exitCode
	// leave process table entry; caller restores setCurrent
	return { exitCode: code, stdout, stderr, pid: proc.pid }
}
