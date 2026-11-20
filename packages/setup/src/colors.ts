/**
 * Terminal colors for the setup CLI, the subset of picocolors it used. Plain text when `NO_COLOR` is set,
 * or, unless `FORCE_COLOR` is set, when stdout is not a terminal or the terminal is `TERM=dumb`. An
 * empty value counts as unset for both (no-color.org, force-color.org).
 */

const isSet = (name: string) => (process.env[name] ?? "") !== ""

const enabled =
	!isSet("NO_COLOR") &&
	(isSet("FORCE_COLOR") || (process.stdout.isTTY === true && process.env.TERM !== "dumb"))

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
