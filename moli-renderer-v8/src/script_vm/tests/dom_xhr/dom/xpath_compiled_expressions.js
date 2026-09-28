(() => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const throws = (callback, name, Constructor = Error) => {
    let caught;
    try { callback(); } catch (e) { caught = e; }
    check(caught && caught.name === name && caught instanceof Constructor, name + ' required');
  };
  check(XPathExpression.name === 'XPathExpression' && XPathExpression.length === 0, 'constructor metadata');
  throws(() => XPathExpression(), 'TypeError', TypeError);
  throws(() => new XPathExpression(), 'TypeError', TypeError);
  check(document.createExpression.length === 1 && XPathEvaluator.prototype.createExpression.length === 1,
        'createExpression required argument count');
  check(Document.prototype.evaluate.length === 2 && XPathEvaluator.prototype.evaluate.length === 2,
        'uncompiled evaluate required argument count');
  check(XPathExpression.prototype.evaluate.length === 1, 'evaluate required argument count');
  const descriptor = Object.getOwnPropertyDescriptor(XPathExpression.prototype, 'evaluate');
  check(descriptor.enumerable && descriptor.configurable && descriptor.writable, 'evaluate descriptor');

  const xml = new DOMParser().parseFromString('<root xmlns:p="urn:items"><p:item>4</p:item><p:other>6</p:other><UPPER/></root>', 'text/xml');
  const evaluator = new XPathEvaluator();
  let conversions = 0, calls = 0;
  const resolver = {lookupNamespaceURI(prefix) {calls++; check(prefix === 'p', 'prefix'); return 'urn:items';}};
  const compiled = evaluator.createExpression({toString() {conversions++;return '//p:item | //p:other';}}, resolver);
  check(conversions === 1 && calls === 2, 'resolve namespaces while compiling');
  resolver.lookupNamespaceURI = () => {throw new Error('resolver must not be retained');};
  check(Object.getPrototypeOf(compiled) === XPathExpression.prototype, 'native prototype');
  check(Object.prototype.toString.call(compiled) === '[object XPathExpression]', 'native tag');
  check(Object.keys(compiled).length === 0, 'expression has no public state');
  check(document.createExpression('1') !== document.createExpression('1'), 'NewObject');
  const first = compiled.evaluate(xml, 7);
  check(first.snapshotLength === 2 && first.snapshotItem(0) === xml.documentElement.firstChild, 'snapshot result');
  check(compiled.evaluate(xml, 1).numberValue === 4, 'numeric conversion');
  check(compiled.evaluate(xml, 2).stringValue === '4', 'string conversion');
  check(compiled.evaluate(xml, 3).booleanValue, 'boolean conversion');
  check(compiled.evaluate(xml, 9).singleNodeValue === xml.documentElement.firstChild, 'single-node conversion');
  check(compiled.evaluate(xml).iterateNext() === xml.documentElement.firstChild, 'default iterator result');
  check(calls === 2 && conversions === 1, 'evaluation uses compiled expression');
  check(document.createExpression('//UPPER').evaluate(xml, 7).snapshotLength === 1, 'XML case is preserved');

  const htmlNS = 'http://www.w3.org/1999/xhtml';
  const xmlHtml = document.implementation.createDocument(htmlNS, 'html');
  const html = document.implementation.createHTMLDocument();
  for (const creator of [document, xmlHtml, html, evaluator]) {
    const expression = creator.createExpression('//html');
    check(expression.evaluate(xmlHtml, 7).snapshotLength === 0, 'XML namespace matching');
    check(expression.evaluate(html, 7).snapshotItem(0) === html.documentElement, 'HTML namespace matching');
  }
  for (const run of [
    (source, context, type) => document.evaluate(source, context, null, type),
    (source, context, type) => evaluator.evaluate(source, context, null, type),
    (source, context, type) => document.createExpression(source).evaluate(context, type)
  ]) {
    for (const context of [xml, document]) {
      check(run('1 + 2', context).numberValue === 3, 'default numeric result type');
      check(run('false()', context).booleanValue === false, 'default boolean result type');
      check(run('"text"', context).stringValue === 'text', 'default string result type');
      check(run('false()', context, 1).numberValue === 0, 'boolean to number');
      check(run('3', context, 2).stringValue === '3', 'number to string');
      check(run('0', context, 3).booleanValue === false, 'number to boolean');
      for (const type of [4, 5, 6, 7, 8, 9]) {
        throws(() => run('3', context, type), 'TypeError', TypeError);
      }
      check(run('//absent', context, 2).stringValue === '', 'empty nodes to string');
      check(Number.isNaN(run('//absent', context, 1).numberValue), 'empty nodes to number');
    }
    check(run('//root/*', xml, 1).numberValue === 4, 'node-set to number');
    check(run('//root/*', xml, 2).stringValue === '4', 'node-set to string');
  }

  const iterator = compiled.evaluate(xml);
  const another = xml.createElementNS('urn:items', 'p:item');
  xml.documentElement.appendChild(another);
  check(iterator.invalidIteratorState, 'mutation invalidates compiled expression iterator');
  check(compiled.evaluate(xml, 7).snapshotLength === 3, 're-evaluation sees current DOM');
  check(first.snapshotLength === 2, 'prior snapshot stays stable');
  check(document.createExpression('1 + 2').evaluate(document).numberValue === 3, 'scalar default type');
  throws(() => evaluator.createExpression('//*['), 'SyntaxError', DOMException);
  throws(() => document.createExpression('//unresolved:item'), 'NamespaceError', DOMException);
  throws(() => compiled.evaluate(), 'TypeError', TypeError);
  check(compiled.evaluate(xml, 65536).resultType === 4, 'result type uses WebIDL unsigned short conversion');
  for (const receiver of [{}, Object.create(compiled), Object.create(XPathExpression.prototype), new Proxy(compiled, {})]) {
    let converted = false;
    throws(() => XPathExpression.prototype.evaluate.call(receiver, document, {valueOf() {converted=true;return 0;}}), 'TypeError', TypeError);
    check(!converted, 'receiver check precedes type conversion');
  }
  let traps = 0;
  const revoked = Proxy.revocable(xml, {});revoked.revoke();
  const forged = Object.defineProperty({}, 'nodeType', {get() {traps++;return 9;}});
  for (const context of [forged, Object.create(xml), new Proxy(xml, {get() {traps++;throw Error('trap');}}), revoked.proxy]) {
    throws(() => compiled.evaluate(context), 'TypeError', TypeError);
  }
  check(traps === 0, 'native Node brand check does not run author getters or Proxy traps');
  for (const [method, real] of [[Document.prototype.createExpression, document], [XPathEvaluator.prototype.createExpression, evaluator]]) {
    for (const receiver of [{}, Object.create(real), new Proxy(real, {})]) {
      let converted = false;
      throws(() => method.call(receiver, {toString() {converted=true;return '1';}}), 'TypeError', TypeError);
      check(!converted, 'createExpression receiver check precedes conversion');
    }
  }
  const SavedExpression = XPathExpression;
  const SavedResult = XPathResult;
  try {
    globalThis.XPathExpression = function FakeExpression() {};
    globalThis.XPathResult = function FakeResult() {};
    const expression = document.createExpression('3');
    check(Object.getPrototypeOf(expression) === SavedExpression.prototype, 'intrinsic expression prototype');
    check(expression.evaluate(document) instanceof SavedResult, 'intrinsic result prototype');
  } finally {
    globalThis.XPathExpression = SavedExpression;
    globalThis.XPathResult = SavedResult;
  }
  Object.freeze(compiled);
  check(compiled.evaluate(xml, 7).snapshotLength === 3, 'frozen wrapper preserves compiled state');

  const exception = {};
  let caught;
  try { document.createExpression({toString() {throw exception;}}); } catch (e) {caught=e;}
  check(caught === exception, 'expression conversion preserves abrupt completion');
  const conversionOrder = [];
  const noPrefix = document.createExpression({toString() {conversionOrder.push('expression');return '1';}}, {get lookupNamespaceURI() {throw Error('unused resolver getter');}});
  check(conversionOrder.join() === 'expression' && noPrefix.evaluate(document).numberValue === 1, 'unused resolver is not invoked');

  const frame = document.createElement('iframe');document.body.appendChild(frame);
  const other = frame.contentWindow;
  const foreign = other.document.createExpression('count(//body)');
  check(foreign instanceof other.XPathExpression && !(foreign instanceof XPathExpression), 'expression relevant realm');
  check(foreign.evaluate(document) instanceof other.XPathResult, 'result relevant realm');
  check(other.Document.prototype.createExpression.call(document, '1') instanceof XPathExpression, 'creator receiver determines realm');
  check(other.XPathExpression.prototype.evaluate.call(compiled, xml) instanceof XPathResult, 'expression receiver determines result realm');
  throws(() => other.XPathExpression.prototype.evaluate.call({}, document), 'TypeError', other.TypeError);
  frame.remove();
  check(foreign.evaluate(document).numberValue === 1, 'compiled expression survives creator frame removal');
  return true;
})()
