const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=cents=>'₹'+(cents/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=value=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'});
let shop={}, cart=[], saved=null, pending=null, busy=false, scanner=null, productPage=1,billPage=1,products=[];
let editId=null, stockProduct=null, stockPending=null;
try{pending=JSON.parse(sessionStorage.getItem('jms-pending-checkout')||'null');if(pending){cart=pending.cart;}}
catch{pending=null;}
const notify=message=>{$('notice').textContent=message;$('notice').hidden=false;};
async function api(path,options={}){
  let response;
  try{response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json','X-JMS-Request':'1',...options.headers},credentials:'same-origin'});}catch{throw new Error('Connection lost. Check your network and retry.');}
  const body=await response.json().catch(()=>({error:'Server returned an unreadable response'}));
  if(!response.ok){if(response.status===401){$('workspace').hidden=true;$('login-screen').hidden=false;await stopScanner();}const error=new Error(body.error||'Request failed');error.status=response.status;throw error;}
  return body;
}
const send=(path,body,method='POST')=>api(path,{method,body:JSON.stringify(body)});
const guard=fn=>async event=>{try{await fn(event);}catch(error){notify(error.message);}};
function errorIn(form,error){form.querySelector('.dialog-error').textContent=error.message;}
function cartTotal(){return cart.reduce((sum,row)=>sum+row.priceCents*row.qty,0)-Math.round(Number($('discount').value||0)*100);}
function receipt(b,draft=false){
  const gross=b.grossCents??b.items.reduce((sum,row)=>sum+row.priceCents*row.qty,0),total=b.totalCents??gross-(b.discountCents||0);
  return `<div class="center"><h2>${esc(b.shop.name||'JMS TEXTILES')}</h2><p>SALES RECEIPT</p>${b.shop.address?`<p>${esc(b.shop.address)}</p>`:''}${b.shop.phone?`<p>${esc(b.shop.phone)}</p>`:''}${b.shop.gstin?`<p>GSTIN: ${esc(b.shop.gstin)}</p>`:''}</div>${draft?'<div class="draft">DRAFT · STOCK NOT DEDUCTED</div>':''}${b.status==='CANCELLED'?'<div class="draft">CANCELLED · STOCK RESTORED</div>':''}<div class="rule"></div><div class="pair"><span>Bill</span><b>${esc(b.number||'Assigned on save')}</b></div><div>${esc(date(b.createdAt||new Date()))} IST</div><div>To: ${esc(b.customer||'Walk-in customer')}</div>${b.mobile?`<div>${esc(b.mobile)}</div>`:''}<div class="rule"></div><table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${b.items.map(row=>`<tr><td>${esc(row.name)}<br>${esc(row.size)} ${esc(row.color)}<br>${esc(row.sku)}</td><td>${row.qty}</td><td>${money(row.priceCents)}</td><td>${money(row.priceCents*row.qty)}</td></tr>`).join('')}</tbody></table><div class="rule"></div><div class="pair"><span>Subtotal</span><span>${money(gross)}</span></div><div class="pair"><span>Discount</span><span>${money(b.discountCents||0)}</span></div><div class="pair net"><span>TOTAL</span><span>${money(total)}</span></div>${b.taxCents?`<div class="pair"><span>GST included</span><span>${money(b.taxCents)}</span></div>`:''}<div class="pair"><span>${esc(b.payment||'Cash')} received</span><span>${money(b.receivedCents||0)}</span></div><div class="pair"><span>Due</span><span>${money(Math.max(0,total-(b.receivedCents||0)))}</span></div><div class="pair"><span>Change</span><span>${money(Math.max(0,(b.receivedCents||0)-total))}</span></div>${b.cancelReason?`<p>Cancellation: ${esc(b.cancelReason)}</p>`:''}<div class="rule"></div><p class="center">${esc(b.shop.footer||'Thank you! Visit again.')}</p>`;
}
function renderCart(){
  $('cart').className=cart.length?'':'empty';
  $('cart').innerHTML=cart.length?cart.map((row,index)=>`<div class="cart-row"><div><b>${esc(row.name)}</b><small>${esc(row.size)} · ${esc(row.color)} · ${esc(row.sku)}</small><br><small>${row.stock} available</small></div><label><span class="sr-only">Quantity for ${esc(row.sku)}</span><input data-qty="${index}" type="number" min="1" max="${row.stock}" value="${row.qty}" ${saved||pending?'disabled':''}></label><strong>${money(row.qty*row.priceCents)}</strong><button type="button" data-remove="${index}" aria-label="Remove ${esc(row.sku)}" ${saved||pending?'disabled':''}>×</button></div>`).join(''):'Your next sale starts here.<br><small>Scan a QR code or add a product from inventory.</small>';
  $('piece-count').textContent=cart.reduce((sum,row)=>sum+row.qty,0)+' pieces';
  renderReceipt();
  $('save-bill').disabled=busy||!!saved||!cart.length;
  $('save-bill').textContent=pending?'Retry / confirm this bill':'Complete bill & update stock';
  for(const element of $('bill-form').querySelectorAll('input,select,button')) if(element.id!=='save-bill')element.disabled=!!saved||!!pending||busy;
  $('scan-code').disabled=!!saved||!!pending||busy;$('new-bill').disabled=!!pending||busy;
}
function renderReceipt(){
  $('receipt').innerHTML=receipt(saved||{shop,items:cart,customer:$('customer').value,mobile:$('mobile').value,payment:$('payment').value,discountCents:Math.round(Number($('discount').value||0)*100),receivedCents:Math.round(Number($('received').value||0)*100)},!saved);
  $('print-bill').disabled=!saved;
}
async function refreshDashboard(){const d=await api('/dashboard');$('stat-stock').textContent=d.inventory.pieces;$('stat-variants').textContent=d.inventory.variants+' product variants';$('stat-sales').textContent=money(d.today.totalCents);$('stat-today').textContent=d.today.count+' completed bills · IST';$('stat-bills').textContent=d.billCount;$('stat-cancelled').textContent=(d.sales.find(x=>x._id==='CANCELLED')?.count||0)+' cancelled';$('stat-low').textContent=d.inventory.low;}
async function show(view){
  await stopScanner();
  for(const name of ['billing','inventory','history','settings'])$(name+'-view').hidden=name!==view;
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('page-name').textContent={billing:'Billing desk',inventory:'Products & stock',history:'Bill history',settings:'Shop settings'}[view];
  if(view==='inventory')await loadProducts();if(view==='history')await loadBills();
  if(view==='settings')for(const [name,value] of Object.entries(shop))if($('settings-form').elements[name])$('settings-form').elements[name].value=value;
}
async function init(){
  shop=await api('/settings');$('workspace').hidden=false;$('login-screen').hidden=true;
  $('today').textContent=new Date().toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'long'});
  if(pending){for(const name of ['customer','mobile','payment','discount','received'])$(name).value=pending.payload[name];notify('An earlier checkout needs confirmation. Click Retry / confirm this bill; stock will not be deducted twice.');}
  renderCart();await refreshDashboard();
}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const btn=event.submitter;btn.disabled=true;try{await send('/login',{password:$('password').value});$('password').value='';$('login-error').textContent='';await init();}catch(error){$('login-error').textContent=error.message;}finally{btn.disabled=false;}});
$('logout').addEventListener('click',guard(async()=>{if(pending)throw Error('Resolve the pending bill before signing out.');await send('/logout',{});await stopScanner();location.reload();}));
document.querySelectorAll('nav button').forEach(button=>button.addEventListener('click',guard(()=>show(button.dataset.view))));
function addToCart(product){
  if(saved||pending||busy)throw Error('Start a new bill or resolve the pending checkout first.');
  if(product.stock<1)throw Error(`${product.name}: out of stock`);
  const existing=cart.find(row=>row._id===product._id);
  if(existing){if(existing.qty>=product.stock)throw Error(`Only ${product.stock} available`);Object.assign(existing,product,{qty:existing.qty+1});}else cart.push({...product,qty:1});
  renderCart();
}
$('scan-form').addEventListener('submit',guard(async event=>{event.preventDefault();addToCart(await api('/scan?code='+encodeURIComponent($('scan-code').value.trim())));$('scan-code').value='';$('scan-code').focus();}));
async function stopScanner(){if(scanner){try{await scanner.stop();}catch{}try{scanner.clear();}catch{}scanner=null;}$('scanner').hidden=true;$('stop-camera').hidden=true;}
$('camera').addEventListener('click',guard(async()=>{
  if(saved||pending)throw Error('Start a new bill or confirm the pending checkout first.');
  if(scanner)return;
  if(!window.Html5Qrcode)throw Error('QR scanner assets are missing. Run npm run build.');
  $('scanner').hidden=false;$('stop-camera').hidden=false;scanner=new Html5Qrcode('scanner');let accepted=false;
  try{await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:200,height:200}},async code=>{if(accepted)return;accepted=true;await stopScanner();try{addToCart(await api('/scan?code='+encodeURIComponent(code)));notify('Product scanned. Start the camera again for the next item.');}catch(error){notify(error.message);}},()=>{});}catch{await stopScanner();throw Error('Camera unavailable. Allow camera access on HTTPS, or use a USB scanner / type the SKU.');}
}));
$('stop-camera').addEventListener('click',stopScanner);
$('cart').addEventListener('change',event=>{if(!event.target.matches('[data-qty]')||saved||pending)return;const row=cart[Number(event.target.dataset.qty)],qty=Number(event.target.value);if(!Number.isInteger(qty)||qty<1||qty>row.stock){notify('Quantity must be within available stock.');}else row.qty=qty;renderCart();});
$('cart').addEventListener('click',event=>{const button=event.target.closest('[data-remove]');if(button&&!saved&&!pending){cart.splice(Number(button.dataset.remove),1);renderCart();}});
$('bill-form').addEventListener('input',renderReceipt);
$('paid-full').addEventListener('click',()=>{$('received').value=(Math.max(0,cartTotal())/100).toFixed(2);renderReceipt();});
$('refresh-cart').addEventListener('click',guard(async()=>{const fresh=await Promise.all(cart.map(row=>api('/scan?code='+encodeURIComponent('JMS:'+row._id))));cart=fresh.map((p,index)=>({...p,qty:cart[index].qty}));renderCart();await refreshDashboard();notify('Stock and prices refreshed. Review quantities and total.');}));
$('new-bill').addEventListener('click',()=>{if(pending||busy)return;if(!saved&&cart.length&&!confirm('Discard this unsaved cart?'))return;saved=null;cart=[];$('bill-form').reset();renderCart();$('scan-code').focus();});
$('bill-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||saved||!cart.length)return;
  if(cart.some(row=>row.qty>row.stock)){notify('Some quantities exceed stock. Refresh stock and reduce the quantity.');return;}
  if(cartTotal()<0){notify('Discount cannot exceed subtotal.');return;}
  if(!pending){const payload={requestKey:crypto.randomUUID(),items:cart.map(row=>({productId:row._id,qty:row.qty})),expectedTotalCents:cartTotal(),customer:$('customer').value,mobile:$('mobile').value,payment:$('payment').value,discount:Number($('discount').value),received:Number($('received').value)};pending={payload,cart};
    try{sessionStorage.setItem('jms-pending-checkout',JSON.stringify(pending));}catch{pending=null;notify('Browser session storage is unavailable. Enable it before billing so interrupted checkouts can be recovered.');return;}
  }
  busy=true;renderCart();
  try{saved=await send('/bills',pending.payload);pending=null;sessionStorage.removeItem('jms-pending-checkout');notify(`Bill ${saved.number} saved. Stock updated in MongoDB.`);await refreshDashboard();}
  catch(error){if(error.status && error.status>=400 && error.status<500 && error.status!==401){pending=null;sessionStorage.removeItem('jms-pending-checkout');}notify(error.message+(pending?' Retry this same bill to confirm its status.':''));}
  finally{busy=false;renderCart();}
});
function printContent(html){$('print-area').innerHTML=html;window.print();}
$('print-bill').addEventListener('click',()=>{if(saved)printContent(`<article class="receipt">${receipt(saved)}</article>`);});
function pagination(target,data,load){$(target).innerHTML=`<button data-page="${data.page-1}" ${data.page<=1?'disabled':''}>← Previous</button><span>${data.count} records · Page ${data.page} / ${data.pages}</span><button data-page="${data.page+1}" ${data.page>=data.pages?'disabled':''}>Next →</button>`;$(target).querySelectorAll('button').forEach(btn=>btn.addEventListener('click',guard(()=>load(Number(btn.dataset.page)))));}
async function loadProducts(p=productPage){productPage=p;const data=await api(`/products?page=${p}&q=${encodeURIComponent($('product-search').value)}&low=${$('low-only').checked?1:0}`);products=data.items;
  $('products').innerHTML=products.length?products.map(row=>`<tr><td><b>${esc(row.name)}</b><small>${esc(row.sku)} · ${esc(row.category)}</small></td><td>${esc(row.size)||'—'} / ${esc(row.color)||'—'}</td><td>${money(row.priceCents)}</td><td><span class="badge ${row.stock<=row.lowStock?'low':'good'}">${row.stock} pcs</span></td><td>${['Add','Edit','Stock','QR','Log'].map(action=>`<button data-action="${action}" data-id="${row._id}" ${action==='Add'&&row.stock<1?'disabled':''}>${action}</button>`).join('')}</td></tr>`).join(''):'<tr><td colspan="5">No products yet. Add your first size and colour variant.</td></tr>';
  pagination('product-pages',data,loadProducts);
}
$('product-search-form').addEventListener('submit',guard(async event=>{event.preventDefault();await loadProducts(1);}));
function editProduct(product=null){editId=product?._id||null;$('product-form').reset();$('product-dialog').querySelector('.dialog-error').textContent='';$('product-title').textContent=product?'Edit product variant':'Add product variant';$('opening-stock-label').hidden=!!product;
  if(product)for(const field of ['sku','name','size','color','category','price','gst','stock','lowStock'])$('product-form').elements[field].value=field==='price'?product.priceCents/100:field==='gst'?product.gstBps/100:product[field];$('product-dialog').showModal();}
$('add-product').addEventListener('click',()=>editProduct());
$('product-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.target,button=event.submitter;button.disabled=true;try{const body=Object.fromEntries(new FormData(form));for(const k of ['price','gst','stock','lowStock'])body[k]=Number(body[k]);await send('/products'+(editId?'/'+editId:''),body,editId?'PUT':'POST');$('product-dialog').close();await loadProducts();await refreshDashboard();notify('Product saved. Use QR to print its label.');}catch(error){errorIn(form,error);}finally{button.disabled=false;}});
$('products').addEventListener('click',guard(async event=>{const button=event.target.closest('[data-action]');if(!button)return;const product=products.find(x=>x._id===button.dataset.id);switch(button.dataset.action){
  case 'Add':addToCart(product);await show('billing');break;
  case 'Edit':editProduct(product);break;
  case 'Stock':stockProduct=product;stockPending=null;$('stock-form').reset();$('stock-dialog').querySelector('.dialog-error').textContent='';$('stock-product').textContent=`${product.name} · ${product.sku} · ${product.stock} pieces available`;$('stock-dialog').showModal();break;
  case 'QR':{const html=`<div class="qr-label"><h2>JMS TEXTILES</h2><img src="/api/products/${product._id}/qr" alt="QR for ${esc(product.sku)}"><p><b>${esc(product.name)}</b></p><p>${esc(product.size)} · ${esc(product.color)}</p><p>${esc(product.sku)}</p><p>${money(product.priceCents)}</p></div>`;detail('Product QR label',html);const print=document.createElement('button');print.textContent='Print label';print.addEventListener('click',async()=>{const image=$('detail-content').querySelector('img');await image.decode();$('print-area').innerHTML=html;await $('print-area').querySelector('img').decode();window.print();});$('detail-actions').append(print);break;}
  case 'Log':{const rows=await api(`/products/${product._id}/movements`);detail('Stock movement log',`<p>${esc(product.name)} · Latest 100 movements</p><div class="stock-history"><table><thead><tr><th>Date</th><th>Change</th><th>Reason</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${date(row.createdAt)}</td><td>${row.delta>0?'+':''}${row.delta}</td><td>${esc(row.type)}<small>${esc(row.reason)}</small></td></tr>`).join('')}</tbody></table></div>`);break;}
}}));
$('stock-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const body=stockPending||{delta:Number($('stock-delta').value),reason:$('stock-reason').value,requestKey:crypto.randomUUID()};stockPending=body;await send(`/products/${stockProduct._id}/stock`,body);stockPending=null;$('stock-dialog').close();await loadProducts();await refreshDashboard();notify('Stock updated.');}catch(error){errorIn(event.target,error);if(error.status&&error.status<500)stockPending=null;}finally{button.disabled=false;}});
function detail(title,html){$('detail-title').textContent=title;$('detail-content').innerHTML=html;$('detail-actions').replaceChildren();if(!$('detail-dialog').open)$('detail-dialog').showModal();}
async function loadBills(p=billPage){billPage=p;const data=await api(`/bills?page=${p}&q=${encodeURIComponent($('bill-search').value)}`);$('bills').innerHTML=data.items.length?data.items.map(bill=>`<tr><td><b>${esc(bill.number)}</b><small>${date(bill.createdAt)}</small></td><td>${esc(bill.customer||'Walk-in customer')}<small>${esc(bill.mobile)}</small></td><td>${money(bill.totalCents)}<small>${esc(bill.payment)} · Due ${money(bill.dueCents)}</small></td><td><span class="badge ${bill.status==='COMPLETED'?'good':'low'}">${bill.status}</span></td><td><button data-bill="${bill._id}">View bill</button></td></tr>`).join(''):'<tr><td colspan="5">No bills found.</td></tr>';pagination('bill-pages',data,loadBills);}
$('bill-search-form').addEventListener('submit',guard(async event=>{event.preventDefault();await loadBills(1);}));
async function openBill(id){const bill=await api('/bills/'+id);detail(bill.number,`<article class="receipt">${receipt(bill)}</article>`);const print=document.createElement('button');print.textContent='Print / Save PDF';print.onclick=()=>printContent(`<article class="receipt">${receipt(bill)}</article>`);$('detail-actions').append(print);
  if(bill.status==='COMPLETED'){const cancel=document.createElement('button');cancel.textContent='Cancel bill & restore stock';cancel.className='danger';cancel.addEventListener('click',guard(async()=>{const reason=prompt('Reason for cancellation (restores every item to stock):');if(!reason?.trim())return;if(!confirm('Cancel this bill and restore all its stock? Handle any payment refund separately.'))return;cancel.disabled=true;try{const updated=await send(`/bills/${id}/cancel`,{reason});if(saved?._id===id){saved=updated;renderReceipt();}await openBill(id);await loadBills();await refreshDashboard();notify('Bill cancelled and stock restored. No payment refund was processed.');}finally{cancel.disabled=false;}}));$('detail-actions').append(cancel);}
}
$('bills').addEventListener('click',guard(async event=>{const btn=event.target.closest('[data-bill]');if(btn)await openBill(btn.dataset.bill);}));
document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>$(btn.dataset.close).close()));
$('settings-form').addEventListener('submit',guard(async event=>{event.preventDefault();shop=await send('/settings',Object.fromEntries(new FormData(event.target)),'PUT');renderReceipt();notify('Shop details saved.');}));
window.addEventListener('beforeunload',event=>{if(cart.length&&!saved){event.preventDefault();event.returnValue='';}});
api('/session').then(init).catch(error=>{if(error.status!==401)$('login-error').textContent=error.message;});
