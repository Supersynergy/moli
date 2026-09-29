(() => {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const sameNodes = (actual, expected) =>
    actual.length === expected.length && expected.every((node, i) => actual[i] === node);
  const frame = globalThis.__observerCallbackFrame || document.querySelector("iframe");
  const documents = [
    ["main", document],
    ["HTML", document.implementation.createHTMLDocument("")],
    ["XML", document.implementation.createDocument(null, "root")],
    ["parsed HTML", new DOMParser().parseFromString("<body></body>", "text/html")],
    ["parsed XML", new DOMParser().parseFromString("<root/>", "application/xml")],
    ["iframe", frame.contentDocument],
  ];
  const failures = [];
  function run(label, callback) {
    try { callback(); }
    catch (error) { failures.push(label + ": " + error.message); }
  }
  function record(record, target, added, removed, previous, next) {
    check(record.type === "childList" && record.target === target, "record type and target");
    check(sameNodes(record.addedNodes, added), "addedNodes");
    check(sameNodes(record.removedNodes, removed), "removedNodes");
    check(record.previousSibling === previous && record.nextSibling === next, "sibling boundaries");
  }
  for (const [name, owner] of documents) {
    for (const fragmentParent of [false, true]) {
      for (const operation of ["appendChild", "insertBefore", "prepend", "before", "after"]) {
        for (const empty of [false, true]) {
          run([name, fragmentParent ? "fragment" : "element", operation, empty].join("/"), () => {
            const parent = fragmentParent ? owner.createDocumentFragment() : owner.createElement("host");
            const left = parent.appendChild(owner.createComment("left"));
            const right = parent.appendChild(owner.createComment("right"));
            const fragment = owner.createDocumentFragment();
            const nodes = empty ? [] : [owner.createElement("one"), owner.createTextNode("two"), owner.createComment("three")];
            nodes.forEach(node => fragment.appendChild(node));
            const parentChildren = parent.childNodes;
            const fragmentChildren = fragment.childNodes;
            const range = owner.createRange();
            range.setStart(parent, 1);
            range.setEnd(parent, 2);
            const fragmentRange = owner.createRange();
            fragmentRange.selectNodeContents(fragment);
            const iterator = empty && !fragmentParent ? owner.evaluate(
              "*", parent, null, XPathResult.UNORDERED_NODE_ITERATOR_TYPE, null
            ) : null;
            const observer = new MutationObserver(() => {});
            observer.observe(fragment, {childList: true});
            observer.observe(parent, {childList: true});
            try {
              let previous = left, next = right;
              if (operation === "appendChild") {
                check(parent.appendChild(fragment) === fragment, "appendChild return value");
                previous = right; next = null;
              } else if (operation === "insertBefore") {
                check(parent.insertBefore(fragment, right) === fragment, "insertBefore return value");
              } else if (operation === "prepend") {
                parent.prepend(fragment);
                previous = null; next = left;
              } else if (operation === "before") {
                right.before(fragment);
              } else {
                left.after(fragment);
              }
              const records = observer.takeRecords();
              check(records.length === (empty ? 0 : 2), "expected " + (empty ? 0 : 2) + " records, got " + records.length);
              if (!empty) {
                record(records[0], fragment, [], nodes, null, null);
                record(records[1], parent, nodes, [], previous, next);
              }
              const expected = operation === "appendChild" ? [left, right, ...nodes] :
                operation === "prepend" ? [...nodes, left, right] : [left, ...nodes, right];
              check(sameNodes(parentChildren, expected), "cached parent childNodes");
              check(fragmentChildren.length === 0, "cached fragment childNodes");
              check(fragmentRange.startOffset === 0 && fragmentRange.endOffset === 0, "fragment range collapses");
              const start = operation === "prepend" ? 1 + nodes.length : 1;
              const end = operation === "appendChild" ? 2 : 2 + nodes.length;
              check(range.startContainer === parent && range.startOffset === start &&
                    range.endContainer === parent && range.endOffset === end, "parent range offsets");
              if (iterator) check(!iterator.invalidIteratorState, "empty insertion preserves XPath iterator");
              check(nodes.every(node => node.parentNode === parent && node.ownerDocument === owner), "node parent and owner");
              if (!empty) {
                parent.removeChild(nodes[0]);
                check(sameNodes(records[1].addedNodes, nodes), "record remains a static snapshot");
              }
            } finally { observer.disconnect(); }
          });
        }
      }
    }
    run(name + "/invalid empty insertion", () => {
      const parent = owner.createElement("host");
      const fragment = owner.createDocumentFragment();
      for (const [target, reference, expected] of [
        [owner.createTextNode("leaf"), null, "HierarchyRequestError"],
        [parent, owner.createComment("foreign"), "NotFoundError"],
      ]) {
        let error;
        try { target.insertBefore(fragment, reference); } catch (caught) { error = caught; }
        check(error && error.name === expected, "empty fragment still validates insertion");
      }
    });
    if (owner.defaultView === null) run(name + "/invalid document insertion", () => {
      const fragment = owner.createDocumentFragment();
      const nodes = [owner.createElement("one"), owner.createElement("two")];
      nodes.forEach(node => fragment.appendChild(node));
      const observer = new MutationObserver(() => {});
      observer.observe(fragment, {childList: true});
      observer.observe(owner, {childList: true});
      try {
        let error;
        try { owner.appendChild(fragment); } catch (caught) { error = caught; }
        check(error && error.name === "HierarchyRequestError", "invalid tree rejected");
        check(sameNodes(fragment.childNodes, nodes), "invalid insertion preserves fragment");
        check(observer.takeRecords().length === 0, "invalid insertion queues no records");
      } finally { observer.disconnect(); }
    });
    run(name + "/adoption", () => {
      const source = document.implementation.createHTMLDocument("");
      const fragment = source.createDocumentFragment();
      const nodes = [source.createElement("one"), source.createTextNode("two")];
      nodes.forEach(node => fragment.appendChild(node));
      const parent = owner.createElement("host");
      const observer = new MutationObserver(() => {});
      observer.observe(fragment, {childList: true});
      observer.observe(parent, {childList: true});
      try {
        parent.appendChild(fragment);
        const records = observer.takeRecords();
        check(records.length === 2, "adoption keeps two records, got " + records.length);
        record(records[0], fragment, [], nodes, null, null);
        record(records[1], parent, nodes, [], null, null);
        check(fragment.ownerDocument === source && nodes.every(node => node.ownerDocument === owner), "adopt children and retain fragment owner");
      } finally { observer.disconnect(); }
    });
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return true;
})()
