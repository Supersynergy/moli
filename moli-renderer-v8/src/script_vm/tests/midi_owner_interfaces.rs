use super::*;

#[test]
fn midi_owner_interfaces_preserve_native_inheritance_and_realm_contracts() {
    for url in [
        "https://midi-owner-interfaces.test/",
        "http://midi-owner-interfaces.test/",
        "http://localhost/",
    ] {
        let mut vm = new_storage_page_task_executor_test_vm(url);
        vm.eval("document.body.innerHTML = '<iframe id=child></iframe>'")
            .unwrap();
        assert_eq!(vm.eval(r#"(() => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const popup = open();
  assert(popup, 'popup test prerequisite');
  try {
    const realms = [window, document.getElementById('child').contentWindow, popup];
    for (const w of realms) {
      for (const [name, parentName] of [["MIDIPort","EventTarget"],["MIDIAccess","EventTarget"],["MIDIInput","MIDIPort"],["MIDIOutput","MIDIPort"],["MIDIInputMap","Object"],["MIDIOutputMap","Object"]]) {
        if (true && !w.isSecureContext) {
          assert(!(name in w), name + ' hidden in an insecure realm');
          continue;
        }
        const C = w[name], parent = w[parentName];
        assert(typeof C === 'function' && C.name === name && C.length === 0, name + ' interface object');
        const descriptor = Object.getOwnPropertyDescriptor(w, name);
        assert(descriptor.writable && descriptor.configurable && !descriptor.enumerable, name + ' global descriptor');
        assert(Object.getPrototypeOf(C.prototype) === parent.prototype, name + ' prototype inheritance');
        assert(Object.getPrototypeOf(C) === (parentName === 'Object' ? w.Function.prototype : parent), name + ' interface inheritance');
        assert(C.prototype.constructor === C, name + ' prototype constructor');
        const tag = Object.getOwnPropertyDescriptor(C.prototype, Symbol.toStringTag);
        assert(tag.value === name && !tag.writable && !tag.enumerable && tag.configurable, name + ' tag');
        for (const call of [() => C(), () => new C()]) {
          let error;
          try { call(); } catch (caught) { error = caught; }
          assert(error instanceof w.TypeError, name + ' rejects direct construction in the callee realm');
          if (w !== window) assert(!(error instanceof TypeError), name + ' foreign error realm');
        }
      }
    }
    return true;
  } finally { popup.close(); }
})()"#).unwrap(), "true", "{url}");
    }
}
