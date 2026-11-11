import * as Animation from "@foldkit/ui/animation"
import * as UiToast from "@foldkit/ui/toast"
import * as Scene from "foldkit/scene"

/**
 * Scene steps for the root toaster's `@foldkit/ui` Toast. `Toast.test.drainEntry` is Story-only, so
 * these are its Scene twins. The enter transition is generation 1, the leave transition generation 2.
 */

const ENTER = 1
const LEAVE = 2

/** The first toast the root shows. */
export const FIRST_TOAST = "toaster-entry-0"

/** Runs a shown toast through its enter animation; its auto-dismiss timer stays pending. */
const enterToast = (entryId: string = FIRST_TOAST) =>
	Scene.Command.resolveAll(
		[
			Animation.WaitForPaint({ generation: ENTER }),
			Animation.Message.CompletedWaitForPaint({ generation: ENTER }),
		],
		[
			Animation.WaitForAnimationSettled({ id: entryId, generation: ENTER }),
			Animation.Message.EndedAnimation({ generation: ENTER }),
		],
	)

/** Runs a dismissed toast through its exit animation, which removes it. */
export const leaveToast = (entryId: string = FIRST_TOAST) =>
	Scene.Command.resolveAll(
		[
			Animation.WaitForPaint({ generation: LEAVE }),
			Animation.Message.CompletedWaitForPaint({ generation: LEAVE }),
		],
		[
			Animation.WaitForAnimationSettled({ id: entryId, generation: LEAVE }),
			Animation.Message.EndedAnimation({ generation: LEAVE }),
		],
	)

/** A shown toast's whole life: enter, its 4s lifetime running out, then exit. */
export const drainToast = (entryId: string = FIRST_TOAST, version = 0) => [
	enterToast(entryId),
	Scene.Command.resolve(
		UiToast.WaitBeforeDismissal,
		UiToast.Message.CompletedWaitBeforeDismissal({ entryId, version }),
	),
	leaveToast(entryId),
]
