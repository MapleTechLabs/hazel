import { Context, Duration, Effect, Layer, Schema, type Scope } from "effect"
import type { EditorView } from "prosemirror-view"

/**
 * The live ProseMirror editors by id. An editor's Mount registers it for the element's lifetime;
 * Commands reach it through the `EditorRegistry` Resource and fail with `EditorNotMounted` when its
 * element is not in the DOM (a tab switched away, a closed palette).
 *
 * Mount `execute` cannot require services, so the Mounts register into the one `editorRegistry`
 * instance directly; `EditorRegistryLive` hands that same instance to Commands.
 *
 * A Command can run before the editor it targets has mounted (a key typed as a thread panel opens,
 * a focus right after the view that renders the editor): `get` waits a moment for it to register.
 */

export class EditorNotMounted extends Schema.TaggedError<EditorNotMounted>()("EditorNotMounted", {
	editorId: Schema.String,
}) {}

export interface EditorRegistryShape {
	/** Holds `view` under `editorId` until the scope closes (the Mount's lifetime). */
	readonly register: (editorId: string, view: EditorView) => Effect.Effect<void, never, Scope.Scope>
	readonly get: (editorId: string) => Effect.Effect<EditorView, EditorNotMounted>
}

/** How long `get` waits for an editor that has not mounted yet. */
const MOUNT_WAIT = Duration.millis(500)

const makeRegistry = (): EditorRegistryShape => {
	const editors = new Map<string, EditorView>()
	const waiters = new Map<string, Set<(view: EditorView) => void>>()
	const awaitMount = (editorId: string) =>
		Effect.callback<EditorView>((resume) => {
			// Checked in the same synchronous step that installs the waiter: no register slips between.
			const mounted = editors.get(editorId)
			if (mounted !== undefined) return resume(Effect.succeed(mounted))
			const waiting = waiters.get(editorId) ?? new Set()
			const waiter = (view: EditorView) => resume(Effect.succeed(view))
			waiting.add(waiter)
			waiters.set(editorId, waiting)
			return Effect.sync(() => {
				waiting.delete(waiter)
				if (waiting.size === 0) waiters.delete(editorId)
			})
		})
	return {
		register: (editorId, view) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					editors.set(editorId, view)
					const waiting = waiters.get(editorId)
					waiters.delete(editorId)
					if (waiting !== undefined) for (const waiter of waiting) waiter(view)
				}),
				() =>
					Effect.sync(() => {
						// A remounted editor may already have replaced this one.
						if (editors.get(editorId) === view) editors.delete(editorId)
					}),
			),
		get: (editorId) =>
			Effect.suspend(() => {
				const view = editors.get(editorId)
				return view === undefined
					? awaitMount(editorId).pipe(
							Effect.timeoutOrElse({
								duration: MOUNT_WAIT,
								orElse: () => Effect.fail(new EditorNotMounted({ editorId })),
							}),
						)
					: Effect.succeed(view)
			}),
	}
}

export const editorRegistry: EditorRegistryShape = makeRegistry()

export class EditorRegistry extends Context.Service<EditorRegistry, EditorRegistryShape>()(
	"EditorRegistry",
) {}

export const EditorRegistryLive = Layer.succeed(EditorRegistry, editorRegistry)

/** Run `f` on the live editor `editorId`. */
export const withEditor = <A>(editorId: string, f: (view: EditorView) => A) =>
	EditorRegistry.use((registry) => registry.get(editorId)).pipe(Effect.map(f))
