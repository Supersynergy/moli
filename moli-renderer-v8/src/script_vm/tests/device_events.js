(() => {
  const other = document.getElementById('child').contentWindow;
  const realms = [['main', globalThis], ['iframe', other]];
  const rows = [];
  function check(name, expected, run) {
    let actual;
    try { actual = run(); } catch (error) { actual = {error: error.name, message: error.message}; }
    rows.push({name, expected, actual, pass: JSON.stringify(actual) === JSON.stringify(expected)});
  }
  function throwsTypeError(realm, run) {
    try { run(); } catch (error) { return error instanceof realm.TypeError; }
    return false;
  }
  function properties(event) {
    if ('alpha' in event)
      return [event.alpha, event.beta, event.gamma, event.absolute];
    const vector = (object, keys) => object === null ? null : keys.map(key => object[key]);
    return [vector(event.acceleration, ['x', 'y', 'z']),
      vector(event.accelerationIncludingGravity, ['x', 'y', 'z']),
      vector(event.rotationRate, ['alpha', 'beta', 'gamma']), event.interval];
  }
  const examples = [
    ['DeviceOrientationEvent', {alpha: 1, beta: -2, gamma: 3, absolute: true}, [1, -2, 3, true], [null, null, null, false]],
    ['DeviceMotionEvent', {acceleration: {x: 1, y: -2, z: 3}, accelerationIncludingGravity: {y: 4}, rotationRate: {alpha: 5}, interval: 6}, [[1, -2, 3], [null, 4, null], [5, null, null], 6], [null, null, null, 0]],
  ];
  for (const [homeName, home] of realms) for (const [kind, init, values, defaults] of examples) {
    const label = homeName + '/' + kind, Ctor = home[kind];
    check(label + '/exposure', 'function', () => typeof Ctor);
    if (typeof Ctor !== 'function') continue;
    check(label + '/inheritance', [true, true, true, 1, kind], () => [
      Object.getPrototypeOf(Ctor) === home.Event, Object.getPrototypeOf(Ctor.prototype) === home.Event.prototype,
      new Ctor('x') instanceof home.Event, Ctor.length, Ctor.name]);
    check(label + '/defaults', defaults, () => properties(new Ctor('x')));
    check(label + '/payload', values, () => properties(new Ctor('x', init)));
    check(label + '/base-event', ['x\uD800', true, true, true, false], () => {
      const event = new Ctor('x\uD800', {bubbles: true, cancelable: true, composed: true});
      return [event.type, event.bubbles, event.cancelable, event.composed, event.isTrusted];
    });
    check(label + '/requires-new-and-type', [true, true, true], () => [
      throwsTypeError(home, () => Ctor('x')), throwsTypeError(home, () => new Ctor()),
      throwsTypeError(home, () => new Ctor(Symbol('x')))]);
    for (const dictionary of [null, undefined]) check(label + '/nullish-' + dictionary, defaults, () => properties(new Ctor('x', dictionary)));
    for (const dictionary of [0, 'text', true, Symbol('dictionary')]) check(label + '/invalid-dictionary-' + typeof dictionary, true,
      () => throwsTypeError(home, () => new Ctor('x', dictionary)));
    check(label + '/constructor-subclass', [true, true, true], () => {
      class Subclass extends Ctor {}
      const event = new Subclass('x', init);
      return [event instanceof Subclass, event instanceof Ctor, JSON.stringify(properties(event)) === JSON.stringify(values)];
    });
    check(label + '/createEvent', [true, true, true], () => {
      const event = home.document.createEvent(kind.toLowerCase());
      const before = event.type === '' && JSON.stringify(properties(event)) === JSON.stringify(defaults);
      event.initEvent('ready', true, false);
      return [Object.getPrototypeOf(event) === Ctor.prototype, before, event.type === 'ready' && event.bubbles];
    });
    check(label + '/dispatch', [true, true, true], () => {
      const event = new Ctor('sensor', {...init, cancelable: true});
      const target = new home.EventTarget(); let seen = false;
      target.addEventListener('sensor', current => { seen = current === event && JSON.stringify(properties(current)) === JSON.stringify(values); current.preventDefault(); });
      return [!target.dispatchEvent(event), seen, event.target === target];
    });
    const fields = kind === 'DeviceOrientationEvent' ? ['alpha', 'beta', 'gamma', 'absolute'] : ['acceleration', 'accelerationIncludingGravity', 'rotationRate', 'interval'];
    for (const [calleeName, callee] of realms) {
      check(label + '/' + calleeName + '/createEvent-realm', [true, true], () => {
        const event = callee.Document.prototype.createEvent.call(home.document, kind);
        return [Object.getPrototypeOf(event) === Ctor.prototype,
          JSON.stringify(properties(event)) === JSON.stringify(defaults)];
      });
      for (const field of fields) {
        const descriptor = Object.getOwnPropertyDescriptor(callee[kind].prototype, field), real = new Ctor('x', init);
        check(label + '/' + calleeName + '/' + field + '/descriptor', ['function', 'get ' + field, 0, undefined, true, true, false], () => [typeof descriptor.get, descriptor.get.name, descriptor.get.length, descriptor.set, descriptor.enumerable, descriptor.configurable, Object.hasOwn(real, field)]);
        check(label + '/' + calleeName + '/' + field + '/genuine', true, () => descriptor.get.call(real) === real[field]);
        const revoked = Proxy.revocable(real, {}); revoked.revoke(); let traps = 0;
        for (const [index, receiver] of [null, undefined, {}, new home.Event('x'), Ctor.prototype, Object.create(real), new Proxy(real, {}), revoked.proxy,
          new Proxy(real, {get() {traps++;}, getPrototypeOf() {traps++;}})].entries())
          check(label + '/' + calleeName + '/' + field + '/invalid-' + index, true, () => throwsTypeError(callee, () => descriptor.get.call(receiver)));
        check(label + '/' + calleeName + '/' + field + '/no-traps', 0, () => traps);
      }
    }
  }
  for (const [name, realm] of realms) {
    if (typeof realm.DeviceOrientationEvent !== 'function' || typeof realm.DeviceMotionEvent !== 'function') continue;
    check(name + '/orientation-order', ['type', 'bubbles', 'cancelable', 'composed', 'absolute', 'alpha', 'beta', 'gamma'], () => {
      const order = [];
      new realm.DeviceOrientationEvent({toString() {order.push('type'); return 'x';}}, new Proxy({}, {get(_, key) {order.push(key);}}));
      return order;
    });
    check(name + '/motion-order', ['bubbles', 'cancelable', 'composed', 'acceleration', 'x', 'y', 'z', 'accelerationIncludingGravity', 'x', 'y', 'z', 'interval', 'rotationRate', 'alpha', 'beta', 'gamma'], () => {
      const order = [];
      new realm.DeviceMotionEvent('x', new Proxy({}, {get(_, key) {
        order.push(key);
        if (['acceleration', 'accelerationIncludingGravity', 'rotationRate'].includes(key)) return new Proxy({}, {get(_, inner) {order.push(inner);}});
      }}));
      return order;
    });
    check(name + '/conversion-exception', true, () => {
      const marker = new Error('dictionary');
      try { new realm.DeviceOrientationEvent('x', {get beta() {throw marker;}}); }
      catch (error) {return error === marker;}
      return false;
    });
    for (const field of ['alpha', 'beta', 'gamma']) {
      check(name + '/nullable-' + field, [null, null, 2, true], () => [
        new realm.DeviceOrientationEvent('x', {[field]: null})[field], new realm.DeviceOrientationEvent('x', {[field]: undefined})[field],
        new realm.DeviceOrientationEvent('x', {[field]: '2'})[field], Object.is(new realm.DeviceOrientationEvent('x', {[field]: -0})[field], -0)]);
      for (const [i, value] of [NaN, Infinity, -Infinity, 1n, Symbol('number')].entries())
        check(name + '/nonfinite-' + field + '-' + i, true, () => throwsTypeError(realm, () => new realm.DeviceOrientationEvent('x', {[field]: value})));
    }
    for (const field of ['acceleration', 'accelerationIncludingGravity', 'rotationRate']) {
      const type = field === 'rotationRate' ? 'DeviceMotionEventRotationRate' : 'DeviceMotionEventAcceleration';
      const keys = field === 'rotationRate' ? ['alpha', 'beta', 'gamma'] : ['x', 'y', 'z'];
      check(name + '/' + field + '/missing-null-empty', [true, true, true], () => [
        new realm.DeviceMotionEvent('x', {[field]: undefined})[field] === null,
        keys.every(k => new realm.DeviceMotionEvent('x', {[field]: null})[field][k] === null),
        keys.every(k => new realm.DeviceMotionEvent('x', {[field]: {}})[field][k] === null)]);
      check(name + '/' + field + '/vector', [true, '[object ' + type + ']', 0, true, true, true], () => {
        const source = {[keys[0]]: -0, [keys[1]]: '2'}, event = new realm.DeviceMotionEvent('x', {[field]: source}), vector = event[field];
        source[keys[1]] = 99;
        return [Object.getPrototypeOf(vector) === realm[type].prototype, Object.prototype.toString.call(vector), Object.keys(vector).length,
          vector === event[field], Object.is(vector[keys[0]], -0), vector[keys[1]] === 2];
      });
      for (const key of keys) {
        check(name + '/' + field + '/' + key + '/finite', true, () => throwsTypeError(realm, () => new realm.DeviceMotionEvent('x', {[field]: {[key]: Infinity}})));
        for (const [calleeName, callee] of realms) check(name + '/' + field + '/' + key + '/' + calleeName + '/brand', [true, true, true, true], () => {
          const vector = new realm.DeviceMotionEvent('x', {[field]: {[key]: 5}})[field];
          const getter = Object.getOwnPropertyDescriptor(callee[type].prototype, key).get;
          return [getter.call(vector) === 5, throwsTypeError(callee, () => getter.call({})),
            throwsTypeError(callee, () => getter.call(new Proxy(vector, {}))), throwsTypeError(callee, () => getter.call(Object.create(vector)))];
        });
      }
      check(name + '/' + field + '/illegal-constructor', [true, true], () => [throwsTypeError(realm, () => new realm[type]()), throwsTypeError(realm, () => realm[type]())]);
      for (const [i, value] of [true, 1, 'bad', Symbol('dictionary')].entries()) check(name + '/' + field + '/bad-dictionary-' + i, true,
        () => throwsTypeError(realm, () => new realm.DeviceMotionEvent('x', {[field]: value})));
    }
    check(name + '/interval-conversion', [0, 2, true, true], () => [new realm.DeviceMotionEvent('x', {interval: null}).interval,
      new realm.DeviceMotionEvent('x', {interval: '2'}).interval, Object.is(new realm.DeviceMotionEvent('x', {interval: -0}).interval, -0),
      throwsTypeError(realm, () => new realm.DeviceMotionEvent('x', {interval: NaN}))]);
  }
  check('lazy-vector-intrinsics-ignore-public-constructors', [0, 1, 2, 'DeviceMotionEventAcceleration', 'DeviceMotionEventRotationRate', true, false], () => {
    const frame = document.createElement('iframe'); document.body.appendChild(frame);
    try {
      const realm = frame.contentWindow, Motion = realm.DeviceMotionEvent;
      let reads = 0;
      const publicGetter = () => {reads++; throw new Error('public constructor getter');};
      Object.defineProperty(realm, 'DeviceMotionEventAcceleration', {configurable: true, get: publicGetter});
      delete realm.DeviceMotionEventRotationRate;
      const event = new Motion('x', {acceleration: {x: 1}, rotationRate: {alpha: 2}});
      return [reads, event.acceleration.x, event.rotationRate.alpha,
        Object.getPrototypeOf(event.acceleration).constructor.name, Object.getPrototypeOf(event.rotationRate).constructor.name,
        Object.getOwnPropertyDescriptor(realm, 'DeviceMotionEventAcceleration').get === publicGetter,
        Object.hasOwn(realm, 'DeviceMotionEventRotationRate')];
    } finally {frame.remove();}
  });
  globalThis.__deviceEventFailures = rows.filter(row => !row.pass);
  globalThis.__nodeReplacementResults = {total: rows.length, passed: rows.filter(row => row.pass).length, failures: __deviceEventFailures, rows};
  return rows.every(row => row.pass);
})()
