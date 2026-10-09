import { Duration, Effect, Option, Schema } from "effect"
import { Mount } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"

/**
 * Clerk's prebuilt components through clerk-js's vanilla API (`Clerk.mountSignIn(el, props)`), on the
 * same `data-clerk-component` container `@clerk/react` renders. Unmounted when the element leaves.
 */

export const ClerkComponent = Schema.Literals(["SignIn", "SignUp", "CreateOrganization"])
export type ClerkComponent = typeof ClerkComponent.Type

const ClerkProps = Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean]))
type ClerkProps = typeof ClerkProps.Type

export const ClerkMountMessage = defineMessageUnion({
	MountedClerkComponent: { component: ClerkComponent },
	FailedMountClerkComponent: { component: ClerkComponent },
})
export type ClerkMountMessage = typeof ClerkMountMessage.Type
/** `ClerkMountMessage` under the Submodel name, so a parent's Got wrapper imports it as `Message`. */
export { ClerkMountMessage as Message }

type ClerkFn = (...args: ReadonlyArray<unknown>) => unknown

const methodsOf = (component: ClerkComponent) =>
	({
		SignIn: ["mountSignIn", "unmountSignIn"],
		SignUp: ["mountSignUp", "unmountSignUp"],
		CreateOrganization: ["mountCreateOrganization", "unmountCreateOrganization"],
	})[component]

/** A loaded Clerk's method, bound to Clerk; `None` until `window.Clerk` has loaded. */
const loadedClerkMethod = (name: string): Option.Option<ClerkFn> => {
	const clerk = window.Clerk
	if (!clerk?.loaded || !(name in clerk)) return Option.none()
	const method: unknown = Reflect.get(clerk, name)
	return typeof method === "function"
		? Option.some((...args) => Reflect.apply(method, clerk, args))
		: Option.none()
}

const POLL_INTERVAL = Duration.millis(50)
const MAX_POLLS = 200

/** Clerk may load after the element mounts: poll for it (about 10s) instead of giving up at once. */
const awaitClerkMethod = (name: string, pollsLeft = MAX_POLLS): Effect.Effect<Option.Option<ClerkFn>> =>
	Effect.suspend(() => {
		const method = loadedClerkMethod(name)
		return Option.isSome(method) || pollsLeft <= 0
			? Effect.succeed(method)
			: Effect.sleep(POLL_INTERVAL).pipe(Effect.andThen(awaitClerkMethod(name, pollsLeft - 1)))
	})

export const MountClerkComponent = Mount.define("MountClerkComponent", {
	args: { component: ClerkComponent, props: ClerkProps },
	messages: [ClerkMountMessage.MountedClerkComponent, ClerkMountMessage.FailedMountClerkComponent],
	execute: ({ element, component, props }) => {
		const [mountName, unmountName] = methodsOf(component)
		const failed = ClerkMountMessage.FailedMountClerkComponent({ component })
		if (!(element instanceof HTMLDivElement)) return Effect.succeed(failed)
		return awaitClerkMethod(mountName).pipe(
			Effect.flatMap(
				Option.match({
					onNone: () => Effect.succeed(failed),
					onSome: (mount) =>
						Effect.acquireRelease(
							Effect.try({ try: () => mount(element, props), catch: () => failed }),
							() =>
								Effect.sync(() =>
									Option.map(loadedClerkMethod(unmountName), (unmount) => unmount(element)),
								),
						).pipe(
							Effect.as(ClerkMountMessage.MountedClerkComponent({ component })),
							Effect.catch(Effect.succeed),
						),
				}),
			),
		)
	},
})

/** `<SignIn>`, `<SignUp>` and `<CreateOrganization>`: the container element plus its Mount. */
export const clerkComponent = <Message>(
	h: HtmlBuilder<Message>,
	component: ClerkComponent,
	props: ClerkProps,
	toMessage: (message: ClerkMountMessage) => Message,
): Html =>
	h.div([
		h.Attribute("data-clerk-component", component),
		h.OnMount(Mount.mapMessage(MountClerkComponent({ component, props }), toMessage)),
	])
