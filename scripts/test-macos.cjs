#!/usr/bin/env node
// Reuse compiled tests in an isolated APFS target directory on macOS.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
if (process.platform !== 'darwin') throw Error('This helper requires macOS with APFS and codesign.');
// macOS needs full DWARF names for the fetch-owner backtrace regression.
const cargoConfig = ['--config', 'profile.test.package.moli-fetch.debug=2'];
const run = (cmd, args, capture=false) => {
  const r = spawnSync(cmd, args, {stdio:capture?'pipe':'inherit',encoding:'utf8',maxBuffer:64*1024*1024});
  if(r.error)throw r.error;
  if(r.status!==0)throw Error(`${cmd} failed (${r.status}): ${r.stderr||''}`);
  return r.stdout;
};
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'moli-nextest-'));
try {
  const binaries=JSON.parse(run('cargo',['nextest','list',...cargoConfig,'--build-jobs','1','--list-type','binaries-only','--message-format','json'],true));
  const metadata=run('cargo',['metadata',...cargoConfig,'--format-version','1','--locked'],true);
  const original=path.resolve(binaries['rust-build-meta']['target-directory']);
  const target=path.join(scratch,'target'),files=new Set();
  for(const b of Object.values(binaries['rust-binaries']))files.add(b['binary-path']);
  for(const group of Object.values(binaries['rust-build-meta']['non-test-binaries'])) {
    for(const b of group)if(b.kind==='bin-exe'||b.path.endsWith('.dylib'))files.add(path.resolve(original,b.path));
  }
  for(const file of files) {
    const relative=path.relative(original,path.resolve(file));
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Executable outside Cargo target: '+file);
    const dest=path.join(target,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});
    run('cp',['-c',file,dest]); // APFS clone; no full multi-GB copy fallback.
    run('codesign',['--force','--sign','-',dest]);
  }
  const binariesFile=path.join(scratch,'binaries.json'),cargoFile=path.join(scratch,'cargo.json');
  fs.writeFileSync(binariesFile,JSON.stringify(binaries));fs.writeFileSync(cargoFile,metadata);
  run('cargo',['nextest','run',...cargoConfig,'--no-fail-fast','--binaries-metadata',binariesFile,'--cargo-metadata',cargoFile,'--target-dir-remap',target,...process.argv.slice(2)]);
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
