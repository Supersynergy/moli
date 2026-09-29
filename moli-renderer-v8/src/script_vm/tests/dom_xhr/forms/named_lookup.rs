use super::*;

#[test]
fn form_named_lookup_checks_only_index_candidates_and_existence_stops_early() {
    use crate::native_bridge::element::take_form_lookup_work_for_test;
    let mut vm = new_parsed_test_vm(
        "https://form-index-work.test/",
        "<!doctype html><body></body>",
    );
    vm.exec(
        r#"
        globalThis.indexForm = document.body.appendChild(document.createElement('form'));
        globalThis.firstIndexed = indexForm.appendChild(document.createElement('input'));
        firstIndexed.id = firstIndexed.name = 'indexedGroup';
        for (let i = 0; i < 63; ++i) {
          indexForm.appendChild(document.createElement('input')).name = 'indexedGroup';
        }
        globalThis.otherForm = document.body.appendChild(document.createElement('form'));
        otherForm.appendChild(document.createElement('input')).name = 'otherOnly';
        for (let i = 0; i < 512; ++i) {
          const div = document.body.appendChild(document.createElement('div'));
          div.innerHTML = '<span></span><input name="unrelated">';
        }
        indexForm.absentPrimeKey;
    "#,
        None,
    )
    .unwrap();
    take_form_lookup_work_for_test();
    assert_eq!(vm.eval("'indexedGroup' in indexForm").unwrap(), "true");
    let work = take_form_lookup_work_for_test();
    assert_eq!(work.inspected_nodes, 1);
    assert_eq!((work.traversals, work.enumerations), (0, 0));
    assert_eq!(
        vm.eval("indexForm.otherOnly === undefined").unwrap(),
        "true"
    );
    let work = take_form_lookup_work_for_test();
    assert_eq!(work.inspected_nodes, 1);
    assert_eq!((work.traversals, work.enumerations), (0, 0));
    assert_eq!(
        vm.eval("globalThis.indexedList = indexForm.indexedGroup; true")
            .unwrap(),
        "true"
    );
    let work = take_form_lookup_work_for_test();
    assert_eq!(
        work.inspected_nodes, 64,
        "id/name duplicates must be inspected once"
    );
    assert_eq!((work.traversals, work.enumerations), (0, 0));
    assert_eq!(vm.eval("indexedList.length").unwrap(), "64");
    let work = take_form_lookup_work_for_test();
    assert_eq!(
        work.inspected_nodes, 64,
        "live list evaluation must also use candidates"
    );
    assert_eq!(work.traversals, 0);
}

#[test]
fn form_named_lookup_existence_does_not_remember_past_names() {
    let mut vm = new_parsed_test_vm(
        "https://form-index-existence.test/",
        "<!doctype html><body></body>",
    );
    assert_eq!(vm.eval(r#"(() => {
      const form = document.body.appendChild(document.createElement('form'));
      for (const tag of ['input', 'img']) {
        const item = form.appendChild(document.createElement(tag));
        item.name = 'existenceOnly';
        if (!('existenceOnly' in form)) throw Error('missing supported name');
        item.name = 'renamed';
        if ('existenceOnly' in form || form.existenceOnly !== undefined) throw Error('query remembered past name');
        item.remove();
      }
      return 'ok';
    })()"#).unwrap(), "ok");
}

#[test]
fn form_named_lookup_index_survives_parsing_import_and_control_type_changes() {
    let mut vm = new_parsed_test_vm(
        "https://form-index-import.test/",
        "<!doctype html><body></body>",
    );
    assert_eq!(vm.eval(r#"(() => {
      const empty = document.body.appendChild(document.createElement('form'));
      empty.primeIndexes;
      const parsed = new DOMParser().parseFromString('<form><input name="shared"><input id="shared" name="shared"><img name="shared"><img name="shared"></form>', 'text/html');
      const original = parsed.querySelector('form');
      const imported = document.importNode(original, true);
      for (const [mode, form] of [original, imported].entries()) {
        const inputs = form.querySelectorAll('input');
        const list = form.shared;
        if (!list) throw Error(mode + ': missing list: ' + form.outerHTML + '; elements=' + form.elements.length);
        if (list.length !== 2 || list[0] !== inputs[0] || list[1] !== inputs[1]) throw Error('parsed/imported candidates');
        form.insertBefore(inputs[1], inputs[0]);
        if (list[0] !== inputs[1]) throw Error('candidate insertion order leaked');
        inputs[1].type = 'image';
        if (list.length !== 1 || form.shared !== inputs[0]) throw Error('type eligibility');
        inputs[0].type = 'image';
        if (list.length !== 0 || form.shared.length !== 2 || form.shared[0].tagName !== 'IMG') throw Error('image fallback');
        document.body.appendChild(document.adoptNode(form));
        inputs[1].type = 'text';
        if (list.length !== 1 || list[0] !== inputs[1] || form.shared !== inputs[1]) throw Error('adoption and type restoration');
      }
      return 'ok';
    })()"#).unwrap(), "ok");
}

#[test]
fn form_named_lookup_orders_shadow_reference_controls_and_filters_fieldset_scope() {
    let mut vm = new_parsed_test_vm(
        "https://form-index-shadow.test/",
        "<!doctype html><body></body>",
    );
    assert_eq!(vm.eval(r#"(() => {
      const host = document.body.appendChild(document.createElement('div'));
      host.id = 'formHost';
      const root = host.attachShadow({mode: 'open', referenceTarget: 'form'});
      root.innerHTML = '<form id="form"><input name="shared"><input name="shared"></form>';
      const form = root.querySelector('form');
      const inside = form.querySelectorAll('input');
      const external = host.appendChild(document.createElement('input'));
      external.setAttribute('form', 'formHost');
      external.name = 'shared';
      const before = document.body.insertBefore(document.createElement('input'), host);
      before.setAttribute('form', 'formHost');
      before.name = 'shared';
      const list = form.shared;
      function check(expected) {
        if (list.length !== expected.length || expected.some((item, i) => list[i] !== item)) throw Error('shadow-including order');
      }
      check([before, inside[0], inside[1], external]);
      document.body.appendChild(before);
      check([inside[0], inside[1], external, before]);
      host.remove();
      check([inside[0], inside[1]]);
      const fieldset = document.body.appendChild(document.createElement('fieldset'));
      fieldset.innerHTML = '<input name="shared"><form><input name="shared"></form>';
      const fieldsetInputs = fieldset.querySelectorAll('input');
      const fieldsetList = fieldset.elements;
      if (fieldsetList.length !== 2 || fieldsetList[1] !== fieldsetInputs[1] || fieldsetList.namedItem('shared') !== fieldsetInputs[0]) throw Error('fieldset candidate scope');
      return 'ok';
    })()"#).unwrap(), "ok");
}

#[test]
fn form_named_lookup_own_properties_take_precedence_over_controls_and_prototypes() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-own-properties.test/",
        "<!doctype html><html><body><form id='parsed'></form></body></html>",
    );
    let result = vm.eval(r#"
      (() => {
        const detachedDocument = document.implementation.createHTMLDocument('forms');
        const adopted = detachedDocument.createElement('form');
        document.body.appendChild(document.adoptNode(adopted));
        const childDocument = document.body.appendChild(document.createElement('iframe')).contentDocument;
        const forms = [
          document.getElementById('parsed'),
          document.createElement('form'),
          detachedDocument.body.appendChild(detachedDocument.createElement('form')),
          adopted,
          childDocument.body.appendChild(childDocument.createElement('form'))
        ];
        const names = [
          'addEventListener', 'removeEventListener', 'dispatchEvent',
          'nodeType', 'nodeName', 'ownerDocument', 'namespaceURI', 'prefix', 'localName',
          'title', 'lang', 'dir', 'acceptCharset', 'action', 'autocomplete', 'enctype',
          'encoding', 'method', 'name', 'noValidate', 'target', 'elements', 'length',
          'submit', 'reset', 'requestSubmit', 'checkValidity', 'reportValidity', 'ordinaryKey'
        ];
        for (const [mode, form] of forms.entries()) {
          const doc = form.ownerDocument;
          for (const name of names) {
            const label = mode + ': ' + name;
            if (Object.hasOwn(form, name)) throw Error(label + ': native instance property');
            let reads = 0;
            const getter = () => { ++reads; return 'user-defined'; };
            Object.defineProperty(form, name, {get: getter, configurable: true, enumerable: true});
            const input = doc.createElement('input');
            input.name = name;
            form.appendChild(input);
            if (!(name in form) || reads !== 0) throw Error(label + ': query invoked accessor');
            const descriptor = Object.getOwnPropertyDescriptor(form, name);
            if (descriptor.get !== getter || !descriptor.enumerable || reads !== 0)
              throw Error(label + ': own descriptor');
            if (form[name] !== 'user-defined' || reads !== 1) throw Error(label + ': own accessor lost');
            if (!Reflect.deleteProperty(form, name) || reads !== 1) throw Error(label + ': own deletion');
            if (form[name] !== input) throw Error(label + ': named control must override prototype');
            if (Reflect.deleteProperty(form, name)) throw Error(label + ': named deletion');
            input.remove();
            if (Object.hasOwn(form, name)) throw Error(label + ': removed control still visible');

            Object.defineProperty(form, name, {value: 'own-data', configurable: true, writable: true});
            form.appendChild(input);
            if (form[name] !== 'own-data' || Object.getOwnPropertyDescriptor(form, name).value !== 'own-data')
              throw Error(label + ': own data lost');
            if (!Reflect.deleteProperty(form, name) || form[name] !== input)
              throw Error(label + ': data deletion must expose control');
            input.remove();
          }
        }
        return 'ok';
      })()
    "#).expect("real own properties must win regardless of their names or wrapper construction path");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_define_property_uses_supported_names_not_visibility() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-define-property.test/",
        "<!doctype html><html><body></body></html>",
    );
    let result = vm.eval(r#"
      (() => {
        for (const doc of [document, document.implementation.createHTMLDocument('forms')]) {
          const form = doc.body.appendChild(doc.createElement('form'));
          for (const name of ['submit', 'ordinaryKey']) {
            Object.defineProperty(form, name, {value: 'own', configurable: true, writable: true});
            const input = form.appendChild(doc.createElement('input'));
            input.name = name;
            if (Reflect.defineProperty(form, name, {value: 'replacement'}))
              throw Error(name + ': hidden supported name must reject definition');
            let threw = false;
            try { Object.defineProperty(form, name, {value: 'replacement'}); }
            catch (error) { threw = error instanceof TypeError; }
            if (!threw || form[name] !== 'own') throw Error(name + ': definition failure changed own property');
            if (!delete form[name] || form[name] !== input) throw Error(name + ': reveal named property');
            if (Reflect.defineProperty(form, name, {value: 'replacement'}))
              throw Error(name + ': visible supported name must reject definition');
            input.removeAttribute('name');
            if (Reflect.defineProperty(form, name, {value: 'replacement'}))
              throw Error(name + ': past name must reject definition');
            input.remove();
            if (!Reflect.defineProperty(form, name, {value: 'replacement', configurable: true}))
              throw Error(name + ': unsupported name must allow definition');
            if (!delete form[name]) throw Error(name + ': ordinary deletion');
          }
        }
        return 'ok';
      })()
    "#).expect("defineProperty must reject supported names even when an own property hides them");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_live_lists_preserve_their_control_or_image_source() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-image-lists.test/",
        "<!doctype html><html><body><form id='parsed'></form></body></html>",
    );
    let result = vm.eval(r#"
      (() => {
        const detachedDocument = document.implementation.createHTMLDocument('forms');
        const forms = [
          document.getElementById('parsed'),
          document.createElement('form'),
          detachedDocument.body.appendChild(detachedDocument.createElement('form'))
        ];
        for (const [mode, form] of forms.entries()) {
          const doc = form.ownerDocument;
          const first = form.appendChild(doc.createElement('img'));
          first.name = 'photos';
          first.id = 'photos';
          const second = form.appendChild(doc.createElement('img'));
          second.id = 'photos';
          const nested = form.appendChild(doc.createElement('form'));
          nested.appendChild(doc.createElement('img')).name = 'photos';
          const imageInput = form.appendChild(doc.createElement('input'));
          imageInput.type = 'image';
          imageInput.name = 'photos';
          const images = form.photos;
          const descriptor = Object.getOwnPropertyDescriptor(form, 'photos');
          const descriptorImages = descriptor.value;
          if (!(images instanceof RadioNodeList) || images.length !== 2 || images[0] !== first || images[1] !== second)
            throw Error(mode + ': image list membership');
          if (descriptor.writable || descriptor.enumerable || !descriptor.configurable || descriptorImages.length !== 2)
            throw Error(mode + ': image descriptor');
          if (form.elements.namedItem('photos') !== null) throw Error(mode + ': elements must exclude images');
          const control = form.appendChild(doc.createElement('input'));
          control.name = 'photos';
          if (form.photos !== control || images.length !== 2 || images[0] !== first)
            throw Error(mode + ': existing image list changed source');
          const otherControl = form.appendChild(doc.createElement('input'));
          otherControl.name = 'photos';
          const controls = form.photos;
          if (controls.length !== 2 || controls[0] !== control || controls[1] !== otherControl)
            throw Error(mode + ': control list membership');
          control.remove();
          otherControl.remove();
          if (controls.length !== 0 || form.photos.length !== 2) throw Error(mode + ': control list fell back to images');
          form.insertBefore(second, first);
          if (images[0] !== second || descriptorImages[0] !== second) throw Error(mode + ': image tree order');
          second.id = 'renamed';
          if (images.length !== 1 || images[0] !== first || descriptorImages.length !== 1 || form.photos !== first)
            throw Error(mode + ': live image rename');
          first.remove();
          if (images.length !== 0 || descriptorImages.length !== 0) throw Error(mode + ': live image removal');
          second.name = 'photos';
          if (images.length !== 1 || images[0] !== second) throw Error(mode + ': live image insertion');
          if (mode === 2) {
            document.body.appendChild(document.adoptNode(form));
            if (images.length !== 1 || images[0] !== second || form.photos !== second)
              throw Error('adoption changed image list identity');
          }
        }
        return 'ok';
      })()
    "#).expect("live RadioNodeLists must retain the source selected by the initial named lookup");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_misses_do_not_enumerate_or_traverse_controls() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-work.test/",
        "<!doctype html><html><body></body></html>",
    );
    vm.exec(
        r#"
      globalThis.lookupForms = [];
      for (let i = 0; i < 32; ++i) {
        const form = document.body.appendChild(document.createElement('form'));
        form.innerHTML = '<input name="present"><div><span>text</span></div>';
        lookupForms.push(form);
      }
      lookupForms[0].absentLookupKey;
    "#,
        None,
    )
    .expect("prepare named lookup workload");
    crate::native_bridge::element::take_form_lookup_work_for_test();
    let result = vm
        .eval(
            r#"
      (() => {
        for (const form of lookupForms) {
          for (let i = 0; i < 8; ++i) {
            if (form.absentLookupKey !== undefined) throw Error('getter');
            if ('absentLookupKey' in form) throw Error('query');
            if (Object.getOwnPropertyDescriptor(form, 'absentLookupKey') !== undefined)
              throw Error('descriptor');
          }
        }
        return 'ok';
      })()
    "#,
        )
        .expect("misses should preserve ordinary property semantics");
    assert_eq!(result, "ok");
    assert_eq!(
        crate::native_bridge::element::take_form_lookup_work_for_test(),
        Default::default()
    );

    // Positive control: the counter must observe real supported-property work.
    assert_eq!(vm.eval("lookupForms[0].present.tagName").unwrap(), "INPUT");
    let work = crate::native_bridge::element::take_form_lookup_work_for_test();
    assert!(work.inspected_nodes > 0);
    assert_eq!(work.traversals, 0);
    assert_eq!(work.enumerations, 0);
    vm.eval("Object.getOwnPropertyNames(lookupForms[0]).length")
        .unwrap();
    let work = crate::native_bridge::element::take_form_lookup_work_for_test();
    assert!(work.enumerations > 0);
    assert!(work.traversals > 0);
    assert!(work.inspected_nodes > 0);
}

#[test]
fn form_named_lookup_uncontested_own_properties_do_not_invoke_accessors_during_queries() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-expando.test/",
        "<!doctype html><html><body></body></html>",
    );
    let result = vm.eval(r#"
      (() => {
        const f = document.body.appendChild(document.createElement('form'));
        let reads = 0;
        let writes = 0;
        Object.defineProperty(f, 'ownData', {value: 17, writable: true, configurable: true});
        Object.defineProperty(f, 'ownAccessor', {
          get() { ++reads; return 23; }, set(v) { writes += v; }, configurable: true
        });
        f.innerHTML = '<input name="unrelated">';
        const proto = Object.create(Object.getPrototypeOf(f));
        Object.defineProperty(proto, 'protoKey', {value: 'prototype'});
        Object.setPrototypeOf(f, proto);
        if (!('ownAccessor' in f) || reads !== 0) throw Error('query called getter');
        const descriptor = Object.getOwnPropertyDescriptor(f, 'ownAccessor');
        if (typeof descriptor.get !== 'function' || reads !== 0) throw Error('descriptor called getter');
        if (f.ownAccessor !== 23 || reads !== 1) throw Error('accessor value');
        f.ownAccessor = 3;
        if (writes !== 3 || reads !== 1) throw Error('accessor setter');
        if (f.ownData !== 17 || f.protoKey !== 'prototype') throw Error('own/prototype values');
        if (Object.getOwnPropertyDescriptor(f, 'protoKey') !== undefined) throw Error('prototype is not own');
        if (!delete f.ownData || f.ownData !== undefined) throw Error('ordinary data deletion');
        if (!delete f.ownAccessor || f.ownAccessor !== undefined || reads !== 1)
          throw Error('ordinary accessor deletion');
        return 'ok';
      })()
    "#).expect("own properties must not be confused with intercepted or inherited properties");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_keeps_native_overrides_descriptors_and_index_boundaries() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-boundaries.test/",
        r#"<!doctype html><form id="f"><input name="submit"><input name="requestSubmit"><input name="elements"><input name="nodeType"><input name="plain"><input name="01"></form>"#,
    );
    let result = vm.eval(r#"
      (() => {
        const f = document.getElementById('f');
        const inputs = document.querySelectorAll('input');
        for (let i = 0; i < inputs.length; ++i) {
          const name = inputs[i].name;
          if (f[name] !== inputs[i] || !(name in f)) throw Error('native or named override: ' + name);
          if (Object.getOwnPropertyDescriptor(f, name).value !== inputs[i]) throw Error('descriptor');
        }
        if (f[0] !== inputs[0] || f['01'] !== inputs[5]) throw Error('index routing');
        const symbol = Symbol('plain');
        f[symbol] = 9;
        if (f[symbol] !== 9 || !delete f[symbol]) throw Error('symbol');
        return 'ok';
      })()
    "#).expect("named overrides and property operations should keep their existing contract");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_index_misses_become_hits_and_preserve_past_names() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-mutations.test/",
        r#"<!doctype html><html><body><form id="owner"></form><form id="other"></form></body></html>"#,
    );
    let result = vm
        .eval(
            r#"
      (() => {
        const f = document.getElementById('owner');
        const other = document.getElementById('other');
        if (f.lateKey !== undefined || 'lateKey' in f) throw Error('initial miss');
        const input = document.createElement('input');
        input.name = 'lateKey';
        f.appendChild(input);
        if (f.lateKey !== input) throw Error('insert after miss');
        input.name = 'renamedKey';
        if (f.renamedKey !== input || f.lateKey !== input) throw Error('rename/past name');
        input.removeAttribute('name');
        if (f.lateKey !== input) throw Error('global index miss discarded past name');
        other.appendChild(input);
        if (f.lateKey !== undefined) throw Error('past owner invalidation');
        input.id = 'lateId';
        input.setAttribute('form', 'owner');
        if (f.lateId !== input || other.lateId !== undefined) throw Error('external form owner');
        input.removeAttribute('id');
        input.setAttribute('form', 'missing');
        if (f.lateId !== undefined) throw Error('removed id and owner');
        const decoy = document.body.appendChild(document.createElement('div'));
        decoy.id = 'decoyKey';
        if (f.decoyKey !== undefined) throw Error('global hit must not bypass control predicate');
        const img = f.appendChild(document.createElement('img'));
        img.name = 'imageKey';
        if (f.imageKey !== img) throw Error('image fallback');
        const real = f.appendChild(document.createElement('input'));
        real.name = 'imageKey';
        if (f.imageKey !== real) throw Error('control wins over image');
        return 'ok';
      })()
    "#,
        )
        .expect("named lookup must remain live without caching misses");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_candidates_include_detached_shadow_and_child_documents() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-scopes.test/",
        "<!doctype html><html><body></body></html>",
    );
    let result = vm.eval(r#"
      (() => {
        function check(doc, parent, key) {
          const form = doc.createElement('form');
          if (form[key] !== undefined) throw Error('initial scope miss');
          const input = doc.createElement('input');
          input.name = key;
          form.appendChild(input);
          if (parent) parent.appendChild(form);
          if (form[key] !== input || !(key in form) || Object.getOwnPropertyDescriptor(form, key).value !== input)
            throw Error('scope candidate lost: ' + key);
          return form;
        }
        check(document, null, 'detachedKey');
        const host = document.body.appendChild(document.createElement('div'));
        const shadow = host.attachShadow({mode: 'closed'});
        check(document, shadow, 'shadowKey');
        const child = document.body.appendChild(document.createElement('iframe')).contentWindow;
        const childForm = check(child.document, child.document.body, 'childKey');
        if (Object.getPrototypeOf(childForm.childKey) !== child.HTMLInputElement.prototype) throw Error('child realm');
        return 'ok';
      })()
    "#).expect("global candidate miss check must include every document and tree scope");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_detached_document_and_adopted_wrappers() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-detached-document.test/",
        "<!doctype html><html><body></body></html>",
    );
    let result = vm.eval(r#"
      (() => {
        const results=[];
        for (const adopted of [false,true]) {
          const doc=document.implementation.createHTMLDocument('detached');
          const form=doc.body.appendChild(doc.createElement('form'));
          if (form.otherDocumentKey !== undefined) throw Error('initial miss');
          const input=form.appendChild(doc.createElement('input'));
          input.name='otherDocumentKey';
          if (adopted) document.body.appendChild(document.adoptNode(form));
          const d=Object.getOwnPropertyDescriptor(form,'otherDocumentKey');
          results.push(form.otherDocumentKey===input, 'otherDocumentKey' in form, !!d&&d.value===input);
        }
        if (!results.every(Boolean)) throw Error('detached-document or adopted named property unavailable');
        return 'ok';
      })()
    "#).expect("detached-document wrappers should expose named controls before and after adoption");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_candidates_do_not_cache_custom_element_eligibility() {
    let mut vm = new_parsed_test_vm(
        "https://form-lookup-custom.test/",
        r#"<!doctype html><html><body><form id="owner"></form></body></html>"#,
    );
    let result = vm.eval(r#"
      (() => {
        const f = document.getElementById('owner');
        if (f.faceKey !== undefined) throw Error('initial miss');
        const face = document.createElement('named-lookup-face');
        face.setAttribute('name', 'faceKey');
        f.appendChild(face);
        if (f.faceKey !== undefined) throw Error('unregistered candidate');
        customElements.define('named-lookup-face', class extends HTMLElement {
          static formAssociated = true;
          constructor() { super(); this.attachInternals(); }
        });
        if (f.faceKey !== face || !('faceKey' in f) || Object.getOwnPropertyDescriptor(f, 'faceKey').value !== face)
          throw Error('upgrade must change eligibility without id/name mutation');
        const notFace = document.createElement('named-lookup-ordinary');
        notFace.setAttribute('name', 'ordinaryKey');
        f.appendChild(notFace);
        customElements.define('named-lookup-ordinary', class extends HTMLElement {});
        if (f.ordinaryKey !== undefined) throw Error('non form-associated custom element');
        return 'ok';
      })()
    "#).expect("named candidates are not a cached form eligibility decision");
    assert_eq!(result, "ok");
}

#[test]
fn form_named_lookup_preserves_identity_and_live_properties_across_document_scopes() {
    let mut vm = new_parsed_test_vm(
        "https://form-document-properties.test/",
        "<!doctype html><html><body></body></html>",
    );
    let result = vm.eval(r#"
      (() => {
        for (const mode of ['active', 'detached', 'adopted']) {
          const doc = mode === 'active' ? document : document.implementation.createHTMLDocument('forms');
          const f = doc.body.appendChild(doc.createElement('form'));
          const input = f.appendChild(doc.createElement('input'));
          input.name = 'originalKey';
          if (f.originalKey !== input) throw Error(mode + ': initial identity');
          if (mode === 'adopted') {
            if (document.adoptNode(f) !== f) throw Error('adoption replaced wrapper');
            document.body.appendChild(f);
          }
          if (f[0] !== input || !(0 in f) || Object.getOwnPropertyDescriptor(f, '0').value !== input)
            throw Error(mode + ': indexed identity');
          const d = Object.getOwnPropertyDescriptor(f, 'originalKey');
          if (d.value !== input || d.writable || d.enumerable || !d.configurable)
            throw Error(mode + ': named descriptor');
          input.name = 'newKey';
          if (f.newKey !== input || f.originalKey !== input) throw Error(mode + ': past name');
          const second = f.appendChild(doc.createElement('input'));
          second.name = 'newKey';
          const list = f.newKey;
          if (!(list instanceof RadioNodeList) || list.length !== 2 || list[0] !== input || list[1] !== second)
            throw Error(mode + ': multiple matches');
          second.remove();
          if (list.length !== 1 || f.newKey !== input) throw Error(mode + ': live list');
          input.name = 'submit';
          if (f.submit !== input || Object.getOwnPropertyDescriptor(f, 'submit').value !== input)
            throw Error(mode + ': native member override');
          const symbol = Symbol('custom');
          f[symbol] = 42;
          if (f[symbol] !== 42 || !delete f[symbol]) throw Error(mode + ': ordinary symbol');
          input.remove();
          if (f.originalKey !== undefined || f.newKey !== undefined || 'originalKey' in f || f[0] !== undefined)
            throw Error(mode + ': removed control');
          if (typeof f.submit !== 'function') throw Error(mode + ': restored native member');
          f.remove();
        }
        return 'ok';
      })()
    "#).expect("form property behavior must not depend on Document attachment or adoption");
    assert_eq!(result, "ok");
}
