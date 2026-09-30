use super::*;

#[test]
fn observer_element_arguments_use_native_interface_identity() {
    let mut vm = new_parsed_test_vm(
        "https://observer-element-arguments.test/",
        "<!doctype html><body></body>",
    );
    let result = vm
        .eval(include_str!(
            "../../../tests/fixtures/observer-element-arguments.js"
        ))
        .unwrap();
    assert_eq!(result, r#"{"total":204,"failures":[]}"#);
    vm.with_default_context_scope_and_checkpoint_for_test(|scope, _host_ptr| {
        let global = scope.get_current_context().global(scope);
        let key = v8::String::new(scope, "__observerNativeElement").unwrap();
        let value = global.get(scope, key.into()).unwrap();
        assert!(
            value.is_proxy(),
            "fixture must cover a registered native Proxy"
        );
        let object = v8::Local::<v8::Object>::try_from(value).unwrap();
        assert!(crate::web_api_interfaces::Element::is_instance(
            scope, object
        ));
        Ok(())
    })
    .unwrap();
}
