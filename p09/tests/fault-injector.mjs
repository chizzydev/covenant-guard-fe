// Test-only preload. Production startup never imports this module.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const append=fs.appendFileSync;
fs.appendFileSync=function(path,data,...rest){
  const marker=process.env.P09_TEST_FAULT_MARKER;
  if(marker&&fs.existsSync(marker)&&String(data).includes('"kind":"transaction"')) {
    if(fs.readFileSync(marker,'utf8')==='partial')append.call(fs,path,String(data).slice(0,30),...rest);
    throw Object.assign(Error('P09 injected post-execution append failure'),{code:'EIO'});
  }
  return append.call(fs,path,data,...rest);
};
syncBuiltinESMExports();
