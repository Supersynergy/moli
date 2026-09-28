(() => {
  function assert(value, message) { if (!value) throw new Error(message); }
  function throws(C, fn, message) {
    try { fn(); } catch (error) { assert(error instanceof C, message + ': ' + error); return; }
    throw new Error(message + ': did not throw');
  }
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const child = iframe.contentWindow;
  try {
    for (const realm of [window, child]) {
      const originalNavigator = realm.navigator;
      const navigatorDescriptor = Object.getOwnPropertyDescriptor(realm, 'navigator');
      const alias = Object.getOwnPropertyDescriptor(realm, 'clientInformation');
      assert(alias.enumerable && alias.configurable && typeof alias.get === 'function' && typeof alias.set === 'function', 'clientInformation descriptor');
      assert(realm.clientInformation === originalNavigator, 'Navigator identity');
      Object.defineProperty(realm, 'navigator', {configurable: true, value: 42});
      assert(realm.clientInformation === originalNavigator, 'alias ignores public navigator shadow');
      realm.clientInformation = {replacement: true};
      const replaced = Object.getOwnPropertyDescriptor(realm, 'clientInformation');
      assert(replaced.writable && replaced.configurable && replaced.enumerable && !replaced.get && replaced.value.replacement, 'Replaceable alias');
      assert(alias.get.call(realm) === originalNavigator, 'retained alias getter keeps association');
      Object.defineProperty(realm, 'clientInformation', alias);
      Object.defineProperty(realm, 'navigator', navigatorDescriptor);

      const external = realm.external;
      const descriptor = Object.getOwnPropertyDescriptor(realm, 'external');
      assert(external === realm.external && external instanceof realm.External, 'External SameObject');
      assert(Object.getPrototypeOf(external) === realm.External.prototype && Object.prototype.toString.call(external) === '[object External]', 'External prototype and brand');
      assert(descriptor.enumerable && descriptor.configurable && typeof descriptor.get === 'function' && typeof descriptor.set === 'function', 'external descriptor');
      throws(realm.TypeError, () => new realm.External(), 'External illegal constructor');
      throws(realm.TypeError, () => realm.External(), 'External requires native creation');
      const hostile = {toString() {throw new Error('conversion');},valueOf() {throw new Error('conversion');}};
      for (const name of ['AddSearchProvider', 'IsSearchProviderInstalled']) {
        const method = Object.getOwnPropertyDescriptor(realm.External.prototype, name);
        assert(method.writable && method.enumerable && method.configurable && method.value.length === 0 && method.value.name === name, name + ' descriptor');
        assert(method.value.call(external, hostile) === undefined, name + ' ignores arguments');
        assert(method.value.call(window.external) === undefined, name + ' cross-realm brand');
        let traps = 0;
        const proxy = new Proxy(external, {get(){traps++;throw new Error('trap');},getPrototypeOf(){traps++;throw new Error('trap');}});
        const revoked = Proxy.revocable(external, {}); revoked.revoke();
        for (const fake of [{},Object.create(external),proxy,revoked.proxy,originalNavigator]) {
          throws(realm.TypeError, () => method.value.call(fake, hostile), name + ' receiver');
        }
        assert(traps === 0, name + ' must not inspect author Proxy');
      }
      realm.external = 21;
      const externalReplacement = Object.getOwnPropertyDescriptor(realm, 'external');
      assert(externalReplacement.value === 21 && externalReplacement.writable && externalReplacement.enumerable && externalReplacement.configurable, 'Replaceable external');
      assert(descriptor.get.call(realm) === external, 'retained external identity');
      Object.defineProperty(realm, 'external', descriptor);
      for (const property of ['clientInformation','external']) {
        const getter = Object.getOwnPropertyDescriptor(realm,property).get;
        throws(realm.TypeError, () => getter.call({}), property + ' Window receiver');
        assert(getter.call(window) === window[property], property + ' cross-realm Window receiver');
      }
    }
    assert(child.external !== window.external && child.clientInformation !== window.clientInformation, 'per-Window identity');
    const navigator = child.clientInformation;
    const external = child.external;
    iframe.remove();
    assert(child.clientInformation === navigator && child.external === external, 'detachment retains identity');
    return true;
  } finally { iframe.remove(); }
})()
