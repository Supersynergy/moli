(() => {
  'use strict';
  const equal = (actual, expected, label) => {
    if (!Object.is(actual, expected)) throw new Error(`${label}: ${String(actual)} !== ${String(expected)}`);
  };
  const throwsTypeError = (run, realm, label) => {
    try { run(); } catch (error) {
      equal(Object.getPrototypeOf(error), realm.TypeError.prototype, `${label} error realm`);
      return;
    }
    throw new Error(`${label}: missing TypeError`);
  };
  const realms = [globalThis, document.getElementById('child').contentWindow];
  const properties = ['fontFamily', 'annotation', 'ornaments', 'stylistic', 'swash', 'characterVariant', 'styleset'];
  const records = [];
  for (const realm of realms) {
    for (const connected of [false, true]) {
      const text = '@font-feature-values Seed { @styleset { existing: 2 3; } } .other {}';
      const style = connected ? realm.document.createElement('style') : null;
      if (style) { style.textContent = text; realm.document.head.append(style); }
      const sheet = style ? style.sheet : new realm.CSSStyleSheet();
      if (!style) sheet.replaceSync(text);
      records.push({ realm, style, sheet, rule: sheet.cssRules[0], wrong: sheet.cssRules[1] });
    }
  }
  let conversions = 0, traps = 0;
  const value = { toString() { conversions++; return 'Converted'; } };
  const handler = {
    get() { traps++; throw new Error('author get trap'); },
    getPrototypeOf() { traps++; throw new Error('author prototype trap'); }
  };
  const revoked = Proxy.revocable(records[0].rule, handler); revoked.revoke();
  const invalid = [null, undefined, false, 1, 'text', Symbol(), 1n, {},
    new Map(), document.createElement('div'), CSSRule.prototype,
    { cssText: records[0].rule.cssText, fontFamily: 'Seed' }, revoked.proxy];
  for (const { realm, rule, wrong } of records) {
    invalid.push(wrong, rule.styleset, realm.CSSFontFeatureValuesRule.prototype,
      Object.create(realm.CSSFontFeatureValuesRule.prototype), Object.create(rule), new Proxy(rule, handler));
  }
  for (const realm of realms) {
    for (const property of properties) {
      const get = Object.getOwnPropertyDescriptor(realm.CSSFontFeatureValuesRule.prototype, property).get;
      for (const receiver of invalid) throwsTypeError(() => get.call(receiver), realm, property);
      for (const { rule } of records) {
        const actual = get.call(rule), expected = rule[property];
        if (property === 'fontFamily') equal(actual, expected, `borrow ${property}`);
        else equal(JSON.stringify(Array.from(actual)), JSON.stringify(Array.from(expected)), `borrow ${property}`);
      }
    }
    const set = Object.getOwnPropertyDescriptor(realm.CSSFontFeatureValuesRule.prototype, 'fontFamily').set;
    for (const receiver of invalid) throwsTypeError(() => set.call(receiver, value), realm, 'fontFamily setter');
  }
  equal(conversions, 0, 'reject before DOMString conversion');
  equal(traps, 0, 'reject without Proxy traps');
  for (const { rule } of records) equal(rule.fontFamily, 'Seed', 'invalid receiver did not mutate rule');
  const marker = {};
  for (const realm of realms) {
    const set = Object.getOwnPropertyDescriptor(realm.CSSFontFeatureValuesRule.prototype, 'fontFamily').set;
    for (const { rule } of records) {
      let caught;
      try { set.call(rule, { toString() { throw marker; } }); } catch (error) { caught = error; }
      equal(caught, marker, 'genuine receiver propagates conversion exception');
      equal(rule.fontFamily, 'Seed', 'failed conversion leaves native rule intact');
    }
  }
  for (const { sheet, rule, style } of records) {
    const maps = properties.slice(1).map(property => rule[property]);
    const mapPrototype = Object.getPrototypeOf(maps[0]);
    for (const detached of [false, true]) {
      if (detached) sheet.deleteRule(0);
      for (const realm of realms) {
        const proto = realm.CSSFontFeatureValuesRule.prototype;
        const { get, set } = Object.getOwnPropertyDescriptor(proto, 'fontFamily');
        equal(set.call(rule, { toString() { conversions++; return 'Updated'; } }), undefined, 'setter return');
        equal(get.call(rule), 'Updated', 'native family after borrowed setter');
        properties.slice(1).forEach((property, index) => {
          const read = Object.getOwnPropertyDescriptor(proto, property).get;
          equal(JSON.stringify(Array.from(read.call(rule))), JSON.stringify(Array.from(maps[index])), 'retained feature values');
          equal(Object.getPrototypeOf(maps[index]), mapPrototype, 'retained map prototype');
        });
      }
      equal(rule.parentStyleSheet, detached ? null : sheet, 'rule lifecycle');
    }
    const prototype = Object.getPrototypeOf(rule);
    Object.setPrototypeOf(rule, null);
    try {
      const { get, set } = Object.getOwnPropertyDescriptor(CSSFontFeatureValuesRule.prototype, 'fontFamily');
      set.call(rule, 'Branded');
      equal(get.call(rule), 'Branded', 'native brand survives prototype changes');
    } finally { Object.setPrototypeOf(rule, prototype); }
    if (style) style.remove();
  }
  equal(conversions, 16, 'each genuine setter converts once');
  return true;
})()
