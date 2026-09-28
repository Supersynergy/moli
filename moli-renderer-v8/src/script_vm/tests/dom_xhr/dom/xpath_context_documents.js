(() => {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const htmlNS = 'http://www.w3.org/1999/xhtml';
  const xml = document.implementation.createDocument(htmlNS, 'html');
  const html = document.implementation.createHTMLDocument('XPath');
  const contexts = [xml, html];
  for (const evaluator of [document, xml, html, new XPathEvaluator()]) {
    for (const context of contexts) {
      const result = evaluator.evaluate('//html', context, null, 7);
      const expected = context === html ? [html.documentElement] : [];
      check(result.snapshotLength === expected.length, 'context document controls HTML matching');
      if (expected.length) {
        check(result.snapshotItem(0) === expected[0], 'context document controls node identity');
      }
      const namespaced = evaluator.evaluate('//h:html', context, () => htmlNS, 7);
      check(namespaced.snapshotLength === 1, 'explicit namespace matches both document types');
      check(namespaced.snapshotItem(0) === context.documentElement, 'explicit namespace returns context tree');
    }
  }

  const mixedCase = new DOMParser().parseFromString('<root><UPPER/><upper/></root>', 'text/xml');
  for (const name of ['UPPER', 'upper']) {
    const result = document.evaluate('//' + name, mixedCase, null, 7);
    check(result.snapshotLength === 1, 'XML local names remain case sensitive');
    check(result.snapshotItem(0).localName === name, 'HTML evaluator must preserve XML name case');
  }

  const source = new DOMParser().parseFromString('<root/>', 'text/xml');
  const target = new DOMParser().parseFromString('<root/>', 'text/xml');
  const moved = source.createElementNS('urn:items', 'item');
  source.documentElement.appendChild(moved);
  const existing = target.createElementNS('urn:items', 'item');
  target.documentElement.appendChild(existing);
  let calls = 0;
  const result = document.evaluate('//p:item', moved, () => {
    calls++;
    target.documentElement.appendChild(target.adoptNode(moved));
    return 'urn:items';
  }, 7);
  check(calls === 1, 'namespace resolver runs once for one prefix occurrence');
  check(result.snapshotLength === 2, 'evaluation observes tree after resolver mutation');
  check(result.snapshotItem(0) === existing && result.snapshotItem(1) === moved,
        'resolver adoption changes the context tree before evaluation');

  const iterator = document.evaluate('//p:item', target, () => 'urn:items');
  check(iterator.iterateNext() === existing, 'iterator reads context document');
  target.documentElement.appendChild(target.createElement('new'));
  check(iterator.invalidIteratorState, 'context document mutation invalidates iterator');
  let invalidated = false;
  try { iterator.iterateNext(); } catch (error) { invalidated = error.name === 'InvalidStateError'; }
  check(invalidated, 'invalidated iterator throws');

  for (const createDocument of [
    () => new DOMParser().parseFromString('<root/>', 'text/xml'),
    () => document.implementation.createDocument(null, 'root'),
    () => document.implementation.createHTMLDocument('')
  ]) {
    const doc = createDocument();
    const unrelated = createDocument();
    const unrelatedIterator = document.evaluate('//*', unrelated);
    const parent = doc.documentElement;
    const node = parent.appendChild(doc.createElement('item'));
    const text = node.appendChild(doc.createTextNode('before'));
    for (const [name, mutate] of [
      ['append', () => parent.appendChild(doc.createElement('next'))],
      ['attribute', () => node.setAttribute('key', 'value')],
      ['character data', () => { text.data = 'after'; }],
      ['replace', () => parent.replaceChild(doc.createElement('replacement'), node)],
      ['remove', () => parent.removeChild(parent.lastChild)]
    ]) {
      const iterator = document.evaluate('//*', doc);
      const snapshot = document.evaluate('//*', doc, null, 7);
      const first = snapshot.snapshotItem(0);
      mutate();
      check(iterator.invalidIteratorState, name + ' invalidates its document iterator');
      check(!unrelatedIterator.invalidIteratorState, name + ' preserves unrelated document iterator');
      check(!snapshot.invalidIteratorState && snapshot.snapshotItem(0) === first,
            name + ' preserves prior snapshot');
    }
  }
  return true;
})()
