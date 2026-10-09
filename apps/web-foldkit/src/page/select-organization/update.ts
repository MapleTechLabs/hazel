import { Option } from "effect"
import { modifyFields } from "foldkit/struct"
import { AppRoute, hrefOf, organizationHref } from "../../route"
import type { PageReturn } from "../contract"
import { PageOutMessage } from "../out-message"
import { Message } from "./message"
import type { Model } from "./model"

type Return = PageReturn<Model, Message>

const navigate = (model: Model, href: string): Return => ({
	model,
	outMessage: PageOutMessage.RequestedNavigation({ href, replace: false }),
})

export const init = (): Return => ({ model: { organizations: null, hasRedirected: false } })

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		UpdatedOrganizations: ({ organizations }) => {
			const next = modifyFields(model, { organizations: () => organizations })
			const [single] = organizations
			// `<Navigate>` with a single organization: there is nothing to pick.
			return organizations.length === 1 && single && !model.hasRedirected
				? navigate(modifyFields(next, { hasRedirected: () => true }), organizationHref(single))
				: { model: next }
		},
		ClickedOrganization: ({ organization }) => navigate(model, organizationHref(organization)),
		ClickedCreateNew: () =>
			navigate(model, hrefOf(AppRoute.Onboarding({ orgId: Option.none(), step: Option.none() }))),
		GotClerkMountMessage: () => ({ model }),
	})
