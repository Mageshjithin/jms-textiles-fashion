const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
 const {default:app}=await import('../api/index.js');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 fs.mkdirSync('test-output',{recursive:true});
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const shop={name:'JMS TEXTILES',address:'Chennai',phone:'',gstin:'',footer:'Thank you for shopping with us!'};
 const product={_id:'123456789012345678901234',name:'Cotton kurti',sku:'KURTI-BLUE-M',size:'M',color:'Blue',category:'Kurtis',priceCents:59900,gstBps:0,stock:10,lowStock:5};let bill=null;
 await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());let data={ok:true};
   if(url.pathname==='/api/settings')data=shop;
   if(url.pathname==='/api/dashboard')data={inventory:{pieces:bill?8:10,variants:1,low:0},sales:[],today:{totalCents:bill?119800:0,count:bill?1:0},billCount:bill?1:0};
   if(url.pathname==='/api/products')data={items:[product],count:1,page:1,pages:1};
   if(url.pathname==='/api/scan')data=product;
   if(url.pathname==='/api/bills'&&req.method()==='POST'){const body=req.postDataJSON();bill={...body,_id:'223456789012345678901234',number:'JMS-20261005-00001',shop,createdAt:new Date().toISOString(),items:[{...product,qty:2}],grossCents:119800,totalCents:119800,receivedCents:119800,discountCents:0,taxCents:0,status:'COMPLETED',dueCents:0};data=bill;}
   if(url.pathname==='/api/bills'&&req.method()==='GET')data={items:bill?[bill]:[],count:bill?1:0,page:1,pages:1};
   if(url.pathname==='/api/bills/223456789012345678901234')data=bill;
   await route.fulfill({json:data});
 });
 await page.goto(base);await page.locator('#workspace').waitFor({state:'visible'});
 await page.locator('#scan-code').fill('KURTI-BLUE-M');await page.locator('#scan-form').getByRole('button',{name:'Add item',exact:true}).click();
 await page.locator('[data-qty]').fill('2');await page.locator('[data-qty]').dispatchEvent('change');
 await page.locator('#paid-full').click();await page.locator('#received').evaluate(el=>{if(el.value!=='1198.00')throw Error('Wrong total');});
 await page.screenshot({path:'test-output/billing-desktop.png',fullPage:true});
 await page.locator('#save-bill').click();await page.locator('#notice').filter({hasText:'saved'}).waitFor();
 if(!await page.locator('#save-bill').isDisabled())throw Error('Saved bill can be billed twice');
 await page.locator('[data-view="history"]').click();await page.locator('[data-bill]').click();await page.locator('#detail-dialog').waitFor({state:'visible'});await page.locator('[data-close="detail-dialog"]').click();
 await page.locator('[data-view="inventory"]').click();await page.locator('#products').getByText('Cotton kurti').waitFor();await page.locator('[data-action="Edit"]').click();await page.locator('#product-dialog').waitFor({state:'visible'});await page.locator('[data-close="product-dialog"]').click();
 await page.setViewportSize({width:390,height:844});await page.locator('[data-view="billing"]').click();await page.screenshot({path:'test-output/billing-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw Error('Mobile page overflows');
 if(errors.length)throw Error(errors.join('\n'));console.log('UI checks passed with mocked API: scan/SKU, quantities, total, saved bill lock, history, product editing and mobile layout.');await browser.close();await new Promise(r=>server.close(r));
})().catch(e=>{console.error(e);process.exit(1)});
