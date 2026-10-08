import { Effect, Schema } from "effect"
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

type MountFn = (element: HTMLDivElement, props: ClerkProps) => void
type UnmountFn = (element: HTMLDivElement) => void

const methodsOf = (component: ClerkComponent) =>
	({
		SignIn: ["mountSignIn", "unmountSignIn"],
		SignUp: ["mountSignUp", "unmountSignUp"],
		CreateOrganization: ["mountCreateOrganization", "unmountCreateOrganization"],
	})[component]

const clerkMethod = <Fn>(name: string): Fn | undefined => {
	const clerk: object | undefined = window.Clerk
	if (!clerk || !(name in clerk)) return undefined
	const method: unknown = Reflect.get(clerk, name)
	return typeof method === "function" ? (method.bind(clerk) as Fn) : undefined
}

export const MountClerkComponent = Mount.define("MountClerkComponent", {
	args: { component: ClerkComponent, props: ClerkProps },
	messages: [ClerkMountMessage.MountedClerkComponent, ClerkMountMessage.FailedMountClerkComponent],
	execute: ({ element, component, props }) => {
		const [mountName, unmountName] = methodsOf(component)
		const mount = clerkMethod<MountFn>(mountName)
		const unmount = clerkMethod<UnmountFn>(unmountName)
		if (!mount || !(element instanceof HTMLDivElement))
			return Effect.succeed(ClerkMountMessage.FailedMountClerkComponent({ component }))
		return Effect.acquireRelease(
			Effect.sync(() => mount(element, props)),
			() => Effect.sync(() => unmount?.(element)),
		).pipe(Effect.as(ClerkMountMessage.MountedClerkComponent({ component })))
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
