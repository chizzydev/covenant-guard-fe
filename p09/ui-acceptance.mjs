// Real local browser/EVM acceptance. Existing external Playwright + Chromium required.
// No production fault endpoint: the same isolated P09 test preload is used here.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'results/ui');mkdirSync(out,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.P09_PLAYWRIGHT_MODULE).href);
const port=await new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
const base='http://127.0.0.1:'+port,journal=resolve(out,'audit-'+Date.now()+'.jsonl'),fault=journal+'.fault';
const child=spawn(process.execPath,['--import','./p09/tests/fault-injector.mjs','app/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),COVENANT_RUNTIME:'flagship',COVENANT_AUDIT_PATH:journal,P09_TEST_FAULT_MARKER:fault},stdio:['ignore','pipe','pipe']});
let browser;const checks=[],errors=[];let serverLog='';
try {
 await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error(serverLog)),30000);const read=b=>{serverLog+=b;if(serverLog.includes('COVENANT_LOCAL_EVM=READY')){clearTimeout(timer);r()}};child.stdout.on('data',read);child.stderr.on('data',read);child.once('error',j);child.once('exit',c=>{clearTimeout(timer);j(Error('server exit '+c+serverLog))})});
 browser=await chromium.launch({headless:true,executablePath:process.env.P09_CHROMIUM});
 const context=await browser.newContext({viewport:{width:1440,height:1050},permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const screenshot=async name=>page.screenshot({path:resolve(out,name+'.png'),fullPage:true});
 const matches=async(id,value)=>page.waitForFunction(([id,v])=>document.getElementById(id)?.textContent===v,[id,String(value)]);
 const ready=async()=>page.waitForFunction(()=>!document.getElementById('refresh').disabled);
 const fill=async(id,v)=>page.locator('#'+id).fill(String(v));
 const triple=async(x,y,z)=>{await fill('x',x);await fill('y',y);await fill('z',z)};
 const raw=async()=>JSON.parse(await page.locator('#output').textContent());
 const guardState=async()=>await(await fetch(base+'/api/guard/state')).json();
 async function action(button,path,success=true) {
  const response=page.waitForResponse(r=>r.url()===base+'/api/guard/'+path&&r.request().method()==='POST');
  await page.locator('#'+button).click();const r=await response,data=await r.json();assert.equal(r.status(),200,JSON.stringify(data));
  if(path!=='preview')assert.equal(data.result.success,success,JSON.stringify(data));
  await ready();assert.deepEqual(await raw(),data,'Full raw response must preserve the actual server payload');return data;
 }
 await page.goto(base+'/guard.html');await matches('revision',1);await ready();
 assert.equal(await page.locator('#currentX').textContent(),'400');assert.match(await page.locator('#evidenceBadge').textContent(),/READ-ONLY STATE/);
 assert.deepEqual((await raw()).states,(await guardState()).states);await screenshot('01-allocation-desktop');checks.push({case:'Initial allocation state agrees with real EVM; state read has no transaction receipt'});
 await triple(350,350,100);const preview=await action('preview','preview');assert.equal(preview.preview.eligible,true);await matches('revision',1);
 assert.match(await page.locator('#evidenceBadge').textContent(),/READ-ONLY PREVIEW/);assert.equal(await page.locator('#evidenceGas').textContent(),'Not submitted');
 const commit=await action('commit','commit');await matches('revision',2);assert.equal(await page.locator('#evidenceRevision').textContent(),'1 → 2');
 await page.locator('#evidence-tab-state').click();assert.equal(await page.locator('#evidence-state').isVisible(),true);assert.equal(await page.locator('.comparison-table .changed').count(),3);await screenshot('02-transaction-state-diff');await page.locator('#evidence').screenshot({path:resolve(out,'02a-evidence-detail.png')});
 await page.locator('#evidence-tab-receipt').click();assert.equal(JSON.parse(await page.locator('#receiptOutput').textContent()).receipt.transactionHash,commit.result.transactionHash);
 await page.locator('#evidence-tab-raw').click();await page.locator('#copyEvidence').click();await matches('copyStatus','Complete response copied.');assert.deepEqual(JSON.parse(await page.evaluate(()=>navigator.clipboard.readText())),commit);
 await page.locator('#evidence-tab-overview').click();await page.locator('#evidence-tab-overview').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#evidence-tab-state').getAttribute('aria-selected'),'true');
 checks.push({case:'Read-only preview, operator commit, exact raw response, receipt, comparison, clipboard and keyboard tabs',transactionHash:commit.result.transactionHash});
 await page.locator('#migrationDetails summary').click();await page.locator('#first').selectOption('0');await fill('firstValue',400);await page.locator('#second').selectOption('1');await fill('secondValue',300);
 const migration=await action('migrate','migrate');await matches('revision',3);checks.push({case:'Collapsed migration remains reachable; real two-field transaction succeeds',transactionHash:migration.result.transactionHash});
 await page.locator('#role').selectOption('reviewer');await triple(350,350,100);const rejected=await action('commit','commit',false);await matches('revision',3);assert.deepEqual(rejected.before,rejected.after);assert.equal(await page.locator('.comparison-table .changed').count(),0);assert.match(await page.locator('#evidenceTitle').textContent(),/Rejected/);await screenshot('03-rejection-evidence');
 await page.locator('#role').selectOption('guardian');await fill('maximum',200);await fill('bufferMinimum',300);await action('progressive','activate');await matches('revision',4);await matches('phase','RECOVERING');await matches('exposure',200);await matches('buffer',100);
 await page.locator('#role').selectOption('admin');await triple(300,300,100);await action('commit','commit');await matches('revision',5);await matches('exposure',100);await matches('buffer',0);await screenshot('04-progressive-recovery');
 await triple(350,300,100);await action('commit','commit',false);await matches('revision',5);
 await triple(200,300,100);await action('commit','commit');await matches('revision',6);await matches('phase','CONTAINED');
 await action('release','release',false);await matches('revision',6);
 await page.locator('#role').selectOption('guardian');await action('release','release');await matches('revision',7);
 await triple(100,300,100);await fill('maximum',100);await action('atomic','activate');await matches('revision',8);await matches('phase','CONTAINED');await action('release','release');await matches('revision',9);
 checks.push({case:'Persistent progressive incident, valid partial recovery, regressive rejection, operator release rejection, containment and guardian release; atomic containment/release'});
 await page.locator('[data-domain="governance"]').click();await matches('revision',1);assert.match(await page.locator('#evidenceBadge').textContent(),/READ-ONLY STATE/);assert.equal(await page.locator('#market').isDisabled(),true);
 await fill('maximum',0);await fill('bufferMinimum',2);await action('progressive','activate',false);await matches('revision',1);
 await fill('maximum',2);await fill('bufferMinimum',7);await action('progressive','activate');await page.locator('#role').selectOption('admin');await triple(4,9,4);await action('commit','commit');await triple(2,9,7);await action('commit','commit');await matches('phase','CONTAINED');await page.locator('#role').selectOption('guardian');await action('release','release');await matches('revision',5);await screenshot('05-governance');
 checks.push({case:'Same kernel governance consumer: impossible objective rejects unchanged; valid recovery and bound release succeed'});
 await page.locator('[data-domain="allocation"]').click();await matches('revision',9);await page.locator('#role').selectOption('admin');await triple(100,350,100);
 writeFileSync(fault,'fail');const degraded=await action('commit','commit');assert.equal(degraded.outcome,'committed_audit_degraded');await matches('revision',10);
 await page.locator('#auditRecoveryBanner').waitFor({state:'visible'});assert.equal(await page.locator('#commit').isDisabled(),true);assert.equal(await page.locator('#migrate').isDisabled(),true);
 assert.equal(await page.locator('#preview').isEnabled(),true);assert.match(await page.locator('#evidenceBadge').textContent(),/AUDIT DEGRADED/);await screenshot('06-audit-degraded');
 rmSync(fault);const reconcile=page.waitForResponse(r=>r.url()===base+'/api/audit/reconcile');await page.getByRole('button',{name:'Reconcile recorded outcome'}).click();assert.equal((await reconcile).status(),200);await page.locator('#auditRecoveryBanner').waitFor({state:'hidden'});
 const history=await(await fetch(base+'/api/history')).json();assert.equal(history.history.filter(x=>x.txHash===degraded.result.transactionHash).length,1);assert.equal((await guardState()).states.allocation.version,'10');
 checks.push({case:'Post-commit append failure: actual successful receipt retained, writes blocked immediately, read-only inspection available, reconciliation once without EVM replay',transactionHash:degraded.result.transactionHash});
 await page.locator('#refresh').click();await ready();await matches('evidenceTitle','Deployed state inspected');
 for(const width of [1440,1024,768,390,320]) {
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Page overflow at '+width);
  for(const id of ['refresh','role','preview','commit','progressive','atomic','release','copyEvidence'])assert.equal(await page.locator('#'+id).isVisible(),true,id+' missing at '+width);
  assert.equal(await page.locator('#trust-boundary').isVisible(),true);
  if(width===390){await screenshot('07-mobile-390');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:resolve(out,'07a-mobile-viewport.png')})}if(width===1024)await screenshot('08-tablet-1024');
 }
 checks.push({case:'Responsive layouts and all primary controls/trust message visible without page overflow',widths:[1440,1024,768,390,320]});
 await page.setViewportSize({width:1440,height:1050});await page.goto(base);await page.waitForFunction(()=>document.getElementById('versionValue')?.textContent==='10');
 for(const view of ['migration','operations','planner','incident','catalog','history','desk']){await page.locator('.sidebar [data-page="'+view+'"]').click();await matches('headerVersion',10)}
 checks.push({case:'All seven existing views still read shared flagship allocation revision10'});
 assert.deepEqual(errors,[]);
 let commitSha=null;try{commitSha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()}catch{}
 writeFileSync(resolve(out,'BROWSER_RESULT.json'),JSON.stringify({status:'PASS',browserMode:'HEADLESS_CHROMIUM_FALLBACK',inAppBrowser:'UNAVAILABLE_KERNEL_ASSET_ERROR',commit:commitSha,url:base,runtime:'flagship',browser:browser.version(),checks,errors},null,2));
 console.log('UI_BROWSER_ACCEPTANCE=PASS');
} catch(error) {
 writeFileSync(resolve(out,'BROWSER_FAILURE.json'),JSON.stringify({error:error.stack,checks,errors},null,2));throw error;
} finally {
 if(browser)await browser.close();if(child.exitCode===null)await new Promise(r=>{child.once('exit',r);child.kill()});writeFileSync(resolve(out,'SERVER_LOG.txt'),serverLog);
}
