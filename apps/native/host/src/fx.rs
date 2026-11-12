//! Shader effects (rune-fx) on elements the web app marks with `data-fx="<preset>"`.
//!
//! The web build ignores the attribute. Here a preset becomes a Rune effect slot pinned over the
//! element's box as its first child (over its own fill, under its content); the compositor turns
//! every slot into a rune-fx layer at the slot's presented rect and radius and draws it in the
//! painter stream. One preset so far: `glass`, the command palette's frosted panel.
//!
//! A slot's data carries `[0, effect kind, 0, 0]`: this host leaves `Runtime::marks` empty.

use std::collections::HashMap;

use rune::compose::{Compositor, DeviceKey, Frame};
use rune::render::{EffectPhase, EffectSite, KIND_EFFECT, Renderer};
use rune::{El, Runtime};
use rune_fx::*;

use crate::State;
use crate::wire::Style;

const GLASS: u32 = 1;

fn is_glass(attrs: &HashMap<String, String>) -> bool {
    attrs
        .get("data-fx")
        .is_some_and(|v| v.split_whitespace().any(|p| p == "glass"))
}

/// The element with its effect slot as its first child. Call before adding children.
pub fn under(e: El, attrs: &HashMap<String, String>, st: &Style, path: &str) -> El {
    if !is_glass(attrs) {
        return e;
    }
    let radius = st
        .radius
        .map_or(0.0, |r| r.iter().fold(0.0f32, |a, v| a.max(v.0)));
    e.child(
        rune::effect(GLASS)
            .key(format!("{path}/fx"))
            .pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
            .radius(radius)
            .effect_backdrop(true)
            .effect_data([0.0, GLASS as f32, 0.0, 0.0]),
    )
}

/// Glass shows what is under it: the panel's own fill drops to a tint.
pub fn glass_fill(e: El, attrs: &HashMap<String, String>, st: &Style) -> El {
    match crate::layout::color(&st.bg) {
        Some(bg) if is_glass(attrs) => e.fill(bg.alpha(0.6)),
        _ => e,
    }
}

fn layer(kind: u32, [x, y, w, h]: [f32; 4], r: f32, t: f32) -> Option<FxLayer> {
    let fx = match kind {
        GLASS => Fx::lens(LensParams {
            frost: 0.85,
            bevel: 8.0,
            depth: 8.0,
            dispersion: 0.03,
            magnification: 1.0,
            shadow: 0.3,
            rim: 0.5,
            tint: rgb(0x0e0e12),
            tint_amount: 0.35,
            ..Default::default()
        }),
        _ => return None,
    };
    Some(fx.on(Shape::rounded(x, y, w, h, r)).at(t))
}

#[derive(Default)]
pub struct Effects {
    fx: Option<(DeviceKey, FxRenderer)>,
}

impl Effects {
    /// Draws the frame's UI with every effect slot painted in place. Shared by the window's
    /// compositor and the headless capture.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        size: (u32, u32),
        rt: &mut Runtime<State>,
        ui: &mut Renderer,
    ) {
        let t = rt.t as f32;
        let mut at: Vec<u32> = Vec::new();
        let mut layers: Vec<FxLayer> = Vec::new();
        let mut placements: Vec<FxSlot> = Vec::new();
        for (n, i) in rt.instances.iter().enumerate() {
            if i.params[1] != KIND_EFFECT {
                continue;
            }
            let k = i.params[3];
            let r = i.radii.iter().fold(0.0f32, |a, v| a.max(v.abs())) / k;
            let Some(l) = layer(i.uv[1] as u32, i.rect.map(|v| v / k), r, t) else {
                continue;
            };
            at.push(n as u32);
            layers.push(l);
            placements.push(FxSlot::default().scale(k).clip(i.clip, i.fade));
        }
        let clear = rt.clear_color();
        ui.prepare(device, queue, &mut rt.text.atlas, &rt.instances, size);
        // No effect on screen: the plain frame, and no effect renderer made.
        if layers.is_empty() {
            ui.draw(encoder, target, clear);
            return;
        }
        let key = ui.device_key();
        if self.fx.as_ref().is_none_or(|(k, _)| *k != key) {
            self.fx = Some((
                key,
                FxRenderer::new(device, format, FxOptions { dither: true }),
            ));
        }
        let (_, fx) = self.fx.as_mut().expect("made above");
        fx.set_srgb_blend(ui.srgb_blend());
        fx.add_format(device, wgpu::TextureFormat::Rgba16Float);
        fx.prepare_with_slots(
            device,
            queue,
            &FxFrame {
                viewport: [size.0, size.1],
                scale: 1.0,
                layers: &layers,
                backdrop: None,
                sources: &[],
            },
            &placements,
        );
        ui.draw_with_backdrop(encoder, target, clear, &mut |phase, s: &EffectSite<'_>| {
            let Some(k) = at.iter().position(|n| *n == s.index) else {
                return;
            };
            match phase {
                EffectPhase::Backdrop(enc) => {
                    if let Some(bd) = s.backdrop {
                        fx.blur_backdrop(device, queue, enc, bd, k);
                    }
                }
                EffectPhase::Draw(pass) => fx.draw_layer_in(pass, s.format, s.origin, k),
            }
        });
    }
}

impl Compositor<State> for Effects {
    fn render(&mut self, f: &mut Frame<'_, State>) {
        let (device, queue, size, format) = (f.device, f.queue, f.size, f.format);
        self.draw(device, queue, f.encoder, f.target, format, size, f.rt, f.ui);
    }
}
