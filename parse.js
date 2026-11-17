// Разбор русской речи в шахматные ходы
const FILES = {"а":"a","a":"a","ай":"a","бэ":"b","бе":"b","б":"b","цэ":"c","це":"c","ц":"c","дэ":"d","де":"d","д":"d","е":"e","ее":"e","эф":"f","еф":"f","ф":"f","гэ":"g","ге":"g","г":"g","аш":"h","ха":"h","х":"h","эйч":"h"};
const RANKS = {"один":1,"раз":1,"два":2,"три":3,"четыре":4,"пять":5,"шесть":6,"семь":7,"восемь":8};
const PROMO = {"ферзь":"q","ферзя":"q","ладья":"r","ладью":"r","слон":"b","слона":"b","конь":"n","коня":"n"};
const COMMANDS = {"отмена":"undo","назад":"undo","ошибка":"undo","заново":"new","новая":"new","сброс":"new","повтори":"repeat","повторить":"repeat","белые":"white","черные":"black","выход":"quit","стоп":"quit"};

export function parse(text) {
  const raw = text.toLowerCase();
  let t = text.toLowerCase().replace(/ё/g, "е").replace(/([a-zа-я])(?=\d)/g, "$1 ").replace(/(\d)(?=[a-zа-я])/g, "$1 ").trim();
  if (!t) return null;
  // «едва» -> «е два», «бэтри» -> «бэ три»
  const keys = Object.keys(FILES).sort((a, b) => b.length - a.length);
  const words = [];
  for (const w of t.split(/\s+/)) {
    if (FILES[w] || RANKS[w] || PROMO[w] || COMMANDS[w] || /^[1-8]$/.test(w)) { words.push(w); continue; }
    const k = keys.find(k => w.startsWith(k) && (RANKS[w.slice(k.length)] || /^[1-8]$/.test(w.slice(k.length))));
    if (k) words.push(k, w.slice(k.length)); else words.push(w);
  }
  t = words.join(" ");
  if (words.includes("рокировка") || words.includes("короткая") || words.includes("длинная"))
    return {type: "castle", side: words.includes("длинная") ? "long" : "short"};
  for (const w of words) if (COMMANDS[w]) return {type: "cmd", name: COMMANDS[w]};
  let squares = raw.match(/[a-h][1-8]/g) || [];
  if (!squares.length) {
    let f = null;
    for (const w of words) {
      if (FILES[w]) f = FILES[w];
      else if (f && (RANKS[w] || /^[1-8]$/.test(w))) { squares.push(f + (RANKS[w] || w)); f = null; }
    }
  }
  if (squares.length >= 2) {
    const pw = words.find(w => PROMO[w]);
    return {type: "move", from: squares[0], to: squares[1], promo: pw ? PROMO[pw] : null};
  }
  return null;
}
