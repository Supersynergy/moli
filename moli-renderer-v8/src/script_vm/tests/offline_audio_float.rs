use super::*;

#[test]
fn offline_audio_sample_rate_uses_restricted_float_conversion() {
    let mut vm = new_storage_test_vm("https://offline-float.test/");
    vm.exec(
        r#"
globalThis.__offlineFloatRenderChecks = [];
(() => {
  function assert(ok, message) { if (!ok) throw new Error(message); }
  const iframe = document.createElement('iframe');
  if (!document.documentElement) document.appendChild(document.createElement('html'));
  if (!document.body) document.documentElement.appendChild(document.createElement('body'));
  document.body.appendChild(iframe);
  for (const realm of [window, iframe.contentWindow]) {
    for (const value of [NaN, Infinity, -Infinity, 1e100, Symbol(), 1n]) {
      let caught;
      try { new realm.OfflineAudioContext(1, 16, value); } catch (error) { caught = error; }
      assert(caught instanceof realm.TypeError, 'restricted float rejects ' + typeof value);
    }
    for (const value of [44100.1, 48000.01]) {
      const context = new realm.OfflineAudioContext(1, 16, value);
      assert(context.sampleRate === Math.fround(value), 'sample rate preserves Float32 rounding');
      const rate = context.sampleRate;
      context.startRendering().then(buffer => {
        __offlineFloatRenderChecks.push(buffer.sampleRate === rate && buffer.length === 16);
      });
    }
    let reads = 0;
    const context = new realm.OfflineAudioContext(1, 16, {valueOf() { ++reads; return 44100.1; }});
    assert(reads === 1 && context.sampleRate === Math.fround(44100.1), 'single numeric conversion');
    const sentinel = new realm.Error('sample rate conversion');
    let caught;
    try { new realm.OfflineAudioContext(1, 16, {valueOf() { throw sentinel; }}); }
    catch (error) { caught = error; }
    assert(caught === sentinel, 'numeric exception identity');
  }
})()
"#,
        None,
    )
    .expect("offline sample rate conversion");
    assert_eq!(
        vm.eval(
            "__offlineFloatRenderChecks.length === 4 && __offlineFloatRenderChecks.every(Boolean)"
        )
        .unwrap(),
        "true",
        "rendered buffers retain the converted rate in both realms"
    );
}
