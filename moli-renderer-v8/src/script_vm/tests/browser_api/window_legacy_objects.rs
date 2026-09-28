use super::*;

#[test]
fn legacy_window_objects_preserve_association_brand_and_replaceability() {
    let mut vm = new_parsed_test_vm(
        "https://legacy-window.test/",
        "<!doctype html><body></body>",
    );
    let result = vm
        .eval(include_str!("window_legacy_objects.js"))
        .expect("legacy Window objects should preserve native identity and Web IDL semantics");
    assert_eq!(result, "true");
}

#[test]
fn lightweight_popup_legacy_objects_belong_to_the_popup_window() {
    let mut vm = new_storage_test_vm("https://legacy-popup.test/");
    let result = vm
        .eval(
            r#"
(() => {
  const popup = open('about:blank');
  try {
    const navigator = popup.navigator;
    const external = popup.external;
    const aliasGetter = Object.getOwnPropertyDescriptor(window, 'clientInformation').get;
    const externalGetter = Object.getOwnPropertyDescriptor(window, 'external').get;
    if (popup.clientInformation !== navigator || navigator === window.navigator ||
        aliasGetter.call(popup) !== navigator) throw new Error('popup Navigator association');
    if (!(external instanceof popup.External) || external === window.external ||
        popup.external !== external || externalGetter.call(popup) !== external) {
      throw new Error('popup External association');
    }
    if (external.AddSearchProvider() !== undefined ||
        external.IsSearchProviderInstalled() !== undefined) throw new Error('External methods');
    popup.navigator = 'shadow';
    if (popup.clientInformation !== navigator) throw new Error('public navigator shadow');
    popup.clientInformation = 42;
    popup.external = 17;
    if (popup.clientInformation !== 42 || popup.external !== 17 ||
        aliasGetter.call(popup) !== navigator || externalGetter.call(popup) !== external) {
      throw new Error('popup Replaceable properties');
    }
    return true;
  } finally { popup.close(); }
})()
"#,
        )
        .expect("popup legacy objects should use popup associations");
    assert_eq!(result, "true");
}
