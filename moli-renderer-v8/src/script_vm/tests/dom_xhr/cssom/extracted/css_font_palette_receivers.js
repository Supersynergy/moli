(() => {
  'use strict';
  const equal = (actual, expected, label) => {
    if (!Object.is(actual, expected)) throw new Error(`${label}: ${actual} !== ${expected}`);
  };
  const other = document.getElementById('child').contentWindow;
  const rules = [globalThis, other].map(realm => {
    const sheet = new realm.CSSStyleSheet();
    sheet.replaceSync('@font-palette-values --one { base-palette: 3; } .x {}');
    return [sheet.cssRules[0], sheet.cssRules[1]];
  });
  let traps = 0;
  const handler = { get() { traps++; throw new Error('author trap'); } };
  const revoked = Proxy.revocable(rules[0][0], handler); revoked.revoke();
  const invalid = [null, undefined, 3, {}, ...rules.map(row => row[1]),
    Object.create(rules[0][0]), CSSFontPaletteValuesRule.prototype,
    Object.create(CSSFontPaletteValuesRule.prototype), new Proxy(rules[0][0], handler), revoked.proxy];
  for (const realm of [globalThis, other]) {
    for (const property of ['name', 'fontFamily', 'basePalette', 'overrideColors']) {
      const get = Object.getOwnPropertyDescriptor(realm.CSSFontPaletteValuesRule.prototype, property).get;
      for (const receiver of invalid) {
        let thrown = false;
        try { get.call(receiver); } catch (error) {
          equal(Object.getPrototypeOf(error), realm.TypeError.prototype, 'callee TypeError realm');
          thrown = true;
        }
        equal(thrown, true, `${property} rejects incompatible receiver`);
      }
      for (const [rule] of rules) equal(get.call(rule), rule[property], 'cross-realm native receiver');
    }
  }
  equal(traps, 0, 'receiver check never executes Proxy traps');
  return true;
})()
