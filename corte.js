/* Cortar vídeo: aparar, dividir, apagar trechos e tirar silêncios. O original nunca é alterado. */
(() => {
  const vid = $('cvideo'), linha = $('linha'), ctx = linha.getContext('2d');
  let item, url, dur = 0, partes = [], pilha = [], audio, ondas, tiras = [], vez = 0;
  const MIN = .15; // menor trecho permitido, em segundos

  const tempo = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0').replace('.', ',')}`;
  const mantidos = () => {
    // trechos mantidos, juntando os vizinhos
    const out = [];
    for (const p of partes) if (!p.fora) {
      const u = out.at(-1);
      if (u && p.a - u[1] < .001) u[1] = p.b; else out.push([p.a, p.b]);
    }
    return out;
  };
  const atual = () => partes.find(p => vid.currentTime < p.b - .001) || partes.at(-1);
  const status = t => $('cstatus').textContent = t;

  /* ---------- abrir ---------- */
  self.cortar = async novo => {
    const minha = ++vez;
    item = novo; dur = 0; partes = []; pilha = []; audio = null; ondas = null; tiras = [];
    URL.revokeObjectURL(url); url = URL.createObjectURL(novo.blob);
    go('corte'); $('aviso').hidden = true; status('Abrindo o vídeo…'); botoes();
    vid.src = url;
    try {
      const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('./vendor/mediabunny.min.mjs');
      const input = new Input({ source: new BlobSource(novo.blob), formats: ALL_FORMATS });
      const d = await input.computeDuration();
      if (minha !== vez) return;
      if (!(d > 0)) throw new Error('sem duração');
      dur = d;
      const salvo = novo.cortes;
      partes = salvo?.length && Math.abs(salvo.at(-1).b - d) < .05 ? salvo.map(p => ({ ...p })) : [{ a: 0, b: d, fora: false }];
      // gravações do navegador podem vir sem duração; isso libera o avanço no player
      if (!Number.isFinite(vid.duration)) {
        vid.addEventListener('durationchange', () => { vid.currentTime = 0; }, { once: true });
        vid.currentTime = 1e9;
      }
      status(''); botoes();
      miniaturas(input, CanvasSink, minha).catch(() => {});
      lerSom(novo.blob, minha);
    } catch (e) {
      if (minha === vez) status('Não consegui abrir este vídeo para cortar. Tente um arquivo MP4.');
    }
  };
  async function miniaturas(input, CanvasSink, minha) {
    const v = await input.getPrimaryVideoTrack();
    const sink = new CanvasSink(v, { height: 96 });
    for (let i = 0; i < 8; i++) {
      const r = await sink.getCanvas((i + .5) / 8 * dur);
      if (minha !== vez) return;
      if (r) tiras[i] = r.canvas;
    }
  }
  async function lerSom(blob, minha) {
    let a;
    try { a = await audioCompleto(blob); } catch { return; }
    if (minha !== vez) return;
    audio = a;
    ondas = Array.from({ length: 300 }, (_, i) => {
      let m = 0;
      for (let k = Math.floor(i / 300 * a.length); k < (i + 1) / 300 * a.length; k += 4) m = Math.max(m, Math.abs(a[k] || 0));
      return m;
    });
    const maior = Math.max(...ondas, .01); ondas = ondas.map(x => x / maior);
    botoes();
  }

  /* ---------- desenho da linha do tempo e prévia ---------- */
  function pintar() {
    const W = linha.width, H = linha.height;
    ctx.fillStyle = '#152127'; ctx.fillRect(0, 0, W, H);
    if (!dur) return;
    const x = t => t / dur * W;
    tiras.forEach((c, i) => {
      if (!c) return;
      const lw = W / 8, k = Math.max(lw / c.width, 96 / c.height), cw = lw / k, ch = 96 / k;
      ctx.drawImage(c, (c.width - cw) / 2, (c.height - ch) / 2, cw, ch, i * lw, 0, lw, 96);
    });
    if (ondas) { ctx.fillStyle = '#2dd4bf'; ondas.forEach((m, i) => { const h = Math.max(2, m * 60); ctx.fillRect(i / 300 * W, 130 - h / 2, W / 300 - .5, h); }); }
    for (const p of partes) {
      if (p.fora) {
        ctx.fillStyle = 'rgba(140,20,20,.8)'; ctx.fillRect(x(p.a), 0, x(p.b) - x(p.a), H);
      }
      if (p.a > 0) { ctx.fillStyle = '#fff'; ctx.fillRect(x(p.a) - 1.5, 0, 3, H); }
    }
    const s = atual();
    ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 6; ctx.strokeRect(x(s.a) + 3, 3, Math.max(0, x(s.b) - x(s.a) - 6), H - 6);
    const px = x(Math.min(vid.currentTime, dur));
    ctx.fillStyle = '#ef4444'; ctx.fillRect(px - 3, 0, 6, H);
  }
  let textoAntes = '';
  (function quadro() {
    if (!$('corte').hidden && dur) {
      // a prévia pula os trechos apagados
      if (!vid.paused) {
        const p = partes.find(p => vid.currentTime >= p.a - .02 && vid.currentTime < p.b - .02);
        if (p?.fora) {
          const prox = partes.find(q => !q.fora && q.a >= p.b - .001);
          if (prox) vid.currentTime = prox.a; else vid.pause();
        }
      }
      pintar();
      const s = atual(), fica = mantidos().reduce((n, [a, b]) => n + b - a, 0);
      const texto = `${tempo(Math.min(vid.currentTime, dur))} de ${tempo(dur)} · vai ficar com ${tempo(fica)}`;
      if (texto !== textoAntes) $('ctempo').textContent = textoAntes = texto;
      const trecho = `Trecho marcado: ${tempo(s.a)} a ${tempo(s.b)}${s.fora ? ' (apagado)' : ''}`;
      if ($('ctrecho').textContent !== trecho) $('ctrecho').textContent = trecho;
      $('capagar').lastChild.textContent = s.fora ? 'Restaurar' : 'Apagar trecho';
      $('capagar').firstChild.textContent = s.fora ? '♻️' : '🗑️';
      $('cplay').textContent = vid.paused ? '▶' : '⏸';
    }
    requestAnimationFrame(quadro);
  })();

  const irPara = t => { if (dur) vid.currentTime = Math.max(0, Math.min(dur - .01, t)); };
  const tocarEm = e => {
    const r = linha.getBoundingClientRect();
    vid.pause(); irPara((e.clientX - r.left) / r.width * dur);
  };
  linha.onpointerdown = e => { linha.setPointerCapture(e.pointerId); tocarEm(e); };
  linha.onpointermove = e => { if (linha.hasPointerCapture(e.pointerId)) tocarEm(e); };
  document.querySelectorAll('[data-passo]').forEach(b => b.onclick = () => { vid.pause(); irPara(vid.currentTime + +b.dataset.passo); });
  $('cplay').onclick = () => {
    if (!vid.paused) return vid.pause();
    const m = mantidos();
    if (m.length && vid.currentTime >= m.at(-1)[1] - .05) vid.currentTime = m[0][0];
    vid.play().catch(() => {});
  };

  /* ---------- ferramentas ---------- */
  function botoes() {
    for (const id of ['cini', 'cfim', 'cdiv', 'capagar', 'cplay', 'cgerar', 'ctrechoSo']) $(id).disabled = !dur;
    $('csil').disabled = !audio;
    $('cdesfazer').disabled = !pilha.length;
    $('cinteiro').disabled = !pilha.length && partes.length < 2;
  }
  const guardarCortes = () => { item.cortes = partes.map(p => ({ ...p })); db('readwrite', s => s.put(item)).catch(() => {}); };
  // aplica uma mudança, permitindo desfazer
  function mudar(fn, msg) {
    const antes = JSON.stringify(partes);
    fn();
    if (!partes.some(p => !p.fora)) { partes = JSON.parse(antes); return status('Precisa sobrar pelo menos um trecho do vídeo.'); }
    if (JSON.stringify(partes) === antes) return status('Nada mudou: mova a linha vermelha para outro ponto.');
    pilha.push(antes); guardarCortes(); botoes(); status(msg);
  }
  function dividir(t) {
    const i = partes.findIndex(p => t > p.a + MIN && t < p.b - MIN);
    if (i < 0) return;
    const p = partes[i];
    partes.splice(i, 1, { ...p, b: +t.toFixed(3) }, { ...p, a: +t.toFixed(3) });
  }
  $('cdiv').onclick = () => { vid.pause(); mudar(() => dividir(vid.currentTime), 'Dividido. Toque num trecho para marcá-lo.'); };
  $('cini').onclick = () => {
    vid.pause(); const t = vid.currentTime;
    mudar(() => { dividir(t); partes.forEach(p => { if (p.b <= t + MIN) p.fora = true; }); }, 'O vídeo agora começa neste ponto.');
  };
  $('cfim').onclick = () => {
    vid.pause(); const t = vid.currentTime;
    mudar(() => { dividir(t); partes.forEach(p => { if (p.a >= t - MIN) p.fora = true; }); }, 'O vídeo agora termina neste ponto.');
  };
  $('capagar').onclick = () => { const s = atual(); mudar(() => s.fora = !s.fora, s.fora ? 'Trecho restaurado.' : 'Trecho apagado.'); };
  $('cdesfazer').onclick = () => { if (!pilha.length) return; partes = JSON.parse(pilha.pop()); guardarCortes(); botoes(); status('Desfeito.'); };
  $('cinteiro').onclick = () => mudar(() => partes = [{ a: 0, b: dur, fora: false }], 'Vídeo inteiro de volta.');

  // procura pausas na fala pelo volume do áudio
  function silencios(minimo) {
    const passo = 320; // 20 ms em 16 kHz
    const vol = [];
    for (let i = 0; i < audio.length; i += passo) {
      let s = 0, n = 0;
      for (let k = i; k < i + passo && k < audio.length; k++, n++) s += audio[k] * audio[k];
      vol.push(Math.sqrt(s / n));
    }
    const ordem = [...vol].sort((a, b) => a - b), q = p => ordem[Math.floor(p * (ordem.length - 1))];
    const alto = q(.95);
    if (alto < .005) return [];
    const limite = Math.min(Math.max(q(.1) * 2.5, alto * .06), alto * .25);
    const out = [];
    let ini = null;
    for (let i = 0; i <= vol.length; i++) {
      const quieto = i < vol.length && vol[i] < limite;
      if (quieto && ini === null) ini = i;
      if (!quieto && ini !== null) {
        const a = ini * .02, b = Math.min(i * .02, dur);
        // deixa uma folga para não comer o começo e o fim das palavras
        if (b - a >= minimo) out.push([ini === 0 ? 0 : a + .15, i >= vol.length ? dur : b - .15]);
        ini = null;
      }
    }
    return out;
  }
  $('csil').onclick = () => {
    vid.pause();
    const lista = silencios(+$('cpausa').value).filter(([a, b]) => b - a >= MIN);
    if (!lista.length) return status('Não encontrei silêncios desse tamanho.');
    mudar(() => {
      for (const [a, b] of lista) {
        dividir(a); dividir(b);
        partes.forEach(p => { const meio = (p.a + p.b) / 2; if (meio > a && meio < b) p.fora = true; });
      }
    }, `${lista.length} silêncio(s) apagado(s). Toque em ▶ para conferir; Desfazer volta atrás.`);
  };

  /* ---------- gerar o vídeo ---------- */
  // leva as legendas do original para os novos tempos
  function legendas(trechos) {
    const out = [];
    for (const s of item.segs || []) {
      let base = 0, ini = null, fim = null;
      for (const [a, b] of trechos) {
        const de = Math.max(s.ini, a), ate = Math.min(s.fim, b);
        if (ate - de > .1) { ini ??= base + de - a; fim = base + ate - a; }
        base += b - a;
      }
      if (ini !== null) out.push({ ...s, ini: +ini.toFixed(2), fim: +fim.toFixed(2) });
    }
    return out;
  }
  function gerar(trechos, prefixo) {
    vid.pause();
    if (!self.VideoEncoder || !self.OffscreenCanvas) return status('Este navegador não consegue gerar o corte. Atualize o Chrome e tente de novo.');
    pedirAviso(); manterVivo(true);
    const original = item, w = new Worker('cortador.js', { type: 'module' });
    const fim = () => { w.terminate(); manterVivo(false); $('exportando').hidden = true; cancelarExport = null; };
    const falhar = msg => { fim(); const t = 'Não consegui cortar: ' + msg; status(t); avisar(t); };
    cancelarExport = fim; naTela = false;
    $('exportando').hidden = false; $('perc').textContent = 'Preparando…';
    $('dica').textContent = 'Pode usar outros aplicativos. Não feche o Meu Estúdio.';
    w.onerror = () => falhar('falha ao iniciar.');
    w.onmessage = async ({ data: d }) => {
      if (d.tipo === 'progresso') $('perc').textContent = Math.min(99, Math.round(d.p * 100)) + '%';
      else if (d.tipo === 'erro') falhar(d.msg);
      else if (d.tipo === 'pronto') {
        fim();
        const novo = { id: Date.now(), blob: d.blob, ms: d.ms, info: d.info, titulo: (prefixo + original.titulo).slice(0, 40) };
        const segs = legendas(trechos);
        if (segs.length) novo.segs = segs;
        let guardado = true;
        try { await db('readwrite', s => s.put(novo)); }
        catch { guardado = false; }
        avisar('Vídeo cortado pronto. Toque para abrir.');
        mostrarCorte(novo);
        if (!guardado) informar('Sem espaço para guardar no app. Salve agora o vídeo pronto. (Toque para fechar)');
      }
    };
    w.postMessage({ blob: original.blob, trechos });
  }
  function mostrarCorte(novo) {
    go('pronto');
    $('ptitulo').textContent = 'Vídeo cortado pronto ✅';
    $('pinfo').textContent = `${novo.info} · ${tempo(novo.ms / 1000)}` + (novo.segs ? ' · As legendas entram ao salvar ou compartilhar.' : '');
    URL.revokeObjectURL($('pvideo').src); $('pvideo').src = URL.createObjectURL(novo.blob);
    $('psalvar').onclick = () => novo.segs ? comLegendas(novo, 'salvar') : baixar(novo);
    $('pcompartilhar').onclick = () => novo.segs ? comLegendas(novo, 'compartilhar') : compartilhar(novo);
  }
  $('cgerar').onclick = () => {
    const m = mantidos();
    if (m.length === 1 && m[0][0] < .05 && m[0][1] > dur - .05) return status('Você ainda não cortou nada.');
    gerar(m, 'Cortado: ');
  };
  $('ctrechoSo').onclick = () => { const s = atual(); gerar([[s.a, s.b]], 'Trecho: '); };
})();
