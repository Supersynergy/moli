use super::*;

#[test]
fn webgl_interfaces_preserve_native_inheritance_values_and_event_state() {
    for url in [
        "https://webgl-interfaces.test/",
        "http://webgl-interfaces.test/",
    ] {
        let mut vm = new_storage_page_task_executor_test_vm(url);
        vm.eval("document.body.innerHTML = '<iframe id=child></iframe>'")
            .unwrap();
        vm.eval(&format!(
            "({}).then(value => globalThis.__webGlInterfacesDone = value, error => globalThis.__webGlInterfacesDone = String(error));",
            include_str!("webgl_interfaces.js")
        )).unwrap();
        assert_eq!(
            vm.eval_after_selected_page_tasks("JSON.stringify(__nodeReplacementResults.failures)")
                .unwrap(),
            "[]",
            "{url}"
        );
        assert_eq!(vm.eval("__webGlInterfacesDone").unwrap(), "true", "{url}");
    }
}
