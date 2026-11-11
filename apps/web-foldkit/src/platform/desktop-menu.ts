import { getTauriEvent } from "@hazel/desktop/bridge"
import { Effect, Queue, Schema, Stream } from "effect"
import { isDesktop } from "./desktop"

/** The desktop app menu's items, as the Tauri host reports them (legacy `TauriMenuListener`). */
export const DesktopMenuItem = Schema.Literals(["OpenSettings", "CheckForUpdates", "NewChannel", "Invite"])
export type DesktopMenuItem = typeof DesktopMenuItem.Type

const events: ReadonlyArray<readonly [string, DesktopMenuItem]> = [
	["menu-open-settings", "OpenSettings"],
	["menu-check-updates", "CheckForUpdates"],
	["menu-new-channel", "NewChannel"],
	["menu-invite", "Invite"],
]

/** The Tauri host refused a menu event listener. */
class MenuListenError extends Schema.TaggedError<MenuListenError>()("MenuListenError", {
	event: Schema.String,
	cause: Schema.Defect(),
}) {}

/** Every menu item the user picks; empty outside the desktop app. A listener that fails is skipped. */
export const desktopMenuItems: Stream.Stream<DesktopMenuItem> = Stream.callback<DesktopMenuItem>((queue) =>
	Effect.suspend(() => {
		const event = getTauriEvent()
		if (!isDesktop || event === undefined) return Effect.void
		return Effect.forEach(
			events,
			([name, item]) =>
				Effect.acquireRelease(
					Effect.tryPromise({
						try: () => event.listen(name, () => Queue.offerUnsafe(queue, item)),
						catch: (cause) => new MenuListenError({ event: name, cause }),
					}),
					(unlisten) => Effect.sync(unlisten),
				).pipe(
					Effect.catchTag("MenuListenError", (error) =>
						Effect.logWarning("[desktop-menu] listener unavailable", error.event),
					),
				),
			{ discard: true },
		)
	}).pipe(Effect.andThen(Effect.never)),
)
