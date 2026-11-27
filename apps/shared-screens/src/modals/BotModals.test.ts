// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { BotId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { CopyToken } from "./bot-token"
import { CreateBot, CreateBotMessage, CreateBotModalNoDeps } from "./CreateBotModal"
import { DeleteBot, DeleteBotMessage, DeleteBotModalNoDeps } from "./DeleteBotModal"
import { ChangeBotAvatar, EditBotMessage, EditBotModalNoDeps, UpdateBot } from "./EditBotModal"
import { ModalEvents } from "./feedback"
import { InstallBotById, InstallBotByIdMessage, InstallBotByIdModalNoDeps } from "./InstallBotByIdModal"
import {
	RegenerateBotToken,
	RegenerateBotTokenMessage,
	RegenerateBotTokenModalNoDeps,
} from "./RegenerateBotTokenModal"
import { button, byProp, dialog, field, organizationId, session, typed } from "./test-support"

/** The bot modals: create (then its token), edit, install by ID, regenerate a token, delete. */

const botId = BotId.make("00000005-0000-4000-8000-000000000001")
const close = ModalEvents.RequestedClose()
const permissions = byProp("choiceGroup", "label", "Permissions")

describe("create bot modal", () => {
	const start = () => Scene.start(CreateBotModalNoDeps, { session })

	test("a one-letter name says why and blocks the submit", () => {
		const s = start().fire(field("Name"), "change", typed("a"))
		expect(s.get(field("Name")).props?.["error"]).toBe("Name must be at least 2 characters")
		expect(s.get(button("Create application")).props?.["disabled"]).toBe(true)
	})

	test("starts with read and write messages, creates, then shows the token in place", () => {
		const s = start()
		expect(s.get(permissions).props?.["selected"]).toEqual(["messages:read", "messages:write"])
		s.fire(field("Name"), "change", typed("Deploy Bot"))
			.fire(permissions, "change", { selected: ["messages:read", "users:read"] })
			.fire(byProp("toggle", "label", "List in Marketplace"), "change", { checked: true })
			.fire(button("Create application"), "press")
			.expectExact(
				CreateBot.make({
					name: "Deploy Bot",
					description: null,
					scopes: ["messages:read", "users:read"],
					isPublic: true,
					organizationId,
				}),
			)
			.resolve(
				CreateBot,
				CreateBotMessage.SucceededCreateBot({ token: "hzl_secret", name: "Deploy Bot" }),
			)
			.expect(dialog("Application created"))
			.toExist()
		expect(s.get(byProp("textField", "label", "Token")).props?.["secret"]).toBe(true)
		s.fire(byProp("textField", "label", "Token"), "copy", {})
			.expectExact(CopyToken.make({ token: "hzl_secret" }))
			.resolve(CopyToken, Component.noop)
			.fire(button("Done"), "press")
			.emitted(close)
	})

	test("no permissions picked: nothing is sent", () => {
		start()
			.fire(field("Name"), "change", typed("Deploy Bot"))
			.fire(permissions, "change", { selected: [] })
			.fire(button("Create application"), "press")
			.expect(button("Create application"))
			.toExist()
	})
})

describe("edit bot modal", () => {
	const props = {
		id: botId,
		name: "Deploy Bot",
		description: "Ships",
		isPublic: false,
		scopes: ["messages:read", "unknown:scope"],
		avatarUrl: null,
	}

	test("seeds the form from the bot, keeping only known scopes, and saves", () => {
		const s = Scene.start(EditBotModalNoDeps, props)
		expect(s.get(field("Name")).props?.["value"]).toMatchObject({ text: "Deploy Bot" })
		expect(s.get(permissions).props?.["selected"]).toEqual(["messages:read"])
		s.fire(button("Save changes"), "press")
			.expectExact(
				UpdateBot.make({
					id: botId,
					name: "Deploy Bot",
					description: "Ships",
					scopes: ["messages:read"],
					isPublic: false,
				}),
			)
			.resolve(UpdateBot, EditBotMessage.SucceededUpdateBot())
			.emitted(close)
	})

	test("the avatar uploads on its own and shows the new picture", () => {
		const avatar = byProp("avatar", "name", "Deploy Bot")
		const s = Scene.start(EditBotModalNoDeps, props)
			.fire(avatar, "press", {})
			.expectExact(ChangeBotAvatar.make({ id: botId }))
			.resolve(
				ChangeBotAvatar,
				EditBotMessage.SucceededUploadAvatar({ avatarUrl: "https://cdn/a.png" }),
			)
		expect(s.get(avatar).props?.["src"]).toBe("https://cdn/a.png")
	})
})

describe("install bot by ID modal", () => {
	const idField = field("Application ID")

	test("an empty submit says to enter an ID", () => {
		const s = Scene.start(InstallBotByIdModalNoDeps, { session }).fire(idField, "submit", typed(""))
		expect(s.get(idField).props?.["error"]).toBe("Please enter an App ID")
	})

	test("installs the trimmed ID; a refusal shows under the field", () => {
		const s = Scene.start(InstallBotByIdModalNoDeps, { session })
			.fire(idField, "change", typed(` ${botId} `))
			.fire(button("Install"), "press")
			.expectExact(InstallBotById.make({ botId, organizationId }))
			.resolve(
				InstallBotById,
				InstallBotByIdMessage.FailedInstallBot({
					error: "This application is already installed in your workspace.",
				}),
			)
		expect(s.get(idField).props?.["error"]).toBe(
			"This application is already installed in your workspace.",
		)
	})
})

describe("regenerate token modal", () => {
	test("confirms, then shows the new token", () => {
		Scene.start(RegenerateBotTokenModalNoDeps, { botId, botName: "Deploy Bot" })
			.fire(button("Regenerate token"), "press")
			.expectExact(RegenerateBotToken.make({ id: botId }))
			.resolve(
				RegenerateBotToken,
				RegenerateBotTokenMessage.SucceededRegenerateToken({ token: "hzl_new" }),
			)
			.expect(dialog("New token generated"))
			.toExist()
	})
})

describe("delete bot modal", () => {
	test("names the bot, deletes it and closes", () => {
		Scene.start(DeleteBotModalNoDeps, { botId, botName: "Deploy Bot" })
			.expect(
				byProp(
					"dialog",
					"description",
					'Are you sure you want to delete "Deploy Bot"? This action cannot be undone.',
				),
			)
			.toExist()
			.fire(button("Delete application"), "press")
			.expectExact(DeleteBot.make({ id: botId }))
			.resolve(DeleteBot, DeleteBotMessage.SucceededDeleteBot())
			.emitted(close)
	})
})
