import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import app from '../api/index.js';
import {database,closeDatabase} from '../lib/db.js';

test('MongoDB billing integration: auth, stock, rollback, retries, history and cancellation',async t=>{
  const repl=await MongoMemoryReplSet.create({replSet:{count:1,storageEngine:'wiredTiger'},binary:{version:'7.0.14'}});
  process.env.MONGODB_URI=repl.getUri();process.env.MONGODB_DB='jms_test';
  process.env.ADMIN_PASSWORD='test-password-long-enough';process.env.SESSION_SECRET='test-session-secret-at-least-32-characters';
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;let cookie='';
  async function call(path,body,method=body?'POST':'GET'){
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json','X-JMS-Request':'1',Cookie:cookie},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  try {
    assert.equal((await call('/products')).status,401);
    const login=await call('/login',{password:process.env.ADMIN_PASSWORD});assert.equal(login.status,200);cookie=login.cookie.split(';')[0];
    const p=await call('/products',{sku:'BLUE-M',name:'Cotton kurti',size:'M',color:'Blue',price:599,stock:2});assert.equal(p.status,201);
    const productId=p.data._id;
    assert.equal((await call('/scan?code=BLUE-M')).data.stock,2);
    assert.equal((await call('/scan?code='+encodeURIComponent('JMS:'+productId))).data._id,productId);
    assert.equal((await call('/products',{sku:'BLUE-M',name:'Duplicate',price:1,stock:1})).status,409);
    const qr=await fetch(base+`/products/${productId}/qr`,{headers:{Cookie:cookie}});assert.equal(qr.headers.get('content-type'),'image/png');
    const payload={requestKey:randomUUID(),items:[{productId,qty:1}],payment:'Cash',received:599,expectedTotalCents:59900};
    const [first,retry]=await Promise.all([call('/bills',payload),call('/bills',payload)]);
    assert.ok([200,201].includes(first.status),JSON.stringify(first));assert.ok([200,201].includes(retry.status),JSON.stringify(retry));
    assert.equal(first.data._id,retry.data._id);assert.equal((await call('/scan?code=BLUE-M')).data.stock,1);
    assert.equal((await call('/bills',{...payload,received:1})).status,409);
    const [raceA,raceB]=await Promise.all([call('/bills',{...payload,requestKey:randomUUID()}),call('/bills',{...payload,requestKey:randomUUID()})]);
    assert.deepEqual([raceA.status,raceB.status].sort(),[201,409]);
    assert.equal((await call('/scan?code=BLUE-M')).data.stock,0);
    const p2=await call('/products',{sku:'RED-S',name:'Dress',size:'S',color:'Red',price:100,stock:5});
    const bad=await call('/bills',{requestKey:randomUUID(),items:[{productId:p2.data._id,qty:2},{productId,qty:1}]});
    assert.equal(bad.status,409);assert.equal((await call('/scan?code=RED-S')).data.stock,5);
    await call(`/bills/${first.data._id}/cancel`,{reason:'Test cancellation'});
    await call(`/bills/${first.data._id}/cancel`,{reason:'Retry cancellation'});
    assert.equal((await call('/scan?code=BLUE-M')).data.stock,1);
    const movement={delta:4,reason:'Delivery',requestKey:randomUUID()};
    assert.equal((await call(`/products/${productId}/stock`,movement)).status,200);
    await call(`/products/${productId}/stock`,movement);assert.equal((await call('/scan?code=BLUE-M')).data.stock,5);
    assert.equal((await call(`/products/${productId}/stock`,{delta:-6,reason:'Too much',requestKey:randomUUID()})).status,409);
    assert.equal((await call('/bills?q=JMS')).data.count,2);
    const dashboard=await call('/dashboard');assert.equal(dashboard.status,200);assert.equal(dashboard.data.billCount,2);assert.equal(dashboard.data.today.count,1);
    assert.equal((await call('/products?q=%5B')).status,200);
    const {db}=await database();assert.equal(await db.collection('bills').countDocuments(),2);
    assert.equal((await call(`/bills/${first.data._id}`)).data.status,'CANCELLED');
    const priceChange=await call('/bills',{requestKey:randomUUID(),items:[{productId,qty:1}],expectedTotalCents:1});assert.equal(priceChange.status,409);
    const csrf=await fetch(base+'/bills',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:'{}'});assert.equal(csrf.status,403);
  } finally {await new Promise(resolve=>server.close(resolve));await closeDatabase();await repl.stop();}
});
