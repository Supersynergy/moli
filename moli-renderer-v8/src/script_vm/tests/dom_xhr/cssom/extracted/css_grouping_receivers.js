(() => {
  'use strict';
  const equal = (actual, expected, label) => {
    if (!Object.is(actual, expected)) throw new Error(`${label}: ${actual} !== ${expected}`);
  };
  const other = document.getElementById('child').contentWindow;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('@namespace url("urn:test"); @media all { .a {} } .parent { & .child {} }');
  const namespace = sheet.cssRules[0], media = sheet.cssRules[1], style = sheet.cssRules[2];
  const foreignSheet = new other.CSSStyleSheet(); foreignSheet.replaceSync('@media all {}');
  const foreign = foreignSheet.cssRules[0];
  let conversions = 0, traps = 0;
  const text = {toString() { conversions++; return '.x {}'; }};
  const index = {valueOf() { conversions++; return 0; }};
  const handler = {get() { traps++; throw new Error('author trap'); }};
  const revoked = Proxy.revocable(media, handler); revoked.revoke();
  const invalid = [{}, namespace, Object.create(media), Object.create(CSSGroupingRule.prototype), new Proxy(media, handler), revoked.proxy];
  for (const realm of [globalThis, other]) {
    const get = Object.getOwnPropertyDescriptor(realm.CSSGroupingRule.prototype, 'cssRules').get;
    const insert = realm.CSSGroupingRule.prototype.insertRule;
    const remove = realm.CSSGroupingRule.prototype.deleteRule;
    for (const receiver of invalid) {
      for (const invoke of [() => get.call(receiver), () => insert.call(receiver, text, index), () => remove.call(receiver, index)]) {
        let thrown = false;
        try { invoke(); } catch (error) {
          equal(Object.getPrototypeOf(error), realm.TypeError.prototype, 'callee TypeError realm');
          thrown = true;
        }
        equal(thrown, true, 'receiver rejected');
      }
    }
    equal(conversions, 0, 'brand checks precede argument conversion');
    equal(traps, 0, 'brand checks do not invoke author proxy traps');
    for (const rule of [media, style, foreign]) {
      const list = rule.cssRules;
      equal(get.call(rule), list, 'inherited getter shares list');
      const oldLength = list.length;
      equal(insert.call(rule, '.added {}', oldLength), oldLength, 'genuine cross-realm receiver');
      equal(get.call(rule), list, 'insertion preserves list');
      equal(list.length, oldLength + 1, 'inserted rule observable');
      remove.call(rule, oldLength);
      equal(list.length, oldLength, 'deletion observable');
    }
  }
  return true;
})()
