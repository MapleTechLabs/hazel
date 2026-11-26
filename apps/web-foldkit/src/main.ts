/**
 * The Foldkit host: the pages and overlays not yet on Effect UI, as one embedded Foldkit program the
 * Effect UI shell starts (`src/root/foldkit.ts`). A page moves to the shell by leaving the registry.
 */
import { Effect, Layer, Schema } from "effect"
import { Runtime } from "foldkit"
import * as AiPanel from "./assistant"
import { hostOut } from "./app/command"
import { HostContextSchema } from "./app/context"
import { Message } from "./app/message"
import { Model } from "./app/model"
import { hostContext, subscriptions } from "./app/subscription"
import { init, update } from "./app/update"
import { view } from "./app/view"
import { viewTransition } from "./app/view-transition"
import { NotificationSinks } from "./app/notification-sinks"
import { ResourcesLive } from "./rpc"
import * as PendingAnnouncement from "./ui/aria/pending-announcement"

export { Message, Model, subscriptions, update, view }

/** What the host starts from: the shell's context at mount, and what was stored for the host's parts. */
export const HostFlags = Schema.Struct({
	context: HostContextSchema,
	isCreateChannelHintDismissed: Schema.Boolean,
	aiPanel: AiPanel.Stored,
})
export type HostFlags = typeof HostFlags.Type

export const hostPorts = { inbound: { context: hostContext }, outbound: { out: hostOut } }

/** The program, rendering into `container` (a hidden element whose regions the shell adopts). */
export const makeHost = (container: HTMLElement, flags: HostFlags) =>
	Runtime.makeElement({
		Model,
		Flags: HostFlags,
		flags: Effect.succeed(flags),
		init: (flags: HostFlags) => init(flags.context, flags),
		update,
		view,
		subscriptions,
		ports: hostPorts,
		resources: Layer.mergeAll(ResourcesLive, NotificationSinks.layer, PendingAnnouncement.layer),
		container,
		// An image viewer opening or closing morphs its image to and from the page.
		viewTransition,
		devTools: { Message },
	})
