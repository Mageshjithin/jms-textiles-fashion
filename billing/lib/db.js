import {MongoClient} from 'mongodb';
import {AppError} from './domain.js';
let connection;
export async function database() {
  if (!connection) connection = connect().catch(error => {connection = null; throw error;});
  return connection;
}
async function connect() {
  if (!process.env.MONGODB_URI) throw new AppError(503, 'Configure MONGODB_URI in server environment settings');
  const client = new MongoClient(process.env.MONGODB_URI, {maxPoolSize: 5, serverSelectionTimeoutMS: 8000});
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'jms_textiles');
    const hello = await db.admin().command({hello: 1});
    if (!hello.setName && hello.msg !== 'isdbgrid') throw new AppError(503, 'MongoDB needs a replica set for safe billing. Use Atlas or the included local replica-set setup.');
    await Promise.all([
      db.collection('products').createIndex({sku:1}, {unique:true}),
      db.collection('bills').createIndex({requestKey:1}, {unique:true}),
      db.collection('bills').createIndex({number:1}, {unique:true}),
      db.collection('bills').createIndex({createdAt:-1}),
      db.collection('movements').createIndex({productId:1,createdAt:-1}),
      db.collection('operations').createIndex({requestKey:1}, {unique:true}),
      db.collection('loginAttempts').createIndex({expiresAt:1}, {expireAfterSeconds:0})
    ]);
    return {client,db};
  } catch(error) {await client.close(); throw error;}
}
export async function closeDatabase() {if (connection) {const {client}=await connection; await client.close(); connection=null;}}
export const defaultShop = {name:'JMS TEXTILES',address:'',phone:'',gstin:'',footer:'Thank you for shopping with us! Visit again.'};
export async function shopSettings(db, session) {
  const record = await db.collection('settings').findOne({_id:'shop'}, {session});
  if (!record) return {...defaultShop};
  const {_id,...shop} = record; return shop;
}
