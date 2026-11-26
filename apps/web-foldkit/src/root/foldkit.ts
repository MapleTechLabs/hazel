// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The adapter: every page not yet on Effect UI, with the Foldkit overlays and sidebars, runs as one
 * embedded Foldkit program (`../main.ts`). `RunFoldkitHost` owns its lifetime and ports; each
 * `AdoptRegion` moves one of its regions into the shell's frame. The last lane deletes this file.
 */
import { Mount } from "@effect/ui"
import { Effect, Queue, Schema, Stream } from "effect"
import { Runtime } from "foldkit"
import { HostContextSchema, type HostOut } from "../app/context"
import { REGION_ATTRIBUTE, type Region } from "../app/view"
import * as AiPanel from "../assistant"
import { makeHost } from "../main"

const HOST_ATTRIBUTE = "data-foldkit-host"

/**
 * Starts the Foldkit host in the element, sends it each render's context, and reports what it asks
 * for. The flags are read once, at start; a remount starts the host over.
 */
export const RunFoldkitHost = Mount.makeStream(
	"RunFoldkitHost",
	{
		args: {
			context: HostContextSchema,
			isCreateChannelHintDismissed: Schema.Boolean,
			aiPanel: AiPanel.Stored,
		},
	},
	(node: HTMLElement, args, changes) =>
		Stream.callback<HostOut>((queue) =>
			Effect.gen(function* () {
				const container = node.ownerDocument.createElement("div")
				// Foldkit keys its development Model preservation on the container's id.
				container.id = "foldkit-host"
				node.appendChild(container)
				const handle = yield* Effect.acquireRelease(
					Effect.sync(() => Runtime.embed(makeHost(container, args))),
					(handle) => Effect.promise(() => handle.disposeAsync()),
				)
				yield* Effect.acquireRelease(
					Effect.sync(() => handle.ports.out.subscribe((out) => Queue.offerUnsafe(queue, out as HostOut))),
					(unsubscribe) => Effect.sync(unsubscribe),
				)
				// `changes` starts with the current args, which the host already started from.
				yield* Stream.runForEach(Stream.drop(changes, 1), ({ context }) =>
					Effect.sync(() => handle.ports.context.send(context)),
				).pipe(Effect.forkScoped)
			}),
		),
)

/** Where a region is while no slot holds it: back in the host, so Foldkit still finds it in the page. */
const hostOf = (document: Document) => document.querySelector(`[${HOST_ATTRIBUTE}]`)

const regionOf = (document: Document, region: Region) =>
	hostOf(document)?.querySelector(`:scope > [${REGION_ATTRIBUTE}="${region}"]`) ??
	document.querySelector(`[${REGION_ATTRIBUTE}="${region}"]`)

/**
 * Watches the document and runs `place` after each change, at most once a frame, while the mount
 * lives; `place` returns true once there is nothing left to watch for.
 */
const whileMounted = (document: Document, place: () => void, release: () => void) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			let frame = 0
			const view = document.defaultView
			const schedule = () => {
				if (frame !== 0) return
				frame = view?.requestAnimationFrame(() => {
					frame = 0
					place()
				}) ?? 0
			}
			const observer = new MutationObserver(schedule)
			observer.observe(document.body, { childList: true, subtree: true })
			place()
			return () => {
				observer.disconnect()
				if (frame !== 0) view?.cancelAnimationFrame(frame)
			}
		}),
		(stop) =>
			Effect.sync(() => {
				stop()
				release()
			}),
	)

/** Moves the host's `region` into this element, and back to the host when the element goes. */
export const AdoptRegion = Mount.makeStream(
	"AdoptRegion",
	{ args: { region: Schema.String } },
	(node: HTMLElement, { region }) =>
		Stream.unwrap(
			whileMounted(
				node.ownerDocument,
				() => {
					const element = regionOf(node.ownerDocument, region as Region)
					if (element !== null && element.parentElement !== node) node.appendChild(element)
				},
				() => {
					const element = node.querySelector(`:scope > [${REGION_ATTRIBUTE}="${region}"]`)
					const host = hostOf(node.ownerDocument)
					if (element !== null && host !== null) host.appendChild(element)
				},
			).pipe(Effect.as(Stream.never)),
		),
)
