#!/usr/bin/env node
// Fail closed if the checkout contains a source file that was not in the
// approved release manifest. Generated runtime outputs are excluded.
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,relative,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=readFileSync(join(root,'MANIFEST_SHA256.txt'),'utf8').trim().split(/\r?\n/);
const expected=new Map();
for(const line of manifest){
  const match=/^([0-9A-F]{64})  ([A-Za-z0-9_.\/-]+)$/.exec(line);
  if(!match)throw Error('INVALID_SOURCE_MANIFEST');
  if(expected.has(match[2])||match[2].startsWith('/')||match[2].split('/').includes('..'))throw Error('UNSAFE_SOURCE_MANIFEST');
  expected.set(match[2],match[1]);
}
const skip=new Set(['.git','results','artifacts','node_modules','__pycache__']);
const actual=new Map();
function walk(dir){
  for(const ent of readdirSync(dir,{withFileTypes:true})){
    if(ent.name === '.DS_Store')throw Error('UNEXPECTED_SOURCE=.DS_Store');
    const full=join(dir,ent.name);
    const rel=relative(root,full).replaceAll('\\','/');
    if(ent.isSymbolicLink())throw Error('SOURCE_SYMLINK_DISALLOWED='+rel);
    if(ent.isDirectory()){
      if(skip.has(ent.name))continue;
      walk(full);
    }else if(ent.isFile()){
      if(ent.name.endsWith('.pyc'))continue;
      if(rel==='MANIFEST_SHA256.txt')continue;
      const hash=createHash('sha256').update(readFileSync(full)).digest('hex').toUpperCase();
      actual.set(rel,hash);
    }else throw Error('UNEXPECTED_SOURCE_TYPE='+rel);
  }
}
walk(root);
for(const [path,hash] of expected){
  if(!actual.has(path))throw Error('MISSING_RELEASE_SOURCE='+path);
  if(actual.get(path)!==hash)throw Error('SOURCE_HASH_MISMATCH='+path);
}
for(const path of actual.keys())if(!expected.has(path))throw Error('UNLISTED_RELEASE_SOURCE='+path);
console.log('P08_CI_SOURCE_INVENTORY='+expected.size);
console.log('P08_CI_SOURCE_MANIFEST=PASS');
console.log('P08_CI_UNEXPECTED_SOURCE=NONE');
