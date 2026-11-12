/* Zoe's Hirn – App
   Daten: Supabase (Tabelle eintraege, Fotos im Speicher "fotos"), Live-Abgleich zwischen den Handys.
   Erinnerungen: Hausaufgaben 2 Tage vorher, Prüfungen 5 und 2 Tage vorher, Wochenende → Freitag. */
(function(){
'use strict';
const SUPABASE_URL = 'https://mqvfzjdytkmhidaondss.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eJMgQJXY6g67FrcN3NkniA_k7YRANMn';
const VAPID_PUBLIC = 'BGsR9cVk2i8NuaFUFUCG0sSHCVx-fPceuuI31Go01lrc0m1sCbel0EmWf-L6xfyS9wGudvJGDEbRCcIfubwSMDI';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const SUBJ = {
  M:{n:'Mathe',a:'M',c:'#2f5bd3'}, D:{n:'Deutsch',a:'D',c:'#d3334b'}, E:{n:'Englisch',a:'E',c:'#7a4bd1'}, MU:{n:'Musik',a:'Mu',c:'#d4499a'},
  GEO:{n:'Geo',a:'Geo',c:'#17936a'}, BIO:{n:'Bio',a:'Bio',c:'#5c9a1d'}, GS:{n:'Geschichte',a:'Ge',c:'#a36a2c'}, PH:{n:'Physik',a:'Ph',c:'#1b8fb3'},
  DGB:{n:'DGB',a:'DGB',c:'#5a6680'}, LC:{n:'LC',a:'LC',c:'#d9730f'}
};
const HA_SUBJ = ['M','D','E','MU','GEO','BIO','GS','PH','DGB','LC'];
const KIND = {
  ha:{n:'Hausaufgabe',s:'HÜ',c:'ha'},
  sa:{n:'Schularbeit',s:'SA',c:'sa',subj:['M','D','E']},
  test:{n:'Test',s:'Test',c:'test',subj:['MU','GEO','GS','BIO','PH']},
  vok:{n:'Vokabelquiz',s:'Vok',c:'learn',subj:['E']},
  lw:{n:'Lernwörter',s:'LW',c:'learn',subj:['D']},
  ged:{n:'Gedicht',s:'Ged',c:'learn',subj:['D']},
  swh:{n:'Stundenwiederh.',s:'SWH',c:'learn',subj:['MU']}
};
const TM_KINDS = ['sa','test','vok','lw','ged','swh'];
const WD = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const CACHE_KEY = 'zh-eintraege';

/* ---------- Datum ---------- */
let today, T;
function setToday(){ today = new Date(); today.setHours(0,0,0,0); T = iso(today); }
const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const parse = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
const add = (d,n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const diff = s => Math.round((parse(s)-today)/864e5);
const dm = s => { const d = parse(s); return String(d.getDate()).padStart(2,'0')+'.'+String(d.getMonth()+1).padStart(2,'0')+'.'; };
const wdm = s => WD[parse(s).getDay()]+' '+dm(s);
const cd = n => n<0 ? 'überfällig' : n===0 ? 'heute' : n===1 ? 'morgen' : 'in '+n+' Tagen';
const isWe = d => d.getDay()===0 || d.getDay()===6;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
setToday();

/* Erinnerungstage – genau wie auf dem Server */
function reminderDays(i){
  const offs = i.art==='ha' ? [2] : [5,2];
  const out = offs.map(n => { let d = add(parse(i.faellig), -n); if (d.getDay()===6) d = add(d,-1); if (d.getDay()===0) d = add(d,-2); return iso(d); });
  return [...new Set(out)];
}

/* ---------- Zustand ---------- */
let items = [], tab = 'cal', selDay = null, blk = 0, form = null, confirmDel = false, busy = false;
let fotoUrls = {}, channel = null, toastTimer = null;
const $ = id => document.getElementById(id);
const $view = $('view'), $sheet = $('sheet'), $bg = $('sheetBg');

const ico = {
  cam:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  chk:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  fwd:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  back:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
};
/* Ein Eintrag ist ab 16:00 an seinem Fälligkeitstag vorbei und verschwindet aus den Listen */
const vorbei16 = () => new Date().getHours() >= 16;
const aktiv = i => !i.erledigt && (i.faellig > T || (i.faellig === T && !vorbei16()));
const open = () => items.filter(aktiv);
const byDue = arr => arr.slice().sort((a,b) => a.faellig.localeCompare(b.faellig));
const what = i => KIND[i.art].n;
const kindColor = k => getComputedStyle(document.documentElement).getPropertyValue('--'+KIND[k].c).trim();

/* ---------- Laden & Live-Abgleich ---------- */
/* Demo nur lokal am Mac (localhost/#demo) zum Ausprobieren ohne Konto */
const DEMO = location.hostname==='localhost' && location.hash==='#demo';
function demoDaten(){
  const r = n => iso(add(today,n)), w = n => { let d = add(today,n); while (isWe(d)) d = add(d,1); return iso(d); };
  return [
    ['ha','M','Buch S. 54, Nr. 3–7',-1,w(2)],['ha','M','Arbeitsblatt Brüche',0,w(6)],['ha','D','Nacherzählung „Der Fuchs“',-2,w(1)],
    ['ha','E','Workbook p. 38, ex. 1–3',-1,w(3)],['ha','BIO','Blatt einkleben',-1,w(2)],['ha','LC','Wochenplan ausfüllen',0,w(2)],
    ['sa','M','Brüche, Dezimalzahlen (S. 30–58)',-10,w(7)],['vok','E','Unit 3, S. 120–122',-2,w(4)],['test','BIO','Der Wald',-5,w(5)],
    ['ged','D','„Herbsttag“ auswendig',-6,w(11)],['swh','MU','Instrumente des Orchesters',-1,w(2)],['ha','GEO','Karte Europa beschriften',-2,r(0)]
  ].map(([art,fach,text,e,f],k) => ({ id:'demo'+k, art, fach, text, foto:null, eingetragen:r(e), faellig:f, erledigt:false, erledigt_am:null }));
}

async function load(){
  if (DEMO){ render(); return; }
  const seit = new Date(Date.now()-30*864e5).toISOString();
  const { data, error } = await sb.from('eintraege').select('*').or(`erledigt.eq.false,erledigt_am.gte.${seit}`).order('faellig');
  if (error){ $('offline').hidden = false; return; }
  $('offline').hidden = true;
  items = data;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items)); } catch(e){}
  render();
}
function live(){
  if (channel) return;
  channel = sb.channel('eintraege-live')
    .on('postgres_changes', { event:'*', schema:'public', table:'eintraege' }, () => load())
    .subscribe();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState==='visible' && !$('main').hidden){ setToday(); $('heuteLbl').textContent = heuteText(); load(); }
});
window.addEventListener('online', () => { if (!$('main').hidden) load(); });

/* Um 16:00 (heutige Einträge verschwinden) und nach Mitternacht neu zeichnen, auch wenn die App offen bleibt */
let uhrStand = '';
setInterval(() => {
  const jetzt = new Date(), st = iso(jetzt) + (jetzt.getHours() >= 16 ? 'b' : 'a');
  if (uhrStand && st !== uhrStand && !$('main').hidden){ setToday(); $('heuteLbl').textContent = heuteText(); render(); }
  uhrStand = st;
}, 30000);

/* ---------- Ansichten ---------- */
const heuteText = () => 'Heute: ' + ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'][today.getDay()] + ', ' + dm(T);

function row(i){
  const k = KIND[i.art], n = diff(i.faellig), d = parse(i.faellig);
  const zeit = i.erledigt ? '✓ erledigt' : cd(n);
  return `<button class="row" data-act="detail" data-id="${i.id}">
    <span class="date k-${k.c}"><small>${WD[d.getDay()]}</small><b>${d.getDate()}.</b></span>
    <span class="mid"><span class="t1">${SUBJ[i.fach].n} · ${what(i)}${i.art==='ha'?' fällig':''}</span><span class="t2">${i.foto?'📷 ':''}${esc(i.text||'Foto')}</span></span>
    <span class="cd ${!i.erledigt&&n<=2?'hot':''}">${zeit}</span></button>`;
}

const BLK_MAX = 4; /* 4 × 3 Wochen = 12 Wochen ≈ 3 Monate vor und zurück */
function renderCal(){
  let start = add(today, -((today.getDay()+6)%7));
  if (isWe(today)) start = add(start,7);
  start = add(start, blk*21);
  const days = []; for (let w=0; w<3; w++) for (let d=0; d<5; d++) days.push(iso(add(start, w*7+d)));
  const o = open();
  const imKal = s => items.filter(i => i.faellig===s && (s<T || (s===T ? aktiv(i) : !i.erledigt)));
  const jahr = parse(days[14]).getFullYear();
  let h = `<div class="blk-top"><b>${dm(days[0])} – ${dm(days[14])}${jahr}</b>${blk?`<button class="back" data-act="blk" data-n="0">Heute</button>`:''}</div>`;
  h += '<div class="wk-head">'+['Mo','Di','Mi','Do','Fr'].map(x=>`<span>${x}</span>`).join('')+'</div><div class="grid">';
  days.forEach((s,ix) => {
    const its = imKal(s).sort((a,b) => (a.erledigt - b.erledigt) || ((a.art==='ha') - (b.art==='ha')));
    const d = parse(s), first = ix===0 || (d.getDate()<=3 && ix%5===0) || d.getDate()===1;
    const cls = ['day', s===T?'today':'', s<T?'past':'', selDay===s?'sel':''].join(' ');
    h += `<button class="${cls}" data-act="day" data-d="${s}" aria-label="${wdm(s)}"><span class="n">${d.getDate()}.${first?(d.getMonth()+1)+'.':''}</span>`;
    const show = its.length>4 ? its.slice(0,3) : its;
    show.forEach(i => h += `<span class="pill k-${KIND[i.art].c}${i.erledigt?' done':''}">${SUBJ[i.fach].a} ${KIND[i.art].s}</span>`);
    if (its.length>4) h += `<span class="more">+${its.length-3} mehr</span>`;
    h += '</button>';
  });
  h += '</div>';
  const nb = (n, txt, dis) => `<button class="blk-btn" data-act="blk" data-n="${n}"${dis?' disabled':''}>${txt}</button>`;
  h += `<div class="blk-nav">${nb(blk-1, ico.back+'3 Wochen zurück', blk<=-BLK_MAX)}${nb(blk+1, '3 Wochen weiter'+ico.fwd, blk>=BLK_MAX)}</div>`;
  h += '<div class="legend"><span class="pill k-ha">Hausaufgabe</span><span class="pill k-sa">Schularbeit</span><span class="pill k-test">Test</span><span class="pill k-learn">Kleiner Test</span></div>';
  const list = selDay ? byDue(imKal(selDay)) : blk ? byDue(items.filter(i => i.faellig>=days[0] && i.faellig<=days[14] && (i.faellig<T || (i.faellig===T ? aktiv(i) : !i.erledigt)))) : byDue(o.filter(i => i.faellig>=T && i.faellig<=days[14]));
  h += `<div class="sec" id="listTop"><h3>${selDay ? wdm(selDay) : blk ? 'In diesen 3 Wochen' : 'Was kommt'}</h3>${selDay?`<button class="back" data-act="all">${ico.back}Ganze Übersicht</button>`:''}</div>`;
  h += list.length ? list.map(row).join('') : `<div class="empty">${selDay?'An diesem Tag ist nichts fällig.':blk ? 'In diesen 3 Wochen ist nichts eingetragen.' : 'Nichts eingetragen. Tippe oben auf „+“.'}</div>`;
  $view.innerHTML = h;
}

function itemLine(i){
  const n = diff(i.faellig);
  return `<div class="item"><button class="chk" data-act="done" data-id="${i.id}" aria-label="Erledigt">${ico.chk}</button>
    <button class="item-b" data-act="detail" data-id="${i.id}"><div class="tx">${esc(i.text||'Foto')}</div>
    <div class="meta"><span>eingetragen ${dm(i.eingetragen)}</span><span class="due ${n<=1?'hot':''}">fällig ${wdm(i.faellig)}</span>${i.foto?`<span class="cam">${ico.cam}Foto</span>`:''}</div></button></div>`;
}

function renderHA(){
  const o = open().filter(i => i.art==='ha');
  let h = '', none = [];
  HA_SUBJ.forEach(s => {
    const its = byDue(o.filter(i => i.fach===s));
    if (!its.length){ none.push(s); return; }
    h += `<div class="subj"><h4><span class="dot" style="background:${SUBJ[s].c}"></span>${SUBJ[s].n}<span class="badge">${its.length} offen</span></h4>${its.map(itemLine).join('')}
      <button class="add-line" data-act="add" data-mode="ha" data-s="${s}">+ Hausaufgabe für ${SUBJ[s].n}</button></div>`;
  });
  if (!h) h = '<div class="empty">Alle Hausaufgaben erledigt. 🎉</div>';
  if (none.length) h += `<div class="sec"><h3>Nichts offen</h3></div><div class="chips">${none.map(s=>`<button class="chip" data-act="add" data-mode="ha" data-s="${s}">+ ${SUBJ[s].n}</button>`).join('')}</div>`;
  $view.innerHTML = h;
}

function renderTM(){
  const o = byDue(open().filter(i => i.art!=='ha'));
  const groups = [['Schularbeiten & Tests', i => i.art==='sa'||i.art==='test'], ['Kleine Tests', i => KIND[i.art].c==='learn']];
  let h = '<button class="btn pri tm-add" data-act="add" data-mode="tm">+ Schularbeit oder Test eintragen</button>';
  groups.forEach(([t,f]) => {
    const l = o.filter(f);
    h += `<div class="sec"><h3>${t}</h3></div>` + (l.length ? l.map(row).join('') : '<div class="empty">Nichts eingetragen.</div>');
  });
  $view.innerHTML = h;
}

function render(){
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab===tab));
  ({cal:renderCal, ha:renderHA, tm:renderTM})[tab]();
}

/* ---------- Fenster ---------- */
function showSheet(html){ $sheet.innerHTML = '<div class="grab"></div>'+html; $sheet.hidden = false; $bg.hidden = false; }
function closeSheet(){ $sheet.hidden = true; $bg.hidden = true; form = null; confirmDel = false; }
function toast(text, undo){
  const t = $('toast'); clearTimeout(toastTimer);
  t.innerHTML = esc(text) + (undo ? '<button data-act="undo">Rückgängig</button>' : '');
  t.hidden = false; t._undo = undo || null;
  toastTimer = setTimeout(() => { t.hidden = true; t._undo = null; }, undo ? 6000 : 3000);
}

async function fotoUrl(path){
  if (!path) return null;
  if (fotoUrls[path]) return fotoUrls[path];
  const { data } = await sb.storage.from('fotos').createSignedUrl(path, 60*60*6);
  if (data) fotoUrls[path] = data.signedUrl;
  return data ? data.signedUrl : null;
}

function openAdd(mode, subj){
  mode = mode || (tab==='tm' ? 'tm' : 'ha');
  form = {id:null, mode, fach: subj || null, art: mode==='ha' ? 'ha' : null, text:'', foto:null, alteFoto:null, neuBlob:null, neuVorschau:null, faellig:null, err:''};
  renderAdd();
}
async function openEdit(id){
  const i = items.find(x => x.id===id); if (!i) return;
  form = {id:i.id, mode: i.art==='ha'?'ha':'tm', fach:i.fach, art:i.art, text:i.text||'', foto:i.foto, alteFoto:i.foto, neuBlob:null, neuVorschau:null, faellig:i.faellig, err:''};
  if (i.foto) form.neuVorschau = await fotoUrl(i.foto);
  renderAdd();
}
const tile = (on, act, attr, color, label, sq) =>
  `<button class="tile ${on?'on':''}" data-act="${act}" ${attr}><span class="${sq?'kd':'dot'}" style="background:${color}"></span><span>${label}</span></button>`;

function renderAdd(){
  const f = form;
  let h = `<h2>${f.id?'Eintrag bearbeiten':'Neuer Eintrag'}</h2>
    <div class="seg"><button class="${f.mode==='ha'?'on':''}" data-act="mode" data-mode="ha">Hausaufgabe</button><button class="${f.mode==='tm'?'on':''}" data-act="mode" data-mode="tm">Schularbeit / Test</button></div>`;
  if (f.mode==='ha'){
    h += `<div class="lbl">Fach</div><div class="tiles">${HA_SUBJ.map(s => tile(f.fach===s,'subj',`data-s="${s}"`,SUBJ[s].c,SUBJ[s].n)).join('')}</div>`;
  } else {
    h += `<div class="lbl">Was ist es?</div><div class="tiles kinds">${TM_KINDS.map(k => tile(f.art===k,'kind',`data-k="${k}"`,kindColor(k),KIND[k].n,true)).join('')}</div>`;
    if (f.art){
      const subs = KIND[f.art].subj;
      h += `<div class="lbl">Fach</div>` + (subs.length===1
        ? `<div class="fixed"><span class="dot" style="background:${SUBJ[subs[0]].c}"></span>${SUBJ[subs[0]].n}</div>`
        : `<div class="tiles">${subs.map(s => tile(f.fach===s,'subj',`data-s="${s}"`,SUBJ[s].c,SUBJ[s].n)).join('')}</div>`);
    }
  }
  h += `<div class="lbl">${f.mode==='ha'?'Was ist zu tun?':'Welcher Stoff?'}</div>
    <textarea id="fText" placeholder="${f.mode==='ha'?'z. B. Buch S. 54, Nr. 3–7':'z. B. Unit 3, Vokabeln S. 120–122'}">${esc(f.text)}</textarea>
    <div style="margin-top:8px"><label class="photo-btn">${ico.cam}<span>${f.neuVorschau?'Anderes Foto':'Foto machen oder auswählen'}</span><input type="file" id="fPhoto" accept="image/*"></label>
    ${f.neuVorschau?`<div class="thumb"><img src="${f.neuVorschau}" alt="Foto zum Eintrag"><button data-act="nophoto">Entfernen</button></div>`:''}</div>
    <div class="lbl">${f.mode==='ha'?'Fällig bis':'Wann?'}</div><div class="dates">`;
  for (let n=0, c=0; c<10; n++){
    const d = add(today,n); if (isWe(d)) continue; c++;
    const s = iso(d);
    h += `<button class="dbtn ${s===T?'today':''} ${f.faellig===s?'on':''}" data-act="due" data-d="${s}"><small>${s===T?'Heute':WD[d.getDay()]}</small><b>${dm(s)}</b></button>`;
  }
  h += `</div><div class="custom"><label for="fDate">Anderes Datum:</label><input type="date" id="fDate" value="${f.faellig||''}"></div>
    ${f.err?`<div class="err">${esc(f.err)}</div>`:''}
    <div class="actions"><button class="btn sec" data-act="close">Abbrechen</button><button class="btn pri" data-act="save" ${busy?'disabled':''}>${busy?'Speichert …':'Speichern'}</button></div>`;
  const keep = $sheet.hidden ? 0 : $sheet.scrollTop;
  showSheet(h); $sheet.scrollTop = keep;
}

async function openDetail(id){
  const i = items.find(x => x.id===id); if (!i) return;
  const k = KIND[i.art], n = diff(i.faellig);
  const rem = reminderDays(i).map(wdm).join(' und ');
  const html = url => `<span class="tag k-${k.c}">${k.n}</span><h2>${SUBJ[i.fach].n}</h2>
    <dl class="dl"><dt>${i.art==='ha'?'Fällig':'Am'}</dt><dd>${wdm(i.faellig)} · ${cd(n)}</dd><dt>Eingetragen</dt><dd>${dm(i.eingetragen)}</dd><dt>Erinnerung</dt><dd>${rem}, 16:00</dd></dl>
    ${i.text?`<div class="note">${esc(i.text)}</div>`:''}
    ${i.foto?`<div class="thumb gross">${url?`<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="Foto zum Eintrag"></a>`:'<div class="note">Foto wird geladen …</div>'}</div>`:''}
    <button class="del-link" data-act="del" data-id="${i.id}">${confirmDel?'Wirklich löschen? Nochmal tippen':'Eintrag löschen'}</button>
    <div class="actions"><button class="btn sec" data-act="edit" data-id="${i.id}">Bearbeiten</button>
    <button class="btn pri" data-act="done" data-id="${i.id}">${i.art==='ha'?'Erledigt ✓':'Vorbei ✓'}</button></div>`;
  showSheet(html(fotoUrls[i.foto]));
  if (i.foto && !fotoUrls[i.foto]){ const u = await fotoUrl(i.foto); if (!$sheet.hidden && !form) showSheet(html(u)); }
}

/* ---------- Einstellungen & Mitteilungen ---------- */
const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const pushMoeglich = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function geraetName(){ try { return localStorage.getItem('zh-geraet') || ''; } catch(e){ return ''; } }

async function openSettings(){
  const { data: { user } } = await sb.auth.getUser();
  const perm = 'Notification' in window ? Notification.permission : 'nicht da';
  let push;
  if (!pushMoeglich() && !standalone()) push = `<p>Mitteilungen gehen am iPhone nur, wenn die App am Home-Bildschirm liegt: In Safari unten auf <b>Teilen</b> (Quadrat mit Pfeil) → <b>Zum Home-Bildschirm</b>. Dann die App von dort öffnen und hier einschalten.</p>`;
  else if (!pushMoeglich()) push = `<p>Dieses Gerät kann keine Mitteilungen empfangen. Am iPhone braucht es iOS 16.4 oder neuer.</p>`;
  else if (perm==='denied') push = `<p>Mitteilungen sind blockiert. Am iPhone: Einstellungen → Mitteilungen → Zoe's Hirn → Mitteilungen erlauben.</p>`;
  else if (perm==='granted') push = `<p><span class="ok">✓ Eingeschaltet</span> auf diesem Gerät${geraetName()?' ('+esc(geraetName())+')':''}. Erinnerungen kommen um 16:00.</p>
      <button class="btn sec" data-act="pushtest">Test-Mitteilung schicken</button><button class="btn sec" data-act="pushon">Neu verbinden</button>`;
  else push = `<p>Wer benutzt dieses Handy?</p><div class="seg" style="margin-bottom:10px"><button data-act="geraet" data-g="Zoe" class="${geraetName()==='Zoe'?'on':''}">Zoe</button><button data-act="geraet" data-g="Papa" class="${geraetName()==='Papa'?'on':''}">Papa</button></div>
      <button class="btn pri" data-act="pushon">Mitteilungen einschalten</button>`;

  const erledigt = items.filter(i => i.erledigt).sort((a,b) => (b.erledigt_am||'').localeCompare(a.erledigt_am||'')).slice(0,20);
  showSheet(`<h2>Einstellungen</h2>
    <div class="set"><h3>Erinnerungen</h3><p>Hausaufgaben 2 Tage vorher, Schularbeiten und Tests 5 und 2 Tage vorher, jeweils um 16:00. Fällt das aufs Wochenende, kommt sie am Freitag.</p>${push}</div>
    <div class="set"><h3>Erledigt (letzte 30 Tage)</h3>${erledigt.length ? erledigt.map(i => `<div class="arch"><span>${SUBJ[i.fach].n} · ${what(i)} · ${dm(i.faellig)}</span><button data-act="undone" data-id="${i.id}">Zurückholen</button></div>`).join('') : '<p>Noch nichts erledigt.</p>'}</div>
    <div class="set"><h3>Konto</h3><p>Angemeldet als ${esc(user?.email||'')}</p><button class="btn sec" data-act="logout">Abmelden</button></div>
    <div class="actions eins"><button class="btn pri" data-act="close">Fertig</button></div>`);
}

function b64ToBytes(b64){ const p = '='.repeat((4 - b64.length % 4) % 4); const s = atob((b64 + p).replace(/-/g,'+').replace(/_/g,'/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function pushEinschalten(){
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted'){ toast('Mitteilungen wurden nicht erlaubt.'); openSettings(); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    await aboSpeichern(sub);
    toast('Mitteilungen sind eingeschaltet.');
  } catch(e){ toast('Das hat nicht geklappt. Bitte nochmal versuchen.'); }
  openSettings();
}
async function aboSpeichern(sub){
  const j = sub.toJSON();
  await sb.from('push_abos').upsert({ endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth, geraet: geraetName() || null }, { onConflict:'endpoint' });
}
async function aboAuffrischen(){
  if (!pushMoeglich() || Notification.permission!=='granted') return;
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await aboSpeichern(sub); } catch(e){}
}

/* ---------- Fotos verkleinern ---------- */
function shrink(file){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const m = 1600, s = Math.min(1, m/Math.max(img.width,img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width*s); c.height = Math.round(img.height*s);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height); URL.revokeObjectURL(url);
      c.toBlob(b => b ? res({ blob:b, vorschau:c.toDataURL('image/jpeg',.6) }) : rej(), 'image/jpeg', .8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(); };
    img.src = url;
  });
}

/* ---------- Speichern ---------- */
async function speichern(){
  const f = form;
  const miss = [!f.art&&'Art', !f.fach&&'Fach', !f.faellig&&'Datum', !f.text.trim()&&!f.neuVorschau&&'Text oder Foto'].filter(Boolean);
  if (miss.length){ f.err = 'Bitte noch ausfüllen: '+miss.join(', ')+'.'; renderAdd(); return; }
  busy = true; f.err = ''; renderAdd();
  try {
    let foto = f.foto;
    if (f.neuBlob){
      const path = (crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2)) + '.jpg';
      const up = await sb.storage.from('fotos').upload(path, f.neuBlob, { contentType:'image/jpeg' });
      if (up.error) throw up.error;
      foto = path;
    }
    if (f.alteFoto && f.alteFoto !== foto) await sb.storage.from('fotos').remove([f.alteFoto]);
    const row = { art:f.art, fach:f.fach, text:f.text.trim(), foto, faellig:f.faellig };
    const r = f.id ? await sb.from('eintraege').update(row).eq('id', f.id) : await sb.from('eintraege').insert({ ...row, eingetragen:T });
    if (r.error) throw r.error;
    busy = false; const m = f.mode; closeSheet();
    if (tab!=='cal') tab = m==='ha' ? 'ha' : 'tm';
    toast(f.id ? 'Geändert.' : 'Eingetragen.');
    await load();
  } catch(e){
    busy = false; f.err = 'Speichern hat nicht geklappt. Ist das Internet da? Bitte nochmal tippen.'; renderAdd();
  }
}
async function setDone(id, wert){
  const i = items.find(x => x.id===id); if (i){ i.erledigt = wert; i.erledigt_am = wert ? new Date().toISOString() : null; render(); }
  const { error } = await sb.from('eintraege').update({ erledigt:wert, erledigt_am: wert ? new Date().toISOString() : null }).eq('id', id);
  if (error) toast('Das hat nicht geklappt. Ist das Internet da?');
  load();
}

/* ---------- Klicks ---------- */
document.getElementById('app').addEventListener('click', async e => {
  const t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
  if (t.dataset.tab){ tab = t.dataset.tab; selDay = null; blk = 0; render(); $view.scrollTop = 0; return; }
  const a = t.dataset.act, id = t.dataset.id;
  if (form){ const ta = $('fText'); if (ta) form.text = ta.value; }
  switch (a){
    case 'day':
      selDay = t.dataset.d!==selDay ? t.dataset.d : null; render();
      if (selDay){ const l = $('listTop'); if (l) $view.scrollTo({ top:l.offsetTop-70, behavior:'smooth' }); }
      break;
    case 'blk': blk = Math.max(-BLK_MAX, Math.min(BLK_MAX, +t.dataset.n)); selDay = null; render(); $view.scrollTo({ top:0, behavior:'smooth' }); break;
    case 'all': selDay = null; render(); $view.scrollTo({ top:0, behavior:'smooth' }); break;
    case 'detail': confirmDel = false; form = null; openDetail(id); break;
    case 'edit': openEdit(id); break;
    case 'add': openAdd(t.dataset.mode, t.dataset.s); break;
    case 'close': if (!busy) closeSheet(); break;
    case 'settings': form = null; openSettings(); break;
    case 'mode': form.mode = t.dataset.mode; form.fach = null; form.art = form.mode==='ha'?'ha':null; form.err=''; renderAdd(); break;
    case 'subj': form.fach = t.dataset.s; form.err=''; renderAdd(); break;
    case 'kind': {
      form.art = t.dataset.k; const subs = KIND[form.art].subj;
      form.fach = subs.length===1 ? subs[0] : (subs.includes(form.fach) ? form.fach : null);
      form.err=''; renderAdd(); break;
    }
    case 'due': form.faellig = t.dataset.d; form.err=''; renderAdd(); break;
    case 'nophoto': form.foto = null; form.neuBlob = null; form.neuVorschau = null; renderAdd(); break;
    case 'save': if (!busy) speichern(); break;
    case 'done': closeSheet(); await setDone(id, true); toast('Erledigt ✓', () => setDone(id, false)); break;
    case 'undone': await setDone(id, false); openSettings(); break;
    case 'undo': { const tt = $('toast'); const u = tt._undo; tt.hidden = true; tt._undo = null; if (u) u(); break; }
    case 'del': {
      if (!confirmDel){ confirmDel = true; openDetail(id); break; }
      const i = items.find(x => x.id===id);
      closeSheet();
      const { error } = await sb.from('eintraege').delete().eq('id', id);
      if (error){ toast('Löschen hat nicht geklappt.'); break; }
      if (i && i.foto) await sb.storage.from('fotos').remove([i.foto]);
      toast('Gelöscht.'); load(); break;
    }
    case 'geraet': try { localStorage.setItem('zh-geraet', t.dataset.g); } catch(e){} openSettings(); break;
    case 'pushon': pushEinschalten(); break;
    case 'pushtest': {
      const { data, error } = await sb.functions.invoke('erinnerungen', { body:{ test:true } });
      toast(error ? 'Test hat nicht geklappt.' : `Test geschickt an ${data.gesendet} Handy${data.gesendet===1?'':'s'}.`);
      break;
    }
    case 'logout': await sb.auth.signOut(); closeSheet(); zeigeLogin(); break;
  }
});
document.getElementById('app').addEventListener('change', async e => {
  if (!form) return;
  const ta = $('fText'); if (ta) form.text = ta.value;
  if (e.target.id==='fDate' && e.target.value){ form.faellig = e.target.value; renderAdd(); }
  if (e.target.id==='fPhoto' && e.target.files[0]){
    try { const r = await shrink(e.target.files[0]); form.neuBlob = r.blob; form.neuVorschau = r.vorschau; form.err=''; }
    catch(err){ form.err = 'Das Foto konnte nicht geladen werden. Bitte ein anderes probieren.'; }
    renderAdd();
  }
});
document.getElementById('app').addEventListener('input', e => { if (form && e.target.id==='fText') form.text = e.target.value; });

/* ---------- Anmeldung ---------- */
let neuModus = false;
function zeigeLogin(){
  $('laden').hidden = true; $('main').hidden = true; $('login').hidden = false;
  if (channel){ sb.removeChannel(channel); channel = null; }
}
async function zeigeApp(){
  $('laden').hidden = true; $('login').hidden = true; $('main').hidden = false;
  $('heuteLbl').textContent = heuteText();
  try { items = JSON.parse(localStorage.getItem(CACHE_KEY)) || []; } catch(e){ items = []; }
  render(); await load(); live(); aboAuffrischen();
}
$('loginModus').addEventListener('click', () => {
  neuModus = !neuModus;
  $('loginText').textContent = neuModus ? 'Einmalig das Familien-Konto anlegen. Danach meldet ihr euch auf allen Handys damit an.' : 'Mit dem Familien-Konto anmelden.';
  $('loginBtn').textContent = neuModus ? 'Konto anlegen' : 'Anmelden';
  $('loginModus').textContent = neuModus ? 'Zurück zur Anmeldung' : 'Erstes Mal? Familien-Konto anlegen';
  $('pass').autocomplete = neuModus ? 'new-password' : 'current-password';
  $('loginErr').hidden = true;
});
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('email').value.trim(), password = $('pass').value, err = $('loginErr');
  err.hidden = true; $('loginBtn').disabled = true;
  try {
    if (neuModus){
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session){ err.textContent = 'Konto angelegt. Bitte den Link in der Bestätigungs-E-Mail antippen und danach hier anmelden.'; err.hidden = false; $('loginModus').click(); return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch(ex){
    const m = String(ex.message||'');
    err.textContent = /Invalid login/i.test(m) ? 'E-Mail oder Passwort stimmt nicht.'
      : /confirm/i.test(m) ? 'Bitte zuerst den Link in der Bestätigungs-E-Mail antippen.'
      : /Familien-Konto|Database error/i.test(m) ? 'Es gibt schon ein Familien-Konto. Bitte damit anmelden.'
      : /Password/i.test(m) ? 'Das Passwort braucht mindestens 8 Zeichen.'
      : 'Das hat nicht geklappt. Ist das Internet da?';
    err.hidden = false;
  } finally { $('loginBtn').disabled = false; }
});

sb.auth.onAuthStateChange((ev, session) => {
  if (ev==='SIGNED_IN' && session && $('main').hidden) zeigeApp();
  if (ev==='SIGNED_OUT') zeigeLogin();
});
(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (DEMO){ $('laden').hidden = true; $('login').hidden = true; $('main').hidden = false; $('heuteLbl').textContent = heuteText(); items = demoDaten(); render(); return; }
  const { data: { session } } = await sb.auth.getSession();
  session ? zeigeApp() : zeigeLogin();
})();
})();
