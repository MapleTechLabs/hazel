/** One `type/subtype`, optionally with parameters: no lists, quotes or blanks. */
const SINGLE_MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;[^,"]*)?$/i

/**
 * Types a browser runs as a document (HTML, XML, SVG, XSL), and anything that is not a single
 * well-formed type (a browser takes the last of a comma list, and sniffs an empty one). Attachments
 * are public on the uploads domain, so one stored with such a type would run script there: clients
 * upload these files as `application/octet-stream`, and the attachment presign refuses them.
 */
export const isActiveContentType = (contentType: string): boolean => {
	if (!SINGLE_MIME_TYPE.test(contentType.trim())) return true
	const type = contentType.split(";", 1)[0]!.trim().toLowerCase()
	return (
		type === "text/html" ||
		type === "application/xhtml+xml" ||
		type === "text/xml" ||
		type === "application/xml" ||
		type === "text/xsl" ||
		type === "application/xslt+xml" ||
		type.endsWith("+xml") ||
		type === "multipart/x-mixed-replace"
	)
}
