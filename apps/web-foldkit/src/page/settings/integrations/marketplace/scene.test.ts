// @vitest-environment jsdom
import { BotId } from "@hazel/schema"
import { Schema } from "effect"
import {
	click,
	Command,
	expect as expectView,
	expectOutMessage,
	given,
	placeholder,
	role,
	scene,
	Subscription,
	text,
	type as typeInto,
} from "foldkit/scene"
import { describe, test } from "vitest"
import type { Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { errorToast, successToast } from "../../../../data/actions"
import { Message } from "./message"
import type { Model } from "./model"
import { InstallBot, init, update } from "./update"
import { view } from "./view"
import { sharedDefaults } from "../../../test-shared"

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: null,
	member: null,
	nowMs: 0,
	...sharedDefaults,
}

const botId = Schema.decodeSync(BotId)("00000000-0000-4000-8000-000000000001")
const deployBot = {
	id: botId,
	name: "Deploy Bot",
	description: "Posts deploy status.",
	isPublic: true,
	scopes: ["messages:read"],
	allowedIntegrations: [],
	avatarUrl: null,
	installCount: 1200,
	creatorName: "Ada Lovelace",
}

const loaded: Model = { ...init().model, bots: [deployBot] }
const config = { update, view: (model: Model, h: Parameters<typeof view>[2]) => view(model, { shared }, h) }

describe("marketplace page", () => {
	test("installs a bot and reports the failure toast, re-enabling the button", () => {
		const toast = errorToast(
			"Already installed",
			"This application is already installed in your workspace.",
		)
		scene(
			config,
			given(loaded),
			click(role("button", { name: "Install" })),
			Command.expectExact(InstallBot({ botId })),
			expectView(role("button", { name: "Installing..." })).toBeDisabled(),
			Command.resolve(InstallBot, Message.FailedInstallBot({ botId, toast })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast })),
			expectView(role("button", { name: "Install" })).toBeEnabled(),
		)
	})

	test("a successful install shows the success toast", () => {
		scene(
			config,
			given(loaded),
			click(role("button", { name: "Install" })),
			Command.resolve(InstallBot, Message.SucceededInstallBot({ botId })),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Application installed successfully") }),
			),
		)
	})

	test("search narrows the list and explains an empty result", () => {
		scene(
			config,
			given(loaded),
			typeInto(placeholder("Search applications..."), "no such app"),
			expectView(role("heading", { name: "No applications found" })).toExist(),
			expectView(role("heading", { name: "Deploy Bot" })).toBeAbsent(),
		)
	})
})

describe("marketplace live data", () => {
	test("the list waits for the public bots, and an installed bot shows Installed", () => {
		scene(
			config,
			given(init().model),
			expectView(role("heading", { name: "Deploy Bot" })).toBeAbsent(),
			Subscription.emit(Message.UpdatedPublicBots({ bots: [deployBot] })),
			expectView(role("heading", { name: "Deploy Bot" })).toExist(),
			expectView(role("button", { name: "Install" })).toBeEnabled(),
			Subscription.emit(Message.UpdatedInstalledBotIds({ botIds: [botId] })),
			expectView(role("button", { name: /Installed$/ })).toBeDisabled(),
			expectView(role("button", { name: "Install" })).toBeAbsent(),
		)
	})

	test("search matches the description, case-insensitively", () => {
		scene(
			config,
			given(loaded),
			typeInto(placeholder("Search applications..."), "DEPLOY STATUS"),
			expectView(role("heading", { name: "Deploy Bot" })).toExist(),
			expectView(text("Try a different search term")).toBeAbsent(),
		)
	})

	test("an empty marketplace invites publishing, not searching", () => {
		scene(
			config,
			given({ ...init().model, bots: [] }),
			expectView(text("Be the first to publish an application to the marketplace!")).toExist(),
		)
	})
})
