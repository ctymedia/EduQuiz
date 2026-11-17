// EduQuiz — Đồng bộ realtime qua Firebase Firestore + Đăng nhập Firebase Auth
// Dữ liệu:
//  quizzes/{id}                 : bộ câu hỏi (ownerUid = giáo viên sở hữu)
//  sessions/{pin}               : phiên chơi; sessions/{pin}/players/{id}: người chơi
//  users/{uid}                  : hồ sơ thành viên {email, displayName, role, status, features, expiresAt}
//  users/{uid}/devices/{devId}  : thiết bị đã đăng nhập {name, ip, lastLoginAt}
// Quy trình: Đăng ký -> status='pending' -> Admin duyệt -> status='approved' mới đăng nhập được.
// Admin đầu tiên: email trong ADMIN_EMAILS, hoặc tài khoản đăng ký đầu tiên khi chưa có admin nào.
import { firebaseConfig, isConfigured } from './firebase-config.js';

const ADMIN_EMAILS = ['ctymedialab@gmail.com'];
const FEATURES = [
  ['library','Thư viện của tôi'], ['create','Tạo bộ câu hỏi'], ['host','Tổ chức chơi trực tiếp'],
  ['practice','Tự luyện tập'], ['reports','Báo cáo']
];
const defaultFeatures = () => Object.fromEntries(FEATURES.map(([k])=>[k,true]));

const $ = s => document.querySelector(s);
const app = $('#app');
const COLORS = ['a0','a1','a2','a3'], SHAPES = ['▲','◆','●','■'];
let db = null, F = null, A = null, auth = null, DEMO = !isConfigured();
let unsubs = [], me = null; // me = hồ sơ users/{uid} của người đang đăng nhập

// ---------- Khởi tạo ----------
async function init(){
  if (DEMO){ $('#syncStatus').textContent = '⚠️ Chế độ demo (chưa nối Firebase)'; me = {uid:'demo', email:'demo@eduquiz.local', displayName:'Giáo viên demo', role:'admin', status:'approved', features:defaultFeatures(), expiresAt:null}; paintAuth(); renderHome(); return; }
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  A = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const fbApp = initializeApp(firebaseConfig);
  db = F.getFirestore(fbApp); auth = A.getAuth(fbApp);
  $('#syncStatus').textContent = '☁️ Đã nối Firebase — đồng bộ mọi thiết bị';
  A.onAuthStateChanged(auth, async user => {
    if (!user){ me = null; paintAuth(); renderHome(); return; }
    const snap = await F.getDoc(F.doc(db,'users',user.uid));
    if (!snap.exists()){ await A.signOut(auth); me=null; paintAuth(); alert('Tài khoản này chưa có hồ sơ hoặc đã bị xoá bởi admin. Vui lòng đăng ký lại và chờ phê duyệt.'); renderHome(); return; }
    me = { uid:user.uid, ...snap.data() };
    const chk = checkAccess(me);
    if (chk !== true){ await A.signOut(auth); me=null; paintAuth(); alert(chk); renderHome(); return; }
    await F.updateDoc(F.doc(db,'users',user.uid), { lastLoginAt: Date.now() });
    await registerDevice(me.uid);
    paintAuth(); renderHome();
  });
  renderHome();
}
function checkAccess(p){
  if (p.status === 'pending') return 'Tài khoản của thầy/cô đang chờ admin phê duyệt. Vui lòng liên hệ admin để được duyệt trước khi đăng nhập.';
  if (p.status === 'blocked') return 'Tài khoản của thầy/cô đã bị chặn. Vui lòng liên hệ admin.';
  if (p.expiresAt && Date.now() > p.expiresAt) return 'Tài khoản của thầy/cô đã hết hạn sử dụng. Vui lòng liên hệ admin để gia hạn.';
  return true;
}
const stopListen = () => { unsubs.forEach(u=>u&&u()); unsubs=[]; };
const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('vi-VN') : 'Không giới hạn';
const can = f => me && me.role==='admin' || me && me.features?.[f] !== false;
const requireLogin = f => {
  if (!me){ renderLogin('Thầy/cô cần đăng nhập (và được admin phê duyệt) để dùng chức năng này.'); return false; }
  if (f && !can(f)){ alert('Tài khoản của thầy/cô chưa được admin cấp quyền dùng chức năng này.'); return false; }
  return true;
};

// ---------- Thiết bị đăng nhập ----------
function deviceName(){
  const ua = navigator.userAgent; let os='Thiết bị khác', br='';
  if (/Android/i.test(ua)) os='Điện thoại/máy tính bảng Android'; else if (/iPhone/i.test(ua)) os='iPhone'; else if (/iPad/i.test(ua)) os='iPad';
  else if (/Windows/i.test(ua)) os='Máy tính Windows'; else if (/Macintosh|Mac OS/i.test(ua)) os='Máy Mac'; else if (/Linux/i.test(ua)) os='Máy tính Linux';
  if (/Edg\//.test(ua)) br=' • Edge'; else if (/Chrome\//.test(ua)) br=' • Chrome'; else if (/Firefox\//.test(ua)) br=' • Firefox'; else if (/Safari\//.test(ua)) br=' • Safari';
  return os+br;
}
async function getIP(){
  try{ const ctl=new AbortController(); setTimeout(()=>ctl.abort(),3000);
    const r=await fetch('https://api.ipify.org?format=json',{signal:ctl.signal}); const j=await r.json(); return j.ip||'Không rõ';
  }catch{ return 'Không rõ'; }
}
async function registerDevice(uid){
  let id = localStorage.getItem('eq_device_id');
  if (!id){ id='dev'+Date.now()+Math.floor(Math.random()*99999); localStorage.setItem('eq_device_id', id); }
  const ref = F.doc(db,'users',uid,'devices',id);
  const old = await F.getDoc(ref);
  await F.setDoc(ref, { name:deviceName(), ip:await getIP(), userAgent:navigator.userAgent,
    firstLoginAt: old.exists()? old.data().firstLoginAt : Date.now(), lastLoginAt: Date.now() });
}

// ---------- Thanh tài khoản + điều hướng ----------
function paintAuth(){
  const el = $('#authArea'); if(!el) return;
  $('#adminBtn').style.display = me?.role==='admin' ? '' : 'none';
  el.innerHTML = me
    ? `<span>👤 ${esc(me.displayName||me.email)}${me.role==='admin'?' (Admin)':''}</span> <button id="logoutBtn">Đăng xuất</button>`
    : `<button id="loginBtn">Đăng nhập</button> <button id="regBtn">Đăng ký</button>`;
  if (me) $('#logoutBtn').onclick = async () => { stopListen(); if(!DEMO) await A.signOut(auth); me=null; paintAuth(); renderHome(); };
  else { $('#loginBtn').onclick=()=>renderLogin(); $('#regBtn').onclick=()=>renderRegister(); }
}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{ stopListen();
  const n=b.dataset.nav;
  if (n==='home') renderHome();
  else if (n==='admin'){ if(me?.role==='admin') renderAdmin(); else alert('Mục này chỉ dành cho admin.'); }
  else if (n==='library'){ if(requireLogin('library')) renderLibrary(); }
  else if (n==='create'){ if(requireLogin('create')) renderCreate(); }
  else if (n==='reports'){ if(requireLogin('reports')) renderReports(); }
});

// ---------- Đăng ký / Đăng nhập ----------
function renderRegister(msg){
  app.innerHTML=`<div class="card join"><h1>📝 Đăng ký tài khoản giáo viên</h1>
  ${msg?`<div class="notice">${esc(msg)}</div>`:''}
  <input id="rn" placeholder="Họ và tên của thầy/cô">
  <input id="re" type="email" placeholder="Email">
  <input id="rp" type="password" placeholder="Mật khẩu (ít nhất 6 ký tự)">
  <button class="btn green" style="width:100%" id="doReg">Đăng ký</button>
  <p class="small">Sau khi đăng ký, tài khoản ở trạng thái <b>chờ phê duyệt</b>. Admin duyệt xong thầy/cô mới đăng nhập được.</p>
  <p class="small">Đã có tài khoản? <a href="#" id="goLogin">Đăng nhập</a></p></div>`;
  $('#goLogin').onclick=e=>{e.preventDefault();renderLogin();};
  $('#doReg').onclick=async()=>{
    const name=$('#rn').value.trim(), email=$('#re').value.trim(), pass=$('#rp').value;
    if(!name||!email||pass.length<6) return alert('Thầy/cô nhập họ tên, email và mật khẩu ít nhất 6 ký tự nhé!');
    if (DEMO) return alert('Bản demo chưa nối Firebase nên chưa đăng ký được.');
    try{
      const cred = await A.createUserWithEmailAndPassword(auth, email, pass);
      const admins = await F.getDocs(F.query(F.collection(db,'users'), F.where('role','==','admin'), F.limit(1)));
      const isFirstAdmin = admins.empty || ADMIN_EMAILS.includes(email.toLowerCase());
      await F.setDoc(F.doc(db,'users',cred.user.uid), {
        email, displayName:name, role: isFirstAdmin?'admin':'teacher',
        status: isFirstAdmin?'approved':'pending', features: defaultFeatures(),
        expiresAt: isFirstAdmin? null : Date.now()+365*24*3600*1000, createdAt: Date.now(), lastLoginAt: 0 });
      await A.signOut(auth);
      renderLogin(isFirstAdmin ? 'Đăng ký thành công! Đây là tài khoản admin đầu tiên nên đã được duyệt sẵn — thầy/cô đăng nhập luôn nhé.' : 'Đăng ký thành công! Tài khoản đang chờ admin phê duyệt. Admin duyệt xong thầy/cô mới đăng nhập được.');
    }catch(e){ alert('Đăng ký chưa được: '+(e.code==='auth/email-already-in-use'?'Email này đã được đăng ký.':e.message)); }
  };
}
function renderLogin(msg){
  app.innerHTML=`<div class="card join"><h1>🔐 Đăng nhập</h1>
  ${msg?`<div class="notice">${esc(msg)}</div>`:''}
  <input id="le" type="email" placeholder="Email">
  <input id="lp" type="password" placeholder="Mật khẩu">
  <button class="btn green" style="width:100%" id="doLogin">Đăng nhập</button>
  <p class="small">Chưa có tài khoản? <a href="#" id="goReg">Đăng ký</a> (cần admin phê duyệt)</p>
  <p class="small">Học sinh không cần tài khoản — nhập mã PIN ở Trang chủ để vào chơi.</p></div>`;
  $('#goReg').onclick=e=>{e.preventDefault();renderRegister();};
  $('#doLogin').onclick=async()=>{
    const email=$('#le').value.trim(), pass=$('#lp').value;
    if(!email||!pass) return alert('Thầy/cô nhập email và mật khẩu nhé!');
    if (DEMO) return alert('Bản demo chưa nối Firebase nên chưa đăng nhập được.');
    try{ await A.signInWithEmailAndPassword(auth, email, pass); /* onAuthStateChanged sẽ kiểm tra duyệt/hạn/thiết bị */ }
    catch(e){ alert('Đăng nhập chưa được: '+( ['auth/invalid-credential','auth/wrong-password','auth/user-not-found'].includes(e.code) ? 'Sai email hoặc mật khẩu.' : e.message)); }
  };
}

// ---------- Lớp dữ liệu quiz / phiên chơi ----------
const store = {
  async createQuiz(q){ if(DEMO){ const id='q'+Date.now(); const all=JSON.parse(localStorage.getItem('eq_quizzes')||'[]'); all.push({id,...q}); localStorage.setItem('eq_quizzes',JSON.stringify(all)); return id; }
    const r = await F.addDoc(F.collection(db,'quizzes'), {...q, createdAt: F.serverTimestamp()}); return r.id; },
  async listQuizzes(){ if(DEMO) return JSON.parse(localStorage.getItem('eq_quizzes')||'[]');
    const s = await F.getDocs(F.query(F.collection(db,'quizzes'), F.orderBy('createdAt','desc'))); return s.docs.map(d=>({id:d.id,...d.data()})); },
  async getQuiz(id){ const all = await this.listQuizzes(); return all.find(q=>q.id===id); },
  async createSession(quiz){ const pin = String(Math.floor(100000+Math.random()*900000));
    const data = { quizId: quiz.id, title: quiz.title, questions: quiz.questions, status:'lobby', currentQuestion:-1, questionStartedAt:0, createdAt: Date.now(), hostUid: me?.uid||'' };
    if(DEMO){ localStorage.setItem('eq_session_'+pin, JSON.stringify(data)); localStorage.setItem('eq_players_'+pin,'[]'); }
    else await F.setDoc(F.doc(db,'sessions',pin), {...data, createdAt: F.serverTimestamp()});
    return pin; },
  async getSession(pin){ if(DEMO){ const v=localStorage.getItem('eq_session_'+pin); return v?JSON.parse(v):null; }
    const s = await F.getDoc(F.doc(db,'sessions',pin)); return s.exists()? s.data(): null; },
  async setSession(pin, patch){ if(DEMO){ const cur=await this.getSession(pin); localStorage.setItem('eq_session_'+pin, JSON.stringify({...cur,...patch})); window.dispatchEvent(new Event('eq-change')); }
    else await F.updateDoc(F.doc(db,'sessions',pin), patch); },
  async join(pin, nickname){ const id = 'p'+Date.now()+Math.floor(Math.random()*999);
    const p = { nickname, score:0, streak:0, answers:{}, joinedAt: Date.now() };
    if(DEMO){ const arr=JSON.parse(localStorage.getItem('eq_players_'+pin)||'[]'); arr.push({id,...p}); localStorage.setItem('eq_players_'+pin, JSON.stringify(arr)); window.dispatchEvent(new Event('eq-change')); }
    else await F.setDoc(F.doc(db,'sessions',pin,'players',id), p);
    return id; },
  async listPlayers(pin){ if(DEMO) return JSON.parse(localStorage.getItem('eq_players_'+pin)||'[]');
    const s = await F.getDocs(F.collection(db,'sessions',pin,'players')); return s.docs.map(d=>({id:d.id,...d.data()})); },
  async answer(pin, playerId, qIdx, choice, points, correct){
    if(DEMO){ const arr=await this.listPlayers(pin); const p=arr.find(x=>x.id===playerId); if(!p||p.answers[qIdx])return; p.answers[qIdx]={choice,points,correct}; p.score+=points; p.streak=correct?p.streak+1:0; localStorage.setItem('eq_players_'+pin,JSON.stringify(arr)); window.dispatchEvent(new Event('eq-change')); }
    else { const ref=F.doc(db,'sessions',pin,'players',playerId); const s=await F.getDoc(ref); if(!s.exists()||s.data().answers?.[qIdx])return; const d=s.data();
      await F.updateDoc(ref, { score:(d.score||0)+points, streak: correct?(d.streak||0)+1:0, [`answers.${qIdx}`]:{choice,points,correct} }); } },
  onSession(pin, cb){ if(DEMO){ window.addEventListener('eq-change', async()=>cb(await this.getSession(pin))); cb(this.getSession(pin)); }
    else unsubs.push(F.onSnapshot(F.doc(db,'sessions',pin), async s=>cb(s.exists()?s.data():null))); },
  onPlayers(pin, cb){ if(DEMO){ window.addEventListener('eq-change', async()=>cb(await this.listPlayers(pin))); this.listPlayers(pin).then(cb); }
    else unsubs.push(F.onSnapshot(F.collection(db,'sessions',pin,'players'), s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))))); },
};

// ---------- Trang chủ: học sinh vào bằng PIN (không cần tài khoản) ----------
function renderHome(){
  app.innerHTML = `${DEMO?'<div class="notice"><b>Đang ở chế độ demo.</b> Điền cấu hình vào firebase-config.js thì mới đăng ký/đăng nhập và chơi chung nhiều máy được.</div>':''}
  <div class="card join"><h1>Tham gia trò chơi</h1><p class="small">Học sinh nhập mã PIN do giáo viên cung cấp — không cần tài khoản</p>
  <input id="pin" inputmode="numeric" maxlength="6" placeholder="Mã PIN 6 số" style="text-align:center;font-size:22px;font-weight:800">
  <input id="nick" placeholder="Tên của em (biệt danh)">
  <button class="btn green" style="width:100%" id="joinBtn">Vào chơi →</button></div>
  <div class="card center"><h2>Thầy/cô tổ chức trò chơi?</h2><p class="small">${me?`Đang đăng nhập: <b>${esc(me.displayName||me.email)}</b> • Hạn dùng: ${fmtDate(me.expiresAt)}`:'Đăng nhập để tạo thư viện và kho câu hỏi riêng của mình. Chưa có tài khoản thì Đăng ký — admin phê duyệt xong mới đăng nhập được.'}</p>
  <button class="btn" onclick="document.querySelector('[data-nav=library]').click()">Mở thư viện của tôi →</button></div>`;
  $('#joinBtn').onclick = async () => { const pin=$('#pin').value.trim(), nick=$('#nick').value.trim();
    if(pin.length!==6||!nick) return alert('Em nhập đủ mã PIN 6 số và tên nhé!');
    const s = await store.getSession(pin); if(!s) return alert('Không tìm thấy phòng chơi này. Em kiểm tra lại mã PIN nhé!');
    const pid = await store.join(pin, nick); renderPlayer(pin, pid); };
}

// ---------- Thư viện riêng + Tạo quiz ----------
async function renderLibrary(){
  const all = await store.listQuizzes();
  const qs = me?.role==='admin' ? all : all.filter(q=>!q.ownerUid || q.ownerUid===me?.uid);
  app.innerHTML = `<div class="card"><h1>📚 Thư viện của tôi</h1><p class="small">Chỉ hiện các bộ câu hỏi của ${me?.role==='admin'?'tất cả thành viên (admin)':'chính thầy/cô'}.</p>${qs.length? '' : '<p class="small">Chưa có bộ câu hỏi nào. Bấm “+ Tạo bộ câu hỏi” để tạo bộ đầu tiên.</p>'}
  ${qs.map(q=>`<div class="row" style="border-bottom:1px solid #eee;padding:10px 0"><div class="grow"><b>${esc(q.title)}</b><br><span class="small">${esc(q.subject||'')} • ${q.questions.length} câu hỏi${q.ownerEmail?` • của ${esc(q.ownerEmail)}`:''}</span></div>
  <button class="btn green" data-host="${q.id}" ${can('host')?'':'disabled title="Chưa được cấp quyền tổ chức"'}>▶ Tổ chức</button> <button class="btn light" data-practice="${q.id}">Tự luyện tập</button></div>`).join('')}</div>`;
  app.querySelectorAll('[data-host]').forEach(b=>b.onclick=async()=>{ const q=await store.getQuiz(b.dataset.host); const pin=await store.createSession(q); renderHost(pin); });
  app.querySelectorAll('[data-practice]').forEach(b=>b.onclick=async()=>{ if(requireLogin('practice')) renderPractice(await store.getQuiz(b.dataset.practice)); });
}
function renderCreate(edit){
  let questions = edit?.questions ? structuredClone(edit.questions) : [{text:'',type:'quiz',answers:['','','',''],correct:0,time:20,points:1000}];
  const draw=()=>{ app.innerHTML=`<div class="card"><h1>✏️ Tạo bộ câu hỏi</h1>
    <input id="qt" placeholder="Tiêu đề bộ câu hỏi, ví dụ: Ôn tập Toán lớp 5" value="${esc(edit?.title||'')}">
    <input id="qs" placeholder="Môn học / chủ đề" value="${esc(edit?.subject||'')}">
    <div id="qlist"></div>
    <div class="row"><button class="btn light" id="addQ">+ Thêm câu hỏi</button><button class="btn green grow" id="saveQ">💾 Lưu vào thư viện của tôi</button></div></div>`;
    $('#qlist').innerHTML = questions.map((q,i)=>`<div class="card" style="background:#fafafa"><b>Câu ${i+1}</b>
      <input data-q="${i}" data-f="text" placeholder="Nội dung câu hỏi" value="${esc(q.text)}">
      <div class="row"><select data-q="${i}" data-f="type"><option value="quiz" ${q.type==='quiz'?'selected':''}>Trắc nghiệm</option><option value="tf" ${q.type==='tf'?'selected':''}>Đúng / Sai</option></select>
      <select data-q="${i}" data-f="time">${[5,10,20,30,60,90,120].map(t=>`<option ${q.time===t?'selected':''} value="${t}">${t} giây</option>`).join('')}</select>
      <select data-q="${i}" data-f="points">${[0,500,1000,2000].map(p=>`<option ${q.points===p?'selected':''} value="${p}">${p===0?'Không tính điểm':p+' điểm'+(p===2000?' (nhân đôi)':'')}</option>`).join('')}</select></div>
      ${q.type==='tf'? `<div class="row"><button class="btn ${q.correct===0?'green':'light'}" data-tf="${i}" data-v="0">✔ Đúng là đáp án đúng</button><button class="btn ${q.correct===1?'green':'light'}" data-tf="${i}" data-v="1">✖ Sai là đáp án đúng</button></div>`
      : q.answers.map((a,j)=>`<div class="row"><span class="shape" style="color:#46178f">${SHAPES[j]}</span><input class="grow" data-q="${i}" data-a="${j}" placeholder="Phương án ${j+1}" value="${esc(a)}"><label><input type="radio" name="c${i}" data-q="${i}" data-c="${j}" ${q.correct===j?'checked':''} style="width:auto"> Đúng</label></div>`).join('')}
      <button class="btn red" data-del="${i}">Xoá câu này</button></div>`).join('');
    app.querySelectorAll('input,select').forEach(el=>el.onchange=sync);
    app.querySelectorAll('[data-tf]').forEach(b=>b.onclick=()=>{ sync(); questions[+b.dataset.tf].correct=+b.dataset.v; draw(); });
    app.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ sync(); questions.splice(+b.dataset.del,1); draw(); });
    $('#addQ').onclick=()=>{ sync(); questions.push({text:'',type:'quiz',answers:['','','',''],correct:0,time:20,points:1000}); draw(); };
    $('#saveQ').onclick=async()=>{ sync(); const title=$('#qt').value.trim(); if(!title||questions.some(q=>!q.text.trim())) return alert('Thầy điền tiêu đề và nội dung cho mọi câu hỏi nhé!');
      questions.forEach(q=>{ if(q.type==='tf'){ q.answers=['Đúng','Sai']; } q.time=+q.time; q.points=+q.points; });
      await store.createQuiz({title, subject:$('#qs').value.trim(), questions, ownerUid: me?.uid||'', ownerEmail: me?.email||''}); alert('Đã lưu vào thư viện của thầy/cô!'); renderLibrary(); };
    function sync(){ app.querySelectorAll('[data-q]').forEach(el=>{ const q=questions[+el.dataset.q]; if(el.dataset.f) q[el.dataset.f]=el.value; if(el.dataset.a!==undefined) q.answers[+el.dataset.a]=el.value; if(el.dataset.c!==undefined&&el.checked) q.correct=+el.dataset.c; }); }
  }; draw();
}

// ---------- Admin: Quản lý thành viên ----------
async function renderAdmin(){
  if (DEMO){ app.innerHTML='<div class="card"><h1>👑 Quản lý thành viên</h1><p>Bản demo chưa nối Firebase nên chưa có danh sách thành viên thật.</p></div>'; return; }
  const snap = await F.getDocs(F.query(F.collection(db,'users'), F.orderBy('createdAt','asc')));
  const users = snap.docs.map(d=>({uid:d.id,...d.data()}));
  const statusTxt = {pending:'⏳ Chờ duyệt', approved:'✅ Đang hoạt động', blocked:'🚫 Đã chặn'};
  app.innerHTML=`<div class="card"><h1>👑 Quản lý thành viên</h1><p class="small">${users.length} thành viên • Bấm vào số thiết bị để xem tên thiết bị và địa chỉ IP đã đăng nhập.</p>
  <div style="overflow-x:auto"><table><tr><th>Thành viên</th><th>Trạng thái</th><th>Chức năng được dùng</th><th>Hạn sử dụng</th><th>Thiết bị</th><th>Thao tác</th></tr>
  ${users.map(u=>`<tr>
    <td><b>${esc(u.displayName||'(chưa có tên)')}</b><br><span class="small">${esc(u.email)}${u.role==='admin'?' • 👑 Admin':''}<br>Đăng ký: ${fmtDate(u.createdAt)}</span></td>
    <td>${statusTxt[u.status]||esc(u.status)}</td>
    <td>${FEATURES.map(([k,label])=>`<span class="badge" style="${u.features?.[k]===false?'opacity:.4;text-decoration:line-through':''}">${label}</span>`).join(' ')}</td>
    <td>${fmtDate(u.expiresAt)}${u.expiresAt&&Date.now()>u.expiresAt?' <b style="color:#e21b3c">(đã hết hạn)</b>':''}</td>
    <td><button class="btn light" data-devices="${u.uid}">📱 Xem (<span data-devcount="${u.uid}">…</span>)</button><div data-devlist="${u.uid}"></div></td>
    <td><div class="row">
      ${u.status==='pending'?`<button class="btn green" data-act="approve" data-u="${u.uid}">Duyệt</button>`:''}
      ${u.status!=='blocked'?`<button class="btn red" data-act="block" data-u="${u.uid}">Chặn</button>`:`<button class="btn green" data-act="unblock" data-u="${u.uid}">Bỏ chặn</button>`}
      <button class="btn light" data-act="edit" data-u="${u.uid}">Sửa</button>
      ${u.uid!==me.uid?`<button class="btn gray" data-act="delete" data-u="${u.uid}">Xoá</button>`:''}
    </div><div data-edit="${u.uid}"></div></td></tr>`).join('')}
  </table></div></div>`;
  // Đếm thiết bị cho từng thành viên
  users.forEach(async u=>{ const ds=await F.getDocs(F.collection(db,'users',u.uid,'devices')); const el=app.querySelector(`[data-devcount="${u.uid}"]`); if(el) el.textContent=ds.size; });
  app.querySelectorAll('[data-devices]').forEach(b=>b.onclick=async()=>{
    const uid=b.dataset.devices, box=app.querySelector(`[data-devlist="${uid}"]`);
    if (box.innerHTML){ box.innerHTML=''; return; }
    const ds=await F.getDocs(F.collection(db,'users',uid,'devices'));
    box.innerHTML = ds.empty ? '<p class="small">Chưa có thiết bị nào đăng nhập.</p>' :
      ds.docs.map(d=>{ const v=d.data(); return `<p class="small" style="text-align:left">• <b>${esc(v.name)}</b><br>IP: ${esc(v.ip)}<br>Lần cuối: ${v.lastLoginAt?new Date(v.lastLoginAt).toLocaleString('vi-VN'):''}</p>`; }).join('');
  });
  app.querySelectorAll('[data-act]').forEach(b=>b.onclick=async()=>{
    const uid=b.dataset.u, act=b.dataset.act, ref=F.doc(db,'users',uid), u=users.find(x=>x.uid===uid);
    if (act==='approve'){ await F.updateDoc(ref,{status:'approved'}); renderAdmin(); }
    if (act==='block'){ if(confirm(`Chặn tài khoản ${u.email}? Họ sẽ không đăng nhập được nữa.`)){ await F.updateDoc(ref,{status:'blocked'}); renderAdmin(); } }
    if (act==='unblock'){ await F.updateDoc(ref,{status:'approved'}); renderAdmin(); }
    if (act==='delete'){ if(confirm(`XOÁ thành viên ${u.email}?\n\nLưu ý: thao tác này xoá hồ sơ và danh sách thiết bị, tài khoản đó sẽ không đăng nhập được nữa. Bộ câu hỏi họ đã tạo vẫn còn trong thư viện.`)){
      const ds=await F.getDocs(F.collection(db,'users',uid,'devices')); for (const d of ds.docs) await F.deleteDoc(d.ref);
      await F.deleteDoc(ref); renderAdmin(); } }
    if (act==='edit'){ const box=app.querySelector(`[data-edit="${uid}"]`);
      box.innerHTML=`<div style="min-width:260px;text-align:left">
        <input data-e="name" value="${esc(u.displayName||'')}" placeholder="Tên thành viên">
        <label class="small">Hạn sử dụng:</label><input data-e="exp" type="date" value="${u.expiresAt?new Date(u.expiresAt).toISOString().slice(0,10):''}">
        <label class="small"><input type="checkbox" data-e="noexp" ${!u.expiresAt?'checked':''} style="width:auto"> Không giới hạn hạn dùng</label><br>
        <label class="small">Vai trò:</label><select data-e="role"><option value="teacher" ${u.role!=='admin'?'selected':''}>Giáo viên</option><option value="admin" ${u.role==='admin'?'selected':''}>Admin</option></select>
        <b class="small">Chức năng được sử dụng:</b><br>
        ${FEATURES.map(([k,label])=>`<label class="small"><input type="checkbox" data-e="f-${k}" ${u.features?.[k]!==false?'checked':''} style="width:auto"> ${label}</label><br>`).join('')}
        <button class="btn green" data-save="${uid}">💾 Lưu thay đổi</button></div>`;
      box.querySelector('[data-save]').onclick=async()=>{
        const features={}; FEATURES.forEach(([k])=>features[k]=box.querySelector(`[data-e="f-${k}"]`).checked);
        const noexp=box.querySelector('[data-e="noexp"]').checked, expVal=box.querySelector('[data-e="exp"]').value;
        await F.updateDoc(ref,{ displayName: box.querySelector('[data-e="name"]').value.trim(), role: box.querySelector('[data-e="role"]').value,
          features, expiresAt: noexp? null : (expVal? new Date(expVal+'T23:59:59').getTime() : null) });
        alert('Đã lưu thay đổi cho thành viên.'); renderAdmin();
      };
    }
  });
}

// ---------- Giáo viên: phòng chờ + điều khiển (như trước) ----------
function renderHost(pin){
  stopListen(); let players=[], session=null, timer=null;
  app.innerHTML=`<div class="card center"><h2>📺 Phòng chờ — chiếu màn hình này cho lớp xem</h2><p>Vào EduQuiz • Nhập mã PIN:</p><div class="pinbox">${pin}</div>
  <p id="pcount" class="big">Đang chờ học sinh…</p><div id="plist"></div>
  <div class="row" style="justify-content:center;margin-top:14px"><button class="btn green" id="startBtn">▶ Bắt đầu trò chơi</button></div><div id="stage"></div></div>`;
  store.onSession(pin, s=>{ session=s; if(s) showStage(); });
  store.onPlayers(pin, ps=>{ players=ps.sort((a,b)=>(b.score||0)-(a.score||0)); const pc=$('#pcount'); if(!pc) return; pc.textContent = session?.status==='lobby' ? `${ps.length} học sinh đã vào` : `Bảng điểm trực tiếp`;
    $('#plist').innerHTML = ps.map(p=>`<span class="player">${esc(p.nickname)} • ${p.score||0}đ</span>`).join(''); if(session) showStage(); });
  $('#startBtn').onclick=async()=>{ await store.setSession(pin,{status:'playing',currentQuestion:0,questionStartedAt:Date.now()}); };
  function showStage(){ const s=session; if(!s||s.status==='lobby')return; const sb=$('#startBtn'); if(sb) sb.style.display='none'; const st=$('#stage'); if(!st) return; const q=s.questions[s.currentQuestion];
    if(s.status==='finished'){ st.innerHTML = podium(players) + `<button class="btn" onclick="location.reload()">Về trang chủ</button>`; return; }
    if(s.status==='leaderboard'){ st.innerHTML = leaderboard(players) + `<button class="btn green" id="nextBtn">${s.currentQuestion+1>=s.questions.length?'🏁 Kết thúc & vinh danh':'Câu tiếp theo →'}</button>`;
      $('#nextBtn').onclick=async()=> s.currentQuestion+1>=s.questions.length ? store.setSession(pin,{status:'finished'}) : store.setSession(pin,{status:'playing',currentQuestion:s.currentQuestion+1,questionStartedAt:Date.now()}); return; }
    if(s.status==='showing_answer'){ const counts=[0,0,0,0]; players.forEach(p=>{ const a=p.answers?.[s.currentQuestion]; if(a) counts[a.choice]++; });
      st.innerHTML=`<h2>Đáp án đúng: ${SHAPES[q.correct]} ${esc(q.answers[q.correct])}</h2><p>${counts.map((c,i)=>`${SHAPES[i]}: ${c} bạn`).join(' • ')}</p><p class="small">${players.filter(p=>p.answers?.[s.currentQuestion]?.correct).length}/${players.length} bạn trả lời đúng</p><button class="btn" id="lbBtn">Xem bảng xếp hạng →</button>`;
      $('#lbBtn').onclick=()=>store.setSession(pin,{status:'leaderboard'}); return; }
    const remain = Math.max(0, q.time - Math.floor((Date.now()-(s.questionStartedAt||Date.now()))/1000));
    st.innerHTML=`<p class="badge">Câu ${s.currentQuestion+1}/${s.questions.length}</p><h2>${esc(q.text)}</h2><div class="timer"><i style="width:${remain/q.time*100}%"></i></div><p class="small">Còn ${remain} giây • ${players.filter(p=>p.answers?.[s.currentQuestion]).length}/${players.length} bạn đã trả lời</p>
    <div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,i)=>`<button class="ans ${COLORS[i]}"><span class="shape">${SHAPES[i]}</span>${esc(a)}</button>`).join('')}</div>
    <div class="row" style="margin-top:14px;justify-content:center"><button class="btn red" id="showAns">Hiện đáp án</button></div>`;
    $('#showAns').onclick=()=>store.setSession(pin,{status:'showing_answer'});
    clearInterval(timer); timer=setInterval(()=>{ const r=Math.max(0,q.time-Math.floor((Date.now()-(s.questionStartedAt||Date.now()))/1000)); if(r<=0){ clearInterval(timer); store.setSession(pin,{status:'showing_answer'}); } },1000);
  }
}

// ---------- Học sinh ----------
function renderPlayer(pin, playerId){
  stopListen(); let answeredFor=-1;
  app.innerHTML=`<div class="card center" id="pstage"><h2>Đã vào phòng!</h2><p>Nhìn lên màn hình của thầy/cô và chờ câu hỏi nhé…</p></div>`;
  store.onSession(pin, s=>{ if(!s) return; const st=$('#pstage'); if(!st) return;
    if(s.status==='lobby'){ st.innerHTML=`<h2>✅ Đã vào phòng chờ</h2><p>Chờ thầy/cô bấm Bắt đầu…</p>`; return; }
    if(s.status==='finished'){ store.listPlayers(pin).then(ps=>{ const m=ps.find(p=>p.id===playerId); const rank=ps.sort((a,b)=>b.score-a.score).findIndex(p=>p.id===playerId)+1; st.innerHTML=`<h2>🏁 Trò chơi kết thúc!</h2><p class="big">Em xếp hạng ${rank} • ${m?.score||0} điểm</p>`+podium(ps); }); return; }
    if(s.status==='leaderboard'||s.status==='showing_answer'){ store.listPlayers(pin).then(ps=>{ const m=ps.find(p=>p.id===playerId); const a=m?.answers?.[s.currentQuestion]; st.innerHTML = s.status==='showing_answer' ? (a? (a.correct?`<h2>🎉 Đúng rồi! +${a.points} điểm</h2>`:`<h2>Chưa đúng rồi, cố lên câu sau nhé!</h2>`) : `<h2>Hết giờ! Em chưa trả lời câu này.</h2>`) : leaderboard(ps, playerId); }); return; }
    const q=s.questions[s.currentQuestion]; if(answeredFor===s.currentQuestion){ st.innerHTML=`<h2>✔ Đã trả lời!</h2><p>Chờ các bạn khác…</p>`; return; }
    st.innerHTML=`<p class="badge">Câu ${s.currentQuestion+1}/${s.questions.length} • ${q.time} giây</p><h2>${esc(q.text)}</h2><div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,i)=>`<button class="ans ${COLORS[i]}" data-a="${i}"><span class="shape">${SHAPES[i]}</span>${esc(a)}</button>`).join('')}</div>`;
    st.querySelectorAll('[data-a]').forEach(b=>b.onclick=async()=>{ const choice=+b.dataset.a; const elapsed=Date.now()-(s.questionStartedAt||Date.now());
      const correct = choice===q.correct; const points = correct ? Math.round(q.points*(1 - Math.min(elapsed/(q.time*1000),1)/2)) : 0;
      answeredFor=s.currentQuestion; await store.answer(pin, playerId, s.currentQuestion, choice, points, correct); st.innerHTML=`<h2>✔ Đã trả lời!</h2><p>Chờ các bạn khác…</p>`; });
  });
}

// ---------- Tự luyện tập + Báo cáo + tiện ích ----------
async function renderPractice(quiz){ let i=0, score=0; const step=()=>{ if(i>=quiz.questions.length){ app.innerHTML=`<div class="card center"><h1>🏁 Hoàn thành!</h1><p class="big">Điểm của em: ${score}</p><button class="btn" onclick="location.reload()">Về trang chủ</button></div>`; return; }
  const q=quiz.questions[i]; app.innerHTML=`<div class="card"><p class="badge">Câu ${i+1}/${quiz.questions.length}</p><h2>${esc(q.text)}</h2><div class="answers">${(q.type==='tf'?['Đúng','Sai']:q.answers).map((a,j)=>`<button class="ans ${COLORS[j]}" data-a="${j}"><span class="shape">${SHAPES[j]}</span>${esc(a)}</button>`).join('')}</div></div>`;
  app.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ if(+b.dataset.a===q.correct){ score+=q.points; alert('🎉 Đúng rồi!'); } else alert('Chưa đúng. Đáp án đúng là: '+q.answers[q.correct]); i++; step(); }); }; step(); }
async function renderReports(){ const qs=(await store.listQuizzes()).filter(q=>me?.role==='admin'||!q.ownerUid||q.ownerUid===me?.uid);
  app.innerHTML=`<div class="card"><h1>📊 Báo cáo</h1><p class="small">Chi tiết từng buổi chơi lưu trong Firestore, collection <b>sessions</b> (điểm và đáp án từng học sinh).</p>${qs.map(q=>`<p>• <b>${esc(q.title)}</b> — ${q.questions.length} câu</p>`).join('')||'<p class="small">Chưa có dữ liệu.</p>'}</div>`; }
const leaderboard = (ps, m) => `<h2>🏆 Bảng xếp hạng</h2><table>${ps.slice(0,10).map((p,i)=>`<tr ${m&&p.id===m?'style="background:#fff3cd;font-weight:800"':''}><td>${i+1}</td><td>${esc(p.nickname)} ${p.streak>=3?'🔥':''}</td><td>${p.score||0} điểm</td></tr>`).join('')}</table>`;
const podium = ps => { const t=[ps[1],ps[0],ps[2]].filter(Boolean); return `<h2>👑 Bục vinh quang</h2><div class="podium">${t.map(p=>`<div class="pod"><div>${esc(p.nickname)}</div><div class="bar">${p.score||0}đ</div></div>`).join('')}</div>`+leaderboard(ps); };

init();
