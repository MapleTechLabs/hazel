/**
 * The native runtime's Effect `Scheduler` (G4, `docs/hazel-ui.md`): fiber tasks drain on microtasks in
 * JS, so a yield never crosses into Swift. A burst that runs past its budget gives the JS thread's run
 * loop one turn (`yieldToHost`, a `setTimeout(0)` by default), so presses and timers get in.
 */
import type * as Fiber from "effect/Fiber"
import type * as Scheduler from "effect/Scheduler"

export interface NativeSchedulerOptions {
	/** How long one burst of fiber tasks runs before the host gets a turn: 8 ms by default. */
	readonly budgetMs?: number
	readonly now?: () => number
	readonly yieldToHost?: (resume: () => void) => void
}

export interface NativeSchedulerStats {
	/** Drains on a microtask: yields that stayed in JS. */
	readonly microtaskDrains: number
	/** Drains after a host turn: yields that crossed into the host. */
	readonly hostYields: number
	readonly tasks: number
}

export interface NativeScheduler extends Scheduler.Scheduler {
	readonly stats: () => NativeSchedulerStats
}

interface Bucket {
	readonly priority: number
	tasks: Array<() => void>
}

const defaultNow = (): number => (typeof performance === "object" ? performance.now() : Date.now())

export const makeNativeScheduler = (options: NativeSchedulerOptions = {}): NativeScheduler => {
	const budget = options.budgetMs ?? 8
	const now = options.now ?? defaultNow
	const yieldToHost = options.yieldToHost ?? ((resume) => setTimeout(resume, 0))
	let queue: Array<Bucket> = []
	let posted = false
	// When the current burst began; undefined once the queue empties or the host had a turn.
	let burstStart: number | undefined
	let microtaskDrains = 0
	let hostYields = 0
	let tasks = 0

	// A task scheduled while draining joins this drain: `posted` stays set until the queue empties.
	const drain = () => {
		posted = true
		burstStart ??= now()
		while (queue.length > 0) {
			const bucket = queue[0]
			if (bucket === undefined) break
			const task = bucket.tasks.shift()
			if (bucket.tasks.length === 0) queue.shift()
			if (task === undefined) continue
			tasks++
			try {
				task()
			} catch (error) {
				console.error("[scheduler] task threw", error)
			}
			if (queue.length > 0 && now() - burstStart >= budget) {
				burstStart = undefined
				hostYields++
				yieldToHost(drain)
				return
			}
		}
		burstStart = undefined
		posted = false
	}

	const dispatcher: Scheduler.SchedulerDispatcher = {
		scheduleTask: (task, priority) => {
			let index = queue.length
			while (index > 0 && (queue[index - 1]?.priority ?? priority) > priority) index--
			const found = queue[index - 1]
			if (found !== undefined && found.priority === priority) found.tasks.push(task)
			else queue.splice(index, 0, { priority, tasks: [task] })
			if (posted) return
			posted = true
			microtaskDrains++
			queueMicrotask(drain)
		},
		flush: () => {
			while (queue.length > 0) {
				const batch = queue
				queue = []
				for (const bucket of batch) for (const task of bucket.tasks) task()
			}
		},
	}

	return {
		executionMode: "async",
		shouldYield: (fiber: Fiber.Fiber<unknown, unknown>) =>
			fiber.currentOpCount >= fiber.cache.maxOpsBeforeYield,
		makeDispatcher: () => dispatcher,
		stats: () => ({ microtaskDrains, hostYields, tasks }),
	}
}
