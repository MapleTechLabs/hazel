import { HttpApi, OpenApi } from "effect/http-api"
import { AppApi, LinkPreviewGroup, TweetGroup } from "./declare"

export class LinkPreviewApi extends HttpApi.make("api")
	.add(AppApi)
	.add(LinkPreviewGroup)
	.add(TweetGroup)
	.annotateMerge(
		OpenApi.annotations({
			title: "Link Preview Worker API",
			description: "API for fetching link previews and tweet data",
		}),
	) {}
