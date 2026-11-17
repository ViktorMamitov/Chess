import {parse} from "./parse.js?v=4";
let Chess = null;
for (const url of ["https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm",
                   "https://cdn.jsdelivr.net/npm/chess.js@1.0.0/dist/esm/chess.js",
                   "https://esm.sh/chess.js@1.0.0",
                   "https://unpkg.com/chess.js@1.0.0/dist/esm/chess.js"]) {
  try { Chess = (await import(url)).Chess; if (Chess) break; } catch (e) {}
}
if (!Chess) throw new Error("chess.js не загрузился");
window.__ok = true;
{ const m=document.createElement("meta"); m.name="referrer"; m.content="no-referrer"; document.head.appendChild(m); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const $ = id => document.getElementById(id);
const FILES = "abcdefgh";
const FILE_RU = {a:"а",b:"бэ",c:"цэ",d:"дэ",e:"е",f:"эф",g:"же",h:"аш"};
const PIECE_RU = {p:"пешка",n:"конь",b:"слон",r:"ладья",q:"ферзь",k:"король"};
const PIECE_EN = {p:"pawn",n:"knight",b:"bishop",r:"rook",q:"queen",k:"king"};
const GLYPH = {k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"};
const GLYPH_OUT = {k:"♔",q:"♕",r:"♖",b:"♗",n:"♘",p:""};
const VS = "\uFE0E";
const S = {side:"w", voice:"en", piece:false, hear:"ru-RU", depth:"12", tts:"net"};
let game = new Chess(), flipped = false, sel = null, busy = false;
let micOn = false, speaking = false, rec = null, recActive = false, recEndCb = null;
let lastSpoken = "", imgFail = false, lastEval = null, errStreak = 0;
const me = () => S.side;
const en = () => S.voice === "en";

function log(s){ const l=$("log"); l.textContent += new Date().toTimeString().slice(0,8)+"  "+s+"\n";
  if(l.textContent.length>20000) l.textContent=l.textContent.slice(-15000); l.scrollTop=l.scrollHeight; }
function heard(s,err){ const h=$("heard"); h.textContent=s; h.classList.toggle("err",!!err); }
function warn(s){ const w=$("warn"); w.style.display=s?"block":"none"; w.textContent=s||""; }
function setPill(){
  const st = busy ? "think" : speaking ? "speak" : (micOn && recActive) ? "listen" : micOn ? "idle" : "off";
  const txt = {think:"Думаю",speak:"Говорю",listen:"Слушаю",idle:"Жду",off:"Голос выкл"}[st];
  $("pill").className = "pill "+st; $("pillTxt").textContent = txt;
}
function save(){ try{ localStorage.setItem("cg_state", JSON.stringify({pgn:game.pgn(), S, flipped})); }catch(e){} }
function load(){
  try{
    const s = JSON.parse(localStorage.getItem("cg_state")||"null");
    if(!s) return;
    Object.assign(S, s.S||{}); flipped = !!s.flipped;
    if(s.pgn){ const g=new Chess(); g.loadPgn(s.pgn); game=g; }
  }catch(e){ game = new Chess(); }
}

const chk = m => m.san.includes("#") ? "#" : m.san.includes("+") ? "+" : "";
function fmt(m){
  if(m.flags.includes("k")) return "O-O" + chk(m);
  if(m.flags.includes("q")) return "O-O-O" + chk(m);
  return (GLYPH_OUT[m.piece] ? GLYPH_OUT[m.piece]+VS+" " : "") + m.from.toUpperCase()+" → "+m.to.toUpperCase()
    + (m.promotion ? "="+m.promotion.toUpperCase() : "") + chk(m);
}
function speechFor(m){
  let s;
  if(m.flags.includes("k")) s = en() ? "Castle short" : "Короткая рокировка";
  else if(m.flags.includes("q")) s = en() ? "Castle long" : "Длинная рокировка";
  else{
    const q = x => en() ? x.toUpperCase() : FILE_RU[x[0]]+" "+x[1];
    s = (S.piece ? (en()?PIECE_EN:PIECE_RU)[m.piece]+" " : "") + q(m.from) + ", " + q(m.to);
    if(m.promotion) s += ", " + (en()?PIECE_EN:PIECE_RU)[m.promotion];
  }
  if(m.san.includes("#")) s += en() ? ", checkmate" : ", мат";
  else if(m.san.includes("+")) s += en() ? ", check" : ", шах";
  return s;
}
function endText(ru=true){
  if(game.isCheckmate()){ const w = game.turn()==="w" ? "чёрных" : "белых"; return ru ? "Мат. Победа "+w : "Checkmate"; }
  if(game.isStalemate()) return ru ? "Пат — ничья" : "Stalemate, draw";
  if(game.isThreefoldRepetition()) return ru ? "Троекратное повторение — ничья" : "Draw by repetition";
  if(game.isInsufficientMaterial()) return ru ? "Мало материала — ничья" : "Draw";
  if(game.isDraw()) return ru ? "Ничья" : "Draw";
  return ru ? "Игра окончена" : "Game over";
}

function pieceEl(color,type){
  if(!imgFail){
    const img = document.createElement("img");
    img.className = "pc"; img.alt = ""; img.draggable = false;
    img.src = `https://lichess1.org/assets/piece/cburnett/${color}${type.toUpperCase()}.svg`;
    img.onerror = () => { if(!imgFail){ imgFail = true; render(); } };
    return img;
  }
  const s = document.createElement("span");
  s.className = "gl "+color; s.textContent = GLYPH[type]+VS;
  return s;
}
const bottomColor = () => flipped ? (me()==="w"?"b":"w") : me();
function xy(sq){
  const fi = FILES.indexOf(sq[0]), rk = +sq[1], w = bottomColor()==="w";
  return [(w?fi:7-fi)+.5, (w?8-rk:rk-1)+.5];
}
function kingSquare(color){
  for(const row of game.board()) for(const c of row) if(c && c.type==="k" && c.color===color) return c.square;
  return null;
}
function render(){
  const b = $("board"); b.innerHTML = "";
  const w = bottomColor()==="w";
  const hist = game.history({verbose:true}), last = hist[hist.length-1];
  const checkSq = game.inCheck() ? kingSquare(game.turn()) : null;
  const targets = sel ? game.moves({square:sel, verbose:true}) : [];
  for(let row=0; row<8; row++) for(let col=0; col<8; col++){
    const fi = w ? col : 7-col, rank = w ? 8-row : row+1, sq = FILES[fi]+rank;
    const d = document.createElement("div");
    d.className = "sq " + ((fi+rank)%2 ? "dk" : "lt");
    const hl = c => { const e=document.createElement("div"); e.className="hl "+c; d.appendChild(e); };
    if(last && (sq===last.from || sq===last.to)) hl(last.color===me() ? "bot" : "last");
    if(sq===sel) hl("sel");
    if(sq===checkSq) hl("chk");
    const pc = game.get(sq);
    if(pc) d.appendChild(pieceEl(pc.color, pc.type));
    const t = targets.find(m => m.to===sq);
    if(t){ const mk=document.createElement("div"); mk.className = "mk " + (pc||t.flags.includes("e") ? "cap" : "dot"); d.appendChild(mk); }
    if(col===0){ const c=document.createElement("span"); c.className="co r"; c.textContent=rank; d.appendChild(c); }
    if(row===7){ const c=document.createElement("span"); c.className="co f"; c.textContent=FILES[fi]; d.appendChild(c); }
    d.addEventListener("click", () => onSquare(sq));
    b.appendChild(d);
  }
  const svg = $("arrow");
  if(last && last.color===me()){
    let [x1,y1] = xy(last.from), [x2,y2] = xy(last.to);
    const L = Math.hypot(x2-x1,y2-y1), k = (L-.32)/L;
    x2 = x1+(x2-x1)*k; y2 = y1+(y2-y1)*k;
    svg.innerHTML = `<defs><marker id="ah" viewBox="0 0 10 10" refX="4" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="rgba(40,110,255,.85)"/></marker></defs><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(40,110,255,.8)" stroke-width=".17" stroke-linecap="round" marker-end="url(#ah)"/>`;
  } else svg.innerHTML = "";
  renderMoves(); updateHero(); setPill();
}
function renderMoves(){
  const box = $("moves"), h = game.history(); box.innerHTML = "";
  for(let i=0; i<h.length; i+=2){
    const n=document.createElement("span"); n.className="n"; n.textContent=(i/2+1)+".";
    box.appendChild(n);
    for(const j of [i,i+1]) if(h[j]){ const m=document.createElement("span"); m.className="m"+(j===h.length-1?" cur":""); m.textContent=h[j]; box.appendChild(m); }
  }
  box.scrollTop = box.scrollHeight;
}
function updateHero(){
  const h = game.history({verbose:true});
  const lb = [...h].reverse().find(m => m.color===me());
  $("botMove").textContent = lb ? fmt(lb) : "—";
  let st;
  if(game.isGameOver()) st = "🏁 " + endText();
  else if(busy) st = "Бот думает…";
  else if(game.turn()===me()) st = "Ход бота (нет движка? сделай ход сам)";
  else st = `Ход соперника (${me()==="w"?"чёрные":"белые"}) — скажи, напиши или нажми на доске`;
  $("sub").textContent = st;
  $("eval").textContent = lastEval==null ? "" : "оценка " + lastEval;
}

function onSquare(sq){
  unlockAudio();
  if(busy || game.isGameOver()) return;
  const pc = game.get(sq);
  if(sel){
    const mv = game.moves({square:sel, verbose:true}).filter(m => m.to===sq);
    if(mv.length){
      const from = sel; sel = null;
      if(mv.some(m => m.promotion)) return askPromo(from, sq);
      return userMove({from, to:sq}, "tap");
    }
    sel = (pc && pc.color===game.turn() && sq!==sel) ? sq : null;
    return render();
  }
  if(pc && pc.color===game.turn()){ sel = sq; render(); }
}
function askPromo(from,to){
  const box = $("promoBox"); box.innerHTML = "";
  for(const t of ["q","r","b","n"]){
    const bt = document.createElement("button");
    bt.appendChild(pieceEl(game.turn(), t));
    bt.onclick = () => { $("promo").classList.remove("show"); userMove({from,to,promotion:t}, "tap"); };
    box.appendChild(bt);
  }
  $("promo").classList.add("show");
}
$("promo").addEventListener("click", e => { if(e.target.id==="promo"){ $("promo").classList.remove("show"); render(); } });

const legal = () => game.moves({verbose:true});
function pickOne(arr, promo){
  const keys = new Set(arr.map(m => m.from+m.to));
  if(keys.size !== 1) return null;
  return arr.find(m => !m.promotion || m.promotion===(promo||"q")) || arr[0];
}
function trySAN(text){
  const t = text.trim();
  if(!/^[a-hnbrqko0-8x+#=\-\s]+$/i.test(t) || !/[a-h][1-8]|[o0]-[o0]/i.test(t)) return null;
  const g = new Chess(game.fen());
  for(const v of [t, t.replace(/\s+/g,""), t.replace(/[o0]/gi,"O").replace(/\s+/g,"")]){
    try{ const m = g.move(v); if(m) return m; }catch(e){}
  }
  return null;
}
function interpret(text){
  const L = legal();
  const san = trySAN(text);
  if(san) return {kind:"move", mv:san};
  const ru = text.trim().toLowerCase().match(/^(кр|к|с|л|ф|п)\s*[x:х]?\s*([a-h])\s*([1-8])\s*[+#]?$/);
  if(ru){
    const pc = {кр:"k",к:"n",с:"b",л:"r",ф:"q",п:"p"}[ru[1]];
    const c = L.filter(x => x.piece===pc && x.to===ru[2]+ru[3]);
    const one = pickOne(c); return one ? {kind:"move", mv:one} : {kind: c.length ? "ambig" : "illegal"};
  }
  const p = parse(text);
  if(!p) return null;
  if(p.type==="cmd") return {kind:"cmd", name:p.name};
  if(p.type==="unclear") return {kind:"unclear"};
  if(p.type==="castle"){
    const c = L.find(x => x.flags.includes(p.side==="long" ? "q" : "k"));
    return c ? {kind:"move", mv:c} : {kind:"illegal"};
  }
  if(p.type==="move"){
    let one = pickOne(L.filter(x => x.from===p.from[0] && x.to===p.to[0]), p.promo);
    if(one) return {kind:"move", mv:one};
    one = pickOne(L.filter(x => p.from.includes(x.from) && p.to.includes(x.to) && (!p.piece || x.piece===p.piece)), p.promo);
    if(one) return {kind:"move", mv:one};
    if(p.piece){ one = pickOne(L.filter(x => x.to===p.to[0] && x.piece===p.piece), p.promo); if(one) return {kind:"move", mv:one}; }
    one = pickOne(L.filter(x => x.to===p.to[0] && x.from[1]===p.from[0][1]), p.promo);
    if(one) return {kind:"move", mv:one};
    return {kind:"illegal"};
  }
  if(p.type==="to"){
    let c = L.filter(x => x.to===p.to[0] && (!p.piece || x.piece===p.piece));
    if(!c.length) c = L.filter(x => p.to.includes(x.to) && (!p.piece || x.piece===p.piece));
    if(!c.length) return {kind:"illegal"};
    if(!p.piece){ const pw = pickOne(c.filter(x => x.piece==="p"), p.promo); if(pw) return {kind:"move", mv:pw}; }
    const one = pickOne(c, p.promo);
    return one ? {kind:"move", mv:one} : {kind:"ambig"};
  }
  return null;
}
const MSG = {illegal:["Нелегальный ход","Illegal move"], ambig:["Уточни: какая фигура или откуда","Which piece?"], unclear:["Не понял, повтори","Say again"]};
function act(r, src){
  if(!r){ if(src!=="voice") heard("Не понял ход", true); return; }
  if(r.kind==="cmd") return command(r.name);
  if(busy) return;
  if(r.kind==="move") return userMove(r.mv, src);
  const m = MSG[r.kind]; heard((src==="voice"?"🎤 ":"")+m[0], true);
  if(src==="voice") say(en() ? m[1] : m[0]);
}
function onHeard(alts){
  alts = alts.map(a => a.trim()).filter(Boolean);
  if(!alts.length) return;
  log("слышу: " + alts.join(" | "));
  heard("🎤 «" + alts[0] + "»");
  let best = null;
  for(const a of alts){
    const r = interpret(a); if(!r) continue;
    if(r.kind==="move" || r.kind==="cmd"){ best = r; break; }
    if(!best) best = r;
  }
  if(best) act(best, "voice");
}

function userMove(mv, src){
  let m = null;
  try{ m = game.move({from:mv.from, to:mv.to, promotion:mv.promotion || undefined}); }catch(e){}
  if(!m){ heard("Нелегальный ход", true); render(); return; }
  sel = null; save(); render();
  heard((src==="voice"?"🎤 ":src==="tap"?"👆 ":"⌨️ ") + (m.color===me() ? "Ход бота вручную: " : "Соперник: ") + fmt(m));
  log((m.color===me() ? "бот (вручную): " : "соперник: ") + m.san);
  if(game.isGameOver()) return say(endText(!en()));
  if(game.turn()===me()) botTurn();
}
async function botTurn(){
  if(busy || game.isGameOver() || game.turn()!==me()) return;
  busy = true; render(); await stopRec();
  const fen = game.fen();
  let uci = null;
  try{ uci = await engineMove(fen); }catch(e){ log("движок: "+e); }
  busy = false;
  if(game.fen() !== fen){ render(); if(game.turn()===me()) setTimeout(botTurn, 50); return; }
  if(!uci){ render(); heard("Нет связи с движком — проверь интернет", true); await say(en() ? "No engine connection" : "Нет связи с движком"); return; }
  let m = null;
  try{ m = game.move({from:uci.slice(0,2), to:uci.slice(2,4), promotion:uci[4] || undefined}); }catch(e){}
  if(!m){ log("ход движка не принят: "+uci); render(); await say(en() ? "Engine error" : "Ошибка движка"); return; }
  log("бот: " + m.san + "  (" + uci + ")");
  save(); render();
  let t = speechFor(m);
  if(game.isGameOver()) t += ". " + endText(!en());
  await say(t);
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_,rej) => setTimeout(() => rej("таймаут"), ms))]);
let sfP = null;
function getSF(){
  if(sfP) return sfP;
  sfP = new Promise((res, rej) => {
    try{
      const blob = new Blob([`importScripts("https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js");`], {type:"application/javascript"});
      const w = new Worker(URL.createObjectURL(blob));
      const t = setTimeout(() => rej("stockfish не загрузился"), 15000);
      w.onmessage = e => { if(String(e.data).includes("uciok")){ clearTimeout(t); res(w); } };
      w.onerror = () => { clearTimeout(t); rej("stockfish ошибка"); };
      w.postMessage("uci");
    }catch(e){ rej(e); }
  });
  sfP.catch(() => { sfP = null; });
  return sfP;
}
async function localSF(fen, depth){
  const w = await getSF();
  return new Promise(res => {
    w.onmessage = e => { const m = String(e.data).match(/^bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/); if(m) res(m[1]); };
    w.postMessage("position fen " + fen);
    w.postMessage(`go depth ${Math.min(depth,14)} movetime 2500`);
  });
}
async function engineMove(fen){
  const d = +S.depth;
  const tries = [
    ["chess-api.com", async () => {
      const r = await fetch("https://chess-api.com/v1", {method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({fen, depth:Math.min(d,18), maxThinkingTime:50})});
      const j = await r.json();
      if(j.mate != null) lastEval = "мат в " + Math.abs(j.mate);
      else if(typeof j.eval === "number") lastEval = (j.eval>0?"+":"") + j.eval.toFixed(1);
      return j.lan || j.move;
    }, 8000],
    ["stockfish (локально)", () => localSF(fen, d), 20000],
    ["stockfish.online", async () => {
      const r = await fetch(`https://stockfish.online/api/s/v2.php?depth=${Math.min(d,15)}&fen=${encodeURIComponent(fen)}`);
      const j = await r.json(); return (j.bestmove || "").split(" ")[1];
    }, 9000],
  ];
  for(const [name, fn, ms] of tries){
    try{
      const u = await withTimeout(fn(), ms);
      if(u && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)) return u;
      log(name + ": пустой ответ");
    }catch(e){ log(name + ": " + e); }
  }
  return null;
}

let unlocked = false;
const player = new Audio(); player.preload = "auto"; player.setAttribute("playsinline", "");
function silentWav(){
  const n=1600, b=new ArrayBuffer(44+n), v=new DataView(b);
  const w=(o,t)=>{ for(let i=0;i<t.length;i++) v.setUint8(o+i,t.charCodeAt(i)); };
  w(0,"RIFF"); v.setUint32(4,36+n,true); w(8,"WAVE"); w(12,"fmt "); v.setUint32(16,16,true);
  v.setUint16(20,1,true); v.setUint16(22,1,true); v.setUint32(24,8000,true); v.setUint32(28,8000,true);
  v.setUint16(32,1,true); v.setUint16(34,8,true); w(36,"data"); v.setUint32(40,n,true);
  for(let i=0;i<n;i++) v.setUint8(44+i,128);
  return URL.createObjectURL(new Blob([b],{type:"audio/wav"}));
}
function unlockAudio(){
  if(unlocked) return;
  unlocked = true;
  try{ player.src = silentWav(); const p = player.play(); if(p) p.catch(()=>{}); }catch(e){}
  try{ if(window.speechSynthesis){ const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } }catch(e){}
}
function pickVoice(lang){
  const vs = speechSynthesis.getVoices().filter(v => v.lang && v.lang.replace("_","-").toLowerCase().startsWith(lang.slice(0,2)));
  return vs.find(v => v.lang.replace("_","-")===lang && v.localService) || vs.find(v => v.lang.replace("_","-")===lang) || vs[0] || null;
}
function playNet(text){
  return new Promise(res => {
    let done = false, started = false;
    const end = ok => { if(done) return; done = true; player.onended = player.onerror = player.onplaying = null; res(ok); };
    player.onplaying = () => { started = true; };
    player.onended = () => end(true);
    player.onerror = () => { log("онлайн-озвучка: не загрузилась"); end(false); };
    setTimeout(() => { if(!started) log("онлайн-озвучка: таймаут"); end(started); }, 3000 + text.length * 150);
    player.src = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${en() ? "en" : "ru"}&q=${encodeURIComponent(text)}`;
    player.volume = 1;
    try{ const p = player.play(); if(p) p.catch(e => { log("онлайн-озвучка: " + e.name); end(false); }); }catch(e){ end(false); }
  });
}
function speakSys(text){
  return new Promise(res => {
    if(!window.speechSynthesis){ log("нет синтеза речи"); return res(); }
    let done = false;
    const fin = () => { if(done) return; done = true; res(); };
    const lang = en() ? "en-US" : "ru-RU";
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = en() ? .95 : 1; u.volume = 1;
    const v = pickVoice(lang); if(v) u.voice = v;
    u.onend = fin; u.onerror = e => { log("системная озвучка: " + (e.error || "ошибка")); fin(); };
    setTimeout(fin, 2500 + text.length * 110);
    try{ speechSynthesis.cancel(); speechSynthesis.resume(); }catch(e){}
    setTimeout(() => { try{ speechSynthesis.speak(u); }catch(e){ fin(); } }, 80);
  });
}
async function say(text){
  if(!text) return;
  lastSpoken = text;
  log("бот говорит: " + text);
  speaking = true; setPill();
  await stopRec(); await sleep(250);
  let ok = false;
  if(S.tts === "net") ok = await playNet(text);
  if(!ok) await speakSys(text);
  speaking = false; setPill();
  setTimeout(startListening, 400);
}
if(window.speechSynthesis) speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function startListening(){
  if(!micOn || speaking || busy || recActive || document.hidden || !SR) return;
  rec = new SR();
  rec.lang = S.hear; rec.continuous = false; rec.interimResults = false; rec.maxAlternatives = 8;
  rec.onstart = () => { recActive = true; setPill(); };
  rec.onresult = e => { errStreak = 0; const r = e.results[e.results.length-1]; onHeard([...r].map(a => a.transcript)); };
  rec.onerror = e => {
    if(e.error==="not-allowed" || e.error==="service-not-allowed"){
      micOn = false; micBtn();
      warn("Нет доступа к микрофону. iPhone: Настройки → Safari → Микрофон → Разрешить; и включи Siri и Диктовку.");
    } else if(e.error!=="no-speech" && e.error!=="aborted"){ errStreak++; log("микрофон: " + e.error); }
  };
  rec.onend = () => {
    recActive = false; setPill();
    const cb = recEndCb; recEndCb = null; if(cb) cb();
    if(micOn && !speaking && !busy) setTimeout(startListening, errStreak > 2 ? 1500 : 150);
  };
  try{ rec.start(); recActive = true; setPill(); }catch(e){ recActive = false; }
}
function stopRec(){
  return new Promise(res => {
    if(!rec || !recActive){ res(); return; }
    recEndCb = res;
    try{ rec.abort(); }catch(e){ res(); }
    setTimeout(() => { recActive = false; res(); }, 600);
  });
}
function micBtn(){
  const b = $("mic");
  b.textContent = micOn ? "⏸ Голос включён — нажми для паузы" : "🎤 Включить голос";
  b.classList.toggle("on", micOn); b.classList.toggle("pri", !micOn); setPill();
}
async function requestWake(){ try{ await navigator.wakeLock?.request("screen"); }catch(e){} }
$("mic").onclick = async () => {
  unlockAudio();
  if(micOn){ micOn = false; micBtn(); await stopRec(); setPill(); return; }
  if(!SR){ warn("Этот браузер не распознаёт речь. На iPhone открой страницу в Safari. Пока вводи ходы текстом или тапом."); return; }
  warn(""); micOn = true; micBtn(); requestWake();
  if(game.turn()===me() && !game.isGameOver()) botTurn();
  else say(en() ? "Ready" : "Готов");
};
document.addEventListener("visibilitychange", () => {
  if(document.hidden){ try{ rec && rec.abort(); }catch(e){} }
  else if(micOn){ requestWake(); setTimeout(startListening, 300); }
});

function newGame(){
  game = new Chess(); sel = null; lastEval = null; save(); render();
  heard("Новая партия");
  if(game.turn()===me()) botTurn(); else say(en() ? "New game" : "Новая партия");
}
function undo(){
  if(!game.history().length) return;
  game.undo();
  if(game.history().length && game.turn()===me()) game.undo();
  sel = null; save(); render(); heard("↶ Отменено");
  if(game.turn()===me()) botTurn();
}
function setSide(c){
  S.side = c; $("sSide").value = c; save(); render();
  if(game.turn()===me() && !busy) botTurn();
}
function command(name){
  log("команда: " + name);
  if(name==="undo"){ undo(); if(game.turn()!==me()) say(en() ? "Undone" : "Отменил"); }
  else if(name==="new") newGame();
  else if(name==="repeat") say(lastSpoken || (en() ? "No moves yet" : "Ходов пока нет"));
  else if(name==="quit"){ micOn = false; micBtn(); stopRec(); }
  else if(name==="flip"){ flipped = !flipped; save(); render(); }
  else if(name==="white") setSide("w");
  else if(name==="black") setSide("b");
}

$("form").onsubmit = e => {
  e.preventDefault(); unlockAudio();
  const v = $("typed").value.trim(); if(!v) return;
  $("typed").value = ""; log("ввод: " + v);
  act(interpret(v), "text");
};
$("undo").onclick = () => { unlockAudio(); undo(); };
$("flip").onclick = () => { flipped = !flipped; save(); render(); };
$("new").onclick = () => { unlockAudio(); if(game.history().length===0 || confirm("Начать новую партию?")) newGame(); };
$("test").onclick = () => {
  unlockAudio();
  const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  log("озвучка: " + S.tts + ". ");
  log(`голосов: ${vs.length}, en: ${vs.filter(v=>v.lang.startsWith("en")).length}, ru: ${vs.filter(v=>v.lang.startsWith("ru")).length}`);
  say(en() ? "Sound check. G1, F3" : "Проверка звука. Же 1, эф 3");
};
{ const d = document.querySelector("details"), l = document.createElement("label");
  l.className = "set";
  l.innerHTML = 'Озвучка <select id="sTts"><option value="net">онлайн (громко, через очки)</option><option value="sys">системная iPhone</option></select>';
  d.appendChild(l); }
function bindSettings(){
  $("sSide").value = S.side; $("sVoice").value = S.voice; $("sPiece").checked = S.piece;
  $("sHear").value = S.hear; $("sDepth").value = S.depth; $("sTts").value = S.tts;
  $("sSide").onchange = e => setSide(e.target.value);
  $("sVoice").onchange = e => { S.voice = e.target.value; save(); };
  $("sPiece").onchange = e => { S.piece = e.target.checked; save(); };
  $("sHear").onchange = e => { S.hear = e.target.value; save(); if(micOn){ stopRec().then(startListening); } };
  $("sDepth").onchange = e => { S.depth = e.target.value; save(); };
  $("sTts").onchange = e => { S.tts = e.target.value; save(); };
}

load(); bindSettings(); render(); micBtn();
if(!SR) heard("Распознавание речи недоступно — вводи ходы текстом или тапом", true);
log("готово. бот за " + (me()==="w" ? "белых" : "чёрных"));
if(game.turn()===me() && !game.isGameOver()) botTurn();
