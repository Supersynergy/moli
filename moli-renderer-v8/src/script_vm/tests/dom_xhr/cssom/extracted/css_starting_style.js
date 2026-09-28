(() => {
  'use strict';
  const equal = (actual, expected, label) => {
    if (!Object.is(actual, expected)) throw new Error(`${label}: ${actual} !== ${expected}`);
  };
  const throws = (callback, Type, name) => {
    try { callback(); } catch (error) {
      if (!(error instanceof Type)) throw error;
      if (name) equal(error.name, name, 'exception name');
      return;
    }
    throw new Error('missing exception');
  };
  const other = document.getElementById('child').contentWindow;
  const check = (rule, realm, sheet, parent = null) => {
    equal(Object.getPrototypeOf(rule), realm.CSSStartingStyleRule.prototype, 'rule realm');
    equal(rule instanceof realm.CSSGroupingRule, true, 'grouping interface');
    equal(rule instanceof realm.CSSRule, true, 'rule interface');
    equal(Object.prototype.toString.call(rule), '[object CSSStartingStyleRule]', 'tag');
    equal(rule.type, 0, 'new rule kinds have no legacy type constant');
    equal(rule.parentStyleSheet, sheet, 'parent sheet');
    equal(rule.parentRule, parent, 'parent rule');
    equal(rule.cssRules, rule.cssRules, 'stable child list');
  };
  for (const realm of [globalThis, other]) {
    const C = realm.CSSStartingStyleRule;
    equal(typeof C, 'function', 'constructor exposure');
    equal(C.length, 0, 'constructor length');
    equal(Object.getPrototypeOf(C), realm.CSSGroupingRule, 'constructor inheritance');
    equal(Object.getPrototypeOf(C.prototype), realm.CSSGroupingRule.prototype, 'prototype inheritance');
    throws(() => new C(), realm.TypeError);
    throws(() => C(), realm.TypeError);
    for (const connected of [false, true]) {
      const element = connected ? realm.document.createElement('style') : null;
      const text = `
        @starting-style { .first { color: red; } }
        @media all { @starting-style { .inner { color: green; } } }
        .nested { @starting-style { color: blue; & .desc { color: red; } opacity: 0; } }
      `;
      if (element) { element.textContent = text; realm.document.head.append(element); }
      const sheet = element ? element.sheet : new realm.CSSStyleSheet();
      if (!element) sheet.replaceSync(text);
      const rule = sheet.cssRules[0], list = rule.cssRules, first = list[0];
      check(rule, realm, sheet);
      equal(first.style.color, 'red', 'parsed declaration');
      equal(first.parentRule, rule, 'child parent');
      equal(first.parentStyleSheet, sheet, 'child sheet');
      equal(Object.getPrototypeOf(list), realm.CSSRuleList.prototype, 'list realm');
      const insert = CSSGroupingRule.prototype.insertRule;
      const remove = CSSGroupingRule.prototype.deleteRule;
      equal(insert.call(rule, '.second { color: blue; }', 1), 1, 'cross-realm insertion');
      const second = list[1];
      equal(Object.getPrototypeOf(second), realm.CSSStyleRule.prototype, 'inserted child realm');
      equal(list[0], first, 'untouched rule identity');
      equal(second.parentRule, rule, 'inserted child parent');
      remove.call(rule, 0);
      equal(rule.cssRules, list, 'list after deletion');
      equal(list[0], second, 'shifted identity');
      equal(first.parentRule, null, 'removed child parent');
      equal(first.parentStyleSheet, null, 'removed child sheet');
      throws(() => insert.call(rule, '???', 2), DOMException, 'IndexSizeError');
      throws(() => insert.call(rule, '???', 0), DOMException, 'SyntaxError');
      throws(() => insert.call(rule, '@import url("ignored.css");', 0), DOMException, 'HierarchyRequestError');
      throws(() => remove.call(rule, 5), DOMException, 'IndexSizeError');
      equal(list.length, 1, 'failed mutations leave children intact');
      const media = sheet.cssRules[1];
      check(media.cssRules[0], realm, sheet, media);
      const styleRule = sheet.cssRules[2], nested = styleRule.cssRules[0];
      check(nested, realm, sheet, styleRule);
      equal(nested.cssRules.length, 3, 'nested declarations and rule');
      equal(nested.cssRules[0].style.color, 'blue', 'leading nested declaration');
      equal(nested.cssRules[2].style.opacity, '0', 'trailing nested declaration');
      equal(insert.call(nested, '& .next { opacity: 0.5; }', 3), 3, 'nested selector context');
      equal(nested.cssRules[3].style.opacity, '0.5', 'nested inserted declaration');
      sheet.deleteRule(2);
      check(nested, realm, null, styleRule);
      equal(nested.cssRules[3].parentStyleSheet, null, 'detached nested child sheet');
      equal(nested.cssRules[3].style.opacity, '0.5', 'detached nested mutation retained');
      equal(insert.call(nested, '& .after { color: green; }', 4), 4, 'detached nested selector context');
      equal(nested.cssRules[0].style.color, 'blue', 'detached nested leading declaration');
      equal(nested.cssRules[3].style.opacity, '0.5', 'detached nested existing declaration');
      equal(nested.cssRules[4].style.color, 'green', 'detached nested inserted declaration');
      sheet.deleteRule(0);
      check(rule, realm, null);
      equal(rule.cssRules, list, 'removed group retains list');
      equal(second.parentRule, rule, 'removed group retains child relationship');
      equal(second.parentStyleSheet, null, 'removed subtree sheet');
      equal(insert.call(rule, '@starting-style { .late { color: green; } }', 1), 1, 'detached insertion');
      check(list[1], realm, null, rule);
      equal(list[1].cssRules[0].style.color, 'green', 'detached nested declaration');
      remove.call(rule, 0);
      equal(rule.cssRules.length, 1, 'detached deletion');
      if (element) element.remove();
    }
    const lazySheet = new realm.CSSStyleSheet();
    lazySheet.replaceSync('@starting-style { @starting-style { .lazy { color: blue; } } }');
    const lazy = lazySheet.cssRules[0];
    lazySheet.deleteRule(0);
    check(lazy, realm, null);
    check(lazy.cssRules[0], realm, null, lazy);
    equal(lazy.cssRules[0].cssRules[0].style.color, 'blue', 'lazy detached snapshot');
    for (const prelude of ['@layer detached', '@scope (.host)']) {
      const sheet = new realm.CSSStyleSheet();
      sheet.replaceSync(`${prelude} { .child { color: red; } }`);
      const group = sheet.cssRules[0], list = group.cssRules, child = list[0];
      equal(group.type, 0, 'other new rule kinds share the legacy value');
      sheet.deleteRule(0);
      equal(child.parentStyleSheet, null, 'detached grouping child sheet');
      equal(child.parentRule, group, 'detached grouping child parent');
      equal(group.cssRules, list, 'detached grouping list identity');
      equal(group.insertRule('.added {}', 1), 1, 'detached grouping insertion');
      equal(list[1].parentRule, group, 'detached grouping inserted parent');
      equal(list[1].parentStyleSheet, null, 'detached grouping inserted sheet');
    }
  }
  const original = CSSStartingStyleRule;
  try {
    globalThis.CSSStartingStyleRule = function Fake() {};
    const sheet = new CSSStyleSheet(); sheet.replaceSync('@starting-style {}');
    equal(Object.getPrototypeOf(sheet.cssRules[0]), original.prototype, 'intrinsic prototype');
  } finally { globalThis.CSSStartingStyleRule = original; }
  return true;
})()
