// EduQuiz — Đồng bộ realtime qua Firebase Firestore
// Mô hình dữ liệu:
//  quizzes/{id}            : bộ câu hỏi của giáo viên
//  sessions/{pin}          : phiên chơi {quiz snapshot, status, currentQuestion, questionStartedAt}
//  sessions/{pin}/players/{playerId} : {nickname, score, streak, answers:{}}
// Nếu chưa điền firebase-config.js -> chạy CHẾ ĐỘ DEMO trên máy này (localStorage)
import { firebaseConfig, isConfigured } from './firebase-config.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const COLORS = ['a0','a1','a2','a3'], SHAPES = ['▲','◆','●','■'];
let db = null, F = null, DEMO = !isConfigured();
let unsubs = [];

// ---------- Khởi tạo Firebase ----------
async function init(){
  if (DEMO){ $('#syncStatus').textContent = '⚠️ Chế độ demo (chưa nối Firebase) — chỉ chơi trên máy này'; renderHome(); return; }
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  F = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  db = F.getFirestore(initializeApp(firebaseConfig));
  $('#syncStatus').textContent = '☁️ Đã nối Firebase — đồng bộ mọi thiết bị';
  renderHome();
}
const stopListen = () => { unsubs.forEach(u=>u&&u()); unsubs=[]; };
const listen = (q, cb) => DEMO ? demoListen(cb) : unsubs.push(F.onSnapshot(q, s=>cb(s)));
function demoListen(cb){ cb(); return ()=>{}; }

// ---------- Lớp dữ liệu: trừu tượng Demo / Firestore ----------
const store = {
  async createQuiz(q){ if(DEMO){ const id='q'+Date.now(); const all=JSON.parse(localStorage.getItem('eq_quizzes')||'[]'); all.push({id,...q}); localStorage.setItem('eq_quizzes',JSON.stringify(all)); return id; }
    const r = await F.addDoc(F.collection(db,'quizzes'), {...q, createdAt: F.serverTimestamp()}); return r.id; },
  async listQuizzes(){ if(DEMO) return JSON.parse(localStorage.getItem('eq_quizzes')||'[]');
    const s = await F.getDocs(F.query(F.collection(db,'quizzes'), F.orderBy('createdAt','desc'))); return s.docs.map(d=>({id:d.id,...d.data()})); },
  async getQuiz(id){ const all = await this.listQuizzes(); return all.find(q=>q.id===id); },
  async createSession(quiz){ const pin = String(Math.floor(100000+Math.random()*900000));
    const data = { quizId: quiz.id, title: quiz.title, questions: quiz.questions, status:'lobby', currentQuestion:-1, questionStartedAt:0, createdAt: Date.now() };
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
  onSession(pin, cb){ if(DEMO){ const h=()=>cb(this.getSession(pin)); window.addEventListener('eq-change', async()=>cb(await this.getSession(pin))); cb(this.getSession(pin)); }
    else unsubs.push(F.onSnapshot(F.doc(db,'sessions',pin), async s=>cb(s.exists()?s.data():null))); },
  onPlayers(pin, cb){ if(DEMO){ window.addEventListener('eq-change', async()=>cb(await this.listPlayers(pin))); this.listPlayers(pin).then(cb); }
    else unsubs.push(F.onSnapshot(F.collection(db,'sessions',pin,'players'), s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))))); },
};

// ---------- Điều hướng ----------
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{ stopListen(); ({home:renderHome,library:renderLibrary,create:()=>renderCreate(),reports:renderReports})[b.dataset.nav](); });

// ---------- Trang chủ: kahoot.it style ----------
function renderHome(){
  app.innerHTML = `${DEMO?'<div class="notice"><b>Đang ở chế độ demo.</b> Thầy điền cấu hình vào file <b>firebase-config.js</b> (xem README) thì học sinh ở máy khác mới vào chung phòng được. Hiện tại chỉ chơi thử trên máy này.</div>':''}
  <div class="card join"><h1>Tham gia trò chơi</h1><p class="small">Nhập mã PIN do giáo viên cung cấp</p>
  <input id="pin" inputmode="numeric" maxlength="6" placeholder="Mã PIN 6 số" style="text-align:center;font-size:22px;font-weight:800">
  <input id="nick" placeholder="Tên của em (biệt danh)">
  <button class="btn green" style="width:100%" id="joinBtn">Vào chơi →</button></div>
  <div class="card center"><h2>Thầy/cô tổ chức trò chơi?</h2><p class="small">Tạo bộ câu hỏi, bấm Tổ chức, chiếu mã PIN lên màn hình — học sinh vào bằng điện thoại, máy tính bảng, laptop.</p>
  <button class="btn" onclick="document.querySelector('[data-nav=library]').click()">Mở thư viện & tổ chức →</button></div>`;
  $('#joinBtn').onclick = async () => { const pin=$('#pin').value.trim(), nick=$('#nick').value.trim();
    if(pin.length!==6||!nick) return alert('Em nhập đủ mã PIN 6 số và tên nhé!');
    const s = await store.getSession(pin); if(!s) return alert('Không tìm thấy phòng chơi này. Em kiểm tra lại mã PIN nhé!');
    const pid = await store.join(pin, nick); renderPlayer(pin, pid); };
}

// ---------- Thư viện & Tạo quiz ----------
async function renderLibrary(){
  const qs = await store.listQuizzes();
  app.innerHTML = `<div class="card"><h1>📚 Thư viện của tôi</h1>${qs.length? '' : '<p class="small">Chưa có bộ câu hỏi nào. Bấm “+ Tạo bộ câu hỏi” để tạo bộ đầu tiên.</p>'}
  ${qs.map(q=>`<div class="row" style="border-bottom:1px solid #eee;padding:10px 0"><div class="grow"><b>${esc(q.title)}</b><br><span class="small">${esc(q.subject||'')} • ${q.questions.length} câu hỏi</span></div>
  <button class="btn green" data-host="${q.id}">▶ Tổ chức</button> <button class="btn light" data-practice="${q.id}">Tự luyện tập</button></div>`).join('')}</div>`;
  app.querySelectorAll('[data-host]').forEach(b=>b.onclick=async()=>{ const q=await store.getQuiz(b.dataset.host); const pin=await store.createSession(q); renderHost(pin); });
  app.querySelectorAll('[data-practice]').forEach(b=>b.onclick=async()=>renderPractice(await store.getQuiz(b.dataset.practice)));
}
function renderCreate(edit){
  let questions = edit?.questions ? structuredClone(edit.questions) : [{text:'',type:'quiz',answers:['','','',''],correct:0,time:20,points:1000}];
  const draw=()=>{ app.innerHTML=`<div class="card"><h1>✏️ Tạo bộ câu hỏi</h1>
    <input id="qt" placeholder="Tiêu đề bộ câu hỏi, ví dụ: Ôn tập Toán lớp 5" value="${esc(edit?.title||'')}">
    <input id="qs" placeholder="Môn học / chủ đề" value="${esc(edit?.subject||'')}">
    <div id="qlist"></div>
    <div class="row"><button class="btn light" id="addQ">+ Thêm câu hỏi</button><button class="btn green grow" id="saveQ">💾 Lưu bộ câu hỏi</button></div></div>`;
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
      await store.createQuiz({title, subject:$('#qs').value.trim(), questions}); alert('Đã lưu vào thư viện!'); renderLibrary(); };
    function sync(){ app.querySelectorAll('[data-q]').forEach(el=>{ const q=questions[+el.dataset.q]; if(el.dataset.f) q[el.dataset.f]=el.value; if(el.dataset.a!==undefined) q.answers[+el.dataset.a]=el.value; if(el.dataset.c!==undefined&&el.checked) q.correct=+el.dataset.c; }); }
  }; draw();
}

// ---------- Giáo viên: phòng chờ + điều khiển ----------
function renderHost(pin){
  stopListen(); let players=[], session=null, timer=null;
  app.innerHTML=`<div class="card center"><h2>📺 Phòng chờ — chiếu màn hình này cho lớp xem</h2><p>Vào EduQuiz • Nhập mã PIN:</p><div class="pinbox">${pin}</div>
  <p id="pcount" class="big">Đang chờ học sinh…</p><div id="plist"></div>
  <div class="row" style="justify-content:center;margin-top:14px"><button class="btn green" id="startBtn">▶ Bắt đầu trò chơi</button></div><div id="stage"></div></div>`;
  store.onSession(pin, s=>{ session=s; if(s) showStage(); });
  store.onPlayers(pin, ps=>{ players=ps.sort((a,b)=>(b.score||0)-(a.score||0)); $('#pcount').textContent = session?.status==='lobby' ? `${ps.length} học sinh đã vào` : `Bảng điểm trực tiếp`;
    $('#plist').innerHTML = ps.map(p=>`<span class="player">${esc(p.nickname)} • ${p.score||0}đ</span>`).join(''); if(session) showStage(); });
  $('#startBtn').onclick=async()=>{ await store.setSession(pin,{status:'playing',currentQuestion:0,questionStartedAt:Date.now()}); };
  function showStage(){ const s=session; if(!s||s.status==='lobby')return; $('#startBtn').style.display='none'; const st=$('#stage'); const q=s.questions[s.currentQuestion];
    if(s.status==='finished'){ st.innerHTML = podium(players) + `<button class="btn" onclick="location.reload()">Về trang chủ</button>`; return; }
    if(s.status==='leaderboard'){ st.innerHTML = leaderboard(players) + `<button class="btn green" id="nextBtn">${s.currentQuestion+1>=s.questions.length?'🏁 Kết thúc & vinh danh':'Câu tiếp theo →'}</button>`;
      $('#nextBtn').onclick=async()=> s.currentQuestion+1>=s.questions.length ? store.setSession(pin,{status:'finished'}) : store.setSession(pin,{status:'playing',currentQuestion:s.currentQuestion+1,questionStartedAt:Date.now()}); return; }
    if(s.status==='showing_answer'){ const counts=[0,0,0,0]; players.forEach(p=>{ const a=p.answers?.[s.currentQuestion]; if(a) counts[a.choice]++; });
      st.innerHTML=`<h2>Đáp án đúng: ${SHAPES[q.correct]} ${esc(q.type==='tf'?q.answers[q.correct]:q.answers[q.correct])}</h2><p>${counts.map((c,i)=>`${SHAPES[i]}: ${c} bạn`).join(' • ')}</p><p class="small">${players.filter(p=>p.answers?.[s.currentQuestion]?.correct).length}/${players.length} bạn trả lời đúng</p><button class="btn" id="lbBtn">Xem bảng xếp hạng →</button>`;
      $('#lbBtn').onclick=()=>store.setSession(pin,{status:'leaderboard'}); return; }
    // playing
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
    if(s.status==='finished'){ store.listPlayers(pin).then(ps=>{ const me=ps.find(p=>p.id===playerId); const rank=ps.sort((a,b)=>b.score-a.score).findIndex(p=>p.id===playerId)+1; st.innerHTML=`<h2>🏁 Trò chơi kết thúc!</h2><p class="big">Em xếp hạng ${rank} • ${me?.score||0} điểm</p>`+podium(ps); }); return; }
    if(s.status==='leaderboard'||s.status==='showing_answer'){ store.listPlayers(pin).then(ps=>{ const me=ps.find(p=>p.id===playerId); const a=me?.answers?.[s.currentQuestion]; st.innerHTML = s.status==='showing_answer' ? (a? (a.correct?`<h2>🎉 Đúng rồi! +${a.points} điểm</h2>`:`<h2>Chưa đúng rồi, cố lên câu sau nhé!</h2>`) : `<h2>Hết giờ! Em chưa trả lời câu này.</h2>`) : leaderboard(ps, playerId); }); return; }
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
  app.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ if(+b.dataset.a===q.correct){ score+=q.points; alert('🎉 Đúng rồi!'); } else alert('Chưa đúng. Đáp án đúng là: '+(q.type==='tf'?q.answers[q.correct]:q.answers[q.correct])); i++; step(); }); }; step(); }
async function renderReports(){ const qs=await store.listQuizzes(); app.innerHTML=`<div class="card"><h1>📊 Báo cáo</h1><p class="small">Báo cáo chi tiết theo từng buổi chơi được lưu trong Firestore tại collection <b>sessions</b> (mỗi phiên có điểm và đáp án của từng học sinh). Trong bản này thầy xem nhanh thư viện:</p>${qs.map(q=>`<p>• <b>${esc(q.title)}</b> — ${q.questions.length} câu</p>`).join('')||'<p class="small">Chưa có dữ liệu.</p>'}</div>`; }
const esc = s => String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const leaderboard = (ps, me) => `<h2>🏆 Bảng xếp hạng</h2><table>${ps.slice(0,10).map((p,i)=>`<tr ${me&&p.id===me?'style="background:#fff3cd;font-weight:800"':''}><td>${i+1}</td><td>${esc(p.nickname)} ${p.streak>=3?'🔥':''}</td><td>${p.score||0} điểm</td></tr>`).join('')}</table>`;
const podium = ps => { const t=[ps[1],ps[0],ps[2]].filter(Boolean); return `<h2>👑 Bục vinh quang</h2><div class="podium">${t.map(p=>`<div class="pod"><div>${esc(p.nickname)}</div><div class="bar">${p.score||0}đ</div></div>`).join('')}</div>`+leaderboard(ps); };

init();
