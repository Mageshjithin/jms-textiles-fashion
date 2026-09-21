// Sample catalog. Replace rows and local images with actual JMS Textiles inventory.
const women=['Sarees','Kurtis','Churidars','Salwar Suits','Anarkali Dresses','Gowns','Tops','Leggings','Nightwear','Casual Wear','Party Wear','Ethnic Wear'];
const girls=['Frocks','Party Frocks','Traditional Dresses','Lehenga Choli','Pattu Pavadai','Gowns','Tops & Bottom Sets','Casual Dresses','Festive Dresses'];
const names=['Kanjivaram Bloom Saree','Noor Embroidered Kurti','Jasmine Churidar Set','Vanya Ethnic Salwar Set','Meher Floral Anarkali','Ira Evening Gown','Everyday Cotton Top','Essential Stretch Leggings','Cloud Cotton Nightwear Set','Weekend Casual Dress','Ruby Celebration Dress','Heritage Ethnic Set','Daisy Cotton Frock','Mithra Party Frock','Little Lotus Traditional Set','Aarna Festive Lehenga','Nila Pattu Pavadai','Starshine Girls Gown','Sunny Day Top & Bottom Set','Playday Cotton Dress','Golden Bloom Festive Dress'];
const prices=[1399,749,1099,1099,1199,1499,599,399,699,849,1599,1399,599,899,1099,999,1299,1199,699,599,1099];
const tags=['Best Seller','Trending','New Arrivals','Best Seller','New Arrivals','New Arrivals','Trending','Offer','Offer','Trending','Offer','Festival','New Arrivals','Offer','Festival','Festival','Festival','Best Seller','Trending','New Arrivals','Festival'];
const slug=s=>s.toLowerCase().replace(/&/g,'').replace(/\s+/g,'-');
const products=[...women.map(type=>({cat:'Women',type})),...girls.map(type=>({cat:'Girls',type}))].map((p,i)=>({...p,id:slug(p.cat+' '+p.type),name:names[i],price:prices[i],old:prices[i]+300,tag:tags[i],sizes:p.cat==='Girls'?'2–10 Years':p.type==='Sarees'?'Free Size':'S, M, L, XL',img:'images/catalog/'+slug(p.cat+' '+p.type)+'.png'}));
const wa=(name='a dress from your collection')=>'https://wa.me/919876543211?text='+encodeURIComponent(`Hi JMS Textiles, I am interested in ${name}. Please share availability, sizes and ordering details.`);
document.querySelectorAll('[data-wa]').forEach(a=>{a.href=wa(a.dataset.wa==='general'?undefined:a.dataset.wa);a.target='_blank';a.rel='noopener'});
document.querySelectorAll('.chips').forEach(box=>{
 box.innerHTML=products.filter(p=>p.cat===box.dataset.group).map(p=>`<button class="category-choice" data-product="${p.id}" aria-pressed="false"><img src="${p.img}" alt="Sample ${p.type}" loading="lazy" width="80" height="100"><span>${p.type}</span></button>`).join('');
 box.querySelectorAll('button').forEach(b=>b.onclick=()=>{const p=products.find(p=>p.id===b.dataset.product);renderProducts(p.cat,p.type);document.querySelector('#collection').scrollIntoView()});
});
function card(p){return `<article class="product-card"><div class="product-image"><img src="${p.img}" alt="AI-generated sample of ${p.name}" loading="lazy" width="600" height="800"><span class="tag">${p.tag}</span></div><div class="product-info"><span class="meta">${p.cat} · ${p.type}</span><h3>${p.name}</h3><span class="sizes">Sample sizes: ${p.sizes}</span><div class="price"><span class="original">₹${p.old}</span><span class="offer">₹${p.price}</span></div><div class="card-actions"><button data-detail="${p.id}">View Details</button><a target="_blank" rel="noopener" href="${wa(p.name)}">Order on WhatsApp</a></div></div></article>`}
function renderProducts(cat='All',type='',tag=''){
 const list=products.filter(p=>(cat==='All'||p.cat===cat)&&(!type||p.type===type)&&(!tag||p.tag===tag));
 document.querySelector('.products-section h2').textContent=type?`${cat} · ${type}`:tag||(cat==='All'?'Latest collection':`${cat}’s collection`);
 document.querySelectorAll('[data-cat]').forEach(b=>{b.classList.toggle('active',b.dataset.cat===cat);b.setAttribute('aria-pressed',b.dataset.cat===cat)});
 document.querySelectorAll('.category-choice').forEach(b=>b.setAttribute('aria-pressed',b.dataset.product===slug(cat+' '+type)));
 document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.filter===tag));
 document.querySelector('#productGrid').innerHTML=list.length?list.map(card).join(''):'<p>No sample styles in this category yet.</p>';
 document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>showProduct(b.dataset.detail));
}
document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>renderProducts(b.dataset.cat));
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{renderProducts('All','',b.dataset.filter);document.querySelector('#collection').scrollIntoView()});
function showProduct(id){const p=products.find(p=>p.id===id);document.querySelector('#dialogBody').innerHTML=`<div class="dialog-content"><img src="${p.img}" alt="Sample ${p.name}"><div class="dialog-copy"><p class="eyebrow">${p.tag}</p><h2 id="detailTitle">${p.name}</h2><p>${p.cat} · ${p.type}</p><p>Sample sizes: <strong>${p.sizes}</strong></p><div class="price"><span class="original">₹${p.old}</span><span class="offer">₹${p.price}</span></div><p>AI-generated sample image. Prices and sizes are illustrative, not confirmed inventory. Ask us for availability and actual product photos.</p><a class="btn dark" target="_blank" rel="noopener" href="${wa(p.name)}">Order on WhatsApp</a></div></div>`;const d=document.querySelector('#productDialog');d.setAttribute('aria-labelledby','detailTitle');d.showModal()}
renderProducts();
