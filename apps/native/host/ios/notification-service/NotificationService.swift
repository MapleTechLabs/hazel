// The app's Notification Service Extension: a push from a person (`hazel.sender`, sent with
// `mutable-content` by the api, `apps/backend/src/worker/objects/user/push.ts`) shows as a message
// from them, their picture in place of the app's icon, as Messages and Slack do. It is the push
// counterpart of what the app does for its own notifications (`host/src/notify.rs`), and does the
// same: the incoming message is donated as an `INSendMessageIntent`, then the content updated from
// it. A bundle without the Communication Notifications entitlement (`HazelCommunicationNotifications`
// in its Info.plist, `scripts/ios.ts`) attaches the picture instead, which shows beside the text.
//
// Built by `scripts/ios.ts` with `swiftc` into `Hazel.app/PlugIns/NotificationService.appex`.
// The system gives an extension about 30 seconds and little memory, so the picture download has a
// short timeout, and whatever goes wrong the push still shows, as it came.

import Intents
import UIKit
import UserNotifications

@objc(NotificationService)
final class NotificationService: UNNotificationServiceExtension {
	/// One delivery per push: the download's answer or the system's deadline, whichever comes first.
	private let lock = NSLock()
	private var deliver: ((UNNotificationContent) -> Void)?
	private var original: UNNotificationContent?
	private var task: URLSessionDataTask?

	/// How long the picture may take before the push shows without it.
	private static let pictureTimeout: TimeInterval = 8
	/// The side of the square picture: the system draws it small.
	private static let pictureSide: CGFloat = 256

	override func didReceive(
		_ request: UNNotificationRequest,
		withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
	) {
		lock.lock()
		deliver = contentHandler
		original = request.content
		lock.unlock()

		let hazel = request.content.userInfo["hazel"] as? [String: Any]
		guard
			let sender = hazel?["sender"] as? [String: Any],
			let id = sender["id"] as? String,
			let name = sender["name"] as? String
		else { return finish(request.content) }
		let conversation = hazel?["conversation"] as? String
		let from = Sender(id: id, name: name, conversation: conversation)

		guard
			let avatar = sender["avatarUrl"] as? String,
			let url = URL(string: avatar),
			url.scheme == "https" || url.scheme == "http"
		else { return finish(Self.content(request.content, from: from, png: nil)) }

		var download = URLRequest(url: url)
		download.timeoutInterval = Self.pictureTimeout
		let task = URLSession.shared.dataTask(with: download) { data, response, error in
			let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
			if let error { NSLog("[notification-service] picture: %@", error.localizedDescription) }
			let png = ok ? data.flatMap(Self.squarePng) : nil
			self.finish(Self.content(request.content, from: from, png: png))
		}
		lock.lock()
		self.task = task
		lock.unlock()
		task.resume()
	}

	/// The deadline: the push shows as it came.
	override func serviceExtensionTimeWillExpire() {
		lock.lock()
		let task = self.task
		let original = self.original
		lock.unlock()
		task?.cancel()
		if let original { finish(original) }
	}

	private func finish(_ content: UNNotificationContent) {
		lock.lock()
		let deliver = self.deliver
		self.deliver = nil
		lock.unlock()
		deliver?(content)
	}

	struct Sender {
		let id: String
		let name: String
		/// The group conversation's name (`#general`); none for a 1:1 DM.
		let conversation: String?
	}

	/// Whether this bundle may show a sender as a person: only one signed with the entitlement.
	private static var communication: Bool {
		Bundle.main.object(forInfoDictionaryKey: "HazelCommunicationNotifications") as? Bool ?? false
	}

	/// `content` as a message from `from`, or with the picture attached when it cannot be one.
	static func content(_ content: UNNotificationContent, from: Sender, png: Data?) -> UNNotificationContent {
		if communication {
			do {
				return try message(content, from: from, png: png)
			} catch {
				NSLog("[notification-service] as a message: %@", error.localizedDescription)
			}
		}
		guard let png, let attachment = attachment(png) else { return content }
		guard let mutable = content.mutableCopy() as? UNMutableNotificationContent else { return content }
		mutable.attachments = [attachment]
		return mutable
	}

	private static func person(id: String, name: String, image: INImage?, isMe: Bool) -> INPerson {
		INPerson(
			personHandle: INPersonHandle(value: id, type: .unknown),
			nameComponents: nil,
			displayName: name,
			image: image,
			contactIdentifier: nil,
			customIdentifier: id,
			isMe: isMe
		)
	}

	/// The incoming message donated to the system, and `content` updated from it. A channel's
	/// message is a group conversation (more than one recipient), named and pictured by the sender.
	private static func message(_ content: UNNotificationContent, from: Sender, png: Data?) throws
		-> UNNotificationContent
	{
		let image = png.map { INImage(imageData: $0) }
		let sender = person(id: from.id, name: from.name, image: image, isMe: false)
		let groupName = from.conversation.map { INSpeakableString(spokenPhrase: $0) }
		let recipients = groupName.map { _ in [person(id: "me", name: "Me", image: nil, isMe: true), sender] }
		let intent = INSendMessageIntent(
			recipients: recipients,
			outgoingMessageType: .outgoingMessageText,
			content: content.body,
			speakableGroupName: groupName,
			conversationIdentifier: content.threadIdentifier.isEmpty ? nil : content.threadIdentifier,
			serviceName: nil,
			sender: sender,
			attachments: nil
		)
		if groupName != nil, let image {
			intent.setImage(image, forParameterNamed: \.speakableGroupName)
		}
		let interaction = INInteraction(intent: intent, response: nil)
		interaction.direction = .incoming
		interaction.donate(completion: nil)
		return try content.updating(from: intent)
	}

	/// `png` as an attachment, through a file of its own (the system moves it into its store).
	private static func attachment(_ png: Data) -> UNNotificationAttachment? {
		let file = FileManager.default.temporaryDirectory
			.appendingPathComponent("hazel-notification-\(UUID().uuidString).png")
		do {
			try png.write(to: file)
			return try UNNotificationAttachment(identifier: "picture", url: file, options: nil)
		} catch {
			try? FileManager.default.removeItem(at: file)
			NSLog("[notification-service] attachment: %@", error.localizedDescription)
			return nil
		}
	}

	/// `data` (any picture the avatars come as, WebP included) as a square PNG cropped to its
	/// centre, as the app draws avatars, at most `pictureSide` across; nil when it is not a picture.
	static func squarePng(_ data: Data) -> Data? {
		guard let picture = UIImage(data: data), let cg = picture.cgImage else { return nil }
		let side = min(cg.width, cg.height)
		guard side > 0,
			let square = cg.cropping(to: CGRect(
				x: (cg.width - side) / 2, y: (cg.height - side) / 2, width: side, height: side
			))
		else { return nil }
		let out = min(CGFloat(side), pictureSide)
		let format = UIGraphicsImageRendererFormat()
		format.scale = 1
		return UIGraphicsImageRenderer(size: CGSize(width: out, height: out), format: format).pngData { _ in
			UIImage(cgImage: square).draw(in: CGRect(x: 0, y: 0, width: out, height: out))
		}
	}
}
