use super::*;

#[test]
fn event_constructors_preserve_dom_string_code_units_and_conversion_order() {
    let mut vm = new_parsed_test_vm(
        "https://event-constructor-type.test/",
        "<!doctype html><iframe id=child></iframe>",
    );
    let result = vm
        .eval(include_str!("event_constructor_type.js"))
        .expect("event constructors should preserve DOMString code units and conversion errors");
    assert_eq!(result, "true");
}
