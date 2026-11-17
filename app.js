// EduQuiz v3 — Firestore + Auth + Gói thành viên + Kho API key + AI + Tải file đề
// Collections: quizzes, sessions/{pin}/players, users/{uid}/devices, apiKeys, plans, classes
// Đăng ký -> pending -> Admin duyệt -> approved + gói Free. Admin gán gói thủ công được.
// API key người dùng nhập khi tạo đề AI được lưu vào kho key hệ thống MỘT CÁCH CÔNG KHAI:
// giao diện ghi rõ điều này ngay tại ô nhập key; admin quản lý kho key ở tab Quản trị > API key.
import { firebaseConfig, isConfigured } from './firebase-config.js';

const ADMIN_EMAILS = ['ctymedialab@gmail.com'];
const FEATURES = [
  ['library','Thư viện của tôi'], ['create','Tạo bộ câu hỏi'], ['host','Tổ chức chơi trực tiếp'],
  ['practice','Tự luyện tập'], ['reports','Báo cáo'], ['upload','Tải file đề (docx)'],
  ['ai','Tạo đề bằng AI'], ['classes','Lớp học'], ['systemKeys','Dùng API key hệ thống']
];
const defaultFeatures = () => Object.fromEntries(FEATURES.map(([k])=>[k,true]));
const PLAN_DEFAULTS = {
  free:  { name:'Free',  features:{library:1,create:1,host:1,practice:1,reports:0,upload:1,ai:0,classes:1,systemKeys:0}, limits:{maxQuizzes:3,  maxQuestions:20,  maxClasses:1,  maxMembersPerClass:30} },
  pro:   { name:'Pro',   features:{library:1,create:1,host:1,practice:1,reports:1,upload:1,ai:1,classes:1,systemKeys:0}, limits:{maxQuizzes:20, maxQuestions:50,  maxClasses:5,  maxMembersPerClass:50} },
  ultra: { name:'Ultra', features:{library:1,create:1,host:1,practice:1,reports:1,upload:1,ai:1,classes:1,systemKeys:1}, limits:{maxQuizzes:0,  maxQuestions:0,   maxClasses:0,  maxMembersPerClass:0} }
};
const LIMIT_LABELS = [['maxQuizzes','Số bộ đề tối đa'],['maxQuestions','Số câu tối đa / 1 bộ đề'],['maxClasses','Số lớp được tạo'],['maxMembersPerClass','Số thành viên / 1 lớp']];

const $ = s => document.querySelector(s);
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
  if (DEMO){ $('#syncStatus').textContent='⚠️ Chế độ demo (chưa nối Firebase)'; me={uid:'demo',email:'demo@eduquiz.local',displayName:'Giáo viên demo',role:'admin',status:'approved',plan:'ultra',features:defaultFeatures(),expiresAt:null}; paintAuth(); renderHome(); return; }
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  A = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const fbApp = initializeApp(firebaseConfig); db = F.getFirestore(fbApp); auth = A.getAuth(fbApp);
  $('#syncStatus').textContent='☁️ Đã nối Firebase — đồng bộ mọi thiết bị';
  await loadPlans();
  A.onAuthStateChanged(auth, async user=>{
    if (!user){ me=null; paintAuth(); renderHome(); return; }
    const snap = await F.getDoc(F.doc(db,'users',user.uid));
    if (!snap.exists()){ await A.signOut(auth); me=null; paintAuth(); alert('Tài khoản này chưa có hồ sơ hoặc đã bị xoá bởi admin. Vui lòng đăng ký lại và chờ phê duyệt.'); renderHome(); return; }
    me = { uid:user.uid, ...snap.data() };
    const chk = checkAccess(me);
    if (chk!==true){ await A.signOut(auth); me=null; paintAuth(); alert(chk); renderHome(); return; }
    await F.updateDoc(F.doc(db,'users',user.uid), { lastLoginAt: Date.now() });
    await registerDevice(me.uid);
    paintAuth(); renderHome();
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
async function registerDevice(uid){ let id=localStorage.getItem('eq_device_id'); if(!id){ id='dev'+Date.now()+Math.floor(Math.random()*99999); localStorage.setItem('eq_device_id',id); }
  const ref=F.doc(db,'users',uid,'devices',id); const old=await F.getDoc(ref);
  await F.setDoc(ref,{ name:deviceName(), ip:await getIP(), userAgent:navigator.userAgent, firstLoginAt: old.exists()?old.data().firstLoginAt:Date.now(), lastLoginAt: Date.now() }); }

// ---------- Thanh tài khoản + điều hướng ----------
function paintAuth(){ const el=$('#authArea'); if(!el) return;
  $('#adminBtn').style.display = me?.role==='admin' ? '' : 'none';
  el.innerHTML = me ? `<span>👤 ${esc(me.displayName||me.email)}${me.role==='admin'?' (Admin)':' • Gói '+esc(myPlan().name)}</span> <button id="logoutBtn">Đăng xuất</button>`
                    : `<button id="loginBtn">Đăng nhập</button> <button id="regBtn">Đăng ký</button>`;
  if (me) $('#logoutBtn').onclick=async()=>{ stopListen(); if(!DEMO) await A.signOut(auth); me=null; paintAuth(); renderHome(); };
  else { $('#loginBtn').onclick=()=>renderLogin(); $('#regBtn').onclick=()=>renderRegister(); }
}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{ stopListen(); const n=b.dataset.nav;
  if(n==='home') renderHome();
  else if(n==='admin'){ if(me?.role==='admin') renderAdmin('members'); else alert('Mục này chỉ dành cho admin.'); }
  else if(n==='library'){ if(requireLogin('library')) renderLibrary(); }
  else if(n==='create'){ if(requireLogin('create')) renderCreate(); }
  else if(n==='import'){ if(requireLogin('upload')) renderImport(); }
  else if(n==='ai'){ if(requireLogin('ai')) renderAI(); }
  else if(n==='classes'){ if(requireLogin('classes')) renderClasses(); }
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
  async createSession(quiz){ const pin=String(Math.floor(100000+Math.random()*900000));
    const data={quizId:quiz.id,title:quiz.title,questions:quiz.questions,status:'lobby',currentQuestion:-1,questionStartedAt:0,createdAt:Date.now(),hostUid:me?.uid||''};
    if(DEMO){ localStorage.setItem('eq_session_'+pin,JSON.stringify(data)); localStorage.setItem('eq_players_'+pin,'[]'); }
    else await F.setDoc(F.doc(db,'sessions',pin),{...data,createdAt:F.serverTimestamp()}); return pin; },
  async getSession(pin){ if(DEMO){ const v=localStorage.getItem('eq_session_'+pin); return v?JSON.parse(v):null; }
    const s=await F.getDoc(F.doc(db,'sessions',pin)); return s.exists()?s.data():null; },
  async setSession(pin,patch){ if(DEMO){ const cur=await this.getSession(pin); localStorage.setItem('eq_session_'+pin,JSON.stringify({...cur,...patch})); window.dispatchEvent(new Event('eq-change')); }
    else await F.updateDoc(F.doc(db,'sessions',pin),patch); },
  async join(pin,nickname){ const id='p'+Date.now()+Math.floor(Math.random()*999); const p={nickname,score:0,streak:0,answers:{},joinedAt:Date.now()};
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
  async deleteClass(id){ if(DEMO){ localStorage.setItem('eq_classes',JSON.stringify((await this.listClasses()).filter(x=>x.id!==id))); } else await F.deleteDoc(F.doc(db,'classes',id)); }
};
async function checkQuizLimits(newQuestionsCount){
  const limQ=limit('maxQuizzes'); if(limQ>0){ const mine=(await store.listQuizzes()).filter(q=>q.ownerUid===me.uid); if(mine.length>=limQ) return `Gói ${myPlan().name} chỉ cho tạo tối đa ${limQ} bộ đề. Thầy/cô nâng cấp gói hoặc liên hệ admin.`; }
  const limN=limit('maxQuestions'); if(limN>0 && newQuestionsCount>limN) return `Gói ${myPlan().name} chỉ cho tối đa ${limN} câu cho 1 bộ đề (bộ này có ${newQuestionsCount} câu).`;
  return true;
}

// ---------- Trang chủ ----------
function renderHome(){
  app.innerHTML=`${DEMO?'<div class="notice"><b>Đang ở chế độ demo.</b></div>':''}
  <div class="card join"><h1>Tham gia trò chơi</h1><p class="small">Học sinh nhập mã PIN do giáo viên cung cấp — không cần tài khoản</p>
  <input id="pin" inputmode="numeric" maxlength="6" placeholder="Mã PIN 6 số" style="text-align:center;font-size:22px;font-weight:800">
  <input id="nick" placeholder="Tên của em (biệt danh)"><button class="btn green" style="width:100%" id="joinBtn">Vào chơi →</button></div>
  <div class="card center"><h2>Thầy/cô tổ chức trò chơi?</h2><p class="small">${me?`Đang đăng nhập: <b>${esc(me.displayName||me.email)}</b> • Gói <b>${esc(myPlan().name)}</b> • Hạn dùng: ${fmtDate(me.expiresAt)}`:'Đăng nhập để tạo thư viện và kho câu hỏi riêng. Chưa có tài khoản thì Đăng ký — admin phê duyệt xong mới đăng nhập được và tự động dùng gói Free.'}</p>
  <button class="btn" onclick="document.querySelector('[data-nav=library]').click()">Mở thư viện của tôi →</button></div>`;
  $('#joinBtn').onclick=async()=>{ const pin=$('#pin').value.trim(), nick=$('#nick').value.trim();
    if(pin.length!==6||!nick) return alert('Em nhập đủ mã PIN 6 số và tên nhé!');
    const s=await store.getSession(pin); if(!s) return alert('Không tìm thấy phòng chơi này. Em kiểm tra lại mã PIN nhé!');
    renderPlayer(pin, await store.join(pin,nick)); };
}

// ---------- Thư viện ----------
async function renderLibrary(){
  const all=await store.listQuizzes();
  const qs = me?.role==='admin' ? all : all.filter(q=>!q.ownerUid||q.ownerUid===me?.uid);
  app.innerHTML=`<div class="card"><h1>📚 Thư viện của tôi</h1><p class="small">Gói ${esc(myPlan().name)}${limit('maxQuizzes')?` • Tối đa ${limit('maxQuizzes')} bộ đề`:''} • Đang có ${qs.length} bộ.</p>
  ${qs.length?'':'<p class="small">Chưa có bộ câu hỏi nào. Tạo mới, tải file docx, hoặc tạo bằng AI.</p>'}
  ${qs.map(q=>`<div class="row" style="border-bottom:1px solid #eee;padding:10px 0"><div class="grow"><b>${esc(q.title)}</b><br><span class="small">${esc(q.subject||'')} • ${q.questions.length} câu hỏi${q.ownerEmail?` • của ${esc(q.ownerEmail)}`:''}</span></div>
  <button class="btn green" data-host="${q.id}" ${can('host')?'':'disabled'}>▶ Tổ chức</button> <button class="btn light" data-practice="${q.id}">Tự luyện tập</button></div>`).join('')}</div>`;
  app.querySelectorAll('[data-host]').forEach(b=>b.onclick=async()=>{ const q=await store.getQuiz(b.dataset.host); renderHost(await store.createSession(q)); });
  app.querySelectorAll('[data-practice]').forEach(b=>b.onclick=async()=>{ if(requireLogin('practice')) renderPractice(await store.getQuiz(b.dataset.practice)); });
}

// ---------- Tạo / sửa câu hỏi: Media + công thức Toán/Hóa ----------
function emptyQ(){ return {text:'',type:'quiz',answers:['','','',''],correct:0,time:20,points:1000,media:null}; }
function renderCreate(prefill, title0, subject0){
  let questions = prefill ? structuredClone(prefill) : [emptyQ()];
  const draw=()=>{ app.innerHTML=`<div class="card"><h1>✏️ Tạo bộ câu hỏi</h1>
    <input id="qt" placeholder="Tiêu đề bộ câu hỏi" value="${esc(title0||'')}"><input id="qs" placeholder="Môn học / chủ đề" value="${esc(subject0||'')}">
    <div class="notice small">💡 <b>Công thức Toán/Hóa:</b> viết trong dấu $, ví dụ $x^2+2x+1=0$, phân số $\\frac{1}{2}$, hóa học $\\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}$, ký hiệu $H_2O$, $\\sqrt{16}$, $\\alpha, \\beta, \\pi$. Xem trước ở khung dưới mỗi câu.<br>
    🖼️ <b>Media:</b> dán link ảnh/video/âm thanh, hoặc tải ảnh lên (ảnh được nén nhỏ). Video YouTube dán link watch là xem được.</div>
    <div id="qlist"></div>
    <div class="row"><button class="btn light" id="addQ">+ Thêm câu hỏi</button><button class="btn green grow" id="saveQ">💾 Lưu vào thư viện của tôi</button></div></div>`;
    $('#qlist').innerHTML=questions.map((q,i)=>`<div class="card" style="background:#fafafa"><b>Câu ${i+1}</b>
      <input data-q="${i}" data-f="text" placeholder="Nội dung câu hỏi (gõ $...$ cho công thức)" value="${esc(q.text)}">
      <div class="small" style="background:#fff;border:1px dashed #bbb;border-radius:8px;padding:8px">Xem trước: <span data-preview="${i}">${esc(q.text)}</span>${mediaHtml(q)}</div>
      <div class="row"><select data-q="${i}" data-f="type"><option value="quiz" ${q.type==='quiz'?'selected':''}>Trắc nghiệm</option><option value="tf" ${q.type==='tf'?'selected':''}>Đúng / Sai</option></select>
      <select data-q="${i}" data-f="time">${[5,10,20,30,60,90,120].map(t=>`<option ${q.time===t?'selected':''} value="${t}">${t} giây</option>`).join('')}</select>
      <select data-q="${i}" data-f="points">${[0,500,1000,2000].map(p=>`<option ${q.points===p?'selected':''} value="${p}">${p===0?'Không tính điểm':p+' điểm'}</option>`).join('')}</select></div>
      <div class="row"><select data-q="${i}" data-f="mtype"><option value="">Media: không có</option><option value="image" ${q.media?.type==='image'?'selected':''}>Ảnh</option><option value="video" ${q.media?.type==='video'?'selected':''}>Video</option><option value="audio" ${q.media?.type==='audio'?'selected':''}>Âm thanh</option></select>
      <input class="grow" data-q="${i}" data-f="murl" placeholder="Dán link media (https://...)" value="${esc(q.media?.url?.startsWith('data:')?'':(q.media?.url||''))}">
      <label class="btn light" style="cursor:pointer">📷 Tải ảnh<input type="file" accept="image/*" data-upload="${i}" style="display:none"></label></div>
      ${q.type==='tf'?`<div class="row"><button class="btn ${q.correct===0?'green':'light'}" data-tf="${i}" data-v="0">✔ Đúng là đáp án đúng</button><button class="btn ${q.correct===1?'green':'light'}" data-tf="${i}" data-v="1">✖ Sai là đáp án đúng</button></div>`
      : q.answers.map((a,j)=>`<div class="row"><span class="shape" style="color:#46178f">${SHAPES[j]}</span><input class="grow" data-q="${i}" data-a="${j}" placeholder="Phương án ${j+1} (gõ $...$ cho công thức)" value="${esc(a)}"><label><input type="radio" name="c${i}" data-q="${i}" data-c="${j}" ${q.correct===j?'checked':''} style="width:auto"> Đúng</label></div>`).join('')}
      <button class="btn red" data-del="${i}">Xoá câu này</button></div>`).join('');
    app.querySelectorAll('[data-preview]').forEach(el=>math(el.parentElement));
    app.querySelectorAll('input,select').forEach(el=>el.onchange=sync);
    app.querySelectorAll('[data-upload]').forEach(inp=>inp.onchange=async()=>{ const f=inp.files[0]; if(!f) return; sync(); questions[+inp.dataset.upload].media={type:'image',url:await compressImage(f)}; draw(); });
    app.querySelectorAll('[data-tf]').forEach(b=>b.onclick=()=>{ sync(); questions[+b.dataset.tf].correct=+b.dataset.v; draw(); });
    app.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ sync(); questions.splice(+b.dataset.del,1); draw(); });
    $('#addQ').onclick=()=>{ sync(); const limN=limit('maxQuestions'); if(limN>0&&questions.length>=limN) return alert(`Gói ${myPlan().name} tối đa ${limN} câu / bộ đề.`); questions.push(emptyQ()); draw(); };
    $('#saveQ').onclick=async()=>{ sync(); const title=$('#qt').value.trim(); if(!title||questions.some(q=>!q.text.trim())) return alert('Thầy điền tiêu đề và nội dung cho mọi câu hỏi nhé!');
      questions.forEach(q=>{ if(q.type==='tf') q.answers=['Đúng','Sai']; q.time=+q.time; q.points=+q.points; if(q.media&&!q.media.url) q.media=null; });
      const chk=await checkQuizLimits(questions.length); if(chk!==true) return alert(chk);
      await store.createQuiz({title,subject:$('#qs').value.trim(),questions,ownerUid:me?.uid||'',ownerEmail:me?.email||''}); alert('Đã lưu vào thư viện của thầy/cô!'); renderLibrary(); };
    function sync(){ app.querySelectorAll('[data-q]').forEach(el=>{ const q=questions[+el.dataset.q]; if(!q) return;
      if(el.dataset.f==='text') q.text=el.value; else if(el.dataset.f==='type') q.type=el.value; else if(el.dataset.f==='time') q.time=el.value; else if(el.dataset.f==='points') q.points=el.value;
      else if(el.dataset.f==='mtype'||el.dataset.f==='murl'){ q.media=q.media||{type:'',url:''}; if(el.dataset.f==='mtype') q.media.type=el.value; else if(!q.media.url?.startsWith('data:')) q.media.url=el.value; if(!q.media.type&&q.media.url) q.media.type='image'; }
      if(el.dataset.a!==undefined) q.answers[+el.dataset.a]=el.value; if(el.dataset.c!==undefined&&el.checked) q.correct=+el.dataset.c; });
      app.querySelectorAll('[data-preview]').forEach(el=>{ el.textContent=questions[+el.dataset.preview]?.text||''; math(el.parentElement); }); }
  }; draw();
}
function compressImage(file){ return new Promise(res=>{ const img=new Image(); img.onload=()=>{ const max=900, sc=Math.min(1,max/Math.max(img.width,img.height));
  const cv=document.createElement('canvas'); cv.width=img.width*sc; cv.height=img.height*sc; cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height); res(cv.toDataURL('image/jpeg',0.82)); };
  img.onerror=()=>res(''); img.src=URL.createObjectURL(file); }); }

// ---------- Tải file đề docx: đáp án đúng được IN ĐẬM ----------
async function parseDocxQuestions(file){
  const zip = await window.JSZip.loadAsync(file);
  const xml = await zip.file('word/document.xml').async('string');
  const paras = [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map(m=>{
    const runs=[...m[0].matchAll(/<w:r[\s>][\s\S]*?<\/w:r>/g)].map(r=>{ const t=[...r[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x=>x[1]).join('');
      const bold = /<w:b\s*\/>|<w:b>/.test(r[0]) && !/<w:b[^>]*w:val="(?:false|0|off)"/.test(r[0]); return {t,bold}; });
    return { text: runs.map(r=>r.t).join('').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim(), hasBold: runs.some(r=>r.bold&&r.t.trim()) };
  }).filter(p=>p.text);
  const questions=[]; let cur=null;
  const optRe=/^([A-Da-d])\s*[.)]\s*(.*)$/, qRe=/^(?:Câu|Cau)?\s*\d+\s*[.)]\s*(.*)$/i;
  for(const p of paras){
    const om=p.text.match(optRe);
    if (om && cur){ const idx='ABCD'.indexOf(om[1].toUpperCase()); cur.answers[idx]=om[2].trim(); if(p.hasBold) cur.correct=idx; continue; }
    const qm=p.text.match(qRe);
    if (qm && !om){ if(cur) questions.push(cur); cur={text:qm[1].trim(),type:'quiz',answers:['','','',''],correct:0,time:20,points:1000,media:null,_boldFound:false}; continue; }
    if (cur && !om){ cur.text += (cur.text?' ':'')+p.text; }
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
      $('#iprev').innerHTML=`<p class="big">Đọc được ${qs.length} câu hỏi</p>${qs.map((q,i)=>`<p class="small">Câu ${i+1}: ${esc(q.text)}<br>${q.answers.map((a,j)=>`${SHAPES[j]} ${esc(a)}${j===q.correct?' <b>✔ đáp án đúng</b>':''}`).join('<br>')}</p>`).join('')}
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
  return s.docs.map(d=>({id:d.id,...d.data()})).filter(k=>k.status==='ready').sort((a,b)=>(a.lastUsedAt||0)-(b.lastUsedAt||0));
}
async function markKey(id, patch){ if(!DEMO) await F.updateDoc(F.doc(db,'apiKeys',id), patch); }
async function callGemini(parts, key){
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='+encodeURIComponent(key), {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ contents:[{parts}], generationConfig:{ responseMimeType:'application/json', temperature:0.7 } }) });
  const j = await r.json().catch(()=>({}));
  if (!r.ok){ const err=new Error(j?.error?.message||('HTTP '+r.status)); err.status=r.status; throw err; }
  return j?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
}
// Thử lần lượt: key người dùng vừa nhập (nếu có) -> các key sẵn sàng trong kho (nếu được quyền dùng key hệ thống), xoay vòng khi hết hạn mức/lỗi
async function generateWithRotation(parts, ownKey){
  const candidates = [];
  if (ownKey){ const id = await addKeyToPool(ownKey, me?.email); candidates.push({id, key:ownKey, own:true}); }
  if (can('systemKeys') || me?.role==='admin'){ (await poolKeys()).forEach(k=>{ if(!candidates.some(c=>c.key===k.key)) candidates.push({id:k.id, key:k.key}); }); }
  if (!candidates.length) throw new Error('Chưa có API key khả dụng. Thầy/cô nhập API key Gemini của mình, hoặc nhờ admin cấp quyền “Dùng API key hệ thống”.');
  let lastErr = null;
  for (const c of candidates){
    try{ const text = await callGemini(parts, c.key); if (c.id) await markKey(c.id, { status:'ready', lastUsedAt: Date.now(), lastError:'' }); return text; }
    catch(e){ lastErr = e; const quota = e.status===429 || /quota|rate|RESOURCE_EXHAUSTED/i.test(e.message||'');
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
    return { parts:[{ inlineData:{ mimeType:file.type, data:b64 } }], note:' (có ảnh đính kèm)' }; }
  if (ext==='pdf'){ try{ const buf=await file.arrayBuffer(); const pdf=await window.pdfjsLib.getDocument({data:buf}).promise; let txt='';
      for(let i=1;i<=Math.min(pdf.numPages,20);i++){ const pg=await pdf.getPage(i); const tc=await pg.getTextContent(); txt+=tc.items.map(x=>x.str).join(' ')+'\n'; }
      return { parts:[{text:'Tài liệu tham khảo (trích từ PDF):\n'+txt.slice(0,15000)}], note:' (có tài liệu PDF)' };
    }catch{ const b64=await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
      return { parts:[{ inlineData:{ mimeType:'application/pdf', data:b64 } }], note:' (có PDF đính kèm)' }; } }
  if (ext==='docx'){ const zip=await window.JSZip.loadAsync(file); const xml=await zip.file('word/document.xml').async('string');
    const txt=[...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map(m=>[...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x=>x[1]).join('')).join('\n');
    return { parts:[{text:'Tài liệu tham khảo (trích từ Word):\n'+txt.slice(0,15000)}], note:' (có tài liệu Word)' }; }
  return { parts:[], note:'' };
}

// ---------- Tạo đề bằng AI ----------
function renderAI(){
  app.innerHTML=`<div class="card"><h1>🤖 Tạo đề bằng AI (Google Gemini)</h1>
  <input id="aiTopic" placeholder="Chủ đề, ví dụ: Ôn tập phân số lớp 5, Bài 12 Sinh học 10...">
  <div class="row"><label class="small">Số câu <input id="aiCount" type="number" value="10" min="1" max="40" style="width:90px"></label>
  <label class="small">Mức độ <select id="aiLevel" style="width:auto"><option>Dễ</option><option selected>Trung bình</option><option>Khó</option><option>Hỗn hợp</option></select></label>
  <label class="small">Thời gian/câu <select id="aiTime" style="width:auto">${[10,20,30,60].map(t=>`<option ${t===20?'selected':''} value="${t}">${t} giây</option>`).join('')}</select></label></div>
  <label class="small"><b>Tài liệu tham khảo (không bắt buộc):</b> PDF, Word (.docx) hoặc ảnh. Có thể bấm Ctrl+V để dán ảnh chụp màn hình vào khung dưới. File chỉ dùng để tạo câu hỏi trong lần này, <b>không lưu vào hệ thống</b> để tránh tốn lưu lượng.</label>
  <input type="file" id="aiFile" accept=".pdf,.docx,image/*">
  <div id="aiPaste" contenteditable="true" style="border:2px dashed #bbb;border-radius:10px;padding:14px;min-height:56px;background:#fff">Bấm vào đây rồi nhấn Ctrl+V để dán ảnh chụp màn hình…</div>
  <div id="aiPastePrev"></div>
  <label class="small"><b>API key Gemini của thầy/cô</b> (lấy miễn phí tại Google AI Studio — aistudio.google.com/apikey)${can('systemKeys')||me?.role==='admin'?' — hoặc để trống để dùng kho key hệ thống':''}:</label>
  <input id="aiKey" type="password" placeholder="AIza..." autocomplete="off">
  <div class="notice small">🔑 <b>Minh bạch về API key:</b> key thầy/cô nhập sẽ được <b>lưu vào kho API key chung của hệ thống</b> do admin quản lý (xem ở Quản trị → API key), để các thành viên được admin cấp quyền “Dùng API key hệ thống” có thể dùng chung. Hệ thống tự xoay vòng sang key khác khi một key hết hạn mức hoặc bị lỗi. Nếu không đồng ý, thầy/cô đừng nhập key.</div>
  <button class="btn green" id="doAI">✨ Tạo câu hỏi bằng AI</button> <span id="aiStatus" class="small"></span>
  <div id="aiResult" style="margin-top:14px"></div></div>`;
  let pastedImage = null;
  $('#aiPaste').addEventListener('paste', e=>{ const item=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/')); if(item){ e.preventDefault(); pastedImage=item.getAsFile(); $('#aiPastePrev').innerHTML='<p class="small">Đã nhận ảnh dán vào ✔</p>'; } });
  $('#doAI').onclick=async()=>{
    const topic=$('#aiTopic').value.trim(); if(!topic) return alert('Thầy/cô nhập chủ đề trước nhé!');
    const count=Math.max(1,Math.min(40,+$('#aiCount').value||10)), ownKey=$('#aiKey').value.trim();
    $('#aiStatus').textContent='Đang tạo câu hỏi, thầy/cô chờ một chút…';
    try{
      const file = pastedImage || $('#aiFile').files[0];
      const extra = await extractFileForAI(file);
      const prompt=`Hãy tạo đúng ${count} câu hỏi trắc nghiệm 4 phương án bằng TIẾNG VIỆT về chủ đề: "${topic}". Mức độ: ${$('#aiLevel').value}.
Mỗi câu có đúng 1 đáp án đúng. Được dùng công thức dạng $...$ (LaTeX) và hóa học $\\ce{...}$ khi cần.
Chỉ trả về JSON thuần (không markdown) dạng: {"questions":[{"text":"...","answers":["...","...","...","..."],"correct":0}]}
correct là vị trí đáp án đúng từ 0 đến 3, hãy xáo trộn vị trí đáp án đúng giữa các câu.`;
      const parts=[{text:prompt}, ...extra.parts];
      const raw = await generateWithRotation(parts, ownKey);
      const parsed = JSON.parse(raw.replace(/```json|```/g,'').trim());
      const qs = (parsed.questions||[]).map(q=>({ text:String(q.text||''), type:'quiz', answers:(q.answers||[]).slice(0,4).map(String), correct:Math.min(3,Math.max(0,+q.correct||0)), time:+$('#aiTime').value, points:1000, media:null })).filter(q=>q.text&&q.answers.length===4);
      if(!qs.length) throw new Error('AI trả về không đúng định dạng. Thầy/cô thử lại nhé!');
      $('#aiStatus').textContent=`Đã tạo ${qs.length} câu${extra.note}.`;
      $('#aiResult').innerHTML=`${qs.map((q,i)=>`<p class="small">Câu ${i+1}: ${esc(q.text)}<br>${q.answers.map((a,j)=>`${SHAPES[j]} ${esc(a)}${j===q.correct?' <b>✔</b>':''}`).join('<br>')}</p>`).join('')}
      <div class="row"><button class="btn green" id="aiSave">💾 Lưu vào thư viện</button><button class="btn light" id="aiEdit">Mở trong trình tạo để sửa</button></div>`;
      $('#aiSave').onclick=async()=>{ const chk=await checkQuizLimits(qs.length); if(chk!==true) return alert(chk);
        await store.createQuiz({title:topic,subject:'Tạo bằng AI',questions:qs,ownerUid:me.uid,ownerEmail:me.email}); alert('Đã lưu vào thư viện!'); renderLibrary(); };
      $('#aiEdit').onclick=()=>renderCreate(qs, topic, 'Tạo bằng AI');
    }catch(e){ $('#aiStatus').textContent=''; alert('Tạo đề chưa được: '+e.message); }
  };
}

// ---------- Lớp học ----------
async function renderClasses(){
  const all=await store.listClasses();
  const mine = me?.role==='admin' ? all : all.filter(c=>c.ownerUid===me?.uid);
  app.innerHTML=`<div class="card"><h1>🏫 Lớp học của tôi</h1><p class="small">Gói ${esc(myPlan().name)}${limit('maxClasses')?` • Tối đa ${limit('maxClasses')} lớp`:''}${limit('maxMembersPerClass')?` • Tối đa ${limit('maxMembersPerClass')} thành viên/lớp`:''}</p>
  <div class="row"><input class="grow" id="clsName" placeholder="Tên lớp mới, ví dụ: 5A1"><button class="btn green" id="addCls">+ Tạo lớp</button></div>
  ${mine.map(c=>`<div class="card" style="background:#fafafa"><b>${esc(c.name)}</b> <span class="small">(${(c.members||[]).length} thành viên)</span>
    <div>${(c.members||[]).map((m,i)=>`<span class="player" style="background:#666">${esc(m)} <a href="#" data-rm="${c.id}:${i}" style="color:#fff">✕</a></span>`).join('')}</div>
    <div class="row"><input class="grow" data-member="${c.id}" placeholder="Tên học sinh / thành viên mới"><button class="btn light" data-addm="${c.id}">+ Thêm thành viên</button>
    <button class="btn red" data-delcls="${c.id}">Xoá lớp</button></div></div>`).join('')||'<p class="small">Chưa có lớp nào.</p>'}</div>`;
  $('#addCls').onclick=async()=>{ const name=$('#clsName').value.trim(); if(!name) return alert('Thầy nhập tên lớp nhé!');
    const limC=limit('maxClasses'); if(limC>0&&mine.length>=limC) return alert(`Gói ${myPlan().name} tối đa ${limC} lớp.`);
    await store.saveClass({name,ownerUid:me.uid,ownerEmail:me.email,members:[]}); renderClasses(); };
  app.querySelectorAll('[data-addm]').forEach(b=>b.onclick=async()=>{ const c=mine.find(x=>x.id===b.dataset.addm); const inp=app.querySelector(`[data-member="${c.id}"]`); const v=inp.value.trim(); if(!v) return;
    const limM=limit('maxMembersPerClass'); if(limM>0&&(c.members||[]).length>=limM) return alert(`Gói ${myPlan().name} tối đa ${limM} thành viên / lớp.`);
    c.members=[...(c.members||[]),v]; await store.saveClass(c); renderClasses(); });
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
  </div><div id="tabBody" style="margin-top:14px"></div></div>`;
  app.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>renderAdmin(b.dataset.tab));
  ({members:renderAdminMembers, keys:renderAdminKeys, plans:renderAdminPlans})[tab]($('#tabBody'));
}
async function renderAdminMembers(box){
  if (DEMO){ box.innerHTML='<p>Bản demo chưa nối Firebase.</p>'; return; }
  const snap=await F.getDocs(F.query(F.collection(db,'users'),F.orderBy('createdAt','asc')));
  const users=snap.docs.map(d=>({uid:d.id,...d.data()}));
  const statusTxt={pending:'⏳ Chờ duyệt',approved:'✅ Đang hoạt động',blocked:'🚫 Đã chặn'};
  box.innerHTML=`<p class="small">${users.length} thành viên • Bấm ↕ trên đầu cột để sắp xếp • Bấm số thiết bị để xem tên thiết bị + IP.</p>
  <div style="overflow-x:auto"><table class="sortable"><tr><th>Thành viên</th><th>Trạng thái</th><th>Gói</th><th>Chức năng được dùng</th><th>Hạn sử dụng</th><th>Thiết bị</th><th data-nosort>Thao tác</th></tr>
  ${users.map(u=>`<tr>
    <td><b>${esc(u.displayName||'(chưa có tên)')}</b><br><span class="small">${esc(u.email)}${u.role==='admin'?' • 👑 Admin':''}<br>Đăng ký: ${fmtDate(u.createdAt)}</span></td>
    <td>${statusTxt[u.status]||esc(u.status)}</td>
    <td><b>${esc((plans[u.plan||'free']?.name)||'Free')}</b></td>
    <td>${FEATURES.map(([k,label])=>`<span class="badge" style="${!can2(u,k)?'opacity:.4;text-decoration:line-through':''}">${label}</span>`).join(' ')}</td>
    <td data-sort="${u.expiresAt||9999999999999}">${fmtDate(u.expiresAt)}${u.expiresAt&&Date.now()>u.expiresAt?' <b style="color:#e21b3c">(hết hạn)</b>':''}</td>
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
  box.querySelectorAll('[data-devices]').forEach(b=>b.onclick=async()=>{ const uid=b.dataset.devices, dv=box.querySelector(`[data-devlist="${uid}"]`);
    if(dv.innerHTML){ dv.innerHTML=''; return; } const ds=await F.getDocs(F.collection(db,'users',uid,'devices'));
    dv.innerHTML = ds.empty?'<p class="small">Chưa có thiết bị nào đăng nhập.</p>':ds.docs.map(d=>{ const v=d.data(); return `<p class="small" style="text-align:left">• <b>${esc(v.name)}</b><br>IP: ${esc(v.ip)}<br>Lần cuối: ${fmtDT(v.lastLoginAt)}</p>`; }).join(''); });
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
      <b class="small">Chức năng được sử dụng (quyền cá nhân, kết hợp với gói):</b><br>
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
  const badge={ready:'<span class="badge" style="background:#26890c;color:#fff">🟢 Sẵn sàng</span>', quota:'<span class="badge" style="background:#ffc00a">🟡 Hết hạn mức</span>', error:'<span class="badge" style="background:#e21b3c;color:#fff">🔴 Lỗi</span>'};
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
async function renderAdminPlans(box){
  await loadPlans();
  box.innerHTML=`<p class="small">Cài đặt 3 gói thành viên. Người dùng được duyệt sẽ tự dùng gói <b>Free</b>; admin gán gói khác trong tab Thành viên → Sửa. Nhập <b>0 = không giới hạn</b> ở các ô số lượng.</p>
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
  stopListen(); let players=[], session=null, timer=null;
  app.innerHTML=`<div class="card center"><h2>📺 Phòng chờ — chiếu màn hình này cho lớp xem</h2><p>Vào EduQuiz • Nhập mã PIN:</p><div class="pinbox">${pin}</div>
  <p id="pcount" class="big">Đang chờ học sinh…</p><div id="plist"></div>
  <div class="row" style="justify-content:center;margin-top:14px"><button class="btn green" id="startBtn">▶ Bắt đầu trò chơi</button></div><div id="stage"></div></div>`;
  store.onSession(pin,s=>{ session=s; if(s) showStage(); });
  store.onPlayers(pin,ps=>{ players=ps.sort((a,b)=>(b.score||0)-(a.score||0)); const pc=$('#pcount'); if(!pc) return; pc.textContent=session?.status==='lobby'?`${ps.length} học sinh đã vào`:'Bảng điểm trực tiếp';
    $('#plist').innerHTML=ps.map(p=>`<span class="player">${esc(p.nickname)} • ${p.score||0}đ</span>`).join(''); if(session) showStage(); });
  $('#startBtn').onclick=async()=>{ await store.setSession(pin,{status:'playing',currentQuestion:0,questionStartedAt:Date.now()}); };
  function showStage(){ const s=session; if(!s||s.status==='lobby') return; const sb=$('#startBtn'); if(sb) sb.style.display='none'; const st=$('#stage'); if(!st) return; const q=s.questions[s.currentQuestion];
    if(s.status==='finished'){ st.innerHTML=podium(players)+`<button class="btn" onclick="location.reload()">Về trang chủ</button>`; enableSorting(st); return; }
    if(s.status==='leaderboard'){ st.innerHTML=leaderboard(players)+`<button class="btn green" id="nextBtn">${s.currentQuestion+1>=s.questions.length?'🏁 Kết thúc & vinh danh':'Câu tiếp theo →'}</button>`; enableSorting(st);
      $('#nextBtn').onclick=async()=>s.currentQuestion+1>=s.questions.length?store.setSession(pin,{status:'finished'}):store.setSession(pin,{status:'playing',currentQuestion:s.currentQuestion+1,questionStartedAt:Date.now()}); return; }
    if(s.status==='showing_answer'){ const counts=[0,0,0,0]; players.forEach(p=>{ const a=p.answers?.[s.currentQuestion]; if(a) counts[a.choice]++; });
      st.innerHTML=`<h2>Đáp án đúng: ${SHAPES[q.correct]} ${esc(q.answers[q.correct])}</h2>${mediaHtml(q)}<p>${counts.map((c,i)=>`${SHAPES[i]}: ${c} bạn`).join(' • ')}</p><p class="small">${players.filter(p=>p.answers?.[s.currentQuestion]?.correct).length}/${players.length} bạn trả lời đúng</p><button class="btn" id="lbBtn">Xem bảng xếp hạng →</button>`; math(st);
      $('#lbBtn').onclick=()=>store.setSession(pin,{status:'leaderboard'}); return; }
    const remain=Math.max(0,q.time-Math.floor((Date.now()-(s.questionStartedAt||Date.now()))/1000));
    st.innerHTML=`<p class="badge">Câu ${s.currentQuestion+1}/${s.questions.length}</p><h2>${esc(q.text)}</h2>${mediaHtml(q)}<div class="timer"><i style="width:${remain/q.time*100}%"></i></div><p class="small">Còn ${remain} giây • ${players.filter(p=>p.answers?.[s.currentQuestion]).length}/${players.length} bạn đã trả lời</p>
    <div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,i)=>`<button class="ans ${COLORS[i]}"><span class="shape">${SHAPES[i]}</span>${esc(a)}</button>`).join('')}</div>
    <div class="row" style="margin-top:14px;justify-content:center"><button class="btn red" id="showAns">Hiện đáp án</button></div>`; math(st);
    $('#showAns').onclick=()=>store.setSession(pin,{status:'showing_answer'});
    clearInterval(timer); timer=setInterval(()=>{ const r=Math.max(0,q.time-Math.floor((Date.now()-(s.questionStartedAt||Date.now()))/1000)); if(r<=0){ clearInterval(timer); store.setSession(pin,{status:'showing_answer'}); } },1000);
  }
}
function renderPlayer(pin, playerId){
  stopListen(); let answeredFor=-1;
  app.innerHTML=`<div class="card center" id="pstage"><h2>Đã vào phòng!</h2><p>Nhìn lên màn hình của thầy/cô và chờ câu hỏi nhé…</p></div>`;
  store.onSession(pin,s=>{ if(!s) return; const st=$('#pstage'); if(!st) return;
    if(s.status==='lobby'){ st.innerHTML=`<h2>✅ Đã vào phòng chờ</h2><p>Chờ thầy/cô bấm Bắt đầu…</p>`; return; }
    if(s.status==='finished'){ store.listPlayers(pin).then(ps=>{ const m=ps.find(p=>p.id===playerId); const rank=ps.sort((a,b)=>b.score-a.score).findIndex(p=>p.id===playerId)+1; st.innerHTML=`<h2>🏁 Trò chơi kết thúc!</h2><p class="big">Em xếp hạng ${rank} • ${m?.score||0} điểm</p>`+podium(ps); enableSorting(st); }); return; }
    if(s.status==='leaderboard'||s.status==='showing_answer'){ store.listPlayers(pin).then(ps=>{ const m=ps.find(p=>p.id===playerId); const a=m?.answers?.[s.currentQuestion];
      st.innerHTML = s.status==='showing_answer' ? (a?(a.correct?`<h2>🎉 Đúng rồi! +${a.points} điểm</h2>`:`<h2>Chưa đúng rồi, cố lên câu sau nhé!</h2>`):`<h2>Hết giờ! Em chưa trả lời câu này.</h2>`) : leaderboard(ps,playerId); enableSorting(st); }); return; }
    const q=s.questions[s.currentQuestion]; if(answeredFor===s.currentQuestion){ st.innerHTML=`<h2>✔ Đã trả lời!</h2><p>Chờ các bạn khác…</p>`; return; }
    st.innerHTML=`<p class="badge">Câu ${s.currentQuestion+1}/${s.questions.length} • ${q.time} giây</p><h2>${esc(q.text)}</h2>${mediaHtml(q)}<div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,i)=>`<button class="ans ${COLORS[i]}" data-a="${i}"><span class="shape">${SHAPES[i]}</span>${esc(a)}</button>`).join('')}</div>`; math(st);
    st.querySelectorAll('[data-a]').forEach(b=>b.onclick=async()=>{ const choice=+b.dataset.a; const elapsed=Date.now()-(s.questionStartedAt||Date.now());
      const correct=choice===q.correct; const points=correct?Math.round(q.points*(1-Math.min(elapsed/(q.time*1000),1)/2)):0;
      answeredFor=s.currentQuestion; await store.answer(pin,playerId,s.currentQuestion,choice,points,correct); st.innerHTML=`<h2>✔ Đã trả lời!</h2><p>Chờ các bạn khác…</p>`; });
  });
}
async function renderPractice(quiz){ let i=0, score=0; const step=()=>{ if(i>=quiz.questions.length){ app.innerHTML=`<div class="card center"><h1>🏁 Hoàn thành!</h1><p class="big">Điểm của em: ${score}</p><button class="btn" onclick="location.reload()">Về trang chủ</button></div>`; return; }
  const q=quiz.questions[i]; app.innerHTML=`<div class="card"><p class="badge">Câu ${i+1}/${quiz.questions.length}</p><h2>${esc(q.text)}</h2>${mediaHtml(q)}<div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,j)=>`<button class="ans ${COLORS[j]}" data-a="${j}"><span class="shape">${SHAPES[j]}</span>${esc(a)}</button>`).join('')}</div></div>`; math(app);
  app.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ if(+b.dataset.a===q.correct){ score+=q.points; alert('🎉 Đúng rồi!'); } else alert('Chưa đúng. Đáp án đúng là: '+q.answers[q.correct]); i++; step(); }); }; step(); }
async function renderReports(){ const qs=(await store.listQuizzes()).filter(q=>me?.role==='admin'||!q.ownerUid||q.ownerUid===me?.uid);
  app.innerHTML=`<div class="card"><h1>📊 Báo cáo</h1><p class="small">Chi tiết từng buổi chơi lưu trong Firestore, collection <b>sessions</b>.</p>
  <table class="sortable"><tr><th>Bộ câu hỏi</th><th>Môn / chủ đề</th><th>Số câu</th><th>Chủ sở hữu</th></tr>
  ${qs.map(q=>`<tr><td>${esc(q.title)}</td><td>${esc(q.subject||'')}</td><td data-sort="${q.questions.length}">${q.questions.length}</td><td>${esc(q.ownerEmail||'')}</td></tr>`).join('')}</table></div>`; enableSorting(app); }
const leaderboard=(ps,m)=>`<h2>🏆 Bảng xếp hạng</h2><table class="sortable"><tr><th>Hạng</th><th>Người chơi</th><th>Điểm</th></tr>${ps.slice(0,10).map((p,i)=>`<tr ${m&&p.id===m?'style="background:#fff3cd;font-weight:800"':''}><td data-sort="${i+1}">${i+1}</td><td>${esc(p.nickname)} ${p.streak>=3?'🔥':''}</td><td data-sort="${p.score||0}">${p.score||0} điểm</td></tr>`).join('')}</table>`;
const podium=ps=>{ const t=[ps[1],ps[0],ps[2]].filter(Boolean); return `<h2>👑 Bục vinh quang</h2><div class="podium">${t.map(p=>`<div class="pod"><div>${esc(p.nickname)}</div><div class="bar">${p.score||0}đ</div></div>`).join('')}</div>`+leaderboard(ps); };

init();
