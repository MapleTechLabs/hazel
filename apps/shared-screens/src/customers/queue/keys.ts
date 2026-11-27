// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The worklists' keyboard (Needs attention, the Support inbox): single keys no element hears. The
 * platform implements `QueueKeyboard` (the web: a document listener that skips typing, open dialogs
 * and menus, and Enter or Space on a focused control); the page names its keys in a `KeyTable`.
 */
import { Subscription } from "@effect/ui"
import { Context, Effect, Stream } from "effect"

/** `key` (`KeyboardEvent.key`, letters lower-cased) to the page's key; which repeat while held; which yield to a focused control. */
export interface KeyTable<K extends string> {
	readonly keys: ReadonlyMap<string, K>
	readonly repeatable: ReadonlySet<K>
	readonly pressable: ReadonlySet<K>
}

export class QueueKeyboard extends Context.Service<
	QueueKeyboard,
	{ readonly listen: <K extends string>(table: KeyTable<K>) => Stream.Stream<K> }
>()("hazel/customers/QueueKeyboard") {}

/** The page's keys as messages while `active`. */
export const queueKeys = <K extends string, M>(
	active: boolean,
	table: KeyTable<K>,
	toMessage: (key: K) => M,
) =>
	Subscription.make("queueKeys", [active], ([isActive]) =>
		isActive
			? Stream.unwrap(
					Effect.map(Effect.service(QueueKeyboard), (keyboard) =>
						keyboard.listen(table).pipe(Stream.map(toMessage)),
					),
				)
			: Stream.empty,
	)
