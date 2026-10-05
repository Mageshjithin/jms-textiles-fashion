import test from 'node:test';
import assert from 'node:assert/strict';
import {cartInput, totals, productInput} from '../lib/domain.js';
import {authenticated,token,cookie} from '../lib/auth.js';
test('session cookie validates and rejects modified signatures',()=>{
  process.env.ADMIN_PASSWORD='long-test-password';process.env.SESSION_SECRET='12345678901234567890123456789012';
  const value=token();assert.equal(authenticated({headers:{cookie:cookie(value)}}),true);
  assert.equal(authenticated({headers:{cookie:'jms_session='+value+'x'}}),false);
  assert.equal(authenticated({headers:{}}),false);
});
test('combines duplicate product scans so quantity checks cannot be bypassed',()=>{
  const productId='123456789012345678901234';
  assert.equal(cartInput({items:[{productId,qty:2},{productId,qty:3}]}).items[0].qty,5);
});
test('rejects fractional quantities, negative prices and invalid SKU',()=>{
  assert.throws(()=>cartInput({items:[{productId:'123456789012345678901234',qty:0.5}]}));
  assert.throws(()=>productInput({sku:'TEST',name:'Test',price:-1}));
  assert.throws(()=>productInput({sku:'<script>',name:'Test',price:100}));
});
test('discount allocation never produces negative lines and totals stay exact',()=>{
  for(let discount=0;discount<=7;discount++){
    const value=totals(Array.from({length:7},()=>({priceCents:1,qty:1,gstBps:500})),discount,0);
    assert.equal(value.items.reduce((s,x)=>s+x.discountCents,0),discount);
    assert.equal(value.items.reduce((s,x)=>s+x.totalCents,0),7-discount);
    assert.ok(value.items.every(x=>x.totalCents>=0));
  }
});
test('inclusive tax, discount, due and change use integer paise',()=>{
  const value=totals([{priceCents:10500,qty:2,gstBps:500}],0,22000);
  assert.equal(value.taxCents,1000);assert.equal(value.totalCents,21000);assert.equal(value.changeCents,1000);assert.equal(value.dueCents,0);
  assert.throws(()=>totals([{priceCents:100,qty:1,gstBps:0}],101,0));
});
