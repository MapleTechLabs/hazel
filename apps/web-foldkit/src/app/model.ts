import { Schema } from "effect"
import * as CommandPalette from "../overlay/command-palette"
import * as Modal from "../overlay/modal"
import * as Toasts from "../overlay/toasts"
import type { PageHost, Shared } from "../page/contract"
import { PageSlot } from "../page/registry"
import { AppRoute, orgSectionOf, orgSlugOf } from "../route"
import { Auth, CurrentUser, Member, Organization } from "../session"
import * as Shell from "../shell/model"
import type { Context as ShellUpdateContext } from "../shell/update"
import { can } from "../page/contract"

/** The root Model: route, session, the active page, the shell and the overlay slots. */
export const Model = Schema.Struct({
	route: AppRoute,
	pathname: Schema.String,
	/** `pathname + search`, for `redirect_url`. */
	currentUrl: Schema.String,
	auth: Auth,
	currentUser: Schema.NullOr(CurrentUser),
	organization: Schema.NullOr(Organization),
	member: Schema.NullOr(Member),
	nowMs: Schema.Number,
	page: Schema.NullOr(PageSlot),
	shell: Shell.Model,
	modal: Modal.Model,
	commandPalette: CommandPalette.Model,
	toasts: Toasts.Model,
})
export type Model = typeof Model.Type

export const sharedOf = (model: Model): Shared => ({
	auth: model.auth,
	orgSlug: orgSlugOf(model.route) ?? null,
	currentUser: model.currentUser,
	organization: model.organization,
	member: model.member,
	nowMs: model.nowMs,
	isMobile: model.shell.isMobile,
})

export const pageHostOf = (model: Model): PageHost => ({ page: model.page, shared: sharedOf(model) })

export const shellContextOf = (model: Model): ShellUpdateContext => ({
	orgSlug: orgSlugOf(model.route) ?? null,
	isChatSection: orgSectionOf(model.route) === "Chat",
	canCreateChannel: can(sharedOf(model), "channel.create"),
	organizationId: model.organization?.id ?? null,
	currentUserId: model.currentUser?.id ?? null,
})
