/**
 * One page in the parity harness (`packages/ui/scripts/compare-pages.ts`): a file per page in
 * `./pages/<id>.ts` default-exports one, the file name its id. Data only (the harness loads these in
 * Bun, outside the app), so a page compares the same whichever side is the root: it needs a URL, a
 * flag and the steps that bring the screen up.
 */

/** Which widths a step runs at: `compact` is 390 wide, `regular` 1180. */
export type CompareSize = "compact" | "regular"

/** One action before the shot. Selectors are Playwright's (CSS, `text=`, `>> nth=`). */
export type CompareStep = { readonly at?: CompareSize } & (
	| { readonly click: string }
	| { readonly hover: string }
	| { readonly press: string }
	| { readonly fill: string; readonly text: string }
	| { readonly waitFor: string }
	| { readonly route: string }
)

export interface ComparePage {
	/** The localStorage flag that swaps in the hazel side (`"1"`), as `hazel:page:<id>`. */
	readonly flag: string
	/** The route the screen lives at, opened in-app (a link click, else history). */
	readonly href: string
	/** The hazel side's container; it must exist with the flag on, or the page never mounted. */
	readonly island: string
	/** False where the hazel side is phone only: 1180 wide, the flag changes nothing. */
	readonly wide: boolean
	/** Run in order after the route opens: open a menu, a dialog, a tab. */
	readonly steps: ReadonlyArray<CompareStep>
	/** The phone tab bar's tab that reaches `href` at 390 wide, clicked instead of the route. */
	readonly tab?: string
	/**
	 * What is compared 1180 wide: `slot` (default) the container's parent, `viewport` the whole
	 * window (a dialog or menu drawn outside the slot). At 390 it is always the viewport.
	 */
	readonly region?: "slot" | "viewport"
}
