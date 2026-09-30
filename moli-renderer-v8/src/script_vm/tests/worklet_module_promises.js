(async () => {
  const rows = [], assert = (ok, message) => { if (!ok) throw Error(message); };
  const check = async (name, run) => { try { await run(); rows.push({ name, pass: true }); } catch (error) { rows.push({ name, pass: false, message: String(error) }); } };
  const context = new AudioContext(), worklet = context.audioWorklet;
  const source = text => 'data:text/javascript,' + encodeURIComponent(text);
  const errors = [], onError = event => errors.push(event.message);
  addEventListener('error', onError);
  try {
    await check('pending-and-completed-module-promises', async () => {
      const url = source('registerProcessor("fresh-promise", class extends AudioWorkletProcessor {});');
      const first = worklet.addModule(url); let reads=0;
      const poison = () => {reads++; throw Error('public Promise property');};
      Object.defineProperties(first, {then:{get:poison,configurable:true}, constructor:{get:poison,configurable:true}});
      let second;
      // A second call appends a native waiter; inherited array setters must not run.
      Object.defineProperty(Array.prototype, '1', {configurable:true, set:poison});
      try {second = worklet.addModule(url);} finally {delete Array.prototype[1];delete first.then;delete first.constructor;}
      assert(reads===0 && first!==second, 'independent pending Promise without author hooks');
      const values = await Promise.all([first, second]);
      assert(values.every(value => value===undefined), 'all callers fulfilled');
      Object.defineProperties(first, {then:{get:poison,configurable:true}, constructor:{get:poison,configurable:true}});
      let third;
      try {third=worklet.addModule(url);} finally {delete first.then;delete first.constructor;}
      assert(reads===0 && third!==first && third!==second, 'independent completed Promise');
      assert(await third === undefined, 'completed response reused');
      assert(new AudioWorkletNode(context, 'fresh-promise') instanceof AudioWorkletNode, 'processor registration retained');
    });
    await check('failed-module-promises', async () => {
      const url=source('export {');
      const first=worklet.addModule(url), second=worklet.addModule(url);
      assert(first!==second, 'independent failed pending Promise');
      const results=await Promise.allSettled([first,second]);
      assert(results.every(result=>result.status==='rejected'), 'all failed waiters settle');
      const third=worklet.addModule(url);assert(third!==first && third!==second, 'independent rejected cached Promise');
      const [result]=await Promise.allSettled([third]);assert(result.status==='rejected', 'cached failure settles');
      assert(errors.length === 0, 'module rejection does not report internal Worker error on Window');
    });
    await check('offline-worklet-module', async () => {
      const offline=new OfflineAudioContext(1,1,44100);
      const url=source('registerProcessor("offline-module", class extends AudioWorkletProcessor {});');
      await offline.audioWorklet.addModule(url);
      const node=new AudioWorkletNode(offline, 'offline-module');
      assert(node instanceof AudioWorkletNode, 'offline processor registered');
      node.connect(offline.destination);
    });
  } finally {removeEventListener('error', onError);await context.close();}
  globalThis.__nodeReplacementResults={rows,failures:rows.filter(row=>!row.pass),passed:rows.filter(row=>row.pass).length,total:rows.length};
  return rows.every(row=>row.pass);
})()
