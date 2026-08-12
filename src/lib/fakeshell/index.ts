/**
 * Public FakeShell API used by the Termina UI (XtermShell).
 * Internal modules import each other directly — keep this surface small.
 */

export { FakeShell } from './fakeshell'
export type { ConsoleListener } from './fakeshell'
export { completeLine } from './complete'
export type { CompleteResult } from './complete'
export type { ProcessOptions, ProcessResult } from './types'
