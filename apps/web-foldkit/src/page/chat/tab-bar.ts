import type { Html, HtmlBuilder } from "foldkit/html"
import { IconFolders, IconMsgs } from "../../icons"
import { tabStrip, tabView } from "../../ui/tab-strip"
import { type ChatTab, Message } from "./channel/page"

/** `ChatTabBar`: Messages and Files tabs; selecting one navigates. */
export const chatTabBarView = <M>(
	tab: ChatTab,
	toParentMessage: (message: Message) => M,
	h: HtmlBuilder<M>,
): Html =>
	tabStrip(h, { tabListClassName: "px-4" }, [
		tabView(h, {
			id: "messages",
			label: "Messages",
			icon: IconMsgs(h, { className: "size-4", attributes: { "data-slot": "icon" } }),
			isSelected: tab === "messages",
			attributes: [h.OnClick(toParentMessage(Message.ClickedTab({ tab: "messages" })))],
		}),
		tabView(h, {
			id: "files",
			label: "Files",
			icon: IconFolders(h, { className: "size-4", attributes: { "data-slot": "icon" } }),
			isSelected: tab !== "messages",
			attributes: [h.OnClick(toParentMessage(Message.ClickedTab({ tab: "files" })))],
		}),
	])
