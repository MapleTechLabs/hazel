import { HttpApiBuilder } from "effect/http-api"
import { Effect } from "effect"
import { LinkPreviewApi } from "./api"
import { HttpLinkPreviewLive } from "./handlers/link-preview"
import { HttpTweetLive } from "./handlers/tweet"

export const HttpAppLive = HttpApiBuilder.group(LinkPreviewApi, "app", (handles) =>
	handles.handle("health", () => Effect.succeed("ok")),
)

export { HttpLinkPreviewLive, HttpTweetLive }
