import {chromium} from '/tmp/cpa-planner-browser/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
await context.addInitScript(()=>localStorage.setItem('cpa-usage-keeper-language','zh'));
const page=await context.newPage();const errors=[];const mutations=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method())&&!r.url().endsWith('/quota/cache'))mutations.push(new URL(r.url()).pathname.replace(/credentials\/[^/]+/,'credentials/[account]'))});
try {
 await page.goto('http://192.168.31.251:8318/planner',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'重读账号快照'}).waitFor({timeout:120000});
 await page.waitForFunction(()=>!document.body.innerText.includes('正在读取账号和保护配置…'),{timeout:120000});
 const count=await page.locator('#planner-accounts + div input[type=checkbox]').count();
 const selected=await page.locator('#planner-accounts + div input:checked').count();
 assert.equal(count,7);assert.ok(selected>=0);
  await page.getByRole('button',{name:'计算优先账号',exact:true}).click();
 await page.getByRole('heading',{name:/推荐账号：/}).waitFor({timeout:90000});
 assert.ok(await page.locator('section[aria-labelledby=planner-preview]').innerText().then(t=>t.includes('账号到期')));
 const rankingRows=await page.locator('section[aria-live=polite] tbody tr').count();assert.ok(rankingRows>0);
 await page.screenshot({path:'.deployment-private.local/production-planner.png',fullPage:true});
 assert.equal(errors.length,0);assert.equal(mutations.length,0);
 const summary={accounts:count,selected,rankingRows,errors,mutations,realBackend:true,scenario:'automatic capacity',modelRequestsSent:0};
 fs.writeFileSync('docs/account-planner/mobile/production-browser.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
} catch(e) {await page.screenshot({path:'.deployment-private.local/production-failure.png',fullPage:true});console.error(String(e));process.exitCode=1}
finally {await browser.close()}
