use moli_webidl::{Context, DomString, DomString16, StringOptions, UsvString};

fn lossless<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    args: v8::FunctionCallbackArguments<'s>,
    mut rv: v8::ReturnValue<'s>,
) {
    let options = StringOptions {
        treat_null_as_empty_string: args.get(1).is_true(),
    };
    match moli_webidl::convert_with_options::<DomString16>(
        scope,
        args.get(0),
        Context::argument("lossless", 1),
        &options,
    ) {
        Ok(value) => rv.set(
            v8::String::new_from_two_byte(scope, &value.0, v8::NewStringType::Normal)
                .unwrap()
                .into(),
        ),
        Err(error) => moli_webidl::throw_error(scope, &error),
    }
}

fn utf8_boundary<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    args: v8::FunctionCallbackArguments<'s>,
    mut rv: v8::ReturnValue<'s>,
) {
    let context = Context::argument("utf8Boundary", 1);
    let value = if args.get(1).is_true() {
        moli_webidl::convert::<UsvString>(scope, args.get(0), context).map(|value| value.0)
    } else {
        moli_webidl::convert::<DomString>(scope, args.get(0), context).map(|value| value.0)
    };
    match value {
        Ok(value) => rv.set(v8::String::new(scope, &value).unwrap().into()),
        Err(error) => moli_webidl::throw_error(scope, &error),
    }
}

#[test]
fn dom_string16_preserves_code_units_and_webidl_conversion_semantics() {
    moli_v8_test_util::ensure_v8();
    let mut isolate = v8::Isolate::new(v8::CreateParams::default());
    let scope = std::pin::pin!(v8::HandleScope::new(&mut isolate));
    let scope = &mut scope.init();
    let callee = v8::Context::new(scope, Default::default());
    let (lossless_function, utf8_function, type_error) = {
        let scope = &mut v8::ContextScope::new(scope, callee);
        let lossless_function = v8::Function::new(scope, lossless).unwrap();
        let utf8_function = v8::Function::new(scope, utf8_boundary).unwrap();
        let key = v8::String::new(scope, "TypeError").unwrap();
        let type_error = callee.global(scope).get(scope, key.into()).unwrap();
        (lossless_function, utf8_function, type_error)
    };
    let caller = v8::Context::new(scope, Default::default());
    let scope = &mut v8::ContextScope::new(scope, caller);
    let global = caller.global(scope);
    for (name, value) in [
        ("lossless", lossless_function.into()),
        ("utf8Boundary", utf8_function.into()),
        ("CalleeTypeError", type_error),
    ] {
        let key = v8::String::new(scope, name).unwrap();
        assert_eq!(
            global.create_data_property(scope, key.into(), value),
            Some(true)
        );
    }
    let source = v8::String::new(scope, r#"
      (() => {
        const assert = (ok, message) => { if (!ok) throw Error(message); };
        const thrown = callback => { try { callback(); } catch (error) { return error; } throw Error('expected exception'); };
        for (const value of ['', 'ascii', '\0a\0', '\ud800', '\udfff', '\ud800x\udfff', '\ud83d\ude00', '\ud800\ud800\udfff\udfff']) {
          const result = lossless(value);
          assert(result === value && result.length === value.length, 'exact UTF-16 units');
          for (let i = 0; i < value.length; i++) assert(result.charCodeAt(i) === value.charCodeAt(i), 'unit ' + i);
        }
        for (const value of [null, undefined, true, false, 0, -0, NaN, Infinity, 123n]) {
          assert(lossless(value) === String(value), 'ToString scalar');
        }
        assert(lossless(null, true) === '' && lossless(undefined, true) === 'undefined', 'null-only empty-string option');
        let conversions = 0;
        const value = {toString() { conversions++; return '\ud800\0\udfff'; }, valueOf() { throw Error('wrong hint'); }};
        assert(lossless(value) === '\ud800\0\udfff' && conversions === 1, 'single ToString with string hint');
        const order = [];
        const exotic = {[Symbol.toPrimitive](hint) { order.push(hint); return '\udfff'; }};
        assert(lossless(exotic) === '\udfff' && order.join() === 'string', 'ToPrimitive string hint');
        const sentinel = {};
        assert(thrown(() => lossless({toString() { throw sentinel; }})) === sentinel, 'exception identity');
        for (const value of [Symbol(), Object(Symbol()), {toString() { return Symbol(); }}]) {
          const error = thrown(() => lossless(value));
          assert(error instanceof CalleeTypeError && !(error instanceof TypeError), 'callee realm conversion error');
        }
        assert(utf8Boundary('\ud800x\udfff') === '\ufffdx\ufffd', 'existing Rust String boundary stays lossy');
        assert(utf8Boundary('\ud800x\udfff', true) === '\ufffdx\ufffd', 'USVString applies scalar replacement');
        assert(utf8Boundary('\ud83d\ude00') === '\ud83d\ude00', 'UTF-8 boundary preserves valid pairs');
        return true;
      })()
    "#).unwrap();
    let script = v8::Script::compile(scope, source, None).unwrap();
    assert!(
        script
            .run(scope)
            .expect("lossless DOMString checks")
            .is_true()
    );
}
