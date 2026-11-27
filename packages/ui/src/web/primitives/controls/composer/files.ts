/** The file types a message can carry (W12b), ported from `apps/web-foldkit/src/editor/file-types.ts`. */

const MIME_TYPES: ReadonlyArray<string> = [
	"image/*",
	"video/*",
	"audio/*",
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"text/plain",
	"text/csv",
]

/** Some systems report no MIME type for these; the extension decides then. */
const EXTENSIONS: ReadonlyArray<string> = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv"]

const isAcceptedType = (type: string) =>
	MIME_TYPES.some((accepted) =>
		accepted.endsWith("/*") ? type.startsWith(accepted.slice(0, -1)) : type === accepted,
	)

const isAccepted = (file: File) =>
	file.type === ""
		? EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
		: isAcceptedType(file.type)

/** The files of a paste or drop a message can carry: the files first, else image items (screenshots). */
export const transferFiles = (data: DataTransfer): ReadonlyArray<File> => {
	const files = Array.from(data.files).filter(isAccepted)
	if (files.length > 0) return files
	return Array.from(data.items).flatMap((item) => {
		const file = item.kind === "file" && isAcceptedType(item.type) ? item.getAsFile() : null
		return file === null ? [] : [file]
	})
}

/** A drag that carries files (a drop over the composer must not open them in the tab). */
export const carriesFiles = (data: DataTransfer | null) => data?.types.includes("Files") === true
