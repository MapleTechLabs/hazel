/**
 * The one list of file types a message can carry, for the file input's `accept`, drag-and-drop,
 * paste and the draft's own check of selected files.
 */

const ACCEPTED_MIME_TYPES: ReadonlyArray<string> = [
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
const ACCEPTED_EXTENSIONS: ReadonlyArray<string> = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv"]

/** The file input's `accept` attribute. */
export const ACCEPT_ATTRIBUTE = [...ACCEPTED_MIME_TYPES, ...ACCEPTED_EXTENSIONS].join(",")

/** A MIME type (as `DataTransferItem.type` or `File.type` reports it) a message can carry. */
export const isAcceptedMimeType = (type: string): boolean =>
	ACCEPTED_MIME_TYPES.some((accepted) =>
		accepted.endsWith("/*") ? type.startsWith(accepted.slice(0, -1)) : type === accepted,
	)

/** A file a message can carry: by type, or by extension when the type is unknown. */
export const isAcceptedFile = (file: { readonly name: string; readonly type: string }): boolean =>
	file.type === ""
		? ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
		: isAcceptedMimeType(file.type)

/** `withFilePaste`: the copied files a message can carry first, else image items (screenshots). */
export const clipboardFiles = (data: DataTransfer): ReadonlyArray<File> => {
	const files = Array.from(data.files).filter(isAcceptedFile)
	if (files.length > 0) return files
	return Array.from(data.items).flatMap((item) => {
		const file = item.kind === "file" && isAcceptedMimeType(item.type) ? item.getAsFile() : null
		return file ? [file] : []
	})
}
