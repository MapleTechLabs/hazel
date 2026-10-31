import { HttpApi, OpenApi } from "effect/http-api"
import { IntegrationsApiGroup as ApiV1IntegrationsApiGroup } from "./api-v1/integrations"
import { MessagesApiGroup } from "./api-v1/messages"
import { BotCommandsApiGroup } from "./bot-commands"
import { IncomingWebhookGroup } from "./incoming-webhooks"
import { IntegrationCommandGroup } from "./integration-commands"
import { IntegrationResourceGroup } from "./integration-resources"
import { IntegrationGroup } from "./integrations"
import { PresencePublicGroup } from "./presence"
import { RootGroup } from "./root"
import { T3CodeGroup } from "./t3code"
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
	.add(T3CodeGroup)
	.add(IntegrationCommandGroup)
	.add(IntegrationResourceGroup)
	.add(IncomingWebhookGroup)
	.add(UploadsGroup)
	.add(KlipyGroup)
	.add(WebhookGroup)
	.annotateMerge(
		OpenApi.annotations({
			title: "Hazel Chat API",
			description: "API for the Hazel chat application",
			version: "1.0.0",
		}),
	) {}
