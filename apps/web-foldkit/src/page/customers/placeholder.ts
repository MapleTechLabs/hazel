import { Schema } from "effect"
import { Submodel } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import type { RouteOf, RouteTag } from "../../route"
import { definePage, type PageViewInputs } from "../contract"

/**
 * A registered customers page that is not built yet: it owns its routes (so the registry, the
 * sidebar and the lab already point at it) and renders a titled empty state. Replace the module's
 * `page` with a real `definePage` under the same id.
 */

const Model = Schema.Struct({})
const Message = defineMessageUnion({})

export const placeholderPage = <const Id extends string, Tags extends RouteTag>(
	id: Id,
	routes: ReadonlyArray<Tags>,
	title: string,
	options: { readonly key?: (route: RouteOf<Tags>) => string } = {},
) =>
	definePage(
		id,
		{ Model, Message },
		{
			routes,
			key: options.key,
			init: () => ({ model: {} }),
			update: (model) => ({ model }),
			routeChanged: (model) => ({ model }),
			view: Submodel.defineView<typeof Model.Type, typeof Message.Type, PageViewInputs>((_m, _i, h) =>
				h.div(
					[
						h.Class("flex h-full flex-col gap-1 px-8 py-6"),
						h.Attribute("data-page-placeholder", id),
					],
					[
						h.h1([h.Class("font-semibold text-2xl text-fg")], [title]),
						h.p([h.Class("text-muted-fg text-sm")], ["Coming soon."]),
					],
				),
			),
		},
	)
