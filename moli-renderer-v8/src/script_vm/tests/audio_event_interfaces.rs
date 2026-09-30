use super::*;

#[test]
fn audio_events_have_native_payloads_receivers_and_dispatch() {
    let mut vm = new_storage_page_task_executor_test_vm("https://audio-event-interfaces.test/");
    vm.eval("document.body.innerHTML = '<iframe id=child></iframe>'")
        .unwrap();
    vm.eval(&format!("({}).then(value => globalThis.__audioEventDone = value, error => globalThis.__audioEventDone = String(error));", include_str!("audio_event_interfaces.js"))).unwrap();
    assert_eq!(
        vm.eval_after_selected_page_tasks("JSON.stringify(__audioEventResults.failures)")
            .unwrap(),
        "[]"
    );
    assert_eq!(vm.eval("__audioEventDone").unwrap(), "true");
}

#[test]
fn offline_completion_uses_the_default_fire_event_flags() {
    let mut vm = new_storage_page_task_executor_test_vm("https://audio-complete-flags.test/");
    vm.eval(r#"(() => {
        const context = new OfflineAudioContext(1,8,8000);
        context.oncomplete = event => globalThis.__completeFlags = [event.bubbles,event.cancelable,event.composed,event.isTrusted,event instanceof OfflineAudioCompletionEvent].join('|');
        context.startRendering();
    })()"#).unwrap();
    assert_eq!(
        vm.eval_after_selected_page_tasks("__completeFlags")
            .unwrap(),
        "false|false|false|true|true"
    );
}
