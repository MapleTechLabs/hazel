/**
 * Advanced Timing and Async Behavior Tests for TanStack DB Atom
 *
 * These tests use fake timers to control async behavior and test edge cases
 * around timing, delays, and rapid state changes.
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

// Helper to create a delayed collection that syncs after a delay
function createDelayedCollection<T extends object>(
	id: string,
	initialData: Array<T>,
	getKey: (item: T) => string | number,
	delayMs: number,
): {
	collection: Collection<T, string | number, any> & NonSingleResult
	utils: {
		triggerSync: () => void
	}
} {
	let timeoutId: ReturnType<typeof setTimeout> | null = null
	let begin: () => void
	let write: (change: { type: "insert" | "update" | "delete"; value: T }) => void
	let commit: () => void
	let markReady: () => void

	const config: any = {
		id,
		getKey,
		sync: {
			sync: (params: any) => {
				begin = params.begin
				write = params.write
				commit = params.commit
				markReady = params.markReady

				// Delay the sync process
				timeoutId = setTimeout(() => {
					begin()
					for (const item of initialData) {
						write({
							type: "insert",
							value: item,
						})
					}
					commit()
					markReady()
				}, delayMs)
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
			triggerSync: () => {
				if (timeoutId) {
					clearTimeout(timeoutId)
					begin()
					for (const item of initialData) {
						write({ type: "insert", value: item })
					}
					commit()
					markReady()
				}
			},
		},
	}
}

describe("Timing and Async Behavior", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("should handle delayed collection sync with fake timers", async () => {
		const registry = Registry.make()
		const { collection } = createDelayedCollection("todos", initialTodos, (todo) => todo.id, 1000)

		const todosAtom = makeCollectionAtom(collection)

		// Initially should be in loading/initial state
		let result = registry.get(todosAtom)
		expect(Result.isInitial(result)).toBe(true)

		// Advance time by 500ms - still loading
		await vi.advanceTimersByTimeAsync(500)
		result = registry.get(todosAtom)
		expect(Result.isInitial(result)).toBe(true)

		// Advance time by another 500ms - should be ready
		await vi.advanceTimersByTimeAsync(500)
		result = registry.get(todosAtom)
		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(3)
		}
	})

	it("should handle rapid consecutive updates", async () => {
		const registry = Registry.make()

		let begin: () => void
		let write: (change: { type: "insert" | "update" | "delete"; value: Todo }) => void
		let commit: () => void

		const config: any = {
			id: "todos",
			getKey: (todo: Todo) => todo.id,
			sync: {
				sync: (params: any) => {
					begin = params.begin
					write = params.write
					commit = params.commit
					const markReady = params.markReady

					// Start with empty collection
					begin()
					commit()
					markReady()
				},
			},
			startSync: true,
			gcTime: 0,
		}

		const collection = createCollection(config)
		const todosAtom = makeCollectionAtom(collection)

		// Track all updates
		const updates: Array<number> = []
		registry.subscribe(todosAtom, (result) => {
			if (Result.isSuccess(result)) {
				updates.push(result.value.length)
			}
		})

		// Initial state
		await vi.runAllTimersAsync()

		// Rapidly add 50 todos
		begin!()
		for (let i = 0; i < 50; i++) {
			write!({
				type: "insert",
				value: {
					id: `todo-${i}`,
					title: `Task ${i}`,
					completed: i % 2 === 0,
					userId: "user1",
				},
			})
		}
		commit!()

		await vi.runAllTimersAsync()

		// Should have received the final state with 50 todos
		const result = registry.get(todosAtom)
		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(50)
		}
	})

	it("should handle updates during waiting state", async () => {
		const registry = Registry.make()
		const { collection, utils } = createDelayedCollection("todos", initialTodos, (todo) => todo.id, 1000)

		const todosAtom = makeCollectionAtom(collection)

		// Start in waiting state
		let result = registry.get(todosAtom)
		expect(Result.isInitial(result)).toBe(true)
		if (Result.isInitial(result)) {
			expect(result.waiting).toBe(true)
		}

		// Set up subscription to track state changes
		const states: Array<string> = []
		const unsub = registry.subscribe(todosAtom, (r) => {
			if (Result.isSuccess(r)) states.push("success")
		})

		// Manually trigger sync early
		utils.triggerSync()
		await vi.runAllTimersAsync()

		// Should have transitioned to success
		expect(states).toContain("success")

		// Re-read the atom to get updated state
		result = registry.get(todosAtom)
		expect(Result.isSuccess(result)).toBe(true)

		unsub()
	})

	it("should handle subscription during delayed sync", async () => {
		const registry = Registry.make()
		const { collection } = createDelayedCollection("todos", initialTodos, (todo) => todo.id, 500)

		const todosAtom = makeCollectionAtom(collection)

		const updates: Array<Result.AsyncResult<Array<Todo>, Error>> = []
		registry.subscribe(todosAtom, (value) => {
			updates.push(value)
		})

		// Trigger subscription
		registry.get(todosAtom)

		// Wait for sync to complete
		await vi.advanceTimersByTimeAsync(500)
		await vi.runAllTimersAsync()

		// Should have received at least one update when ready
		expect(updates.length).toBeGreaterThan(0)
		const lastUpdate = updates[updates.length - 1]!
		expect(Result.isSuccess(lastUpdate)).toBe(true)
	})

	it("should handle multiple atoms syncing at different times", async () => {
		const registry = Registry.make()

		const { collection: col1 } = createDelayedCollection("todos1", [initialTodos[0]!], (t) => t.id, 100)
		const { collection: col2 } = createDelayedCollection("todos2", [initialTodos[1]!], (t) => t.id, 300)
		const { collection: col3 } = createDelayedCollection("todos3", [initialTodos[2]!], (t) => t.id, 500)

		const atom1 = makeCollectionAtom(col1)
		const atom2 = makeCollectionAtom(col2)
		const atom3 = makeCollectionAtom(col3)

		// All should start in initial state
		expect(Result.isInitial(registry.get(atom1))).toBe(true)
		expect(Result.isInitial(registry.get(atom2))).toBe(true)
		expect(Result.isInitial(registry.get(atom3))).toBe(true)

		// After 100ms, first should be ready
		await vi.advanceTimersByTimeAsync(100)
		expect(Result.isSuccess(registry.get(atom1))).toBe(true)
		expect(Result.isInitial(registry.get(atom2))).toBe(true)
		expect(Result.isInitial(registry.get(atom3))).toBe(true)

		// After 300ms total, second should be ready
		await vi.advanceTimersByTimeAsync(200)
		expect(Result.isSuccess(registry.get(atom1))).toBe(true)
		expect(Result.isSuccess(registry.get(atom2))).toBe(true)
		expect(Result.isInitial(registry.get(atom3))).toBe(true)

		// After 500ms total, all should be ready
		await vi.advanceTimersByTimeAsync(200)
		expect(Result.isSuccess(registry.get(atom1))).toBe(true)
		expect(Result.isSuccess(registry.get(atom2))).toBe(true)
		expect(Result.isSuccess(registry.get(atom3))).toBe(true)
	})

	it("should debounce rapid collection changes", async () => {
		const registry = Registry.make()

		let begin: () => void
		let write: (change: { type: "insert" | "update" | "delete"; value: Todo }) => void
		let commit: () => void

		const config: any = {
			id: "todos",
			getKey: (todo: Todo) => todo.id,
			sync: {
				sync: (params: any) => {
					begin = params.begin
					write = params.write
					commit = params.commit
					const markReady = params.markReady

					begin()
					commit()
					markReady()
				},
			},
			startSync: true,
			gcTime: 0,
		}

		const collection = createCollection(config)
		const todosAtom = makeCollectionAtom(collection)

		let updateCount = 0
		registry.subscribe(todosAtom, () => {
			updateCount++
		})

		// Trigger subscription
		registry.get(todosAtom)
		await vi.runAllTimersAsync()

		// Make 100 rapid updates
		for (let i = 0; i < 100; i++) {
			begin!()
			write!({
				type: "insert",
				value: {
					id: `todo-${i}`,
					title: `Task ${i}`,
					completed: false,
					userId: "user1",
				},
			})
			commit!()
		}

		await vi.runAllTimersAsync()

		// Should have received updates (TanStack DB handles batching internally)
		expect(updateCount).toBeGreaterThan(0)

		// Verify final state
		const result = registry.get(todosAtom)
		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(100)
		}
	})

	it("should handle delayed query execution", async () => {
		const registry = Registry.make()

		const { collection } = createDelayedCollection("todos", initialTodos, (todo) => todo.id, 200)

		// Create a query atom
		const completedTodosAtom = makeQuery((q) =>
			q.from({ todos: collection }).where(({ todos }) => eq(todos.completed, true)),
		)

		// Initially in waiting state
		let result = registry.get(completedTodosAtom)
		expect(Result.isInitial(result)).toBe(true)

		// Set up subscription to track state changes
		const states: Array<string> = []
		const unsub = registry.subscribe(completedTodosAtom, (r) => {
			if (Result.isSuccess(r)) states.push("success")
		})

		// Advance time until collection syncs
		await vi.advanceTimersByTimeAsync(200)
		await vi.runAllTimersAsync()

		// Should have transitioned to success
		expect(states).toContain("success")

		// Re-read the atom to get updated state
		result = registry.get(completedTodosAtom)
		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(1) // Only one completed todo
			expect(result.value[0]?.completed).toBe(true)
		}

		unsub()
	})
})
