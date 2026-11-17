const FILE = Object.create(null), RANK = Object.create(null),
      PIECE = Object.create(null), CMD = Object.create(null);
function add(map, spec) {
  for (const [k, v] of Object.entries(spec))
    for (const w of v.split(/\s+/)) if (w) map[w] = k;
}
add(FILE, {
  a: "a а ай эй аа ей",
  b: "b б бэ бе би бэй бээ бее бы bee be",
  c: "c ц с цэ це си сэ се ци цы ce see sea si",
  d: "d д дэ де ди дей дээ дее dee de di",
  e: "e е э ее ээ и йе йэ ие ии ee",
  f: "f ф эф еф эфф ефф иф аф фэ фе ef eff",
  g: "g г ж же жэ жи жо жее гэ ге ги джи джей дж джэ гы gee jee ji",
  h: "h х аш ашь аж ащ ах аша ха хэ хе эйч эйчь эч эш aitch eitch",
});
add(RANK, {
  1: "1 один одна одно одын адин первая первый первой раз one won ван",
  2: "2 два две второй вторая тва two to too ту",
  3: "3 три третий третья тре трии сри фри three tree free",
  4: "4 четыре четвертый четвертая чтыре четыри четыр фор фо four for fore",
  5: "5 пять пятый пятая пят файв five",
  6: "6 шесть шестой шестая шест сикс six",
  7: "7 семь седьмой седьмая сем севен seven",
  8: "8 восемь восьмой восьмая восем эйт eight ate",
});
add(PIECE, {
  p: "пешка пешку пешкой пешки пешечка pawn",
  n: "конь коня конем конек кон лошадь лошадка лошадку найт knight night",
  b: "слон слона слоном офицер бишоп bishop",
  r: "ладья ладью ладьей ладя тура туру рук rook rock",
  q: "ферзь ферзя ферзем ферз королева королеву квин queen",
  k: "король короля королем кинг king",
});
add(CMD, {
  undo: "отмена отмени отменить отменяй назад верни ошибка undo back",
  new: "заново новая сброс рестарт new restart",
  repeat: "повтори повторить повтор еще repeat again",
  quit: "стоп хватит выход пауза stop pause",
  flip: "переверни перевернуть разверни flip",
  white: "белые белыми white",
  black: "черные черными black",
});
const SOUND = { b: "dge", d: "bge", e: "bdg", g: "dbe", a: "h", h: "a", c: "", f: "" };
const isPart = w => w in FILE || w in RANK || w in PIECE;
const known = w => isPart(w) || w in CMD;
function split(w, depth) {
  if (known(w)) return [w];
  if (depth > 3 || w.length < 2) return null;
  for (let i = Math.min(w.length - 1, 7); i >= 1; i--) {
    const head = w.slice(0, i);
    if (!isPart(head)) continue;
    const tail = split(w.slice(i), depth + 1);
    if (tail) return [head, ...tail];
  }
  return null;
}
function tokenize(low) {
  const t = low
    .replace(/([a-h])x([a-h])/g, "$1 $2")
    .replace(/[^a-zа-я0-9\s]+/g, " ")
    .replace(/([a-zа-я])(?=[0-9])/g, "$1 ")
    .replace(/([0-9])(?=[a-zа-я])/g, "$1 ")
    .replace(/(^|\s)([1-8])([1-8])(?=\s|$)/g, "$1$2 $3");
  const out = [];
  for (const w of t.split(/\s+/)) {
    if (!w) continue;
    const s = split(w, 0);
    if (s) out.push(...s); else out.push(w);
  }
  return out;
}
const ORDINARY = new Set(["раз", "for", "two", "too", "to", "won", "ate", "one", "tree", "free", "fore", "ту", "фор"]);
export function parse(text) {
  if (!text) return null;
  const low = String(text).toLowerCase().replace(/ё/g, "е");
  if (/[оo0]\s*-\s*[оo0]\s*-\s*[оo0]/.test(low)) return { type: "castle", side: "long" };
  if (/[оo0]\s*-\s*[оo0]/.test(low)) return { type: "castle", side: "short" };
  const words = tokenize(low);
  if (!words.length) return null;
  if (words.some(w => w.startsWith("рокир") || w.startsWith("castl") || w === "kingside" || w === "queenside")) {
    const long = words.some(w => w.startsWith("длин") || w === "long" || w === "queenside" || w.startsWith("ферзев"));
    return { type: "castle", side: long ? "long" : "short" };
  }
  const T = words.map(w => ({ w, f: FILE[w], r: RANK[w] ? +RANK[w] : 0, p: PIECE[w], c: CMD[w] }));
  const sqs = [];
  for (let i = 0; i < T.length - 1; i++)
    if (T[i].f && T[i + 1].r) { sqs.push({ f: T[i].f, r: T[i + 1].r, i }); i++; }
  let piece = null, promo = null;
  T.forEach((t, i) => {
    if (!t.p) return;
    if (!sqs.length || i < sqs[0].i) piece = piece || t.p;
    else promo = t.p;
  });
  const last = sqs[sqs.length >= 2 ? 1 : 0];
  if (promo && (!last || (last.r !== 1 && last.r !== 8) || promo === "p" || promo === "k")) {
    piece = piece || promo; promo = null;
  }
  const cand = s => [s.f + s.r, ...SOUND[s.f].split("").filter(Boolean).map(f => f + s.r)];
  if (sqs.length >= 2) return { type: "move", from: cand(sqs[0]), to: cand(sqs[1]), piece, promo };
  if (sqs.length === 1) return { type: "to", to: cand(sqs[0]), piece, promo };
  const c = T.find(t => t.c);
  if (c) return { type: "cmd", name: c.c };
  if (T.some(t => t.p || /^[1-8]$/.test(t.w) || (t.r && t.w.length >= 3 && !ORDINARY.has(t.w))))
    return { type: "unclear" };
  return null;
}
