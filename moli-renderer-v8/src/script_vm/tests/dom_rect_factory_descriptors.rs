use super::*;

#[test]
fn dom_rect_static_factories_use_webidl_descriptors_and_dictionary_order() {
    let mut vm = new_storage_test_vm("https://rect-factory.test/");
    assert_eq!(vm.eval(r#"
(() => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  if (!document.documentElement) document.appendChild(document.createElement('html'));
  if (!document.body) document.documentElement.appendChild(document.createElement('body'));
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  for (const realm of [window, iframe.contentWindow]) {
    for (const name of ['DOMRect', 'DOMRectReadOnly']) {
      const Constructor = realm[name];
      const descriptor = Object.getOwnPropertyDescriptor(Constructor, 'fromRect');
      check(descriptor.enumerable && descriptor.writable && descriptor.configurable, name + ' descriptor');
      check(descriptor.value.name === 'fromRect' && descriptor.value.length === 0, name + ' method signature');
      check(Object.keys(Constructor).includes('fromRect'), name + ' own enumerable factory');
      const order = [];
      const value = descriptor.value.call(null, {
        get y() { order.push('y'); return NaN; },
        get x() { order.push('x'); return -0; },
        get width() { order.push('width'); return -3; },
        get height() {
          order.push('height');
          return { valueOf() { order.push('height:valueOf'); return -4; } };
        }
      });
      check(order.join(',') === 'height,height:valueOf,width,x,y', name + ' dictionary conversion');
      check(Object.getPrototypeOf(value) === Constructor.prototype, name + ' factory realm');
      check(Object.is(value.x, -0) && Number.isNaN(value.y) && value.width === -3 && value.height === -4, name + ' values');
      const reads = [];
      const sentinel = {};
      let error;
      try {
        descriptor.value.call(null, {
          get y() { reads.push('y'); return 0; },
          get x() { reads.push('x'); return 0; },
          get width() { reads.push('width'); return 0; },
          get height() { reads.push('height'); throw sentinel; }
        });
      } catch (caught) { error = caught; }
      check(error === sentinel && reads.join(',') === 'height', name + ' getter failure stops conversion');
    }
  }
  return 'passed';
})()
"#).unwrap(), "passed");
}
