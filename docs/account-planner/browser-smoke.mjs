import {createRequire} from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLANNER_PLAYWRIGHT || '/tmp/cpa-planner-browser/node_modules/playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
await context.addInitScript(()=>localStorage.setItem('cpa-usage-keeper-language','zh'));
const page=await context.newPage();
const now=Date.now(); const iso=ms=>new Date(now+ms).toISOString();
const requests=[],errors=[];const checks=[];let mode='normal';
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/api/**',async route=>{
 const p=new URL(route.request().url()).pathname;const method=route.request().method();requests.push({method,path:p});
 let body={};let status=200;
 if(p.endsWith('/startup/status'))body={phase:'ready',message:'Ready',progress:null};
 else if(p.endsWith('/auth/session'))body={authenticated:mode!=='401',role:'admin'};
 else if(p.endsWith('/status'))body={running:true,timezone:'Asia/Shanghai'};
 else if(p.endsWith('/version'))body={version:'fixture'};
 else if(p.endsWith('/usage/api-keys/options'))body={options:[]};
 else if(p.endsWith('/usage/identities'))body={identities:mode==='empty'?[]:['a','b','bad'].map((id,i)=>({identity:id,name:i===0?'Alpha 5x':i===1?'Beta 20x':'Unknown',auth_type:1,type:'codex',disabled:false,is_deleted:false,subscription:{provider:'codex',plan:i===0?'pro-5x':i===1?'pro-20x':'pro'}}))};
 else if(p.endsWith('/quota/cache'))body={items:['a','b','bad'].map(id=>({auth_index:id,status:'completed',refreshed_at:iso(0),quota:{quota:[{key:'rate_limit.secondary_window',window:{seconds:604800},usedPercent:id==='a'?70:20,resetAt:iso(id==='a'?86400_000:604800_000)},{key:'rate_limit.primary_window',window:{seconds:18000},usedPercent:0,resetAt:iso(18000_000)}]}}))};
 else if(p.endsWith('/quota-floor')){if(mode==='401'){status=401;body={error:'unauthorized'}}else body={minimum_percent:0,paused:false,manual_hold:false}};
 if(p.endsWith('/reset-schedule'))body={auto_before_expiry:false,credits:[{id:'c',status:'available',expiresAt:iso(172800_000)}],tasks:[],error:''};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});
try{
 await page.goto('http://127.0.0.1:5196/planner');
 await page.getByText('Alpha 5x',{exact:true}).first().waitFor();
 await page.getByLabel('模型',{exact:true}).fill('gpt-test');
 await page.getByLabel('Effort',{exact:true}).fill('high');
 await page.getByLabel('每日需求（5x周百分点）',{exact:true}).fill('40');
 await page.getByLabel('Alpha 5x',{exact:true}).fill('50');
 await page.getByLabel('Beta 20x',{exact:true}).fill('100');
 await page.getByRole('button',{name:'计算优先账号',exact:true}).click();
 await page.getByRole('heading',{name:/推荐账号：/}).waitFor({timeout:90000});
 const rows=await page.locator('section[aria-live=polite] tbody tr').allTextContents();assert.equal(rows.length,2);checks.push({name:'real-worker-ranking',rows});
 assert.match(await page.locator('section[aria-live=polite]').innerText(),/模型内/);
 await page.screenshot({path:'docs/account-planner/developer-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);checks.push({name:'mobile-no-overflow',pass:true});
 await page.screenshot({path:'docs/account-planner/developer-mobile.png',fullPage:true});
 await page.getByLabel('每日需求（5x周百分点）',{exact:true}).fill('41');assert.equal(await page.locator('section[aria-live=polite]').count(),0);checks.push({name:'invalidation',pass:true});
 // Hold Wasm delivery to make cancellation observable independently of solve speed.
 await context.route('**/*.wasm',async route=>{await new Promise(r=>setTimeout(r,1500));await route.continue().catch(()=>{})});
 await page.getByRole('button',{name:'计算优先账号',exact:true}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click({force:true});
 await page.waitForTimeout(1800);assert.equal(await page.locator('section[aria-live=polite]').count(),0);checks.push({name:'worker-cancel',pass:true});
 mode='401';await page.getByRole('button',{name:'重读账号快照',exact:true}).click();await page.getByRole('heading',{name:/登录|Login|登录 Keeper/}).first().waitFor({timeout:10000}).catch(async()=>{assert.ok((await page.locator('body').innerText()).includes('登录'))});checks.push({name:'401-login',pass:true});
 assert.equal(errors.length,0);assert.ok(requests.every(r=>r.method==='GET'||(r.method==='POST'&&r.path==='/api/v1/quota/cache')));
 console.log(JSON.stringify({checks,errors,readOnly:true},null,2));
}catch(e){console.error(e);await page.screenshot({path:'docs/account-planner/developer-failure.png',fullPage:true});process.exitCode=1}
finally{fs.writeFileSync('docs/account-planner/evidence/developer-browser.json',JSON.stringify({checks,requests,errors},null,2));await browser.close()}
