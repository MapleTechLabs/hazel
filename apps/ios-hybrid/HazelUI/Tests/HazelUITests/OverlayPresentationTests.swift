import SwiftUI
import UIKit
import XCTest
@testable import HazelUI

/// Lane S3: what snapshots cannot draw. A system overlay presents its own view controller (or window),
/// which `layer.render` never captures, so these host each overlay inside a screen in a real window
/// and check what UIKit presented. Not checked here: an open system menu (needs a touch), and closing
/// (the runner has no scene on screen, so a dismissal never completes, even for a plain SwiftUI sheet).
@MainActor
final class OverlayPresentationTests: XCTestCase {
    private var window: UIWindow?
    private var tree = Tree()
    private var seq = 0

    override func tearDown() async throws {
        window?.rootViewController?.presentedViewController?.dismiss(animated: false)
        window?.isHidden = true
        window = nil
    }

    /// `overlay` under a plain host node (not the root's own child, so it presents), on screen.
    private func host(_ overlay: String) async throws -> UIViewController {
        tree = Tree()
        seq = 0
        try apply(#"["create",1,"x:host"]"#, overlay, #"["insert",0,1,null]"#)
        let controller = UIHostingController(rootView: TreeView(tree: tree))
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        await settle()
        return controller
    }

    private func apply(_ ops: String...) throws {
        seq += 1
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: seq, ops: ops)))
    }

    private func settle(_ until: () -> Bool = { false }) async {
        for _ in 0..<40 {
            if until() { return }
            window?.rootViewController?.view.setNeedsLayout()
            window?.rootViewController?.view.layoutIfNeeded()
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    func testSheetPresents() async throws {
        let controller = try await host(#"["create",2,"hz:sheet"],["props",2,{"open":true,"title":"Details"}],["events",2,["dismiss"]],["insert",1,2,null]"#)
        await settle { controller.presentedViewController != nil }
        let sheet = try XCTUnwrap(controller.presentedViewController, "the sheet did not present")
        XCTAssertNotNil(sheet.sheetPresentationController)
    }

    func testDialogWithoutChildrenIsASystemAlert() async throws {
        let ops = #"["create",2,"hz:dialog"],["props",2,{"open":true,"title":"Rename?","description":"Everyone sees it."}],"#
            + #"["create",3,"hz:slot"],["props",3,{"name":"actions"}],["create",4,"hz:button"],["props",4,{"label":"Cancel","variant":"outline"}],"#
            + #"["create",5,"hz:button"],["props",5,{"label":"Rename"}],["insert",3,4,null],["insert",3,5,null],["insert",2,3,null],["insert",1,2,null]"#
        let controller = try await host(ops)
        await settle { controller.presentedViewController != nil }
        let alert = try XCTUnwrap(controller.presentedViewController as? UIAlertController, "not an alert: \(String(describing: controller.presentedViewController))")
        XCTAssertEqual(alert.preferredStyle, .alert)
        XCTAssertEqual(alert.title, "Rename?")
        XCTAssertEqual(alert.message, "Everyone sees it.")
        XCTAssertEqual(alert.actions.map(\.title), ["Cancel", "Rename"])
    }

    func testDestructiveDialogIsAConfirmationDialog() async throws {
        let ops = #"["create",2,"hz:dialog"],["props",2,{"open":true,"destructive":true,"title":"Delete message?"}],"#
            + #"["create",3,"hz:slot"],["props",3,{"name":"actions"}],["create",4,"hz:button"],["props",4,{"label":"Keep","variant":"outline"}],"#
            + #"["create",5,"hz:button"],["props",5,{"label":"Delete","variant":"danger"}],["insert",3,4,null],["insert",3,5,null],["insert",2,3,null],["insert",1,2,null]"#
        let controller = try await host(ops)
        await settle { controller.presentedViewController != nil }
        let sheet = try XCTUnwrap(controller.presentedViewController as? UIAlertController)
        XCTAssertEqual(sheet.preferredStyle, .actionSheet)
        let styles = Dictionary(uniqueKeysWithValues: sheet.actions.map { ($0.title ?? "", $0.style) })
        XCTAssertEqual(styles["Delete"], .destructive)
        XCTAssertEqual(styles["Keep"], .cancel)
    }

    func testDialogWithChildrenIsASheet() async throws {
        let ops = #"["create",2,"hz:dialog"],["props",2,{"open":true,"title":"Rename"}],["create",3,"hz:text"],["text",3,"Name"],"#
            + #"["insert",2,3,null],["insert",1,2,null]"#
        let controller = try await host(ops)
        await settle { controller.presentedViewController != nil }
        let presented = try XCTUnwrap(controller.presentedViewController)
        XCTAssertFalse(presented is UIAlertController)
    }

    func testPopoverStaysAPopoverOnAPhone() async throws {
        let ops = #"["create",2,"hz:popover"],["props",2,{"open":true}],["create",3,"hz:slot"],["props",3,{"name":"anchor"}],"#
            + #"["create",4,"hz:text"],["text",4,"@maya"],["insert",3,4,null],["insert",2,3,null],"#
            + #"["create",5,"hz:text"],["text",5,"Maya Chen"],["insert",2,5,null],["insert",1,2,null]"#
        let controller = try await host(ops)
        await settle { controller.presentedViewController != nil }
        let presented = try XCTUnwrap(controller.presentedViewController)
        XCTAssertEqual(presented.modalPresentationStyle, .popover)
    }

    func testEmojiPickerPresentsASheet() async throws {
        let controller = try await host(#"["create",2,"hz:emojiPicker"],["props",2,{"open":true}],["insert",1,2,null]"#)
        await settle { controller.presentedViewController != nil }
        XCTAssertNotNil(controller.presentedViewController?.sheetPresentationController)
    }

    func testToastFloatsInItsOwnWindow() async throws {
        _ = try await host(#"["create",2,"hz:toast"],["props",2,{"open":true,"title":"Copied"}],["insert",1,2,null]"#)
        await settle { ToastWindow.shared.isShowing }
        XCTAssertTrue(ToastWindow.shared.isShowing)
        XCTAssertEqual(ToastWindow.shared.model.toasts.map(\.id), [2])
        try apply(#"["props",2,{"open":null}]"#)
        await settle { !ToastWindow.shared.isShowing }
        XCTAssertFalse(ToastWindow.shared.isShowing)
    }

    func testMenuEntriesDecode() throws {
        let entries: JSONValue = [
            ["entries": [
                ["id": "copy", "label": "Copy", "icon": "copy"],
                ["id": "notify", "label": "Notifications", "entries": [["id": "all", "label": "All", "checked": true]]],
            ]],
            ["title": "Danger", "entries": [["id": "leave", "label": "Leave", "destructive": true, "disabled": true]]],
        ]
        let groups = OverlayMenuEntry.groups(entries)
        XCTAssertEqual(groups.count, 2)
        XCTAssertEqual(groups[0].entries[1].entries?.first?.checked, true)
        XCTAssertEqual(groups[1].title, "Danger")
        XCTAssertEqual(groups[1].entries[0].destructive, true)
        XCTAssertEqual(OverlayMenuEntry.groups(.string("bad")), [])
        XCTAssertNotNil(UIImage(systemName: OverlayIcon.symbols["copy"]!))
        for (name, symbol) in OverlayIcon.symbols { XCTAssertNotNil(UIImage(systemName: symbol), "\(name): \(symbol)") }
    }
}
