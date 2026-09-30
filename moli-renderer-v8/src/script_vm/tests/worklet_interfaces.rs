use super::*;

#[test]
fn worklet_interfaces_preserve_realms_brands_and_secure_exposure() {
    for url in [
        "https://worklet-interfaces.test/",
        "http://worklet-interfaces.test/",
    ] {
        let mut vm = new_storage_page_task_executor_test_vm(url);
        vm.eval("document.body.innerHTML = '<iframe id=child></iframe>'")
            .unwrap();
        vm.eval(&format!("({}).then(value => globalThis.__workletDone = value, error => globalThis.__workletDone = String(error));", include_str!("worklet_interfaces.js"))).unwrap();
        assert_eq!(
            vm.eval_after_selected_page_tasks("JSON.stringify(__nodeReplacementResults.failures)")
                .unwrap(),
            "[]",
            "{url}"
        );
        assert_eq!(vm.eval("__workletDone").unwrap(), "true", "{url}");
    }
}
