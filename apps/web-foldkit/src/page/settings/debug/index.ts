import { Schema } from "effect"
import { Submodel } from "foldkit"
import { AppRoute, hrefOf } from "../../../route"
import { definePage, type PageReturn, type PageViewInputs } from "../../contract"
import { PageOutMessage } from "../../out-message"

/**
 * `/$orgSlug/settings/debug`: production builds redirect to the general settings in `beforeLoad`.
 * The dev-only diagnostics tools are not ported; dev builds render the route's empty slot.
 */

const Model = Schema.Struct({})
type Model = typeof Model.Type
const Message = Schema.Never
type Message = typeof Message.Type

export const page = definePage(
	"SettingsDebug",
	{ Model, Message },
	{
		routes: ["SettingsDebug"],
		init: (route): PageReturn<Model, Message> =>
			import.meta.env.PROD
				? {
						model: {},
						outMessage: PageOutMessage.RequestedNavigation({
							href: hrefOf(AppRoute.SettingsGeneral({ orgSlug: route.orgSlug })),
							replace: true,
						}),
					}
				: { model: {} },
		update: (model): PageReturn<Model, Message> => ({ model }),
		view: Submodel.defineView<Model, Message, PageViewInputs>((_model, _inputs, h) =>
			h.div([h.DataAttribute("page-placeholder", "SettingsDebug")], []),
		),
	},
)
