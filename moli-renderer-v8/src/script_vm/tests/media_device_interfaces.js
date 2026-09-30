(async () => {
  const rows = [], assert = (ok, message) => { if (!ok) throw Error(message); };
  const check = async (name, run) => { try { await run(); rows.push({name, pass:true}); } catch(error) {rows.push({name, pass:false, message:String(error)});} };
  const popup = open(), realms = [['main', window], ['child', document.getElementById('child').contentWindow], ['popup', popup]];
  try {
    for (const [label, w] of realms) {
      if (!w.isSecureContext) {
        await check(label + '/insecure', () => assert(!('MediaDeviceInfo' in w) && !('InputDeviceInfo' in w), 'secure globals hidden'));
        continue;
      }
      for (const name of ['MediaDeviceInfo', 'InputDeviceInfo']) {
        await check(label + '/' + name, () => {
          const C=w[name], parent=name==='InputDeviceInfo'?w.MediaDeviceInfo:w.Object;
          const d=Object.getOwnPropertyDescriptor(w,name);
          assert(typeof C==='function' && C.name===name && C.length===0,'constructor metadata');
          assert(d.writable && d.configurable && !d.enumerable,'global descriptor');
          assert(Object.getPrototypeOf(C.prototype)===parent.prototype && Object.getPrototypeOf(C)===(parent===w.Object?w.Function.prototype:parent),'native inheritance');
          assert(C.prototype.constructor===C,'prototype constructor');
          const tag=Object.getOwnPropertyDescriptor(C.prototype,Symbol.toStringTag);
          assert(tag.value===name && tag.configurable && !tag.writable && !tag.enumerable,'prototype tag');
          for(const call of [()=>C(),()=>new C()]){let error;try{call();}catch(e){error=e;}assert(error instanceof w.TypeError,'illegal constructor realm');}
        });
      }
      const entries=[['MediaDeviceInfo','deviceId',true],['MediaDeviceInfo','kind',true],['MediaDeviceInfo','label',true],['MediaDeviceInfo','groupId',true],['MediaDeviceInfo','toJSON',false],['InputDeviceInfo','getCapabilities',false]];
      for(const [owner,name,attribute] of entries) {
        await check(label+'/'+name,()=>{
          const C=w[owner],d=Object.getOwnPropertyDescriptor(C.prototype,name),fn=attribute?d.get:d.value;
          assert(typeof fn==='function' && fn.length===0 && fn.name===(attribute?'get ':'')+name,'member metadata');
          assert(d.enumerable && d.configurable && (attribute?d.set===undefined:d.writable),'member descriptor');
          let traps=0, conversions=0;const trap=()=>{traps++;throw Error('author trap');};
          const revoked=Proxy.revocable({},{});revoked.revoke();
          const ignored={toString(){conversions++;throw Error('ignored argument');}};
          for(const receiver of [null,{},C.prototype,Object.create(C.prototype),new Proxy({}, {get:trap,getPrototypeOf:trap}),revoked.proxy]){
            let error;try{fn.call(receiver,ignored);}catch(e){error=e;}
            assert(error instanceof w.TypeError,'callee TypeError for unbranded receiver');
          }
          assert(traps===0 && conversions===0,'native brand validation ignores author hooks');
        });
      }
      await check(label+'/enumeration',async()=>{
        const first=await w.navigator.mediaDevices.enumerateDevices(),second=await w.navigator.mediaDevices.enumerateDevices();
        assert(first instanceof w.Array && first!==second,'fresh native device list');
        for(const device of first){
          const parent=device.kind==='audiooutput'?w.MediaDeviceInfo:w.InputDeviceInfo;
          assert(device instanceof parent,'returned device brand');
          const json=device.toJSON();
          assert(Object.keys(json).join()==='deviceId,kind,label,groupId','default JSON fields');
          for(const key of Object.keys(json))assert(json[key]===device[key],'JSON device values');
        }
      });
    }
  } finally {popup.close();}
  globalThis.__nodeReplacementResults={rows,failures:rows.filter(r=>!r.pass),passed:rows.filter(r=>r.pass).length,total:rows.length};return rows.every(r=>r.pass);
})()
