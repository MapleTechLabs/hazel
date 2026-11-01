import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../../../styles.css"
import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Runtime } from "foldkit"
import { afterEach, expect, test } from "vitest"
import { page } from "vitest/browser"
import { makeShared, organizationId, uuid } from "../../../test/pages-fixtures"
import {
	connection,
	guild,
	slackChannels,
	slackConnection,
	slackSyncConnectionId,
	slackWorkspace,
} from "../../../test/pages-integrations-fixtures"
import * as Modal from "../../../ui/modal"
import * as ConnectionPage from "../chat-sync-connection/model"
import { init as initConnection, update as updateConnection } from "../chat-sync-connection/update"
import { view as connectionView } from "../chat-sync-connection/view"
import type { PageViewInputs, Shared } from "../../contract"
import { Message, type Model, Model as ListModel } from "./model"
import { Workspaces } from "./providers"
import { init, update } from "./update"
import { view } from "./view"

/**
 * The chat sync pages with Slack next to Discord, screenshotted in light and dark (`bun run gallery`):
 * `chat-sync-<screen>-<theme>.png` beside this file's working directory.
 */

const shared = makeShared()
const inputs = { shared }

const listStep = (model: Model, message: Message) => update(model, message, shared).model
const listed = [
	Message.SucceededListConnections({ organizationId, connections: [connection, slackConnection] }),
	Message.SucceededListWorkspaces({ organizationId, version: 1, workspaces: [guild] }),
].reduce(listStep, init(undefined, shared).model)
const withSlackModal = (workspaces: Model["workspaces"]): Model => ({
	...listed,
	addModal: Modal.open(listed.addModal).model,
	addProvider: "slack",
	workspaces,
})

const hazelChannel = { id: Schema.decodeSync(ChannelId)(uuid(41)), name: "engineering" }
const connectionStep = (model: ConnectionPage.Model, message: ConnectionPage.Message) =>
	updateConnection(model, message, shared).model
const slackPage = [
	ConnectionPage.Message.SucceededListConnections({ organizationId, connections: [slackConnection] }),
	ConnectionPage.Message.SucceededListExternalChannels({
		workspaceId: slackConnection.externalWorkspaceId,
		channels: slackChannels,
	}),
	ConnectionPage.Message.UpdatedHazelChannels({ channels: [hazelChannel] }),
	ConnectionPage.Message.SucceededListChannelLinks({ version: 1, links: [] }),
	ConnectionPage.Message.ClickedHazelChannel({ channel: hazelChannel }),
].reduce(
	connectionStep,
	initConnection(
		{ _tag: "SettingsChatSyncConnection", orgSlug: "hazel", connectionId: slackSyncConnectionId },
		shared,
	).model,
)
const slackChannelPicker = { ...slackPage, addLinkModal: Modal.open(slackPage.addLinkModal).model }

/** The page view inside the gallery frame (the viewport's size, so the open dialogs land inside it). */
const frame = <M>(h: HtmlBuilder<M>, content: Html): Html =>
	h.div(
		[
			h.Id("gallery"),
			h.Class("h-[640px] w-[1180px] overflow-hidden bg-bg p-8 font-sans text-fg antialiased"),
		],
		[content],
	)

/**
 * Mounts a page on Foldkit's runtime, so its Mounts run (the dialogs open themselves). Messages update the
 * model; their Commands are dropped, as the gallery has no server.
 */
const mount = <PageModel, PageMessage extends { readonly _tag: string }>(
	options: Readonly<{
		Model: Schema.Codec<PageModel, unknown, never, never>
		model: PageModel
		update: (model: PageModel, message: PageMessage, shared: Shared) => { readonly model: PageModel }
		view: (model: PageModel, inputs: PageViewInputs, h: HtmlBuilder<PageMessage>) => Html
	}>,
) => {
	const container = document.createElement("div")
	container.id = "app"
	document.body.append(container)
	Runtime.run(
		Runtime.makeElement({
			Model: options.Model,
			init: () => ({ model: options.model }),
			update: (model: PageModel, message: PageMessage) => ({
				model: options.update(model, message, shared).model,
			}),
			view: (model: PageModel, h: HtmlBuilder<PageMessage>) => frame(h, options.view(model, inputs, h)),
			container,
		}),
	)
}

const listPage = (model: Model) => () => mount({ Model: ListModel, model, update, view })

const screens: ReadonlyArray<readonly [string, () => void]> = [
	["list", listPage(listed)],
	["add-slack", listPage(withSlackModal(Workspaces.Success({ data: [slackWorkspace] })))],
	["slack-connect-first", listPage(withSlackModal(Workspaces.Failure({ error: "NotConnected" })))],
	[
		"slack-channel-picker",
		() =>
			mount({
				Model: ConnectionPage.Model,
				model: slackChannelPicker,
				update: updateConnection,
				view: connectionView,
			}),
	],
]

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

for (const [name, screen] of screens) {
	for (const theme of ["light", "dark"] as const) {
		test(`${name} ${theme}`, async () => {
			if (theme === "dark") document.documentElement.classList.add("dark")
			screen()
			await expect.poll(() => document.getElementById("gallery")).toBeTruthy()
			// Let the dialog Mounts open and the fonts settle.
			await new Promise((resolve) => setTimeout(resolve, 300))
			await document.fonts.ready
			await page.screenshot({
				path: `chat-sync-${name}-${theme}.png`,
				element: document.getElementById("gallery")!,
			})
		})
	}
}
