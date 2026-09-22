use super::*;
use crate::runtime::{RendererElementClickError, RendererElementClickTarget};

#[test]
fn native_element_click_initializes_layout_once() {
    let mut vm = new_parsed_test_vm(
        "https://click-native-geometry.test/",
        "<!doctype html><button id=target style='position:absolute;left:40px;top:40px;width:120px;height:70px'>go</button>",
    );
    let target = vm.document_runtime.get_element_by_id("target").unwrap();
    let before = vm.layout_pass_observability_for_test().1;
    for _ in 0..2 {
        assert!(matches!(
            vm.prepare_element_click(target).unwrap(),
            RendererElementClickTarget::Pointer(_)
        ));
        assert_eq!(vm.layout_pass_observability_for_test().1, before + 1);
    }
}

#[test]
fn native_element_click_uses_current_layout_after_dom_and_style_changes() {
    let mut vm = new_parsed_test_vm(
        "https://click-current-layout.test/",
        r#"<!doctype html><html><head></head><body>
        <button id='target' style='position:absolute;left:40px;top:40px;width:120px;height:70px'>go</button>
        </body></html>"#,
    );
    vm.eval("window.clicks=0;document.getElementById('target').onclick=()=>clicks++")
        .expect("install click listener");
    let target = vm.document_runtime.get_element_by_id("target").unwrap();
    let RendererElementClickTarget::Pointer(first) = vm.prepare_element_click(target).unwrap()
    else {
        panic!("real layout must prepare pointer input");
    };

    vm.eval("document.getElementById('target').style.left='300px'")
        .expect("move target after initial layout");
    let RendererElementClickTarget::Pointer(moved) = vm.prepare_element_click(target).unwrap()
    else {
        panic!("moved target should remain clickable");
    };
    assert!(
        moved.root_x > first.root_x,
        "click must use the new position"
    );
    vm.dispatch_prepared_element_click(moved).unwrap();
    assert_eq!(vm.eval("String(clicks)").unwrap(), "1");

    vm.eval("const veil=document.createElement('div');veil.id='veil';veil.style.cssText='position:fixed;inset:0;z-index:999';document.body.appendChild(veil)")
        .expect("add overlay after a successful click");
    assert!(
        matches!(
            vm.prepare_element_click(target),
            Err(RendererElementClickError::Obscured)
        ),
        "an overlay introduced after layout must block click preparation"
    );
    assert_eq!(vm.eval("String(clicks)").unwrap(), "1");

    vm.eval("document.getElementById('veil').remove();const style=document.createElement('style');document.head.appendChild(style);style.sheet.insertRule('button {pointer-events:none}')")
        .expect("disable pointer events through a new stylesheet");
    assert!(
        matches!(
            vm.prepare_element_click(target),
            Err(RendererElementClickError::Obscured)
        ),
        "a live stylesheet must make the target unclickable"
    );
    assert_eq!(vm.eval("String(clicks)").unwrap(), "1");
}

#[test]
fn native_element_click_mock_preparation_does_not_build_layout() {
    let mut vm = new_parsed_test_vm(
        "https://click-mock.test/",
        "<!doctype html><html><body><button id=target>go</button></body></html>",
    );
    vm.set_layout_policy(moli_page_types::LayoutPolicy::Mock);
    let target = vm.document_runtime.get_element_by_id("target").unwrap();
    let before = vm.layout_pass_observability_for_test().1;
    assert_eq!(
        vm.prepare_element_click(target).unwrap(),
        RendererElementClickTarget::DomActivation
    );
    assert_eq!(vm.layout_pass_observability_for_test().1, before);
}

#[test]
fn native_element_click_does_not_publish_after_scrolling_an_offscreen_target() {
    let mut vm = new_rendered_test_vm(
        "https://click-offscreen.test/",
        "<!doctype html><button id=target style='position:absolute;top:3000px'>go</button>",
    );
    let target = vm.document_runtime.get_element_by_id("target").unwrap();
    let before = vm.layout_pass_observability_for_test().1;
    assert!(matches!(
        vm.prepare_element_click(target),
        Err(crate::runtime::RendererElementClickError::NoClickableRect)
    ));
    assert_eq!(vm.layout_pass_observability_for_test().1, before);
    publish_layout_for_test(&mut vm);
    assert!(matches!(
        vm.prepare_element_click(target).unwrap(),
        RendererElementClickTarget::Pointer(_)
    ));
    assert_eq!(vm.layout_pass_observability_for_test().1, before + 1);
}
