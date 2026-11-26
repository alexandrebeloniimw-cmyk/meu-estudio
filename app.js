const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, v) } catch {} }
};

/* ---------- banco de vídeos no aparelho ---------- */
const dbp = new Promise((ok, no) => {
  const r = indexedDB.open('meu-estudio', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('videos', { keyPath: 'id' });
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
});
async function db(mode, fn) {
  const d = await dbp;
  return new Promise((ok, no) => {
    const t = d.transaction('videos', mode), q = fn(t.objectStore('videos'));
    t.oncomplete = () => ok(q.result); t.onerror = t.onabort = () => no(t.error);
  });
}

/* ---------- telas ---------- */
function go(id) {
  document.querySelectorAll('main section').forEach(s => s.hidden = s.id !== id);
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.go === id));
  if (id !== 'editor') $('lvideo')?.pause();
  if (id === 'projetos') listar();
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));

for (const id of ['script', 'speed', 'size', 'formato', 'espera']) {
  $(id).value = store.get(id, $(id).value);
  $(id).addEventListener('input', () => { store.set(id, $(id).value); aplicar(); });
}
$('mirror').checked = store.get('mirror') === '1';
$('mirror').onchange = () => { store.set('mirror', $('mirror').checked ? '1' : '0'); aplicar(); };
function aplicar() {
  $('ptext').style.fontSize = $('size').value + 'px';
  $('prompter').classList.toggle('mirror', $('mirror').checked);
}

const tipoVideo = () => ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
  .find(t => MediaRecorder.isTypeSupported(t));

/* ---------- estúdio ---------- */
let stream, recorder, chunks = [], facing = 'user', raf, last, pos = 0, ms = 0, state = 'idle', countId, lock;

async function camera() {
  parar();
  const v = $('formato').value === 'v';
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: v ? 1080 : 1920 }, height: { ideal: v ? 1920 : 1080 } },
    audio: { echoCancellation: true, noiseSuppression: true }
  });
  $('cam').srcObject = stream;
  $('cam').classList.toggle('front', facing === 'user');
}
function parar() { stream?.getTracks().forEach(t => t.stop()); stream = null; }

async function abrir(comTexto) {
  const texto = comTexto ? $('script').value.trim() : '';
  $('ptext').textContent = texto;
  $('prompter').hidden = $('sliders').hidden = !texto;
  $('studio').hidden = false; aplicar(); reset();
  try { await camera(); }
  catch (e) { fechar(); alert('Não consegui abrir a câmera. Permita câmera e microfone no navegador. (' + e.name + ')'); }
}
$('abrir').onclick = () => abrir(true);
$('soGravar').onclick = () => abrir(false);

function reset() {
  state = 'idle'; ms = 0; pos = 0; $('prompter').scrollTop = 0; $('count').textContent = '';
  $('rec').textContent = '● Gravar'; $('pausa').textContent = 'Pausar';
  $('pausa').disabled = true; $('virar').disabled = $('fechar').disabled = false; relogio();
}
function relogio() {
  const s = Math.floor(ms / 1000);
  $('timer').textContent = String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function loop(t) {
  const dt = t - last; last = t;
  if (state === 'rec') {
    ms += dt; relogio();
    pos += dt / 1000 * $('speed').value; $('prompter').scrollTop = pos;
  }
  raf = requestAnimationFrame(loop);
}
// permite reposicionar o texto com o dedo
$('prompter').addEventListener('touchend', () => pos = $('prompter').scrollTop);

function contar(n) {
  return new Promise(ok => {
    const tick = () => {
      if (state !== 'count') return;
      if (n <= 0) { $('count').textContent = ''; return ok(); }
      $('count').textContent = n--; countId = setTimeout(tick, 1000);
    };
    tick();
  });
}

$('rec').onclick = async () => {
  if (state === 'rec' || state === 'pause') { recorder.stop(); return; }
  if (state === 'count') { clearTimeout(countId); reset(); return; }
  if (!stream) return;
  state = 'count'; $('virar').disabled = true; $('rec').textContent = 'Cancelar';
  await contar(+$('espera').value);
  const tipo = tipoVideo();
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: tipo, videoBitsPerSecond: 8e6 });
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.onstop = salvar;
  recorder.start(1000);
  state = 'rec'; $('rec').textContent = '■ Parar'; $('pausa').disabled = false; $('fechar').disabled = true;
  last = performance.now(); raf = requestAnimationFrame(loop);
  try { lock = await navigator.wakeLock?.request('screen'); } catch {}
};
$('pausa').onclick = () => {
  if (state === 'rec') { recorder.pause(); state = 'pause'; $('pausa').textContent = 'Continuar'; }
  else if (state === 'pause') { recorder.resume(); state = 'rec'; $('pausa').textContent = 'Pausar'; }
};

async function salvar() {
  cancelAnimationFrame(raf); lock?.release().catch(() => {});
  const blob = new Blob(chunks, { type: recorder.mimeType });
  const item = { id: Date.now(), blob, ms, titulo: ($('ptext').textContent.split('\n')[0] || 'Gravação').slice(0, 40) };
  try { await db('readwrite', s => s.put(item)); fechar(); go('projetos'); }
  catch { baixar(item); fechar(); alert('Sem espaço para salvar no app. O vídeo foi enviado para os downloads.'); }
}
function fechar() { clearTimeout(countId); state = 'idle'; cancelAnimationFrame(raf); parar(); $('studio').hidden = true; }
$('fechar').onclick = fechar;
$('virar').onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; try { await camera(); } catch (e) { alert('Câmera indisponível (' + e.name + ')'); } };

// se o app for para segundo plano, encerra e salva a gravação
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (state === 'rec' || state === 'pause')) recorder.stop();
});

/* ---------- projetos ---------- */
const nome = i => 'estudio-' + i.id + (i.blob.type.includes('webm') ? '.webm' : i.blob.type.includes('quicktime') ? '.mov' : '.mp4');
function baixar(i) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(i.blob); a.download = nome(i); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
let urls = [];
async function listar() {
  const itens = (await db('readonly', s => s.getAll())).reverse();
  urls.forEach(URL.revokeObjectURL); urls = [];
  $('list').replaceChildren(...(itens.length ? itens.map(card) : [Object.assign(document.createElement('p'), { textContent: 'Nenhum vídeo ainda. Grave o primeiro na aba Criar.' })]));
}
function card(i) {
  const el = document.createElement('div'); el.className = 'item';
  const h = document.createElement('b');
  h.textContent = i.titulo + ' · ' + new Date(i.id).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.preload = 'metadata';
  v.src = URL.createObjectURL(i.blob); urls.push(v.src);
  const row = document.createElement('div'); row.className = 'row';
  const btn = (t, f, c) => { const b = document.createElement('button'); b.textContent = t; b.onclick = f; if (c) b.className = c; row.append(b); };
  btn('Salvar', () => baixar(i), 'primary');
  const file = new File([i.blob], nome(i), { type: i.blob.type.split(';')[0] });
  if (navigator.canShare?.({ files: [file] })) btn('Compartilhar', () => navigator.share({ files: [file] }).catch(() => {}));
  btn('Legendas', () => editar(i));
  btn('Apagar', async () => { if (confirm('Apagar este vídeo?')) { await db('readwrite', s => s.delete(i.id)); listar(); } });
  el.append(h, v, row); return el;
}
$('atualizar').onclick = async () => {
  if (!navigator.onLine) return alert('Conecte-se à internet para atualizar.');
  try { await (await navigator.serviceWorker.getRegistration())?.update(); } catch {}
  location.reload();
};
aplicar();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
