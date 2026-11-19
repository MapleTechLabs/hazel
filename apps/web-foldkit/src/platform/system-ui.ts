import type { Feedback } from "./feedback"

/**
 * The phone's own controls, where the app runs in a native shell that has them: the iOS app
 * (`apps/native/src/ios.ts`) installs them on the global object before the app starts, as the
 * desktop shells install `window.__TAURI__`: a tap of the finger, and the swipe from the screen's
 * left edge that goes back. A browser has none. (Native views that stand in for the app's own
 * elements are islands: `platform/native-island.ts`.)
 */

export type SystemUi = Readonly<{
	/** Plays a haptic (`platform/feedback.ts` says which kind means what). */
	feedback: (kind: Feedback) => void
	/**
	 * From now on the edge swipe goes to `href`, until the function this returns runs. With
	 * `onBack`, the swipe runs it instead of following `href` (something over the page that closes,
	 * as a thread over its channel; `href` is then the page under it), and it goes before every
	 * plain chevron on screen.
	 */
	setSwipeBack: (href: string, onBack?: () => void) => () => void
	/**
	 * From now on a horizontal swipe pages (`onPage(1)` toward the next, `-1` the previous) instead
	 * of going back, until the function this returns runs. An image viewer's slides.
	 */
	setSwipePager?: (onPage: (step: -1 | 1) => void) => () => void
	/**
	 * The shell draws message lists itself from the rows the page lays out (the iOS shell's native
	 * list): the page renders every row it holds, not only those near its own (unseen) scroll.
	 */
	drawsLists?: true
}>

/** The global a shell installs its controls as. */
export const SYSTEM_UI_GLOBAL = "__HAZEL_SYSTEM_UI__"

type SystemUiGlobal = typeof globalThis & { [SYSTEM_UI_GLOBAL]?: SystemUi }

/** The shell's controls, or `undefined` in a browser. */
export const systemUi = (): SystemUi | undefined => (globalThis as SystemUiGlobal)[SYSTEM_UI_GLOBAL]

/**
 * Whether a native shell draws the message lists from the rows the page lays out
 * (`SystemUi.drawsLists`). Fixed for the page's life: read it once, at module load.
 */
export const shellDrawsLists = (): boolean => systemUi()?.drawsLists === true
