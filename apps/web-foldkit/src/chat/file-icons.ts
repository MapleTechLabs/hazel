// File-type icons: the data lives with hazel (`packages/ui/src/web/file-icons.ts`).
import type { Html, HtmlBuilder } from "foldkit/html"
import { type FileIconTree, fileIconTrees } from "@hazel/ui/web/file-icons"

const renderTree = <Message>(
	h: HtmlBuilder<Message>,
	[tag, attributes, children]: FileIconTree,
	className?: string,
): Html =>
	h[tag](
		[
			...Object.entries(attributes).map(([key, value]) => h.Attribute(key, value)),
			...(className ? [h.Class(className)] : []),
		],
		children.map((child) => (typeof child === "string" ? child : renderTree(h, child))),
	)

/** The icon for a file type (`getFileTypeFromName`); a type without one draws the blank page. */
export const fileIcon = <Message>(
	h: HtmlBuilder<Message>,
	type: string,
	options: { readonly className?: string } = {},
): Html => renderTree(h, isFileType(type) ? fileIconTrees[type] : fileIconTrees.empty, options.className)

const isFileType = (type: string): type is keyof typeof fileIconTrees => Object.hasOwn(fileIconTrees, type)
