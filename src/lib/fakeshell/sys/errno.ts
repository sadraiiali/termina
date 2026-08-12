/** Linux-ish errno values used by the lab syscall layer. */
export const EPERM = 1
export const ENOENT = 2
export const ESRCH = 3
export const EINTR = 4
export const EIO = 5
export const ENXIO = 6
export const E2BIG = 7
export const ENOEXEC = 8
export const EBADF = 9
export const ECHILD = 10
export const EAGAIN = 11
export const ENOMEM = 12
export const EACCES = 13
export const EFAULT = 14
export const EBUSY = 16
export const EEXIST = 17
export const EXDEV = 18
export const ENODEV = 19
export const ENOTDIR = 20
export const EISDIR = 21
export const EINVAL = 22
export const ENFILE = 23
export const EMFILE = 24
export const ENOTTY = 25
export const ETXTBSY = 26
export const EFBIG = 27
export const ENOSPC = 28
export const ESPIPE = 29
export const EROFS = 30
export const EMLINK = 31
export const EPIPE = 32
export const ERANGE = 34
export const ENAMETOOLONG = 36
export const ENOSYS = 38
export const ENOTEMPTY = 39
export const ELOOP = 40
export const EOVERFLOW = 75
export const ENOTSUP = 95

export class SysError extends Error {
	readonly errno: number
	readonly code: string
	constructor(errno: number, code: string, message?: string) {
		super(message ?? code)
		this.errno = errno
		this.code = code
		this.name = 'SysError'
	}
}

export function err(errno: number, code: string, msg?: string): never {
	throw new SysError(errno, code, msg)
}
