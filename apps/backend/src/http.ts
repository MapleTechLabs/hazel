import { Layer } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HazelApi } from "./api"
import { HttpApiV1IntegrationsLive, HttpMessagesApiLive } from "./routes/api-v1"
import { HttpKlipyLive } from "./routes/klipy.http"
import { HttpChatSyncLive } from "./routes/chat-sync.http"
import { HttpBotCommandsLive } from "./routes/bot-commands.http"
import { HttpIncomingWebhookLive } from "./routes/incoming-webhooks.http"
import { HttpIntegrationCommandLive } from "./routes/integration-commands.http"
import { HttpIntegrationResourceLive } from "./routes/integration-resources.http"
import { HttpIntegrationLive } from "./routes/integrations.http"
import { HttpInternalLive } from "./routes/internal.http"
import { HttpMockDataLive } from "./routes/mock-data.http"
import { HttpPresencePublicLive } from "./routes/presence.http"
import { HttpRootLive } from "./routes/root.http"
import { HttpUploadsLive } from "./routes/uploads.http"
import { HttpWebhookLive } from "./routes/webhooks.http"

export const HttpApiRoutes = HttpApiBuilder.layer(HazelApi).pipe(
	Layer.provide(HttpRootLive),
	Layer.provide(HttpMessagesApiLive),
	Layer.provide(HttpApiV1IntegrationsLive),
	Layer.provide(HttpBotCommandsLive),
	Layer.provide(HttpChatSyncLive),
	Layer.provide(HttpIntegrationLive),
	Layer.provide(HttpIntegrationCommandLive),
	Layer.provide(HttpIntegrationResourceLive),
	Layer.provide(HttpIncomingWebhookLive),
	Layer.provide(HttpInternalLive),
	Layer.provide(HttpPresencePublicLive),
	Layer.provide(HttpUploadsLive),
	Layer.provide(HttpWebhookLive),
	Layer.provide(HttpKlipyLive),
	Layer.provide(HttpMockDataLive),
)
