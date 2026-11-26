/**
 * When a motion plays on the web (`MOTION.md`). A renderer marks the element that moves with
 * `data-motion="<trigger>"`; the generated CSS (`recipe.motion`) animates it, Reduce Motion included.
 * A renderer never names a motion, a duration or a curve: those are the recipe's.
 */
import type { MotionTrigger } from "../style/schema.ts"

const triggersOf = (element: HTMLElement) =>
	new Set((element.dataset.motion ?? "").split(" ").filter((each) => each !== ""))

const write = (element: HTMLElement, triggers: ReadonlySet<string>) => {
	if (triggers.size === 0) delete element.dataset.motion
	else element.dataset.motion = [...triggers].join(" ")
}

/** The CSS animations running on `element` itself or its `::backdrop`, not on its descendants. */
const running = (element: HTMLElement): ReadonlyArray<Animation> => {
	if (typeof element.getAnimations !== "function") return []
	return element
		.getAnimations({ subtree: true })
		.filter(
			(animation) => animation.effect instanceof KeyframeEffect && animation.effect.target === element,
		)
}

const plays = new WeakMap<HTMLElement, Map<string, number>>()
let sequence = 0

/** Marks `element` for `trigger`; the animations' end, or undefined when nothing plays. */
const start = (element: HTMLElement, trigger: MotionTrigger): Promise<void> | undefined => {
	const triggers = triggersOf(element)
	if (triggers.has(trigger)) {
		triggers.delete(trigger)
		write(element, triggers)
		// A style flush between, so the same animation starts over rather than continuing.
		void element.offsetWidth
	}
	triggers.add(trigger)
	write(element, triggers)
	const id = (sequence += 1)
	const mine = plays.get(element) ?? new Map<string, number>()
	plays.set(element, mine)
	mine.set(trigger, id)
	const finish = () => {
		if (mine.get(trigger) !== id) return
		mine.delete(trigger)
		const now = triggersOf(element)
		now.delete(trigger)
		write(element, now)
	}
	const animations = running(element)
	if (animations.length === 0) {
		finish()
		return undefined
	}
	return Promise.all(animations.map((animation) => animation.finished.catch(() => undefined))).then(finish)
}

/**
 * Plays `trigger` on `element` from its start (again, when it is already playing) and resolves when
 * it ends, or at once when the recipe gives the element no motion for it (or the engine runs none).
 */
export const play = (element: HTMLElement, trigger: MotionTrigger): Promise<void> =>
	start(element, trigger) ?? Promise.resolve()

/** Plays `trigger`, then runs `done`: in the same turn when nothing plays (no exit motion). */
export const playThen = (element: HTMLElement, trigger: MotionTrigger, done: () => void) => {
	const ending = start(element, trigger)
	if (ending === undefined) done()
	else void ending.then(done)
}

/** Stops `trigger` on `element` (an exit cancelled by a reopen): it snaps to rest. */
export const stop = (element: HTMLElement, trigger: MotionTrigger) => {
	plays.get(element)?.delete(trigger)
	const triggers = triggersOf(element)
	triggers.delete(trigger)
	write(element, triggers)
}

/**
 * Marks an element not yet in the page (a pill a draw just built): its motion starts when it is
 * inserted, and the mark goes when the animation ends.
 */
export const mark = (element: HTMLElement, trigger: MotionTrigger) => {
	const triggers = triggersOf(element)
	triggers.add(trigger)
	write(element, triggers)
	const clear = (event: Event) => {
		if (event.target !== element) return
		element.removeEventListener("animationend", clear)
		element.removeEventListener("animationcancel", clear)
		const now = triggersOf(element)
		now.delete(trigger)
		write(element, now)
	}
	element.addEventListener("animationend", clear)
	element.addEventListener("animationcancel", clear)
}

/** Plays `trigger` each time `element` is shown again (`hidden` lifted): a skeleton fading in. */
export const onShow = (element: HTMLElement, trigger: MotionTrigger) => {
	const triggers = triggersOf(element)
	triggers.add(trigger)
	write(element, triggers)
}

/** Runs a loop (`loop`) while `on`: an indeterminate sweep, typing dots, skeleton shapes. */
export const loop = (element: HTMLElement, on: boolean) => {
	const triggers = triggersOf(element)
	if (on) triggers.add("loop")
	else triggers.delete("loop")
	write(element, triggers)
}

/**
 * A count that changed: `fresh` replaces `current` (so the roll restarts) and rolls in from below
 * when the number rose, from above when it fell. Returns the element now showing the number.
 */
export const rollCount = (current: HTMLElement, text: string, from: number, to: number): HTMLElement => {
	if (from === to || from <= 0 || to <= 0 || current.parentNode === null) {
		current.textContent = text
		return current
	}
	const fresh = current.cloneNode(false) as HTMLElement
	delete fresh.dataset.motion
	fresh.textContent = text
	current.replaceWith(fresh)
	void play(fresh, to > from ? "countUp" : "countDown")
	return fresh
}

const lingering = new WeakMap<Element, () => void>()

/**
 * What a primitive does once the view has removed it (`host.ts`), when it is still showing: a toast
 * puts its node back for its exit motion, then takes it away.
 */
export const onRemoved = (node: Element, linger: () => void) => {
	lingering.set(node, linger)
}

/** After the host removed `node`: lets its showing overlays finish their exit. */
export const afterRemoved = (node: Node) => {
	if (!(node instanceof Element)) return
	for (const each of [node, ...node.querySelectorAll("[data-hz=toast]")]) lingering.get(each)?.()
}
