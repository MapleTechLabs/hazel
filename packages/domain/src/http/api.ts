import { HttpApi, OpenApi } from "effect/http-api"
import { ChatSyncGroup } from "./chat-sync"
import { IntegrationsApiGroup as ApiV1IntegrationsApiGroup } from "./api-v1/integrations"
import { MessagesApiGroup } from "./api-v1/messages"
import { BotCommandsApiGroup } from "./bot-commands"
import { IncomingWebhookGroup } from "./incoming-webhooks"
import { IntegrationCommandGroup } from "./integration-commands"
import { IntegrationResourceGroup } from "./integration-resources"
import { IntegrationGroup } from "./integrations"
import { InternalApiGroup } from "./internal"
import { MockDataGroup } from "./mock-data"
import { PresencePublicGroup } from "./presence"
import { RootGroup } from "./root"
import { KlipyGroup } from "./klipy"
import { UploadsGroup } from "./uploads"
import { WebhookGroup } from "./webhooks"

export class HazelApi extends HttpApi.make("HazelApp")
	.add(MessagesApiGroup)
	.add(ApiV1IntegrationsApiGroup)
	.add(BotCommandsApiGroup)
	.add(PresencePublicGroup)
	.add(RootGroup)
	.add(IntegrationGroup)
	.add(IntegrationCommandGroup)
	.add(IntegrationResourceGroup)
	.add(ChatSyncGroup)
	.add(IncomingWebhookGroup)
	.add(InternalApiGroup)
	.add(UploadsGroup)
	.add(KlipyGroup)
	.add(WebhookGroup)
	.add(MockDataGroup)
	.annotateMerge(
		OpenApi.annotations({
			title: "Hazel Chat API",
			description: "API for the Hazel chat application",
			version: "1.0.0",
		}),
	) {}
