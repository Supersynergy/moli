(() => {
  const other = document.getElementById('child').contentWindow;
  const rows = [];
  for (const [calleeName, callee] of [['main', globalThis], ['child', other]]) {
    for (const [ownerName, owner] of [['main', globalThis], ['child', other]]) {
      for (const kind of ['UnsupportedEvent', 'DeviceMotionEvent', 'DeviceOrientationEvent']) {
        let actual;
        try { callee.Document.prototype.createEvent.call(owner.document, kind); actual = ['no error']; }
        catch (error) {actual = [error.name, error instanceof callee.DOMException, error instanceof owner.DOMException];}
        const expected = ['NotSupportedError', true, callee === owner];
        rows.push({name: calleeName + '/' + ownerName + '/' + kind, expected, actual, pass: JSON.stringify(actual) === JSON.stringify(expected)});
      }
    }
  }
  rows.push({name: 'insecure-realms',expected:[false,false],actual:[isSecureContext,other.isSecureContext],pass: !isSecureContext && !other.isSecureContext});
  const failures=rows.filter(r => !r.pass);
  globalThis.__nodeReplacementResults={total:rows.length,passed:rows.length-failures.length,failures,rows};
  return failures.length === 0;
})()