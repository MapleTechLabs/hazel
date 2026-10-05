/**
 * Result Pattern Matching Tests for TanStack DB Atom
 *
 * These tests verify the Result type integration and pattern matching capabilities,
 * ensuring proper handling of Initial, Success, and Failure states.
 *
 * Inspired by effect-atom/packages/atom/test/Result.test.ts
 *
 * @since 1.0.0
 */

import { Atom, AsyncResult as Result, AtomRegistry as Registry } from "effect/reactivity"
import { type Collection, createCollection, eq, type NonSingleResult } from "@tanstack/db"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeCollectionAtom, makeQuery, makeQueryConditional, makeQueryUnsafe } from "./AtomTanStackDB"

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

// Helper to create a collection that can be controlled
function createControlledCollection<T extends object>(
	id: string,
	initialData: Array<T>,
	getKey: (item: T) => string | number,
	shouldFail = false,
): {
	collection: Collection<T, string | number, any> & NonSingleResult
} {
	const config: any = {
		id,
		getKey,
		sync: {
			sync: (params: any) => {
				const begin = params.begin
				const write = params.write
				const commit = params.commit
				const markReady = params.markReady

				if (shouldFail) {
					// Don't mark as ready - collection will stay in error state
					return
				}

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

	return { collection: createCollection<T>(config) }
}

describe("Result Pattern Matching", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("Result.isSuccess", () => {
		it("should correctly identify success state", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const todosAtom = makeCollectionAtom(collection)

			await vi.runAllTimersAsync()

			const result = registry.get(todosAtom)
			expect(Result.isSuccess(result)).toBe(true)

			if (Result.isSuccess(result)) {
				expect(result.value).toHaveLength(3)
				expect(result.value[0]?.title).toBe("Task 1")
			}
		})

		it("should narrow type correctly in conditional", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const todosAtom = makeCollectionAtom(collection)

			await vi.runAllTimersAsync()

			const result = registry.get(todosAtom)

			// TypeScript should narrow the type inside this block
			if (Result.isSuccess(result)) {
				// Should have access to result.value
				const titles = result.value.map((todo) => todo.title)
				expect(titles).toEqual(["Task 1", "Task 2", "Task 3"])
			}
		})
	})

	describe("Result.isFailure", () => {
		it("should correctly identify failure state", async () => {
			// Test Result.isFailure with manually created failure Result
			const error = new Error("Test error")
			const failureResult = Result.fail(error)
			expect(Result.isFailure(failureResult)).toBe(true)

			if (Result.isFailure(failureResult)) {
				// Just verify that cause is defined - don't test internal structure
				expect(failureResult.cause).toBeDefined()
			}

			// Test that success results are not failures
			const successResult = Result.success([])
			expect(Result.isFailure(successResult)).toBe(false)

			// Test that initial results are not failures
			const initialResult = Result.initial(true)
			expect(Result.isFailure(initialResult)).toBe(false)
		})
	})

	describe("Result.isInitial", () => {
		it("should correctly identify initial/waiting state", async () => {
			const registry = Registry.make()

			let _markReady: () => void

			const config: any = {
				id: "todos",
				getKey: (todo: Todo) => todo.id,
				sync: {
					sync: (params: any) => {
						_markReady = params.markReady
						// Don't mark ready immediately
					},
				},
				startSync: true,
				gcTime: 0,
			}

			const collection = createCollection(config)
			const todosAtom = makeCollectionAtom(collection)

			const result = registry.get(todosAtom)
			expect(Result.isInitial(result)).toBe(true)

			if (Result.isInitial(result)) {
				expect(result.waiting).toBe(true)
			}
		})
	})

	describe("Result.getOrElse", () => {
		it("should return value on success", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const todosAtom = makeCollectionAtom(collection)

			await vi.runAllTimersAsync()

			const result = registry.get(todosAtom)
			const todos = Result.getOrElse(result, () => [])

			expect(todos).toHaveLength(3)
			expect(todos[0]?.title).toBe("Task 1")
		})

		it("should return fallback on failure", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection<Todo>("todos", [], (todo) => todo.id, true)

			const todosAtom = makeCollectionAtom(collection)

			await vi.runAllTimersAsync()

			const result = registry.get(todosAtom)
			const todos = Result.getOrElse(result, () => [
				{ id: "fallback", title: "Fallback", completed: false, userId: "fallback" },
			])

			expect(todos).toHaveLength(1)
			expect(todos[0]?.title).toBe("Fallback")
		})

		it("should return fallback on initial state", async () => {
			const registry = Registry.make()

			const config: any = {
				id: "todos",
				getKey: (todo: Todo) => todo.id,
				sync: {
					sync: () => {
						// Don't mark ready
					},
				},
				startSync: true,
				gcTime: 0,
			}

			const collection = createCollection(config)
			const todosAtom = makeCollectionAtom(collection)

			const result = registry.get(todosAtom)
			const todos = Result.getOrElse(result, () => [])

			expect(todos).toEqual([])
		})
	})

	describe("Result.match", () => {
		it("should handle all result states with match", async () => {
			const registry = Registry.make()

			// Success case
			const { collection: successCol } = createControlledCollection(
				"todos1",
				initialTodos,
				(todo) => todo.id,
			)
			const successAtom = makeCollectionAtom(successCol)

			await vi.runAllTimersAsync()

			const successResult = registry.get(successAtom)
			const successMsg = Result.match(successResult, {
				onInitial: () => "waiting",
				onFailure: () => "failed",
				onSuccess: (todos) => `success: ${todos.value.length}`,
			})

			expect(successMsg).toBe("success: 3")

			// Failure case - test with manually created failure Result
			const failureResult = Result.fail(new Error("Test error"))
			const failMsg = Result.match(failureResult, {
				onInitial: () => "waiting",
				onFailure: () => "failed",
				onSuccess: () => "success",
			})

			expect(failMsg).toBe("failed")

			// Initial case
			const config: any = {
				id: "todos3",
				getKey: (todo: Todo) => todo.id,
				sync: {
					sync: () => {
						// Don't mark ready
					},
				},
				startSync: true,
				gcTime: 0,
			}

			const initialCol = createCollection(config)
			const initialAtom = makeCollectionAtom(initialCol)

			const initialResult = registry.get(initialAtom)
			const initialMsg = Result.match(initialResult, {
				onInitial: () => "waiting",
				onFailure: () => "failed",
				onSuccess: () => "success",
			})

			expect(initialMsg).toBe("waiting")
		})
	})

	describe("makeQueryUnsafe with Result operations", () => {
		it("should return undefined on failure/initial state", async () => {
			const registry = Registry.make()

			// Test with initial state - create a collection that never marks ready
			const config: any = {
				id: "todos",
				getKey: (todo: Todo) => todo.id,
				sync: {
					sync: () => {
						// Don't mark ready - stays in initial state
					},
				},
				startSync: true,
				gcTime: 0,
			}

			const collection = createCollection(config)
			const todosAtom = makeQueryUnsafe((q) => q.from({ todos: collection }))

			await vi.runAllTimersAsync()

			const todos = registry.get(todosAtom)
			// Should be undefined when in initial/waiting state
			expect(todos).toBeUndefined()
		})

		it("should return value on success", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const todosAtom = makeQueryUnsafe((q) => q.from({ todos: collection }))

			await vi.runAllTimersAsync()

			const todos = registry.get(todosAtom)
			expect(todos).toBeDefined()
			expect(todos).toHaveLength(3)
		})
	})

	describe("makeQueryConditional with Result operations", () => {
		it("should return undefined when query is null", () => {
			const registry = Registry.make()

			const todosAtom = makeQueryConditional(() => null)

			const result = registry.get(todosAtom)
			expect(result).toBeUndefined()
		})

		it("should return Result when query is defined", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const todosAtom = makeQueryConditional((q) => q.from({ todos: collection }))

			await vi.runAllTimersAsync()

			const result = registry.get(todosAtom)
			expect(result).toBeDefined()
			expect(Result.isSuccess(result!)).toBe(true)
		})
	})

	describe("Result state transitions", () => {
		it("should transition from Initial to Success", async () => {
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
						// Don't mark ready yet
					},
				},
				startSync: true,
				gcTime: 0,
			}

			const collection = createCollection(config)
			const todosAtom = makeCollectionAtom(collection)

			const states: Array<string> = []

			// Set up subscription before checking initial state
			registry.subscribe(todosAtom, (result) => {
				if (Result.isInitial(result)) states.push("initial")
				if (Result.isSuccess(result)) states.push("success")
				if (Result.isFailure(result)) states.push("failure")
			})

			// Get initial value to trigger subscription
			const initialResult = registry.get(todosAtom)
			if (Result.isInitial(initialResult)) states.push("initial")

			await vi.runAllTimersAsync()

			// Should start in initial
			expect(states).toContain("initial")

			// Transition to success
			begin!()
			for (const todo of initialTodos) {
				write!({ type: "insert", value: todo })
			}
			commit!()
			markReady!()

			await vi.runAllTimersAsync()

			// Should now be in success
			expect(states).toContain("success")
		})
	})

	describe("Result with empty collections", () => {
		it("should be Success with empty array, not failure", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection<Todo>("todos", [], (todo) => todo.id)

			const todosAtom = makeCollectionAtom(collection)

			await vi.runAllTimersAsync()

			const result = registry.get(todosAtom)
			expect(Result.isSuccess(result)).toBe(true)

			if (Result.isSuccess(result)) {
				expect(result.value).toEqual([])
			}
		})
	})

	describe("Result with query filters", () => {
		it("should return Success with empty array when filter matches nothing", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const nonExistentAtom = makeQuery((q) =>
				q.from({ todos: collection }).where(({ todos }) => eq(todos.userId, "nonexistent")),
			)

			await vi.runAllTimersAsync()

			const result = registry.get(nonExistentAtom)
			expect(Result.isSuccess(result)).toBe(true)

			if (Result.isSuccess(result)) {
				expect(result.value).toEqual([])
			}
		})

		it("should return Success with filtered items when filter matches", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const user1TodosAtom = makeQuery((q) =>
				q.from({ todos: collection }).where(({ todos }) => eq(todos.userId, "user1")),
			)

			await vi.runAllTimersAsync()

			const result = registry.get(user1TodosAtom)
			expect(Result.isSuccess(result)).toBe(true)

			if (Result.isSuccess(result)) {
				expect(result.value).toHaveLength(2)
				expect(result.value.every((todo) => todo.userId === "user1")).toBe(true)
			}
		})
	})

	describe("Combining Result with Atom operations", () => {
		it("should work with Atom.map to transform Result", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const todosAtom = makeCollectionAtom(collection)

			// Map to count
			const countAtom = Atom.map(todosAtom, (result) =>
				Result.match(result, {
					onInitial: () => 0,
					onFailure: () => 0,
					onSuccess: (todos) => todos.value.length,
				}),
			)

			await vi.runAllTimersAsync()

			const count = registry.get(countAtom)
			expect(count).toBe(3)
		})

		it("should work with Atom.map to extract data safely", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const todosAtom = makeCollectionAtom(collection)

			// Extract titles safely
			const titlesAtom = Atom.map(todosAtom, (result) =>
				Result.getOrElse(result, () => []).map((todo) => todo.title),
			)

			await vi.runAllTimersAsync()

			const titles = registry.get(titlesAtom)
			expect(titles).toEqual(["Task 1", "Task 2", "Task 3"])
		})
	})

	describe("Result with single result queries", () => {
		it("should handle single result that exists", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const firstTodoAtom = makeQuery((q) =>
				q
					.from({ todos: collection })
					.where(({ todos }) => eq(todos.id, "1"))
					.orderBy(({ todos }) => todos.id)
					.limit(1),
			)

			// Ordered/limited queries settle asynchronously, so mount the atom to receive the ready update
			const unsubscribe = registry.subscribe(firstTodoAtom, () => {}, { immediate: true })
			await vi.runAllTimersAsync()

			const result = registry.get(firstTodoAtom)
			unsubscribe()
			expect(Result.isSuccess(result)).toBe(true)

			if (Result.isSuccess(result)) {
				expect(result.value).toHaveLength(1)
				expect(result.value[0]?.id).toBe("1")
			}
		})

		it("should handle single result that doesn't exist", async () => {
			const registry = Registry.make()
			const { collection } = createControlledCollection("todos", initialTodos, (todo) => todo.id)

			const nonExistentAtom = makeQuery((q) =>
				q
					.from({ todos: collection })
					.where(({ todos }) => eq(todos.id, "999"))
					.orderBy(({ todos }) => todos.id)
					.limit(1),
			)

			await vi.runAllTimersAsync()

			const result = registry.get(nonExistentAtom)
			expect(Result.isSuccess(result)).toBe(true)

			if (Result.isSuccess(result)) {
				expect(result.value).toEqual([])
			}
		})
	})
})
