/**
 * Terminal colors for the setup CLI, the subset of picocolors it used. Plain text when `NO_COLOR` is set,
 * or when stdout is not a terminal and `FORCE_COLOR` is not set.
 */

const enabled =
	!("NO_COLOR" in process.env) && ("FORCE_COLOR" in process.env || process.stdout.isTTY === true)

const style =
	(open: number, close: number) =>
	(text: string | number): string =>
		enabled ? `\x1b[${open}m${text}\x1b[${close}m` : String(text)

export const pc = {
	bold: style(1, 22),
	dim: style(2, 22),
	red: style(31, 39),
	green: style(32, 39),
	yellow: style(33, 39),
	cyan: style(36, 39),
}
