//! The UIKit half of native islands (`hazel_native::islands`): the views the shell has for the
//! components the app marks `data-native`, each laid over the box Rune draws for its element.
//!
//! - `tab-bar`: a `UITabBar` in place of the mobile nav. Its items are the nav's own links and
//!   buttons; a press on one is that element's `click`.
//! - `menu`: a clear button over a Select's trigger, which Rune keeps drawing; a tap opens the
//!   system menu of the Select's options, and a choice is a `change` on the trigger.
//! - `date-picker`: a clear button over a date field; a tap presents a sheet with the system's
//!   calendar, and the day picked is a `change` on the field (`yyyy-MM-dd`).
//! - `context-menu`: no view; a held press on the element opens its menu (`context_menu.rs`).
//!
//! A view is as wide as its box and is clipped, cut out and hidden as the box is (`Placement`):
//! by the list it scrolls in, under a menu Rune draws over it, behind a dialog.
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ptr::NonNull;
use std::rc::Rc;
use std::time::{Duration, Instant};

use block2::RcBlock;
use hazel_native::frames::{Placement, uncovered};
use hazel_native::islands::{self, Draws, IslandSpec, Item, Placed, Realiser};
use objc2::rc::{Retained, Weak};
use objc2::runtime::ProtocolObject;
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::CGMutablePath;
use objc2_foundation::{
    NSArray, NSData, NSDateFormatter, NSObject, NSObjectProtocol, NSString, ns_string,
};
use objc2_quartz_core::CAShapeLayer;
use objc2_ui_kit::{
    UIAction, UIButton, UIButtonType, UIColor, UIContextMenuConfigurationElementOrder,
    UIControlEvents, UIDatePicker, UIDatePickerMode, UIDatePickerStyle, UIImage,
    UIImageRenderingMode, UIMenu, UIMenuElement, UIMenuElementAttributes, UIMenuElementState,
    UIMenuOptions, UISheetPresentationControllerDetent, UITabBar, UITabBarDelegate, UITabBarItem,
    UIUserInterfaceStyle, UIView, UIViewController,
};

/// How long a tab the reader pressed stays selected before the app's own selection wins: the
/// app answers a press with a tree that selects it, or (the Menu item) one that does not.
const OPTIMISTIC: Duration = Duration::from_millis(350);

type Rect = [f32; 4];

fn cg(rect: Rect) -> CGRect {
    CGRect::new(
        CGPoint::new(rect[0] as f64, rect[1] as f64),
        CGSize::new(rect[2] as f64, rect[3] as f64),
    )
}

/// The shell's components, and who draws each.
fn draws(name: &str) -> Option<Draws> {
    match name {
        "tab-bar" => Some(Draws::Native),
        "menu" | "date-picker" | "context-menu" => Some(Draws::Fallback),
        _ => None,
    }
}

/// Makes this shell the one that realises islands.
pub fn install() {
    // `HAZEL_ISLANDS=off` when building leaves every island its fallback, to compare the two.
    if crate::bridge::environment("HAZEL_ISLANDS").as_deref() == Some("off") {
        return;
    }
    islands::set_realiser(Realiser { draws, apply });
}

struct TabIvars {
    /// The bar's items, as the tree last gave them: a press replays on the one at the item's tag.
    items: RefCell<Vec<Item>>,
    pressed: Cell<Option<Instant>>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HazelTabBarDelegate"]
    #[ivars = TabIvars]
    struct TabDelegate;

    unsafe impl NSObjectProtocol for TabDelegate {}

    unsafe impl UITabBarDelegate for TabDelegate {
        #[unsafe(method(tabBar:didSelectItem:))]
        fn did_select(&self, _bar: &UITabBar, item: &UITabBarItem) {
            self.ivars().pressed.set(Some(Instant::now()));
            if let Some(item) = self.ivars().items.borrow().get(item.tag() as usize) {
                islands::press(item);
            }
        }
    }
);

enum Native {
    TabBar {
        bar: Retained<UITabBar>,
        delegate: Retained<TabDelegate>,
    },
    Menu {
        button: Retained<UIButton>,
    },
    DatePicker {
        button: Retained<UIButton>,
        /// The island as the tree last gave it: what a tap opens the sheet with.
        current: Rc<RefCell<IslandSpec>>,
    },
}

struct Island {
    /// Shows the part of the box its ancestors let show; the native view inside keeps the whole
    /// box, so it does not relayout as it scrolls under a clip.
    host: Retained<UIView>,
    native: Native,
    /// The island as last applied: the native view changes only when it does.
    spec: IslandSpec,
    /// The size of the part that shows and the holes in it, when anything covers the view.
    mask: Option<([f32; 2], Vec<Rect>)>,
    /// A tab bar's height for a width, as `sizeThatFits` last said: asked once per width, not
    /// in every frame (it lays the bar out).
    fitted: Option<(f32, f32)>,
}

thread_local! {
    /// The page's appearance, as the last frame said: what a sheet opens in.
    static DARK: Cell<bool> = const { Cell::new(false) };
    static ISLANDS: RefCell<HashMap<String, Island>> = RefCell::new(HashMap::new());
}

fn ui_color(css: &Option<String>) -> Option<Retained<UIColor>> {
    let color = hazel_native::layout::color(css)?;
    let channel = |linear: f32| rune::color::srgb_encode(linear) as f64;
    Some(UIColor::colorWithRed_green_blue_alpha(
        channel(color.r),
        channel(color.g),
        channel(color.b),
        color.a as f64,
    ))
}

fn tab_items(mtm: MainThreadMarker, spec: &IslandSpec) -> Retained<NSArray<UITabBarItem>> {
    let items: Vec<Retained<UITabBarItem>> = spec
        .items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            // The app's own icon, as it draws it; the SF Symbol where it has none.
            let image = item
                .icon
                .as_ref()
                .and_then(|(view, body)| icon_image(*view, body, TAB_ICON))
                .or_else(|| {
                    item.symbol
                        .as_deref()
                        .and_then(|symbol| UIImage::systemImageNamed(&NSString::from_str(symbol)))
                });
            let tab = UITabBarItem::initWithTitle_image_tag(
                UITabBarItem::alloc(mtm),
                Some(&NSString::from_str(&item.title)),
                image.as_deref(),
                index as isize,
            );
            tab.setBadgeValue(item.badge.as_deref().map(NSString::from_str).as_deref());
            tab
        })
        .collect();
    NSArray::from_retained_slice(&items)
}

/// A tab's icon, in points: the app's own size (`size-6`).
const TAB_ICON: f32 = 24.0;
/// Pixels per point the icons are drawn at: every iPhone with this app's OS is 3x.
const ICON_SCALE: f32 = 3.0;

/// One of the app's inline SVG icons as a template image, `points` square, which the native view
/// tints (selected, unselected) as it does an SF Symbol. `currentColor` draws black, and only the
/// shape's alpha counts.
fn icon_image(view: f32, body: &str, points: f32) -> Option<Retained<UIImage>> {
    let markup = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {view} {view}\" width=\"{points}\" height=\"{points}\">{body}</svg>"
    );
    let tree = resvg::usvg::Tree::from_str(&markup, &resvg::usvg::Options::default()).ok()?;
    let pixels = (points * ICON_SCALE).round() as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(pixels, pixels)?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(ICON_SCALE, ICON_SCALE),
        &mut pixmap.as_mut(),
    );
    let png = pixmap.encode_png().ok()?;
    let image = UIImage::imageWithData_scale(&NSData::from_vec(png), ICON_SCALE as f64)?;
    Some(image.imageWithRenderingMode(UIImageRenderingMode::AlwaysTemplate))
}

/// The app's selection: the bar shows it unless the reader pressed a tab a moment ago.
fn select_tab(bar: &UITabBar, spec: &IslandSpec) {
    let wanted = spec.items.iter().position(|item| item.selected);
    let shown = bar.selectedItem().map(|item| item.tag() as usize);
    if wanted == shown {
        return;
    }
    let items = bar.items();
    let item = wanted.and_then(|index| items.as_ref().map(|items| items.objectAtIndex(index)));
    bar.setSelectedItem(item.as_deref());
}

fn tint_tab_bar(bar: &UITabBar, spec: &IslandSpec) {
    let tint = spec
        .items
        .iter()
        .find(|item| item.selected)
        .and_then(|item| ui_color(&item.color));
    if let Some(tint) = tint {
        unsafe { bar.setTintColor(Some(&tint)) };
    }
}

/// The system menu of a Select's options (`props.items`), the selected one checked. A choice is
/// a `change` on the island's element, with the option's key.
/// The island's menu (`props.items`, from a Select or the app's menus): items, `{ separator }`
/// between groups (each group an inline section), and `{ label, items }` submenus. A choice is a
/// `change` on the island with the item's key.
fn menu_of(mtm: MainThreadMarker, spec: &IslandSpec) -> Retained<UIMenu> {
    let selected = spec.props.get("selected").and_then(|key| key.as_str());
    let options = spec.props.get("items").and_then(|items| items.as_array());
    let children = menu_children(
        mtm,
        spec,
        selected,
        options.map_or(&[][..], |o| o.as_slice()),
    );
    UIMenu::menuWithChildren(&NSArray::from_retained_slice(&children), mtm)
}

fn menu_children(
    mtm: MainThreadMarker,
    spec: &IslandSpec,
    selected: Option<&str>,
    options: &[serde_json::Value],
) -> Vec<Retained<UIMenuElement>> {
    let groups: Vec<&[serde_json::Value]> = options
        .split(|option| option.get("separator").is_some())
        .filter(|group| !group.is_empty())
        .collect();
    let element = |option: &serde_json::Value| menu_element(mtm, spec, selected, option);
    if groups.len() <= 1 {
        return options.iter().filter_map(element).collect();
    }
    groups
        .into_iter()
        .map(|group| inline_section(mtm, group.iter().filter_map(element).collect()))
        .collect()
}

/// A group of items shown as one section of the menu, divided from the next.
fn inline_section(
    mtm: MainThreadMarker,
    children: Vec<Retained<UIMenuElement>>,
) -> Retained<UIMenuElement> {
    let section = UIMenu::menuWithTitle_image_identifier_options_children(
        ns_string!(""),
        None,
        None,
        UIMenuOptions::DisplayInline,
        &NSArray::from_retained_slice(&children),
        mtm,
    );
    Retained::into_super(section)
}

fn menu_element(
    mtm: MainThreadMarker,
    spec: &IslandSpec,
    selected: Option<&str>,
    option: &serde_json::Value,
) -> Option<Retained<UIMenuElement>> {
    let flag = |name: &str| option.get(name).and_then(|v| v.as_bool()) == Some(true);
    let label = option.get("label").and_then(|label| label.as_str());
    let image = option
        .get("symbol")
        .and_then(|symbol| symbol.as_str())
        .and_then(|symbol| UIImage::systemImageNamed(&NSString::from_str(symbol)));
    if let Some(items) = option.get("items").and_then(|items| items.as_array()) {
        let children = menu_children(mtm, spec, selected, items);
        let submenu = UIMenu::menuWithTitle_image_identifier_options_children(
            &NSString::from_str(label.unwrap_or_default()),
            image.as_deref(),
            None,
            UIMenuOptions::empty(),
            &NSArray::from_retained_slice(&children),
            mtm,
        );
        return Some(Retained::into_super(submenu));
    }
    let key = option.get("key")?.as_str()?.to_string();
    let title = NSString::from_str(label.unwrap_or(&key));
    let island = spec.clone();
    let choice = key.clone();
    let handler = RcBlock::new(move |_: NonNull<UIAction>| {
        islands::change(&island, &choice);
    });
    let action = unsafe {
        UIAction::actionWithTitle_image_identifier_handler(
            &title,
            image.as_deref(),
            None,
            RcBlock::as_ptr(&handler),
            mtm,
        )
    };
    if selected == Some(key.as_str()) || flag("checked") {
        action.setState(UIMenuElementState::On);
    }
    let mut attributes = UIMenuElementAttributes::empty();
    if flag("disabled") {
        attributes |= UIMenuElementAttributes::Disabled;
    }
    if flag("destructive") {
        attributes |= UIMenuElementAttributes::Destructive;
    }
    action.setAttributes(attributes);
    Some(Retained::into_super(action))
}

fn interface_style(dark: bool) -> UIUserInterfaceStyle {
    if dark {
        UIUserInterfaceStyle::Dark
    } else {
        UIUserInterfaceStyle::Light
    }
}

/// Days cross as `yyyy-MM-dd`, in the reader's own calendar day.
fn day_formatter() -> Retained<NSDateFormatter> {
    let formatter = NSDateFormatter::new();
    formatter.setDateFormat(Some(ns_string!("yyyy-MM-dd")));
    formatter
}

/// A sheet with the system's calendar on the field's day (`props.value`, not before `props.min`).
/// The day picked is a `change` on the island's element, and closes the sheet.
/// Whether a `menu` island shows as a sheet rather than a pull-down.
fn is_sheet(spec: &IslandSpec) -> bool {
    spec.props.get("presentation").and_then(|p| p.as_str()) == Some("sheet")
}

/// The controller to present from: the one on top of the window's root.
fn presenter(mtm: MainThreadMarker) -> Option<Retained<UIViewController>> {
    let mut top = crate::bridge::window(mtm)?.rootViewController()?;
    while let Some(next) = top.presentedViewController() {
        top = next;
    }
    Some(top)
}

fn present_date_picker(mtm: MainThreadMarker, spec: &IslandSpec) {
    let Some(presenter) = crate::bridge::window(mtm).and_then(|window| window.rootViewController())
    else {
        return;
    };
    let controller =
        UIViewController::initWithNibName_bundle(UIViewController::alloc(mtm), None, None);
    let Some(view) = controller.view() else {
        return;
    };
    view.setBackgroundColor(Some(&UIColor::systemBackgroundColor()));
    let width = presenter
        .view()
        .map_or(390.0, |view| view.bounds().size.width);
    let frame = CGRect::new(CGPoint::new(16.0, 24.0), CGSize::new(width - 32.0, 340.0));
    let picker: Retained<UIDatePicker> =
        unsafe { msg_send![UIDatePicker::alloc(mtm), initWithFrame: frame] };
    picker.setDatePickerMode(UIDatePickerMode::Date);
    picker.setPreferredDatePickerStyle(UIDatePickerStyle::Inline);
    let formatter = day_formatter();
    let day = |name: &str| {
        let day = spec.props.get(name)?.as_str()?;
        formatter.dateFromString(&NSString::from_str(day))
    };
    if let Some(min) = day("min") {
        picker.setMinimumDate(Some(&min));
    }
    if let Some(value) = day("value") {
        picker.setDate(&value);
    }
    let island = spec.clone();
    let sheet = Weak::from_retained(&controller);
    let handler = RcBlock::new(move |action: NonNull<UIAction>| {
        // SAFETY: UIKit passes the action it is running.
        let sender = unsafe { action.as_ref() }.sender();
        let Some(picker) = sender.and_then(|sender| sender.downcast::<UIDatePicker>().ok()) else {
            return;
        };
        islands::change(
            &island,
            &day_formatter().stringFromDate(&picker.date()).to_string(),
        );
        if let Some(sheet) = sheet.load() {
            sheet.dismissViewControllerAnimated_completion(true, None);
        }
    });
    let picked = unsafe { UIAction::actionWithHandler(RcBlock::as_ptr(&handler), mtm) };
    picker.addAction_forControlEvents(&picked, UIControlEvents::ValueChanged);
    view.addSubview(&picker);
    if let Some(sheet) = controller.sheetPresentationController() {
        let medium = UISheetPresentationControllerDetent::mediumDetent(mtm);
        sheet.setDetents(&NSArray::from_retained_slice(&[medium]));
        sheet.setPrefersGrabberVisible(true);
    }
    controller.setOverrideUserInterfaceStyle(interface_style(DARK.get()));
    presenter.presentViewController_animated_completion(&controller, true, None);
}

fn create(mtm: MainThreadMarker, parent: &UIView, spec: &IslandSpec) -> Option<Island> {
    let zero = cg([0.0; 4]);
    let host = UIView::initWithFrame(UIView::alloc(mtm), zero);
    host.setClipsToBounds(true);
    let native = match spec.name.as_str() {
        "tab-bar" => {
            let bar: Retained<UITabBar> =
                unsafe { msg_send![UITabBar::alloc(mtm), initWithFrame: zero] };
            let delegate: Retained<TabDelegate> = {
                let this = TabDelegate::alloc(mtm).set_ivars(TabIvars {
                    items: RefCell::new(spec.items.clone()),
                    pressed: Cell::new(None),
                });
                unsafe { msg_send![super(this), init] }
            };
            bar.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            bar.setItems(Some(&tab_items(mtm, spec)));
            select_tab(&bar, spec);
            tint_tab_bar(&bar, spec);
            host.addSubview(&bar);
            Native::TabBar { bar, delegate }
        }
        // An app-level picker (the account, the servers) rises as a sheet.
        "menu" if is_sheet(spec) => {
            let current = Rc::new(RefCell::new(spec.clone()));
            let shown = current.clone();
            let handler = RcBlock::new(move |_: NonNull<UIAction>| {
                if let Some(presenter) = presenter(mtm) {
                    crate::menu_sheet::present(mtm, &presenter, &shown.borrow(), DARK.get());
                }
            });
            let open = unsafe { UIAction::actionWithHandler(RcBlock::as_ptr(&handler), mtm) };
            let button =
                UIButton::buttonWithType_primaryAction(UIButtonType::Custom, Some(&open), mtm);
            host.addSubview(&button);
            Native::DatePicker { button, current }
        }
        "menu" => {
            let button = UIButton::buttonWithType(UIButtonType::Custom, mtm);
            button.setMenu(Some(&menu_of(mtm, spec)));
            button.setShowsMenuAsPrimaryAction(true);
            // The items in the order the app gives them, however the menu opens (upward from
            // a trigger low on the screen, UIKit would turn them around).
            button.setPreferredMenuElementOrder(UIContextMenuConfigurationElementOrder::Fixed);
            host.addSubview(&button);
            Native::Menu { button }
        }
        "date-picker" => {
            let current = Rc::new(RefCell::new(spec.clone()));
            let shown = current.clone();
            let handler = RcBlock::new(move |_: NonNull<UIAction>| {
                present_date_picker(mtm, &shown.borrow());
            });
            let open = unsafe { UIAction::actionWithHandler(RcBlock::as_ptr(&handler), mtm) };
            let button =
                UIButton::buttonWithType_primaryAction(UIButtonType::Custom, Some(&open), mtm);
            host.addSubview(&button);
            Native::DatePicker { button, current }
        }
        _ => return None,
    };
    parent.addSubview(&host);
    Some(Island {
        host,
        native,
        spec: spec.clone(),
        mask: None,
        fitted: None,
    })
}

/// The island's tree changed: the native view takes what is new in it.
fn update(mtm: MainThreadMarker, island: &mut Island, spec: &IslandSpec) {
    match &island.native {
        Native::TabBar { bar, delegate } => {
            type Look = (String, Option<String>, Option<String>, Option<String>);
            let titles = |spec: &IslandSpec| -> Vec<Look> {
                spec.items
                    .iter()
                    .map(|item| {
                        let icon = item.icon.as_ref().map(|(_, body)| body.clone());
                        (
                            item.title.clone(),
                            item.symbol.clone(),
                            item.badge.clone(),
                            icon,
                        )
                    })
                    .collect()
            };
            if titles(spec) != titles(&island.spec) {
                bar.setItems(Some(&tab_items(mtm, spec)));
                island.fitted = None;
            }
            *delegate.ivars().items.borrow_mut() = spec.items.clone();
            tint_tab_bar(bar, spec);
        }
        Native::Menu { button } => button.setMenu(Some(&menu_of(mtm, spec))),
        Native::DatePicker { current, .. } => *current.borrow_mut() = spec.clone(),
    }
    island.spec = spec.clone();
}

fn put(island: &mut Island, placement: &Placement, bottom_inset: f32) {
    let [x, y, w, h] = placement.rect;
    let (rect, visible) = match &island.native {
        // A tab bar is as tall as the system makes one, not as the nav it stands for, and
        // reaches the screen's bottom edge, under the home indicator: stretched over the nav's
        // box it spreads its icons and titles apart. The nav pads itself down to that edge.
        Native::TabBar { bar, .. } => {
            let bottom = y + h;
            let fitted = match island.fitted {
                Some((width, height)) if width == w => height,
                _ => {
                    let height = bar.sizeThatFits(CGSize::new(w as f64, 0.0)).height as f32;
                    island.fitted = Some((w, height));
                    height
                }
            };
            // The bar adds the home indicator's inset itself once it is in the window.
            let height = if fitted > bottom_inset + 1.0 {
                fitted
            } else {
                fitted + bottom_inset
            };
            let rect = [x, bottom - height, w, height];
            let [vx, _, vw, _] = placement.visible;
            (rect, [vx, rect[1], vw, height])
        }
        Native::Menu { .. } | Native::DatePicker { .. } => (placement.rect, placement.visible),
    };
    let [vx, vy, ..] = visible;
    let host_frame = cg(visible);
    if island.host.frame() != host_frame {
        island.host.setFrame(host_frame);
    }
    let inner = cg([rect[0] - vx, rect[1] - vy, rect[2], rect[3]]);
    let view: &UIView = match &island.native {
        Native::TabBar { bar, .. } => bar,
        Native::Menu { button } | Native::DatePicker { button, .. } => button,
    };
    if view.frame() != inner {
        view.setFrame(inner);
    }
    island.host.setHidden(false);
    if let Native::TabBar { bar, delegate } = &island.native {
        let settled = delegate
            .ivars()
            .pressed
            .get()
            .is_none_or(|at| at.elapsed() > OPTIMISTIC);
        if settled {
            select_tab(bar, &island.spec);
        }
    }

    // Cut out where Rune draws over the view (a menu, a sticky header, a sheet's backdrop):
    // rebuilt when the covers move and when the part that shows changes size.
    let holes: Vec<Rect> = placement
        .holes
        .iter()
        .map(|[hx, hy, hw, hh]| [hx - vx, hy - vy, *hw, *hh])
        .collect();
    let size = [visible[2], visible[3]];
    let mask = (!holes.is_empty()).then_some((size, holes));
    if island.mask == mask {
        return;
    }
    let layer = island.host.layer();
    match &mask {
        None => unsafe { layer.setMask(None) },
        Some((size, holes)) => {
            // The parts nothing covers, as rects that do not overlap.
            let path = CGMutablePath::new();
            for shown in uncovered(*size, holes) {
                unsafe { CGMutablePath::add_rect(Some(&path), std::ptr::null(), cg(shown)) };
            }
            let shape = CAShapeLayer::new();
            shape.setFrame(cg([0.0, 0.0, size[0], size[1]]));
            shape.setPath(Some(&path));
            unsafe { layer.setMask(Some(&shape)) };
        }
    }
    island.mask = mask;
}

/// Brings the native views in line with the islands of the frame just drawn.
fn apply(placed: &[Placed], dark: bool) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(window) = crate::bridge::window(mtm) else {
        return;
    };
    DARK.set(dark);
    let bottom_inset = window.safeAreaInsets().bottom as f32;
    // Inside the view controller's view (Rune's own), not the window: UIKit presents a menu or a
    // sheet from a view only through the view controller above it.
    let Some(parent) = window
        .rootViewController()
        .and_then(|controller| controller.view())
    else {
        return;
    };
    ISLANDS.with_borrow_mut(|islands| {
        let gone: Vec<String> = islands
            .keys()
            .filter(|path| !placed.iter().any(|(spec, _)| spec.path == **path))
            .cloned()
            .collect();
        for path in gone {
            if let Some(island) = islands.remove(&path) {
                island.host.removeFromSuperview();
            }
        }
        crate::context_menu::begin(dark);
        for (spec, placement) in placed {
            // A region Rune's own view answers for, with no view of its own.
            if spec.name == "context-menu" {
                crate::context_menu::place(spec, placement.as_ref());
                continue;
            }
            // The same path with another component is another view.
            if islands
                .get(&spec.path)
                .is_some_and(|island| island.spec.name != spec.name)
                && let Some(island) = islands.remove(&spec.path)
            {
                island.host.removeFromSuperview();
            }
            if !islands.contains_key(&spec.path) {
                if placement.is_none() {
                    continue;
                }
                let Some(island) = create(mtm, &parent, spec) else {
                    continue;
                };
                crate::bridge::log(&format!("[islands] {} at {}", spec.name, spec.path));
                islands.insert(spec.path.clone(), island);
            }
            let Some(island) = islands.get_mut(&spec.path) else {
                continue;
            };
            if island.spec != **spec {
                update(mtm, island, spec);
            }
            // The app's theme, not the system's: a dark page gets dark glass and menus.
            let style = interface_style(dark);
            if island.host.overrideUserInterfaceStyle() != style {
                island.host.setOverrideUserInterfaceStyle(style);
            }
            match placement {
                Some(placement) => put(island, placement, bottom_inset),
                None => island.host.setHidden(true),
            }
        }
    });
    crate::context_menu::end(mtm, &parent);
}
