(() => {
  const rows = [];
  function check(name, run) {
    let actual;
    try { actual = run(); }
    catch (error) { actual = {error: error.name, message: error.message}; }
    rows.push({name, actual, pass: actual === true});
  }
  function sameDescriptor(before, after) {
    if (!before || !after) return before === after;
    const keys = ['value', 'writable', 'get', 'set', 'enumerable', 'configurable'];
    return keys.every(key => Object.hasOwn(before, key) === Object.hasOwn(after, key) &&
      before[key] === after[key]);
  }
  function withWindow(owner, run) {
    if (owner !== 'root') throw new Error('unexpected document owner');
    // Finish a replacement stream first so write() starts a destructive stream.
    document.open();
    document.close();
    return run(window);
  }
  function replace(target, operation) {
    if (operation === 'open') target.document.open();
    else target.document.write('<!doctype html><body>replacement');
    target.document.close();
  }
  for (const owner of ['root']) {
    for (const operation of ['open', 'write']) {
      for (const mode of ['native', 'deleted', 'replaced', 'throwing-setter', 'read-only']) {
        check(`${owner}:${operation}:${mode}`, () => withWindow(owner, target => {
          let callbacks = 0, writes = 0;
          const native = Object.getOwnPropertyDescriptor(target, 'onresize');
          try {
            target.onresize = () => { ++callbacks; };
            target.addEventListener('resize', () => { ++callbacks; });
            if (mode === 'deleted') delete target.onresize;
            if (mode === 'replaced' || mode === 'throwing-setter') {
              Object.defineProperty(target, 'onresize', {set() {
                ++writes;
                if (mode === 'throwing-setter') throw new Error('author setter ran');
              }});
            }
            if (mode === 'read-only') {
              Object.defineProperty(target, 'onresize', {value: 17, writable: false});
            }
            const descriptor = Object.getOwnPropertyDescriptor(target, 'onresize');
            replace(target, operation);
            target.dispatchEvent(new Event('resize'));
            return sameDescriptor(descriptor, Object.getOwnPropertyDescriptor(target, 'onresize')) &&
              native.get.call(target) === null && callbacks === 0 && writes === 0;
          } finally { Object.defineProperty(target, 'onresize', native); }
        }));
      }

    }
  }
  const failures = rows.filter(row => !row.pass);
  globalThis.__nodeReplacementResults = {total: rows.length,
    passed: rows.length - failures.length, failures, rows};
  return failures.length === 0;
})()
