/**
 * The motion comparison's cases (`scripts/test-motion.ts`): the same moment on both sides, today's kit
 * classes (`motion-kit.html`) and the hazel renderers (`motion-hazel.html`). `start` shows the thing
 * and marks the element that moves with `data-motion-target`.
 */
export const motionCases = [
	"menu",
	"popover",
	"dialog",
	"tooltip",
	"toast",
	"toastExit",
	"countUp",
	"countDown",
] as const
export type MotionCase = (typeof motionCases)[number]

/** One side's cases: each shows its thing and returns the element that moves. */
export type MotionRunners = Readonly<Record<MotionCase, () => Promise<HTMLElement | null>>>

export interface MotionPage {
	readonly start: (name: MotionCase) => Promise<void>
}

declare global {
	interface Window {
		__motion?: MotionPage
	}
}
