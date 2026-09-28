(() => {
  'use strict';
  const equal = (actual, expected, label) => {
    if (!Object.is(actual, expected)) throw new Error(`${label}: ${actual} !== ${expected}`);
  };
  const throws = (callback, realm) => {
    try { callback(); } catch (error) {
      equal(Object.getPrototypeOf(error), realm.TypeError.prototype, 'TypeError realm');
      return;
    }
    throw new Error('missing TypeError');
  };
  const other = document.getElementById('child').contentWindow;
  const properties = ['name', 'fontFamily', 'basePalette', 'overrideColors'];
  const values = rule => properties.map(property => rule[property]);
  const check = (rule, realm, sheet, parent = null) => {
    equal(Object.getPrototypeOf(rule), realm.CSSFontPaletteValuesRule.prototype, 'rule realm');
    equal(rule instanceof realm.CSSRule, true, 'CSSRule inheritance');
    equal(rule instanceof realm.CSSGroupingRule, false, 'not a grouping rule');
    equal(Object.prototype.toString.call(rule), '[object CSSFontPaletteValuesRule]', 'tag');
    equal(rule.type, 0, 'no legacy rule type');
    equal(rule.parentStyleSheet, sheet, 'parent sheet');
    equal(rule.parentRule, parent, 'parent rule');
    equal('style' in rule, false, 'no mutable style declaration');
  };
  for (const realm of [globalThis, other]) {
    const C = realm.CSSFontPaletteValuesRule;
    equal(typeof C, 'function', 'constructor exposed');
    equal(C.length, 0, 'constructor arity');
    equal(Object.getPrototypeOf(C), realm.CSSRule, 'constructor inheritance');
    equal(Object.getPrototypeOf(C.prototype), realm.CSSRule.prototype, 'prototype inheritance');
    throws(() => new C(), realm);
    throws(() => C(), realm);
    for (const property of properties) {
      const descriptor = Object.getOwnPropertyDescriptor(C.prototype, property);
      equal(descriptor.enumerable, true, `${property} enumerable`);
      equal(descriptor.configurable, true, `${property} configurable`);
      equal(descriptor.set, undefined, `${property} readonly`);
      equal(descriptor.get.length, 0, `${property} arity`);
      equal(descriptor.get.name, `get ${property}`, `${property} getter name`);
    }
    for (const connected of [false, true]) {
      const element = connected ? realm.document.createElement('style') : null;
      const text = `
        @font-palette-values --palette {
          font-family: Atlas, "B C";
          base-palette: 2;
          base-palette: invalid;
          override-colors: 0 #123, 4 #456;
          override-colors: 0 currentcolor;
          font-weight: bold;
        }
        @media all { @font-palette-values --nested { base-palette: dark; } }
      `;
      if (element) { element.textContent = text; realm.document.head.append(element); }
      const sheet = element ? element.sheet : new realm.CSSStyleSheet();
      if (!element) sheet.replaceSync(text);
      const rule = sheet.cssRules[0], media = sheet.cssRules[1];
      check(rule, realm, sheet);
      equal(rule.name, '--palette', 'palette name');
      equal(rule.fontFamily, 'Atlas, "B C"', 'family list');
      equal(rule.basePalette, '2', 'last valid base palette');
      equal(rule.overrideColors, '0 rgb(17, 34, 51), 4 rgb(68, 85, 102)', 'absolute colors');
      equal(rule.cssText.includes('font-weight'), false, 'unknown descriptor discarded');
      const before = JSON.stringify(values(rule));
      let conversions = 0;
      for (const property of properties) {
        equal(Reflect.set(rule, property, { toString() { conversions++; return 'changed'; } }), false, 'readonly write');
      }
      equal(conversions, 0, 'readonly assignment does not convert');
      equal(JSON.stringify(values(rule)), before, 'readonly values retained');
      sheet.insertRule('@font-palette-values --before {}', 0);
      equal(sheet.cssRules[1], rule, 'index shift preserves identity');
      equal(JSON.stringify(values(rule)), before, 'index shift preserves native read');
      sheet.deleteRule(0);
      sheet.deleteRule(0);
      check(rule, realm, null);
      equal(JSON.stringify(values(rule)), before, 'removed rule values retained');
      // Materialize a palette rule only after its enclosing group is removed.
      sheet.deleteRule(0);
      const nested = media.cssRules[0];
      check(nested, realm, null, media);
      equal(JSON.stringify(values(nested)), '["--nested","","dark",""]', 'lazy detached values');
      media.insertRule('@font-palette-values --late { base-palette: light; }', 1);
      check(media.cssRules[1], realm, null, media);
      equal(media.cssRules[1].basePalette, 'light', 'detached insertion');
      if (element) element.remove();
    }
    const sheet = new realm.CSSStyleSheet();
    sheet.replaceSync('@font-palette-values --old { base-palette: 9; } .old {}');
    const old = sheet.cssRules[0], oldStyle = sheet.cssRules[1];
    sheet.replaceSync('@font-palette-values --new {}');
    equal(Object.getPrototypeOf(old), C.prototype, 'replaced rule interface');
    equal(old.parentStyleSheet, oldStyle.parentStyleSheet, 'shared replacement lifecycle');
    equal(old.basePalette, '9', 'replaceSync freezes old rule');
    equal(sheet.cssRules[0].name, '--new', 'replacement rule');
    sheet.insertRule('@font-palette-values --escaped\\ name {}', 1);
    const escaped = sheet.cssRules[1];
    equal(escaped.name, '--escaped name', 'decoded identifier');
    sheet.deleteRule(1);
    equal(escaped.name, '--escaped name', 'detached identifier');
    realm.CSSFontPaletteValuesRule = function forged() {};
    try {
      sheet.insertRule('@font-palette-values --intrinsic {}', 1);
      equal(Object.getPrototypeOf(sheet.cssRules[1]), C.prototype, 'intrinsic prototype');
    } finally { realm.CSSFontPaletteValuesRule = C; }
  }
  return true;
})()
