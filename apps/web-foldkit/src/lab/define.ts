import { Effect, Layer, Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { NotificationSinks } from "../app/notification-sinks"
import { type Resources, ResourcesLive } from "../rpc"

/**
 * A lab entry is a self-contained Foldkit program booted on `/lab/<path>` instead of the app
 * (Maple's `apps/web/src/lab` pattern). Closing over the program keeps it typed; boot only needs
 * `start`. Commands get the app's Resources, so a page's real `update` can run; a lab stubs the
 * Commands that would reach the network.
 */
/** The app's resources, as `entry.ts` builds them. */
const resources = Layer.mergeAll(ResourcesLive, NotificationSinks.layer)

/** What a lab supplies; boot adds the container and the resources. */
type ProgramKeys = "Model" | "update" | "view" | "subscriptions"

export interface LabEntry {
	readonly title: string
	readonly start: (container: HTMLElement) => void
}

export const defineLab = <Model, Message extends { _tag: string }>(
	title: string,
	program: Pick<Runtime.ElementConfig<Model, Message, Resources>, ProgramKeys | "init">,
): LabEntry => ({
	title,
	start: (container) => {
		Runtime.run(Runtime.makeElement<Model, Message, Resources>({ ...program, container, resources }))
	},
})

/** `defineLab` for a program that reads the URL (`?state=`) or the clock through Flags before init. */
export const defineLabWithFlags = <Model, Message extends { _tag: string }, Flags>(
	title: string,
	program: Pick<
		Runtime.ElementConfigWithFlags<Model, Message, Flags, Resources>,
		ProgramKeys | "init" | "Flags" | "flags"
	>,
): LabEntry => ({
	title,
	start: (container) => {
		Runtime.run(
			Runtime.makeElement<Model, Message, Flags, Resources>({ ...program, container, resources }),
		)
	},
})

const Empty = Schema.Struct({})

/** A static lab's only Message: what its buttons send, and nothing handles. */
export const StaticMessage = defineMessageUnion({ Ignored: {} })
export type StaticMessage = typeof StaticMessage.Type
export const ignored: StaticMessage = StaticMessage.Ignored()

/** A lab with no state: a view over fixtures; buttons send `ignored`. */
export const defineStaticLab = (title: string, view: (h: HtmlBuilder<StaticMessage>) => Html): LabEntry =>
	defineLab(title, {
		Model: Empty,
		init: () => ({ model: {} }),
		update: (model: typeof Empty.Type, _message: StaticMessage) => ({ model }),
		view: (_model, h) => view(h),
	})

/** `?<name>=` from the page URL, if it is one of `values`, else `fallback`. */
export const queryParam = <A extends string>(
	name: string,
	values: ReadonlyArray<A>,
	fallback: A,
): Effect.Effect<A> =>
	Effect.sync(() => {
		const value = new URLSearchParams(window.location.search).get(name)
		return values.find((candidate) => candidate === value) ?? fallback
	})
