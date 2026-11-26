/* Legendas: gerar, editar, estilizar e exportar */
let proj, segs = [], urlVid, worker, abortar, rodada = 0, relogioIA, salvarId;
// versões anteriores guardavam outros modelos; usa o padrão atual
if (!['online', 'onnx-community/whisper-base'].includes(store.get('modelo', ''))) store.set('modelo', store.get('chave', '') ? 'online' : 'onnx-community/whisper-base');
$('chave').value = store.get('chave', '');
$('chave').oninput = () => {
  const c = $('chave').value.trim(); store.set('chave', c);
  $('modelo').value = c ? 'online' : 'onnx-community/whisper-base'; store.set('modelo', $('modelo').value);
};
const vid = $('lvideo'), over = $('lover');

for (const id of ['modelo', 'cor', 'tam', 'posi', 'fundo']) {
  $(id).value = store.get(id, $(id).value);
  $(id).addEventListener('input', () => store.set(id, $(id).value));
}

/* ---------- abrir ---------- */
$('importar').onclick = () => $('arquivo').click();
$('arquivo').onchange = async () => {
  const f = $('arquivo').files[0]; $('arquivo').value = '';
  if (!f) return;
  const item = { id: Date.now(), blob: f, ms: 0, titulo: f.name.replace(/\.[^.]+$/, '').slice(0, 40) };
  try { await db('readwrite', s => s.put(item)); }
  catch { alert('Sem espaço para guardar o projeto. Você ainda pode editar e exportar agora.'); }
  editar(item);
};
function editar(item) {
  if ($('gerar').disabled) encerrarIA('');
  proj = item; segs = (item.segs || []).map(s => ({ ...s }));
  URL.revokeObjectURL(urlVid); urlVid = URL.createObjectURL(item.blob);
  vid.src = urlVid; $('status').textContent = ''; $('cancelarIA').hidden = true;
  go('editor'); montar();
}
vid.onloadedmetadata = () => {
  const [w, h] = tamanho(vid);
  over.width = w; over.height = h;
  $('palco').style.aspectRatio = w + ' / ' + h;
  $('palco').style.maxWidth = `calc(55vh * ${w / h})`;
};
vid.onerror = () => { if (vid.getAttribute('src')) $('status').textContent = 'O navegador não conseguiu abrir este vídeo. Tente um arquivo MP4.'; };
function tamanho(v) {
  const w = v.videoWidth || 720, h = v.videoHeight || 1280, k = Math.min(1, 1920 / Math.max(w, h));
  return [Math.round(w * k / 2) * 2, Math.round(h * k / 2) * 2];
}

/* ---------- desenho (desenho.js) ---------- */
const estiloAtual = () => ({ cor: $('cor').value, tam: +$('tam').value, posi: $('posi').value, fundo: $('fundo').value });
(function previa() {
  if (!$('editor').hidden) {
    const c = over.getContext('2d'); c.clearRect(0, 0, over.width, over.height); desenhar(c, vid.currentTime, segs, estiloAtual());
  }
  requestAnimationFrame(previa);
})();

/* ---------- transcrição ---------- */
async function audio16k(blob) {
  const ac = new AudioContext({ sampleRate: 16000 });
  try {
    const b = await ac.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(b.length);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) mono[i] += d[i] / b.numberOfChannels;
    }
    return mono;
  } finally { ac.close(); }
}
// alguns formatos são lidos só em parte pelo navegador; nesse caso, relê bloco a bloco
async function audioCompleto(blob) {
  let audio;
  try { audio = await audio16k(blob); } catch {}
  try {
    const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('./vendor/mediabunny.min.mjs');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const trilha = await input.getPrimaryAudioTrack();
    const dur = await trilha.computeDuration();
    if (audio && audio.length / 16000 >= dur - 1.5) return audio;
    const mono = new Float32Array(Math.ceil(dur * 16000));
    for await (const { buffer: b, timestamp } of new AudioBufferSink(trilha).buffers()) {
      const canais = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
      const ini = Math.round(timestamp * 16000), n = Math.floor(b.duration * 16000);
      for (let i = 0; i < n; i++) {
        const k = ini + i, j = Math.floor(i * b.sampleRate / 16000);
        if (k >= 0 && k < mono.length) mono[k] = canais.reduce((s, d) => s + d[j], 0) / canais.length;
      }
    }
    return mono;
  } catch (e) {
    if (audio) return audio;
    throw e;
  }
}
// divide trechos longos em legendas curtas; o tempo é repartido pelo número de letras
function dividir(chunks, total) {
  const out = [];
  for (const c of chunks) {
    const texto = c.text.trim();
    if (!texto) continue;
    const ini = c.timestamp[0] ?? 0, fim = Math.min(c.timestamp[1] ?? total, total);
    const partes = [''];
    for (const p of texto.split(/\s+/)) {
      const i = partes.length - 1;
      if (partes[i] && (partes[i] + ' ' + p).length > 38) partes.push(p);
      else partes[i] = (partes[i] + ' ' + p).trim();
    }
    const letras = partes.reduce((s, p) => s + p.length, 0);
    let t = ini;
    for (const p of partes) {
      const d = Math.max(fim - ini, .5) * p.length / letras;
      out.push({ ini: +t.toFixed(2), fim: +(t + d).toFixed(2), txt: p }); t += d;
    }
  }
  return out;
}
function encerrarIA(msg) {
  rodada++; clearInterval(relogioIA); worker?.terminate(); worker = null; abortar?.abort(); abortar = null;
  manterVivo(false);
  $('gerar').disabled = false; $('cancelarIA').hidden = true; $('status').textContent = msg;
}
$('cancelarIA').onclick = () => encerrarIA('Geração cancelada.');
$('gerar').onclick = async () => {
  const modelo = $('modelo').value, online = modelo === 'online', chave = store.get('chave', '');
  if (online && !chave) return alert('Para a alta precisão, cole sua chave gratuita da Groq em Config.');
  if (segs.length && !confirm('Substituir as legendas atuais?')) return;
  const alvo = proj, minha = ++rodada, vale = () => rodada === minha;
  $('gerar').disabled = true; $('cancelarIA').hidden = false; $('status').textContent = 'Lendo o áudio…';
  pedirAviso(); manterVivo(true);
  const concluir = (chunks, total, faltam = []) => {
    segs = dividir(chunks, total); montar(); guardar();
    const mm = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    let msg = segs.length ? `${segs.length} legendas criadas, até ${mm(segs.at(-1).fim)} de ${mm(total)} de áudio. Revise o texto.` : 'Nenhuma fala encontrada.';
    if (faltam.length) msg += ' Confira estes trechos sem legenda: ' + faltam.map(([a, b]) => `${mm(a)}–${mm(b)}`).join(', ') + '.';
    encerrarIA(msg); avisar(msg);
  };
  const falhar = msg => { encerrarIA(msg); avisar(msg); };
  let audio;
  try { audio = await audioCompleto(alvo.blob); }
  catch { if (vale()) falhar('Não consegui ler o áudio deste vídeo.'); return; }
  if (!vale()) return;
  const total = audio.length / 16000;
  if (online) {
    abortar = new AbortController();
    try {
      const r = await transcreverOnline(audio, chave, abortar.signal,
        texto => $('status').textContent = texto + ' Pode usar outros aplicativos.');
      if (vale()) concluir(r.chunks, total, r.faltam);
    } catch (e) { if (vale()) falhar('Não deu certo: ' + e.message); }
    return;
  }
  $('status').textContent = 'Preparando… Na primeira vez é preciso internet para baixar o modelo.';
  const w = worker = new Worker('worker.js', { type: 'module' });
  w.onerror = () => falhar('Falha ao iniciar a transcrição. Confira a internet e tente de novo.');
  w.onmessage = ({ data: d }) => {
    if (!vale()) return;
    if (d.tipo === 'baixando') $('status').textContent = `Baixando o modelo (só na primeira vez): ${d.mb.toFixed(0)} MB`;
    else if (d.tipo === 'transcrevendo') {
      const t0 = Date.now();
      const mostrar = () => $('status').textContent = `Transcrevendo no celular… ${Math.round((Date.now() - t0) / 1000)} s. Pode usar outros aplicativos, sem fechar este.`;
      mostrar(); relogioIA = setInterval(mostrar, 1000);
    } else if (d.tipo === 'erro') falhar('Não deu certo: ' + d.msg);
    else if (d.tipo === 'pronto') concluir(d.chunks, total);
  };
  w.postMessage({ audio, modelo }, [audio.buffer]);
};

/* ---------- edição ---------- */
function guardar() {
  clearTimeout(salvarId);
  const alvo = proj, copia = segs.map(s => ({ ...s }));
  salvarId = setTimeout(() => {
    alvo.segs = copia;
    db('readwrite', s => s.put(alvo)).catch(() => $('status').textContent = 'Sem espaço para guardar as legendas.');
  }, 400);
}
function campo(tipo, valor, rotulo, onin) {
  const i = Object.assign(document.createElement('input'), { type: tipo, value: valor });
  i.setAttribute('aria-label', rotulo); if (tipo === 'number') { i.step = '0.1'; i.min = '0'; }
  i.oninput = () => { onin(i.value); guardar(); };
  return i;
}
function montar() {
  $('segs').replaceChildren(...segs.map(s => {
    const el = document.createElement('div'); el.className = 'item seg';
    const txt = campo('text', s.txt, 'Texto da legenda', v => s.txt = v);
    txt.onfocus = () => { vid.pause(); vid.currentTime = s.ini + .01; };
    const row = document.createElement('div'); row.className = 'tempos';
    const x = Object.assign(document.createElement('button'), { textContent: 'Excluir' });
    x.onclick = () => { segs.splice(segs.indexOf(s), 1); montar(); guardar(); };
    row.append('de', campo('number', s.ini, 'Início em segundos', v => s.ini = +v), 'até', campo('number', s.fim, 'Fim em segundos', v => s.fim = +v), x);
    el.append(txt, row); return el;
  }));
}
$('nova').onclick = () => {
  const t = +vid.currentTime.toFixed(1);
  segs.push({ ini: t, fim: +(t + 2.5).toFixed(1), txt: 'Nova legenda' });
  segs.sort((a, b) => a.ini - b.ini); montar(); guardar();
};

/* ---------- exportação ---------- */
const hms = t => {
  const ms = Math.round(t * 1000), p = (n, c = 2) => String(n).padStart(c, '0');
  return `${p(ms / 3600000 | 0)}:${p((ms / 60000 | 0) % 60)}:${p((ms / 1000 | 0) % 60)},${p(ms % 1000, 3)}`;
};
$('srt').onclick = () => {
  if (!segs.length) return alert('Ainda não há legendas.');
  const t = segs.map((s, i) => `${i + 1}\n${hms(s.ini)} --> ${hms(s.fim)}\n${s.txt}\n`).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], { type: 'application/x-subrip' }));
  a.download = proj.titulo.replace(/[^\p{L}\p{N} _-]/gu, '') + '.srt'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};
let cancelarExport, naTela = false;
async function salvarExportado(blob, ms, original) {
  const item = { id: Date.now(), blob, ms, titulo: ('Legendado: ' + original.titulo).slice(0, 40) };
  try { await db('readwrite', s => s.put(item)); go('projetos'); avisar('Vídeo legendado pronto.'); }
  catch { baixar(item); alert('Sem espaço no app. O vídeo foi enviado para os downloads.'); }
}
$('exportar').onclick = () => {
  if (!segs.length) return alert('Gere ou adicione legendas primeiro.');
  vid.pause(); pedirAviso();
  if (!self.VideoEncoder || !self.OffscreenCanvas) return exportarNaTela();
  manterVivo(true);
  const original = proj, w = new Worker('exportador.js', { type: 'module' });
  const fim = () => { w.terminate(); manterVivo(false); $('exportando').hidden = true; cancelarExport = null; };
  const alternativa = () => { fim(); exportarNaTela(); };
  cancelarExport = fim; naTela = false;
  $('exportando').hidden = false; $('perc').textContent = 'Preparando…';
  $('dica').textContent = 'Pode usar outros aplicativos. Não feche o Meu Estúdio.';
  w.onerror = alternativa;
  w.onmessage = async ({ data: d }) => {
    if (d.tipo === 'progresso') $('perc').textContent = Math.min(99, Math.round(d.p * 100)) + '%';
    else if (d.tipo === 'erro') { console.warn(d.msg); alternativa(); }
    else if (d.tipo === 'pronto') { fim(); await salvarExportado(d.blob, d.ms, original); }
  };
  w.postMessage({ blob: original.blob, segs, estilo: estiloAtual() });
};
// plano B para aparelhos sem suporte: grava em tempo real, com o app na tela
async function exportarNaTela() {
  if (document.hidden) { avisar('Abra o app para concluir a exportação.'); await new Promise(ok => document.addEventListener('visibilitychange', ok, { once: true })); }
  naTela = true; $('dica').textContent = 'Modo compatível: mantenha o app na tela até terminar.';
  const v = document.createElement('video'), cv = document.createElement('canvas'), ac = new AudioContext();
  v.className = 'oculto'; v.playsInline = true; v.preload = 'auto'; v.src = urlVid; document.body.append(v);
  let rec, quadro, trava, cancelado = false;
  const limpar = () => {
    cancelAnimationFrame(quadro); v.pause(); v.remove(); ac.close(); trava?.release().catch(() => {});
    $('exportando').hidden = true; cancelarExport = null;
  };
  cancelarExport = () => { cancelado = true; if (rec && rec.state !== 'inactive') rec.stop(); else limpar(); };
  $('exportando').hidden = false; $('perc').textContent = 'Preparando…';
  try {
    const fonte = ac.createMediaElementSource(v), saida = ac.createMediaStreamDestination();
    fonte.connect(saida);
    ac.resume();
    await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; });
    [cv.width, cv.height] = tamanho(v);
    const ctx = cv.getContext('2d');
    const total = () => Number.isFinite(v.duration) ? v.duration : proj.ms / 1000;
    const pintar = () => {
      ctx.drawImage(v, 0, 0, cv.width, cv.height); desenhar(ctx, v.currentTime, segs, estiloAtual());
      $('perc').textContent = total() ? Math.min(99, Math.round(v.currentTime / total() * 100)) + '%' : Math.round(v.currentTime) + ' s';
      quadro = requestAnimationFrame(pintar);
    };
    pintar();
    const fluxo = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...saida.stream.getAudioTracks()]);
    const partes = [];
    rec = new MediaRecorder(fluxo, { mimeType: tipoVideo(), videoBitsPerSecond: 8e6 });
    rec.ondataavailable = e => e.data.size && partes.push(e.data);
    rec.onstop = async () => {
      const dur = v.currentTime * 1000, tipo = rec.mimeType; limpar();
      if (cancelado) return;
      await salvarExportado(new Blob(partes, { type: tipo }), dur, proj);
    };
    v.onended = () => rec.state !== 'inactive' && rec.stop();
    if (cancelado) return;
    await v.play(); rec.start(1000);
    try { trava = await navigator.wakeLock?.request('screen'); } catch {}
  } catch (e) {
    cancelado = true; limpar(); alert('Não consegui exportar este vídeo. (' + (e?.name || 'erro') + ')');
  }
}
$('pararExport').onclick = () => cancelarExport?.();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cancelarExport && naTela) { cancelarExport(); alert('Exportação interrompida: mantenha o app aberto até terminar.'); }
});
