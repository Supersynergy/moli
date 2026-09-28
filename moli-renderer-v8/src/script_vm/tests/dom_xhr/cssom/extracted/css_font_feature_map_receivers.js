(() => {
  'use strict';
  const equal = (actual, expected, label) => {
    if (!Object.is(actual, expected)) throw new Error(`${label}: ${String(actual)} !== ${String(expected)}`);
  };
  const realms = [globalThis, document.getElementById('child').contentWindow];
  const records = realms.map(realm => {
    const sheet = new realm.CSSStyleSheet();
    sheet.replaceSync('@font-feature-values Seed { @styleset { existing: 2 3; } }');
    const rule = sheet.cssRules[0];
    return { realm, sheet, rule, map: rule.styleset };
  });
  const prototypes = records.map(record => Object.getPrototypeOf(record.map));
  const prototypeFor = realm => prototypes[realms.indexOf(realm)];
  let conversions = 0, traps = 0, callbacks = 0;
  const key = { toString() { conversions++; return 'late'; } };
  const values = { get [Symbol.iterator]() { conversions++; return [7][Symbol.iterator]; } };
  const handler = {
    get() { traps++; throw new Error('author get trap'); },
    getPrototypeOf() { traps++; throw new Error('author prototype trap'); }
  };
  const revoked = Proxy.revocable(records[0].map, handler); revoked.revoke();
  const invalid = [null, undefined, false, 1, 'text', Symbol(), 1n, {}, new Map(), revoked.proxy];
  for (const { realm, rule, map } of records) {
    invalid.push(rule, prototypeFor(realm), Object.create(map),
      Object.create(prototypeFor(realm)), new Proxy(map, handler));
  }
  for (const realm of realms) {
    const p = prototypeFor(realm);
    const size = Object.getOwnPropertyDescriptor(p, 'size').get;
    const operations = [
      ['size', size, []], ['get', p.get, [key]], ['has', p.has, [key]],
      ['set', p.set, [key, values]], ['delete', p.delete, [key]], ['clear', p.clear, []],
      ['entries', p.entries, []], ['keys', p.keys, []], ['values', p.values, []],
      ['iterator', p[Symbol.iterator], []], ['forEach', p.forEach, [() => { callbacks++; }]]
    ];
    equal(p[Symbol.iterator], p.entries, 'iterator alias identity');
    for (const [name, fn, args] of operations) {
      for (const receiver of invalid) {
        let thrown = false;
        try { Reflect.apply(fn, receiver, args); } catch (error) {
          equal(Object.getPrototypeOf(error), realm.TypeError.prototype, `${name} callee TypeError realm`);
          thrown = true;
        }
        equal(thrown, true, `${name} rejects incompatible receiver`);
      }
    }
  }
  equal(conversions, 0, 'receiver check precedes conversion');
  equal(traps, 0, 'no Proxy traps');
  equal(callbacks, 0, 'no callback on invalid receiver');
  for (const { sheet, rule, map } of records) {
    for (const detached of [false, true]) {
      if (detached) sheet.deleteRule(0);
      for (const realm of realms) {
        const p = prototypeFor(realm);
        p.clear.call(map);
        equal(p.set.call(map, 'late', [7, 8]), undefined, 'native map set return');
        equal(p.has.call(map, 'late'), true, 'borrowed native has');
        equal(JSON.stringify(p.get.call(map, 'late')), '[7,8]', 'borrowed native get');
        equal(Object.getOwnPropertyDescriptor(p, 'size').get.call(map), 1, 'native size');
        equal(JSON.stringify(Array.from(p.entries.call(map))), '[["late",[7,8]]]', 'native entries');
        equal(JSON.stringify(Array.from(p.keys.call(map))), '["late"]', 'native keys');
        equal(JSON.stringify(Array.from(p.values.call(map))), '[[7,8]]', 'native values');
        const thisArg = {};
        let seen = 0;
        p.forEach.call(map, function(value, key, receiver) {
          equal(this, thisArg, 'forEach thisArg'); equal(receiver, map, 'forEach native receiver');
          equal(key, 'late', 'forEach key'); equal(JSON.stringify(value), '[7,8]', 'forEach value'); seen++;
        }, thisArg);
        equal(seen, 1, 'forEach called once');
        equal(rule.cssText.includes('late: 7 8'), true, 'map mutation updates native rule');
        equal(p.delete.call(map, 'late'), true, 'native delete');
        equal(p.delete.call(map, 'late'), false, 'native missing delete');
      }
    }
    const prototype = Object.getPrototypeOf(map);
    Object.setPrototypeOf(map, null);
    try {
      prototypeFor(globalThis).set.call(map, 'branded', 9);
      equal(JSON.stringify(prototypeFor(globalThis).get.call(map, 'branded')), '[9]', 'brand survives prototype changes');
    } finally { Object.setPrototypeOf(map, prototype); }
  }
  return true;
})()
