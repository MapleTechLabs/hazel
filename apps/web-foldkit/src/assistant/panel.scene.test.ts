// @vitest-environment jsdom
import { AssistantItemId, AssistantThreadId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, Mount, click, expect as sceneExpect, given, role, scene, text, type } from "foldkit/scene"
import { describe, expect, test } from "vitest"
import { aiPanelInputsOf } from "../app/model"
import { Message as RootMessage } from "../app/message"
import { update } from "../main"
import * as CommandPalette from "../overlay/command-palette"
import * as CommandMenu from "../ui/command-menu"
import { after, rootScene, signedIn } from "../test/root-fixtures"
import * as Menu from "../ui/menu"
import { FocusTriggerOnPress } from "../ui/menu-view"
import {
	FetchAssistantStatus,
	FocusAssistantComposer,
	MakeAssistantMessageId,
	SaveAssistantPanel,
	StartAssistantThread,
} from "./commands"
import { Message } from "./message"

/** The AI panel in the org shell: its toggle, the page's context, and the not-connected state. */

const ACCOUNT = "00000000-0000-4000-8000-000000000101"
const messageId = Schema.decodeSync(AssistantItemId)("00000000-0000-4000-8000-000000000201")
const threadId = Schema.decodeSync(AssistantThreadId)(messageId)

// The sidebar's org switcher and user menu, and the panel's history menu, focus their trigger on press.
const menuMounted = Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())
const shellMenusMounted = [menuMounted, menuMounted] as const

const openedPanel = [
	click(role("button", { name: "AI assistant" })),
	Command.resolve(FocusAssistantComposer, Message.CompletedFocusComposer()),
	Command.resolve(SaveAssistantPanel, Message.CompletedSaveStored()),
] as const

describe("the toggle", () => {
	test("the nav rail's button opens the panel beside the page; Mod+J closes it again", () => {
		const opened = update(
			signedIn("/hazel/settings/team"),
			RootMessage.PressedHotkey({ actionId: "aiPanel.toggle" }),
		)
		expect(opened.model.aiPanel.isOpen).toBe(true)
		const closed = update(opened.model, RootMessage.PressedHotkey({ actionId: "aiPanel.toggle" }))
		expect(closed.model.aiPanel.isOpen).toBe(false)
	})

	test("the command palette's entry opens it", () => {
		const model = after(signedIn("/hazel/settings/team"), [
			RootMessage.PressedHotkey({ actionId: "commandPalette.open" }),
			RootMessage.GotCommandPaletteMessage({
				message: CommandPalette.Message.GotMenuMessage({
					message: CommandMenu.Message.ClickedItem({ key: "action:ai-panel" }),
				}),
			}),
		])
		expect(model.commandPalette.isOpen).toBe(false)
		expect(model.aiPanel.isOpen).toBe(true)
	})
})

describe("context", () => {
	test("a customer's page describes itself; another page falls back to its route", () => {
		const customer = signedIn(`/hazel/customers/${ACCOUNT}?tab=billing`)
		expect(aiPanelInputsOf(customer).context).toMatchObject({
			route: "CustomerDetail",
			label: "Customer · Billing",
			entities: [{ kind: "customer", id: ACCOUNT }],
		})
		expect(aiPanelInputsOf(signedIn("/hazel/settings/team")).context).toMatchObject({
			route: "TeamSettings",
			label: "Settings",
		})
	})
})

describe("the panel", () => {
	test("sends the member's message with the page's context chip, and shows it at once", () => {
		scene(
			rootScene,
			given(signedIn("/hazel/settings/team")),
			...shellMenusMounted,
			...openedPanel,
			menuMounted,
			Command.resolve(
				FetchAssistantStatus,
				Message.SucceededFetchStatus({ connection: "Connected", environmentLabel: "MacBook" }),
			),
			sceneExpect(role("complementary", { name: "AI assistant" })).toExist(),
			sceneExpect(role("button", { name: 'Send "Settings" as context' })).toHaveAttr(
				"aria-pressed",
				"true",
			),
			type(role("textbox", { name: "Message the assistant" }), "What changed this week?"),
			click(role("button", { name: "Send" })),
			Command.resolve(MakeAssistantMessageId, Message.MadeMessageId({ messageId })),
			Command.resolve(StartAssistantThread, Message.SucceededSend({ threadId })),
			sceneExpect(text("What changed this week?")).toExist(),
			sceneExpect(role("textbox", { name: "Message the assistant" })).toHaveValue(""),
		)
	})

	test("without T3 Code linked it explains, and links to the settings", () => {
		scene(
			rootScene,
			given(signedIn("/hazel/settings/team")),
			...shellMenusMounted,
			...openedPanel,
			menuMounted,
			Command.resolve(
				FetchAssistantStatus,
				Message.SucceededFetchStatus({ connection: "NotConnected", environmentLabel: null }),
			),
			sceneExpect(role("link", { name: "Open T3 Code settings" })).toHaveAttr(
				"href",
				"/hazel/settings/integrations/t3code",
			),
			sceneExpect(role("textbox", { name: "Message the assistant" })).toBeAbsent(),
		)
	})
})
