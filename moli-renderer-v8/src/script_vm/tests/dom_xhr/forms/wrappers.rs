use super::*;

#[test]
fn form_wrappers_preserve_own_properties_and_identity_across_adoption() {
    let mut vm = new_parsed_test_vm(
        "https://form-wrapper-adoption.test/",
        "<!doctype html><body></body>",
    );
    assert_eq!(vm.eval(r#"(() => {
      const detached = document.implementation.createHTMLDocument('forms');
      const parsed = new DOMParser().parseFromString('<form></form>', 'text/html');
      const frame = document.body.appendChild(document.createElement('iframe'));
      const child = frame.contentDocument;
      const forms = [document.createElement('form'), detached.createElement('form'),
        parsed.querySelector('form'), child.createElement('form')];
      const keys = ['name', 'elements', 'length', 'submit', 'reset', 'nodeType', 'nodeName', 'ownerDocument', 'matches'];
      for (const [mode, form] of forms.entries()) {
        const doc = form.ownerDocument;
        const values = keys.map(() => ({}));
        for (const [i, key] of keys.entries()) {
          if (Object.hasOwn(form, key)) throw Error(mode + ': native own ' + key);
          Object.defineProperty(form, key, {value: values[i], writable: true, configurable: true, enumerable: true});
          const control = form.appendChild(doc.createElement('input'));
          control.name = key;
        }
        const first = form[0];
        for (const target of [detached, child, document, parsed]) {
          if (target.adoptNode(form) !== form) throw Error('adopt replaced form');
          target.body.appendChild(form);
          if (form[0] !== first || Object.getOwnPropertyDescriptor(form, '0').value !== first) throw Error('control identity');
          for (const [i, key] of keys.entries()) {
            const d = Object.getOwnPropertyDescriptor(form, key);
            if (!d || d.value !== values[i] || !d.writable || !d.enumerable || !d.configurable || form[key] !== values[i])
              throw Error(mode + ': adoption changed own ' + key);
          }
        }
        for (const [i, key] of keys.entries()) {
          if (!delete form[key] || form[key] !== form[i]) throw Error('own deletion must reveal control: ' + key);
        }
      }
      return 'ok';
    })()"#).unwrap(), "ok");
}

#[test]
fn form_wrappers_return_collections_in_receiver_realm_for_borrowed_accessors() {
    let mut vm = new_parsed_test_vm(
        "https://form-wrapper-realms.test/",
        "<!doctype html><body></body>",
    );
    assert_eq!(vm.eval(r#"(() => {
      const frame = document.body.appendChild(document.createElement('iframe'));
      const realm = frame.contentWindow;
      const detached = realm.document.implementation.createHTMLDocument('forms');
      const source = detached.createElement('form');
      const markup = '<input name="group"><input name="group"><img name="photos"><img name="photos">';
      source.innerHTML = markup;
      const forms = [source, source.cloneNode(true), realm.document.importNode(source, true),
        realm.document.createElement('form')];
      const parentElements = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements').get;
      for (const [mode, form] of forms.entries()) {
        if (!form.firstChild) form.innerHTML = markup;
        const inputs = form.querySelectorAll('input');
        const photos = form.querySelectorAll('img');
        const elements = parentElements.call(form);
        if (elements !== form.elements || !(elements instanceof realm.HTMLFormControlsCollection) || elements[0] !== inputs[0])
          throw Error('borrowed elements accessor used caller realm');
        for (const [key, items] of [['group', inputs], ['photos', photos]]) {
          const list = form[key];
          const described = Object.getOwnPropertyDescriptor(form, key).value;
          if (list !== described || !(list instanceof realm.RadioNodeList) || list.length !== 2 || list[0] !== items[0])
            throw Error(mode + ':' + key + ': named result identity/realm ' + [list === described, list instanceof realm.RadioNodeList, list.length, list[0] === items[0]].join(','));
        }
        document.body.appendChild(document.adoptNode(form));
        if (parentElements.call(form) !== elements || form[0] !== inputs[0]) throw Error('adoption changed wrapper cache');
        inputs[1].remove();
        if (form.group !== inputs[0] || Object.getOwnPropertyDescriptor(form, 'group').value !== inputs[0]) throw Error('single identity');
      }
      return 'ok';
    })()"#).unwrap(), "ok");
}

#[test]
fn form_wrappers_share_reset_events_and_keep_inert_submissions_inert() {
    let mut vm = new_parsed_test_vm(
        "https://form-wrapper-methods.test/",
        "<!doctype html><body></body>",
    );
    assert_eq!(vm.eval(r#"(() => {
      const frame = document.body.appendChild(document.createElement('iframe'));
      const child = frame.contentWindow;
      const docs = [document.implementation.createHTMLDocument('forms'),
        new DOMParser().parseFromString('<body></body>', 'text/html'),
        child.document.implementation.createHTMLDocument('forms')];
      for (const [mode, doc] of docs.entries()) {
        const form = doc.body.appendChild(doc.createElement('form'));
        form.innerHTML = '<input name="field" value="initial">';
        const input = form.field;
        let resets = 0;
        form.addEventListener('reset', event => {
          if (event.target !== form || event.currentTarget !== form || !event.bubbles || !event.cancelable ||
              event.constructor.constructor !== form.constructor.constructor) throw Error(mode + ': reset identity/realm');
          if (++resets === 1) event.preventDefault();
        });
        input.value = 'edited';
        HTMLFormElement.prototype.reset.call(form);
        if (input.value !== 'edited' || resets !== 1) throw Error('reset cancellation');
        child.HTMLFormElement.prototype.reset.call(form);
        if (input.value !== 'initial' || resets !== 2) throw Error('shared reset default action');
        form.action = '/should-not-navigate';
        for (const method of ['get', 'post']) {
          form.method = method;
          HTMLFormElement.prototype.submit.call(form);
        }
      }
      return 'ok';
    })()"#).unwrap(), "ok");
    assert!(vm.take_pending_location_navigation_with_seed().is_none());
}
