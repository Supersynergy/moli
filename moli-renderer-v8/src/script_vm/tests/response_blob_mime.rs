use super::*;

#[test]
fn body_blob_mime_uses_the_shared_header_list_parser() {
    let mut vm = new_storage_test_vm("https://body-blob-mime.test/");
    vm.eval(r#"
      globalThis.blobMimeResult = null;
      (async () => {
        const cases = [
          [[], ''],
          [['', 'text/plain'], 'text/plain'],
          [['text/plain', ''], 'text/plain'],
          [['text/plain', 'text/html'], 'text/html'],
          [['TEXT/PLAIN;Charset=GBK', 'text/plain'], 'text/plain;charset=GBK'],
          [['text/html', '*/*'], 'text/html'],
          [['text/html; x="A,b"'], 'text/html;x="A,b"'],
          [['invalid'], ''],
          [['*/*'], '']
        ];
        for (const kind of ['Request', 'Response']) {
          for (const [values, expected] of cases) {
            const headers = values.map(value => ['Content-Type', value]);
            const bytes = new Uint8Array([1, 2, 3]);
            const body = kind === 'Request'
              ? new Request('https://body-blob-mime.test/', {method:'POST', body:bytes, headers})
              : new Response(bytes, {headers});
            const before = body.headers.get('Content-Type');
            const blob = await body.blob();
            if (blob.type !== expected || blob.size !== 3 || body.headers.get('Content-Type') !== before)
              throw new Error(kind + ' ' + JSON.stringify(values) + ': ' + blob.type);
          }
        }
        return 'passed';
      })().then(value => blobMimeResult = value, error => blobMimeResult = String(error));
    "#).unwrap();
    for _ in 0..64 {
        if vm.eval("String(blobMimeResult !== null)").unwrap() == "true" {
            break;
        }
    }
    assert_eq!(vm.eval("blobMimeResult").unwrap(), "passed");
}
