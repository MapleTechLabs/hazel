/**
 * Shared upload utilities for uploading files to storage via presigned URLs.
 */

export type UploadErrorType = "network" | "timeout" | "server" | "aborted"

export interface UploadResult {
	success: boolean
	errorType?: UploadErrorType
}

export interface UploadOptions {
	/** Timeout in milliseconds (default: 60000 for avatars, 120000 for attachments) */
	timeout?: number
	/** Callback for upload progress (0-100) */
	onProgress?: (percent: number) => void
	/** AbortController signal for cancellation */
	signal?: AbortSignal
}

/**
 * Upload a file to storage using a presigned URL.
 *
 * Uses XHR internally to support progress tracking, which fetch() does not support.
 *
 * @param uploadUrl - The presigned URL to upload to
 * @param file - The file to upload
 * @param options - Upload options (timeout, progress callback, abort signal)
 * @returns Promise resolving to upload result
 */
export function uploadToStorage(
	uploadUrl: string,
	file: File,
	options: UploadOptions = {},
): Promise<UploadResult> {
	const { timeout = 60000, onProgress, signal } = options

	return new Promise((resolve) => {
		const xhr = new XMLHttpRequest()
		xhr.timeout = timeout

		// Handle abort signal
		if (signal) {
			signal.addEventListener("abort", () => {
				xhr.abort()
			})
		}

		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) {
				const percent = Math.round((event.loaded / event.total) * 100)
				onProgress?.(percent)
			}
		}

		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve({ success: true })
			} else {
				resolve({ success: false, errorType: "server" })
			}
		}

		xhr.onerror = () => resolve({ success: false, errorType: "network" })
		xhr.ontimeout = () => resolve({ success: false, errorType: "timeout" })
		xhr.onabort = () => resolve({ success: false, errorType: "aborted" })

		xhr.open("PUT", uploadUrl)
		xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")
		xhr.send(file)
	})
}

/**
 * Error messages for upload failures.
 */
export const uploadErrorMessages: Record<UploadErrorType, string> = {
	network: "Network error. Check your connection and try again.",
	timeout: "Upload timed out. Try a smaller file or check your connection.",
	server: "Server error during upload. Please try again later.",
	aborted: "Upload was cancelled.",
}
