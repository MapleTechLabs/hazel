/**
 * The phone's own controls, where the app runs in a native shell that has them: the iOS app
 * (`apps/native/src/ios.ts`) installs them before the app starts: a tap of the finger, and the
 * swipe from the screen's left edge that goes back. A browser has none. (Native views that stand
 * in for the app's own elements are islands: `platform/native-island.ts`.)
 */

export type SystemUi = Readonly<{
	/** A tap of the finger, as a long-press's menu opening gives. */
	haptic: () => void
	/** From now on the edge swipe goes to `href`, until the function this returns runs. */
	setSwipeBack: (href: string) => () => void
}>

let installed: SystemUi | undefined

export const installSystemUi = (ui: SystemUi) => {
	installed = ui
}

/** The shell's controls, or `undefined` in a browser. */
export const systemUi = (): SystemUi | undefined => installed
