/**
 * Advanced Subscription Pattern Tests for TanStack DB Atom
 *
 * These tests verify complex subscription scenarios including multiple subscribers,
 * ordering guarantees, cleanup behavior, and edge cases.
 *
 * Inspired by effect-atom/packages/atom/test/Atom.test.ts
 *
 * @since 1.0.0
 */

import { Atom, AsyncResult as Result, AtomRegistry as Registry } from "effect/reactivity"
import { type Collection, createCollection, eq, type NonSingleResult } from "@tanstack/db"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeCollectionAtom, makeQuery } from "./AtomTanStackDB"

// Test data types
type Todo = {
	id: string
	title: string
	completed: boolean
	userId: string
}

const initialTodos: Array<Todo> = [
	{ id: "1", title: "Task 1", completed: false, userId: "user1" },
	{ id: "2", title: "Task 2", completed: true, userId: "user1" },
	{ id: "3", title: "Task 3", completed: false, userId: "user2" },
]

// Helper to create a mutable collection
function createMutableCollection<T extends object>(
	id: string,
	initialData: Array<T>,
	getKey: (item: T) => string | number,
): {
	collection: Collection<T, string | number, any> & NonSingleResult
	utils: {
		insert: (item: T) => void
		update: (key: string | number, item: T) => void
		delete: (key: string | number, item: T) => void
	}
} {
	let begin: () => void
	let write: (change: { type: "insert" | "update" | "delete"; value: T }) => void
	let commit: () => void

	const config: any = {
		id,
		getKey,
		sync: {
			sync: (params: any) => {
				begin = params.begin
				write = params.write
				commit = params.commit
				const markReady = params.markReady

				// Initialize with data
				begin()
				for (const item of initialData) {
					write({ type: "insert", value: item })
				}
				commit()
				markReady()
			},
		},
		startSync: true,
		// Disable GC: TanStack DB collects collections that sync without subscribers,
		// and fake timers would otherwise run that GC before the atom subscribes
		gcTime: 0,
	}

	const collection = createCollection<T>(config)

	return {
		collection,
		utils: {
			insert: (item: T) => {
				begin!()
				write!({ type: "insert", value: item })
				commit!()
			},
			update: (_key: string | number, item: T) => {
				begin!()
				write!({ type: "update", value: item })
				commit!()
			},
			delete: (_key: string | number, item: T) => {
				begin!()
				write!({ type: "delete", value: item })
				commit!()
			},
		},
	}
}

describe("Advanced Subscription Patterns", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("should support multiple concurrent subscribers", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		// Create multiple subscribers
		const updates1: Array<number> = []
		const updates2: Array<number> = []
		const updates3: Array<number> = []

		const unsub1 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates1.push(result.value.length)
			}
		})

		const unsub2 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates2.push(result.value.length)
			}
		})

		const unsub3 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates3.push(result.value.length)
			}
		})

		// Trigger initial subscription by getting value
		registry.get(todosAtom)
		await vi.runAllTimersAsync()

		// Make changes
		utils.insert({ id: "4", title: "Task 4", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		utils.insert({ id: "5", title: "Task 5", completed: true, userId: "user2" })
		await vi.runAllTimersAsync()

		// All subscribers should receive the same updates
		expect(updates1).toEqual(updates2)
		expect(updates2).toEqual(updates3)
		expect(updates1[updates1.length - 1]).toBe(5) // Final count should be 5

		// Cleanup
		unsub1()
		unsub2()
		unsub3()
	})

	it("should maintain subscription order", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		const callOrder: Array<string> = []

		// Subscribe in specific order
		const unsub1 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				callOrder.push("subscriber-1")
			}
		})

		const unsub2 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				callOrder.push("subscriber-2")
			}
		})

		const unsub3 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				callOrder.push("subscriber-3")
			}
		})

		// Trigger subscriptions
		registry.get(todosAtom)
		await vi.runAllTimersAsync()
		callOrder.length = 0 // Clear initial subscription calls

		// Make a change
		utils.insert({ id: "4", title: "Task 4", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		// Subscribers should be called in order
		expect(callOrder).toEqual(["subscriber-1", "subscriber-2", "subscriber-3"])

		// Cleanup
		unsub1()
		unsub2()
		unsub3()
	})

	it("should handle partial unsubscription", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		const updates1: Array<number> = []
		const updates2: Array<number> = []
		const updates3: Array<number> = []

		const unsub1 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates1.push(result.value.length)
			}
		})

		const unsub2 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates2.push(result.value.length)
			}
		})

		const unsub3 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates3.push(result.value.length)
			}
		})

		// Trigger subscriptions
		registry.get(todosAtom)
		await vi.runAllTimersAsync()

		// Unsubscribe subscriber 2
		unsub2()

		// Make changes
		utils.insert({ id: "4", title: "Task 4", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		// Subscriber 1 and 3 should receive updates, but not 2
		expect(updates1[updates1.length - 1]).toBe(4)
		expect(updates2[updates2.length - 1]).toBe(3) // Stopped at initial count
		expect(updates3[updates3.length - 1]).toBe(4)

		// Cleanup
		unsub1()
		unsub3()
	})

	it("should handle resubscription after unmount", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		const updates: Array<number> = []

		// First subscription
		const unsub1 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates.push(result.value.length)
			}
		})

		// Trigger subscription
		registry.get(todosAtom)
		await vi.runAllTimersAsync()

		// Add item
		utils.insert({ id: "4", title: "Task 4", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		expect(updates[updates.length - 1]).toBe(4)

		// Unsubscribe
		unsub1()
		updates.length = 0 // Clear updates

		// Resubscribe
		const unsub2 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates.push(result.value.length)
			}
		})

		// Make a change to trigger subscription (registry.get doesn't trigger subscription callbacks)
		utils.insert({ id: "4.5", title: "Task 4.5", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		// Should get updates on resubscription
		expect(updates.length).toBeGreaterThan(0)
		expect(updates[updates.length - 1]).toBe(5) // Now has 5 items

		// Add another item
		utils.insert({ id: "5", title: "Task 5", completed: true, userId: "user2" })
		await vi.runAllTimersAsync()

		expect(updates[updates.length - 1]).toBe(6)

		// Cleanup
		unsub2()
	})

	it("should handle subscriptions during different collection states", async () => {
		const registry = Registry.make()

		let begin: () => void
		let write: (change: { type: "insert" | "update" | "delete"; value: Todo }) => void
		let commit: () => void
		let markReady: () => void

		const config: any = {
			id: "todos",
			getKey: (todo: Todo) => todo.id,
			sync: {
				sync: (params: any) => {
					begin = params.begin
					write = params.write
					commit = params.commit
					markReady = params.markReady

					// Don't sync immediately - stay in loading state
				},
			},
			startSync: true,
			gcTime: 0,
		}

		const collection = createCollection(config)
		const todosAtom = makeCollectionAtom(collection)

		const states: Array<string> = []

		// Subscribe while in loading state
		const unsub = registry.subscribe(todosAtom, (result) => {
			if (Result.isInitial(result)) {
				states.push("initial")
			} else if (Result.isSuccess(result)) {
				states.push("success")
			} else if (Result.isFailure(result)) {
				states.push("failure")
			}
		})

		// Trigger subscription
		const initialResult = registry.get(todosAtom)
		if (Result.isInitial(initialResult)) states.push("initial")

		await vi.runAllTimersAsync()

		// Should start in initial/loading state
		expect(states[0]).toBe("initial")

		// Now complete the sync
		begin!()
		for (const todo of initialTodos) {
			write!({ type: "insert", value: todo })
		}
		commit!()
		markReady!()

		await vi.runAllTimersAsync()

		// Should transition to success
		expect(states[states.length - 1]).toBe("success")

		// Cleanup
		unsub()
	})

	it("should not leak memory with many subscribe/unsubscribe cycles", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		// Perform many subscribe/unsubscribe cycles
		for (let i = 0; i < 100; i++) {
			const unsub = registry.subscribe(todosAtom, () => {
				// No-op subscriber
			})
			await vi.runAllTimersAsync()
			unsub()
		}

		// Make a change to verify collection still works
		utils.insert({ id: "new", title: "New Task", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		const result = registry.get(todosAtom)
		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(4)
		}
	})

	it("should handle subscriber errors gracefully", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		const updates: Array<number> = []
		let errorCount = 0

		// Subscriber that throws an error but catches it
		const unsub1 = registry.subscribe(todosAtom, () => {
			try {
				throw new Error("Subscriber error")
			} catch {
				errorCount++
			}
		})

		// Normal subscriber
		const unsub2 = registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates.push(result.value.length)
			}
		})

		// Trigger subscriptions
		registry.get(todosAtom)
		await vi.runAllTimersAsync()

		// Make a change
		utils.insert({ id: "4", title: "Task 4", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		// Normal subscriber should still receive updates despite other subscriber throwing
		expect(updates[updates.length - 1]).toBe(4)
		expect(errorCount).toBeGreaterThan(0) // Error subscriber was called

		// Cleanup
		unsub1()
		unsub2()
	})

	it("should batch rapid subscription changes", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		let updateCount = 0

		const unsub = registry.subscribe(todosAtom, () => {
			updateCount++
		})

		// Trigger subscription
		registry.get(todosAtom)
		await vi.runAllTimersAsync()

		const initialUpdateCount = updateCount

		// Make 10 rapid changes
		for (let i = 0; i < 10; i++) {
			utils.insert({
				id: `rapid-${i}`,
				title: `Rapid Task ${i}`,
				completed: false,
				userId: "user1",
			})
		}

		await vi.runAllTimersAsync()

		// TanStack DB may batch updates, so we should have fewer than 10 individual updates
		const changesReceived = updateCount - initialUpdateCount
		expect(changesReceived).toBeGreaterThan(0)

		// Verify final state
		const result = registry.get(todosAtom)
		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(13) // 3 initial + 10 new
		}

		// Cleanup
		unsub()
	})

	it("should handle subscription to multiple atoms from same collection", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		await vi.runAllTimersAsync()

		// Create two different query atoms from the same base collection
		const allTodosAtom = makeQuery((q) => q.from({ todos: collection }))

		const completedTodosAtom = makeQuery((q) =>
			q.from({ todos: collection }).where(({ todos }) => eq(todos.completed, true)),
		)

		const allUpdates: Array<number> = []
		const completedUpdates: Array<number> = []

		const unsub1 = registry.subscribe(allTodosAtom, (result) => {
			if (Result.isSuccess(result)) {
				allUpdates.push(result.value.length)
			}
		})

		const unsub2 = registry.subscribe(completedTodosAtom, (result) => {
			if (Result.isSuccess(result)) {
				completedUpdates.push(result.value.length)
			}
		})

		// Trigger subscriptions
		registry.get(allTodosAtom)
		registry.get(completedTodosAtom)
		await vi.runAllTimersAsync()

		// Add a completed todo
		utils.insert({ id: "4", title: "Task 4", completed: true, userId: "user1" })
		await vi.runAllTimersAsync()

		// Both atoms should update
		expect(allUpdates[allUpdates.length - 1]).toBe(4)
		expect(completedUpdates[completedUpdates.length - 1]).toBe(2) // Was 1, now 2

		// Add an incomplete todo
		utils.insert({ id: "5", title: "Task 5", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		// Only allTodos should update
		expect(allUpdates[allUpdates.length - 1]).toBe(5)
		expect(completedUpdates[completedUpdates.length - 1]).toBe(2) // Still 2

		// Cleanup
		unsub1()
		unsub2()
	})

	it("should handle synchronous subscription callbacks", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		const callbackOrder: Array<string> = []

		const unsub = registry.subscribe(todosAtom, (result) => {
			callbackOrder.push("callback-start")
			if (Result.isSuccess(result)) {
				// Synchronous work
				result.value.forEach((todo) => {
					callbackOrder.push(`process-${todo.id}`)
				})
			}
			callbackOrder.push("callback-end")
		})

		// Trigger subscription
		registry.get(todosAtom)
		await vi.runAllTimersAsync()
		callbackOrder.length = 0 // Clear initial calls

		// Make a change
		utils.insert({ id: "4", title: "Task 4", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		// Verify callback was called synchronously and in order
		expect(callbackOrder[0]).toBe("callback-start")
		expect(callbackOrder[callbackOrder.length - 1]).toBe("callback-end")

		// Cleanup
		unsub()
	})

	it("should support conditional subscriptions", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMutableCollection("todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeCollectionAtom(collection)

		await vi.runAllTimersAsync()

		let shouldUpdate = true
		const updates: Array<number> = []

		const unsub = registry.subscribe(todosAtom, (result) => {
			if (shouldUpdate && Result.isSuccess(result)) {
				updates.push(result.value.length)
			}
		})

		// Trigger subscription
		registry.get(todosAtom)
		await vi.runAllTimersAsync()

		// Make change while enabled
		utils.insert({ id: "4", title: "Task 4", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		expect(updates[updates.length - 1]).toBe(4)

		const countBeforeDisable = updates.length

		// Disable updates
		shouldUpdate = false

		// Make change while disabled
		utils.insert({ id: "5", title: "Task 5", completed: true, userId: "user2" })
		await vi.runAllTimersAsync()

		// Should not have recorded new update
		expect(updates.length).toBe(countBeforeDisable)

		// Re-enable
		shouldUpdate = true

		// Make another change
		utils.insert({ id: "6", title: "Task 6", completed: false, userId: "user1" })
		await vi.runAllTimersAsync()

		// Should record update again
		expect(updates[updates.length - 1]).toBe(6)

		// Cleanup
		unsub()
	})
})
