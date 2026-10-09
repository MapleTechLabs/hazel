import { Schema } from "effect"
import { Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { AppRoute, hrefOf } from "../../../route"
import { definePage, type PageViewInputs } from "../../contract"
import { PageOutMessage } from "../../out-message"

/** `channels/$channelId/settings/index.tsx`: `beforeLoad` redirects to the overview tab. */

const Model = Schema.Struct({})
const Message = defineMessageUnion({})

export const page = definePage(
	"ChannelSettingsRedirect",
	{ Model, Message },
	{
		routes: ["ChannelSettings"],
		init: (route) => ({
			model: {},
			outMessage: PageOutMessage.RequestedNavigation({
				href: hrefOf(
					AppRoute.ChannelSettingsOverview({ orgSlug: route.orgSlug, channelId: route.channelId }),
				),
				replace: true,
			}),
		}),
		update: (model) => ({ model }),
		// `component: () => null`
		view: Submodel.defineView<typeof Model.Type, typeof Message.Type, PageViewInputs>(
			(_m, _i, h) => h.empty,
		),
	},
)
