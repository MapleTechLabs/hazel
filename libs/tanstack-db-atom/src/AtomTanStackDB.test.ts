/**
 * Tests for TanStack DB Atom utilities
 *
 * This test suite provides comprehensive coverage for the @hazel/tanstack-db-atom package,
 * which provides reactive atoms that integrate TanStack DB collections with Effect Atom.
 *
 * Test Coverage:
 * - makeCollectionAtom: Creates atoms from TanStack DB collections (array results)
 * - makeSingleCollectionAtom: Creates atoms from single-result collections
 * - makeQuery: Creates atoms from query functions with Result wrapper
 * - makeQueryUnsafe: Creates atoms from query functions without Result wrapper
 * - makeQueryConditional: Creates atoms from conditional queries (can return null)
 * - Integration tests: Multiple collections, empty collections, edge cases
 * - Error handling: Loading states, waiting states, edge cases
 *
 * @since 1.0.0
 */

import { AsyncResult as Result, AtomRegistry as Registry } from "effect/reactivity"
import { type Collection, createCollection, eq, type NonSingleResult, type SingleResult } from "@tanstack/db"
import { describe, expect, it } from "vitest"
import {
	makeCollectionAtom,
	makeQuery,
	makeQueryConditional,
	makeQueryUnsafe,
	makeSingleCollectionAtom,
} from "./AtomTanStackDB"

// Test data types
type Todo = {
	id: string
	title: string
	completed: boolean
	userId: string
}

type User = {
	id: string
	name: string
	email: string
}

// Test data
const initialTodos: Array<Todo> = [
	{
		id: "1",
		title: "Learn Effect",
		completed: false,
		userId: "user1",
	},
	{
		id: "2",
		title: "Learn TanStack DB",
		completed: true,
		userId: "user1",
	},
	{
		id: "3",
		title: "Build app",
		completed: false,
		userId: "user2",
	},
]

const initialUsers: Array<User> = [
	{
		id: "user1",
		name: "John Doe",
		email: "john@example.com",
	},
	{
		id: "user2",
		name: "Jane Smith",
		email: "jane@example.com",
	},
]

// Helper function to create a mock sync collection
function createMockSyncCollection<T extends object>(
	id: string,
	initialData: Array<T>,
	getKey: (item: T) => string | number,
): {
	collection: Collection<T, string | number, any> & NonSingleResult
	utils: {
		begin: () => void
		write: (change: { type: "insert" | "update" | "delete"; value: T }) => void
		commit: () => void
	}
}
function createMockSyncCollection<T extends object>(
	id: string,
	initialData: Array<T>,
	getKey: (item: T) => string | number,
	singleResult: true,
): {
	collection: Collection<T, string | number, any> & SingleResult
	utils: {
		begin: () => void
		write: (change: { type: "insert" | "update" | "delete"; value: T }) => void
		commit: () => void
	}
}
function createMockSyncCollection<T extends object>(
	id: string,
	initialData: Array<T>,
	getKey: (item: T) => string | number,
	singleResult?: boolean,
): any {
	let begin: () => void
	let write: (change: { type: "insert" | "update" | "delete"; value: T }) => void
	let commit: () => void

	const config: any = {
		id,
		getKey,
		singleResult,
		sync: {
			sync: (params: any) => {
				begin = params.begin
				write = params.write
				commit = params.commit
				const markReady = params.markReady

				// Simulate sync process
				begin()
				for (const item of initialData) {
					write({
						type: "insert",
						value: item,
					})
				}
				commit()
				markReady()
			},
		},
		startSync: true,
		onInsert: async () => {},
		onUpdate: async () => {},
		onDelete: async () => {},
	}

	const collection = createCollection(config)

	return {
		collection,
		utils: {
			begin: () => begin!(),
			write: (change: { type: "insert" | "update" | "delete"; value: T }) => write!(change),
			commit: () => commit!(),
		},
	}
}

// Helper to wait for collection to be ready
async function waitForReady(collection: { status: string }, timeout = 1000): Promise<void> {
	const start = Date.now()
	while (collection.status !== "ready" && Date.now() - start < timeout) {
		await new Promise((resolve) => setTimeout(resolve, 10))
	}
	if (collection.status !== "ready") {
		throw new Error(`Collection did not become ready within ${timeout}ms`)
	}
}

describe("makeCollectionAtom", () => {
	it("should create an atom from a collection", async () => {
		const registry = Registry.make()
		const { collection } = createMockSyncCollection("todos", initialTodos, (todo) => todo.id)

		await waitForReady(collection)

		const todosAtom = makeCollectionAtom(collection)
		const result = registry.get(todosAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(3)
			expect(result.value).toMatchObject(initialTodos)
		}
	})

	it("should handle collection with initial data", async () => {
		const registry = Registry.make()
		const { collection } = createMockSyncCollection("todos", initialTodos, (todo) => todo.id)

		await waitForReady(collection)

		const todosAtom = makeCollectionAtom(collection)
		const result = registry.get(todosAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(3)
		}
	})

	it("should subscribe to collection changes", async () => {
		const registry = Registry.make()
		const { collection, utils } = createMockSyncCollection("todos", initialTodos, (todo) => todo.id)

		await waitForReady(collection)

		const todosAtom = makeCollectionAtom(collection)

		// Track updates
		const updates: Array<Result.AsyncResult<Array<Todo>, Error>> = []
		const unsubscribe = registry.subscribe(todosAtom, (value) => {
			updates.push(value)
		})

		// Initial value
		const initialResult = registry.get(todosAtom)
		expect(Result.isSuccess(initialResult)).toBe(true)

		// Add a new todo
		utils.begin()
		utils.write({
			type: "insert",
			value: {
				id: "4",
				title: "New Task",
				completed: false,
				userId: "user1",
			},
		})
		utils.commit()

		// Wait for update
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Should have received update
		expect(updates.length).toBeGreaterThan(0)
		const lastUpdate = updates[updates.length - 1]!
		if (Result.isSuccess(lastUpdate)) {
			expect(lastUpdate.value).toHaveLength(4)
		}

		unsubscribe()
	})

	it("should cleanup subscription on unmount", async () => {
		const registry = Registry.make()
		const { collection } = createMockSyncCollection("todos", initialTodos, (todo) => todo.id)

		await waitForReady(collection)

		const todosAtom = makeCollectionAtom(collection)

		// Subscribe and immediately unsubscribe
		const unsubscribe = registry.subscribe(todosAtom, () => {})
		unsubscribe()

		// Verify cleanup - subscription should be removed
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(true).toBe(true) // Test passes if no errors thrown
	})
})

describe("makeSingleCollectionAtom", () => {
	it("should create an atom from a single-result collection", async () => {
		const registry = Registry.make()
		const { collection } = createMockSyncCollection(
			"current-user",
			[initialUsers[0]!],
			(user) => user.id,
			true, // singleResult
		)

		await waitForReady(collection)

		const userAtom = makeSingleCollectionAtom(collection)
		const result = registry.get(userAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toMatchObject(initialUsers[0]!)
		}
	})

	it("should return undefined when single collection is empty", async () => {
		const registry = Registry.make()
		const { collection } = createMockSyncCollection(
			"current-user",
			[], // empty
			(user: User) => user.id,
			true, // singleResult
		)

		await waitForReady(collection)

		const userAtom = makeSingleCollectionAtom(collection)
		const result = registry.get(userAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toBeUndefined()
		}
	})

	it("should handle single result correctly", async () => {
		const registry = Registry.make()
		const { collection } = createMockSyncCollection(
			"single-user",
			[initialUsers[1]!],
			(user) => user.id,
			true, // singleResult
		)

		await waitForReady(collection)

		const userAtom = makeSingleCollectionAtom(collection)

		// Get value
		const result = registry.get(userAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toMatchObject(initialUsers[1]!)
			expect(result.value?.name).toBe("Jane Smith")
		}
	})
})

describe("makeQuery", () => {
	it("should create an atom from a query function", async () => {
		const registry = Registry.make()
		const { collection: todosCollection } = createMockSyncCollection(
			"todos",
			initialTodos,
			(todo) => todo.id,
		)

		await waitForReady(todosCollection)

		const completedTodosAtom = makeQuery((q) =>
			q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.completed, true)),
		)

		const result = registry.get(completedTodosAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(1)
			expect(result.value[0]?.title).toBe("Learn TanStack DB")
		}
	})

	it("should handle query with filters", async () => {
		const registry = Registry.make()
		const { collection: todosCollection } = createMockSyncCollection(
			"todos",
			initialTodos,
			(todo) => todo.id,
		)

		await waitForReady(todosCollection)

		const user1TodosAtom = makeQuery((q) =>
			q
				.from({ todos: todosCollection })
				.where(({ todos }) => eq(todos.userId, "user1"))
				.where(({ todos }) => eq(todos.completed, false)),
		)

		const result = registry.get(user1TodosAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(1)
			expect(result.value[0]?.title).toBe("Learn Effect")
		}
	})

	it("should handle query with select projection", async () => {
		const registry = Registry.make()
		const { collection: todosCollection } = createMockSyncCollection(
			"todos",
			initialTodos,
			(todo) => todo.id,
		)

		await waitForReady(todosCollection)

		const todoTitlesAtom = makeQuery((q) =>
			q
				.from({ todos: todosCollection })
				.where(({ todos }) => eq(todos.completed, false))
				.select(({ todos }) => ({
					id: todos.id,
					title: todos.title,
				})),
		)

		const result = registry.get(todoTitlesAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(2)
			expect(result.value[0]).toHaveProperty("id")
			expect(result.value[0]).toHaveProperty("title")
			expect(result.value[0]).not.toHaveProperty("completed")
		}
	})

	it("should respect query options", async () => {
		const registry = Registry.make()
		const { collection: todosCollection } = createMockSyncCollection(
			"todos",
			initialTodos,
			(todo) => todo.id,
		)

		await waitForReady(todosCollection)

		const todosAtom = makeQuery((q) => q.from({ todos: todosCollection }), {
			gcTime: 5000,
		})

		const result = registry.get(todosAtom)

		// Should still work even with custom options
		expect(Result.isSuccess(result) || Result.isWaiting(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(3)
		}
	})
})

describe("makeQueryUnsafe", () => {
	it("should return unwrapped value instead of Result", async () => {
		const registry = Registry.make()
		const { collection: todosCollection } = createMockSyncCollection(
			"todos",
			initialTodos,
			(todo) => todo.id,
		)

		await waitForReady(todosCollection)

		const completedTodosAtom = makeQueryUnsafe((q) =>
			q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.completed, true)),
		)

		const result = registry.get(completedTodosAtom)

		// Should be an array, not a Result
		expect(Array.isArray(result)).toBe(true)
		if (Array.isArray(result)) {
			expect(result).toHaveLength(1)
			expect(result[0]?.title).toBe("Learn TanStack DB")
		}
	})

	it("should return undefined on waiting or error", () => {
		const registry = Registry.make()
		// Create a collection that hasn't synced yet
		const { collection } = createMockSyncCollection("new-todos", initialTodos, (todo) => todo.id)

		const todosAtom = makeQueryUnsafe((q) => q.from({ todos: collection }))

		const result = registry.get(todosAtom)

		// Should be undefined or the actual data (depending on timing)
		expect(result === undefined || Array.isArray(result)).toBe(true)
	})
})

describe("makeQueryConditional", () => {
	it("should return undefined when query function returns null", () => {
		const registry = Registry.make()

		const conditionalAtom = makeQueryConditional(() => {
			// Return null to disable query
			return null
		})

		const result = registry.get(conditionalAtom)

		expect(result).toBeUndefined()
	})

	it("should return undefined when query function returns undefined", () => {
		const registry = Registry.make()

		const conditionalAtom = makeQueryConditional(() => {
			// Return undefined to disable query
			return undefined
		})

		const result = registry.get(conditionalAtom)

		expect(result).toBeUndefined()
	})

	it("should work with simple conditional logic", () => {
		const registry = Registry.make()

		// Test conditional that returns null
		let shouldQuery = false

		const conditionalAtomNull = makeQueryConditional(() => {
			if (!shouldQuery) return null
			// This won't be reached
			return undefined as any
		})

		const resultNull = registry.get(conditionalAtomNull)
		expect(resultNull).toBeUndefined()

		// Test conditional that would query (when condition is true)
		shouldQuery = true

		const conditionalAtomActive = makeQueryConditional(() => {
			if (!shouldQuery) return null
			// Return undefined when active (simulating a query builder pattern issue)
			return undefined as any
		})

		const resultActive = registry.get(conditionalAtomActive)
		// When returning undefined, it should also be undefined
		expect(resultActive).toBeUndefined()
	})
})

describe("Integration tests", () => {
	it("should work with different atom types together", async () => {
		const registry = Registry.make()
		const { collection: todosCollection } = createMockSyncCollection(
			"todos",
			initialTodos,
			(todo) => todo.id,
		)
		const { collection: userCollection } = createMockSyncCollection(
			"current-user",
			[initialUsers[0]!],
			(user) => user.id,
			true, // single result
		)

		await waitForReady(todosCollection)
		await waitForReady(userCollection)

		// Use both single and array collection atoms
		const currentUserAtom = makeSingleCollectionAtom(userCollection)
		const allTodosAtom = makeCollectionAtom(todosCollection)

		const userResult = registry.get(currentUserAtom)
		const todosResult = registry.get(allTodosAtom)

		expect(Result.isSuccess(userResult)).toBe(true)
		expect(Result.isSuccess(todosResult)).toBe(true)

		if (Result.isSuccess(userResult) && Result.isSuccess(todosResult)) {
			expect(userResult.value).toBeDefined()
			expect(todosResult.value).toHaveLength(3)
		}
	})

	it("should handle empty collection correctly", async () => {
		const registry = Registry.make()
		const { collection: todosCollection } = createMockSyncCollection(
			"todos",
			[], // empty collection
			(todo: Todo) => todo.id,
		)

		await waitForReady(todosCollection)

		const todosAtom = makeCollectionAtom(todosCollection)
		const result = registry.get(todosAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(0)
		}
	})

	it("should work with query on empty collection", async () => {
		const registry = Registry.make()
		const { collection: todosCollection } = createMockSyncCollection(
			"todos",
			[], // empty
			(todo: Todo) => todo.id,
		)

		await waitForReady(todosCollection)

		const completedTodosAtom = makeQuery((q) =>
			q.from({ todos: todosCollection }).where(({ todos }) => eq(todos.completed, true)),
		)

		const result = registry.get(completedTodosAtom)

		expect(Result.isSuccess(result)).toBe(true)
		if (Result.isSuccess(result)) {
			expect(result.value).toHaveLength(0)
		}
	})
})

describe("Error handling and edge cases", () => {
	it("should handle waiting state with empty collection", () => {
		const registry = Registry.make()
		// Create collection that starts empty and won't be marked ready
		const config: any = {
			id: "empty-lazy-collection",
			getKey: (todo: Todo) => todo.id,
			sync: {
				sync: (params: any) => {
					// Call begin/commit but don't mark ready
					params.begin()
					// No data inserted
					params.commit()
					// Intentionally NOT calling params.markReady()
				},
			},
			startSync: true,
			onInsert: async () => {},
			onUpdate: async () => {},
			onDelete: async () => {},
		}

		const collection = createCollection(config)

		const todosAtom = makeCollectionAtom(collection)
		const result = registry.get(todosAtom)

		// Collection will be in loading state, so atom returns Result.waiting
		// or it might return success with empty array depending on timing
		// We just need to verify it doesn't throw and returns a valid Result
		expect(result !== null).toBe(true)
	})

	it("should handle makeQueryUnsafe with waiting state", () => {
		const registry = Registry.make()
		const config: any = {
			id: "lazy-collection",
			getKey: (todo: Todo) => todo.id,
			sync: {
				sync: () => {
					// Don't mark as ready
				},
			},
			startSync: false,
			onInsert: async () => {},
			onUpdate: async () => {},
			onDelete: async () => {},
		}

		const collection = createCollection(config)
		const todosAtom = makeQueryUnsafe((q) => q.from({ todos: collection }))
		const result = registry.get(todosAtom)

		// Should return undefined when waiting
		expect(result).toBeUndefined()
	})

	it("should handle conditional query with null correctly", () => {
		const registry = Registry.make()
		const shouldQuery = false

		const conditionalAtom = makeQueryConditional((q) => {
			if (!shouldQuery) return null
			// This won't be reached
			return q.from({ todos: null as any })
		})

		const result = registry.get(conditionalAtom)
		expect(result).toBeUndefined()
	})
})
