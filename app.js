/* Gourmet's City · données chiffrées avant synchronisation. */
const KEY = 'gourmetscity-gestion-v1';
const VERSION = 1;
const API = 'https://gourmetscity-gestion-api.footmaster-web.workers.dev';
const STATUS = {nouvelle:'Nouvelle',preparation:'En préparation',prete:'Prête',livraison:'En livraison',livree:'Livrée',annulee:'Annulée'};
const PAYMENT = ['Liquide','Orange Money','Wave'];
const CATEGORIES = ['Ingrédients','Emballages','Transport','Livraison','Loyer','Matériel','Marketing','Autre'];
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let state = {version:VERSION,orders:[],products:[],expenses:[]};
let cryptoKey = null;
let salt = null;
let activeView = 'dashboard';
let edit = null;
let deferredInstall = null;
let saving = false;
let envelopeCache = null;
let authToken = null;
let remoteRevision = null;
let accountExists = true;
let accountReady = false;
let accountLoading = false;
let recoveryMode = false;
let recoveryCode = null;
let recoveryKey = null;
let recoverySalt = null;
let pendingBackup = null;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('gourmetscity-gestion') : null;

function vault() { return new Promise((resolve,reject)=>{ const request=indexedDB.open(KEY,1); request.onupgradeneeded=()=>request.result.createObjectStore('vault'); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); }); }
async function readEnvelope() { const db=await vault(); return new Promise((resolve,reject)=>{ const tx=db.transaction('vault','readonly'); const request=tx.objectStore('vault').get('main'); request.onsuccess=()=>{envelopeCache=request.result||null;resolve(envelopeCache);}; request.onerror=()=>reject(request.error); tx.oncomplete=()=>db.close(); }); }
async function writeEnvelope(envelope) { const db=await vault(); return new Promise((resolve,reject)=>{ const tx=db.transaction('vault','readwrite'); tx.objectStore('vault').put(envelope,'main'); tx.oncomplete=()=>{envelopeCache=envelope;db.close();resolve();}; tx.onerror=()=>{db.close();reject(tx.error);}; }); }

function esc(value='') { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function money(n) { return new Intl.NumberFormat('fr-SN',{maximumFractionDigits:0}).format(Number(n)||0)+' F'; }
function dakDate(date=new Date()) { const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Dakar',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date); const get=type=>parts.find(p=>p.type===type).value; return `${get('year')}-${get('month')}-${get('day')}`; }
function dateLabel(value) { if (!value) return 'Date non précisée'; const [y,m,d]=value.split('-').map(Number); return new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(y,m-1,d)); }
function monthOf(value) { return (value||'').slice(0,7); }
function number(value) { return Math.max(0,Math.round(Number(value)||0)); }
function total(order) { return number(order.amount)+number(order.deliveryFee); }
function due(order) { return Math.max(0,total(order)-number(order.paid)); }
function uuid() { if(typeof crypto.randomUUID==='function') return crypto.randomUUID(); const bytes=crypto.getRandomValues(new Uint8Array(16)); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128; const value=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join(''); return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`; }
function notice(message,bad=false) { const editorError=$('#editor-error'); if ($('#editor-dialog').hasAttribute('open')&&editorError) { editorError.textContent=message; editorError.hidden=false; return; } const n=$('#notice'); n.textContent=message; n.hidden=false; n.style.background=bad?'#fff0f0':'#eaf7ee'; n.style.borderColor=bad?'#edb8c3':'#bfe6c9'; n.style.color=bad?'#a32645':'#256d43'; clearTimeout(notice.timer); notice.timer=setTimeout(()=>n.hidden=true,6000); }
function showDialog(dialog) { dialog.setAttribute('open',''); dialog.classList.add('dialog-fallback-open'); document.body.classList.add('dialog-fallback-open'); }
function closeDialog(dialog) { if (!dialog.hasAttribute('open')) return; dialog.removeAttribute('open'); dialog.classList.remove('dialog-fallback-open'); if (!$$('dialog.dialog-fallback-open[open]').length) document.body.classList.remove('dialog-fallback-open'); }
function b64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function unb64(value) { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)); }
function hex(bytes) { return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join(''); }
async function recoveryProof(code) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))); }
async function authProof(username,password) { const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']); const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(`gourmetscity-sync-auth-v1:${username}`),iterations:250000,hash:'SHA-256'},material,256); return hex(new Uint8Array(bits)); }
async function api(path,method='GET',data=null,token=authToken) { let response; const controller=typeof AbortController==='function'?new AbortController():null; const timer=controller?setTimeout(()=>controller.abort(),15000):null; try { response=await fetch(API+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{'Authorization':`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined,cache:'no-store',...(controller?{signal:controller.signal}:{})}); } catch(error) { if(error.name==='AbortError') throw Error('Le serveur met trop de temps à répondre. Vérifiez Internet et réessayez.'); throw Error('Connexion Internet indisponible. Réessayez quand le réseau revient.'); } finally { if(timer) clearTimeout(timer); } const result=await response.json().catch(()=>({})); if(!response.ok) throw Error(result.error||'Service indisponible. Réessayez.'); return result; }
async function derive(password,saltBytes) { const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']); return crypto.subtle.deriveKey({name:'PBKDF2',salt:saltBytes,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']); }
async function decrypt(envelope,key) { const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(envelope.iv)},key,unb64(envelope.data)); const parsed=JSON.parse(new TextDecoder().decode(clear)); if (parsed.version!==VERSION || !Array.isArray(parsed.orders)||!Array.isArray(parsed.products)||!Array.isArray(parsed.expenses)) throw Error('Sauvegarde incompatible'); return parsed; }
async function encryptState() { if (!cryptoKey||!salt) throw Error('Espace verrouillé'); return encryptWith(cryptoKey,salt); }
async function encryptWith(key,keySalt) { const iv=crypto.getRandomValues(new Uint8Array(12)); const bytes=new TextEncoder().encode(JSON.stringify(state)); const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes); return {version:VERSION,salt:b64(keySalt),iv:b64(iv),data:b64(new Uint8Array(cipher)),savedAt:new Date().toISOString()}; }
async function wrapRecovery() { const iv=crypto.getRandomValues(new Uint8Array(12)); const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,new TextEncoder().encode(recoveryCode)); return {iv:b64(iv),data:b64(new Uint8Array(cipher))}; }
async function unwrapRecovery(wrap) { const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(wrap.iv)},cryptoKey,unb64(wrap.data)); return new TextDecoder().decode(clear); }
async function persist() { if (!authToken||!remoteRevision) throw Error('Reconnectez-vous pour enregistrer.'); const envelope=await encryptWith(cryptoKey,salt); const recoveryEnvelope=await encryptWith(recoveryKey,recoverySalt); const result=await api('/snapshot','PUT',{revision:remoteRevision,envelope,recoveryEnvelope}); remoteRevision=result.revision; envelopeCache=envelope; await writeEnvelope(envelope).catch(()=>{}); channel?.postMessage('changed'); }
async function change(mutator) { if (saving) return false; saving=true; const before=JSON.stringify(state); try { mutator(); await persist(); render(); return true; } catch(error) { state=JSON.parse(before); notice(error.message||'Enregistrement impossible. Réessayez.',true); return false; } finally { saving=false; } }
function openApp() { $('#lock').hidden=true; $('#app').hidden=false; $('#today-label').textContent=dateLabel(dakDate()); showView('dashboard'); }
async function unlock(event) {
  event.preventDefault();
  const pass=$('#passphrase').value;
  const username=$('#username').value.trim().toLowerCase();
  let createdNow=false;
  const button=$('#unlock-button'), error=$('#lock-error');
  error.textContent='';
  if (!crypto?.subtle) { error.textContent='Ouvrez l’application via HTTPS pour protéger les données.'; return; }
  button.disabled=true;
  try {
    if(!username) throw Error('Saisissez votre identifiant.');
    if(pass.length<12) throw Error('Choisissez au moins 12 caractères.');
    const verifier=await authProof(username,pass);
    if(recoveryMode) {
      recoveryCode=$('#recovery-code').value.replace(/[\s-]/g,'').toLowerCase();
      if(!/^[a-f0-9]{48}$/.test(recoveryCode)) throw Error('Code de récupération invalide.');
      const recoveryVerifier=await recoveryProof(recoveryCode);
      const login=await api('/recover-login','POST',{username,recoveryVerifier},null);
      authToken=login.token;
      const remote=await api('/snapshot/recovery');
      remoteRevision=remote.revision;
      recoverySalt=unb64(remote.recoveryEnvelope.salt);
      recoveryKey=await derive(recoveryCode,recoverySalt);
      state=await decrypt(remote.recoveryEnvelope,recoveryKey);
      salt=crypto.getRandomValues(new Uint8Array(16));
      cryptoKey=await derive(pass,salt);
      const envelope=await encryptState();
      const wrappedRecovery=await wrapRecovery();
      const reset=await api('/reset-password','POST',{revision:remoteRevision,verifier,envelope,wrappedRecovery});
      authToken=reset.token; remoteRevision=reset.revision;
      envelopeCache=envelope; await writeEnvelope(envelope).catch(()=>{});
    } else if(accountExists) {
      const login=await api('/login','POST',{username,verifier},null);
      authToken=login.token;
      const remote=await api('/snapshot');
      remoteRevision=remote.revision;
      salt=unb64(remote.envelope.salt);
      cryptoKey=await derive(pass,salt);
      state=await decrypt(remote.envelope,cryptoKey);
      recoveryCode=await unwrapRecovery(remote.wrappedRecovery);
      recoverySalt=unb64(remote.recoveryEnvelope.salt);
      recoveryKey=await derive(recoveryCode,recoverySalt);
      envelopeCache=remote.envelope; await writeEnvelope(remote.envelope).catch(()=>{});
    } else {
      const setupCode=$('#setup-code').value.trim();
      if(!setupCode) throw Error('Saisissez le code de création du compte.');
      salt=crypto.getRandomValues(new Uint8Array(16));
      cryptoKey=await derive(pass,salt);
      recoveryCode=hex(crypto.getRandomValues(new Uint8Array(24)));
      recoverySalt=crypto.getRandomValues(new Uint8Array(16));
      recoveryKey=await derive(recoveryCode,recoverySalt);
      state={version:VERSION,orders:[],products:[],expenses:[],createdAt:new Date().toISOString()};
      const envelope=await encryptState();
      const recoveryEnvelope=await encryptWith(recoveryKey,recoverySalt);
      const wrappedRecovery=await wrapRecovery();
      const recoveryVerifier=await recoveryProof(recoveryCode);
      const setup=await api('/setup','POST',{username,verifier,recoveryVerifier,envelope,recoveryEnvelope,wrappedRecovery,setupCode},null);
      authToken=setup.token; remoteRevision=setup.revision; accountExists=true;
      createdNow=true;
      envelopeCache=envelope; await writeEnvelope(envelope).catch(()=>{});
    }
    $('#passphrase').value=''; $('#setup-code').value=''; $('#recovery-code').value='';
    try { await navigator.storage?.persist?.(); } catch {}
    openApp();
    if(createdNow) showRecovery();
    const last=state.lastBackupAt||state.createdAt;
    if(last && Date.now()-new Date(last).getTime()>30*864e5) notice('Pensez à télécharger une sauvegarde dans Réglages pour conserver vos données longtemps.',true);
  } catch(err) {
    error.textContent=err.message==='OperationError'?'Mot de passe ou code incorrect.':(err.message||'Impossible d’ouvrir les données.');
    cryptoKey=null; authToken=null; recoveryKey=null; recoveryCode=null;
  } finally { button.disabled=false; }
}
function showView(name) { activeView=name; $$('.view').forEach(el=>el.hidden=el.id!==`view-${name}`); $$('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===name)); const names={dashboard:'Vue d’ensemble',orders:'Commandes',products:'Produits',expenses:'Dépenses',settings:'Réglages'}; $('#page-title').textContent=names[name]; render(); window.scrollTo({top:0,behavior:'smooth'}); }
function nextNumber() { const day=dakDate().replace(/-/g,''); const prefix=`GC-${day}-`; const used=state.orders.filter(o=>o.number.startsWith(prefix)).map(o=>Number(o.number.slice(prefix.length))||0); return prefix+String(Math.max(0,...used)+1).padStart(3,'0'); }
function recordField(name,label,value='',opts={}) { const type=opts.type||'text'; const required=opts.required?'required':''; const min=opts.min!==undefined?`min="${opts.min}"`:''; const max=opts.max!==undefined?`max="${opts.max}"`:''; const step=type==='number'?'step="1"':''; const full=opts.full?'full':''; const placeholder=opts.placeholder?`placeholder="${esc(opts.placeholder)}"`:''; let input=type==='textarea'?`<textarea name="${name}" ${required} ${placeholder}>${esc(value)}</textarea>`:type==='select'?`<select name="${name}" ${required}>${opts.options.map(([v,t])=>`<option value="${esc(v)}" ${String(value)===v?'selected':''}>${esc(t)}</option>`).join('')}</select>`:`<input name="${name}" type="${type}" value="${esc(value)}" ${required} ${min} ${max} ${step} ${placeholder} ${opts.autocomplete?`autocomplete="${opts.autocomplete}"`:''}>`; return `<div class="field ${full}"><label>${esc(label)}${opts.required?' <span class="required">*</span>':''}</label>${input}${opts.help?`<small>${esc(opts.help)}</small>`:''}</div>`; }
function orderForm(o={}) { const essentials=[recordField('number','N° de commande',o.number||nextNumber(),{required:true}),recordField('date','Date de commande',o.date||dakDate(),{type:'date',required:true}),recordField('phone','Numéro du client',o.phone||'',{type:'tel',required:true,autocomplete:'tel',placeholder:'77 123 45 67'}),recordField('designation','Désignation',o.designation||'',{required:true,full:true,placeholder:'Ex. Box de 6 cupcakes'}),recordField('amount','Montant produits (FCFA)',o.amount??'',{type:'number',min:0,required:true}),recordField('location','Lieu de livraison',o.location||'',{full:true,placeholder:'Quartier, adresse, point de repère'}),recordField('method','Méthode de paiement',o.method||'Wave',{type:'select',options:PAYMENT.map(x=>[x,x])}),recordField('status','Statut de la commande',o.status||'nouvelle',{type:'select',options:Object.entries(STATUS)})].join(''); const extra=[recordField('customer','Nom du client',o.customer||'',{autocomplete:'name'}),recordField('quantity','Quantité',o.quantity??1,{type:'number',min:1,required:true}),recordField('deliveryFee','Frais de livraison (FCFA)',o.deliveryFee??0,{type:'number',min:0}),recordField('paid','Acompte / déjà encaissé (FCFA)',o.paid??0,{type:'number',min:0,help:'Le reste à encaisser est calculé automatiquement.'}),recordField('dueDate','Date de livraison prévue',o.dueDate||'',{type:'date'}),recordField('note','Notes / personnalisation',o.note||'',{type:'textarea',full:true,placeholder:'Goût, couleur, message sur le gâteau…'})].join(''); return essentials+`<details class="form-extra"><summary>Plus de détails : acompte, livraison, quantité…</summary><div class="extra-grid">${extra}</div></details>`; }
function productForm(p={}) { return [recordField('name','Produit',p.name||'',{required:true,full:true,placeholder:'Ex. Box sucrée'}),recordField('category','Catégorie',p.category||'',{placeholder:'Ex. Pâtisserie'}),recordField('price','Prix de vente (FCFA)',p.price??'',{type:'number',min:0,required:true}),recordField('cost','Coût estimé (FCFA)',p.cost??0,{type:'number',min:0}),recordField('stock','Stock actuel',p.stock??0,{type:'number',min:0,required:true}),recordField('lowStock','Seuil d’alerte',p.lowStock??3,{type:'number',min:0,help:'Une alerte apparaît quand le stock atteint ce niveau.'}),recordField('note','Notes',p.note||'',{type:'textarea',full:true})].join(''); }
function expenseForm(e={}) { return [recordField('date','Date',e.date||dakDate(),{type:'date',required:true}),recordField('category','Catégorie',e.category||'Ingrédients',{type:'select',options:CATEGORIES.map(x=>[x,x])}),recordField('description','Désignation',e.description||'',{required:true,full:true,placeholder:'Ex. Farine, emballages, taxi…'}),recordField('amount','Montant (FCFA)',e.amount??'',{type:'number',min:0,required:true}),recordField('method','Mode de paiement',e.method||'Liquide',{type:'select',options:PAYMENT.map(x=>[x,x])}),recordField('note','Notes',e.note||'',{type:'textarea',full:true})].join(''); }
function openEditor(kind,id=null) { try { edit={kind,id}; const list={order:'orders',product:'products',expense:'expenses'}[kind]; const item=id?state[list].find(x=>x.id===id):null; const titles={order:'commande',product:'produit',expense:'dépense'}; $('#dialog-kicker').textContent=id?'MODIFIER':'NOUVEAU'; $('#dialog-title').textContent=`${id?'Modifier':'Ajouter'} ${kind==='expense'?'une':'un'} ${titles[kind]}`; $('#form-fields').innerHTML=kind==='order'?orderForm(item):kind==='product'?productForm(item):expenseForm(item); $('#editor-error').hidden=true; $('#editor-error').textContent=''; showDialog($('#editor-dialog')); } catch(error) { edit=null; notice('Impossible d’ouvrir le formulaire. Rechargez la page et réessayez.',true); console.error('Ouverture du formulaire impossible',error); } }
function closeEditor() { closeDialog($('#editor-dialog')); edit=null; }
async function saveEditor(event) { event.preventDefault(); if (!edit||saving) return; const form=new FormData(event.target); const v=name=>String(form.get(name)||'').trim(); const kind=edit.kind; const list={order:'orders',product:'products',expense:'expenses'}[kind]; let item;
  if (kind==='order') { item={number:v('number'),date:v('date'),customer:v('customer'),phone:v('phone'),designation:v('designation'),quantity:number(v('quantity')),amount:number(v('amount')),deliveryFee:number(v('deliveryFee')),paid:number(v('paid')),location:v('location'),dueDate:v('dueDate'),method:v('method'),status:v('status'),note:v('note')}; if (!item.number||!item.date||!item.phone||!item.designation||v('amount')===''||item.quantity<1) return notice('Complétez les champs obligatoires.',true); if (item.paid>total(item)) return notice('Le montant encaissé dépasse le total de la commande.',true); if (state.orders.some(o=>o.number.toLowerCase()===item.number.toLowerCase()&&o.id!==edit.id)) return notice('Ce numéro de commande existe déjà.',true); }
  if (kind==='product') { item={name:v('name'),category:v('category'),price:number(v('price')),cost:number(v('cost')),stock:number(v('stock')),lowStock:number(v('lowStock')),note:v('note')}; if (!item.name||v('price')==='') return notice('Indiquez le nom et le prix du produit.',true); }
  if (kind==='expense') { item={date:v('date'),category:v('category'),description:v('description'),amount:number(v('amount')),method:v('method'),note:v('note')}; if (!item.date||!item.description||v('amount')==='') return notice('Complétez la date, la désignation et le montant.',true); }
  const id=edit.id; const saved=await change(()=>{ if(id){const index=state[list].findIndex(x=>x.id===id); if(index<0) throw Error('Élément introuvable'); state[list][index]={...state[list][index],...item,updatedAt:new Date().toISOString()};}else state[list].unshift({id:uuid(),...item,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}); }); if (saved) { closeEditor(); notice('Enregistré et synchronisé.'); }
}
function askDelete(kind,id) { const noun={order:'cette commande',product:'ce produit',expense:'cette dépense'}[kind]; $('#confirm-title').textContent=`Supprimer ${noun} ?`; $('#confirm-copy').textContent='Cette action sera synchronisée sur tous vos appareils.'; showDialog($('#confirm-dialog')); $('#confirm-yes').onclick=async()=>{ const list={order:'orders',product:'products',expense:'expenses'}[kind]; const saved=await change(()=>{ state[list]=state[list].filter(x=>x.id!==id); }); if(saved){closeDialog($('#confirm-dialog'));notice('Élément supprimé.');} }; }
function empty(message) { return `<div class="empty">${esc(message)}</div>`; }
function renderDashboard() { const now=dakDate(), month=monthOf(now); $('#month-label').textContent=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'Africa/Dakar'}).format(new Date()); const open=state.orders.filter(o=>!['livree','annulee'].includes(o.status)); const monthOrders=state.orders.filter(o=>monthOf(o.date)===month&&o.status!=='annulee'); const sales=monthOrders.filter(o=>o.status==='livree').reduce((n,o)=>n+total(o),0); const paid=monthOrders.reduce((n,o)=>n+number(o.paid),0); const exp=state.expenses.filter(e=>monthOf(e.date)===month).reduce((n,e)=>n+number(e.amount),0); $('#stat-open').textContent=open.length; $('#stat-sales').textContent=money(sales); $('#stat-paid').textContent=money(paid); $('#stat-expenses').textContent=money(exp); $('#stat-cash').textContent=money(paid-exp);
  const upcoming=open.slice().sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).slice(0,5); $('#upcoming-list').innerHTML=upcoming.length?upcoming.map(o=>`<div class="list-row"><div><strong>${esc(o.number)} · ${esc(o.designation)}</strong><small>${esc(o.customer||o.phone)} · ${o.dueDate?dateLabel(o.dueDate):'Date à préciser'}</small></div><span class="amount">${money(total(o))}</span></div>`).join(''):empty('Aucune commande en cours. Ajoutez la première commande pour démarrer.');
  const unpaid=state.orders.filter(o=>o.status!=='annulee'&&due(o)>0); const low=state.products.filter(p=>number(p.stock)<=number(p.lowStock)); $('#alerts-list').innerHTML=`<div class="list-row"><div><strong>Reste à encaisser</strong><small>${unpaid.length} commande${unpaid.length>1?'s':''} concernée${unpaid.length>1?'s':''}</small></div><span class="amount">${money(unpaid.reduce((n,o)=>n+due(o),0))}</span></div><div class="list-row"><div><strong>Stock à surveiller</strong><small>${low.length} produit${low.length>1?'s':''} au seuil d’alerte</small></div><span class="amount">${low.length}</span></div>`; }
function normalizePhone(phone) { let digits=String(phone||'').replace(/\D/g,''); if(digits.startsWith('00')) digits=digits.slice(2); if(digits.length===9) digits='221'+digits; return digits.length>=9?digits:''; }
function renderOrders() { const q=$('#order-search').value.toLowerCase().trim(), filter=$('#order-filter').value; const rows=state.orders.filter(o=>(filter==='all'||o.status===filter)&&(!q||[o.number,o.customer,o.phone,o.designation,o.location].join(' ').toLowerCase().includes(q))).sort((a,b)=>(b.date||'').localeCompare(a.date||'')); $('#orders-list').innerHTML=rows.length?rows.map(o=>`<article class="record-card"><div><div class="record-title"><strong>${esc(o.number)}</strong><span class="badge ${esc(o.status)}">${esc(STATUS[o.status]||o.status)}</span></div><p class="record-sub">${dateLabel(o.date)} · ${esc(o.customer||'Client sans nom')} · ${esc(o.phone)}</p><p class="record-detail"><strong>${esc(o.designation)}</strong> × ${number(o.quantity)}${o.location?` · ${esc(o.location)}`:''}</p><p class="record-sub">${o.dueDate?'Livraison prévue : '+dateLabel(o.dueDate)+' · ':''}${esc(o.method)}${o.note?' · '+esc(o.note):''}</p></div><div class="record-side"><div><strong>${money(total(o))}</strong><small>${number(o.paid)?'Acompte / encaissé '+money(o.paid)+' · ':''}${due(o)?'Reste '+money(due(o)):'Payée'}</small></div><div class="record-actions">${normalizePhone(o.phone)?`<a href="https://wa.me/${normalizePhone(o.phone)}" target="_blank" rel="noopener">WhatsApp</a>`:''}<button data-edit="order:${esc(o.id)}">Modifier</button><button class="delete" data-delete="order:${esc(o.id)}">Supprimer</button></div></div></article>`).join(''):empty('Aucune commande trouvée. Ajoutez une commande avec le bouton « Ajouter ».'); }
function renderProducts() { const q=$('#product-search').value.toLowerCase().trim(); const rows=state.products.filter(p=>[p.name,p.category].join(' ').toLowerCase().includes(q)).sort((a,b)=>a.name.localeCompare(b.name)); $('#products-list').innerHTML=rows.length?rows.map(p=>`<article class="product-card"><h3>${esc(p.name)}</h3><p>${esc(p.category||'Sans catégorie')}</p><div class="product-bottom"><div><span>Prix de vente</span><br><strong>${money(p.price)}</strong></div><div class="${number(p.stock)<=number(p.lowStock)?'warning':''}"><span>Stock</span><br><strong>${number(p.stock)}</strong></div></div>${p.note?`<p style="margin-top:13px">${esc(p.note)}</p>`:''}<div class="record-actions"><button data-edit="product:${esc(p.id)}">Modifier</button><button class="delete" data-delete="product:${esc(p.id)}">Supprimer</button></div></article>`).join(''):empty('Aucun produit trouvé. Ajoutez vos produits et renseignez leurs prix.'); }
function renderExpenses() { const q=$('#expense-search').value.toLowerCase().trim(), filter=$('#expense-filter').value; const rows=state.expenses.filter(e=>(filter==='all'||monthOf(e.date)===monthOf(dakDate()))&&(!q||[e.description,e.category,e.method].join(' ').toLowerCase().includes(q))).sort((a,b)=>(b.date||'').localeCompare(a.date||'')); $('#expenses-list').innerHTML=rows.length?rows.map(e=>`<article class="record-card"><div><div class="record-title"><strong>${esc(e.description)}</strong><span class="badge">${esc(e.category)}</span></div><p class="record-sub">${dateLabel(e.date)} · ${esc(e.method)}${e.note?' · '+esc(e.note):''}</p></div><div class="record-side"><strong>${money(e.amount)}</strong><div class="record-actions"><button data-edit="expense:${esc(e.id)}">Modifier</button><button class="delete" data-delete="expense:${esc(e.id)}">Supprimer</button></div></div></article>`).join(''):empty('Aucune dépense trouvée. Ajoutez les achats et frais de l’atelier.'); }
function render() { if ($('#app').hidden) return; renderDashboard(); renderOrders(); renderProducts(); renderExpenses(); }
function download(name,text,type) { const blob=new Blob([text],{type}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(link.href),3000); }
async function signOut() { try { await api('/logout','POST'); } catch {} location.reload(); }
async function exportBackup() { if(!envelopeCache) envelopeCache=await encryptState(); download(`gourmetscity-sauvegarde-${dakDate()}.json`,JSON.stringify(envelopeCache),'application/json'); state.lastBackupAt=new Date().toISOString(); try { await persist(); notice('Sauvegarde chiffrée téléchargée. Gardez aussi le mot de passe et le fichier.'); } catch(error) { notice('Fichier téléchargé, mais la date de sauvegarde n’a pas pu être synchronisée : '+error.message,true); } }
async function importBackup(file) { if(!file) return; try { const parsed=JSON.parse(await file.text()); if(parsed.version!==VERSION||!parsed.salt||!parsed.iv||!parsed.data||typeof parsed.data!=='string') throw Error('Fichier incompatible'); pendingBackup=parsed; $('#restore-error').textContent=''; showDialog($('#restore-dialog')); } catch { notice('Ce fichier n’est pas une sauvegarde valide.',true); } }
async function restoreBackup(event) { event.preventDefault(); if(!pendingBackup) return; const button=event.submitter; button.disabled=true; try { const password=$('#restore-password').value; const backupKey=await derive(password,unb64(pendingBackup.salt)); const restored=await decrypt(pendingBackup,backupKey); if(await change(()=>{state=restored;})){ closeDialog($('#restore-dialog')); pendingBackup=null; $('#restore-password').value=''; notice('Sauvegarde restaurée et synchronisée.'); } } catch { $('#restore-error').textContent='Mot de passe ou sauvegarde invalide.'; } finally { button.disabled=false; } }
function exportCSV() { const heads=['N° de commande','Date','Client','Numéro du client','Désignation','Quantité','Montant produits','Frais livraison','Montant total','Encaissé','Reste à payer','Lieu de livraison','Date livraison','Méthode paiement','Statut','Notes']; const rows=state.orders.map(o=>[o.number,o.date,o.customer,o.phone,o.designation,o.quantity,o.amount,o.deliveryFee,total(o),o.paid,due(o),o.location,o.dueDate,o.method,STATUS[o.status]||o.status,o.note]); const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"'; download(`gourmetscity-commandes-${dakDate()}.csv`,'\uFEFF'+[heads,...rows].map(row=>row.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8'); }
function bindEvents() {
  $('#unlock-button').addEventListener('click',event=>{ if(!accountReady) { event.preventDefault(); if(!accountLoading) loadAccount(); } });
  $('#lock-form').addEventListener('submit',event=>{ if(!accountReady) { event.preventDefault(); if(!accountLoading) loadAccount(); return; } unlock(event); });
  $('#recovery-toggle').onclick=toggleRecovery;
  $('#show-recovery').onclick=showRecovery;
  $('#close-recovery').onclick=()=>closeDialog($('#recovery-dialog'));
  $('#download-recovery').onclick=()=>download('gourmetscity-code-recuperation.txt',"Code de récupération Gourmet's City : "+recoveryCode+'\nConservez ce fichier séparément de votre téléphone.','text/plain;charset=utf-8');
  $$('[data-view]').forEach(el=>el.onclick=()=>showView(el.dataset.view));
  $$('[data-go]').forEach(el=>el.onclick=()=>showView(el.dataset.go));
  $$('[data-add]').forEach(el=>el.onclick=()=>openEditor(el.dataset.add));
  $('#quick-order').onclick=()=>openEditor('order');
  $('#close-dialog').onclick=closeEditor;
  $('#cancel-dialog').onclick=closeEditor;
  $('#editor-form').addEventListener('submit',saveEditor);
  $('#confirm-cancel').onclick=()=>closeDialog($('#confirm-dialog'));
  ['order-search','order-filter','product-search','expense-search','expense-filter'].forEach(id=>$('#'+id).addEventListener('input',render));
  document.addEventListener('click',e=>{ const editButton=e.target.closest('[data-edit]'),deleteButton=e.target.closest('[data-delete]'); if(editButton){const [kind,id]=editButton.dataset.edit.split(':');openEditor(kind,id);} if(deleteButton){const [kind,id]=deleteButton.dataset.delete.split(':');askDelete(kind,id);} });
  $('#export-backup').onclick=exportBackup;
  $('#import-backup').onclick=()=>$('#restore-file').click();
  $('#restore-file').onchange=e=>importBackup(e.target.files[0]);
  $('#restore-form').addEventListener('submit',restoreBackup);
  $('#cancel-restore').onclick=()=>{closeDialog($('#restore-dialog'));pendingBackup=null;$('#restore-password').value='';};
  $('#export-csv').onclick=exportCSV;
  $('#lock-button').onclick=signOut;
  $('#settings-logout').onclick=signOut;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#install-button').hidden=false;});
  $('#install-button').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();deferredInstall=null;}};
}
async function loadAccount() {
  if(accountLoading) return;
  accountLoading=true;
  accountReady=false;
  const button=$('#unlock-button');
  button.disabled=true;
  button.textContent='Vérification…';
  $('#lock-error').textContent='';
  try {
    const account=await api('/account');
    accountExists=account.exists;
    if(account.exists){$('#lock-title').textContent='Ravi de vous retrouver.';$('#lock-copy').textContent='Saisissez le mot de passe choisi lors de la création du compte pour retrouver vos données sur cet appareil.';button.textContent='Se connecter';$('#recovery-toggle').hidden=false;}
    else{$('#lock-title').textContent='Créez votre espace privé.';$('#lock-copy').textContent='Choisissez un mot de passe et saisissez le code de création fourni par le propriétaire.';button.textContent='Créer mon compte';$('#setup-fields').hidden=false;$('#setup-code').required=true;}
    accountReady=true;
  } catch(error) {
    $('#lock-error').textContent=error.message;
    button.textContent='Réessayer';
  } finally {
    accountLoading=false;
    button.disabled=false;
  }
}
function init() {
  bindEvents();
  if('serviceWorker' in navigator&&location.protocol==='https:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshRemote();});
  channel?.addEventListener('message',()=>{if(!$('#app').hidden)refreshRemote();});
  loadAccount();
}
function showRecovery() { if(!recoveryCode) return; $('#recovery-display').textContent=recoveryCode; showDialog($('#recovery-dialog')); }
function toggleRecovery() { recoveryMode=!recoveryMode; $('#recovery-fields').hidden=!recoveryMode; $('#recovery-code').required=recoveryMode; $('#password-label').textContent=recoveryMode?'Nouveau mot de passe':'Mot de passe'; $('#passphrase').autocomplete=recoveryMode?'new-password':'current-password'; $('#unlock-button').textContent=recoveryMode?'Réinitialiser le mot de passe':'Se connecter'; $('#recovery-toggle').textContent=recoveryMode?'Retour à la connexion':'Mot de passe oublié ?'; $('#lock-error').textContent=''; }
async function refreshRemote() { if(!authToken||saving||$('#editor-dialog').hasAttribute('open')||$('#confirm-dialog').hasAttribute('open')) return; try { const remote=await api('/snapshot'); if(remote.revision===remoteRevision) return; state=await decrypt(remote.envelope,cryptoKey); remoteRevision=remote.revision; recoveryCode=await unwrapRecovery(remote.wrappedRecovery); recoverySalt=unb64(remote.recoveryEnvelope.salt); recoveryKey=await derive(recoveryCode,recoverySalt); envelopeCache=remote.envelope; await writeEnvelope(remote.envelope).catch(()=>{}); render(); notice('Données mises à jour depuis un autre appareil.'); } catch(error) { notice(error.message,true); } }
init();
