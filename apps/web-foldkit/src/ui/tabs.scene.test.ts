// @vitest-environment jsdom
import { Schema } from "effect"
import type { Update } from "foldkit"
import * as Command from "foldkit/command"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Scene from "foldkit/scene"
import { modifyFields } from "foldkit/struct"
import { describe, test } from "vitest"
import * as Tabs from "./tabs"

/** The styled `@foldkit/ui` Tabs in a parent that owns the selected tab. */

const Section = Schema.Literals(["general", "members", "billing"])
type Section = typeof Section.Type
const SectionTabs = Tabs.create<Section>()

const Model = Schema.Struct({ tabs: Tabs.Model, section: Section })
type Model = typeof Model.Type

const Message = defineMessageUnion({ GotTabsMessage: { message: Tabs.Message } })
type Message = typeof Message.Type

const toTabsMessage = (message: Tabs.Message) => Message.GotTabsMessage({ message })

const update = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotTabsMessage: ({ message: child }) => {
			const result = SectionTabs.update(model.tabs, child)
			const selected = result.outMessage
			return {
				model: modifyFields(model, {
					tabs: () => result.model,
					section: (section) => (selected === undefined ? section : selected.value),
				}),
				commands: Command.mapMessages(result.commands ?? [], toTabsMessage),
			}
		},
	})

const labels: Record<Section, string> = { general: "General", members: "Members", billing: "Billing" }
const panels: Record<Section, string> = {
	general: "General settings",
	members: "Member list",
	billing: "Billing details",
}

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	h.main(
		[],
		[
			h.submodel({
				slotId: "tabs",
				model: model.tabs,
				view: SectionTabs.view,
				viewInputs: {
					tabs: ["general", "members", "billing"],
					selectedValue: model.section,
					ariaLabel: "Settings sections",
					isTabDisabled: (section) => section === "billing",
					toView: (render) =>
						Tabs.layout(h, render, {
							tab: (section) => [labels[section]],
							panel: (section) => [panels[section]],
						}),
				},
				toParentMessage: toTabsMessage,
			}),
		],
	)

const init = (section: Section = "general"): Model => ({ tabs: Tabs.init({ id: "settings" }), section })
const tab = (name: string) => Scene.role("tab", { name })
const resolveFocus = Scene.Command.resolve(Tabs.FocusTab, Tabs.Message.CompletedFocusTab())

describe("tabs scene", () => {
	test("renders a labelled tablist with the parent's tab selected and only its panel", () => {
		Scene.scene(
			{ update, view },
			Scene.given(init()),
			Scene.expect(Scene.role("tablist", { name: "Settings sections" })).toExist(),
			Scene.expectAll(Scene.all.role("tab")).toHaveCount(3),
			Scene.expect(tab("General")).toHaveAttr("aria-selected", "true"),
			Scene.expect(tab("Members")).toHaveAttr("aria-selected", "false"),
			Scene.expect(Scene.role("tabpanel", { name: "General" })).toHaveText("General settings"),
			Scene.expect(Scene.text("Member list")).toBeAbsent(),
		)
	})

	test("clicking a tab tells the parent, which swaps the panel", () => {
		Scene.scene(
			{ update, view },
			Scene.given(init()),
			Scene.click(tab("Members")),
			resolveFocus,
			Scene.expect(tab("Members")).toHaveAttr("aria-selected", "true"),
			Scene.expect(Scene.role("tabpanel", { name: "Members" })).toHaveText("Member list"),
		)
	})

	test("ArrowRight skips the disabled tab and wraps", () => {
		Scene.scene(
			{ update, view },
			Scene.given(init("members")),
			Scene.keydown(tab("Members"), "ArrowRight"),
			resolveFocus,
			Scene.expect(tab("General")).toHaveAttr("aria-selected", "true"),
			Scene.expect(tab("Billing")).toBeDisabled(),
		)
	})
})
