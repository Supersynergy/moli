(() => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const sameNodes = (actual, expected) => actual.length === expected.length &&
    expected.every((node, index) => actual[index] === node);
  const frame = globalThis.__observerCallbackFrame || document.querySelector("iframe");
  const documents = [
    ["main", document],
    ["iframe", frame.contentDocument],
    ["HTML", document.implementation.createHTMLDocument("")],
    ["XML", document.implementation.createDocument(null, "root",
      document.implementation.createDocumentType("root", "", ""))],
    ["parsed HTML", new DOMParser().parseFromString("<!doctype html><body></body>", "text/html")],
    ["parsed XML", new DOMParser().parseFromString("<!DOCTYPE root><root/>", "application/xml")],
  ];
  const failures = [];
  function run(label, callback) {
    try { callback(); } catch (error) { failures.push(label + ": " + error.message); }
  }
  function fragment(owner, children) {
    const value = owner.createDocumentFragment();
    children.forEach(node => value.appendChild(node));
    return value;
  }
  const invalid = [
    ["second element", owner => owner.createElement("extra")],
    ["two roots", owner => fragment(owner, [owner.createElement("one"), owner.createElement("two")])],
    ["fragment root", owner => fragment(owner, [owner.createElement("extra")])],
    ["text", owner => owner.createTextNode("text")],
    ["fragment text", owner => fragment(owner, [owner.createComment("before"), owner.createTextNode("text")])],
    ["new doctype", owner => owner.implementation.createDocumentType("extra", "", "")],
    ["existing root", owner => owner.documentElement],
    ["existing doctype", owner => owner.doctype],
  ];
  for (const [name, owner] of documents) {
    for (const borrowed of [false, true]) {
      for (const method of ["appendChild", "insertBefore"]) {
        const insert = (node, reference = null) => borrowed ?
          Node.prototype[method].call(owner, node, reference) : owner[method](node, reference);
        for (const [kind, create] of invalid) {
          // Initial about:blank iframe documents do not have a doctype.
          if (kind === "existing doctype" && !owner.doctype) continue;
          run([name, borrowed, method, kind].join("/"), () => {
            const node = create(owner);
            const original = [...owner.childNodes];
            const originalParent = node.parentNode;
            const originalOwner = node.ownerDocument;
            const children = [...node.childNodes];
            const range = owner.createRange();
            range.selectNodeContents(owner);
            const observer = new MutationObserver(() => {});
            observer.observe(owner, {childList: true, subtree: true});
            observer.observe(node, {childList: true, subtree: true});
            try {
              let error;
              try { insert(node, originalParent === owner ? node : null); }
              catch (caught) { error = caught; }
              check(error && error.name === "HierarchyRequestError", "must reject invalid insertion");
              check(sameNodes(owner.childNodes, original), "document unchanged");
              check(node.parentNode === originalParent && node.ownerDocument === originalOwner, "node not removed or adopted");
              check(sameNodes(node.childNodes, children), "fragment children unchanged");
              check(observer.takeRecords().length === 0, "no mutation records");
              check(range.startContainer === owner && range.startOffset === 0 &&
                    range.endContainer === owner && range.endOffset === original.length, "range unchanged");
            } finally {
              observer.disconnect();
              for (const child of [...owner.childNodes]) {
                if (!original.includes(child)) owner.removeChild(child);
              }
              // Restore ordering even on an engine that accepts invalid moves.
              for (let i = original.length - 1; i >= 0; i--) {
                const next = original[i + 1] || null;
                if (original[i].nextSibling !== next) owner.insertBefore(original[i], next);
              }
            }
          });
        }
        run([name, borrowed, method, "allowed children"].join("/"), () => {
          const original = [...owner.childNodes];
          const comment = owner.createComment("allowed");
          const pi = owner.createProcessingInstruction("allowed", "data");
          const empty = owner.createDocumentFragment();
          try {
            check(insert(comment) === comment && insert(pi) === pi && insert(empty) === empty, "return original node");
            check(sameNodes(owner.childNodes, [...original, comment, pi]), "comment and PI are allowed");
            check(insert(comment) === comment, "moving an existing comment is allowed");
            check(sameNodes(owner.childNodes, [...original, pi, comment]), "moved comment appears once");
          } finally {
            for (const child of [...owner.childNodes]) {
              if (!original.includes(child)) owner.removeChild(child);
            }
          }
        });
      }
    }
  }
  run("failed insertion preserves foreign subtree and reactions", () => {
    const reactions = [];
    customElements.define("preinsert-reactions", class extends HTMLElement {
      disconnectedCallback() { reactions.push("disconnected"); }
      adoptedCallback() { reactions.push("adopted"); }
    });
    const node = document.body.appendChild(document.createElement("preinsert-reactions"));
    const owner = document.implementation.createHTMLDocument("");
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, {childList: true});
    observer.observe(owner, {childList: true});
    try {
      let error;
      try { Node.prototype.appendChild.call(owner, node); } catch (caught) { error = caught; }
      check(error && error.name === "HierarchyRequestError", "reject foreign second root");
      check(node.ownerDocument === document && node.parentNode === document.body, "foreign node unchanged");
      check(observer.takeRecords().length === 0 && reactions.length === 0, "no removal/adoption side effects");
    } finally { observer.disconnect(); node.remove(); }
  });
  if (failures.length) throw new Error(failures.join("\n"));
  return true;
})()
