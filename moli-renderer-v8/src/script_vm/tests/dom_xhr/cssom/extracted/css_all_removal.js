(() => {
  'use strict';
  const equal = (actual, expected, label) => {
    if (!Object.is(actual, expected)) throw new Error(label);
  };
  const other = document.getElementById('child').contentWindow;
  const elements = [
    document.createElement('div'),
    document.createElementNS('http://www.w3.org/2000/svg', 'g'),
    document.createElementNS('http://www.w3.org/1998/Math/MathML', 'mi'),
    document.implementation.createHTMLDocument('').createElement('select'),
    other.document.createElement('div'),
  ];
  const sheets = [new CSSStyleSheet(), new other.CSSStyleSheet()];
  for (const sheet of sheets) sheet.replaceSync('div {}');
  const keyframes = new CSSStyleSheet();
  keyframes.replaceSync('@keyframes test { from {} }');
  const styles = [
    ...elements.map(element => element.style),
    ...sheets.map(sheet => sheet.cssRules[0].style),
    keyframes.cssRules[0].cssRules[0].style,
  ];
  for (const [index, style] of styles.entries()) {
    for (const value of ['initial', 'inherit', 'unset', 'revert', 'revert-layer']) {
      style.cssText = '';
      style.setProperty('all', value, index === 7 ? '' : 'important');
      equal(style.getPropertyValue('all'), value, `${index}: initial declaration`);
      equal(style.removeProperty('all'), value, `${index}: removed value`);
      equal(style.getPropertyValue('all'), '', `${index}: removed declaration`);
      equal(style.getPropertyPriority('all'), '', `${index}: removed priority`);
      equal(style.length, 0, `${index}: no property names`);
      equal(style.cssText, '', `${index}: no serialization`);
      equal(style.removeProperty('all'), '', `${index}: repeated removal`);
    }
    style.cssText = 'all: inherit; margin-left: 1px; direction: rtl; unicode-bidi: isolate; --token: kept';
    equal(style.removeProperty('all'), '', `${index}: overridden shorthand`);
    equal(style.getPropertyValue('all'), '', `${index}: shorthand gone`);
    equal(style.getPropertyValue('margin-left'), '', `${index}: longhand gone`);
    equal(style.getPropertyValue('direction'), 'rtl', `${index}: direction preserved`);
    equal(style.getPropertyValue('unicode-bidi'), 'isolate', `${index}: bidi preserved`);
    equal(style.getPropertyValue('--token'), 'kept', `${index}: custom property preserved`);
    equal(style.length, 3, `${index}: only exempt properties remain`);
  }
  return true;
})()
