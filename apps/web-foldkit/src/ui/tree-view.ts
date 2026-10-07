import { Array, Option } from "effect"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { defineView } from "foldkit/submodel"
import { twJoin, twMerge } from "tailwind-merge"
import { treeStyles } from "~/components/ui/tree.styles"
import * as Collection from "./aria/collection"
import { Message, type Model, rowId } from "./tree"

export interface TreeNode {
	readonly key: string
	readonly textValue: string
	readonly content: ReadonlyArray<Html | string>
	readonly isDisabled?: boolean
	readonly children?: ReadonlyArray<TreeNode>
}

export type ViewInputs = Readonly<{
	label: string
	nodes: ReadonlyArray<TreeNode>
	className?: string
}>

interface VisibleRow {
	readonly node: TreeNode
	readonly level: number
	readonly position: number
	readonly setSize: number
}

/** `@heroicons/react/20/solid` ChevronRightIcon, as the legacy TreeIndicator renders it. */
const chevronIcon = <Message>(h: HtmlBuilder<Message>, isExpanded: boolean): Html =>
	h.svg(
		[
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
			h.Attribute("viewBox", "0 0 20 20"),
			h.Attribute("fill", "currentColor"),
			h.Attribute("aria-hidden", "true"),
			h.Attribute("data-slot", "chevron"),
			h.Class(twJoin(...treeStyles.chevron(isExpanded))),
		],
		[
			h.path([
				h.Attribute("fill-rule", "evenodd"),
				h.Attribute(
					"d",
					"M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z",
				),
				h.Attribute("clip-rule", "evenodd"),
			]),
		],
	)

export const view = defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const isExpanded = (key: string) => model.expandedKeys.includes(key)
	const isVisible = model.modality !== "Pointer"

	const flatten = (nodes: ReadonlyArray<TreeNode>, level: number): ReadonlyArray<VisibleRow> =>
		nodes.flatMap((node, index) => [
			{ node, level, position: index + 1, setSize: nodes.length },
			...(node.children && isExpanded(node.key) ? flatten(node.children, level + 1) : []),
		])
	const rows = flatten(viewInputs.nodes, 1)
	const keys = Array.map(rows, (row) => row.node.key)
	const isDisabledKey = (key: string) =>
		Array.some(rows, (row) => row.node.key === key && row.node.isDisabled === true)
	const firstEnabled = Array.findFirst(rows, (row) => row.node.isDisabled !== true)

	const navigation = (row: VisibleRow) => (keyboardKey: string) => {
		const hasChildren = row.node.children !== undefined
		const selfSelector = Collection.idSelector(rowId(model, row.node.key))
		if (keyboardKey === "ArrowRight" && hasChildren && !isExpanded(row.node.key)) {
			return Option.some({
				focusSelector: selfSelector,
				message: Message.PressedExpandKey({ key: row.node.key }),
			})
		} else if (keyboardKey === "ArrowLeft" && hasChildren && isExpanded(row.node.key)) {
			return Option.some({
				focusSelector: selfSelector,
				message: Message.PressedCollapseKey({ key: row.node.key }),
			})
		} else {
			return Option.map(
				Option.flatMap(Collection.directionOfKey("vertical", keyboardKey), (direction) =>
					Collection.moveKey(keys, row.node.key, direction, isDisabledKey, false),
				),
				(key) => ({
					focusSelector: Collection.idSelector(rowId(model, key)),
					message: Message.NavigatedToRow(),
				}),
			)
		}
	}

	const rowView = (row: VisibleRow): Html => {
		const { node, level } = row
		const hasChildren = node.children !== undefined
		const isRowExpanded = hasChildren && isExpanded(node.key)
		const isDisabled = node.isDisabled === true
		const isFocused = Option.contains(model.maybeFocusedKey, node.key)
		const chevronId = `${rowId(model, node.key)}-chevron`
		const interactive: ReadonlyArray<Attribute<Message>> = isDisabled
			? [h.AriaDisabled(true)]
			: [
					h.Tabindex(isFocused ? 0 : -1),
					h.OnFocus(Message.FocusedRow({ key: node.key })),
					h.OnBlur(Message.BlurredRow({ key: node.key })),
					h.OnPointerDown(() => Option.some(Message.PressedRow())),
					h.OnKeyUp(() => Message.ReleasedKey()),
					h.OnKeyDownFocus(navigation(row)),
				]
		return h.keyed("div")(
			node.key,
			[
				...(hasChildren ? [h.AriaExpanded(isRowExpanded)] : []),
				h.AriaLabel(node.textValue),
				h.Attribute("aria-level", String(level)),
				h.Attribute("aria-posinset", String(row.position)),
				h.Attribute("aria-setsize", String(row.setSize)),
				h.Class(twMerge(twMerge(treeStyles.item(false)))),
				h.Attribute("data-collection", model.id),
				...(isRowExpanded ? [h.Attribute("data-expanded", "true")] : []),
				...(hasChildren ? [h.Attribute("data-has-child-items", "true")] : []),
				h.Attribute("data-key", node.key),
				h.Attribute("data-level", String(level)),
				h.Attribute("data-rac", ""),
				...(hasChildren && !isDisabled ? [h.Attribute("data-react-aria-pressable", "true")] : []),
				...Collection.stateAttributes(h, {
					isFocused,
					isFocusVisible: isFocused && isVisible,
					isDisabled,
				}),
				h.Id(rowId(model, node.key)),
				h.Role("row"),
				h.Attribute("style", `--tree-item-level: ${level};`),
				...interactive,
			],
			[
				h.div(
					[
						h.Attribute("aria-colindex", "1"),
						h.Role("gridcell"),
						h.Attribute("style", "display: contents;"),
					],
					[
						h.div(
							[h.Class(twMerge(treeStyles.content))],
							[
								h.div([h.Class(twJoin(...treeStyles.levelGuide))]),
								hasChildren
									? h.button(
											[
												h.AriaLabel(isRowExpanded ? "Collapse" : "Expand"),
												h.AriaLabelledBy(`${chevronId} ${rowId(model, node.key)}`),
												h.Class(twJoin(...treeStyles.indicator(isRowExpanded))),
												h.Attribute("data-rac", ""),
												h.Attribute("data-react-aria-pressable", "true"),
												h.Attribute("data-react-aria-prevent-focus", "true"),
												h.Id(chevronId),
												h.Attribute("slot", "chevron"),
												h.Tabindex(-1),
												h.Type("button"),
												...(isDisabled
													? [h.Disabled(true)]
													: [h.OnClick(Message.ClickedChevron({ key: node.key }))]),
											],
											[chevronIcon(h, isRowExpanded)],
										)
									: h.span([
											h.Attribute("aria-hidden", "true"),
											h.Class(treeStyles.leafSpacer),
										]),
								...node.content,
							],
						),
					],
				),
			],
		)
	}

	const focusScope = (edge: "start" | "end") =>
		h.span([h.Attribute(`data-focus-scope-${edge}`, "true"), h.Attribute("hidden", "")])

	return h.div(
		[h.Class("contents")],
		[
			focusScope("start"),
			h.div(
				[
					h.AriaLabel(viewInputs.label),
					h.Class(twMerge(twMerge(twJoin(...treeStyles.tree)), viewInputs.className)),
					h.Attribute("data-collection", model.id),
					h.Attribute("data-rac", ""),
					h.Id(model.id),
					h.Role("treegrid"),
					h.Tabindex(Option.isSome(model.maybeFocusedKey) ? -1 : 0),
					...Option.match(firstEnabled, {
						onNone: () => [],
						onSome: (row) => [
							h.OnFocus(Message.FocusedTree({ targetKey: row.node.key })),
							// NOTE: live focus check; rows handle their own keys before this bubbles here.
							h.OnKeyDownFocus((keyboardKey) =>
								document.activeElement?.id === model.id
									? navigation(row)(keyboardKey)
									: Option.none(),
							),
						],
					}),
				],
				Array.map(rows, rowView),
			),
			focusScope("end"),
		],
	)
})
