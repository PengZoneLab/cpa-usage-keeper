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
 else if(p.endsWith('/usage/identities'))body={identities:mode==='empty'?[]:['a','b','bad','d','e','f','g'].map((id,i)=>({identity:id,name:i===0?'Alpha 5x':i===1?'Beta 20x':'Unknown',auth_type:1,type:'codex',disabled:i>=2,is_deleted:false,subscription:{provider:'codex',plan:i===0?'pro-5x':i===1?'pro-20x':'pro'}}))};
 else if(p.endsWith('/quota/cache'))body={items:['a','b','bad','d','e','f','g'].map(id=>({auth_index:id,status:'completed',refreshed_at:iso(0),quota:{quota:[{key:'rate_limit.secondary_window',window:{seconds:604800},usedPercent:id==='a'?70:20,resetAt:iso(id==='a'?86400_000:604800_000)}]}}))};
 else if(p.endsWith('/quota-floor')){if(mode==='401'){status=401;body={error:'unauthorized'}}else body={minimum_percent:0,paused:false,manual_hold:false}};
 if(p.endsWith('/reset-schedule'))body={auto_before_expiry:false,credits:[{id:'c',status:'available',expiresAt:iso(172800_000)}],tasks:[],error:''};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
});

const out='docs/account-planner/mobile'; const measurements=[];
try {
 for (const [label,url] of [['independent','http://127.0.0.1:5196/planner']]) {
  await page.setViewportSize({width:390,height:844}); await page.goto(url);
  await page.getByText('Alpha 5x',{exact:true}).first().waitFor({state:'attached'});
  await page.waitForFunction(()=>!document.body.innerText.includes('正在读取账号和保护配置…'));
  const box=await page.locator('section[aria-labelledby=planner-title]').boundingBox();
  const cta=await page.getByRole('button',{name:'计算优先账号',exact:true}).boundingBox();
  measurements.push({label,height:box.height,ctaTop:cta.y,scrollWidth:await page.evaluate(()=>document.documentElement.scrollWidth)});
  await page.screenshot({path:out+'/'+label+'-390.png',fullPage:true});
 }
 
 assert.equal(await page.locator('#planner-accounts').evaluate(el=>el.parentElement.open),false);
 await page.locator('#planner-accounts').click();
 assert.equal(await page.locator('#planner-accounts').evaluate(el=>el.parentElement.open),true);
 assert.equal(await page.locator('#planner-accounts + div input').count(),7);
 await page.locator('#planner-accounts').click();
 await page.getByLabel('模型',{exact:true}).fill('gpt-test');await page.getByLabel('Effort',{exact:true}).fill('high');await page.getByLabel('每日需求（5x周百分点）',{exact:true}).fill('40');
 await page.getByRole('button',{name:'计算优先账号',exact:true}).click();
 await page.getByRole('heading',{name:/推荐账号：/}).waitFor({timeout:90000});
 const resultBox=await page.locator('section[aria-live=polite]').boundingBox();const inputBox=await page.getByLabel('模型',{exact:true}).boundingBox();assert.ok(resultBox.y<inputBox.y);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:out+'/independent-result-390.png',fullPage:true});
 await page.getByText('比较各账号方案',{exact:true}).click();assert.equal(await page.locator('section[aria-live=polite] tbody tr').count(),2);
 await page.getByText('公式与假设',{exact:true}).click();assert.ok(await page.locator('section[aria-live=polite]').innerText().then(t=>t.includes('Qᵢ')));
 for (const width of [320,844,1440]) {await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);}
 await page.screenshot({path:out+'/independent-desktop.png',fullPage:true});
 assert.equal(errors.length,0);
 fs.writeFileSync(out+'/independent-results.json',JSON.stringify({measurements,checks:['account disclosure','result first','comparison accessible','formula accessible','320/390/844/1440 no overflow'],errors},null,2));console.log(JSON.stringify(measurements));
} finally {await browser.close()}
