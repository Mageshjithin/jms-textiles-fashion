import express from 'express';
import {fileURLToPath} from 'node:url';
import {ObjectId} from 'mongodb';
import QRCode from 'qrcode';
import {database, shopSettings, defaultShop} from '../lib/db.js';
import {authenticated, cookie, token, validPassword} from '../lib/auth.js';
import {AppError, check, text, int, key, fingerprint, productInput, cartInput, totals} from '../lib/domain.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'100kb'}));
app.use('/api', (req,res,next) => {
  res.set('Cache-Control','no-store');
  res.set('X-Content-Type-Options','nosniff');
  if (!['GET','HEAD'].includes(req.method) && req.get('x-jms-request') !== '1') return res.status(403).json({error:'Use the JMS billing application'});
  next();
});
app.get('/api/health', async (req,res) => {await database(); res.json({ok:true,service:'JMS Billing',storage:'MongoDB'});});
app.post('/api/login', async (req,res) => {
  const {db}=await database();
  const ip = process.env.VERCEL ? req.get('x-vercel-forwarded-for') || req.ip : req.ip;
  const bucket = Math.floor(Date.now()/(15*60*1000));
  const attempt = await db.collection('loginAttempts').findOneAndUpdate(
    {_id:fingerprint(`${ip}:${bucket}`)},
    {$inc:{count:1},$setOnInsert:{expiresAt:new Date(Date.now()+30*60*1000)}},
    {upsert:true,returnDocument:'after'});
  check(attempt.count <= 10, 'Too many login attempts. Try again after 15 minutes.',429);
  check(validPassword(req.body?.password),'Incorrect password',401);
  res.set('Set-Cookie',cookie(token())).json({ok:true});
});
app.post('/api/logout',(req,res)=>res.set('Set-Cookie',cookie('',true)).json({ok:true}));
app.use('/api', (req,res,next)=>{check(authenticated(req),'Please sign in',401);next();});
app.get('/api/session',(req,res)=>res.json({ok:true}));
const id = value => {check(/^[a-f0-9]{24}$/i.test(value),'Invalid ID');return new ObjectId(value);};
const page = req => Math.max(1,Math.min(100000,Number.parseInt(req.query.page,10)||1));
const search = value => String(value || '').slice(0,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

app.get('/api/settings',async(req,res)=>{const {db}=await database();res.json(await shopSettings(db));});
app.put('/api/settings',async(req,res)=>{
  const shop=Object.fromEntries(Object.keys(defaultShop).map(k=>[k,text(req.body[k]??'',k,k==='footer'?500:k==='address'?300:100,k==='name')]));
  shop.gstin=shop.gstin.toUpperCase();check(!shop.gstin || /^[0-9A-Z]{15}$/.test(shop.gstin),'GSTIN must be 15 letters/numbers');
  const {db}=await database();await db.collection('settings').updateOne({_id:'shop'},{$set:shop},{upsert:true});res.json(shop);
});
app.get('/api/products',async(req,res)=>{
  const {db}=await database(), q=search(req.query.q);
  const filter=q?{$or:['sku','name','size','color','category'].map(k=>({[k]:{$regex:q,$options:'i'}}))}:{};
  if(req.query.low==='1')filter.$expr={$lte:['$stock','$lowStock']};
  const current=page(req), limit=50;
  const [items,count]=await Promise.all([db.collection('products').find(filter).sort({name:1,_id:1}).skip((current-1)*limit).limit(limit).toArray(),db.collection('products').countDocuments(filter)]);
  res.json({items,count,page:current,pages:Math.max(1,Math.ceil(count/limit))});
});
app.get('/api/scan',async(req,res)=>{
  const code=text(req.query.code,'QR or SKU',100,true);
  const {db}=await database();
  const filter=code.startsWith('JMS:')?{_id:id(code.slice(4))}:{sku:code.toUpperCase()};
  const product=await db.collection('products').findOne(filter);check(product,'Product not found. Register this variant first.',404);res.json(product);
});
app.get('/api/products/:id/qr',async(req,res)=>{
  const {db}=await database(), product=await db.collection('products').findOne({_id:id(req.params.id)});
  check(product,'Product not found',404);
  res.type('png').send(await QRCode.toBuffer(`JMS:${product._id}`,{width:320,margin:2,errorCorrectionLevel:'M'}));
});
app.post('/api/products',async(req,res)=>{
  const product=productInput(req.body,true), {db,client}=await database();
  const session=client.startSession();const _id=new ObjectId(), createdAt=new Date();
  try {await session.withTransaction(async()=>{
    await db.collection('products').insertOne({_id,...product,createdAt,updatedAt:createdAt},{session});
    await db.collection('movements').insertOne({productId:_id,sku:product.sku,delta:product.stock,type:'OPENING',reason:'Opening stock',createdAt},{session});
  });res.status(201).json({_id,...product});}finally{await session.endSession();}
});
app.put('/api/products/:id',async(req,res)=>{
  const product=productInput(req.body), {db}=await database();
  const result=await db.collection('products').findOneAndUpdate({_id:id(req.params.id)},{$set:{...product,updatedAt:new Date()}},{returnDocument:'after'});
  check(result,'Product not found',404);res.json(result);
});
app.post('/api/products/:id/stock',async(req,res)=>{
  const productId=id(req.params.id), delta=int(req.body.delta,'Stock change',-1000000,1000000);
  check(delta!==0,'Stock change cannot be zero');const reason=text(req.body.reason,'Reason',200,true), requestKey=key(req.body.requestKey);
  const hash=fingerprint({productId,delta,reason}), {db,client}=await database(), session=client.startSession();
  let result;
  try {await session.withTransaction(async()=>{
    const old=await db.collection('operations').findOne({requestKey},{session});
    if(old){check(old.hash===hash,'Request key already used for a different stock change',409);result=old.result;return;}
    result=await db.collection('products').findOneAndUpdate({_id:productId,stock:{$gte:Math.max(0,-delta),$lte:1000000-Math.max(0,delta)}},{$inc:{stock:delta},$set:{updatedAt:new Date()}},{session,returnDocument:'after'});
    check(result,'Product missing or stock would be outside 0–1,000,000',409);
    await db.collection('movements').insertOne({productId,sku:result.sku,delta,type:'ADJUSTMENT',reason,createdAt:new Date()},{session});
    await db.collection('operations').insertOne({requestKey,hash,result,createdAt:new Date()},{session});
  });res.json(result);}catch(error){
    if(error.code===11000){const old=await db.collection('operations').findOne({requestKey});if(old?.hash===hash)return res.json(old.result);}
    throw error;
  }finally{await session.endSession();}
});
app.get('/api/products/:id/movements',async(req,res)=>{
  const {db}=await database();res.json(await db.collection('movements').find({productId:id(req.params.id)}).sort({createdAt:-1}).limit(100).toArray());
});

app.post('/api/bills',async(req,res)=>{
  const input=cartInput(req.body), requestKey=key(req.body.requestKey), hash=fingerprint(input);
  const {db,client}=await database(), session=client.startSession();let bill;
  try {await session.withTransaction(async()=>{
    const existing=await db.collection('bills').findOne({requestKey},{session});
    if(existing){check(existing.hash===hash,'This request key belongs to a different bill',409);bill=existing;return;}
    const shop=await shopSettings(db,session), lines=[];
    for(const item of input.items){
      const product=await db.collection('products').findOne({_id:id(item.productId)},{session});
      check(product,'A product no longer exists',409);
      check(product.stock>=item.qty,`${product.name} (${product.size} ${product.color}): only ${product.stock} available`,409);
      check(!product.gstBps || shop.gstin,'Enter shop GSTIN before billing products with GST');
      lines.push({productId:product._id,sku:product.sku,name:product.name,size:product.size,color:product.color,priceCents:product.priceCents,gstBps:product.gstBps,qty:item.qty});
    }
    const calculated=totals(lines,input.discountCents,input.receivedCents);
    // Reject a changed catalogue price instead of silently charging a new total.
    if(req.body.expectedTotalCents!==undefined)check(req.body.expectedTotalCents===calculated.totalCents,'Prices changed. Refresh stock and review the total before retrying.',409);
    const createdAt=new Date();
    const dateKey=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(createdAt).split('/').reverse().join('');
    const counter=await db.collection('counters').findOneAndUpdate({_id:dateKey},{$inc:{seq:1}},{upsert:true,returnDocument:'after',session});
    bill={_id:new ObjectId(),requestKey,hash,number:`JMS-${dateKey}-${String(counter.seq).padStart(5,'0')}`,createdAt,status:'COMPLETED',shop,customer:input.customer,mobile:input.mobile,payment:input.payment,...calculated};
    for(const row of lines){
      const updated=await db.collection('products').updateOne({_id:row.productId,stock:{$gte:row.qty}},{$inc:{stock:-row.qty},$set:{updatedAt:createdAt}},{session});
      check(updated.modifiedCount===1,`Stock changed for ${row.sku}; refresh and retry`,409);
      await db.collection('movements').insertOne({productId:row.productId,sku:row.sku,delta:-row.qty,type:'SALE',billId:bill._id,reason:bill.number,createdAt},{session});
    }
    await db.collection('bills').insertOne(bill,{session});
  },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});res.status(201).json(bill);
  }catch(error){
    if(error.code===11000){const old=await db.collection('bills').findOne({requestKey});if(old?.hash===hash)return res.json(old);}
    throw error;
  }finally{await session.endSession();}
});
app.get('/api/bills',async(req,res)=>{
  const {db}=await database(), q=search(req.query.q), current=page(req),limit=30;
  const filter=q?{$or:['number','customer','mobile'].map(k=>({[k]:{$regex:q,$options:'i'}}))}:{};
  const [items,count]=await Promise.all([db.collection('bills').find(filter,{projection:{items:0,shop:0,hash:0,requestKey:0}}).sort({createdAt:-1,_id:-1}).skip((current-1)*limit).limit(limit).toArray(),db.collection('bills').countDocuments(filter)]);
  res.json({items,count,page:current,pages:Math.max(1,Math.ceil(count/limit))});
});
app.get('/api/bills/:id',async(req,res)=>{
  const {db}=await database(), bill=await db.collection('bills').findOne({_id:id(req.params.id)});check(bill,'Bill not found',404);res.json(bill);
});
app.post('/api/bills/:id/cancel',async(req,res)=>{
  const billId=id(req.params.id),reason=text(req.body.reason,'Cancellation reason',200,true),{db,client}=await database(),session=client.startSession();let bill;
  try {await session.withTransaction(async()=>{
    bill=await db.collection('bills').findOne({_id:billId},{session});check(bill,'Bill not found',404);
    if(bill.status==='CANCELLED')return;
    for(const row of bill.items){
      const result=await db.collection('products').updateOne({_id:row.productId},{$inc:{stock:row.qty},$set:{updatedAt:new Date()}},{session});
      check(result.matchedCount===1,'Cannot restore a missing product',409);
      await db.collection('movements').insertOne({productId:row.productId,sku:row.sku,delta:row.qty,type:'CANCELLATION',billId,reason,createdAt:new Date()},{session});
    }
    const changes={status:'CANCELLED',cancelReason:reason,cancelledAt:new Date()};
    await db.collection('bills').updateOne({_id:billId},{$set:changes},{session});bill={...bill,...changes};
  });res.json(bill);}finally{await session.endSession();}
});
app.get('/api/dashboard',async(req,res)=>{
  const {db}=await database();
  const [inventory,sales,today]=await Promise.all([
    db.collection('products').aggregate([{$group:{_id:null,variants:{$sum:1},pieces:{$sum:'$stock'},low:{$sum:{$cond:[{$lte:['$stock','$lowStock']},1,0]}}}}]).toArray(),
    db.collection('bills').aggregate([{$group:{_id:'$status',count:{$sum:1},totalCents:{$sum:'$totalCents'},dueCents:{$sum:'$dueCents'}}}]).toArray(),
    db.collection('bills').aggregate([{$match:{status:'COMPLETED',createdAt:{$gte:new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})+'T00:00:00+05:30')}}},{$group:{_id:null,count:{$sum:1},totalCents:{$sum:'$totalCents'}}}]).toArray()
  ]);
  res.json({inventory:inventory[0]||{variants:0,pieces:0,low:0},sales,today:today[0]||{count:0,totalCents:0},billCount:sales.reduce((n,s)=>n+s.count,0)});
});
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found'}));
app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
app.use((error,req,res,next)=>{
  if(error instanceof AppError)return res.status(error.status).json({error:error.message});
  if(error.code===11000)return res.status(409).json({error:'This SKU or request already exists. Refresh before retrying.'});
  if(error.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON'});
  console.error('JMS API error',error.name,error.code || '');
  res.status(503).json({error:'Could not complete the request. Check database connectivity; retrying the same bill is safe.'});
});
export default app;
