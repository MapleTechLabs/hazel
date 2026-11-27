// @vitest-environment jsdom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { HtmlScene } from "@effect/ui/html/testing"
import { AppRequest } from "@hazel/shared-screens/app/requests"
import { ChannelId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../page/out-message"
import { flagsOf, hostRequestsOf, shellSignedIn } from "../test/root-fixtures"
import { App, type Boot } from "./app"
import { hostContextOf, update } from "./logic"
import { AppMessage } from "./message"
import { isNativeModal } from "./modals"

/** The one modal system: native kinds open in the root's Model and draw over the frame; the rest stay the host's. */

const boot: Boot = {
	...flagsOf(),
	isCreateChannelHintDismissed: false,
	aiPanel: { isOpen: false, width: null },
}
const channelId = ChannelId.make("00000004-0000-4000-8000-000000000001")
const open = (modal: { readonly _tag: string; readonly [field: string]: unknown }) =>
	update(
		shellSignedIn("/hazel/chat"),
		AppMessage.ReceivedAppRequest({ request: AppRequest.OpenModal({ modal }) }),
	)

interface ChildNode {
	readonly _tag: "Child"
	readonly key?: string
	readonly props: Record<string, unknown>
}
const childrenOf = (node: unknown): ReadonlyArray<ChildNode> => {
	if (typeof node !== "object" || node === null) return []
	const { _tag, children } = node as { readonly _tag?: string; readonly children?: ReadonlyArray<unknown> }
	if (_tag === "Child") return [node as ChildNode]
	return (children ?? []).flatMap(childrenOf)
}

describe("the native modal layer", () => {
	test("batch 1 kinds are native; the rest are still the host's", () => {
		for (const tag of [
			"NewChannel",
			"CreateDm",
			"JoinChannel",
			"CreateSection",
			"DeleteChannel",
			"RenameChannel",
			"RenameThread",
			"DeleteMessage",
			"SetStatus",
		])
			expect(isNativeModal(tag)).toBe(true)
		expect(isNativeModal("Feedback")).toBe(false)
	})

	test("a native page's open lands in the root's Model, not the host", () => {
		const next = open({ _tag: "NewChannel" })
		expect(next.model.modal).toEqual({ instance: 0, request: { _tag: "NewChannel" } })
		expect(hostRequestsOf(next.commands)).toEqual([])
		expect(hostContextOf(next.model).isNativeModalOpen).toBe(true)
	})

	test("the host's own opens reach it too", () => {
		const next = update(
			shellSignedIn("/hazel/chat"),
			AppMessage.ReceivedHostOut({
				out: {
					_tag: "Page",
					outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "SetStatus" } }),
				},
			}),
		)
		expect(next.model.modal?.request).toEqual({ _tag: "SetStatus" })
	})

	test("a new opening replaces the open one; only the open one's close counts", () => {
		const first = open({ _tag: "CreateSection" }).model
		const second = update(
			first,
			AppMessage.ReceivedAppRequest({
				request: AppRequest.OpenModal({
					modal: { _tag: "DeleteChannel", channelId, channelName: "general" },
				}),
			}),
		).model
		expect(second.modal).toMatchObject({ instance: 1, request: { _tag: "DeleteChannel" } })
		expect(update(second, AppMessage.RequestedCloseModal({ instance: 0 })).model.modal).not.toBeNull()
		expect(update(second, AppMessage.RequestedCloseModal({ instance: 1 })).model.modal).toBeNull()
	})

	test("the shell draws the open modal, keyed by its opening", () => {
		const model = open({ _tag: "SetStatus" }).model
		const s = HtmlScene.start(App, { route: model.route, boot }).given(model)
		const modal = childrenOf(s.current.root).find((child) => child.key === "SetStatus:0")
		expect(modal?.props).toMatchObject({ nowMs: model.nowMs, session: { orgSlug: "hazel" } })
	})
})
