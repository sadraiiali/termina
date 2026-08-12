/** Kernel process / shell command result */
export interface ProcessResult {
	stdout: string
	stderr: string
	exitCode: number
}

export interface ProcessOptions {
	cwd?: string
	onStdout?: (chunk: string) => void
	onStderr?: (chunk: string) => void
	signal?: AbortSignal
	/** Do not push this line into interactive history (script lines). */
	noHistory?: boolean
	/** Expand $vars before parsing (default true). */
	expandVars?: boolean
	/** Internal: skip re-splitting && / || / ; chains. */
	noChain?: boolean
}

export interface KernelInfo {
	name: string
	version: string
	runtime: string
	platform: string
	arch: string
}

export interface FileTreeNode {
	name: string
	path: string
	type: 'file' | 'directory'
	children?: FileTreeNode[]
}
