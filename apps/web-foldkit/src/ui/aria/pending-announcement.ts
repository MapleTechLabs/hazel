import { Effect, Layer } from "effect"
import { announce } from "./announcer"

/**
 * A focused button whose pending state flips is announced (RAC Button's pending announcement). One
 * document observer follows `data-pending`, so buttons need no Mount. It is an app-lifetime
 * Resource: the runtime installs the observer when the app starts and removes it on shutdown.
 */

const buttonOf = (target: EventTarget | null) => (target instanceof Element ? target.closest("button") : null)

const labelOf = (button: HTMLButtonElement) =>
	(button.getAttribute("aria-label") ?? button.textContent ?? "").trim()

const watchPendingButtons = (): (() => void) => {
	/**
	 * Disabling a focused button drops its focus before the observer runs, so the button last
	 * focused or pressed still counts while focus has fallen to the body and nothing else took it.
	 */
	let lastFocusedButton: HTMLButtonElement | null = null
	const onFocusIn = (event: FocusEvent) => {
		lastFocusedButton = event.target instanceof HTMLButtonElement ? event.target : null
	}
	const onPointerDown = (event: PointerEvent) => {
		lastFocusedButton = buttonOf(event.target)
	}
	const wasFocused = (element: HTMLButtonElement) =>
		document.activeElement === element ||
		(lastFocusedButton === element &&
			(document.activeElement === null || document.activeElement === document.body))
	const observer = new MutationObserver((records) => {
		for (const record of records) {
			const element = record.target
			const isPending = element instanceof Element && element.hasAttribute("data-pending")
			const wasPending = record.oldValue !== null
			if (element instanceof HTMLButtonElement && isPending !== wasPending && wasFocused(element)) {
				lastFocusedButton = null
				const label = labelOf(element)
				if (label !== "") announce(label)
			}
		}
	})
	document.addEventListener("focusin", onFocusIn, true)
	document.addEventListener("pointerdown", onPointerDown, true)
	observer.observe(document.documentElement, {
		subtree: true,
		attributes: true,
		attributeOldValue: true,
		attributeFilter: ["data-pending"],
	})
	return () => {
		observer.disconnect()
		document.removeEventListener("focusin", onFocusIn, true)
		document.removeEventListener("pointerdown", onPointerDown, true)
	}
}

/** The pending-button announcer, provided with the app's resources. */
export const layer = Layer.effectDiscard(
	Effect.acquireRelease(Effect.sync(watchPendingButtons), (release) => Effect.sync(release)),
)
