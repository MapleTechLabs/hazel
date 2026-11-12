//! The `context-menu` island: the system's long-press menu for an element Rune draws (a message).
//!
//! Unlike the other islands it has no view of its own. A list holds many of these and scrolls,
//! so each one is only a region: where its element was drawn in the last frame. One
//! `UIContextMenuInteraction` on Rune's view asks, when a press has been held, which region is
//! under the finger, and opens that element's menu (`props.groups`, with a row of quick
//! reactions from `props.reactions`). A choice is a `change` on the element, with the action's key.
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ptr::NonNull;

use block2::RcBlock;
use hazel_native::frames::Placement;
use hazel_native::islands::{self, IslandSpec};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_foundation::{NSArray, NSCopying, NSObject, NSObjectProtocol, NSString, ns_string};
use objc2_ui_kit::{
    UIAction, UIBezierPath, UIColor, UIContextMenuConfiguration, UIContextMenuInteraction,
    UIContextMenuInteractionAnimating, UIContextMenuInteractionDelegate, UIEdgeInsets, UIImage,
    UIInteraction, UIMenu, UIMenuElement, UIMenuElementAttributes, UIMenuElementSize,
    UIMenuOptions, UIPreviewParameters, UIPreviewTarget, UITargetedPreview, UIUserInterfaceStyle,
    UIView,
};

type Rect = [f32; 4];

/// How many small elements a menu shows side by side; more wrap onto rows of their own.
const REACTIONS_IN_A_ROW: usize = 4;

struct Region {
    spec: IslandSpec,
    /// Where the element shows, and where Rune draws over it; `None` while none of it shows.
    shown: Option<(Rect, Vec<Rect>)>,
    /// In the frame being applied.
    live: bool,
}

thread_local! {
    static REGIONS: RefCell<HashMap<String, Region>> = RefCell::new(HashMap::new());
    static INTERACTION: RefCell<Option<(Retained<UIContextMenuInteraction>, Retained<ContextMenus>)>> =
        const { RefCell::new(None) };
    /// The page's appearance, which the menu takes for as long as it is open.
    static DARK: Cell<bool> = const { Cell::new(false) };
}

fn contains([x, y, w, h]: Rect, at: CGPoint) -> bool {
    let (px, py) = (at.x as f32, at.y as f32);
    px >= x && px < x + w && py >= y && py < y + h
}

/// A frame's islands are about to be placed.
pub fn begin(dark: bool) {
    DARK.set(dark);
    REGIONS.with_borrow_mut(|regions| {
        for region in regions.values_mut() {
            region.live = false;
        }
    });
}

/// The island at `spec.path`, where the frame just drawn has it.
pub fn place(spec: &IslandSpec, placement: Option<&Placement>) {
    let shown = placement.map(|placement| (placement.visible, placement.holes.clone()));
    REGIONS.with_borrow_mut(|regions| match regions.get_mut(&spec.path) {
        Some(region) => {
            if region.spec != *spec {
                region.spec = spec.clone();
            }
            region.shown = shown;
            region.live = true;
        }
        None => {
            regions.insert(
                spec.path.clone(),
                Region {
                    spec: spec.clone(),
                    shown,
                    live: true,
                },
            );
        }
    });
}

/// The frame's islands are placed: the ones that left the tree go, and Rune's view listens for
/// a held press once there is anything to open.
pub fn end(mtm: MainThreadMarker, parent: &UIView) {
    let any = REGIONS.with_borrow_mut(|regions| {
        regions.retain(|_, region| region.live);
        !regions.is_empty()
    });
    if !any || INTERACTION.with_borrow(|interaction| interaction.is_some()) {
        return;
    }
    let delegate: Retained<ContextMenus> = {
        let this = ContextMenus::alloc(mtm).set_ivars(MenuIvars {
            target: Cell::new(None),
        });
        unsafe { msg_send![super(this), init] }
    };
    let interaction = UIContextMenuInteraction::initWithDelegate(
        UIContextMenuInteraction::alloc(mtm),
        ProtocolObject::from_ref(&*delegate),
    );
    parent.addInteraction(ProtocolObject::from_ref(&*interaction));
    INTERACTION.set(Some((interaction, delegate)));
}

/// The island whose element is drawn at `at`, and where.
fn region_at(at: CGPoint) -> Option<(IslandSpec, Rect)> {
    REGIONS.with_borrow(|regions| {
        regions.values().find_map(|region| {
            let (rect, holes) = region.shown.as_ref()?;
            let pressed = contains(*rect, at) && !holes.iter().any(|hole| contains(*hole, at));
            pressed.then(|| (region.spec.clone(), *rect))
        })
    })
}

fn action(
    mtm: MainThreadMarker,
    island: &IslandSpec,
    title: &str,
    symbol: Option<&str>,
    value: String,
) -> Retained<UIAction> {
    let island = island.clone();
    let handler = RcBlock::new(move |_: NonNull<UIAction>| islands::change(&island, &value));
    let image = symbol.and_then(|symbol| UIImage::systemImageNamed(&NSString::from_str(symbol)));
    unsafe {
        UIAction::actionWithTitle_image_identifier_handler(
            &NSString::from_str(title),
            image.as_deref(),
            None,
            RcBlock::as_ptr(&handler),
            mtm,
        )
    }
}

fn inline(mtm: MainThreadMarker, children: Vec<Retained<UIMenuElement>>) -> Retained<UIMenu> {
    UIMenu::menuWithTitle_image_identifier_options_children(
        ns_string!(""),
        None,
        None,
        UIMenuOptions::DisplayInline,
        &NSArray::from_retained_slice(&children),
        mtm,
    )
}

/// The element's menu: its quick reactions in a row, then each group of actions.
fn menu_of(mtm: MainThreadMarker, island: &IslandSpec) -> Retained<UIMenu> {
    let props = &island.props;
    let text = |value: &serde_json::Value, name: &str| {
        value
            .get(name)
            .and_then(|field| field.as_str())
            .map(str::to_string)
    };
    let mut sections: Vec<Retained<UIMenuElement>> = Vec::new();
    let prefix = text(props, "reactionPrefix").unwrap_or_default();
    let reactions: Vec<Retained<UIMenuElement>> = props
        .get("reactions")
        .and_then(|reactions| reactions.as_array())
        .into_iter()
        .flatten()
        .filter_map(|emoji| emoji.as_str())
        // As many as the system lays out in one row.
        .take(REACTIONS_IN_A_ROW)
        .map(|emoji| {
            Retained::into_super(action(mtm, island, emoji, None, format!("{prefix}{emoji}")))
        })
        .collect();
    if !reactions.is_empty() {
        let row = inline(mtm, reactions);
        row.setPreferredElementSize(UIMenuElementSize::Small);
        sections.push(Retained::into_super(row));
    }
    let groups = props.get("groups").and_then(|groups| groups.as_array());
    for group in groups.into_iter().flatten() {
        let items: Vec<Retained<UIMenuElement>> = group
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let key = text(item, "key")?;
                let title = text(item, "label").unwrap_or_else(|| key.clone());
                let item_action = action(mtm, island, &title, text(item, "symbol").as_deref(), key);
                if item.get("destructive").and_then(|d| d.as_bool()) == Some(true) {
                    item_action.setAttributes(UIMenuElementAttributes::Destructive);
                }
                Some(Retained::into_super(item_action))
            })
            .collect();
        if !items.is_empty() {
            sections.push(Retained::into_super(inline(mtm, items)));
        }
    }
    UIMenu::menuWithChildren(&NSArray::from_retained_slice(&sections), mtm)
}

struct MenuIvars {
    /// Where the element the open menu belongs to was drawn: what lifts while it is open.
    target: Cell<Option<Rect>>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HazelContextMenus"]
    #[ivars = MenuIvars]
    struct ContextMenus;

    unsafe impl NSObjectProtocol for ContextMenus {}

    unsafe impl UIContextMenuInteractionDelegate for ContextMenus {
        #[unsafe(method_id(contextMenuInteraction:configurationForMenuAtLocation:))]
        fn configuration(
            &self,
            interaction: &UIContextMenuInteraction,
            location: CGPoint,
        ) -> Option<Retained<UIContextMenuConfiguration>> {
            self.configure(interaction, location)
        }

        #[unsafe(method_id(contextMenuInteraction:configuration:highlightPreviewForItemWithIdentifier:))]
        fn highlight_preview(
            &self,
            interaction: &UIContextMenuInteraction,
            _configuration: &UIContextMenuConfiguration,
            _identifier: &ProtocolObject<dyn NSCopying>,
        ) -> Option<Retained<UITargetedPreview>> {
            self.preview(interaction)
        }

        #[unsafe(method_id(contextMenuInteraction:configuration:dismissalPreviewForItemWithIdentifier:))]
        fn dismissal_preview(
            &self,
            interaction: &UIContextMenuInteraction,
            _configuration: &UIContextMenuConfiguration,
            _identifier: &ProtocolObject<dyn NSCopying>,
        ) -> Option<Retained<UITargetedPreview>> {
            self.preview(interaction)
        }

        #[unsafe(method(contextMenuInteraction:willEndForConfiguration:animator:))]
        fn will_end(
            &self,
            interaction: &UIContextMenuInteraction,
            _configuration: &UIContextMenuConfiguration,
            animator: Option<&ProtocolObject<dyn UIContextMenuInteractionAnimating>>,
        ) {
            let Some(window) = interaction.view().and_then(|view| view.window()) else {
                return;
            };
            // Back to the system's appearance once the menu has animated away.
            let restore = RcBlock::new(move || {
                window.setOverrideUserInterfaceStyle(UIUserInterfaceStyle::Unspecified);
            });
            match animator {
                Some(animator) => animator.addCompletion(&restore),
                None => restore.call(()),
            }
        }
    }
);

impl ContextMenus {
    /// The menu of the element under a held press; none when nothing with one is drawn there.
    fn configure(
        &self,
        interaction: &UIContextMenuInteraction,
        location: CGPoint,
    ) -> Option<Retained<UIContextMenuConfiguration>> {
        let mtm = self.mtm();
        let (island, rect) = region_at(location)?;
        self.ivars().target.set(Some(rect));
        // The menu opens in the page's appearance, not the system's: the window takes it
        // until the menu has gone (`will_end`).
        if let Some(window) = interaction.view().and_then(|view| view.window()) {
            window.setOverrideUserInterfaceStyle(if DARK.get() {
                UIUserInterfaceStyle::Dark
            } else {
                UIUserInterfaceStyle::Light
            });
        }
        let provider = RcBlock::new(move |_: NonNull<NSArray<UIMenuElement>>| {
            Retained::autorelease_ptr(menu_of(mtm, &island))
        });
        Some(unsafe {
            UIContextMenuConfiguration::configurationWithIdentifier_previewProvider_actionProvider(
                None,
                std::ptr::null_mut(),
                RcBlock::as_ptr(&provider),
                mtm,
            )
        })
    }

    /// What lifts with the menu: a picture of the element as Rune drew it, where it is.
    fn preview(
        &self,
        interaction: &UIContextMenuInteraction,
    ) -> Option<Retained<UITargetedPreview>> {
        let mtm = self.mtm();
        let view = interaction.view()?;
        let [x, y, w, h] = self.ivars().target.get()?;
        let frame = CGRect::new(
            CGPoint::new(x as f64, y as f64),
            CGSize::new(w as f64, h as f64),
        );
        let zero = UIEdgeInsets {
            top: 0.0,
            left: 0.0,
            bottom: 0.0,
            right: 0.0,
        };
        let picture = view
            .resizableSnapshotViewFromRect_afterScreenUpdates_withCapInsets(frame, false, zero)?;
        let bounds = CGRect::new(CGPoint::new(0.0, 0.0), frame.size);
        let parameters = UIPreviewParameters::new(mtm);
        parameters.setBackgroundColor(Some(&UIColor::clearColor()));
        parameters.setVisiblePath(Some(&UIBezierPath::bezierPathWithRoundedRect_cornerRadius(
            bounds, 12.0,
        )));
        let center = CGPoint::new((x + w / 2.0) as f64, (y + h / 2.0) as f64);
        let target =
            UIPreviewTarget::initWithContainer_center(UIPreviewTarget::alloc(mtm), &view, center);
        Some(UITargetedPreview::initWithView_parameters_target(
            UITargetedPreview::alloc(mtm),
            &picture,
            &parameters,
            &target,
        ))
    }
}
