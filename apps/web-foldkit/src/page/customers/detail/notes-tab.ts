import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatDate, formatRelative } from "../../../customers/format"
import { personAvatar } from "../../../customers/ui/identity"
import { IconEdit, IconPin, IconTrash, IconUnpin } from "../../../icons"
import { button } from "../../../ui/button"
import { checkbox } from "../../../ui/checkbox"
import { textarea } from "../../../ui/textarea"
import { Message } from "./message"
import { COMPOSER_ID, type Model, type NoteRow, sortedNotes } from "./model"
import { noteBody } from "./overview-tab"
import { type Context, memberOf } from "./parts"

/** The notes tab: a markdown composer, then pinned notes and the rest, newest first. */

const iconButton = (
	h: HtmlBuilder<Message>,
	label: string,
	glyph: Html,
	onPress: Message,
	className?: string,
): Html =>
	h.button(
		[
			h.Type("button"),
			h.AriaLabel(label),
			h.Title(label),
			h.OnClick(onPress),
			h.Class(
				twMerge(
					"inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-fg outline-hidden hover:bg-secondary hover:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
					className,
				),
			),
		],
		[glyph],
	)

const composer = (h: HtmlBuilder<Message>, model: Model, organizationName: string): Html =>
	h.form(
		[
			h.OnSubmit(Message.SubmittedNote()),
			h.Class("flex flex-col rounded-xl border border-border bg-bg focus-within:border-primary"),
		],
		[
			textarea(h, {
				placeholder: "Write a note… Markdown works: **bold**, lists, `code`.",
				className: "min-h-28 border-0 shadow-none focus:ring-0",
				attributes: [
					h.Id(COMPOSER_ID),
					h.AriaLabel("New note"),
					h.Value(model.composer.body),
					h.Attribute("rows", "4"),
					h.OnInput((value) => Message.ChangedComposer({ value })),
				],
			}),
			h.div(
				[
					h.Class(
						"flex flex-wrap items-center justify-between gap-3 border-border border-t px-3 py-2",
					),
				],
				[
					h.div(
						[h.Class("flex items-center gap-3")],
						[
							checkbox(
								h,
								{
									id: "customer-note-pin",
									isSelected: model.composer.pinned,
									onChange: (pinned) => Message.ToggledComposerPin({ pinned }),
								},
								"Pin to top",
							),
							h.span(
								[h.Class("text-muted-fg text-xs max-sm:hidden")],
								[`Visible to everyone in ${organizationName}. Never sent to the customer.`],
							),
						],
					),
					button(
						h,
						{
							size: "sm",
							isDisabled: model.composer.body.trim() === "",
							attributes: [h.Type("submit")],
						},
						["Save note"],
					),
				],
			),
		],
	)

const noteCard = (h: HtmlBuilder<Message>, model: Model, note: NoteRow, context: Context): Html => {
	const author = memberOf(context, note.authorUserId)
	const now = new Date(context.nowMs)
	const isMine = note.authorUserId === context.userId
	const signal =
		note.signalId === null ? undefined : model.signals?.find((entry) => entry.id === note.signalId)
	const editing = model.editingNote?.noteId === note.id ? model.editingNote : null
	return h.article(
		[h.Key(note.id), h.Class("group/note flex flex-col gap-2 rounded-xl border border-border bg-bg p-4")],
		[
			h.header(
				[h.Class("flex items-center justify-between gap-3")],
				[
					h.div(
						[h.Class("flex min-w-0 flex-wrap items-center gap-2 text-sm")],
						[
							personAvatar(h, author),
							h.span([h.Class("font-medium text-fg")], [author?.name ?? "Someone"]),
							h.span(
								[h.Class("text-muted-fg text-xs")],
								[
									[
										formatDate(new Date(note.createdAtMs), { now, withYear: true }),
										note.editedAtMs === null
											? null
											: `edited ${formatRelative(new Date(note.editedAtMs), now)}`,
									]
										.filter((part) => part !== null)
										.join(" · "),
								],
							),
							...(signal === undefined
								? []
								: [
										h.span(
											[
												h.Class(
													"rounded border border-border px-1.5 py-0.5 text-muted-fg text-xs",
												),
											],
											[`On signal: ${signal.title}`],
										),
									]),
						],
					),
					h.div(
						[h.Class("flex items-center gap-0.5")],
						[
							iconButton(
								h,
								note.pinned ? "Unpin" : "Pin to top",
								note.pinned
									? IconUnpin(h, { className: "size-4" })
									: IconPin(h, { className: "size-4" }),
								Message.PressedPinNote({ noteId: note.id, pinned: !note.pinned }),
								note.pinned ? "text-primary" : undefined,
							),
							...(isMine && editing === null
								? [
										iconButton(
											h,
											"Edit",
											IconEdit(h, { className: "size-4" }),
											Message.PressedEditNote({ noteId: note.id }),
										),
									]
								: []),
							...(isMine
								? [
										iconButton(
											h,
											"Delete",
											IconTrash(h, { className: "size-4" }),
											Message.PressedDeleteNote({ noteId: note.id }),
											"hover:text-danger-subtle-fg",
										),
									]
								: []),
						],
					),
				],
			),
			editing === null
				? noteBody(h, note.body)
				: h.form(
						[h.OnSubmit(Message.SubmittedEditNote()), h.Class("flex flex-col gap-2")],
						[
							textarea(h, {
								attributes: [
									h.AriaLabel("Edit note"),
									h.Value(editing.body),
									h.Attribute("rows", "4"),
									h.OnInput((value) => Message.ChangedEditNote({ value })),
								],
							}),
							h.div(
								[h.Class("flex justify-end gap-2")],
								[
									button(
										h,
										{ intent: "plain", size: "sm", onPress: Message.CanceledEditNote() },
										["Cancel"],
									),
									button(
										h,
										{
											size: "sm",
											isDisabled: editing.body.trim() === "",
											attributes: [h.Type("submit")],
										},
										["Save"],
									),
								],
							),
						],
					),
		],
	)
}

const section = (h: HtmlBuilder<Message>, title: string, notes: ReadonlyArray<Html>): ReadonlyArray<Html> =>
	notes.length === 0
		? []
		: [
				h.h3([h.Class("pt-2 font-medium text-muted-fg text-xs uppercase tracking-wider")], [title]),
				...notes,
			]

export const notesTab = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	organizationName: string,
): ReadonlyArray<Html> => {
	const notes = sortedNotes(model)
	return [
		composer(h, model, organizationName),
		h.div(
			[h.Class("flex items-center justify-between")],
			[
				h.h2(
					[h.Class("flex items-baseline gap-2 font-semibold text-fg")],
					["Notes", h.span([h.Class("font-normal text-muted-fg text-sm")], [String(notes.length)])],
				),
				h.span([h.Class("text-muted-fg text-xs")], ["Pinned, then newest"]),
			],
		),
		...(model.notes === null
			? [h.div([h.Class("h-24 animate-pulse rounded-xl border border-border bg-secondary/30")])]
			: notes.length === 0
				? [
						h.p(
							[
								h.Class(
									"rounded-xl border border-border border-dashed py-10 text-center text-muted-fg text-sm",
								),
							],
							["No notes yet. Write the first one above."],
						),
					]
				: [
						...section(
							h,
							"Pinned",
							notes
								.filter((note) => note.pinned)
								.map((note) => noteCard(h, model, note, context)),
						),
						...section(
							h,
							notes.some((note) => note.pinned) ? "Other notes" : "All notes",
							notes
								.filter((note) => !note.pinned)
								.map((note) => noteCard(h, model, note, context)),
						),
					]),
	]
}
