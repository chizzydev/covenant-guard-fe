// Actual Chromium UI acceptance fallback; does not claim the unavailable IAB ran.
import assert from 'node:assert/strict';import{spawn}from'node:child_process';import{createServer}from'node:net';
import{mkdirSync,writeFileSync,rmSync}from'node:fs';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'results/p09/browser');mkdirSync(out,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.P09_PLAYWRIGHT_MODULE).href);
const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
const journal=resolve(out,'browser-audit-'+Date.now()+'.jsonl'),fault=journal+'.fault',base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['--import','./p09/tests/fault-injector.mjs','app/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),COVENANT_RUNTIME:'flagship',COVENANT_AUDIT_PATH:journal,P09_TEST_FAULT_MARKER:fault},stdio:['ignore','pipe','pipe']});
let browser;const checks=[],errors=[];
try{
 await new Promise((r,j)=>{let log='';const t=setTimeout(()=>j(Error(log)),30000);const read=b=>{log+=b;if(log.includes('COVENANT_LOCAL_EVM=READY')){clearTimeout(t);r()}};child.stdout.on('data',read);child.stderr.on('data',read);child.on('exit',c=>{clearTimeout(t);j(Error('exit '+c+log))})});
 browser=await chromium.launch({headless:true,executablePath:process.env.P09_CHROMIUM});const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 const state=async()=>await(await fetch(base+'/api/state')).json();
 const screenshot=async name=>page.screenshot({path:resolve(out,name+'.png'),fullPage:true});
 const text=async(id,value)=>{await page.locator('#'+id).fill(String(value))};
 const matches=async(id,value)=>{await page.waitForFunction(([id,v])=>document.getElementById(id)?.textContent===v,[id,String(value)])};
 async function action(button,path,expected=true){const reply=page.waitForResponse(r=>r.url()===base+path&&r.request().method()==='POST');await page.locator('#'+button).click();const r=await reply;const v=await r.json();assert.equal(r.status(),200,JSON.stringify(v));assert.equal(v.result.success,expected,JSON.stringify(v));if(await page.locator('#refresh').count())await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);return v}
 await page.goto(base);await matches('versionValue',1);await screenshot('01-initial');
 for(const [id,v]of Object.entries({aInput:350,bInput:350,cInput:100}))await text(id,v);
 await page.locator('#commitBtn').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#commitBtn').disabled);
 const ordinary=await action('commitBtn','/api/commit');await matches('versionValue',2);checks.push({case:'normal operator change',receipt:ordinary.result});
 await page.goto(base+'/guard.html');await matches('revision',2);
 async function triple(x,y,z){await text('x',x);await text('y',y);await text('z',z)}
 await triple(400,300,100);await action('commit','/api/guard/commit');await matches('revision',3);
 await page.locator('#role').selectOption('guardian');await text('maximum',200);await text('bufferMinimum',300);const activation=await action('progressive','/api/guard/activate');await matches('revision',4);await matches('phase','RECOVERING');await matches('exposure',200);await matches('buffer',100);await screenshot('02-progressive-active');checks.push({case:'guardian objective and initial deficits',receipt:activation.result});
 await page.locator('#role').selectOption('reviewer');await triple(300,300,100);await action('commit','/api/guard/commit',false);await matches('revision',4);
 await page.locator('#role').selectOption('admin');await triple(300,300,100);await action('commit','/api/guard/commit');await matches('revision',5);await matches('exposure',100);await matches('buffer',0);
 await triple(350,300,100);await action('commit','/api/guard/commit',false);await matches('revision',5);
 await triple(200,300,100);await action('commit','/api/guard/commit');await matches('revision',6);await matches('phase','CONTAINED');await screenshot('03-contained');checks.push({case:'unauthorized and regressive attempts rejected; progressive containment',state:(await state()).state});
 await page.locator('#role').selectOption('guardian');await action('release','/api/guard/release');await matches('revision',7);
 await triple(100,300,100);await text('maximum',100);await text('bufferMinimum',300);await action('atomic','/api/guard/activate');await matches('revision',8);await matches('phase','CONTAINED');await action('release','/api/guard/release');await matches('revision',9);checks.push({case:'atomic containment and guardian-bound release',state:(await state()).state});
 await page.goto(base);await matches('versionValue',9);for(const view of ['migration','operations','planner','incident','catalog','history','desk']){await page.locator('.sidebar [data-page="'+view+'"]').click();await matches('headerVersion',9)}await screenshot('04-shared-main-workspace');checks.push({case:'seven views share flagship revision',version:9});
 await page.goto(base+'/guard.html');await matches('revision',9);await page.locator('[data-domain="governance"]').click();await matches('revision',1);await page.locator('#role').selectOption('guardian');await text('maximum',0);await text('bufferMinimum',2);await action('progressive','/api/guard/activate',false);await matches('revision',1);await screenshot('05-impossible-governance-rejected');
 await text('maximum',2);await text('bufferMinimum',7);await action('progressive','/api/guard/activate');await matches('revision',2);await page.locator('#role').selectOption('admin');await triple(4,9,4);await action('commit','/api/guard/commit');await matches('revision',3);await triple(2,9,7);await action('commit','/api/guard/commit');await matches('revision',4);await matches('phase','CONTAINED');await page.locator('#role').selectOption('guardian');await action('release','/api/guard/release');await matches('revision',5);checks.push({case:'governance infeasibility rejected, feasible lifecycle succeeds'});
 await page.locator('[data-domain="allocation"]').click();await matches('revision',9);await page.locator('#role').selectOption('admin');await triple(100,350,100);
 writeFileSync(fault,'fail');const degraded=await action('commit','/api/guard/commit');assert.equal(degraded.outcome,'committed_audit_degraded');await matches('revision',10);await page.locator('#auditRecoveryBanner').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#commit').disabled);await screenshot('06-audit-degraded');
 rmSync(fault);const recoveredResponse=page.waitForResponse(r=>r.url()===base+'/api/audit/reconcile');await page.getByRole('button',{name:'Reconcile recorded outcome'}).click();assert.equal((await recoveredResponse).status(),200);await page.locator('#auditRecoveryBanner').waitFor({state:'hidden'});await screenshot('07-reconciled');
 const history=await(await fetch(base+'/api/history')).json();assert.equal(history.history.filter(x=>x.txHash===degraded.result.transactionHash).length,1);assert.equal((await state()).state.version,'10');checks.push({case:'post-commit degraded UI, blocked writes and exact-once recovery',receipt:degraded.result,historyCount:history.history.length});
 assert.deepEqual(errors,[]);writeFileSync(resolve(out,'BROWSER_RESULT.json'),JSON.stringify({status:'PASS_HEADLESS_CHROMIUM_FALLBACK',inAppBrowser:'UNAVAILABLE_KERNEL_ASSETS_ERROR',url:base,runtime:'flagship',browser:browser.version(),checks,errors},null,2));console.log('P09_BROWSER_HEADLESS_ACCEPTANCE=PASS');
}catch(error){writeFileSync(resolve(out,'BROWSER_FAILURE.json'),JSON.stringify({error:error.stack,checks,errors},null,2));throw error}
finally{if(browser)await browser.close();if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill()})}
