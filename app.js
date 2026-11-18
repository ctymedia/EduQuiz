// PCQuiz (truoc day la EduQuiz) v3 — Firestore + Auth + Gói thành viên + Kho API key + AI + Tải file đề
// Collections: quizzes, sessions/{pin}/players, users/{uid}/devices, apiKeys, plans, classes
// Đăng ký -> pending -> Admin duyệt -> approved + gói Free. Admin gán gói thủ công được.
// API key người dùng nhập khi tạo đề AI được lưu vào kho key hệ thống MỘT CÁCH CÔNG KHAI:
// giao diện ghi rõ điều này ngay tại ô nhập key; admin quản lý kho key ở tab Quản trị > API key.
import { firebaseConfig, isConfigured } from './firebase-config.js';

const ADMIN_EMAILS = ['ctymedialab@gmail.com'];
const FEATURES = [
  ['library','Thư viện của tôi'], ['create','Tạo bộ câu hỏi'], ['host','Tổ chức chơi trực tiếp'],
  ['practice','Tự luyện tập'], ['reports','Báo cáo'], ['upload','Tải file đề (docx)'],
  ['ai','Tạo đề bằng AI'], ['classes','Lớp học'], ['systemKeys','Dùng API key hệ thống'], ['branding','Ảnh bìa & ảnh nền cuộc thi']
];
const defaultFeatures = () => Object.fromEntries(FEATURES.map(([k])=>[k,true]));
const PLAN_DEFAULTS = {
  free:  { name:'Free',  features:{library:1,create:1,host:1,practice:1,reports:0,upload:1,ai:0,classes:1,systemKeys:0,branding:0}, limits:{maxQuizzes:3,  maxQuestions:20,  maxClasses:1,  maxMembersPerClass:30, maxDevices:2} },
  pro:   { name:'Pro',   features:{library:1,create:1,host:1,practice:1,reports:1,upload:1,ai:1,classes:1,systemKeys:0,branding:1}, limits:{maxQuizzes:20, maxQuestions:50,  maxClasses:5,  maxMembersPerClass:50, maxDevices:2} },
  ultra: { name:'Ultra', features:{library:1,create:1,host:1,practice:1,reports:1,upload:1,ai:1,classes:1,systemKeys:1,branding:1}, limits:{maxQuizzes:0,  maxQuestions:0,   maxClasses:0,  maxMembersPerClass:0,  maxDevices:0} },
  admin: { name:'Admin', features:{library:1,create:1,host:1,practice:1,reports:1,upload:1,ai:1,classes:1,systemKeys:1,branding:1}, limits:{maxQuizzes:0,  maxQuestions:0,   maxClasses:0,  maxMembersPerClass:0,  maxDevices:0} },
  custom:{ name:'Custom',features:{library:1,create:1,host:1,practice:1,reports:0,upload:1,ai:0,classes:1,systemKeys:0,branding:0}, limits:{maxQuizzes:3,  maxQuestions:20,  maxClasses:1,  maxMembersPerClass:30, maxDevices:2} }
};
const LIMIT_LABELS = [['maxQuizzes','Số bộ đề tối đa'],['maxQuestions','Số câu tối đa / 1 bộ đề'],['maxClasses','Số lớp được tạo'],['maxMembersPerClass','Số thành viên / 1 lớp'],['maxDevices','Số thiết bị đăng nhập tối đa / 1 tài khoản (mỗi thiết bị có 1 ID riêng, 0 = không giới hạn)']];

const $ = s => document.querySelector(s);
let aiPastedImages = [];
document.addEventListener('paste', e=>{ if (!document.getElementById('aiPaste')) return; // Chi bat khi dang o man hinh Tao de bang AI
  if (e.target.closest && e.target.closest('#aiPaste')) return; // Trong khung dan thi de handler rieng xu ly
  const item=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/'));
  if (item && window.__eqPasteSink){ e.preventDefault(); window.__eqPasteSink(item.getAsFile()); } });
const app = $('#app');
const COLORS = ['a0','a1','a2','a3'], SHAPES = ['▲','◆','●','■'];
let db = null, F = null, A = null, auth = null, DEMO = !isConfigured();
let unsubs = [], me = null, plans = structuredClone(PLAN_DEFAULTS);

const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('vi-VN') : 'Không giới hạn';
const fmtDT = ts => ts ? new Date(ts).toLocaleString('vi-VN') : '—';
const stopListen = () => { unsubs.forEach(u=>u&&u()); unsubs=[]; };
function math(el){ if (window.renderMathInElement && el) try{ window.renderMathInElement(el,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}], throwOnError:false}); }catch{} }
function mediaHtml(q){
  if (!q?.media?.url) return '';
  const {type,url} = q.media;
  if (type==='image') return `<div class="media"><img src="${esc(url)}" alt="Hình minh họa"></div>`;
  if (type==='audio') return `<div class="media"><audio controls src="${esc(url)}"></audio></div>`;
  if (type==='video'){ const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
    if (m) return `<div class="media"><iframe width="100%" height="315" src="https://www.youtube.com/embed/${m[1]}" allowfullscreen></iframe></div>`;
    return `<div class="media"><video controls src="${esc(url)}" style="max-width:100%"></video></div>`; }
  return '';
}

// ---------- Hiển thị giàu: media nhúng trong nội dung bằng thẻ [media:URL] + công thức $...$ ----------
function mediaTag(url){
  url = String(url||'').replace(/&amp;/g,'&');
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `<div class="media"><iframe width="100%" height="315" src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe></div>`;
  if (/^data:image|\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) return `<div class="media"><img src="${url}" alt="Hình minh họa"></div>`;
  if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url)) return `<div class="media"><audio controls src="${url}"></audio></div>`;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return `<div class="media"><video controls src="${url}" style="max-width:100%"></video></div>`;
  return `<div class="media"><img src="${url}" alt="Media"></div>`;
}
function richHtml(text){ return esc(text).replace(/\[media:([^\]]+)\]/g, (m,u)=>mediaTag(u)); }
// Chèn nội dung vào đúng vị trí con trỏ của ô nhập đang được chọn gần nhất
let lastFocusEl = null;
document.addEventListener('focusin', e=>{ if (e.target.matches('input[data-q], textarea')) lastFocusEl = e.target; });
function insertAtCursor(token){
  const el = (lastFocusEl && document.contains(lastFocusEl)) ? lastFocusEl : app.querySelector('input[data-f="text"]');
  if (!el){ alert('Thầy/cô bấm vào ô câu hỏi hoặc ô đáp án để đặt con trỏ trước nhé!'); return false; }
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0,a) + token + el.value.slice(b);
  el.focus(); el.setSelectionRange(a+token.length, a+token.length);
  el.dispatchEvent(new Event('change', {bubbles:true})); return true;
}
// Cửa sổ soạn công thức trực quan bằng MathLive, chèn nhanh $latex$ vào vị trí con trỏ
function openMathEditor(){
  let modal = document.getElementById('mathModal');
  if (!modal){
    modal = document.createElement('div'); modal.id='mathModal';
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `<div style="background:#fff;border-radius:16px;padding:20px;max-width:640px;width:100%">
      <h2 style="margin-top:0">🧮 Soạn công thức trực quan</h2>
      <p class="small">Gõ hoặc bấm bàn phím ảo: phân số, căn, lũy thừa, ký hiệu Toán và Hóa học. Xong bấm Chèn — công thức sẽ vào đúng vị trí con trỏ trong ô câu hỏi/đáp án.</p>
      <math-field id="mfField" style="width:100%;font-size:24px;border:2px solid #a78bfa;border-radius:10px;padding:10px"></math-field>
      <div class="row" style="margin-top:14px"><button class="btn green grow" id="mfInsert">⬇️ Chèn vào vị trí con trỏ</button>
      <a class="btn light" href="https://www.codecogs.com/latex/eqneditor.php" target="_blank" rel="noopener">Mở trang soạn LaTeX đầy đủ</a>
      <button class="btn gray" id="mfClose">Đóng</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('#mfClose').onclick = ()=> modal.style.display='none';
    modal.querySelector('#mfInsert').onclick = ()=>{ const mf = modal.querySelector('#mfField'); const latex = (mf.getValue ? mf.getValue('latex') : mf.value||'').trim();
      if (!latex) return alert('Thầy/cô soạn công thức trước nhé!'); if (insertAtCursor('$'+latex+'$')) modal.style.display='none'; };
  }
  modal.style.display='flex';
  setTimeout(()=>{ const mf = modal.querySelector('#mfField'); mf?.focus(); }, 50);
}

// Gói + quyền hiệu lực: admin = tất cả; còn lại = giao của quyền cá nhân và quyền của gói
async function loadPlans(){ if (DEMO) return; try{ const s=await F.getDocs(F.collection(db,'plans')); s.docs.forEach(d=>{ if(plans[d.id]) plans[d.id]={...plans[d.id],...d.data()}; }); }catch{} }
const myPlan = () => plans[me?.plan||'free'] || plans.free;
const can = f => { if(!me) return false; if(me.role==='admin') return true; if(me.features?.[f]===false) return false; const pf=myPlan().features; return !(pf && (pf[f]===0||pf[f]===false)); };
const limit = k => me?.role==='admin' ? 0 : (myPlan().limits?.[k] ?? 0); // 0 = không giới hạn
function requireLogin(f){
  if (!me){ renderLogin('Thầy/cô cần đăng nhập (và được admin phê duyệt) để dùng chức năng này.'); return false; }
  if (f && !can(f)){ alert(`Tài khoản của thầy/cô (gói ${myPlan().name}) chưa được cấp quyền dùng chức năng này. Vui lòng liên hệ admin.`); return false; }
  return true;
}
function checkAccess(p){
  if (p.status==='pending') return 'Tài khoản của thầy/cô đang chờ admin phê duyệt. Vui lòng liên hệ admin để được duyệt trước khi đăng nhập.';
  if (p.status==='blocked') return 'Tài khoản của thầy/cô đã bị chặn. Vui lòng liên hệ admin.';
  if (p.expiresAt && Date.now()>p.expiresAt) return 'Tài khoản của thầy/cô đã hết hạn sử dụng. Vui lòng liên hệ admin để gia hạn.';
  return true;
}

// ---------- Khởi tạo ----------
async function init(){
  if (DEMO){ $('#syncStatus').textContent='⚠️ Chế độ demo (chưa nối Firebase)'; me={uid:'demo',email:'demo@eduquiz.local',displayName:'Giáo viên demo',role:'admin',status:'approved',plan:'ultra',features:defaultFeatures(),expiresAt:null}; initSettings(); paintAuth(); renderHome(); if(!maybeDeepLink()) maybeResumeLive(); return; }
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  A = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const fbApp = initializeApp(firebaseConfig); db = F.getFirestore(fbApp); auth = A.getAuth(fbApp);
  $('#syncStatus').textContent='☁️ Đã nối Firebase — đồng bộ mọi thiết bị';
  await loadPlans();
  initSettings();
  A.onAuthStateChanged(auth, async user=>{
    if (!user){ me=null; paintAuth(); renderHome(); if(!maybeDeepLink()) maybeResumeLive(); return; }
    const snap = await F.getDoc(F.doc(db,'users',user.uid));
    if (!snap.exists()){ await A.signOut(auth); me=null; paintAuth(); alert('Tài khoản này chưa có hồ sơ hoặc đã bị xoá bởi admin. Vui lòng đăng ký lại và chờ phê duyệt.'); renderHome(); return; }
    me = { uid:user.uid, ...snap.data() };
    const chk = checkAccess(me);
    if (chk!==true){ await A.signOut(auth); me=null; paintAuth(); alert(chk); renderHome(); return; }
    const devLimit = me.role==='admin' ? 0 : (myPlan().limits?.maxDevices ?? 2);
    if (devLimit>0){ const fd = await findMyDevice(user.uid);
      if (!fd.match && fd.count >= devLimit){ await A.signOut(auth); me=null; paintAuth(); alert(`Tài khoản này đã đăng nhập trên tối đa ${devLimit} thiết bị (giới hạn của gói ${myPlan().name}, mỗi thiết bị được nhận diện bằng một ID riêng). Thầy/cô hãy đăng xuất ở một thiết bị cũ, hoặc liên hệ admin để nâng giới hạn nhé.`); renderHome(); return; } }
    await F.updateDoc(F.doc(db,'users',user.uid), { lastLoginAt: Date.now() });
    await registerDevice(me.uid);
    paintAuth(); renderHome(); if(!maybeDeepLink()) maybeResumeLive();
  });
  renderHome();
}

// ---------- Thiết bị đăng nhập ----------
function deviceName(){ const ua=navigator.userAgent; let os='Thiết bị khác', br='';
  if (/Android/i.test(ua)) os='Điện thoại/máy tính bảng Android'; else if (/iPhone/i.test(ua)) os='iPhone'; else if (/iPad/i.test(ua)) os='iPad';
  else if (/Windows/i.test(ua)) os='Máy tính Windows'; else if (/Macintosh|Mac OS/i.test(ua)) os='Máy Mac'; else if (/Linux/i.test(ua)) os='Máy tính Linux';
  if (/Edg\//.test(ua)) br=' • Edge'; else if (/Chrome\//.test(ua)) br=' • Chrome'; else if (/Firefox\//.test(ua)) br=' • Firefox'; else if (/Safari\//.test(ua)) br=' • Safari';
  return os+br; }
async function getIP(){ try{ const ctl=new AbortController(); setTimeout(()=>ctl.abort(),3000); const r=await fetch('https://api.ipify.org?format=json',{signal:ctl.signal}); const j=await r.json(); return j.ip||'Không rõ'; }catch{ return 'Không rõ'; } }
async function findMyDevice(uid){ // Nhan dien thiet bi bang ID rieng luu tren chinh thiet bi do: doi IP van la 1 thiet bi
  const ds=await F.getDocs(F.collection(db,'users',uid,'devices')); const lid=localStorage.getItem('eq_device_id'); let match=null;
  ds.forEach(d=>{ if(d.id===lid) match={id:d.id, ...d.data()}; }); return { count: ds.size, match }; }
async function registerDevice(uid){ let id=localStorage.getItem('eq_device_id'); if(!id){ id='dev'+Date.now()+Math.floor(Math.random()*99999); localStorage.setItem('eq_device_id',id); }
  const ref=F.doc(db,'users',uid,'devices',id); const old=await F.getDoc(ref); const ip=await getIP();
  const prev=(old.exists()&&Array.isArray(old.data().logins))?old.data().logins:[];
  const logins=[{at:Date.now(), ip}, ...prev].slice(0,30); // Lich su dang nhap cua thiet bi (moi nhat truoc, giu 30 lan)
  await F.setDoc(ref,{ name:deviceName(), ip, userAgent:navigator.userAgent, firstLoginAt: old.exists()?old.data().firstLoginAt:Date.now(), lastLoginAt: Date.now(), logins }); }

// ---------- Thanh tài khoản + điều hướng ----------
const NAV_FEATURES = { library:'library', import:'upload', ai:'ai', classes:'classes', reports:'reports' };
function paintNav(){ document.querySelectorAll('[data-nav]').forEach(b=>{ const n=b.dataset.nav; if(n==='admin'||n==='home') return;
  if(!me){ b.style.display=''; return; } // Chua dang nhap: hien tat ca de thay/co biet va dang nhap
  let ok;
  if(n==='create') ok = can('create')||can('upload')||can('ai');
  else if(n==='contests') ok = can('host')||can('create');
  else { const f=NAV_FEATURES[n]; ok = f? can(f) : true; }
  b.style.display = ok? '' : 'none'; }); }
const nameClass = u => { if(!u) return 'uname-free'; if(u.role==='admin') return 'rainbow-text'; const pl=u.plan||'free'; return pl==='ultra'?'uname-ultra':pl==='pro'?'uname-pro':pl==='custom'?'uname-custom':'uname-free'; };
const avatarHtml = (u, sz=30) => { const a=u?.avatar; if(a && a.startsWith('data:')) return `<img class="uavatar" src="${a}" style="width:${sz}px;height:${sz}px;border:2px solid #fff;box-shadow:0 1px 4px #0003;vertical-align:middle">`; return `<span style="font-size:${Math.round(sz*0.85)}px;line-height:1;vertical-align:middle">${a||'👤'}</span>`; };
function renderProfile(){
  if(!me) return renderLogin();
  stopListen();
  let av = me.avatar||'';
  app.innerHTML = `<div class="card join" style="max-width:540px"><h1>🖼️ Avatar của tôi</h1>
  <div id="profPrev" style="margin:12px 0">${avatarHtml({avatar:av}, 88)}</div>
  <p class="small">Chọn một hình đại diện có sẵn:</p>
  ${avatarPickerHtml('profAvPick')}
  <p class="small" style="margin-top:16px">Hoặc tải ảnh của riêng mình lên:</p>
  <input type="file" accept="image/*" id="profFile">
  <div class="row" style="justify-content:center;margin-top:12px"><button class="btn green" id="profSave">💾 Lưu avatar</button><button class="btn light" id="profRemove">Xóa avatar</button></div>
  <p class="small" id="profMsg"></p></div>`;
  const getAv = wireAvatarPicker('profAvPick');
  if (av && AVATARS.includes(av)){ const cur=app.querySelector(`#profAvPick [data-av="${av}"]`); if(cur) cur.click(); }
  app.querySelectorAll('#profAvPick [data-av]').forEach(b=>b.addEventListener('click',()=>{ av=b.dataset.av; $('#profPrev').innerHTML=avatarHtml({avatar:av},88); }));
  $('#profFile').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; av=await compressImage(f,256); $('#profPrev').innerHTML=avatarHtml({avatar:av},88); };
  $('#profRemove').onclick=()=>{ av=''; $('#profPrev').innerHTML=avatarHtml({avatar:''},88); };
  $('#profSave').onclick=async()=>{ const final = av;
    if (DEMO){ me.avatar=final; }
    else { await F.updateDoc(F.doc(db,'users',me.uid), { avatar: final }); me.avatar=final; }
    paintAuth(); $('#profMsg').textContent='✔ Đã lưu avatar mới!'; };
}
function paintAuth(){ const el=$('#authArea'); if(!el) return; paintNav();
  $('#adminBtn').style.display = me?.role==='admin' ? '' : 'none';
  el.innerHTML = me ? `<span style="display:inline-flex;align-items:center;gap:7px">${avatarHtml(me,30)}<span class="${nameClass(me)}">${esc(me.displayName||me.email)}</span></span> <button id="profileBtn">🖼️ Avatar</button> <button id="logoutBtn">Đăng xuất</button>`
                    : `<button id="loginBtn">Đăng nhập</button> <button id="regBtn">Đăng ký</button>`;
  if (me){ $('#logoutBtn').onclick=async()=>{ stopListen(); if(!DEMO) await A.signOut(auth); me=null; paintAuth(); renderHome(); };
    $('#profileBtn').onclick=()=>renderProfile(); }
  else { $('#loginBtn').onclick=()=>renderLogin(); $('#regBtn').onclick=()=>renderRegister(); }
}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{ stopListen(); const n=b.dataset.nav;
  if(n==='home') renderHome();
  else if(n==='admin'){ if(me?.role==='admin') renderAdmin('members'); else alert('Mục này chỉ dành cho admin.'); }
  else if(n==='library'){ if(requireLogin('library')) renderLibrary(); }
  else if(n==='create'){ if(requireLogin()) renderCreateHub(); }
  else if(n==='import'){ if(requireLogin('upload')) renderImport(); }
  else if(n==='ai'){ if(requireLogin('ai')) renderAI(); }
  else if(n==='classes'){ if(requireLogin('classes')) renderClasses(); }
  else if(n==='contests'){ if(requireLogin()) renderContestHub(); }
  else if(n==='reports'){ if(requireLogin('reports')) renderReports(); }
});

// ---------- Đăng ký / Đăng nhập ----------
function renderRegister(msg){
  app.innerHTML=`<div class="card join"><h1>📝 Đăng ký tài khoản giáo viên</h1>${msg?`<div class="notice">${esc(msg)}</div>`:''}
  <input id="rn" placeholder="Họ và tên của thầy/cô"><input id="re" type="email" placeholder="Email"><input id="rp" type="password" placeholder="Mật khẩu (ít nhất 6 ký tự)">
  <button class="btn green" style="width:100%" id="doReg">Đăng ký</button>
  <p class="small">Sau khi đăng ký, tài khoản ở trạng thái <b>chờ phê duyệt</b>. Admin duyệt xong thầy/cô mới đăng nhập được, và khi được duyệt sẽ tự động dùng <b>gói Free</b>.</p>
  <p class="small">Đã có tài khoản? <a href="#" id="goLogin">Đăng nhập</a></p></div>`;
  $('#goLogin').onclick=e=>{e.preventDefault();renderLogin();};
  $('#doReg').onclick=async()=>{ const name=$('#rn').value.trim(), email=$('#re').value.trim(), pass=$('#rp').value;
    if(!name||!email||pass.length<6) return alert('Thầy/cô nhập họ tên, email và mật khẩu ít nhất 6 ký tự nhé!');
    if(DEMO) return alert('Bản demo chưa nối Firebase nên chưa đăng ký được.');
    try{ const cred=await A.createUserWithEmailAndPassword(auth,email,pass);
      const admins=await F.getDocs(F.query(F.collection(db,'users'),F.where('role','==','admin'),F.limit(1)));
      const isFirstAdmin = admins.empty || ADMIN_EMAILS.includes(email.toLowerCase());
      await F.setDoc(F.doc(db,'users',cred.user.uid),{ email, displayName:name, role:isFirstAdmin?'admin':'teacher', status:isFirstAdmin?'approved':'pending',
        plan:'free', features:defaultFeatures(), expiresAt:isFirstAdmin?null:Date.now()+365*24*3600*1000, createdAt:Date.now(), lastLoginAt:0 });
      await A.signOut(auth);
      renderLogin(isFirstAdmin?'Đăng ký thành công! Đây là tài khoản admin đầu tiên nên đã được duyệt sẵn — thầy/cô đăng nhập luôn nhé.':'Đăng ký thành công! Tài khoản đang chờ admin phê duyệt. Khi được duyệt, tài khoản tự động dùng gói Free.');
    }catch(e){ alert('Đăng ký chưa được: '+(e.code==='auth/email-already-in-use'?'Email này đã được đăng ký.':e.message)); } };
}
function renderLogin(msg){
  app.innerHTML=`<div class="card join"><h1>🔐 Đăng nhập</h1>${msg?`<div class="notice">${esc(msg)}</div>`:''}
  <input id="le" type="email" placeholder="Email"><input id="lp" type="password" placeholder="Mật khẩu">
  <button class="btn green" style="width:100%" id="doLogin">Đăng nhập</button>
  <p class="small">Chưa có tài khoản? <a href="#" id="goReg">Đăng ký</a> (cần admin phê duyệt)</p>
  <p class="small">Học sinh không cần tài khoản — nhập mã PIN ở Trang chủ để vào chơi.</p></div>`;
  $('#goReg').onclick=e=>{e.preventDefault();renderRegister();};
  $('#doLogin').onclick=async()=>{ const email=$('#le').value.trim(), pass=$('#lp').value;
    if(!email||!pass) return alert('Thầy/cô nhập email và mật khẩu nhé!'); if(DEMO) return alert('Bản demo chưa nối Firebase.');
    try{ await A.signInWithEmailAndPassword(auth,email,pass); }
    catch(e){ alert('Đăng nhập chưa được: '+(['auth/invalid-credential','auth/wrong-password','auth/user-not-found'].includes(e.code)?'Sai email hoặc mật khẩu.':e.message)); } };
}

// ---------- Lớp dữ liệu quiz / phiên chơi / lớp học ----------
const store = {
  async createQuiz(q){ if(DEMO){ const id='q'+Date.now(); const all=JSON.parse(localStorage.getItem('eq_quizzes')||'[]'); all.push({id,...q}); localStorage.setItem('eq_quizzes',JSON.stringify(all)); return id; }
    const r=await F.addDoc(F.collection(db,'quizzes'),{...q,createdAt:F.serverTimestamp()}); return r.id; },
  async listQuizzes(){ if(DEMO) return JSON.parse(localStorage.getItem('eq_quizzes')||'[]');
    const s=await F.getDocs(F.query(F.collection(db,'quizzes'),F.orderBy('createdAt','desc'))); return s.docs.map(d=>({id:d.id,...d.data()})); },
  async getQuiz(id){ return (await this.listQuizzes()).find(q=>q.id===id); },
  async updateQuiz(id, data){ if(DEMO){ const all=JSON.parse(localStorage.getItem('eq_quizzes')||'[]'); const i=all.findIndex(q=>q.id===id); if(i>=0){ all[i]={...all[i],...data}; localStorage.setItem('eq_quizzes',JSON.stringify(all)); } return; }
    await F.updateDoc(F.doc(db,'quizzes',id), data); },
  async flagCheat(pin, playerId, qIdx){
    if(DEMO){ const arr=await this.listPlayers(pin); const p=arr.find(x=>x.id===playerId); if(!p||p.cheats?.[qIdx]) return; p.cheats={...(p.cheats||{}),[qIdx]:true}; p.cheatCount=(p.cheatCount||0)+1; localStorage.setItem('eq_players_'+pin,JSON.stringify(arr)); window.dispatchEvent(new Event('eq-change')); return; }
    const ref=F.doc(db,'sessions',pin,'players',playerId); const sn=await F.getDoc(ref); if(!sn.exists()||sn.data().cheats?.[qIdx]) return;
    await F.updateDoc(ref,{ cheatCount:(sn.data().cheatCount||0)+1, [`cheats.${qIdx}`]:true }); },
  async createSession(quiz){ const pin=String(Math.floor(100000+Math.random()*900000));
    const data={quizId:quiz.id,title:quiz.title,questions:quiz.questions,status:'lobby',currentQuestion:-1,questionStartedAt:0,createdAt:Date.now(),hostUid:me?.uid||'',cover:quiz.cover||'',coverFade:quiz.coverFade??80,contestBg:quiz.contestBg||'',bgFade:quiz.bgFade??85};
    if(DEMO){ localStorage.setItem('eq_session_'+pin,JSON.stringify(data)); localStorage.setItem('eq_players_'+pin,'[]'); }
    else await F.setDoc(F.doc(db,'sessions',pin),{...data,createdAt:F.serverTimestamp()}); return pin; },
  async getSession(pin){ if(DEMO){ const v=localStorage.getItem('eq_session_'+pin); return v?JSON.parse(v):null; }
    const s=await F.getDoc(F.doc(db,'sessions',pin)); return s.exists()?s.data():null; },
  async setSession(pin,patch){ if(DEMO){ const cur=await this.getSession(pin); localStorage.setItem('eq_session_'+pin,JSON.stringify({...cur,...patch})); window.dispatchEvent(new Event('eq-change')); }
    else await F.updateDoc(F.doc(db,'sessions',pin),patch); },
  async join(pin,nickname,avatar){ const id='p'+Date.now()+Math.floor(Math.random()*999); const p={nickname,avatar:avatar||'🙂',score:0,streak:0,answers:{},cheatCount:0,cheats:{},joinedAt:Date.now()};
    if(DEMO){ const arr=JSON.parse(localStorage.getItem('eq_players_'+pin)||'[]'); arr.push({id,...p}); localStorage.setItem('eq_players_'+pin,JSON.stringify(arr)); window.dispatchEvent(new Event('eq-change')); }
    else await F.setDoc(F.doc(db,'sessions',pin,'players',id),p); return id; },
  async listPlayers(pin){ if(DEMO) return JSON.parse(localStorage.getItem('eq_players_'+pin)||'[]');
    const s=await F.getDocs(F.collection(db,'sessions',pin,'players')); return s.docs.map(d=>({id:d.id,...d.data()})); },
  async answer(pin,playerId,qIdx,choice,points,correct){
    if(DEMO){ const arr=await this.listPlayers(pin); const p=arr.find(x=>x.id===playerId); if(!p||p.answers[qIdx])return; p.answers[qIdx]={choice,points,correct}; p.score+=points; p.streak=correct?p.streak+1:0; localStorage.setItem('eq_players_'+pin,JSON.stringify(arr)); window.dispatchEvent(new Event('eq-change')); }
    else { const ref=F.doc(db,'sessions',pin,'players',playerId); const s=await F.getDoc(ref); if(!s.exists()||s.data().answers?.[qIdx])return; const d=s.data();
      await F.updateDoc(ref,{score:(d.score||0)+points, streak:correct?(d.streak||0)+1:0, [`answers.${qIdx}`]:{choice,points,correct}}); } },
  onSession(pin,cb){ if(DEMO){ window.addEventListener('eq-change',async()=>cb(await this.getSession(pin))); cb(this.getSession(pin)); }
    else unsubs.push(F.onSnapshot(F.doc(db,'sessions',pin),async s=>cb(s.exists()?s.data():null))); },
  onPlayers(pin,cb){ if(DEMO){ window.addEventListener('eq-change',async()=>cb(await this.listPlayers(pin))); this.listPlayers(pin).then(cb); }
    else unsubs.push(F.onSnapshot(F.collection(db,'sessions',pin,'players'),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))))); },
  async listClasses(){ if(DEMO) return JSON.parse(localStorage.getItem('eq_classes')||'[]');
    const s=await F.getDocs(F.collection(db,'classes')); return s.docs.map(d=>({id:d.id,...d.data()})); },
  async saveClass(c){ if(DEMO){ const all=await this.listClasses(); if(c.id){ const i=all.findIndex(x=>x.id===c.id); all[i]=c; } else { c.id='c'+Date.now(); all.push(c); } localStorage.setItem('eq_classes',JSON.stringify(all)); return c.id; }
    if(c.id){ await F.updateDoc(F.doc(db,'classes',c.id),c); return c.id; } const r=await F.addDoc(F.collection(db,'classes'),{...c,createdAt:F.serverTimestamp()}); return r.id; },
  async deleteQuiz(id){ if(DEMO){ localStorage.setItem('eq_quizzes', JSON.stringify((await this.listQuizzes()).filter(x=>x.id!==id))); } else await F.deleteDoc(F.doc(db,'quizzes',id)); },
  async deleteClass(id){ if(DEMO){ localStorage.setItem('eq_classes',JSON.stringify((await this.listClasses()).filter(x=>x.id!==id))); } else await F.deleteDoc(F.doc(db,'classes',id)); }
};
async function listSessionsData(){
  if(DEMO){ const out=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k?.startsWith('eq_session_')){ const pin=k.slice(11); out.push({pin, ...(JSON.parse(localStorage.getItem(k)||'{}')), players: JSON.parse(localStorage.getItem('eq_players_'+pin)||'[]')}); } } return out; }
  const s=await F.getDocs(F.collection(db,'sessions')); const out=[];
  for(const d of s.docs){ const ps=await F.getDocs(F.collection(db,'sessions',d.id,'players')); out.push({pin:d.id, ...d.data(), players: ps.docs.map(x=>({id:x.id,...x.data()}))}); }
  return out.sort((a,b)=>((b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)));
}
async function checkQuizLimits(newQuestionsCount, excludeId){
  const limQ=limit('maxQuizzes'); if(limQ>0){ const mine=(await store.listQuizzes()).filter(q=>q.ownerUid===me.uid && q.id!==excludeId); if(mine.length>=limQ) return `Gói ${myPlan().name} chỉ cho tạo tối đa ${limQ} bộ đề. Thầy/cô nâng cấp gói hoặc liên hệ admin.`; }
  const limN=limit('maxQuestions'); if(limN>0 && newQuestionsCount>limN) return `Gói ${myPlan().name} chỉ cho tối đa ${limN} câu cho 1 bộ đề (bộ này có ${newQuestionsCount} câu).`;
  return true;
}

// ---------- Trang chủ ----------

const AVATARS = ['🦊','🐼','🦄','🐶','🐱','🦁','🐸','🐵','🦉','🐙','🦖','🐳','🍕','🚀','⭐','🎧','🌈','⚽'];
const shuffleArr = a => { const x=[...a]; for(let i=x.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [x[i],x[j]]=[x[j],x[i]]; } return x; };
function avatarPickerHtml(id){ return `<div class="row" id="${id}" style="justify-content:center;gap:6px">${AVATARS.map((a,i)=>`<button type="button" class="btn ${i===0?'':'light'}" data-av="${a}" style="font-size:26px;padding:6px 10px">${a}</button>`).join('')}</div>`; }
function wireAvatarPicker(id){ let sel = AVATARS[0]; const box = document.getElementById(id); if(!box) return ()=>sel;
  box.querySelectorAll('[data-av]').forEach(b=>b.onclick=()=>{ sel=b.dataset.av; box.querySelectorAll('[data-av]').forEach(x=>x.classList.add('light')); b.classList.remove('light'); });
  return ()=>sel; }
// ---------- Vào phòng bằng liên kết / mã QR (không cần nhập mã) ----------
// Liên kết vào phòng có dạng: <địa chỉ trang>?code=123456 — mở liên kết hoặc quét mã QR là vào thẳng màn hình nhập biệt danh/avatar.
function roomLink(code){ return location.origin + location.pathname + '?code=' + encodeURIComponent(code); }
function extractRoomCode(text){
  const t = String(text||'').trim(); if(!t) return '';
  const m = t.match(/[?&#](?:code|pin|room)=(\d{6})\b/) || t.match(/\b(\d{6})\b/);
  return m ? m[1] : '';
}
function qrImgHtml(code, size){
  const s = size||180;
  return `<img alt="Mã QR vào phòng ${esc(code)}" width="${s}" height="${s}" style="background:#fff;border:1px solid #ddd;border-radius:10px;padding:4px" src="https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&margin=6&data=${encodeURIComponent(roomLink(code))}">`;
}
async function copyRoomLink(code, btn){
  const link = roomLink(code);
  try{ await navigator.clipboard.writeText(link); }
  catch{ const ta=document.createElement('textarea'); ta.value=link; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch{} ta.remove(); }
  if (btn){ const old=btn.textContent; btn.textContent='✔ Đã chép liên kết'; setTimeout(()=>{ btn.textContent=old; },2000); }
}
function shareRoomHtml(code, size){
  return `<div style="margin-top:12px"><p class="small" style="margin:4px 0"><b>📱 Vào phòng ngay không cần nhập mã:</b> học sinh quét mã QR bằng camera điện thoại, hoặc bấm vào liên kết được gửi (Zalo, tin nhắn…):</p>
  ${qrImgHtml(code, size)}
  <input readonly value="${esc(roomLink(code))}" onclick="this.select()" style="text-align:center;margin-top:8px;font-size:13px">
  <div class="row" style="justify-content:center;margin-top:6px"><button class="btn light" type="button" data-copylink="${esc(code)}">🔗 Sao chép liên kết vào phòng</button></div></div>`;
}
function wireShareRoom(root){
  (root||app).querySelectorAll('[data-copylink]').forEach(b=>b.onclick=()=>copyRoomLink(b.dataset.copylink, b));
}
async function enterRoomByCode(code){
  const s = await store.getSession(code); if (s){ if (s.status==='closed'||s.status==='finished'){ alert('🚪 Phòng thi này đã đóng. Em hỏi thầy/cô để biết thêm nhé!'); return; } return renderJoinSetup(code); }
  const ct = await contestGet(code); if (ct) return renderContestGate(code);
  alert('Không tìm thấy phòng nào với mã này. Em kiểm tra lại mã giúp thầy/cô nhé!');
  return false;
}
// Mở liên kết ?code=... là tự vào phòng ngay (chỉ xử lý 1 lần khi trang vừa tải)
function maybeDeepLink(){
  if (window.__eqDlDone) return false;
  const code = extractRoomCode(location.href);
  if (!code) return false;
  window.__eqDlDone = true;
  try{ history.replaceState(null,'',location.pathname); }catch{}
  enterRoomByCode(code);
  return true;
}
// Học sinh lỡ tải lại trang khi đang chơi trực tiếp: tự vào lại đúng phòng, đúng tài khoản người chơi cũ (chỉ xử lý 1 lần khi trang vừa tải)
async function maybeResumeLive(){
  if (window.__eqResumeDone) return; window.__eqResumeDone = true;
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem('eq_resume_live')||'null'); }catch{}
  if (!saved?.pin || !saved?.playerId) return;
  if (Date.now() - (saved.at||0) > 6*3600*1000){ try{ localStorage.removeItem('eq_resume_live'); }catch{} return; }
  try{
    const s = await store.getSession(saved.pin);
    if (!s || s.status==='finished'){ try{ localStorage.removeItem('eq_resume_live'); }catch{} return; }
    const ps = await store.listPlayers(saved.pin);
    if (!ps.some(p=>p.id===saved.playerId)){ try{ localStorage.removeItem('eq_resume_live'); }catch{} return; }
    renderPlayer(saved.pin, saved.playerId);
  }catch{}
}

// Man hinh nhap biet danh + chon avatar cho phong choi truc tiep (PIN)
function renderJoinSetup(pin){
  app.innerHTML = `<div class="card join"><h1>🎮 Sắp vào phòng rồi!</h1><p class="small">Mã phòng: <b>${pin}</b> • Em nhập biệt danh và chọn một avatar ngộ nghĩnh nhé</p>
  <input id="jnick" placeholder="Biệt danh của em" maxlength="30">
  <p class="small" style="text-align:left;margin:10px 0 4px"><b>Chọn avatar:</b></p>${avatarPickerHtml('avPick')}
  <button class="btn green" style="width:100%;margin-top:14px" id="readyBtn">✔ Sẵn sàng</button></div>`;
  const getAv = wireAvatarPicker('avPick');
  $('#readyBtn').onclick = async()=>{ const nick = $('#jnick').value.trim(); if(!nick) return alert('Em nhập biệt danh trước nhé!');
    const ss = await store.getSession(pin); if(ss && (ss.status==='closed'||ss.status==='finished')) return alert('🚪 Phòng thi này đã đóng.');
    const pid = await store.join(pin, nick, getAv());
    try{ localStorage.setItem('eq_resume_live', JSON.stringify({ pin, playerId: pid, nick, at: Date.now() })); }catch{}
    renderPlayer(pin, pid); };
}
function renderHome(){
  app.innerHTML=`${DEMO?'<div class="notice"><b>Đang ở chế độ demo.</b></div>':''}
  <div class="card join"><h1>🎓 PCQuiz</h1><p class="small">Nhập mã phòng do giáo viên cung cấp — mã PIN trò chơi hay mã phòng thi đều dùng chung ô này, không cần tài khoản. Có liên kết vào phòng thì dán thẳng vào ô dưới, hoặc quét mã QR là vào ngay.</p>
  <input id="roomCode" placeholder="Mã phòng 6 số hoặc dán liên kết vào phòng" style="text-align:center;font-size:20px;font-weight:800;letter-spacing:2px">
  <button class="btn green" style="width:100%;margin-top:10px" id="enterBtn">Vào phòng →</button>
  <button class="btn light" style="width:100%;margin-top:8px" id="scanBtn" type="button">📷 Quét mã QR vào phòng ngay</button>
  <div id="qrScanBox" style="display:none;margin-top:10px"><div id="qrReader" style="max-width:340px;margin:0 auto"></div>
  <button class="btn red" style="width:100%;margin-top:8px" id="scanStop" type="button">✖ Đóng camera</button>
  <p class="small">Hướng camera vào mã QR của thầy/cô — quét được là vào phòng ngay, không cần nhập mã. Nếu máy hỏi quyền dùng camera, em chọn “Cho phép” nhé.</p></div></div>
  <div class="card center"><h2>Thầy/cô tổ chức trò chơi?</h2><p class="small">${me?`Đang đăng nhập: <b>${esc(me.displayName||me.email)}</b> • Gói <b>${esc(myPlan().name)}</b> • Hạn dùng: ${fmtDate(me.expiresAt)}`:'Đăng nhập để tạo thư viện và kho câu hỏi riêng. Chưa có tài khoản thì Đăng ký — admin phê duyệt xong mới đăng nhập được và tự động dùng gói Free.'}</p>
  <button class="btn" onclick="document.querySelector('[data-nav=library]').click()">Mở thư viện của tôi →</button></div>`;
  const go = async()=>{ const code = extractRoomCode($('#roomCode').value);
    if (!code) return alert('Em nhập mã phòng đủ 6 số, hoặc dán liên kết vào phòng, hoặc bấm nút quét mã QR nhé!');
    await enterRoomByCode(code); };
  $('#enterBtn').onclick = go;
  $('#roomCode').addEventListener('keydown', e=>{ if (e.key==='Enter') go(); });
  $('#roomCode').addEventListener('paste', ()=>setTimeout(()=>{ if (extractRoomCode($('#roomCode').value)) go(); }, 50));
  // Quét mã QR bằng camera (thư viện Html5Qrcode nạp từ index.html)
  let qrScanner = null;
  const stopScan = async()=>{ try{ if (qrScanner) await qrScanner.stop(); }catch{} try{ qrScanner?.clear(); }catch{} qrScanner = null; const b=$('#qrScanBox'); if (b) b.style.display='none'; };
  $('#scanStop').onclick = stopScan;
  $('#scanBtn').onclick = async()=>{
    if (!window.Html5Qrcode) return alert('Chưa tải được thư viện quét mã QR. Em kiểm tra kết nối mạng rồi tải lại trang, hoặc nhập mã phòng / dán liên kết nhé!');
    $('#qrScanBox').style.display = 'block';
    try{
      qrScanner = new window.Html5Qrcode('qrReader');
      await qrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } },
        async decoded => { const code = extractRoomCode(decoded); if (!code) return; await stopScan(); enterRoomByCode(code); },
        ()=>{});
    }catch(e){ await stopScan(); alert('Không mở được camera để quét mã. Em kiểm tra đã cấp quyền camera cho trang chưa, hoặc nhập mã phòng / dán liên kết vào ô trên nhé!'); }
  };
}

// ---------- Thư viện: hiện cả danh sách câu hỏi, có nút Sửa ----------
async function renderLibrary(){
  const all=await store.listQuizzes();
  const qs = me?.role==='admin' ? all : all.filter(q=>!q.ownerUid||q.ownerUid===me?.uid);
  app.innerHTML=`<div class="card"><h1>📚 Thư viện của tôi</h1><p class="small">Gói ${esc(myPlan().name)}${limit('maxQuizzes')?` • Tối đa ${limit('maxQuizzes')} bộ đề`:''} • Đang có ${qs.length} bộ. Bấm “Xem câu hỏi” để xem nội dung, “Sửa bộ đề” để sửa câu hỏi, đáp án, media, công thức.</p>
  ${qs.length?'':'<p class="small">Chưa có bộ câu hỏi nào. Tạo mới, tải file docx, hoặc tạo bằng AI.</p>'}
  ${qs.map(q=>`<div class="card" style="background:#fafafa">${q.cover?`<img src="${q.cover}" style="width:100%;height:150px;object-fit:cover;border-radius:12px;margin-bottom:10px">`:''}<div class="row"><div class="grow"><b>${esc(q.title)}</b><br><span class="small">${esc(q.subject||'')} • ${q.questions.length} câu hỏi${q.ownerEmail?` • của ${esc(q.ownerEmail)}`:''}</span></div>
  <button class="btn green" data-host="${q.id}" ${can('host')?'':'disabled'}>▶ Cuộc thi</button>
  <button class="btn light" data-practice="${q.id}">Tự luyện tập</button>
  <button class="btn light" data-viewq="${q.id}">👁️ Xem câu hỏi</button>
  <button class="btn" data-editq="${q.id}" ${can('create')?'':'disabled'}>✏️ Sửa bộ đề</button>
  <button class="btn red" data-delq="${q.id}">🗑️ Xóa bộ đề</button></div>
  <div data-qlist="${q.id}" style="display:none;margin-top:10px">${q.questions.map((qq,i)=>`<div style="border-top:1px solid #eee;padding:8px 0"><b>Câu ${i+1}:</b> ${richHtml(qq.text)} <span class="small">(${qq.time||20} giây • ${qq.points||0} điểm)</span>${mediaHtml(qq)}
  ${(qq.type==='tf'?['Đúng','Sai']:qq.answers).map((a,j)=>`<div class="small" style="margin-left:14px">${SHAPES[j]} ${richHtml(a)}${j===qq.correct?' <b style="color:#16a34a">✔ Đáp án đúng</b>':''}</div>`).join('')}</div>`).join('')}</div></div>`).join('')}</div>`;
  math(app);
  app.querySelectorAll('[data-host]').forEach(b=>b.onclick=async()=>{ const q=await store.getQuiz(b.dataset.host); renderHost(await store.createSession(q)); });
  app.querySelectorAll('[data-practice]').forEach(b=>b.onclick=async()=>{ if(requireLogin('practice')) renderPractice(await store.getQuiz(b.dataset.practice)); });
  app.querySelectorAll('[data-viewq]').forEach(b=>b.onclick=()=>{ const el=app.querySelector(`[data-qlist="${b.dataset.viewq}"]`); el.style.display = el.style.display==='none'?'block':'none'; math(el); });
  app.querySelectorAll('[data-editq]').forEach(b=>b.onclick=async()=>{ const q=await store.getQuiz(b.dataset.editq); renderCreate(q.questions, q.title, q.subject, q.id, q.cover||'', q.contestBg||'', q.coverFade, q.bgFade); });
  app.querySelectorAll('[data-delq]').forEach(b=>b.onclick=async()=>{ const q=await store.getQuiz(b.dataset.delq); if(confirm('Xóa hẳn bộ đề “'+(q?.title||'')+'” khỏi thư viện? Bộ đề sẽ biến mất và không tổ chức được nữa.')){ await store.deleteQuiz(b.dataset.delq); renderLibrary(); } });
}

// ---------- Tạo / sửa câu hỏi: Media + công thức Toán/Hóa ----------
function emptyQ(){ return {text:'',type:'quiz',answers:['','','',''],correct:0,time:20,points:1000,media:null}; }

// Hub khi bam "Tao bo cau hoi": 3 tuy chon
function renderCreateHub(){
  app.innerHTML=`<div class="card"><h1>➕ Tạo bộ câu hỏi</h1><p class="small">Thầy/cô chọn cách tạo bộ đề:</p>
  <div class="row" style="align-items:stretch">
  ${can('create')?`<button class="btn grow" id="hubManual" style="padding:22px;font-size:18px;background:#dbeafe;color:#1e3a5f;border:2px solid #93c5fd">✍️<br>Tạo thủ công<br><span class="small" style="font-weight:400">Tự soạn từng câu hỏi, đáp án, media và công thức</span></button>`:''}
  ${can('upload')?`<button class="btn grow" id="hubUpload" style="padding:22px;font-size:18px;background:#dcfce7;color:#14532d;border:2px solid #86efac">📄<br>Tải file đề lên<br><span class="small" style="font-weight:400">File Word (.docx) với đáp án đúng in đậm</span></button>`:''}
  ${can('ai')?`<button class="btn grow" id="hubAI" style="padding:22px;font-size:18px;background:#f3e8ff;color:#581c87;border:2px solid #d8b4fe">🤖<br>Tạo bằng AI<br><span class="small" style="font-weight:400">Nhập chủ đề hoặc đính kèm tài liệu, AI soạn câu hỏi</span></button>`:''}
  </div>${(!can('create')&&!can('upload')&&!can('ai'))?'<p class="small">Tài khoản của thầy/cô chưa được cấp quyền tạo bộ câu hỏi. Vui lòng liên hệ admin.</p>':''}</div>`;
  const m=$('#hubManual'); if(m) m.onclick=()=>renderCreate();
  const u=$('#hubUpload'); if(u) u.onclick=()=>renderImport();
  const a=$('#hubAI'); if(a) a.onclick=()=>renderAI();
}
// Hub khi bam "Cuoc thi": 2 tuy chon Truc tiep / Gian tiep
function renderContestHub(){
  app.innerHTML=`<div class="card"><h1>🏆 Cuộc thi</h1><p class="small">Thầy/cô chọn hình thức tổ chức:</p>
  <div class="row" style="align-items:stretch">
  ${can('host')?`<button class="btn grow" id="ctLive" style="padding:22px;font-size:18px;background:#ffedd5;color:#7c2d12;border:2px solid #fdba74">📺<br>Trực tiếp<br><span class="small" style="font-weight:400">Chế độ tổ chức chơi trực tiếp bằng mã PIN như hiện tại — vào Thư viện, chọn bộ đề rồi bấm nút Cuộc thi</span></button>`:''}
  ${can('create')?`<button class="btn grow" id="ctAsync" style="padding:22px;font-size:18px;background:#ccfbf1;color:#134e4a;border:2px solid #5eead4">🕒<br>Gián tiếp<br><span class="small" style="font-weight:400">Chế độ cuộc thi theo khung giờ như hiện tại — đặt giờ mở/đóng phòng, mật mã, số lần làm lại, học sinh tự vào làm bài</span></button>`:''}
  </div>${(!can('host')&&!can('create'))?'<p class="small">Tài khoản của thầy/cô chưa được cấp quyền tổ chức cuộc thi. Vui lòng liên hệ admin.</p>':''}</div>`;
  const l=$('#ctLive'); if(l) l.onclick=()=>renderLibrary();
  const a=$('#ctAsync'); if(a) a.onclick=()=>renderContests();
}
function renderCreate(prefill, title0, subject0, editId, cover0, bg0, cFade0, bFade0){
  let questions = prefill ? structuredClone(prefill) : [emptyQ()];
  let coverImg = cover0||'', bgImg = bg0||'';
  let coverFade = (cFade0===undefined||cFade0===null)?80:+cFade0, bgFade = (bFade0===undefined||bFade0===null)?85:+bFade0;
  const draw=()=>{ app.innerHTML=`<div class="card"><h1>✏️ Tạo bộ câu hỏi</h1>
    <input id="qt" placeholder="Tiêu đề bộ câu hỏi" value="${esc(title0||'')}"><input id="qs" placeholder="Môn học / chủ đề" value="${esc(subject0||'')}">
    ${can('branding')?`<div class="row"><div class="grow"><label class="small"><b>🖼️ Ảnh bìa bộ đề</b> (hiện ở Thư viện và phòng chờ)</label><input type="file" accept="image/*" id="coverFile"><div id="coverPrev">${coverImg?`<img src="${coverImg}" style="width:100%;max-height:150px;object-fit:cover;border-radius:10px">`:''}</div>
    <div class="row"><label class="small">Độ mờ ảnh bìa: <b id="coverFadeVal">${coverFade}%</b></label><input type="range" id="coverFadeR" min="0" max="100" value="${coverFade}" class="grow" style="width:auto;margin:0"><button type="button" class="btn red" id="coverDel" style="padding:6px 12px;font-size:13px">🗑️ Xóa ảnh bìa</button></div></div>
    <div class="grow"><label class="small"><b>🌄 Ảnh nền cuộc thi</b> (hiện ở khu vực thi của học sinh)</label><input type="file" accept="image/*" id="bgFile"><div id="bgPrev">${bgImg?`<img src="${bgImg}" style="width:100%;max-height:150px;object-fit:cover;border-radius:10px">`:''}</div>
    <div class="row"><label class="small">Độ mờ ảnh nền: <b id="bgFadeVal">${bgFade}%</b></label><input type="range" id="bgFadeR" min="0" max="100" value="${bgFade}" class="grow" style="width:auto;margin:0"><button type="button" class="btn red" id="bgDel" style="padding:6px 12px;font-size:13px">🗑️ Xóa ảnh nền</button></div></div></div>`:''}
    <div class="notice small">💡 <b>Công thức Toán/Hóa:</b> viết trong dấu $, ví dụ $x^2+2x+1=0$, phân số $\\frac{1}{2}$, hóa học $\\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}$, ký hiệu $H_2O$, $\\sqrt{16}$, $\\alpha, \\beta, \\pi$. Xem trước ở khung dưới mỗi câu.<br>
    🖼️ <b>Media:</b> dán link ảnh/video/âm thanh, hoặc tải ảnh lên (ảnh được nén nhỏ). Video YouTube dán link watch là xem được.</div>
    <div id="qlist"></div>
    <div class="row"><button class="btn light" id="addQ">+ Thêm câu hỏi</button><button class="btn green grow" id="saveQ">💾 Lưu vào thư viện của tôi</button></div></div>`;
    $('#qlist').innerHTML=questions.map((q,i)=>`<div class="card" style="background:#fafafa"><b>Câu ${i+1}</b>
      <input data-q="${i}" data-f="text" placeholder="Nội dung câu hỏi (gõ $...$ cho công thức)" value="${richHtml(q.text)}">
      <div class="small" style="background:#fff;border:1px dashed #bbb;border-radius:8px;padding:8px">Xem trước: <span data-preview="${i}">${richHtml(q.text)}</span>${mediaHtml(q)}</div>
      <div class="row"><select data-q="${i}" data-f="type"><option value="quiz" ${q.type==='quiz'?'selected':''}>Trắc nghiệm</option><option value="tf" ${q.type==='tf'?'selected':''}>Đúng / Sai</option></select>
      <select data-q="${i}" data-f="time">${[10,15,20,25,30,45,60,90,120].map(t=>`<option ${q.time===t?'selected':''} value="${t}">${t} giây</option>`).join('')}</select>
      <select data-q="${i}" data-f="points">${[500,1000,1500,2000].map(p=>`<option ${q.points===p?'selected':''} value="${p}">${p+' điểm'}</option>`).join('')}</select></div>
      <div class="row"><select data-q="${i}" data-f="mtype"><option value="">Media: không có</option><option value="image" ${q.media?.type==='image'?'selected':''}>Ảnh</option><option value="video" ${q.media?.type==='video'?'selected':''}>Video</option><option value="audio" ${q.media?.type==='audio'?'selected':''}>Âm thanh</option></select>
      <input class="grow" data-q="${i}" data-f="murl" placeholder="Dán link media (https://...)" value="${esc(q.media?.url?.startsWith('data:')?'':(q.media?.url||''))}">
      <label class="btn light" style="cursor:pointer">📷 Tải ảnh<input type="file" accept="image/*" data-upload="${i}" style="display:none"></label></div>
      <div class="row"><button class="btn light" data-mathbtn="${i}">🧮 Soạn công thức trực quan</button><button class="btn light" data-insmedia="${i}">⬇️ Chèn media vào vị trí con trỏ</button><span class="small">Đặt con trỏ vào ô câu hỏi/đáp án trước, rồi bấm chèn.</span></div>
      ${q.type==='tf'?`<div class="row"><button class="btn ${q.correct===0?'green':'light'}" data-tf="${i}" data-v="0">✔ Đúng là đáp án đúng</button><button class="btn ${q.correct===1?'green':'light'}" data-tf="${i}" data-v="1">✖ Sai là đáp án đúng</button></div>`
      : q.answers.map((a,j)=>`<div class="row"><span class="shape" style="color:#7c3aed">${SHAPES[j]}</span><input class="grow" data-q="${i}" data-a="${j}" placeholder="Phương án ${j+1} (gõ $...$ cho công thức)" value="${richHtml(a)}"><label><input type="radio" name="c${i}" data-q="${i}" data-c="${j}" ${q.correct===j?'checked':''} style="width:auto"> Đúng</label></div>`).join('')}
      <div class="small" style="background:#fff;border:1px dashed #bbb;border-radius:8px;padding:8px;margin-top:8px">Xem trước đáp án (như học sinh thấy):
      ${q.type==='tf'?`<div class="answers" style="pointer-events:none;margin-top:6px"><button class="ans a0" style="min-height:44px;padding:10px;font-size:15px">✔ Đúng</button><button class="ans a1" style="min-height:44px;padding:10px;font-size:15px">✖ Sai</button></div>`
      :`<div class="answers" style="pointer-events:none;margin-top:6px">${q.answers.map((a,j)=>`<button class="ans ${COLORS[j]}" style="min-height:44px;padding:10px;font-size:15px"><span class="shape">${SHAPES[j]}</span><span data-preview-a="${i}-${j}">${richHtml(a)}</span></button>`).join('')}</div>`}</div>
      <button class="btn red" data-del="${i}">Xoá câu này</button></div>`).join('');
    app.querySelectorAll('[data-preview]').forEach(el=>math(el.parentElement));
    app.querySelectorAll('input,select').forEach(el=>el.onchange=sync);
    app.querySelectorAll('[data-upload]').forEach(inp=>inp.onchange=async()=>{ const f=inp.files[0]; if(!f) return; sync(); questions[+inp.dataset.upload].media={type:'image',url:await compressImage(f)}; draw(); });
    app.querySelectorAll('[data-mathbtn]').forEach(b=>b.onclick=()=>{ sync(); openMathEditor(); });
    const cf=$('#coverFile'); if(cf) cf.onchange=async()=>{ const f=cf.files[0]; if(!f) return; coverImg=await compressImage(f); $('#coverPrev').innerHTML=`<img src="${coverImg}" style="width:100%;max-height:150px;object-fit:cover;border-radius:10px">`; };
    const bf=$('#bgFile'); if(bf) bf.onchange=async()=>{ const f=bf.files[0]; if(!f) return; bgImg=await compressImage(f); $('#bgPrev').innerHTML=`<img src="${bgImg}" style="width:100%;max-height:150px;object-fit:cover;border-radius:10px">`; };
    const cfr=$('#coverFadeR'); if(cfr) cfr.oninput=()=>{ coverFade=+cfr.value; $('#coverFadeVal').textContent=coverFade+'%'; };
    const bfr=$('#bgFadeR'); if(bfr) bfr.oninput=()=>{ bgFade=+bfr.value; $('#bgFadeVal').textContent=bgFade+'%'; };
    const cd=$('#coverDel'); if(cd) cd.onclick=()=>{ coverImg=''; $('#coverPrev').innerHTML=''; const f=$('#coverFile'); if(f) f.value=''; };
    const bd=$('#bgDel'); if(bd) bd.onclick=()=>{ bgImg=''; $('#bgPrev').innerHTML=''; const f=$('#bgFile'); if(f) f.value=''; };
    app.querySelectorAll('[data-insmedia]').forEach(b=>b.onclick=()=>{ sync(); const q=questions[+b.dataset.insmedia]; const url=q.media?.url||''; if(!url) return alert('Câu này chưa có media. Thầy/cô dán link media hoặc tải ảnh lên trước nhé!'); insertAtCursor('[media:'+url+']'); });
    app.querySelectorAll('[data-tf]').forEach(b=>b.onclick=()=>{ sync(); questions[+b.dataset.tf].correct=+b.dataset.v; draw(); });
    app.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ sync(); questions.splice(+b.dataset.del,1); draw(); });
    $('#addQ').onclick=()=>{ sync(); const limN=limit('maxQuestions'); if(limN>0&&questions.length>=limN) return alert(`Gói ${myPlan().name} tối đa ${limN} câu / bộ đề.`); questions.push(emptyQ()); draw(); };
    $('#saveQ').onclick=async()=>{ sync(); const title=$('#qt').value.trim(); if(!title||questions.some(q=>!q.text.trim())) return alert('Thầy điền tiêu đề và nội dung cho mọi câu hỏi nhé!');
      questions.forEach(q=>{ if(q.type==='tf') q.answers=['Đúng','Sai']; q.time=+q.time; q.points=+q.points; if(q.media&&!q.media.url) q.media=null; });
      const chk=await checkQuizLimits(questions.length, editId); if(chk!==true) return alert(chk);
      if(editId){ await store.updateQuiz(editId,{title,subject:$('#qs').value.trim(),questions,cover:coverImg,contestBg:bgImg,coverFade,bgFade}); alert('Đã cập nhật bộ đề!'); }
      else await store.createQuiz({title,subject:$('#qs').value.trim(),questions,cover:coverImg,contestBg:bgImg,coverFade,bgFade,ownerUid:me?.uid||'',ownerEmail:me?.email||''});
      renderLibrary(); };
    function sync(){ app.querySelectorAll('[data-q]').forEach(el=>{ const q=questions[+el.dataset.q]; if(!q) return;
      if(el.dataset.f==='text') q.text=el.value; else if(el.dataset.f==='type') q.type=el.value; else if(el.dataset.f==='time') q.time=el.value; else if(el.dataset.f==='points') q.points=el.value;
      else if(el.dataset.f==='mtype'||el.dataset.f==='murl'){ q.media=q.media||{type:'',url:''}; if(el.dataset.f==='mtype') q.media.type=el.value; else if(!q.media.url?.startsWith('data:')) q.media.url=el.value; if(!q.media.type&&q.media.url) q.media.type='image'; }
      if(el.dataset.a!==undefined) q.answers[+el.dataset.a]=el.value; if(el.dataset.c!==undefined&&el.checked) q.correct=+el.dataset.c; });
      app.querySelectorAll('[data-preview]').forEach(el=>{ el.textContent=questions[+el.dataset.preview]?.text||''; math(el.parentElement); });
      app.querySelectorAll('[data-preview-a]').forEach(el=>{ const [qi,aj]=el.dataset.previewA.split('-').map(Number); el.textContent=questions[qi]?.answers?.[aj]||''; math(el.closest('.small')||el.parentElement); }); }
  }; draw();
}
function compressImage(file, maxW){ return new Promise(res=>{ const img=new Image(); img.onload=()=>{ const max=maxW||900, sc=Math.min(1,max/Math.max(img.width,img.height));
  const cv=document.createElement('canvas'); cv.width=img.width*sc; cv.height=img.height*sc; cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height); res(cv.toDataURL('image/jpeg',0.82)); };
  img.onerror=()=>res(''); img.src=URL.createObjectURL(file); }); }

// ---------- Tải file đề docx: đáp án đúng được IN ĐẬM ----------
async function compressDataUrl(dataUrl, maxW=900){ return new Promise(res=>{ const img=new Image(); img.onload=()=>{ try{ const sc=Math.min(1,maxW/Math.max(img.width,img.height)); const cv=document.createElement('canvas'); cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc); const cx=cv.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,cv.width,cv.height); cx.drawImage(img,0,0,cv.width,cv.height); res(cv.toDataURL('image/jpeg',0.82)); }catch{ res(dataUrl); } }; img.onerror=()=>res(dataUrl); img.src=dataUrl; }); }
async function parseDocxQuestions(file){
  const zip = await window.JSZip.loadAsync(file);
  const xml = await zip.file('word/document.xml').async('string');
  // Anh nhung trong file Word: map rId -> dataURL (da nen nho de vua gioi han luu tru)
  const imgByRid = {};
  try{
    const relFile = zip.file('word/_rels/document.xml.rels');
    if (relFile){ const rels = await relFile.async('string');
      const relMap = {}; [...rels.matchAll(/<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].forEach(mm=>relMap[mm[1]]=mm[2]);
      for (const [rid,target] of Object.entries(relMap)){ if (!/media\//.test(target)) continue;
        const path = target.startsWith('word/') ? target : 'word/'+target.replace(/^\//,'');
        const f = zip.file(path); if (!f) continue;
        const b64 = await f.async('base64'); const ext=(path.split('.').pop()||'png').toLowerCase();
        const mime = (ext==='jpg'||ext==='jpeg') ? 'image/jpeg' : ext==='gif' ? 'image/gif' : 'image/png';
        imgByRid[rid] = await compressDataUrl('data:'+mime+';base64,'+b64);
      }
    }
  }catch(e){}
  const dec = t => t.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
  const paras = [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map(m=>{
    const runs=[...m[0].matchAll(/<w:r[\s>][\s\S]*?<\/w:r>/g)].map(r=>{ const t=[...r[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x=>x[1]).join('');
      const bold = /<w:b\s*\/>|<w:b>/.test(r[0]) && !/<w:b[^>]*w:val="(?:false|0|off)"/.test(r[0]); return {t,bold}; });
    const imgs=[...m[0].matchAll(/<a:blip[^>]*r:embed="(rId\d+)"/g)].map(x=>imgByRid[x[1]]).filter(Boolean);
    const maths=[...m[0].matchAll(/<m:oMath[\s>][\s\S]*?<\/m:oMath>/g)].map(b=>dec([...b[0].matchAll(/<m:t[^>]*>([\s\S]*?)<\/m:t>/g)].map(x=>x[1]).join(''))).filter(t=>t.trim());
    return { text: dec(runs.map(r=>r.t).join('')).trim(), hasBold: runs.some(r=>r.bold&&r.t.trim()), imgs, maths };
  }).filter(p=>p.text||p.imgs.length||p.maths.length);
  const questions=[]; let cur=null;
  const optRe=/^([A-Da-d])\s*[.)]\s*(.*)$/, qRe=/^(?:Câu|Cau)?\s*\d+\s*[.)]\s*(.*)$/i;
  for(const p of paras){
    const withMath = txt => txt + (p.maths.length? ' ' + p.maths.map(mt=>'$'+mt+'$').join(' ') : '');
    const putImgs = ()=>{ if(!cur) return; p.imgs.forEach(u=>{ if(!cur.media) cur.media={type:'image',url:u}; else cur.text += ' [media:'+u+']'; }); };
    const om=p.text.match(optRe);
    if (om && cur){ const idx='ABCD'.indexOf(om[1].toUpperCase()); cur.answers[idx]=withMath(om[2].trim()); if(p.hasBold) cur.correct=idx; putImgs(); continue; }
    const qm=p.text.match(qRe);
    if (qm && !om){ if(cur) questions.push(cur); cur={text:withMath(qm[1].trim()),type:'quiz',answers:['','','',''],correct:0,time:20,points:1000,media:null,_boldFound:false}; putImgs(); continue; }
    if (cur && !om){ cur.text += (cur.text?' ':'')+withMath(p.text); putImgs(); }
  }
  if(cur) questions.push(cur);
  questions.forEach(q=>{ q.answers=q.answers.map(a=>a||''); });
  return questions.filter(q=>q.text && q.answers.filter(Boolean).length>=2);
}
function renderImport(){
  app.innerHTML=`<div class="card"><h1>📄 Tải file đề (.docx)</h1>
  <div class="notice small"><b>Định dạng file cần có:</b> mỗi câu bắt đầu bằng “Câu 1.” hoặc “1.”, các phương án ghi “A. ...”, “B. ...”, “C. ...”, “D. ...” và <b>đáp án đúng được in đậm</b> trong Word. Hệ thống đọc chữ in đậm để biết đáp án đúng.<br>Ví dụ:<br>Câu 1. Thủ đô của Việt Nam là gì?<br>A. Huế &nbsp; <b>B. Hà Nội</b> &nbsp; C. Đà Nẵng &nbsp; D. Cần Thơ<br><span class="small">(Nếu các phương án nằm cùng 1 dòng như ví dụ, hãy để mỗi phương án 1 dòng trong Word để đọc chính xác nhất.)</span></div>
  <input type="file" id="docxFile" accept=".docx">
  <input id="ititle" placeholder="Tiêu đề bộ đề (mặc định lấy tên file)">
  <button class="btn green" id="doImport">Đọc file và xem trước</button><div id="iprev" style="margin-top:14px"></div></div>`;
  $('#doImport').onclick=async()=>{ const f=$('#docxFile').files[0]; if(!f) return alert('Thầy chọn file .docx trước nhé!');
    try{ const qs=await parseDocxQuestions(f);
      if(!qs.length){ $('#iprev').innerHTML='<div class="notice">Không đọc được câu hỏi nào. Thầy kiểm tra lại định dạng: “Câu 1.” + phương án A./B./C./D. mỗi phương án 1 dòng, đáp án đúng in đậm.</div>'; return; }
      const noBold = qs.filter(q=>q.correct===0).length;
      $('#iprev').innerHTML=`<p class="big">Đọc được ${qs.length} câu hỏi</p>${qs.map((q,i)=>`<p class="small">Câu ${i+1}: ${richHtml(q.text)}<br>${q.answers.map((a,j)=>`${SHAPES[j]} ${richHtml(a)}${j===q.correct?' <b>✔ đáp án đúng</b>':''}`).join('<br>')}</p>`).join('')}
      <button class="btn green" id="saveImport">💾 Lưu ${qs.length} câu vào thư viện</button> <button class="btn light" id="editImport">Mở trong trình tạo để sửa</button>`;
      $('#saveImport').onclick=async()=>{ const chk=await checkQuizLimits(qs.length); if(chk!==true) return alert(chk);
        await store.createQuiz({title:$('#ititle').value.trim()||f.name.replace(/\.docx$/i,''),subject:'Tải từ file Word',questions:qs,ownerUid:me.uid,ownerEmail:me.email}); alert('Đã lưu vào thư viện!'); renderLibrary(); };
      $('#editImport').onclick=()=>renderCreate(qs, $('#ititle').value.trim()||f.name.replace(/\.docx$/i,''), 'Tải từ file Word');
    }catch(e){ $('#iprev').innerHTML='<div class="notice">Đọc file chưa được: '+esc(e.message)+'</div>'; } };
}

// ---------- Kho API key hệ thống (Gemini) + xoay vòng ----------
const maskKey = k => '...' + String(k||'').slice(-3);
async function addKeyToPool(key, addedBy){
  if (DEMO || !key) return null;
  const all = await F.getDocs(F.collection(db,'apiKeys'));
  const dup = all.docs.find(d=>d.data().key===key); if (dup) return dup.id;
  const r = await F.addDoc(F.collection(db,'apiKeys'), { key, addedBy: addedBy||me?.email||'', addedByUid: me?.uid||'', addedAt: Date.now(), status:'ready', lastUsedAt:0, lastError:'' });
  return r.id;
}
async function poolKeys(){
  if (DEMO) return [];
  const s = await F.getDocs(F.collection(db,'apiKeys'));
  const order = {ready:0, quota:1, error:2};
  // Lay ca key dang loi/het han muc de thu lai (tu phuc hoi khi chay duoc), key san sang dung truoc
  return s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>((order[a.status]??0)-(order[b.status]??0)) || ((a.lastUsedAt||0)-(b.lastUsedAt||0)));
}
async function markKey(id, patch){ if(!DEMO) await F.updateDoc(F.doc(db,'apiKeys',id), patch); }
// Danh sach model DA KIEM CHUNG TRUC TIEP ngay 18/11/2026 bang key trong kho:
// - gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-flash-lite-latest: tra loi 1-3 giay, JSON dung.
// - gemini-3-flash-preview: chay duoc nhung cham hon (~10 giay), de lam du phong cuoi.
// KHONG dung lai cac model cu: gemini-3.8-flash va gemini-flash-latest treo qua 30 giay khong tra loi,
// gemini-3.5-flash/3.6-flash bao 503 qua tai, gemini-2.5-flash/2.0-flash da bi Google ngung (404).
const GEMINI_MODELS = ['gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-flash-lite-latest','gemini-3-flash-preview'];
const AI_ATTEMPT_TIMEOUT_MS = 20000; // Moi lan goi model toi da 20 giay, qua la tu ngat va chuyen model khac
const AI_TOTAL_TIMEOUT_MS = 90000;   // Toan bo lan tao de toi da 90 giay, khong bao gio treo vo han
const isModelError = e => e?.status===404 || /model[^.]*?(not found|no longer available|not supported)|is not found for API version/i.test(e?.message||'');
const isTransientError = e => e?.status===503 || e?.status===500 || /high demand|overloaded|UNAVAILABLE|temporarily|try again later/i.test(e?.message||'');
const isNetworkError = e => e?.name==='TypeError' || /failed to fetch|networkerror|load failed|network request failed/i.test(e?.message||'');
const NETWORK_MSG = 'Không kết nối được tới máy chủ Google AI (Failed to fetch). Đây là lỗi kết nối mạng hoặc trình duyệt chặn, KHÔNG phải lỗi API key. Cách xử lý: 1) Kiểm tra lại kết nối mạng. 2) Nếu đang dùng trình duyệt Brave: bấm biểu tượng con sư tử ở thanh địa chỉ và hạ Shields xuống (Shields Down) cho trang này; tắt app chặn quảng cáo/VPN nếu có. 3) Hoặc mở trang bằng Chrome rồi thử lại.';
const sleepMs = ms => new Promise(r=>setTimeout(r,ms));
async function callGemini(parts, key, ctl={}){
  let lastErr = null, sawTransient = false, sawNetwork = false, sawTimeout = false;
  const deadline = ctl.deadline || (Date.now() + AI_TOTAL_TIMEOUT_MS);
  for (const model of GEMINI_MODELS){
    if (ctl.signal?.aborted){ const err=new Error('Đã huỷ tạo câu hỏi.'); err.cancelled=true; throw err; }
    const remain = deadline - Date.now();
    if (remain <= 0){ sawTimeout = true; break; }
    // Moi lan goi co dong ho ngat rieng: model treo qua thoi gian nay thi bo qua ngay, khong de ca trang dung yen
    const ac = new AbortController();
    const timer = setTimeout(()=>ac.abort(), Math.min(AI_ATTEMPT_TIMEOUT_MS, remain));
    const onParentAbort = ()=>ac.abort();
    if (ctl.signal){ if (ctl.signal.aborted) ac.abort(); else ctl.signal.addEventListener('abort', onParentAbort, {once:true}); }
    try{
      ctl.onProgress?.(model);
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+encodeURIComponent(key), {
        method:'POST', headers:{'Content-Type':'application/json'}, signal: ac.signal,
        body: JSON.stringify({ contents:[{parts}], generationConfig:{ responseMimeType:'application/json', temperature:0.7 } }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok){ const err=new Error(j?.error?.message||('HTTP '+r.status)); err.status=r.status; throw err; }
      const text = j?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
      if (!text){ const err=new Error('Model '+model+' trả về rỗng'+(j?.candidates?.[0]?.finishReason?(' ('+j.candidates[0].finishReason+')'):'')); err.modelError=true; throw err; }
      return text;
    }catch(e){
      lastErr = e;
      if (ctl.signal?.aborted){ const err=new Error('Đã huỷ tạo câu hỏi.'); err.cancelled=true; throw err; }
      if (e?.name==='AbortError'){ sawTimeout=true; continue; } // Het 20 giay ma model chua tra loi -> chuyen model khac ngay
      if (isModelError(e)) continue;
      if (isNetworkError(e)){ sawNetwork=true; continue; }
      if (isTransientError(e)){ sawTransient=true; continue; }
      throw e;
    }finally{ clearTimeout(timer); if (ctl.signal) ctl.signal.removeEventListener?.('abort', onParentAbort); }
  }
  if (sawNetwork){ const err=new Error(NETWORK_MSG); err.network=true; throw err; }
  if (sawTimeout && !sawTransient){ const err=new Error('Model AI phản hồi quá chậm (quá '+Math.round(AI_ATTEMPT_TIMEOUT_MS/1000)+' giây mỗi lần thử và quá thời gian chờ tối đa). Đây là lỗi phía máy chủ Google, không phải lỗi API key. Thầy/cô bấm tạo lại, hoặc chờ khoảng 1 phút rồi thử lại nhé.'); err.timeout=true; err.transient=true; throw err; }
  if (sawTransient){ const err=new Error('Máy chủ AI của Google đang quá tải do nhu cầu cao (lỗi tạm thời phía Google, không phải lỗi API key). Thầy/cô chờ khoảng 1 phút rồi bấm tạo lại nhé.'); err.transient=true; throw err; }
  const err = new Error('Không có model Gemini nào khả dụng lúc này. Lỗi cuối: '+(lastErr?.message||'')); err.modelError = true; err.status = lastErr?.status; throw err;
}

async function generateWithRotation(parts, ownKey, ctl={}){
  if (!ctl.deadline) ctl.deadline = Date.now() + AI_TOTAL_TIMEOUT_MS;
  const candidates = [];
  if (ownKey){ const id = await addKeyToPool(ownKey, me?.email); candidates.push({id, key:ownKey, own:true}); }
  if (can('systemKeys') || me?.role==='admin'){ (await poolKeys()).forEach(k=>{ if(!candidates.some(c=>c.key===k.key)) candidates.push({id:k.id, key:k.key}); }); }
  if (!candidates.length) throw new Error('Chưa có API key khả dụng. Thầy/cô nhập API key Gemini của mình, hoặc nhờ admin cấp quyền “Dùng API key hệ thống”.');
  let lastErr = null;
  for (const c of candidates){
    try{ const text = await callGemini(parts, c.key, ctl); if (c.id) await markKey(c.id, { status:'ready', lastUsedAt: Date.now(), lastError:'' }); return text; }
    catch(e){ lastErr = e;
      if (e.cancelled) throw e;
      if (e.timeout) throw e;
      if (e.network || isNetworkError(e)){ const ne = new Error(NETWORK_MSG); ne.network = true; throw ne; }
      if (e.transient || isTransientError(e)){ const te = new Error('Máy chủ AI của Google đang quá tải do nhu cầu cao (lỗi tạm thời phía Google, không phải lỗi API key). Thầy/cô chờ khoảng 1 phút rồi bấm tạo lại nhé.'); te.transient = true; throw te; }
      if (e.modelError || isModelError(e)) throw e; // Loi model la loi cua he thong, khong phai loi cua key -> khong danh dau key, khong thu key khac
      const quota = e.status===429 || /quota|rate|RESOURCE_EXHAUSTED/i.test(e.message||'');
      if (c.id) await markKey(c.id, { status: quota?'quota':'error', lastError: String(e.message||e).slice(0,200), lastUsedAt: Date.now() });
      continue; }
  }
  throw new Error('Tất cả API key đều lỗi hoặc hết hạn mức. Lỗi cuối: '+(lastErr?.message||'không rõ'));
}
async function extractFileForAI(file){
  // File chỉ đọc tại trình duyệt để tạo câu hỏi, KHÔNG lưu lên hệ thống
  if (!file) return { parts:[], note:'' };
  const ext = (file.name.split('.').pop()||'').toLowerCase();
  if (file.type.startsWith('image/')){ const b64 = await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
    return { parts:[{ inlineData:{ mimeType:file.type, data:b64 } }], note:' (có ảnh đính kèm: '+file.name+')' }; }
  if (ext==='pdf'){ try{ const buf=await file.arrayBuffer(); const pdf=await window.pdfjsLib.getDocument({data:buf}).promise; let txt='';
      for(let i=1;i<=Math.min(pdf.numPages,20);i++){ const pg=await pdf.getPage(i); const tc=await pg.getTextContent(); txt+=tc.items.map(x=>x.str).join(' ')+'\n'; }
      return { parts:[{text:'Tài liệu tham khảo (trích từ PDF):\n'+txt.slice(0,15000)}], note:' (có tài liệu PDF: '+file.name+')' };
    }catch{ const b64=await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
      return { parts:[{ inlineData:{ mimeType:'application/pdf', data:b64 } }], note:' (có PDF đính kèm: '+file.name+')' }; } }
  if (ext==='docx'){ const zip=await window.JSZip.loadAsync(file); const xml=await zip.file('word/document.xml').async('string');
    const txt=[...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map(m=>[...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x=>x[1]).join('')).join('\n');
    return { parts:[{text:'Tài liệu tham khảo (trích từ Word):\n'+txt.slice(0,15000)}], note:' (có tài liệu Word: '+file.name+')' }; }
  return { parts:[], note:'' };
}

// ---------- Tạo đề bằng AI ----------
function renderAI(){
  app.innerHTML=`<div class="card"><h1>🤖 Tạo đề bằng AI (Google Gemini)</h1>
  <input id="aiTopic" placeholder="Chủ đề, ví dụ: Ôn tập phân số lớp 5, Bài 12 Sinh học 10...">
  <div class="row"><label class="small">Số câu <input id="aiCount" type="number" value="10" min="1" max="40" style="width:90px"></label>
  <label class="small">Mức độ <select id="aiLevel" style="width:auto"><option>Dễ</option><option selected>Trung bình</option><option>Khó</option><option>Hỗn hợp</option></select></label>
  <label class="small">Thời gian/câu <select id="aiTime" style="width:auto">${[10,15,20,25,30,45,60,90,120].map(t=>`<option ${t===20?'selected':''} value="${t}">${t} giây</option>`).join('')}</select></label></div>
  <label class="small"><b>Tài liệu tham khảo (không bắt buộc):</b> PDF, Word (.docx) hoặc ảnh. Có thể bấm Ctrl+V để dán ảnh chụp màn hình vào khung dưới. File chỉ dùng để tạo câu hỏi trong lần này, <b>không lưu vào hệ thống</b> để tránh tốn lưu lượng.</label>
  <input type="file" id="aiFile" accept=".pdf,.docx,image/*">
  <div id="aiFileName" class="small" style="margin:4px 0"></div>
  <div class="row"><a class="btn light" href="https://taphuan.nxbgd.vn/" target="_blank" rel="noopener">📚 Mở SGK phổ thông</a><span class="small">Mở kho sách giáo khoa điện tử của NXB Giáo dục để tham khảo nội dung khi tạo đề.</span></div>
  <div id="aiPaste" contenteditable="true" style="border:2px dashed #bbb;border-radius:10px;padding:14px;min-height:56px;background:#fff">Bấm vào đây rồi nhấn Ctrl+V để dán ảnh chụp màn hình…</div>
  <div id="aiPastePrev"></div>
  <label class="small"><b>API key Gemini của thầy/cô</b> (lấy miễn phí tại Google AI Studio — aistudio.google.com/apikey)${can('systemKeys')||me?.role==='admin'?' — hoặc để trống để dùng kho key hệ thống':''}:</label>
  <input id="aiKey" type="password" placeholder="AIza..." autocomplete="off">
  <div class="row"><a class="btn light" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">🔑 Tới trang lấy API key miễn phí</a><button class="btn" id="saveKey" type="button">💾 Lưu API key</button><span class="small" id="saveKeyMsg"></span></div>
  <p class="small">Key sẽ được lưu vào kho key chung của hệ thống để dùng chung; lần sau thầy/cô không cần nhập lại.</p>
  <button class="btn green" id="doAI">✨ Tạo câu hỏi bằng AI</button> <button class="btn red" id="aiCancel" type="button" style="display:none">⏹ Huỷ tạo</button> <span id="aiStatus" class="small"></span>
  <div id="aiResult" style="margin-top:14px"></div></div>`;
  let pastedImages = aiPastedImages;
  const drawPastePrev = ()=>{ const box=$('#aiPastePrev'); if(!box) return;
    box.innerHTML = pastedImages.length? `<p class="small">📎 Đã có <b>${pastedImages.length} ảnh</b> chụp màn hình đính kèm — xem từng ảnh bên dưới, bấm ✕ Bỏ để loại ảnh không cần:</p>` + pastedImages.map((f,i)=>`<span style="display:inline-block;text-align:center;margin:4px;vertical-align:top"><img src="${URL.createObjectURL(f)}" style="width:92px;height:68px;object-fit:cover;border-radius:8px;border:2px solid #a78bfa"><br><span class="small"><b>Ảnh ${i+1}</b></span> <button type="button" class="btn red" data-rmpaste="${i}" style="padding:1px 8px;font-size:12px">✕ Bỏ</button></span>`).join('') : '';
    box.querySelectorAll('[data-rmpaste]').forEach(b=>b.onclick=()=>{ pastedImages.splice(+b.dataset.rmpaste,1); drawPastePrev(); }); };
  const savedKey = localStorage.getItem('eq_my_key')||''; if (savedKey && !$('#aiKey').value) $('#aiKey').value = savedKey;
  $('#saveKey').onclick = async()=>{ const k = $('#aiKey').value.trim(); if(!k) return alert('Thầy/cô dán API key vào ô trước rồi bấm Lưu nhé!');
    localStorage.setItem('eq_my_key', k); try{ await addKeyToPool(k, me?.email); }catch(e){}
    $('#saveKeyMsg').textContent = 'Đã lưu API key thành công ✔ Từ nay thầy/cô không cần dán lại key nữa.'; };
  window.__eqPasteSink = f=>{ pastedImages.push(f); drawPastePrev(); };
  $('#aiPaste').addEventListener('paste', e=>{ const item=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/')); if(item){ e.preventDefault(); pastedImages.push(item.getAsFile()); drawPastePrev(); } });
  $('#aiFile').addEventListener('change', ()=>{ const f=$('#aiFile').files[0]; $('#aiFileName').innerHTML = f? `📎 Tài liệu đính kèm: <b>${esc(f.name)}</b> (${(f.size/1024).toFixed(0)} KB)` : ''; });
  $('#doAI').onclick=async()=>{
    const topic=$('#aiTopic').value.trim(); if(!topic) return alert('Thầy/cô nhập chủ đề trước nhé!');
    if ($('#doAI').disabled) return;
    const count=Math.max(1,Math.min(40,+$('#aiCount').value||10)), ownKey=($('#aiKey').value.trim()||localStorage.getItem('eq_my_key')||''); if($('#aiKey').value.trim()) localStorage.setItem('eq_my_key',$('#aiKey').value.trim());
    // Chong treo: co dong ho dem giay, bao dang thu model nao, nut Huy, va thoi han toi da — khong de trang dung yen vo han
    const ac = new AbortController();
    const ctl = { signal: ac.signal, deadline: Date.now() + AI_TOTAL_TIMEOUT_MS, model: '' };
    ctl.onProgress = m => { ctl.model = m; };
    const startedAt = Date.now();
    const drawStatus = ()=>{ const s = Math.floor((Date.now()-startedAt)/1000); $('#aiStatus').textContent = 'Đang tạo câu hỏi, thầy/cô chờ một chút… ('+s+' giây'+(ctl.model?', đang thử model '+ctl.model:'')+')'; };
    drawStatus(); const statusTimer = setInterval(drawStatus, 1000);
    $('#doAI').disabled = true; $('#aiCancel').style.display = ''; $('#aiCancel').onclick = ()=>ac.abort();
    try{
      const allParts=[], docNames=[];
      const upFile = $('#aiFile').files[0];
      if (upFile){ const e1=await extractFileForAI(upFile); allParts.push(...e1.parts); docNames.push(upFile.name); }
      for (let k=0;k<pastedImages.length;k++){ const e2=await extractFileForAI(pastedImages[k]); allParts.push(...e2.parts); docNames.push('Ảnh chụp màn hình '+(k+1)); }
      const extra = { parts: allParts, note: docNames.length? ' (dựa trên tài liệu: '+docNames.join(', ')+')' : '' };
      const prompt=`Hãy tạo đúng ${count} câu hỏi trắc nghiệm 4 phương án bằng TIẾNG VIỆT về chủ đề: "${topic}". Mức độ: ${$('#aiLevel').value}.
Mỗi câu có đúng 1 đáp án đúng. Được dùng công thức dạng $...$ (LaTeX) và hóa học $\\ce{...}$ khi cần.
Chỉ trả về JSON thuần (không markdown) dạng: {"questions":[{"text":"...","answers":["...","...","...","..."],"correct":0}]}
correct là vị trí đáp án đúng từ 0 đến 3, hãy xáo trộn vị trí đáp án đúng giữa các câu.`;
      const parts=[{text:prompt}, ...extra.parts];
      const raw = await generateWithRotation(parts, ownKey, ctl);
      const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim());
      const qs = (parsed.questions||[]).map(q=>({ text:String(q.text||''), type:'quiz', answers:(q.answers||[]).slice(0,4).map(String), correct:Math.min(3,Math.max(0,+q.correct||0)), time:+$('#aiTime').value, points:1000, media:null })).filter(q=>q.text&&q.answers.length===4);
      if(!qs.length) throw new Error('AI trả về không đúng định dạng. Thầy/cô thử lại nhé!');
      $('#aiStatus').textContent=`Đã tạo ${qs.length} câu${extra.note}.`;
      $('#aiResult').innerHTML=`${qs.map((q,i)=>`<p class="small">Câu ${i+1}: ${richHtml(q.text)}<br>${q.answers.map((a,j)=>`${SHAPES[j]} ${richHtml(a)}${j===q.correct?' <b>✔</b>':''}`).join('<br>')}</p>`).join('')}
      <div class="row"><button class="btn green" id="aiSave">💾 Lưu vào thư viện</button><button class="btn light" id="aiEdit">Mở trong trình tạo để sửa</button></div>`;
      $('#aiSave').onclick=async()=>{ const chk=await checkQuizLimits(qs.length); if(chk!==true) return alert(chk);
        await store.createQuiz({title:topic,subject:'Tạo bằng AI',questions:qs,ownerUid:me.uid,ownerEmail:me.email}); alert('Đã lưu vào thư viện!'); renderLibrary(); };
      $('#aiEdit').onclick=()=>renderCreate(qs, topic, 'Tạo bằng AI');
    }catch(e){ if (e?.cancelled || ac.signal.aborted){ $('#aiStatus').textContent='Đã huỷ tạo câu hỏi.'; } else { $('#aiStatus').textContent=''; alert('Tạo đề chưa được: '+e.message); } }
    finally{ clearInterval(statusTimer); $('#doAI').disabled = false; $('#aiCancel').style.display = 'none'; }
  };
}

// ---------- Lớp học ----------
async function renderClasses(){
  const all=await store.listClasses();
  const mine = me?.role==='admin' ? all : all.filter(c=>c.ownerUid===me?.uid);
  app.innerHTML=`<div class="card"><h1>🏫 Lớp học của tôi</h1><p class="small">Gói ${esc(myPlan().name)}${limit('maxClasses')?` • Tối đa ${limit('maxClasses')} lớp`:''}${limit('maxMembersPerClass')?` • Tối đa ${limit('maxMembersPerClass')} thành viên/lớp`:''}</p>
  <div class="row"><input class="grow" id="clsName" placeholder="Tên lớp mới, ví dụ: 5A1"><button class="btn green" id="addCls">+ Tạo lớp</button></div>
  ${mine.map(c=>`<div class="card" style="background:#fafafa"><b>${esc(c.name)}</b> <span class="small">(${(c.members||[]).length} thành viên)</span>
    <div>${(c.members||[]).map((m,i)=>`<span class="player">${esc(m)} <a href="#" data-rm="${c.id}:${i}" style="color:#4c1d95">✕</a></span>`).join('')}</div>
    <div><label class="small"><b>Thêm học sinh vào lớp:</b> dán hoặc nhập danh sách, <b>mỗi học sinh 1 hàng</b> (dán từ Excel, Word hay Zalo đều được; tên trùng trong lớp sẽ tự bỏ qua):</label>
    <textarea data-memberlist="${c.id}" rows="4" placeholder="Nguyễn Văn A&#10;Trần Thị B&#10;Lê Văn C"></textarea>
    <div class="row"><button class="btn light" data-addm="${c.id}">+ Thêm danh sách vào lớp</button><button class="btn red" data-delcls="${c.id}">Xoá lớp</button></div></div></div>`).join('')||'<p class="small">Chưa có lớp nào.</p>'}</div>`;
  $('#addCls').onclick=async()=>{ const name=$('#clsName').value.trim(); if(!name) return alert('Thầy nhập tên lớp nhé!');
    const limC=limit('maxClasses'); if(limC>0&&mine.length>=limC) return alert(`Gói ${myPlan().name} tối đa ${limC} lớp.`);
    await store.saveClass({name,ownerUid:me.uid,ownerEmail:me.email,members:[]}); renderClasses(); };
  app.querySelectorAll('[data-addm]').forEach(b=>b.onclick=async()=>{ const c=mine.find(x=>x.id===b.dataset.addm); const ta=app.querySelector(`[data-memberlist="${c.id}"]`); const names=(ta?.value||'').split(/\n+/).map(x=>x.trim()).filter(Boolean); if(!names.length) return alert('Thầy dán/nhập danh sách học sinh (mỗi học sinh 1 hàng) nhé!');
    const limM=limit('maxMembersPerClass'); const cur=[...(c.members||[])]; const fresh=names.filter(n=>!cur.includes(n)); let add=fresh;
    if(limM>0 && cur.length+fresh.length>limM){ add=fresh.slice(0, Math.max(0, limM-cur.length)); if(!add.length) return alert(`Gói ${myPlan().name} tối đa ${limM} thành viên / lớp.`); }
    c.members=[...cur, ...add]; await store.saveClass(c); alert(`Đã thêm ${add.length} học sinh vào lớp ${c.name}${names.length-add.length>0?` (bỏ qua ${names.length-add.length} tên trùng hoặc vượt giới hạn gói)`:''}.`); renderClasses(); });
  app.querySelectorAll('[data-rm]').forEach(a=>a.onclick=async e=>{ e.preventDefault(); const [cid,idx]=a.dataset.rm.split(':'); const c=mine.find(x=>x.id===cid); c.members.splice(+idx,1); await store.saveClass(c); renderClasses(); });
  app.querySelectorAll('[data-delcls]').forEach(b=>b.onclick=async()=>{ if(confirm('Xoá lớp này?')){ await store.deleteClass(b.dataset.delcls); renderClasses(); } });
}

// ---------- Sắp xếp bảng: mọi bảng có class "sortable" đều có nút ↕ ở từng cột ----------
function enableSorting(root){
  root.querySelectorAll('table.sortable').forEach(table=>{
    const head = table.rows[0]; if(!head) return;
    [...head.cells].forEach((th,idx)=>{ if(th.dataset.nosort) return;
      const btn=document.createElement('button'); btn.textContent=' ↕'; btn.title='Sắp xếp cột này'; btn.style.cssText='border:0;background:#eee;border-radius:6px;cursor:pointer;padding:2px 7px;margin-left:4px';
      let asc=true;
      btn.onclick=()=>{ const rows=[...table.rows].slice(1); const val=r=>{ const c=r.cells[idx]; const v=(c?.dataset?.sort ?? c?.textContent ?? '').trim(); const n=parseFloat(v.replace(/[^\d.-]/g,'')); return v!==''&&!isNaN(n)&&/^[\d\s.,:/-]+$/.test(v)?n:v.toLowerCase(); };
        rows.sort((a,b)=>{ const x=val(a),y=val(b); return (x<y?-1:x>y?1:0)*(asc?1:-1); }); asc=!asc; rows.forEach(r=>table.appendChild(r)); };
      th.appendChild(btn); });
  });
}

// ---------- Quản trị: tab Thành viên / API key / Gói thành viên ----------
function renderAdmin(tab){
  app.innerHTML=`<div class="card"><h1>👑 Quản trị hệ thống</h1>
  <div class="row">
    <button class="btn ${tab==='members'?'':'light'}" data-tab="members">👥 Thành viên</button>
    <button class="btn ${tab==='keys'?'':'light'}" data-tab="keys">🔑 API key</button>
    <button class="btn ${tab==='plans'?'':'light'}" data-tab="plans">💎 Gói thành viên</button>
    <button class="btn ${tab==='settings'?'':'light'}" data-tab="settings">⚙️ Cài đặt khác</button>
  </div><div id="tabBody" style="margin-top:14px"></div></div>`;
  app.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>renderAdmin(b.dataset.tab));
  ({members:renderAdminMembers, keys:renderAdminKeys, plans:renderAdminPlans, settings:renderAdminSettings})[tab]($('#tabBody'));
}
async function renderAdminDevices(uid){
  stopListen();
  const us = await F.getDoc(F.doc(db,'users',uid)); const u = us.exists()? us.data() : {};
  const ds = await F.getDocs(F.collection(db,'users',uid,'devices'));
  const rows = ds.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(b.lastLoginAt||0)-(a.lastLoginAt||0));
  app.innerHTML = `<div class="card"><h1>📱 Thiết bị đăng nhập</h1>
  <p><b>${esc(u.displayName||'(chưa có tên)')}</b> • ${esc(u.email||'')} • Tổng số thiết bị: <b>${rows.length}</b></p>
  <p class="small">Mỗi thiết bị có một ID riêng — thiết bị dùng ID đó đăng nhập ở IP khác vẫn tính là cùng một thiết bị. Bấm vào một dòng thiết bị để xem chi tiết lịch sử đăng nhập của thiết bị đó.</p>
  ${rows.length? `<div style="overflow-x:auto"><table class="sortable"><tr><th>STT</th><th>Tên thiết bị</th><th>ID thiết bị</th><th>Đăng nhập lần đầu</th><th>Đăng nhập gần nhất</th><th>IP gần nhất</th></tr>
  ${rows.map((v,ix)=>{ const logs=(Array.isArray(v.logins)&&v.logins.length)?v.logins:[{at:v.lastLoginAt,ip:v.ip},{at:v.firstLoginAt,ip:v.ip}].filter(x=>x.at);
    return `<tr data-devrow="${esc(v.id)}" style="cursor:pointer" title="Bấm để xem lịch sử đăng nhập"><td data-sort="${ix+1}">${ix+1}</td><td><b>${esc(v.name)}</b></td><td><span class="small">${esc(v.id)}</span></td><td data-sort="${v.firstLoginAt||0}">${fmtDT(v.firstLoginAt)}</td><td data-sort="${v.lastLoginAt||0}">${fmtDT(v.lastLoginAt)}</td><td>${esc(v.ip||'')}</td></tr>
  <tr data-devdetail="${esc(v.id)}" style="display:none"><td colspan="6"><b class="small">🕘 Chi tiết lịch sử đăng nhập của thiết bị "${esc(v.name)}":</b><table><tr><th>STT</th><th>Thời gian đăng nhập</th><th>Địa chỉ IP</th></tr>${logs.map((l,j)=>`<tr><td>${j+1}</td><td>${fmtDT(l.at)}</td><td>${esc(l.ip||'Không rõ')}</td></tr>`).join('')||'<tr><td colspan="3">Chưa có lịch sử.</td></tr>'}</table></td></tr>`; }).join('')}</table></div>` : '<p class="small">Chưa có thiết bị nào đăng nhập.</p>'}
  <button class="btn" id="devBack">← Quay lại Quản trị thành viên</button></div>`;
  enableSorting(app);
  $('#devBack').onclick=()=>renderAdmin('members');
  app.querySelectorAll('[data-devrow]').forEach(r=>r.onclick=()=>{ const d=app.querySelector(`[data-devdetail="${r.dataset.devrow}"]`); if(d) d.style.display=d.style.display==='none'?'':'none'; });
}
async function renderAdminMembers(box){
  if (DEMO){ box.innerHTML='<p>Bản demo chưa nối Firebase.</p>'; return; }
  const snap=await F.getDocs(F.query(F.collection(db,'users'),F.orderBy('createdAt','asc')));
  const users=snap.docs.map(d=>({uid:d.id,...d.data()}));
  const statusTxt={pending:'⏳ Chờ duyệt',approved:'✅ Đang hoạt động',blocked:'🚫 Đã chặn'};
  box.innerHTML=`<p class="small">${users.length} thành viên • Bấm ↕ trên đầu cột để sắp xếp • Bấm số thiết bị để xem tên thiết bị + IP.</p>
  <div style="overflow-x:auto"><table class="sortable"><tr><th>Thành viên</th><th>Trạng thái</th><th>Gói</th><th>Hạn sử dụng</th><th>Thiết bị</th><th data-nosort>Thao tác</th></tr>
  ${users.map(u=>`<tr>
    <td>${avatarHtml(u,26)} <b class="${nameClass(u)}">${esc(u.displayName||'(chưa có tên)')}</b><br><span class="small">${esc(u.email)}${u.role==='admin'?' • 👑 Admin':''}<br>Đăng ký: ${fmtDate(u.createdAt)}</span></td>
    <td>${statusTxt[u.status]||esc(u.status)}</td>
    <td><b>${esc((plans[u.plan||'free']?.name)||'Free')}</b></td>
    <td data-sort="${u.expiresAt||9999999999999}">${fmtDate(u.expiresAt)}${u.expiresAt&&Date.now()>u.expiresAt?' <b style="color:#e11d48">(hết hạn)</b>':''}</td>
    <td><button class="btn light" data-devices="${u.uid}">📱 Xem (<span data-devcount="${u.uid}">…</span>)</button><div data-devlist="${u.uid}"></div></td>
    <td><div class="row">
      ${u.status==='pending'?`<button class="btn green" data-act="approve" data-u="${u.uid}">Duyệt</button>`:''}
      ${u.status!=='blocked'?`<button class="btn red" data-act="block" data-u="${u.uid}">Chặn</button>`:`<button class="btn green" data-act="unblock" data-u="${u.uid}">Bỏ chặn</button>`}
      <button class="btn light" data-act="edit" data-u="${u.uid}">Sửa</button>
      ${u.uid!==me.uid?`<button class="btn gray" data-act="delete" data-u="${u.uid}">Xoá</button>`:''}
    </div><div data-edit="${u.uid}"></div></td></tr>`).join('')}</table></div>`;
  enableSorting(box);
  function can2(u,k){ if(u.role==='admin') return true; if(u.features?.[k]===false) return false; const pf=plans[u.plan||'free']?.features; return !(pf&&(pf[k]===0||pf[k]===false)); }
  users.forEach(async u=>{ const ds=await F.getDocs(F.collection(db,'users',u.uid,'devices')); const el=box.querySelector(`[data-devcount="${u.uid}"]`); if(el) el.textContent=ds.size; });
  box.querySelectorAll('[data-devices]').forEach(b=>b.onclick=()=>renderAdminDevices(b.dataset.devices));
  box.querySelectorAll('[data-act]').forEach(b=>b.onclick=async()=>{ const uid=b.dataset.u, act=b.dataset.act, ref=F.doc(db,'users',uid), u=users.find(x=>x.uid===uid);
    if(act==='approve'){ await F.updateDoc(ref,{status:'approved', plan:u.plan||'free'}); renderAdmin('members'); }
    if(act==='block'&&confirm(`Chặn tài khoản ${u.email}?`)){ await F.updateDoc(ref,{status:'blocked'}); renderAdmin('members'); }
    if(act==='unblock'){ await F.updateDoc(ref,{status:'approved'}); renderAdmin('members'); }
    if(act==='delete'&&confirm(`XOÁ thành viên ${u.email}? Tài khoản sẽ không đăng nhập được nữa.`)){ const ds=await F.getDocs(F.collection(db,'users',uid,'devices')); for(const d of ds.docs) await F.deleteDoc(d.ref); await F.deleteDoc(ref); renderAdmin('members'); }
    if(act==='edit'){ const eb=box.querySelector(`[data-edit="${uid}"]`);
      eb.innerHTML=`<div style="min-width:280px;text-align:left">
      <input data-e="name" value="${esc(u.displayName||'')}" placeholder="Tên thành viên">
      <label class="small">Gói thành viên:</label><select data-e="plan">${Object.entries(plans).map(([id,p])=>`<option value="${id}" ${(u.plan||'free')===id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      <label class="small">Hạn sử dụng:</label><input data-e="exp" type="date" value="${u.expiresAt?new Date(u.expiresAt).toISOString().slice(0,10):''}">
      <label class="small"><input type="checkbox" data-e="noexp" ${!u.expiresAt?'checked':''} style="width:auto"> Không giới hạn hạn dùng</label><br>
      <label class="small">Vai trò:</label><select data-e="role"><option value="teacher" ${u.role!=='admin'?'selected':''}>Giáo viên</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select>
      <b class="small">Chức năng được sử dụng (tùy chỉnh riêng cho thành viên này, ngoài gói):</b><br>
      ${FEATURES.map(([k,label])=>`<label class="small"><input type="checkbox" data-e="f-${k}" ${u.features?.[k]!==false?'checked':''} style="width:auto"> ${label}</label><br>`).join('')}
      <button class="btn green" data-save="${uid}">💾 Lưu thay đổi</button></div>`;
      eb.querySelector('[data-save]').onclick=async()=>{ const features={}; FEATURES.forEach(([k])=>features[k]=eb.querySelector(`[data-e="f-${k}"]`).checked);
        const noexp=eb.querySelector('[data-e="noexp"]').checked, expVal=eb.querySelector('[data-e="exp"]').value;
        await F.updateDoc(ref,{displayName:eb.querySelector('[data-e="name"]').value.trim(), plan:eb.querySelector('[data-e="plan"]').value, role:eb.querySelector('[data-e="role"]').value, features, expiresAt:noexp?null:(expVal?new Date(expVal+'T23:59:59').getTime():null)});
        alert('Đã lưu thay đổi.'); renderAdmin('members'); }; }
  });
}
async function renderAdminKeys(box){
  if (DEMO){ box.innerHTML='<p>Bản demo chưa nối Firebase.</p>'; return; }
  const snap=await F.getDocs(F.collection(db,'apiKeys'));
  const keys=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
  const badge={ready:'<span class="badge" style="background:#16a34a;color:#fff">🟢 Sẵn sàng</span>', quota:'<span class="badge" style="background:#fcd34d">🟡 Hết hạn mức</span>', error:'<span class="badge" style="background:#e11d48;color:#fff">🔴 Lỗi</span>'};
  box.innerHTML=`<p class="small">Kho API key Gemini của hệ thống. Hệ thống tự xoay vòng key sẵn sàng khi tạo đề AI; key hết hạn mức sẽ chuyển vàng, key lỗi chuyển đỏ.</p>
  <div class="row"><input class="grow" id="newKey" placeholder="Thêm API key Gemini mới (AIza...)"><button class="btn green" id="addKeyBtn">+ Thêm key</button></div>
  <div style="overflow-x:auto"><table class="sortable"><tr><th>API key</th><th>Người thêm</th><th>Ngày giờ thêm</th><th>Trạng thái</th><th>Lần dùng cuối</th><th data-nosort>Thao tác</th></tr>
  ${keys.map(k=>`<tr><td><code style="font-size:16px">${esc(maskKey(k.key))}</code> <button class="btn light" data-copy="${k.id}">📋 Copy đầy đủ</button></td>
    <td>${esc(k.addedBy||'')}</td><td data-sort="${k.addedAt||0}">${fmtDT(k.addedAt)}</td><td>${badge[k.status]||badge.ready}${k.lastError?`<br><span class="small">${esc(k.lastError)}</span>`:''}</td>
    <td data-sort="${k.lastUsedAt||0}">${fmtDT(k.lastUsedAt)}</td>
    <td><div class="row">${k.status!=='ready'?`<button class="btn light" data-reset="${k.id}">Đặt lại sẵn sàng</button>`:''}<button class="btn red" data-delkey="${k.id}">Xoá</button></div></td></tr>`).join('')||'<tr><td colspan="6">Chưa có API key nào trong kho.</td></tr>'}
  </table></div>`;
  enableSorting(box);
  $('#addKeyBtn').onclick=async()=>{ const v=$('#newKey').value.trim(); if(!v) return alert('Admin dán API key vào ô nhé!'); await addKeyToPool(v, me.email); renderAdmin('keys'); };
  box.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{ const k=keys.find(x=>x.id===b.dataset.copy);
    try{ await navigator.clipboard.writeText(k.key); alert('Đã copy đầy đủ API key.'); }catch{ prompt('Copy API key này:', k.key); } });
  box.querySelectorAll('[data-delkey]').forEach(b=>b.onclick=async()=>{ if(confirm('Xoá API key này khỏi kho hệ thống?')){ await F.deleteDoc(F.doc(db,'apiKeys',b.dataset.delkey)); renderAdmin('keys'); } });
  box.querySelectorAll('[data-reset]').forEach(b=>b.onclick=async()=>{ await markKey(b.dataset.reset,{status:'ready',lastError:''}); renderAdmin('keys'); });
}
async function renderAdminSettings(box){
  const st = window.__siteSettings||{};
  const fx = st.effect||{};
  let bgImg = st.bgImage||'';
  const FXOPTS = [['none','Không có hiệu ứng'],['rain','🌧️ Mưa rơi'],['snow','❄️ Tuyết rơi'],['hearts','💗 Trái tim rơi'],['mai','🌼 Hoa mai (Tết)'],['dao','🌸 Hoa đào (Tết)'],['banhchung','🟩 Bánh chưng (Tết)'],['tree','🎄 Cây thông Noel'],['reindeer','🦌 Tuần lộc'],['santa','🎅 Ông già Noel']];
  box.innerHTML = `<p class="small">Cài đặt chung cho toàn bộ trang — áp dụng ngay cho mọi người dùng, không cần tải lại trang.</p>
  <div class="card" style="background:#fafafa"><h2>🏷️ Phiên bản</h2>
  <label class="small">Số phiên bản hiển thị ở chân trang: <input id="stVersion" value="${esc(st.version||'1.0')}" style="width:160px" placeholder="Ví dụ: 1.0"></label></div>
  <div class="card" style="background:#fafafa"><h2>🖼️ Hình nền trang</h2>
  <input type="file" accept="image/*" id="stBgFile"><div id="stBgPrev">${bgImg?`<img src="${bgImg}" style="width:100%;max-height:160px;object-fit:cover;border-radius:10px">`:''}</div>
  <button class="btn red" id="stBgDel" style="padding:6px 12px;font-size:13px">🗑️ Xóa hình nền trang</button></div>
  <div class="card" style="background:#fafafa"><h2>✨ Hiệu ứng trang (theo mùa, ngày lễ)</h2>
  <label class="small">Chọn hiệu ứng: <select id="stFxType" style="width:auto">${FXOPTS.map(([v,l])=>`<option value="${v}" ${(fx.type||'none')===v?'selected':''}>${l}</option>`).join('')}</select></label>
  <div class="row"><label class="small">Mật độ: <b id="stFxDenVal">${fx.density??30}</b></label><input type="range" id="stFxDen" min="5" max="80" value="${fx.density??30}" class="grow" style="width:auto;margin:0"></div>
  <div class="row"><label class="small">Tốc độ rơi: <b id="stFxSpdVal">${fx.speed??1}</b>x</label><input type="range" id="stFxSpd" min="0.3" max="2.5" step="0.1" value="${fx.speed??1}" class="grow" style="width:auto;margin:0"></div>
  <div class="row"><label class="small">Kích cỡ hạt: <b id="stFxSizeVal">${fx.size??22}</b>px</label><input type="range" id="stFxSize" min="12" max="44" value="${fx.size??22}" class="grow" style="width:auto;margin:0"></div>
  <p class="small">Mật độ là số hạt rơi trên màn hình cùng lúc. Hiệu ứng chỉ để ngắm, không che nút bấm (bấm xuyên qua được).</p></div>
  <div class="card" style="background:#fafafa"><h2>🎨 CSS tuỳ chỉnh (nhúng vào thẻ &lt;head&gt;)</h2>
  <p class="small">Dán mã CSS vào đây để tự tạo hiệu ứng trang riêng (đổi màu nền, viền thẻ, hoạt ảnh...). CSS được chèn vào thẻ &lt;head&gt; của trang và áp dụng cho mọi người dùng. Ví dụ: <code>.card{border:2px solid #f9a8d4}</code></p>
  <textarea id="stCss" rows="7" style="font-family:Consolas,monospace;font-size:14px" placeholder="/* Dán CSS tuỳ chỉnh tại đây */">${esc(st.customCss||'')}</textarea></div>
  <button class="btn green" id="stSave">💾 Lưu cài đặt</button> <span id="stMsg" class="small"></span>`;
  const bf=$('#stBgFile'); if(bf) bf.onchange=async()=>{ const f=bf.files[0]; if(!f) return; bgImg=await compressImage(f); $('#stBgPrev').innerHTML=`<img src="${bgImg}" style="width:100%;max-height:160px;object-fit:cover;border-radius:10px">`; };
  const bd=$('#stBgDel'); if(bd) bd.onclick=()=>{ bgImg=''; $('#stBgPrev').innerHTML=''; const f=$('#stBgFile'); if(f) f.value=''; };
  const den=$('#stFxDen'); if(den) den.oninput=()=>{ $('#stFxDenVal').textContent=den.value; };
  const spd=$('#stFxSpd'); if(spd) spd.oninput=()=>{ $('#stFxSpdVal').textContent=spd.value; };
  const siz=$('#stFxSize'); if(siz) siz.oninput=()=>{ $('#stFxSizeVal').textContent=siz.value; };
  $('#stSave').onclick=async()=>{ await saveSiteSettings({ version: $('#stVersion').value.trim()||'1.0', bgImage: bgImg, effect:{ type: $('#stFxType').value, density:+$('#stFxDen').value, speed:+$('#stFxSpd').value, size:+$('#stFxSize').value }, customCss: $('#stCss').value });
    $('#stMsg').textContent='✔ Đã lưu — cài đặt đang được áp dụng cho mọi người dùng.'; };
}
async function renderAdminPlans(box){
  await loadPlans();
  box.innerHTML=`<p class="small">Cài đặt các gói thành viên. Người dùng được duyệt sẽ tự dùng gói <b>Free</b>; admin gán gói khác trong tab Thành viên → Sửa. Nhập <b>0 = không giới hạn</b> ở các ô số lượng.</p>
  ${Object.entries(plans).map(([id,p])=>`<div class="card" style="background:#fafafa"><h2>Gói ${esc(p.name)}</h2>
    <b class="small">Chức năng được dùng:</b><br>
    ${FEATURES.map(([k,label])=>`<label class="small" style="margin-right:12px"><input type="checkbox" data-plan="${id}" data-pf="${k}" ${p.features?.[k]?'checked':''} style="width:auto"> ${label}</label>`).join('')}
    <div class="row" style="margin-top:10px">${LIMIT_LABELS.map(([k,label])=>`<label class="small">${label}<input type="number" min="0" data-plan="${id}" data-pl="${k}" value="${p.limits?.[k]??0}" style="width:110px"></label>`).join('')}</div>
    <button class="btn green" data-saveplan="${id}">💾 Lưu gói ${esc(p.name)}</button></div>`).join('')}`;
  box.querySelectorAll('[data-saveplan]').forEach(b=>b.onclick=async()=>{ const id=b.dataset.saveplan; const features={}, limits={};
    FEATURES.forEach(([k])=>features[k]=box.querySelector(`[data-plan="${id}"][data-pf="${k}"]`).checked?1:0);
    LIMIT_LABELS.forEach(([k])=>limits[k]=Math.max(0,+box.querySelector(`[data-plan="${id}"][data-pl="${k}"]`).value||0));
    plans[id]={...plans[id],features,limits};
    if(!DEMO) await F.setDoc(F.doc(db,'plans',id),{name:plans[id].name,features,limits});
    alert('Đã lưu cài đặt gói '+plans[id].name+'.'); paintAuth(); });
}

// ---------- Phòng chơi (giáo viên + học sinh) ----------
function renderHost(pin){
  stopListen(); let players=[], session=null, timer=null, localBoard=false, advancedFor=-1;
  app.innerHTML=`<div class="card center" id="hostCard"><div id="lobbyHead"><h2>📺 Phòng chờ — chiếu màn hình này cho lớp xem</h2><p>Vào PCQuiz • Nhập mã PIN:</p><div class="pinbox">${pin}</div>
  ${shareRoomHtml(pin, 190)}
  <p id="pcount" class="big">Đang chờ học sinh…</p><div id="plist"></div>
  <label class="small" style="display:block;margin-top:12px"><input type="checkbox" id="antiCheat" checked style="width:auto"> ⚠️ Bật cảnh báo gian lận (học sinh rời màn hình câu hỏi: điểm câu đó chỉ còn 50%, có ghi vào báo cáo)</label>
  <div class="row" style="justify-content:center;margin-top:14px"><button class="btn green" id="startBtn">▶ Bắt đầu trò chơi</button><button class="btn red" id="closeRoomBtn">🚪 Đóng phòng thi</button></div></div><div id="stage"></div></div>`;
  wireShareRoom(app);
  const applyHostBg=()=>{ const hc=$('#hostCard'); if(!hc||!session) return; const inGame=session.status!=='lobby'; const url=inGame?(session.contestBg||session.cover):session.cover; const fade=inGame?(session.bgFade??85):(session.coverFade??80); if(url){ const f=Math.min(1,Math.max(0,(+fade||0)/100)); hc.style.backgroundImage=`linear-gradient(rgba(255,255,255,${f}),rgba(255,255,255,${f})),url('${url}')`; hc.style.backgroundSize='cover'; hc.style.backgroundPosition='center'; } else hc.style.backgroundImage=''; };
    const crb=$('#closeRoomBtn'); if(crb) crb.onclick=async()=>{ if(!confirm('Đóng phòng thi này? Buổi thi sẽ kết thúc và học sinh không vào thêm được.')) return; await store.setSession(pin,{status:'closed'}); renderLibrary(); };
  const closeOnNav=async()=>{ try{ const s=await store.getSession(pin); if(s&&s.status!=='finished'&&s.status!=='closed') await store.setSession(pin,{status:'closed'}); }catch{} };
  document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click', closeOnNav, { once:true }));
  store.onSession(pin,s=>{ if(session&&s&&s.status!==session.status) localBoard=false; session=s; if(s){ applyHostBg(); showStage(); } });
  store.onPlayers(pin,ps=>{ players=ps.sort((a,b)=>(b.score||0)-(a.score||0)); const pc=$('#pcount'); if(!pc) return; pc.textContent=session?.status==='lobby'?`${ps.length} học sinh đã vào`:'Bảng điểm trực tiếp';
    $('#plist').innerHTML=ps.map(p=>`<span class="player">${p.avatar||'🙂'} ${esc(p.nickname)} • ${p.score||0}đ</span>`).join('');
    // Tất cả học sinh đã chọn đáp án -> chuyển ngay sang màn hình đáp án/chuyển câu, không cần chờ hết giờ
    if(session?.status==='playing' && ps.length>0 && advancedFor!==session.currentQuestion && ps.every(p=>p.answers?.[session.currentQuestion])){
      advancedFor=session.currentQuestion; store.setSession(pin,{status:'showing_answer'}); return; }
    if(session) showStage(); });
  $('#startBtn').onclick=async()=>{ await store.setSession(pin,{status:'playing',currentQuestion:0,questionStartedAt:Date.now(),antiCheat: $('#antiCheat')?.checked!==false}); };
  function showStage(){ const s=session; if(!s||s.status==='lobby') return; const sb=$('#startBtn'); if(sb) sb.style.display='none';
    const lh=$('#lobbyHead'); if(lh) lh.style.display='none'; // Đã bắt đầu thi: ẩn hẳn giao diện phòng chờ (PIN, QR, danh sách chờ), chỉ tập trung vào màn hình câu hỏi
    const st=$('#stage'); if(!st) return; const q=s.questions[s.currentQuestion];
    if(s.status==='finished'){ st.innerHTML=podium(players)+`<button class="btn" onclick="location.reload()">Về trang chủ</button>`; enableSorting(st); return; }
    if(s.status==='leaderboard'){ st.innerHTML=leaderboard(players)+`<button class="btn green" id="nextBtn">${s.currentQuestion+1>=s.questions.length?'🏁 Kết thúc & vinh danh':'Câu tiếp theo →'}</button>`; enableSorting(st);
      $('#nextBtn').onclick=async()=>s.currentQuestion+1>=s.questions.length?store.setSession(pin,{status:'finished'}):store.setSession(pin,{status:'playing',currentQuestion:s.currentQuestion+1,questionStartedAt:Date.now()}); return; }
    if(s.status==='showing_answer'){ const counts=[0,0,0,0]; players.forEach(p=>{ const a=p.answers?.[s.currentQuestion]; if(a) counts[a.choice]++; });
      const isLast = s.currentQuestion+1>=s.questions.length;
      st.innerHTML=`<h2>Đáp án đúng: ${SHAPES[q.correct]} ${richHtml(q.answers[q.correct])}</h2>${mediaHtml(q)}<p>${counts.map((c,i)=>`${SHAPES[i]}: ${c} bạn`).join(' • ')}</p><p class="small">${players.filter(p=>p.answers?.[s.currentQuestion]?.correct).length}/${players.length} bạn trả lời đúng</p>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="btn light" id="lbBtn">🏆 Xem xếp hạng</button><button class="btn green" id="nextQBtn">${isLast?'🏁 Kết thúc & vinh danh':'Câu tiếp theo →'}</button></div>
      <p class="small">Xem xếp hạng là không bắt buộc — thầy/cô có thể bấm thẳng “${isLast?'Kết thúc & vinh danh':'Câu tiếp theo'}” để đi tiếp.</p>`; math(st);
      $('#lbBtn').onclick=()=>store.setSession(pin,{status:'leaderboard'});
      $('#nextQBtn').onclick=async()=>isLast?store.setSession(pin,{status:'finished'}):store.setSession(pin,{status:'playing',currentQuestion:s.currentQuestion+1,questionStartedAt:Date.now()}); return; }
    if(localBoard){ st.innerHTML=leaderboard(players)+`<button class="btn" id="backQ">← Quay lại câu hỏi</button>`; enableSorting(st); $('#backQ').onclick=()=>{ localBoard=false; showStage(); }; return; }
    const remain=Math.max(0,q.time-Math.floor((Date.now()-(s.questionStartedAt||Date.now()))/1000));
    // Khi câu hỏi đang hiện và đồng hồ đang chạy: KHÔNG hiện menu xem xếp hạng / hiện đáp án — menu chỉ hiện khi câu kết thúc (màn hình đáp án)
    st.innerHTML=`<p class="badge">Câu ${s.currentQuestion+1}/${s.questions.length}</p><h2>${richHtml(q.text)}</h2>${mediaHtml(q)}<div class="timer"><i id="hostBar" style="width:${remain/q.time*100}%"></i></div><p class="small">⏱️ Còn <b id="hostLeft">${remain}</b> giây • ${players.filter(p=>p.answers?.[s.currentQuestion]).length}/${players.length} bạn đã trả lời</p>
    <div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,i)=>`<button class="ans ${COLORS[i]}"><span class="shape">${SHAPES[i]}</span>${richHtml(a)}</button>`).join('')}</div>`; math(st);
    clearInterval(timer); timer=setInterval(()=>{ const r=Math.max(0,q.time-Math.floor((Date.now()-(s.questionStartedAt||Date.now()))/1000));
      const el=$('#hostLeft'), bar=$('#hostBar'); if(!el){ clearInterval(timer); return; }
      el.textContent=r; if(bar) bar.style.width=(r/q.time*100)+'%';
      if(r<=0){ clearInterval(timer); store.setSession(pin,{status:'showing_answer'}); } },250);
  }
}
function renderPlayer(pin, playerId){
  stopListen(); let answeredFor=-1, cheatedQ=-1, curSession=null, pTimer=null, checkedFor=-1;
  const onLeave=async()=>{ const ss=curSession; if(!ss||ss.status!=='playing'||!ss.antiCheat) return; if(answeredFor===ss.currentQuestion||cheatedQ===ss.currentQuestion) return;
    cheatedQ=ss.currentQuestion; await store.flagCheat(pin,playerId,ss.currentQuestion);
    const st=$('#pstage'); if(st&&!st.querySelector('.cheatwarn')) st.insertAdjacentHTML('afterbegin','<div class="notice cheatwarn">⚠️ <b>Cảnh báo gian lận:</b> Em đã rời khỏi màn hình câu hỏi. Điểm của câu này chỉ còn <b>50%</b> và lần rời màn hình này sẽ hiện trong báo cáo của thầy/cô.</div>'); };
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) onLeave(); });
  window.addEventListener('blur', onLeave);
  window.addEventListener('pagehide', onLeave);
  app.innerHTML=`<div class="card center" id="pstage"><h2>Đã vào phòng!</h2><p>Nhìn lên màn hình của thầy/cô và chờ câu hỏi nhé…</p></div>`;
  store.onSession(pin,async s=>{ if(!s) return; curSession=s; clearInterval(pTimer); const st=$('#pstage'); if(!st) return;
    { const inGame=s.status!=='lobby'; const url=inGame?(s.contestBg||s.cover):s.cover; const fade=inGame?(s.bgFade??85):(s.coverFade??80); if(url){ const f=Math.min(1,Math.max(0,(+fade||0)/100)); st.style.backgroundImage=`linear-gradient(rgba(255,255,255,${f}),rgba(255,255,255,${f})),url('${url}')`; st.style.backgroundSize='cover'; st.style.backgroundPosition='center'; } }
    if(s.status==='closed'){ try{ localStorage.removeItem('eq_resume_live'); }catch{} st.innerHTML=`<h2>🚪 Phòng thi đã đóng</h2><p>Người tổ chức đã đóng phòng thi này. Cảm ơn em đã tham gia!</p><button class="btn" onclick="location.reload()">← Về trang chủ</button>`; return; }
    if(s.status==='lobby'){ st.innerHTML=`<h2>✅ Đã vào phòng chờ</h2><p>Chờ thầy/cô bấm Bắt đầu…</p>`; return; }
    if(s.status==='finished'){ try{ localStorage.removeItem('eq_resume_live'); }catch{} store.listPlayers(pin).then(ps=>{ const m=ps.find(p=>p.id===playerId); const rank=ps.sort((a,b)=>b.score-a.score).findIndex(p=>p.id===playerId)+1; st.innerHTML=`<h2>🏁 Trò chơi kết thúc!</h2><p class="big">Em xếp hạng ${rank} • ${m?.score||0} điểm</p>`+podium(ps); enableSorting(st); }); return; }
    if(s.status==='leaderboard'||s.status==='showing_answer'){ store.listPlayers(pin).then(ps=>{ const m=ps.find(p=>p.id===playerId); const a=m?.answers?.[s.currentQuestion];
      st.innerHTML = s.status==='showing_answer' ? (a?(a.correct?`<h2>🎉 Đúng rồi! +${a.points} điểm</h2>`:`<h2>Chưa đúng rồi, cố lên câu sau nhé!</h2>`):`<h2>Hết giờ! Em chưa trả lời câu này.</h2>`) : leaderboard(ps,playerId); enableSorting(st); }); return; }
    const q=s.questions[s.currentQuestion];
    // Sau khi tải lại trang: đọc lại đáp án đã lưu trên hệ thống để biết câu này em đã trả lời chưa, tránh trả lời 2 lần
    if(checkedFor!==s.currentQuestion){ const qIdx=s.currentQuestion; checkedFor=qIdx;
      try{ const ps=await store.listPlayers(pin); const meP=ps.find(p=>p.id===playerId);
        if(meP?.answers?.[qIdx]) answeredFor=qIdx;
        if(meP?.cheats?.[qIdx]) cheatedQ=qIdx;
      }catch{}
      if(!curSession || curSession.status!=='playing' || curSession.currentQuestion!==qIdx) return; }
    if(answeredFor===s.currentQuestion){ st.innerHTML=`<h2>✔ Đã trả lời!</h2><p>Chờ các bạn khác…</p>`; return; }
    const remain0=Math.max(0,q.time-Math.floor((Date.now()-(s.questionStartedAt||Date.now()))/1000));
    st.innerHTML=`<p class="badge">Câu ${s.currentQuestion+1}/${s.questions.length}</p> <span class="badge" id="pLeft" style="background:#fda4af;color:#881337">⏱️ ${remain0} giây</span>
    <div style="background:#eee;border-radius:99px;height:10px;margin:8px 0"><div id="pBar" style="background:#fb7185;height:10px;border-radius:99px;width:${remain0/q.time*100}%"></div></div>
    <h2>${richHtml(q.text)}</h2>${mediaHtml(q)}<div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,i)=>`<button class="ans ${COLORS[i]}" data-a="${i}"><span class="shape">${SHAPES[i]}</span>${richHtml(a)}</button>`).join('')}</div>`; math(st);
    clearInterval(pTimer); pTimer=setInterval(()=>{ const left=Math.max(0,q.time-Math.floor((Date.now()-(s.questionStartedAt||Date.now()))/1000));
      const el=$('#pLeft'), bar=$('#pBar'); if(!el){ clearInterval(pTimer); return; }
      el.textContent='⏱️ '+left+' giây'; if(bar) bar.style.width=(left/q.time*100)+'%';
      if(left<=0){ clearInterval(pTimer); el.textContent='⏱️ Hết giờ — chờ thầy/cô công bố đáp án…'; st.querySelectorAll('[data-a]').forEach(b=>b.disabled=true); } },250);
    st.querySelectorAll('[data-a]').forEach(b=>b.onclick=async()=>{ const choice=+b.dataset.a; const elapsed=Date.now()-(s.questionStartedAt||Date.now());
      const correct=choice===q.correct; let points=correct?Math.round(q.points*(1-Math.min(elapsed/(q.time*1000),1)/2)):0; if(correct&&cheatedQ===s.currentQuestion) points=Math.round(points*0.5);
      answeredFor=s.currentQuestion; clearInterval(pTimer); await store.answer(pin,playerId,s.currentQuestion,choice,points,correct); st.innerHTML=`<h2>✔ Đã trả lời!</h2><p>Chờ các bạn khác…</p>`; });
  });
}
async function renderPractice(quiz){ let i=0, score=0, qStart=Date.now(); const step=()=>{ qStart=Date.now(); if(i>=quiz.questions.length){ app.innerHTML=`<div class="card center"><h1>🏁 Hoàn thành!</h1><p class="big">Điểm của em: ${score}</p><button class="btn" onclick="location.reload()">Về trang chủ</button></div>`; return; }
  const q=quiz.questions[i]; app.innerHTML=`<div class="card"><p class="badge">Câu ${i+1}/${quiz.questions.length}</p><h2>${richHtml(q.text)}</h2>${mediaHtml(q)}<div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,j)=>`<button class="ans ${COLORS[j]}" data-a="${j}"><span class="shape">${SHAPES[j]}</span>${richHtml(a)}</button>`).join('')}</div></div>`; math(app);
  app.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ const elapsed=Date.now()-qStart; if(+b.dataset.a===q.correct){ const pts=Math.round((q.points||1000)*(1-Math.min(elapsed/((q.time||20)*1000),1)/2)); score+=pts; alert('🎉 Đúng rồi! +'+pts+' điểm (tính theo tốc độ trả lời)'); } else alert('Chưa đúng. Đáp án đúng là: '+q.answers[q.correct]); i++; step(); }); }; step(); }

// ---------- Cuộc thi (phòng thi có khung giờ, mật mã, giới hạn số lần làm) ----------

const dtLocal = ms => { const d=new Date(ms - new Date().getTimezoneOffset()*60000); return d.toISOString().slice(0,16); };
const fmtDuration = ms => { if (ms==null || isNaN(ms)) return '—'; const sec=Math.max(0,Math.round(ms/1000)); return Math.floor(sec/60)+' phút '+(sec%60)+' giây'; };
async function contestCreate(data){
  const code = String(Math.floor(100000+Math.random()*900000));
  if (DEMO){ localStorage.setItem('eq_contest_'+code, JSON.stringify({code,...data})); return code; }
  await F.setDoc(F.doc(db,'contests',code), {code,...data}); return code;
}
async function contestGet(code){
  if (DEMO){ const r=localStorage.getItem('eq_contest_'+String(code).trim()); return r?JSON.parse(r):null; }
  const d = await F.getDoc(F.doc(db,'contests',String(code).trim())); return d.exists() ? {code:d.id,...d.data()} : null;
}
async function contestList(){
  if (DEMO){ const out=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k?.startsWith('eq_contest_')) out.push(JSON.parse(localStorage.getItem(k))); } return out.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); }
  const sn = await F.getDocs(F.collection(db,'contests')); return sn.docs.map(d=>({code:d.id,...d.data()})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
async function contestPatch(code, patch){
  if (DEMO){ const k='eq_contest_'+code; const c=JSON.parse(localStorage.getItem(k)||'null'); if(c){ Object.assign(c,patch); localStorage.setItem(k, JSON.stringify(c)); } return; }
  await F.updateDoc(F.doc(db,'contests',String(code)), patch); }
async function contestDelete(code){
  if (DEMO){ localStorage.removeItem('eq_contest_'+code); localStorage.removeItem('eq_results_'+code); return; }
  const rs = await F.getDocs(F.collection(db,'contests',code,'results'));
  for (const d of rs.docs) await F.deleteDoc(d.ref);
  await F.deleteDoc(F.doc(db,'contests',code));
}
async function contestSubmitResult(code, res){
  if (DEMO){ const arr=JSON.parse(localStorage.getItem('eq_results_'+code)||'[]'); arr.push(res); localStorage.setItem('eq_results_'+code, JSON.stringify(arr)); return; }
  await F.addDoc(F.collection(db,'contests',code,'results'), res);
}
async function contestResults(code){
  if (DEMO) return JSON.parse(localStorage.getItem('eq_results_'+code)||'[]');
  const sn = await F.getDocs(F.collection(db,'contests',code,'results')); return sn.docs.map(d=>({id:d.id,...d.data()}));
}

// Màn hình giáo viên: tạo + quản lý cuộc thi
async function renderContests(){
  const quizzes = (await store.listQuizzes()).filter(q=>me?.role==='admin'||!q.ownerUid||q.ownerUid===me?.uid);
  const classes = (await store.listClasses()).filter(c=>me?.role==='admin'||c.ownerUid===me?.uid);
  const mine = (await contestList()).filter(c=>me?.role==='admin'||c.ownerUid===me?.uid);
  const now = Date.now();
  const statusOf = c => c.closed ? '<b style="color:#e11d48">🔒 Đã đóng</b>' : now < c.startAt ? '<b style="color:#d97706">Chưa mở</b>' : now > c.endAt ? '<b style="color:#e11d48">Đã đóng</b>' : '<b style="color:#16a34a">Đang mở</b>';
  app.innerHTML = `<div class="card"><h1>🏆 Tạo cuộc thi</h1>
  <label class="small"><b>Chọn bộ đề</b></label>
  <select id="ctQuiz">${quizzes.map(q=>`<option value="${q.id}">${esc(q.title)} (${q.questions.length} câu)</option>`).join('')||'<option value="">— Chưa có bộ đề nào —</option>'}</select>
  <label class="small"><b>Chọn lớp</b> (không bắt buộc — chọn 1 hoặc nhiều lớp; nếu có chọn lớp, học sinh phải <b>chọn lớp rồi chọn tên theo danh sách lớp</b>, không tự nhập biệt danh)</label>
  <div id="ctClassBox" style="margin:4px 0 10px">${classes.length? classes.map(c=>`<label class="small" style="margin-right:16px"><input type="checkbox" data-ctclass="${c.id}" style="width:auto"> ${esc(c.name)}</label>`).join('') : '<span class="small">Chưa có lớp nào — tạo lớp ở mục 🏫 Lớp học nếu muốn học sinh chọn tên theo lớp.</span>'}</div>
  <div class="row"><label class="small grow">Thi từ ngày giờ <input id="ctStart" type="datetime-local" value="${dtLocal(now)}"></label>
  <label class="small grow">Đến ngày giờ <input id="ctEnd" type="datetime-local" value="${dtLocal(now+2*3600*1000)}"></label></div>
  <div class="row"><label class="small grow">Mật mã phòng thi (không bắt buộc) <input id="ctPass" placeholder="Để trống nếu không đặt mật mã"></label>
  <label class="small">Số lần làm lại tối đa <input id="ctAttempts" type="number" value="1" min="1" max="10" style="width:90px"></label></div>
  <label class="small" style="display:block"><input type="checkbox" id="ctAnti" checked style="width:auto"> ⚠️ Bật chống gian lận (rời màn hình khi đang làm: điểm câu đó còn 50%, ghi số lần vào thống kê)</label>
  <label class="small"><b>Số câu hỏi mỗi lần thi</b> — để <b>0</b> là lấy tất cả câu trong bộ đề; nếu đặt số, mỗi lần làm bài hệ thống tự chọn ngẫu nhiên đủ số câu đó và xáo trộn thứ tự câu lẫn phương án <input id="ctNumQ" type="number" value="0" min="0" max="100" style="width:90px"></label>
  <label class="small" style="display:block"><input type="checkbox" id="ctShowBoard" style="width:auto"> 🏆 Cho học sinh xem bảng xếp hạng đầy đủ sau khi nộp bài (thứ hạng, tên, thời gian làm bài, điểm)</label>
  <button class="btn green" id="ctCreate">🏆 Tạo cuộc thi</button> <span id="ctMsg" class="small"></span>
  <p class="small">Học sinh vào bằng <b>mã phòng thi 6 số</b> tại Trang chủ, hoặc bấm nút <b>📱 QR / Liên kết</b> ở mỗi cuộc thi bên dưới để lấy mã QR / liên kết vào thẳng phòng thi (không cần nhập mã). Ngoài khung giờ trên, học sinh không vào được phòng thi.</p></div>
  <div class="card"><h2>Cuộc thi của tôi (${mine.length})</h2>
  ${mine.length? mine.map(c=>`<div class="card" style="background:#fafafa"><div class="row"><div class="grow"><b>${esc(c.title)}</b> ${statusOf(c)}<br><span class="small">Mã phòng thi: <b style="font-size:18px">${esc(c.code)}</b> • ${esc(c.className||'Không chọn lớp')} • ${c.questions?.length||0} câu • Tối đa ${c.maxAttempts||1} lần làm${c.numQuestions>0?` • Mỗi lần thi ${c.numQuestions} câu ngẫu nhiên`:''}${c.showLeaderboard?' • HS xem được BXH':''}<br>Từ ${fmtDT(c.startAt)} đến ${fmtDT(c.endAt)}${c.password?' • Có mật mã':''}</span></div>
  <button class="btn light" data-share="${c.code}">📱 QR / Liên kết</button><button class="btn" data-stats="${c.code}">📊 Thống kê</button>${c.closed?'':`<button class="btn gray" data-closect="${c.code}">🔒 Đóng</button>`}<button class="btn red" data-delct="${c.code}">Xóa</button></div>
  <div data-sharebox="${c.code}" style="display:none;text-align:center">${shareRoomHtml(c.code, 150)}</div></div>`).join('') : '<p class="small">Chưa có cuộc thi nào.</p>'}</div>`;
  $('#ctCreate').onclick = async()=>{
    const quiz = quizzes.find(q=>q.id===$('#ctQuiz').value); if(!quiz) return alert('Thầy/cô chưa có bộ đề nào. Tạo bộ đề trước nhé!');
    const startAt = new Date($('#ctStart').value).getTime(), endAt = new Date($('#ctEnd').value).getTime();
    if(!startAt||!endAt||endAt<=startAt) return alert('Khung giờ thi chưa hợp lệ: giờ kết thúc phải sau giờ bắt đầu.');
    const selCls = classes.filter(c=>app.querySelector(`[data-ctclass="${c.id}"]`)?.checked);
    const code = await contestCreate({ cover: quiz.cover||'', contestBg: quiz.contestBg||'', bgFade: quiz.bgFade??85, quizId: quiz.id, title: quiz.title, subject: quiz.subject||'', questions: quiz.questions,
      classId: selCls[0]?.id||'', classIds: selCls.map(c=>c.id), className: selCls.map(c=>c.name).join(', '), startAt, endAt, password: $('#ctPass').value.trim(),
      maxAttempts: Math.max(1,Math.min(10,+$('#ctAttempts').value||1)), antiCheat: $('#ctAnti').checked, numQuestions: Math.max(0,+$('#ctNumQ').value||0), showLeaderboard: $('#ctShowBoard').checked,
      ownerUid: me?.uid||'', ownerEmail: me?.email||'', createdAt: Date.now() });
    alert('Đã tạo cuộc thi! Mã phòng thi: '+code+'\nThầy/cô gửi mã này cho học sinh, hoặc bấm nút "📱 QR / Liên kết" ở cuộc thi vừa tạo để chép liên kết / cho học sinh quét mã QR vào thẳng phòng thi trong khung giờ đã đặt.');
    renderContests();
  };
  app.querySelectorAll('[data-share]').forEach(b=>b.onclick=()=>{ const el=app.querySelector(`[data-sharebox="${b.dataset.share}"]`); el.style.display = el.style.display==='none'?'block':'none'; });
  wireShareRoom(app);
  app.querySelectorAll('[data-stats]').forEach(b=>b.onclick=()=>renderContestStats(b.dataset.stats));
  app.querySelectorAll('[data-delct]').forEach(b=>b.onclick=async()=>{ if(confirm('Xóa cuộc thi này và toàn bộ kết quả của học sinh?')){ await contestDelete(b.dataset.delct); renderContests(); } });
  app.querySelectorAll('[data-closect]').forEach(b=>b.onclick=async()=>{ if(confirm('Đóng cuộc thi này? Học sinh sẽ không vào làm bài được nữa.')){ await contestPatch(b.dataset.closect,{closed:true}); renderContests(); } });
}

// Cổng vào phòng thi cho học sinh
const fadeBgStyle = (url, fade) => { if(!url) return ''; const f=Math.min(1,Math.max(0,((fade??85))/100)); return ` style="background-image:linear-gradient(rgba(255,255,255,${f}),rgba(255,255,255,${f})),url('${url}');background-size:cover;background-position:center"`; };
const ctBgStyle = ct => fadeBgStyle(ct?.contestBg, ct?.bgFade);
async function renderContestGate(code, nickname){
  const ct = await contestGet(code);
  if (!ct){ alert('Không tìm thấy phòng thi này. Em kiểm tra lại mã phòng thi nhé!'); return; }
  const now = Date.now(), open = !ct.closed && now>=ct.startAt && now<=ct.endAt;
  const classIds = (Array.isArray(ct.classIds)&&ct.classIds.length)? ct.classIds : (ct.classId?[ct.classId]:[]);
  let gateClasses = [];
  if (classIds.length){ try{ const allC = await store.listClasses(); gateClasses = allC.filter(c=>classIds.includes(c.id)); }catch{} }
  const rosterMode = gateClasses.length>0;
  app.innerHTML = `<div class="card join"${ctBgStyle(ct)}><h1>🏆 ${esc(ct.title)}</h1>
  <p class="small">${ct.className?`Lớp: <b>${esc(ct.className)}</b> • `:''}${ct.numQuestions>0?`Thi ${ct.numQuestions} câu (chọn ngẫu nhiên từ ${ct.questions.length} câu của bộ đề)`:ct.questions.length+' câu hỏi'} • Mỗi em được làm tối đa <b>${ct.maxAttempts||1} lần</b><br>Khung giờ thi: từ <b>${fmtDT(ct.startAt)}</b> đến <b>${fmtDT(ct.endAt)}</b></p>
  <div id="ctResume"></div>
  ${open? `${rosterMode? `<label class="small" style="text-align:left;display:block"><b>Chọn lớp của em:</b></label><select id="gClass">${gateClasses.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
  <label class="small" style="text-align:left;display:block"><b>Chọn tên của em trong danh sách lớp:</b></label><select id="gName"></select>` : `<input id="gNick" placeholder="Họ tên của em" value="${esc(nickname||'')}">`}
  <p class="small" style="text-align:left;margin:10px 0 4px"><b>Chọn avatar:</b></p>${avatarPickerHtml('gAvPick')}
  ${ct.password?'<input id="gPass" type="password" placeholder="Mật mã phòng thi">':''}
  <button class="btn green" style="width:100%" id="gStart">✔ Sẵn sàng — Bắt đầu làm bài</button>
  <p class="small">Trả lời xong mỗi câu, hệ thống tự chuyển sang câu tiếp theo. ${ct.antiCheat?'Lưu ý: rời khỏi màn hình khi đang làm bài sẽ bị trừ 50% điểm câu đó và ghi vào thống kê.':''}</p>`
  : `<div class="notice">${ct.closed?'🔒 Cuộc thi đã bị đóng bởi người tổ chức. Hẹn em ở cuộc thi khác nhé!':now<ct.startAt?'⏰ Chưa đến giờ thi. Em quay lại trong khung giờ ở trên nhé!':'⛔ Đã hết thời gian thi, phòng thi đã đóng.'}</div>
  <button class="btn" style="width:100%" onclick="location.reload()">← Về trang chủ</button>`}</div>`;
  if (!open) return;
  const getGAv = wireAvatarPicker('gAvPick');
  const fillNames = ()=>{ const sel=$('#gName'); if(!sel) return; const cls=gateClasses.find(c=>c.id===$('#gClass')?.value) || gateClasses[0]; const mem=(cls?.members||[]).filter(Boolean); sel.innerHTML = mem.length? mem.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('') : '<option value="">— Lớp chưa có danh sách học sinh —</option>'; };
  if (rosterMode){ const gc=$('#gClass'); if(gc) gc.onchange=fillNames; fillNames(); }
  // Có bài làm dở đã lưu trên máy này (lỡ tải lại trang) thì cho làm tiếp, không mất bài và không tốn thêm lượt làm
  let savedCt = null;
  try{ savedCt = JSON.parse(localStorage.getItem('eq_resume_contest')||'null'); }catch{}
  if (savedCt && savedCt.code===ct.code && savedCt.qs?.length){
    const box = $('#ctResume'), doneN = (savedCt.answers||[]).length;
    if (box) box.innerHTML = `<div class="notice">▶ <b>${esc(savedCt.nickname)}</b> đang làm dở bài thi này (đã làm ${doneN}/${savedCt.qs.length} câu, ${savedCt.score||0} điểm) — có phải em vừa tải lại trang không?<br>
    <button class="btn green" id="ctResumeBtn" style="margin-top:8px">↪ Tiếp tục làm bài</button> <button class="btn light" id="ctDiscardBtn" style="margin-top:8px">Bỏ bài làm dở</button></div>`;
    const gn=$('#gNick'); if(gn) gn.value = savedCt.nickname||'';
    const rb = $('#ctResumeBtn'); if (rb) rb.onclick = ()=>renderContestPlay(ct, savedCt.nickname, savedCt.attemptsBefore||0, savedCt.avatar, savedCt);
    const db2 = $('#ctDiscardBtn'); if (db2) db2.onclick = ()=>{ try{ localStorage.removeItem('eq_resume_contest'); }catch{} savedCt = null; if (box) box.innerHTML=''; };
  }
  $('#gStart').onclick = async()=>{
    const nick = rosterMode ? ($('#gName')?.value||'').trim() : $('#gNick').value.trim();
    if(!nick) return alert(rosterMode ? 'Em chọn lớp và chọn tên của mình trong danh sách trước nhé!' : 'Em nhập họ tên trước nhé!');
    if (ct.password && $('#gPass').value.trim() !== ct.password) return alert('Mật mã phòng thi chưa đúng. Em hỏi lại thầy/cô nhé!');
    const nameKey = nick.toLowerCase();
    if (savedCt && savedCt.code===ct.code && nameKey===String(savedCt.nickname||'').trim().toLowerCase() && savedCt.qs?.length) return renderContestPlay(ct, savedCt.nickname, savedCt.attemptsBefore||0, savedCt.avatar, savedCt);
    const done = (await contestResults(ct.code)).filter(r=>r.nameKey===nameKey).length;
    const localDone = +(localStorage.getItem('eq_ctatt_'+ct.code+'_'+nameKey)||0);
    const used = Math.max(done, localDone);
    if (used >= (ct.maxAttempts||1)) return alert('Em đã hết số lần làm bài cho phép ('+(ct.maxAttempts||1)+' lần). Em liên hệ thầy/cô nếu cần làm lại nhé!');
    localStorage.setItem('eq_ctatt_'+ct.code+'_'+nameKey, used+1);
    renderContestPlay(ct, nick, used, getGAv());
  };
}

// Học sinh làm bài thi: tự chuyển câu, tính điểm theo tốc độ, chống gian lận
function renderContestPlay(ct, nickname, attemptsBefore, avatar, saved){
  stopListen();
  // Có tiến trình đã lưu (học sinh lỡ tải lại trang) thì làm tiếp đúng bài đó: cùng bộ câu đã xáo, cùng điểm và số câu đã làm
  let qs, i, score, correctCount, cheatCount, startedAt;
  if (saved?.qs?.length){ qs = saved.qs; i = Math.min(Math.max(saved.i||0, (saved.answers||[]).length), qs.length-1); score = saved.score||0; correctCount = saved.correctCount||0; cheatCount = saved.cheatCount||0; startedAt = saved.startedAt||Date.now(); }
  else { const pool = shuffleArr(ct.questions).slice(0, ct.numQuestions>0 ? Math.min(ct.numQuestions, ct.questions.length) : ct.questions.length);
    qs = pool.map(q=>{ if (q.type==='tf' || !Array.isArray(q.answers) || q.answers.length<2) return q;
      const idxs = shuffleArr(q.answers.map((_,j)=>j));
      return {...q, answers: idxs.map(j=>q.answers[j]), correct: idxs.indexOf(q.correct)}; });
    i = 0; score = 0; correctCount = 0; cheatCount = 0; startedAt = Date.now(); }
  const nameKey = nickname.trim().toLowerCase();
  let finished=false, locked=false, cheated=false, qStart=0, timerInt=null;
  const answers = saved?.answers ? [...saved.answers] : [];
  function saveProg(){ if (finished) return; try{ localStorage.setItem('eq_resume_contest', JSON.stringify({ code: ct.code, nickname, avatar: avatar||'🙂', attemptsBefore: attemptsBefore||0, qs, i, score, correctCount, cheatCount, answers, startedAt, savedAt: Date.now() })); }catch{} }
  const onVis = ()=>{ if (document.hidden) markCheat(); };
  const onBlur = ()=>markCheat();
  document.addEventListener('visibilitychange', onVis); window.addEventListener('blur', onBlur); window.addEventListener('pagehide', onBlur);
  function cleanup(){ clearInterval(timerInt); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('blur', onBlur); window.removeEventListener('pagehide', onBlur); }
  function markCheat(){
    if (finished || locked || ct.antiCheat===false || cheated) return;
    cheated = true; cheatCount++;
    const w = $('#ctWarn'); if (w) w.style.display='block';
  }
  async function finish(){
    if (finished) return; finished = true; cleanup();
    try{ localStorage.removeItem('eq_resume_contest'); }catch{}
    const res = { name: nickname, avatar: avatar||'🙂', nameKey, className: ct.className||'', score, correctCount, total: qs.length, cheatCount, attempt: (attemptsBefore||0)+1, startedAt, finishedAt: Date.now(), durationMs: Date.now()-startedAt, answers };
    await contestSubmitResult(ct.code, res);
    const all = await contestResults(ct.code);
    const ranked = [...all].sort((a,b)=>(b.score-a.score)||(a.finishedAt-b.finishedAt));
    const rank = ranked.findIndex(r=>r.nameKey===nameKey && r.finishedAt===res.finishedAt)+1;
    app.innerHTML = `<div class="card center"${ctBgStyle(ct)}><h1>🏁 Đã nộp bài!</h1>
    <p class="big">Điểm của em: ${score}</p>
    <p>Số câu đúng: <b>${correctCount}/${qs.length}</b> • Xếp hạng hiện tại: <b>${rank>0?('thứ '+rank+' / '+ranked.length):'—'}</b>${ct.antiCheat?`<br>Số lần rời màn hình: <b>${cheatCount}</b>`:''}</p>
    ${ct.showLeaderboard? `<h3 style="margin-top:18px">🏆 Bảng xếp hạng</h3><table class="sortable"><tr><th>Hạng</th><th>Học sinh</th><th>Thời gian làm bài</th><th>Điểm</th></tr>${ranked.map((r,ix)=>{ const dur = (r.durationMs!=null)? r.durationMs : ((r.finishedAt||0)-(r.startedAt||0)); return `<tr ${r.nameKey===nameKey&&r.finishedAt===res.finishedAt?'style="background:#fff3cd;font-weight:800"':''}><td data-sort="${ix+1}">${ix+1}</td><td>${r.avatar||'🙂'} ${esc(r.name)}</td><td data-sort="${dur}">${fmtDuration(dur)}</td><td data-sort="${r.score||0}"><b>${r.score||0}</b></td></tr>`; }).join('')}</table>` : ''}
    <div class="row" style="justify-content:center">${(attemptsBefore||0)+1 < (ct.maxAttempts||1) ? '<button class="btn" id="ctRetry">↻ Làm lại bài thi</button>' : ''}<button class="btn green" onclick="location.reload()">Về trang chủ</button></div></div>`;
    enableSorting(app);
    const rt = $('#ctRetry'); if (rt) rt.onclick = ()=>{ localStorage.setItem('eq_ctatt_'+ct.code+'_'+nameKey, (attemptsBefore||0)+2 > (ct.maxAttempts||1) ? (ct.maxAttempts||1) : (attemptsBefore||0)+2); renderContestPlay(ct, nickname, (attemptsBefore||0)+1, avatar); };
  }
  function answer(choice){
    if (locked || finished) return; locked = true; clearInterval(timerInt);
    const q = qs[i], elapsed = Date.now()-qStart, correct = choice===q.correct;
    let pts = correct ? Math.round((q.points||1000)*(1-Math.min(elapsed/((q.time||20)*1000),1)/2)) : 0;
    if (correct && cheated && ct.antiCheat!==false) pts = Math.round(pts*0.5);
    score += pts; if (correct) correctCount++;
    answers.push({choice, correct, points: pts, cheated}); saveProg();
    app.querySelectorAll('[data-ca]').forEach(b=>{ b.disabled = true; const j=+b.dataset.ca;
      if (j===q.correct) b.style.background='#86efac';
      else if (j===choice) b.style.background='#c00'; b.style.color='#fff'; });
    const fb = $('#ctFb'); if (fb) fb.innerHTML = correct ? `🎉 Đúng rồi! +${pts} điểm${cheated&&ct.antiCheat!==false?' (đã giảm 50% vì rời màn hình)':''}` : (choice<0 ? '⏰ Hết giờ câu này!' : 'Chưa đúng rồi. Đáp án đúng đã được tô xanh.');
    setTimeout(()=>{ i++; if (i>=qs.length || Date.now()>ct.endAt) finish(); else drawQ(); }, 1000);
  }
  function drawQ(){
    cheated = false; locked = false; qStart = Date.now(); saveProg();
    const q = qs[i], total = q.time||20, list = q.type==='tf' ? ['Đúng','Sai'] : q.answers;
    app.innerHTML = `<div class="card"${ctBgStyle(ct)}><div class="row"><span class="tag">Câu ${i+1}/${qs.length}</span><span class="tag">Điểm: ${score}</span><span class="tag" id="ctLeft">⏱️ ${total} giây</span></div>
    <div style="background:#eee;border-radius:99px;height:10px;margin:8px 0"><div id="ctBar" style="background:#a78bfa;height:10px;border-radius:99px;width:100%"></div></div>
    <div class="notice" id="ctWarn" style="display:none">⚠️ <b>Cảnh báo gian lận:</b> Em đã rời khỏi màn hình làm bài. Điểm câu này chỉ còn <b>50%</b> và lần rời màn hình sẽ hiện trong thống kê của thầy/cô.</div>
    <h2>${richHtml(q.text)}</h2>${mediaHtml(q)}
    <div class="answers">${list.map((a,j)=>`<button class="ans c${j}" data-ca="${j}">${SHAPES[j]} ${richHtml(a)}</button>`).join('')}</div>
    <p class="small" id="ctFb" style="min-height:22px"></p></div>`;
    math(app);
    app.querySelectorAll('[data-ca]').forEach(b=>b.onclick=()=>answer(+b.dataset.ca));
    clearInterval(timerInt);
    timerInt = setInterval(()=>{ const left = total - Math.floor((Date.now()-qStart)/1000);
      const el = $('#ctLeft'), bar = $('#ctBar'); if (!el){ clearInterval(timerInt); return; }
      el.textContent = '⏱️ '+Math.max(0,left)+' giây'; if (bar) bar.style.width = Math.max(0,left/total*100)+'%';
      if (Date.now() > ct.endAt){ finish(); return; }
      if (left<=0) answer(-1);
    }, 250);
  }
  drawQ();
}

// Thống kê cuộc thi cho giáo viên: tự xếp hạng theo điểm, sắp xếp mọi cột
async function renderContestStats(code){
  const ct = await contestGet(code); if(!ct){ alert('Không tìm thấy cuộc thi.'); return; }
  const rs = await contestResults(code);
  const ranked = [...rs].sort((a,b)=>(b.score-a.score)||(a.finishedAt-b.finishedAt));
  const rankOf = r => ranked.indexOf(r)+1;
  app.innerHTML = `<div class="card"><h1>📊 Thống kê cuộc thi</h1>
  <p><b>${esc(ct.title)}</b> • Mã phòng thi <b>${esc(ct.code)}</b>${ct.className?` • Lớp ${esc(ct.className)}`:''}<br><span class="small">Khung giờ: ${fmtDT(ct.startAt)} → ${fmtDT(ct.endAt)} • Đã có ${rs.length} lượt làm bài • Bảng tự xếp hạng theo điểm từ cao xuống thấp, bấm ↕ ở từng cột để sắp xếp lại.</span></p>
  <table class="sortable"><tr><th>Hạng</th><th>Học sinh</th><th>Ngày giờ làm</th><th>Điểm</th><th>Số câu đúng</th><th>⚠️ Số lần gian lận</th><th>Lần làm thứ</th></tr>
  ${ranked.map(r=>`<tr><td data-sort="${rankOf(r)}">${rankOf(r)}</td><td>${r.avatar||'🙂'} ${esc(r.name)}</td><td data-sort="${r.finishedAt||0}">${fmtDT(r.finishedAt)}</td><td data-sort="${r.score||0}"><b>${r.score||0}</b></td><td data-sort="${r.correctCount||0}">${r.correctCount||0}/${r.total||0}</td><td data-sort="${r.cheatCount||0}">${r.cheatCount||0}</td><td data-sort="${r.attempt||1}">${r.attempt||1}</td></tr>`).join('')||'<tr><td colspan="7">Chưa có học sinh nào làm bài.</td></tr>'}
  </table>
  <button class="btn" onclick="document.querySelector('[data-nav=contests]').click()">← Quay lại danh sách cuộc thi</button></div>`;
  enableSorting(app);
}

async function renderReports(){
  const now = Date.now();
  const mineCt = ct => me?.role==='admin'||!ct.ownerUid||ct.ownerUid===me?.uid;
  const all = await contestList();
  const ended = all.filter(ct=>mineCt(ct) && (ct.closed || now>ct.endAt)).sort((a,b)=>(b.endAt||0)-(a.endAt||0));
  const open = all.filter(ct=>mineCt(ct) && !ct.closed && now>=ct.startAt && now<=ct.endAt).sort((a,b)=>(a.endAt||0)-(b.endAt||0));
  app.innerHTML=`<div class="card"><h1>📊 Báo cáo</h1>
  <h2>🏁 Các cuộc thi đã kết thúc (${ended.length})</h2>
  ${ended.length? ended.map(ct=>`<div class="card" style="background:#fafafa"><div class="row"><div class="grow"><b>${esc(ct.title)}</b> ${ct.closed?'<b style="color:#e11d48">🔒 Đã đóng</b>':'<span class="small">(đã hết giờ)</span>'}<br><span class="small">Mã phòng thi ${esc(ct.code)} • ${fmtDT(ct.startAt)} → ${fmtDT(ct.endAt)} • Đã có <span data-repcount="${esc(ct.code)}">…</span> lượt làm bài</span></div>
  <button class="btn" data-endedview="${esc(ct.code)}">📊 Xem bảng xếp hạng</button></div></div>`).join('') : '<p class="small">Chưa có cuộc thi nào đã kết thúc.</p>'}
  <h2>🏆 Các cuộc thi đang mở (${open.length})</h2>
  <p class="small">Các cuộc thi đang trong khung giờ mở. Thầy/cô có thể xem bảng xếp hạng, sửa thông tin hoặc đóng phòng thi ngay tại đây.</p>
  ${open.length? open.map(ct=>`<div class="card" style="background:#fafafa"><div class="row"><div class="grow"><b>${esc(ct.title)}</b> <b style="color:#16a34a">● Đang mở</b><br><span class="small">Mã phòng thi ${esc(ct.code)} • Đóng lúc: ${fmtDT(ct.endAt)} • Đã có <span data-repcount="${esc(ct.code)}">…</span> lượt làm bài</span></div>
  <button class="btn" data-repview="${esc(ct.code)}">👁️ Xem</button><button class="btn light" data-repedit="${esc(ct.code)}">✏️ Sửa</button><button class="btn red" data-repclose="${esc(ct.code)}">🔒 Đóng</button></div></div>`).join('') : '<p class="small">Hiện không có cuộc thi nào đang mở. Vào mục 🏆 Cuộc thi → Gián tiếp để tạo và mở cuộc thi mới nhé.</p>'}
  </div>`;
  app.querySelectorAll('[data-endedview]').forEach(b=>b.onclick=()=>renderContestStats(b.dataset.endedview));
  app.querySelectorAll('[data-repview]').forEach(b=>b.onclick=()=>renderContestStats(b.dataset.repview));
  app.querySelectorAll('[data-repedit]').forEach(b=>b.onclick=()=>renderContestEdit(b.dataset.repedit));
  app.querySelectorAll('[data-repclose]').forEach(b=>b.onclick=async()=>{ if(!confirm('Đóng cuộc thi này? Học sinh sẽ không vào làm bài được nữa.')) return; await contestPatch(b.dataset.repclose,{closed:true}); renderReports(); });
  [...ended, ...open].forEach(async ct=>{ const el=app.querySelector(`[data-repcount="${ct.code}"]`); if(el){ const rs=await contestResults(ct.code); el.textContent=rs.length; } });
}
async function renderContestEdit(code){
  const ct = await contestGet(code); if(!ct){ alert('Không tìm thấy cuộc thi.'); return; }
  const toLocal = ts => new Date(ts - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  app.innerHTML=`<div class="card"><h1>✏️ Sửa cuộc thi</h1>
  <p><b>${esc(ct.title)}</b> • Mã phòng thi <b>${esc(ct.code)}</b></p>
  <label class="small">Giờ bắt đầu <input id="ceStart" type="datetime-local" value="${toLocal(ct.startAt)}"></label>
  <label class="small">Giờ kết thúc <input id="ceEnd" type="datetime-local" value="${toLocal(ct.endAt)}"></label>
  <label class="small">Mật mã phòng thi (để trống nếu không dùng) <input id="cePass" value="${esc(ct.password||'')}"></label>
  <div class="row"><label class="small">Số lần làm lại tối đa <input id="ceAttempts" type="number" value="${ct.maxAttempts||1}" min="1" max="10" style="width:90px"></label>
  <label class="small">Số câu mỗi lần thi (0 = tất cả) <input id="ceNumQ" type="number" value="${ct.numQuestions||0}" min="0" max="100" style="width:90px"></label></div>
  <label class="small" style="display:block"><input type="checkbox" id="ceAnti" ${ct.antiCheat?'checked':''} style="width:auto"> ⚠️ Bật chống gian lận (chuyển tab, thu nhỏ cửa sổ, rời màn hình khi đang làm: điểm câu đó còn 50%)</label>
  <label class="small" style="display:block"><input type="checkbox" id="ceShow" ${ct.showLeaderboard?'checked':''} style="width:auto"> 🏆 Cho học sinh xem bảng xếp hạng đầy đủ sau khi nộp bài</label>
  <div class="row"><button class="btn green" id="ceSave">💾 Lưu thay đổi</button><button class="btn light" id="ceBack">← Quay lại Báo cáo</button></div></div>`;
  $('#ceBack').onclick=()=>renderReports();
  $('#ceSave').onclick=async()=>{ const startAt=new Date($('#ceStart').value).getTime(), endAt=new Date($('#ceEnd').value).getTime();
    if(!startAt||!endAt||endAt<=startAt) return alert('Khung giờ thi chưa hợp lệ: giờ kết thúc phải sau giờ bắt đầu.');
    await contestPatch(code,{ startAt, endAt, password: $('#cePass').value.trim(), maxAttempts: Math.max(1,Math.min(10,+$('#ceAttempts').value||1)), numQuestions: Math.max(0,+$('#ceNumQ').value||0), antiCheat: $('#ceAnti').checked, showLeaderboard: $('#ceShow').checked });
    alert('Đã lưu thay đổi cuộc thi!'); renderReports(); };
}
const leaderboard=(ps,m)=>`<h2>🏆 Bảng xếp hạng</h2><table class="sortable"><tr><th>Hạng</th><th>Người chơi</th><th>Điểm</th></tr>${ps.slice(0,10).map((p,i)=>`<tr ${m&&p.id===m?'style="background:#fff3cd;font-weight:800"':''}><td data-sort="${i+1}">${i+1}</td><td>${p.avatar||'🙂'} ${esc(p.nickname)} ${p.streak>=3?'🔥':''}</td><td data-sort="${p.score||0}">${p.score||0} điểm</td></tr>`).join('')}</table>`;
const podium=ps=>{ const t=[ps[1],ps[0],ps[2]].filter(Boolean); return `<h2>👑 Bục vinh quang</h2><div class="podium">${t.map(p=>`<div class="pod"><div style="font-size:28px">${p.avatar||'🙂'}</div><div>${esc(p.nickname)}</div><div class="bar">${p.score||0}đ</div></div>`).join('')}</div>`+leaderboard(ps); };

// ---------- Cài đặt chung của trang (Quản trị → Cài đặt khác) ----------
window.__siteSettings = {};
function applyFx(){
  const layer = document.getElementById('fxLayer'); if(!layer) return;
  layer.innerHTML='';
  const fx = (window.__siteSettings||{}).effect||{}; const type = fx.type||'none';
  if (type==='none') return;
  const n = Math.min(100, Math.max(1, +fx.density||30)), spd = +fx.speed||1, size = +fx.size||22;
  const glyphs = { tree:['🎄'], reindeer:['🦌'], santa:['🎅','🎄','🎁'] };
  for (let i=0;i<n;i++){
    const el = document.createElement('span'); el.className='fxp';
    const base = type==='rain' ? (0.6+Math.random()*0.5) : type==='snow' ? (10+Math.random()*8) : (type==='mai'||type==='dao') ? (8+Math.random()*6) : type==='hearts' ? (9+Math.random()*6) : (9+Math.random()*7);
    const dur = base / spd;
    el.style.left = (Math.random()*100)+'vw';
    el.style.setProperty('--drift', (Math.random()*10-5).toFixed(1)+'vw');
    el.style.animationDuration = dur+'s';
    el.style.animationDelay = (-Math.random()*dur)+'s';
    const mid = document.createElement('span'); mid.className='fxin';
    mid.style.animationDuration = (1.8+Math.random()*1.6)+'s';
    mid.style.animationDelay = (-Math.random()*2)+'s';
    if (type==='rain'){ mid.classList.add('fxrain'); mid.style.height = Math.round(size*3)+'px'; }
    else if (type==='snow'){ mid.classList.add('fxsnow'); const d=Math.round(4+Math.random()*(size*0.55)); mid.style.width=d+'px'; mid.style.height=d+'px'; mid.style.opacity=(0.5+Math.random()*0.45).toFixed(2); if(Math.random()<0.35) mid.style.filter='blur(1px)'; }
    else if (type==='mai' || type==='dao'){ mid.classList.add('fxpetal', type); mid.style.width=Math.round(size*(0.75+Math.random()*0.4))+'px'; mid.style.height=Math.round(size*(0.6+Math.random()*0.3))+'px'; mid.style.animationName='fxflutter'; mid.style.animationDuration=(2.2+Math.random()*2)+'s'; }
    else if (type==='hearts'){ const h=document.createElement('span'); h.className='fxheart'; const d=Math.round(size*(0.62+Math.random()*0.4)); h.style.width=d+'px'; h.style.height=d+'px'; h.style.opacity=(0.75+Math.random()*0.25).toFixed(2); mid.appendChild(h); }
    else if (type==='banhchung'){ mid.classList.add('fxbc'); mid.style.width=size+'px'; mid.style.height=size+'px'; }
    else { const g = glyphs[type]||['❄']; mid.classList.add('fxemoji'); mid.textContent = g[Math.floor(Math.random()*g.length)]; mid.style.fontSize = Math.round(size*(0.8+Math.random()*0.6))+'px'; }
    el.appendChild(mid);
    layer.appendChild(el);
  }
}
function applySettings(){
  const st = window.__siteSettings||{};
  const f = document.getElementById('siteFooterText');
  if (f) f.textContent = `PCQuiz - Tổ chức cuộc thi trực tuyến - Version ${st.version||'1.0'}`;
  if (st.bgImage){ document.body.style.backgroundImage = `linear-gradient(rgba(250,248,255,.88),rgba(250,248,255,.88)),url('${st.bgImage}')`; document.body.style.backgroundSize='cover'; document.body.style.backgroundAttachment='fixed'; document.body.style.backgroundPosition='center'; }
  else document.body.style.backgroundImage='';
  let cs = document.getElementById('customCssStyle');
  if (st.customCss){ if(!cs){ cs=document.createElement('style'); cs.id='customCssStyle'; document.head.appendChild(cs); } cs.textContent = st.customCss; }
  else if (cs) cs.textContent='';
  applyFx();
}
async function saveSiteSettings(patch){
  const cur = { ...(window.__siteSettings||{}), ...patch };
  if (DEMO){ localStorage.setItem('eq_site_settings', JSON.stringify(cur)); window.__siteSettings = cur; applySettings(); return; }
  await F.setDoc(F.doc(db,'plans','siteSettings'), cur, { merge:true });
}
function initSettings(){
  if (DEMO){ try{ window.__siteSettings = JSON.parse(localStorage.getItem('eq_site_settings')||'{}'); }catch{ window.__siteSettings={}; } applySettings(); return; }
  if (F && db) F.onSnapshot(F.doc(db,'plans','siteSettings'), sn=>{ window.__siteSettings = sn.exists()? sn.data() : {}; applySettings(); }, ()=>{});
}

init();
