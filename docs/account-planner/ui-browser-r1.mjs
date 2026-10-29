import {chromium} from '/tmp/cpa-planner-browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';import crypto from 'node:crypto';
const out='docs/account-planner';const log={time:new Date().toISOString(),requests:[],errors:[],checks:[],sha:{}};
for(const f of ['AccountPlanner.tsx','AccountPlanner.module.scss','data.ts','solver.ts','runner.ts','planner.worker.ts'])log.sha[f]=crypto.createHash('sha256').update(fs.readFileSync('web/src/features/account-planner/'+f)).digest('hex');
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addInitScript(()=>localStorage.setItem('cpa-usage-keeper-language','zh'));const page=await context.newPage();let mode='normal';const now=Date.now(),iso=n=>new Date(now+n).toISOString();
page.on('pageerror',e=>log.errors.push(String(e)));page.on('response',r=>{if(r.url().includes('wasm'))log.checks.push({wasm:r.url(),status:r.status()})});
await context.route('**/api/**',async route=>{let p=new URL(route.request().url()).pathname;log.requests.push({method:route.request().method(),path:p});let data={},status=200;
if(p.endsWith('/startup/status'))data={phase:'ready',message:'Ready',progress:null};
else if(p.endsWith('/auth/session'))data={authenticated:true,role:'admin'};
else if(p.endsWith('/usage/identities'))data={identities:['a','b','unknown','missing','stale'].map((id,i)=>({identity:id,displayName:id==='a'?'Alpha 5x':id==='b'?'Beta 20x':id,type:'codex',auth_type:1,subscription:{plan:i===2?'pro':'pro-'+(i===1?'20x':'5x')}}))};
else if(p.endsWith('/quota/cache'))data={items:['a','b','unknown','stale'].map(id=>({auth_index:id,status:'completed',refreshed_at:iso(id==='stale'?-3600000:0),quota:{quota:[{key:'rate_limit.week',window:{seconds:604800},usedPercent:id==='a'?70:20,resetAt:iso(id==='a'?86400000:604800000)},{key:'rate_limit.short',window:{seconds:18000},usedPercent:0,resetAt:iso(18000000)}]}}))};
else if(p.endsWith('/quota-floor')){data={minimum_percent:0,paused:false,manual_hold:false};if(mode==='401'){status=401;data={error:'unauthorized'}}}
else if(p.endsWith('/reset-schedule'))data={auto_before_expiry:false,credits:[{id:'card-'+p.split('/')[3],status:'available',expiresAt:iso(172800000)}],tasks:[],error:''};
else if(p.endsWith('/version'))data={version:'fixture'};
await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});});
try{
await page.goto('http://127.0.0.1:5196/planner');await page.getByText('Participating accounts').waitFor();
log.checks.push({initial:await page.locator('body').innerText()});
await page.getByLabel('模型',{exact:true}).fill('gpt-test');await page.getByLabel('Effort',{exact:true}).fill('high');await page.getByLabel('每日需求（5x周百分点）').fill('40');await page.getByLabel('结束时间').fill(new Date(now+2*86400000).toISOString().slice(0,10));await page.getByLabel('Alpha 5x',{exact:true}).fill('50');await page.getByLabel('Beta 20x',{exact:true}).fill('100');
await page.getByRole('button',{name:'计算优先账号',exact:true}).click();await page.getByRole('heading',{name:/结果：/}).waitFor({timeout:60000});
await page.getByText('公式与假设',{exact:true}).click();await page.getByText('使用计划',{exact:true}).click();log.checks.push({result:await page.locator('body').innerText()});await page.screenshot({path:out+'/ui-desktop-r1.png',fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/ui-mobile-r1.png',fullPage:true});log.checks.push({mobileOverflow:await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}))});
await page.getByLabel('每日需求（5x周百分点）').fill('41');log.checks.push({parameterInvalidates:await page.getByRole('heading',{name:/结果：/}).count()===0});
await page.getByRole('button',{name:'计算优先账号',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();await page.waitForTimeout(1000);log.checks.push({cancelNoResult:await page.getByRole('heading',{name:/结果：/}).count()===0});
mode='401';await page.reload();await page.waitForTimeout(1200);log.checks.push({unauthorized:await page.locator('body').innerText()});await page.screenshot({path:out+'/ui-401-r1.png',fullPage:true});
}catch(e){log.failure=String(e);await page.screenshot({path:out+'/ui-failure-r1.png',fullPage:true});}finally{fs.writeFileSync(out+'/ui-browser-r1.json',JSON.stringify(log,null,2));await browser.close();}console.log(JSON.stringify(log,null,2));
