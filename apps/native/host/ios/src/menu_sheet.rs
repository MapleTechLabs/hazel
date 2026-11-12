//! A `menu` island shown as a sheet (`props.presentation: "sheet"`): an app-level picker, such as
//! the account or the servers, rises from the bottom edge as a phone's own does. A title and
//! subtitle over grouped, rounded sections of rows (an SF Symbol, the item's words, a checkmark on
//! the current one, red for a destructive one), the sheet only as tall as what it holds. A row's
//! press closes the sheet and is a `change` on the island with the item's key, as a pull-down
//! menu's choice is.
use std::ptr::NonNull;

use block2::RcBlock;
use hazel_native::islands::{self, IslandSpec};
use objc2::rc::{Retained, Weak};
use objc2::runtime::ProtocolObject;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_core_foundation::{CGFloat, CGPoint, CGRect, CGSize};
use objc2_foundation::{NSArray, NSString};
use objc2_quartz_core::kCACornerCurveContinuous;
use objc2_ui_kit::{
    NSDirectionalEdgeInsets, UIAction, UIButton, UIButtonConfiguration, UIColor,
    UIControlContentHorizontalAlignment, UIFont, UIImage, UIImageSymbolConfiguration, UIImageView,
    UILabel, UISheetPresentationControllerDetent,
    UISheetPresentationControllerDetentResolutionContext, UIUserInterfaceStyle, UIView,
    UIViewContentMode, UIViewController,
};
use serde_json::Value;

/// A row's height: a thumb's target and some air, as Settings' rows.
const ROW: CGFloat = 52.0;
/// The sheet's side margins, and the gap between sections.
const MARGIN: CGFloat = 16.0;
const GAP: CGFloat = 20.0;
/// Where the rows' words start, past the icon.
const TEXT_INSET: CGFloat = 56.0;
/// The icon's slot: its left edge and width.
const ICON_SLOT: (CGFloat, CGFloat) = (14.0, 30.0);
/// The brand purple (`#6938EF`): the checkmark's colour.
const BRAND: (CGFloat, CGFloat, CGFloat) = (0x69 as CGFloat, 0x38 as CGFloat, 0xEF as CGFloat);

/// One row of the sheet.
struct Row {
    key: String,
    label: String,
    symbol: Option<String>,
    disabled: bool,
    destructive: bool,
    checked: bool,
}

/// The island's items as sections of rows: separators divide them, and a submenu's items are a
/// section of their own (a sheet has no nesting).
fn sections(items: &[Value], selected: Option<&str>) -> Vec<Vec<Row>> {
    let flag = |item: &Value, name: &str| item.get(name).and_then(Value::as_bool) == Some(true);
    let text =
        |item: &Value, name: &str| item.get(name).and_then(Value::as_str).map(str::to_string);
    let mut out: Vec<Vec<Row>> = vec![Vec::new()];
    for item in items {
        if item.get("separator").is_some() {
            out.push(Vec::new());
        } else if let Some(children) = item.get("items").and_then(Value::as_array) {
            out.extend(sections(children, selected));
            out.push(Vec::new());
        } else if let Some(key) = text(item, "key") {
            let current = out.last_mut().expect("a section");
            current.push(Row {
                label: text(item, "label").unwrap_or_else(|| key.clone()),
                checked: flag(item, "checked") || selected == Some(key.as_str()),
                key,
                symbol: text(item, "symbol"),
                disabled: flag(item, "disabled"),
                destructive: flag(item, "destructive"),
            });
        }
    }
    out.retain(|rows| !rows.is_empty());
    out
}

fn label(
    mtm: MainThreadMarker,
    text: &str,
    font: &UIFont,
    color: &UIColor,
    frame: CGRect,
) -> Retained<UILabel> {
    let label = UILabel::initWithFrame(UILabel::alloc(mtm), frame);
    label.setText(Some(&NSString::from_str(text)));
    unsafe {
        label.setFont(Some(font));
        label.setTextColor(Some(color));
    }
    label
}

fn rounded(view: &UIView, radius: CGFloat) {
    let layer = view.layer();
    layer.setCornerRadius(radius);
    layer.setCornerCurve(unsafe { kCACornerCurveContinuous });
    view.setClipsToBounds(true);
}

/// Presents the island's menu as a sheet over `presenter`, in the page's theme (`dark`).
pub fn present(mtm: MainThreadMarker, presenter: &UIViewController, spec: &IslandSpec, dark: bool) {
    let props = &spec.props;
    let selected = props.get("selected").and_then(Value::as_str);
    let items = props
        .get("items")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    let sections = sections(items, selected);
    let controller =
        UIViewController::initWithNibName_bundle(UIViewController::alloc(mtm), None, None);
    let Some(view) = controller.view() else {
        return;
    };
    let width = presenter
        .view()
        .map_or(390.0, |view| view.bounds().size.width);
    let inner = width - MARGIN * 2.0;
    let mut y: CGFloat = 28.0;

    let text = |name: &str| {
        props
            .get(name)
            .and_then(Value::as_str)
            .filter(|t| !t.is_empty())
    };
    if let Some(title) = text("title") {
        let font = UIFont::boldSystemFontOfSize(20.0);
        let frame = CGRect::new(
            CGPoint::new(MARGIN + 8.0, y),
            CGSize::new(inner - 16.0, 26.0),
        );
        view.addSubview(&label(mtm, title, &font, &UIColor::labelColor(), frame));
        y += 28.0;
        if let Some(subtitle) = text("subtitle") {
            let font = UIFont::systemFontOfSize(15.0);
            let frame = CGRect::new(
                CGPoint::new(MARGIN + 8.0, y),
                CGSize::new(inner - 16.0, 20.0),
            );
            view.addSubview(&label(
                mtm,
                subtitle,
                &font,
                &UIColor::secondaryLabelColor(),
                frame,
            ));
            y += 22.0;
        }
        y += 14.0;
    }

    let sheet = Weak::from_retained(&controller);
    let brand = UIColor::colorWithRed_green_blue_alpha(
        BRAND.0 / 255.0,
        BRAND.1 / 255.0,
        BRAND.2 / 255.0,
        1.0,
    );
    let symbol_size = UIImageSymbolConfiguration::configurationWithPointSize(17.0);
    for rows in &sections {
        let height = ROW * rows.len() as CGFloat;
        let group = UIView::initWithFrame(
            UIView::alloc(mtm),
            CGRect::new(CGPoint::new(MARGIN, y), CGSize::new(inner, height)),
        );
        group.setBackgroundColor(Some(&UIColor::secondarySystemGroupedBackgroundColor()));
        rounded(&group, 24.0);
        for (index, row) in rows.iter().enumerate() {
            let top = ROW * index as CGFloat;
            if index > 0 {
                let line = UIView::initWithFrame(
                    UIView::alloc(mtm),
                    CGRect::new(
                        CGPoint::new(TEXT_INSET, top),
                        CGSize::new(inner - TEXT_INSET, 1.0 / 3.0),
                    ),
                );
                line.setBackgroundColor(Some(&UIColor::separatorColor()));
                group.addSubview(&line);
            }
            let configuration = UIButtonConfiguration::plainButtonConfiguration(mtm);
            configuration.setTitle(Some(&NSString::from_str(&row.label)));
            let image = row
                .symbol
                .as_deref()
                .and_then(|name| UIImage::systemImageNamed(&NSString::from_str(name)))
                .map(|image| {
                    image
                        .imageByApplyingSymbolConfiguration(&symbol_size)
                        .unwrap_or(image)
                });
            // The icon sits centred in a slot of its own, so every row's words start at one line
            // whatever the symbol's width.
            configuration.setContentInsets(NSDirectionalEdgeInsets {
                top: 0.0,
                leading: TEXT_INSET,
                bottom: 0.0,
                trailing: 44.0,
            });
            let ink = if row.destructive {
                UIColor::systemRedColor()
            } else {
                UIColor::labelColor()
            };
            configuration.setBaseForegroundColor(Some(&ink));
            let island = spec.clone();
            let key = row.key.clone();
            let closing = sheet.clone();
            let handler = RcBlock::new(move |_: NonNull<UIAction>| {
                if let Some(sheet) = closing.load() {
                    sheet.dismissViewControllerAnimated_completion(true, None);
                }
                islands::change(&island, &key);
            });
            let action = unsafe { UIAction::actionWithHandler(RcBlock::as_ptr(&handler), mtm) };
            let button =
                UIButton::buttonWithConfiguration_primaryAction(&configuration, Some(&action));
            button.setContentHorizontalAlignment(UIControlContentHorizontalAlignment::Leading);
            button.setFrame(CGRect::new(CGPoint::new(0.0, top), CGSize::new(inner, ROW)));
            button.setEnabled(!row.disabled);
            group.addSubview(&button);
            if let Some(image) = image {
                let icon = UIImageView::initWithImage(UIImageView::alloc(mtm), Some(&image));
                unsafe { icon.setTintColor(Some(&ink)) };
                icon.setContentMode(UIViewContentMode::Center);
                icon.setFrame(CGRect::new(
                    CGPoint::new(ICON_SLOT.0, top),
                    CGSize::new(ICON_SLOT.1, ROW),
                ));
                icon.setUserInteractionEnabled(false);
                icon.setAlpha(if row.disabled { 0.4 } else { 1.0 });
                group.addSubview(&icon);
            }
            if row.checked {
                let check = UIImage::systemImageNamed(ns_check()).map(|image| {
                    let view = UIImageView::initWithImage(UIImageView::alloc(mtm), Some(&image));
                    unsafe { view.setTintColor(Some(&brand)) };
                    view
                });
                if let Some(check) = check {
                    let size = check.frame().size;
                    check.setFrame(CGRect::new(
                        CGPoint::new(inner - 18.0 - size.width, top + (ROW - size.height) / 2.0),
                        size,
                    ));
                    group.addSubview(&check);
                }
            }
        }
        view.addSubview(&group);
        y += height + GAP;
    }

    // As tall as what it holds, over the home indicator.
    let content = y - GAP + 24.0;
    if let Some(sheet) = controller.sheetPresentationController() {
        let fits = RcBlock::new(
            move |_: NonNull<
                ProtocolObject<dyn UISheetPresentationControllerDetentResolutionContext>,
            >| { content },
        );
        let detent = UISheetPresentationControllerDetent::customDetentWithIdentifier_resolver(
            None, &fits, mtm,
        );
        sheet.setDetents(&NSArray::from_retained_slice(&[detent]));
        sheet.setPrefersGrabberVisible(true);
    }
    controller.setOverrideUserInterfaceStyle(if dark {
        UIUserInterfaceStyle::Dark
    } else {
        UIUserInterfaceStyle::Light
    });
    presenter.presentViewController_animated_completion(&controller, true, None);
}

fn ns_check() -> &'static NSString {
    objc2_foundation::ns_string!("checkmark")
}
