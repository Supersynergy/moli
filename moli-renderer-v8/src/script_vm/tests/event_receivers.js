(() => {
  const other = document.getElementById('child').contentWindow;
  const realms = [['main', globalThis], ['iframe', other]];
  const rows = [];
  function check(name, expected, run) {
    let actual;
    try { actual = run(); } catch (error) { actual = {error: error.name, message: error.message}; }
    rows.push({name, expected, actual, pass: JSON.stringify(actual) === JSON.stringify(expected)});
  }
  const coreGetters = ['type', 'target', 'currentTarget', 'eventPhase', 'bubbles', 'cancelable',
    'defaultPrevented', 'composed', 'srcElement', 'cancelBubble', 'returnValue', 'timeStamp'];
  const methods = ['preventDefault', 'stopPropagation', 'stopImmediatePropagation', 'composedPath'];
  function invalidReceivers(realm, real, traps) {
    const revoked = Proxy.revocable(real, {}); revoked.revoke();
    return [null, undefined, 0, {}, realm, realm.document, realm.document.createElement('div'),
      Object.getPrototypeOf(real), Object.create(real), new Proxy(real, {}), revoked.proxy,
      new Proxy(real, {get() {traps.push('get'); throw new Error('get trap');},
        getPrototypeOf() {traps.push('prototype'); throw new Error('prototype trap');}})];
  }
  for (const [calleeName, callee] of realms) for (const [homeName, home] of realms) {
    const label = calleeName + '/' + homeName;
    for (const kind of ['Event', 'MouseEvent', 'CustomEvent']) {
      const real = new home[kind]('before', {cancelable: true});
      for (const name of coreGetters) {
        const getter = Object.getOwnPropertyDescriptor(callee.Event.prototype, name).get;
        check(label + '/' + kind + '/' + name + '/genuine', true, () => getter.call(real) === real[name]);
        const traps = [];
        for (const [index, receiver] of invalidReceivers(home, real, traps).entries()) {
          check(label + '/' + kind + '/' + name + '/invalid-' + index, true, () => {
            try { getter.call(receiver); } catch(error) { return error instanceof callee.TypeError; }
            return false;
          });
        }
        check(label + '/' + kind + '/' + name + '/no-traps', [], () => traps);
      }
      for (const name of methods) {
        const method = callee.Event.prototype[name];
        check(label + '/' + kind + '/' + name + '/genuine', true, () => {
          method.call(new home[kind]('before', {cancelable: true})); return true;
        });
        const traps = [];
        for (const [index, receiver] of invalidReceivers(home, real, traps).entries()) {
          check(label + '/' + kind + '/' + name + '/invalid-' + index, true, () => {
            try { method.call(receiver); } catch(error) { return error instanceof callee.TypeError; }
            return false;
          });
        }
        check(label + '/' + kind + '/' + name + '/no-traps', [], () => traps);
      }
      for (const name of ['cancelBubble', 'returnValue']) {
        const setter = Object.getOwnPropertyDescriptor(callee.Event.prototype, name).set;
        const traps = [];
        for (const [index, receiver] of invalidReceivers(home, real, traps).entries()) {
          check(label + '/' + kind + '/' + name + '/setter-invalid-' + index, true, () => {
            try { setter.call(receiver, false); } catch(error) { return error instanceof callee.TypeError; }
            return false;
          });
        }
        check(label + '/' + kind + '/' + name + '/setter-no-traps', [], () => traps);
      }
    }
    const legacy = [['Event', 'initEvent'], ['UIEvent', 'initUIEvent'], ['MouseEvent', 'initMouseEvent'],
      ['KeyboardEvent', 'initKeyboardEvent'], ['CustomEvent', 'initCustomEvent'],
      ['StorageEvent', 'initStorageEvent'], ['CompositionEvent', 'initCompositionEvent'], ['TextEvent', 'initTextEvent']];
    for (const [kind, name] of legacy) {
      const make = () => {
        if (kind !== 'TextEvent') return new home[kind]('before');
        const event = home.document.createEvent(kind);
        event.initTextEvent('before');
        return event;
      };
      const method = callee[kind].prototype[name];
      const args = type => name === 'initMouseEvent'
        ? [type, true, true, null, 0, 0, 0, 0, 0, false, false, false, false, 0, null]
        : [type, true, true];
      check(label + '/' + name + '/genuine', ['after', true], () => {
        const real = make(); method.apply(real, args('after'));
        return [real.type, real instanceof home[kind]];
      });
      const real = make(), traps = [];
      for (const [index, receiver] of invalidReceivers(home, real, traps).entries()) {
        check(label + '/' + name + '/invalid-' + index, [true, 0], () => {
          let conversions = 0, rejected = false;
          const type = {toString() {conversions++; return 'forged';}};
          try {method.apply(receiver, args(type));} catch(error) {rejected = error instanceof callee.TypeError;}
          return [rejected, conversions];
        });
      }
      check(label + '/' + name + '/no-traps', [], () => traps);
      if (kind !== 'Event') {
        check(label + '/' + name + '/wrong-event-brand', true, () => {
          try {method.apply(new home.Event('before'), args('after'));}
          catch(error) {return error instanceof callee.TypeError;}
          return false;
        });
      }
      check(label + '/' + name + '/conversion-exception', true, () => {
        const marker = new Error('conversion');
        try {method.apply(make(), args({toString() {throw marker;}}));}
        catch(error) {return error === marker;}
        return false;
      });
      check(label + '/' + name + '/dispatch-no-mutation', ['before', false], () => {
        const real = make(), target = new home.EventTarget();
        target.addEventListener(real.type, () => method.apply(real, args('after')));
        target.dispatchEvent(real);
        return [real.type, real.bubbles];
      });
    }
    check(label + '/borrowed-init-on-subclass', ['changed', true, true], () => {
      const real = new home.MouseEvent('before');
      callee.Event.prototype.initEvent.call(real, 'changed', true, true);
      return [real.type, real instanceof home.MouseEvent, real.cancelable];
    });
    check(label + '/inherited-ui-init-on-mouse', ['changed', true], () => {
      const real = new home.MouseEvent('before');
      callee.UIEvent.prototype.initUIEvent.call(real, 'changed');
      return [real.type, real instanceof home.MouseEvent];
    });
  }
  globalThis.__eventReceiverFailures = rows.filter(row => !row.pass);
  globalThis.__nodeReplacementResults = {total: rows.length, passed: rows.filter(row => row.pass).length,
    failures: __eventReceiverFailures, rows};
  return rows.every(row => row.pass);
})()
