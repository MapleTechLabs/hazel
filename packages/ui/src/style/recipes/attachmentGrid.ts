import { defineRecipe } from "../recipe.ts"

/**
 * `attachmentGrid` (`chat/attachments.ts`): a mosaic of media tiles, then file cards. The mosaic's
 * grid, tile sizes, hover reveals and the remove buttons' placement are renderer-owned.
 */
export const attachmentGrid = defineRecipe<
	{},
	"removable",
	"mosaic" | "media" | "files" | "file" | "fileName" | "fileSize"
>({
	primitive: "attachmentGrid",
	parts: {
		mosaic: "part",
		media: { kind: "part", in: "mosaic" },
		files: "part",
		file: { kind: "part", in: "files" },
		fileName: { kind: "part", in: "file" },
		fileSize: { kind: "part", in: "file" },
	},
	base: {
		root: { layout: "column", rowGap: "2" },
		parts: {
			mosaic: { gap: "1" },
			media: { radius: "lg", background: "muted" },
			files: { layout: "column", rowGap: "2" },
			file: {
				layout: "row",
				align: "center",
				gap: "3",
				paddingX: "3",
				paddingY: "3",
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "border",
				background: "bg",
				shadow: "xs",
			},
			fileName: { color: "fg", text: "label", strong: true, truncate: true },
			fileSize: { color: "muted-fg", text: "caption" },
		},
	},
	options: {},
	flags: { removable: {} },
})
