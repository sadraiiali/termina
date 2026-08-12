/**
 * FakeShell fake Linux / WASI syscall layer.
 *
 * All file and process operations for lab tools and future WASM modules
 * should go through SyscallKernel so the host is a single fake OS ABI.
 */

export { SyscallKernel } from './kernel'
export type { SyscallHost, FileDesc, Proc, FdKind } from './kernel'
export { createWasiPreview1, runWasiModule, WasiExit } from './wasi'
export { listWasiPilots, getWasiPilot, buildMinimalWasiHello } from './wasi-pilots'
export type { WasiPilot, WasiPilotId } from './wasi-pilots'
export { SYS, O_RDONLY, O_WRONLY, O_CREAT, O_TRUNC, O_APPEND, O_DIRECTORY } from './numbers'
export { SysError, ENOENT, EBADF, ENOSYS, EINVAL } from './errno'

import type { VirtualFS } from 'almostnode'
import { SyscallKernel, type SyscallHost } from './kernel'

/** Create a syscall kernel bound to a VFS + env. */
export function createSyscallHost(
	vfs: VirtualFS,
	env: Record<string, string>,
	opts?: Partial<SyscallHost>,
): SyscallKernel {
	const host: SyscallHost = {
		vfs,
		env,
		trace: opts?.trace,
		execLabCommand: opts?.execLabCommand,
	}
	return new SyscallKernel(host)
}
