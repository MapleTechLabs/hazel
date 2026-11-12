/**
 * `setImmediate` for the iOS worker, as Bun has it: a macrotask with no delay. Effect's scheduler
 * picks `setImmediate` when it is there and `setTimeout(f, 0)` otherwise, which WebKit clamps to
 * 4 ms once timeouts nest five deep: every Message the runtime handled cost ~3-4 ms of waiting, a
 * tab's burst of collection updates 60-120 ms. A `MessageChannel` message is never clamped.
 *
 * The bundle's banner (`scripts/build-ios.ts`), so it is installed before any module loads.
 */

type Task = { readonly callback: (...args: Array<unknown>) => void; readonly args: Array<unknown> }

const tasks = new Map<number, Task>()
let nextId = 0
const channel = new MessageChannel()
channel.port1.onmessage = (event: MessageEvent<number>) => {
	const task = tasks.get(event.data)
	if (task === undefined) return
	tasks.delete(event.data)
	task.callback(...task.args)
}

const setImmediate = (callback: (...args: Array<unknown>) => void, ...args: Array<unknown>) => {
	const id = ++nextId
	tasks.set(id, { callback, args })
	channel.port2.postMessage(id)
	return id
}
const clearImmediate = (id: number) => {
	tasks.delete(id)
}

Object.assign(globalThis, { setImmediate, clearImmediate })

// A module, so its names stay its own.
export {}
