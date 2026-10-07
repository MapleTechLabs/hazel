import type { Html, HtmlBuilder } from "foldkit/html"
import { IconEmoji1, IconGif, IconPaperclip2 } from "../../icons"

/**
 * Static stand-in for the composer area (`$id/index.tsx` > `SlateMessageComposer`), with the
 * same boxes and roles so the channel screen can reach parity. The real editor is spike S3.
 */

const VISUALLY_HIDDEN =
	"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;"

const PLACEHOLDER_STYLE =
	"position: absolute; top: 0px; pointer-events: none; width: 100%; max-width: 100%; display: block; opacity: 0.333; user-select: none; text-decoration: none;"

const ACTION_CLASS = "inline-flex items-center gap-1.5 rounded-xs p-0 font-semibold text-muted-fg text-xs"

const actionButton = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly className: string; readonly isAria: boolean },
	children: Array<Html | string>,
): Html =>
	h.button(
		[
			h.Class(options.className),
			h.Attribute("type", "button"),
			...(options.isAria
				? [
						h.Attribute("aria-expanded", "false"),
						h.Attribute("data-rac", ""),
						h.Attribute("data-react-aria-pressable", "true"),
						h.Attribute("tabindex", "0"),
					]
				: []),
		],
		children,
	)

const editorView = <Message>(h: HtmlBuilder<Message>): Html =>
	h.div(
		[
			h.Attribute("aria-autocomplete", "list"),
			h.Attribute("aria-expanded", "false"),
			h.Attribute("aria-haspopup", "listbox"),
			h.Attribute("aria-multiline", "true"),
			h.Class(
				"w-full whitespace-pre-wrap break-all px-3 py-2 text-base md:text-sm rounded-xl bg-transparent focus:border-primary focus:outline-hidden caret-primary placeholder:text-muted-fg min-h-10 leading-normal **:data-slate-placeholder:top-2! **:data-slate-placeholder:translate-y-0!",
			),
			h.Attribute("contenteditable", "true"),
			h.Attribute("data-slate-editor", "true"),
			h.Attribute("data-slate-node", "value"),
			h.Attribute("role", "combobox"),
			h.Attribute(
				"style",
				"position: relative; white-space: pre-wrap; overflow-wrap: break-word; min-height: 21px;",
			),
			h.Attribute("translate", "no"),
			h.Attribute("zindex", "-1"),
		],
		[
			h.p(
				[h.Class("my-0 min-h-6"), h.Attribute("data-slate-node", "element")],
				[
					h.span(
						[h.Attribute("data-slate-node", "text")],
						[
							h.span(
								[h.Attribute("class", ""), h.Attribute("data-slate-leaf", "true")],
								[
									h.span(
										[
											h.Attribute("data-slate-length", "0"),
											h.Attribute("data-slate-zero-width", "n"),
										],
										["﻿", h.br([])],
									),
									h.span(
										[
											h.Attribute("contenteditable", "false"),
											h.Attribute("data-slate-placeholder", "true"),
											h.Attribute("style", PLACEHOLDER_STYLE),
										],
										["Type a message..."],
									),
								],
							),
						],
					),
				],
			),
		],
	)

export const composerPlaceholderView = <Message>(h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.Class("relative shrink-0 px-4 pb-4 pt-2.5")],
		[
			h.div(
				[h.Class("relative"), h.Attribute("data-rac", "")],
				[
					h.div(
						[h.Attribute("style", VISUALLY_HIDDEN)],
						[
							h.button(
								[
									h.Attribute("aria-label", "DropZone"),
									h.Attribute("data-react-aria-pressable", "true"),
									h.Attribute("tabindex", "0"),
									h.Attribute("type", "button"),
								],
								[],
							),
						],
					),
					h.div(
						[h.Class("relative flex h-max items-center gap-3")],
						[
							h.div(
								[h.Class("w-full")],
								[
									h.div(
										[
											h.Class(
												"relative inset-ring inset-ring-secondary flex h-max flex-col rounded-xl bg-secondary",
											),
										],
										[
											h.div([h.Class("relative w-full")], [editorView(h)]),
											h.input([
												h.Attribute(
													"accept",
													"image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv",
												),
												h.Attribute("aria-label", "File upload"),
												h.Class("hidden"),
												h.Attribute("multiple", ""),
												h.Attribute("type", "file"),
											]),
											h.div(
												[
													h.Class(
														"flex w-full items-center justify-between gap-3 px-3 py-2",
													),
												],
												[
													h.div(
														[h.Class("flex items-center gap-3")],
														[
															actionButton(
																h,
																{
																	className: `${ACTION_CLASS} transition-colors hover:text-fg disabled:opacity-50`,
																	isAria: false,
																},
																[
																	IconPaperclip2(h, {
																		className: "size-4 text-muted-fg",
																	}),
																	"Attach",
																],
															),
															actionButton(
																h,
																{
																	className: `${ACTION_CLASS} outline-none transition-colors hover:text-fg`,
																	isAria: true,
																},
																[
																	IconGif(h, {
																		className: "size-4 text-muted-fg",
																	}),
																	"GIF",
																],
															),
															actionButton(
																h,
																{
																	className: `${ACTION_CLASS} outline-none transition-colors hover:text-fg`,
																	isAria: true,
																},
																[
																	IconEmoji1(h, {
																		className: "size-4 text-muted-fg",
																	}),
																	"Emoji",
																],
															),
														],
													),
												],
											),
										],
									),
								],
							),
						],
					),
				],
			),
		],
	)
