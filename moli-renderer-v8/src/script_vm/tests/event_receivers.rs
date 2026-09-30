use super::*;

#[test]
fn event_bindings_validate_native_receivers_before_conversion_in_the_callee_realm() {
    let mut vm = new_parsed_test_vm(
        "https://event-receivers.test/",
        "<!doctype html><body><iframe id=child></iframe></body>",
    );
    vm.eval(include_str!("event_receivers.js")).unwrap();
    assert_eq!(
        vm.eval("JSON.stringify(globalThis.__eventReceiverFailures)")
            .unwrap(),
        "[]"
    );
}
