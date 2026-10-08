import { ChannelId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import type { PageReturn, PageViewInputs, Shared } from "../page/contract"
import { sharedDefaults } from "../page/test-shared"
import type { CurrentUser, Member, Organization } from "../session"
import type { ToastRequest } from "../overlay/toasts"
import * as Modal from "../ui/modal"

/** Shared fixtures for page Story and Scene tests (`src/page/**`, excluding chat). */

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

export const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
export const memberId = Schema.decodeSync(OrganizationMemberId)(uuid(2))
export const userId = Schema.decodeSync(UserId)(uuid(3))
export const channelId = Schema.decodeSync(ChannelId)(uuid(4))

export const organization: Organization = { id: organizationId, name: "Hazel Labs", slug: "hazel", logoUrl: null }

export const currentUser: CurrentUser = {
	id: userId,
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	isOnboarded: true,
	organizationId,
}

export const memberWithRole = (role: Member["role"]): Member => ({ id: memberId, role })

/** A signed-in owner of "Hazel Labs"; override any field per test. */
export const makeShared = (overrides: Partial<Shared> = {}): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser,
	organization,
	member: memberWithRole("owner"),
	nowMs: 0,
	...sharedDefaults,
	...overrides,
})

type PageUpdate<Model, Message> = (model: Model, message: Message, shared: Shared) => PageReturn<Model, Message>
type PageView<Model, Message> = (model: Model, viewInputs: PageViewInputs, h: HtmlBuilder<Message>) => Html

/** Binds a page's `update` to one `Shared` for Story. */
export const storyUpdate =
	<Model, Message>(update: PageUpdate<Model, Message>, shared: Shared) =>
	(model: Model, message: Message) =>
		update(model, message, shared)

/** A Scene config for a page: `update` and the page view, both reading the same `Shared`. */
export const pageScene = <Model, Message>(
	update: PageUpdate<Model, Message>,
	view: PageView<Model, Message>,
	shared: Shared,
) => ({
	update: storyUpdate(update, shared),
	view: Scene.withViewInputs(view, { shared })(),
})

/** Acknowledges the overlay Mount every open `ui/modal` dialog renders. */
export const portalModalMounted = Scene.Mount.resolve(Modal.PortalModal, Modal.Message.CompletedPortalModal())

/** A server failure toast, as a Command's `failureToast` would build it. */
export const failureToastFixture: ToastRequest = {
	intent: "error",
	title: "Something went wrong",
	description: "Please try again.",
}
