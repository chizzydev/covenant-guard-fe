import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const expected=JSON.parse(readFileSync(resolve(root,'p07','P06_R4_FROZEN_SOURCE.json'),'utf8'));
for(const [file,digest] of Object.entries(expected)){
  const actual=createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex');
  if(actual!==digest)throw Error(`P07_P06_R4_FROZEN_SOURCE_DRIFT=${file}`);
}
console.log('P07_FROZEN_P06_R4_SOURCE=PASS');
console.log('P07_FROZEN_SOURCE_COUNT='+Object.keys(expected).length);
