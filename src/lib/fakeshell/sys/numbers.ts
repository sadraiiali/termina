/**
 * Subset of Linux x86_64 syscall numbers (for documentation + dispatch).
 * Not all are implemented; unimplemented return -ENOSYS.
 */
export const SYS = {
	read: 0,
	write: 1,
	open: 2,
	close: 3,
	stat: 4,
	fstat: 5,
	lstat: 6,
	poll: 7,
	lseek: 8,
	mmap: 9,
	mprotect: 10,
	munmap: 11,
	brk: 12,
	rt_sigaction: 13,
	rt_sigprocmask: 14,
	ioctl: 16,
	pread64: 17,
	pwrite64: 18,
	access: 21,
	pipe: 22,
	select: 23,
	sched_yield: 24,
	mremap: 25,
	dup: 32,
	dup2: 33,
	nanosleep: 35,
	getpid: 39,
	socket: 41,
	connect: 42,
	accept: 43,
	sendto: 44,
	recvfrom: 45,
	bind: 49,
	listen: 50,
	getsockname: 51,
	clone: 56,
	fork: 57,
	vfork: 58,
	execve: 59,
	exit: 60,
	wait4: 61,
	kill: 62,
	uname: 63,
	fcntl: 72,
	fsync: 74,
	ftruncate: 77,
	getcwd: 79,
	chdir: 80,
	fchdir: 81,
	rename: 82,
	mkdir: 83,
	rmdir: 84,
	link: 86,
	unlink: 87,
	readlink: 89,
	chmod: 90,
	fchmod: 91,
	chown: 92,
	umask: 95,
	gettimeofday: 96,
	getrlimit: 97,
	getuid: 102,
	getgid: 104,
	geteuid: 107,
	getegid: 108,
	getppid: 110,
	getpgrp: 111,
	setsid: 112,
	rt_sigsuspend: 130,
	sigaltstack: 131,
	utime: 132,
	statfs: 137,
	fstatfs: 138,
	arch_prctl: 158,
	gettid: 186,
	tkill: 200,
	futex: 202,
	sched_getaffinity: 204,
	set_tid_address: 218,
	clock_gettime: 228,
	exit_group: 231,
	openat: 257,
	mkdirat: 258,
	newfstatat: 262,
	unlinkat: 263,
	renameat: 264,
	linkat: 265,
	readlinkat: 267,
	fchmodat: 268,
	faccessat: 269,
	pselect6: 270,
	ppoll: 271,
	utimensat: 280,
	dup3: 292,
	pipe2: 293,
	prlimit64: 302,
	getrandom: 318,
	statx: 332,
	clone3: 435,
} as const

export type SysNr = (typeof SYS)[keyof typeof SYS]

/** open(2) flags (subset) */
export const O_RDONLY = 0
export const O_WRONLY = 1
export const O_RDWR = 2
export const O_CREAT = 0o100
export const O_EXCL = 0o200
export const O_TRUNC = 0o1000
export const O_APPEND = 0o2000
export const O_DIRECTORY = 0o200000
export const O_CLOEXEC = 0o2000000

export const SEEK_SET = 0
export const SEEK_CUR = 1
export const SEEK_END = 2

export const AT_FDCWD = -100
export const AT_REMOVEDIR = 0x200
