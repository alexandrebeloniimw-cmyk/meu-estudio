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
  if (id !== 'pronto') $('pvideo').pause();
  if (id !== 'corte') $('cvideo').pause();
  if (id === 'projetos') listar();
}
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));

function formato(v) {
  $('formato').value = v; store.set('formato', v);
  document.querySelectorAll('[data-formato]').forEach(b => b.setAttribute('aria-pressed', b.dataset.formato === v));
}
document.querySelectorAll('[data-formato]').forEach(b => b.onclick = async () => {
  if (state !== 'idle') return;
  formato(b.dataset.formato);
  if (!$('studio').hidden) { try { await camera(); } catch (e) { alert('Câmera indisponível (' + e.name + ')'); } }
});

for (const id of ['script', 'speed', 'size', 'formato', 'espera']) {
  $(id).value = store.get(id, $(id).value);
  $(id).addEventListener('input', () => { store.set(id, $(id).value); aplicar(); });
}
formato($('formato').value || 'v');
$('formato').onchange = () => formato($('formato').value);
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

let bruto, recorte, pedido = 0;
async function camera() {
  parar();
  const meu = ++pedido, v = $('formato').value === 'v', cam = $('cam');
  const abrirCamera = (w, h) => navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: w }, height: { ideal: h } },
    audio: { echoCancellation: true, noiseSuppression: true }
  });
  const mostrar = async (el, s) => {
    el.srcObject = s;
    await new Promise(ok => { el.onloadedmetadata = ok; });
    await el.play().catch(() => {});
  };
  const soltar = s => s.getTracks().forEach(t => t.stop());
  $('res').textContent = 'abrindo a câmera…';
  // muitos celulares entregam a imagem "deitada": tenta as duas ordens de largura e altura
  for (const [w, h] of v ? [[1080, 1920], [1920, 1080]] : [[1920, 1080], [1080, 1920]]) {
    const s = await abrirCamera(w, h);
    if (meu !== pedido) return soltar(s);
    await mostrar(cam, s);
    if (meu !== pedido) return soltar(s);
    if ((cam.videoHeight > cam.videoWidth) === v) { stream = s; return pronta(cam.videoWidth, cam.videoHeight); }
    soltar(s);
  }
  // último recurso: recorta o centro da imagem no formato escolhido
  const s = await abrirCamera(2560, 1440);
  if (meu !== pedido) return soltar(s);
  const fonte = Object.assign(document.createElement('video'), { muted: true, playsInline: true });
  await mostrar(fonte, s);
  if (meu !== pedido) return soltar(s);
  const fw = fonte.videoWidth, fh = fonte.videoHeight, prop = v ? 9 / 16 : 16 / 9;
  const cw = Math.min(fw, fh * prop), ch = cw / prop, k = Math.min(1, 1920 / Math.max(cw, ch));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(cw * k / 2) * 2, height: Math.round(ch * k / 2) * 2 });
  const ctx = c.getContext('2d', { alpha: false });
  const pintar = () => { ctx.drawImage(fonte, (fw - cw) / 2, (fh - ch) / 2, cw, ch, 0, 0, c.width, c.height); recorte = requestAnimationFrame(pintar); };
  pintar();
  bruto = s; stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...s.getAudioTracks()]);
  await mostrar(cam, stream);
  pronta(c.width, c.height);
}
function pronta(w, h) {
  $('cam').classList.toggle('front', facing === 'user');
  $('res').textContent = (h > w ? 'Vertical ' : 'Horizontal ') + w + '×' + h;
}
function parar() {
  pedido++; cancelAnimationFrame(recorte);
  for (const s of [stream, bruto]) s?.getTracks().forEach(t => t.stop());
  stream = bruto = null;
}

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
  $('pausa').disabled = true; $('virar').disabled = $('fechar').disabled = false; travarFormato(false); relogio();
}
const travarFormato = t => document.querySelectorAll('#studio [data-formato]').forEach(b => b.disabled = t);
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
  state = 'count'; travarFormato(true); $('virar').disabled = true; $('rec').textContent = 'Cancelar';
  await contar(+$('espera').value);
  const tipo = tipoVideo();
  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: tipo, videoBitsPerSecond: 16e6 });
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
  informar(`✅ Vídeo ${i.origem ? 'COM LEGENDAS ' : ''}baixado: ${nome(i)}\nVeja na Galeria → Álbuns → Download. (Toque para fechar)`);
}
function informar(texto) { $('aviso').textContent = texto; $('aviso').hidden = false; }
$('aviso').onclick = () => $('aviso').hidden = true;
function compartilhar(i) {
  const file = new File([i.blob], nome(i), { type: i.blob.type.split(';')[0] || 'video/mp4' });
  if (!navigator.canShare?.({ files: [file] })) return informar('Este navegador não compartilha o vídeo direto. Toque em Salvar e envie pela Galeria. (Toque para fechar)');
  navigator.share({ files: [file] }).catch(e => { if (e.name !== 'AbortError') informar('Não consegui compartilhar. Toque em Salvar e envie pela Galeria. (Toque para fechar)'); });
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
  const legendar = document.createElement('button');
  legendar.textContent = 'Legendas'; legendar.className = 'largo'; legendar.onclick = () => editar(i);
  const tesoura = document.createElement('button');
  tesoura.textContent = '✂️ Cortar'; tesoura.className = 'largo'; tesoura.onclick = () => cortar(i);
  const acoes = Object.assign(document.createElement('div'), { className: 'row' });
  acoes.append(legendar, tesoura);
  el.append(h, v, menu(i, listar), acoes);
  if (i.segs?.length) el.append(Object.assign(document.createElement('p'), { className: 'nota', textContent: 'Salvar e Compartilhar incluem as legendas.' }));
  return el;
}
// menu de ações de um vídeo: salvar, compartilhar e deletar
function menu(i, aoDeletar) {
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'group'); m.setAttribute('aria-label', 'Ações do vídeo');
  const btn = (icone, t, f) => {
    const b = document.createElement('button');
    b.append(Object.assign(document.createElement('span'), { textContent: icone, ariaHidden: 'true' }), t);
    b.onclick = f; m.append(b);
  };
  // com legendas no projeto, o vídeo é primeiro gerado com elas
  btn('💾', 'Salvar', () => temLegendas(i) ? comLegendas(i, 'salvar') : baixar(i));
  btn('📤', 'Compartilhar', () => temLegendas(i) ? comLegendas(i, 'compartilhar') : compartilhar(i));
  btn('🗑️', 'Deletar', async () => {
    if (!confirm('Deletar este vídeo do app? Não dá para desfazer.')) return;
    await db('readwrite', s => s.delete(i.id)); aoDeletar();
  });
  return m;
}
$('atualizar').onclick = async () => {
  if (!navigator.onLine) return alert('Conecte-se à internet para atualizar.');
  try { await (await navigator.serviceWorker.getRegistration())?.update(); } catch {}
  location.reload();
};
aplicar();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
