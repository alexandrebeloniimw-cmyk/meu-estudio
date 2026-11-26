/* Editor de vídeo: junta vídeos e fotos, ajusta imagem e velocidade, música, narração, textos e logotipo.
   O trabalho fica salvo no aparelho (rascunho) e os vídeos originais não são alterados. */
(() => {
  const tela = $('etela'), tx = tela.getContext('2d', { alpha: false });
  const camada = document.createElement('canvas'), cx = camada.getContext('2d', { alpha: false });
  const antes = document.createElement('canvas'), ax = antes.getContext('2d', { alpha: false });
  const midias = new Map(); // id -> { blob, url, img, thumb, el }
  const vazio = () => ({ id: 'rascunho', formato: $('formato').value || 'v', clipes: [], textos: [], musica: null, narracao: null, logo: null });
  let proj, sel = 0, t = 0, tocando = false, ultimo = 0, noQuadro = -1, salvarId, gravador, ocupado = false, carregando, aberto = false;
  let somMusica = new Audio(), somNarracao = new Audio();
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const mm = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const seg = s => s.toFixed(1).replace('.', ',') + ' s';
  const total = () => proj.clipes.reduce((s, c) => s + MONTAGEM.dur(c), 0);
  const inicioDe = i => proj.clipes.slice(0, i).reduce((s, c) => s + MONTAGEM.dur(c), 0);
  function achar(tg) {
    let s = 0;
    for (let i = 0; i < proj.clipes.length; i++) {
      const d = MONTAGEM.dur(proj.clipes[i]);
      if (tg < s + d || i === proj.clipes.length - 1) return { i, c: proj.clipes[i], local: Math.max(0, Math.min(d - .001, tg - s)) };
      s += d;
    }
  }
  const aviso = m => $('estatus').textContent = m;

  /* ---------- guardar no aparelho ---------- */
  function guardar() {
    clearTimeout(salvarId);
    salvarId = setTimeout(() => db('readwrite', s => s.put(proj), 'montagens').catch(() => aviso('Sem espaço para guardar o rascunho.')), 400);
  }
  async function novaMidia(blob) {
    const id = uid();
    midias.set(id, { blob, url: URL.createObjectURL(blob) });
    try { await db('readwrite', s => s.put({ id, blob }), 'midias'); }
    catch { aviso('Sem espaço para guardar este arquivo. Gere o vídeo antes de fechar o app.'); }
    return id;
  }
  async function preparar(c) {
    const m = midias.get(c.midia);
    if (c.tipo === 'foto') {
      m.img ||= await createImageBitmap(m.blob, { imageOrientation: 'from-image' });
      m.thumb ||= miniatura(m.img, m.img.width, m.img.height);
    } else if (!m.el) {
      const v = m.el = Object.assign(document.createElement('video'), { src: m.url, playsInline: true, preload: 'auto', className: 'oculto' });
      document.body.append(v);
      v.onloadeddata = () => {
        // gravações do navegador podem vir sem duração; isso libera o avanço no player
        if (!Number.isFinite(v.duration)) { v.addEventListener('durationchange', () => { v.currentTime = c.ini; }, { once: true }); v.currentTime = 1e9; }
        noQuadro = -1;
      };
      v.addEventListener('seeked', () => {
        if (!m.thumb && v.videoWidth) { m.thumb = miniatura(v, v.videoWidth, v.videoHeight); montarClipes(); }
      });
      v.addEventListener('loadeddata', () => { v.currentTime = c.ini + .05; }, { once: true });
    }
  }
  function miniatura(fonte, w, h) {
    const c = Object.assign(document.createElement('canvas'), { width: 120, height: 120 }), k = Math.max(120 / w, 120 / h);
    c.getContext('2d').drawImage(fonte, (120 - w * k) / 2, (120 - h * k) / 2, w * k, h * k);
    return c.toDataURL('image/jpeg', .7);
  }
  function carregar() {
    return carregando ||= (async () => {
      proj = await db('readonly', s => s.get('rascunho'), 'montagens').catch(() => null) || vazio();
      const usadas = new Set([...proj.clipes.flatMap(c => [c.midia, c.fundo?.midia]), proj.musica?.midia, proj.narracao?.midia, proj.logo?.midia]);
      const salvas = await db('readonly', s => s.getAll(), 'midias').catch(() => []);
      for (const m of salvas) {
        if (usadas.has(m.id)) midias.set(m.id, { blob: m.blob, url: URL.createObjectURL(m.blob) });
        else db('readwrite', s => s.delete(m.id), 'midias').catch(() => {});
      }
      proj.clipes = proj.clipes.filter(c => midias.has(c.midia));
      for (const k of ['musica', 'narracao', 'logo']) if (proj[k] && !midias.has(proj[k].midia)) proj[k] = null;
      for (const c of proj.clipes) await preparar(c).catch(() => {});
      await Promise.all(proj.textos.map(x => carregarFonte(x.fonte)));
      for (const c of proj.clipes) if (c.fundo?.midia) await fotoDeFundo(c.fundo.midia);
      if (proj.logo) midias.get(proj.logo.midia).img = await createImageBitmap(midias.get(proj.logo.midia).blob);
      ligarSons();
      aberto = true;
    })();
  }
  function ligarSons() {
    for (const [el, k] of [[somMusica, 'musica'], [somNarracao, 'narracao']]) {
      el.pause();
      if (proj[k]) el.src = midias.get(proj[k].midia).url; else el.removeAttribute('src');
    }
  }
  self.abrirEditor = async item => {
    go('montar');
    await carregar();
    if (item) await adicionarVideo(item.blob, item.titulo);
    atualizar();
  };

  /* ---------- adicionar ---------- */
  const base = (tipo, midia, nome) => ({ id: uid(), tipo, midia, nome, vel: 1, giro: 0, encaixe: 'preencher', filtro: 'normal', brilho: 100, contraste: 100, saturacao: 100, volume: 100, transicao: 'nenhuma' });
  async function adicionarVideo(blob, nome) {
    const { Input, BlobSource, ALL_FORMATS } = await import('./vendor/mediabunny.min.mjs');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    let dur = 0;
    try { if (await input.getPrimaryVideoTrack()) dur = await input.computeDuration(); } catch {}
    if (!(dur > .1)) return aviso(`Não consegui abrir “${nome}”. Use vídeo MP4 ou WebM.`);
    const midia = await novaMidia(blob);
    const c = { ...base('video', midia, nome), total: dur, ini: 0, fim: dur };
    await preparar(c); inserir(c);
  }
  async function adicionarFoto(blob, nome) {
    const midia = await novaMidia(blob), c = { ...base('foto', midia, nome), dur: 4, movimento: true };
    try { await preparar(c); } catch { midias.delete(midia); return aviso(`Não consegui abrir a foto “${nome}”.`); }
    inserir(c);
  }
  function inserir(c) { proj.clipes.push(c); sel = proj.clipes.length - 1; t = inicioDe(sel); guardar(); atualizar(); }
  $('earquivo').onchange = async () => {
    const arquivos = [...$('earquivo').files]; $('earquivo').value = '';
    ocupado = true;
    for (const [n, f] of arquivos.entries()) {
      aviso(`Adicionando ${n + 1} de ${arquivos.length}…`);
      if (f.type.startsWith('image/')) await adicionarFoto(f, f.name); else await adicionarVideo(f, f.name.replace(/\.[^.]+$/, ''));
    }
    ocupado = false;
    if ($('estatus').textContent.startsWith('Adicionando')) aviso('');
  };
  $('eprojetos').onchange = async () => {
    const id = +$('eprojetos').value; $('eprojetos').value = '';
    const item = id && await db('readonly', s => s.get(id));
    if (item) await adicionarVideo(item.blob, item.titulo);
  };
  async function listarProjetos() {
    const itens = (await db('readonly', s => s.getAll())).reverse();
    $('eprojetos').replaceChildren(new Option('Adicionar um vídeo dos Projetos…', ''),
      ...itens.map(i => new Option(`${i.titulo} · ${new Date(i.id).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`, i.id)));
    $('eprojetos').hidden = !itens.length;
  }

  /* ---------- fundo (recorte da pessoa) ---------- */
  const fundoPadrao = () => ({ tipo: 'original', cor: '#12275a', pronto: 'estudio', forca: 40, ajuste: 50, borda: 30, midia: null });
  const comRecorte = c => c?.tipo === 'video' && c.fundo && c.fundo.tipo !== 'original';
  const LIMITE = 60; // segundos de vídeo com troca de fundo em cada montagem
  const usoRecorte = (clipes = proj.clipes) => clipes.filter(comRecorte).reduce((s, c) => s + MONTAGEM.dur(c), 0);
  const passou = s => s > LIMITE + .05;
  const msgLimite = s => `O limite para remover o fundo é de 1 minuto e este vídeo ficaria com ${seg(s)}. Apare ou divida o clipe.`;
  function mostrarLimite() {
    const s = usoRecorte();
    $('flimite').textContent = `Limite de 1 minuto por montagem. Em uso: ${seg(s)}.` + (passou(s) ? ' Apare os clipes para poder gerar.' : '');
    $('flimite').style.color = passou(s) ? 'var(--rec)' : '';
  }
  let recortador, preparandoRecorte, chaveRecorte = '', mascara, falhaRecorte = false;
  async function fotoDeFundo(id) {
    const m = midias.get(id);
    if (m) m.img ||= await createImageBitmap(m.blob, { imageOrientation: 'from-image' }).catch(() => undefined);
  }
  function ligarRecorte() {
    if (recortador || preparandoRecorte) return;
    falhaRecorte = false; aviso('Preparando o removedor de fundo… Na primeira vez baixa cerca de 15 MB.');
    preparandoRecorte = RECORTE.criar().then(r => { recortador = r; chaveRecorte = ''; aviso(''); })
      .catch(e => { console.warn(e); falhaRecorte = true; aviso('Não consegui ligar o removedor de fundo. Confira a internet e toque de novo na opção de fundo.'); })
      .finally(() => preparandoRecorte = null);
  }
  function recorteDaPrevia(c, w, h, fonte, instante) {
    if (!comRecorte(c)) return;
    if (!recortador) { if (!falhaRecorte) ligarRecorte(); return; }
    // só recalcula quando a imagem ou o ajuste mudam
    const chave = [c.id, instante.toFixed(3), c.fundo.ajuste, c.fundo.borda].join();
    if (chave !== chaveRecorte) {
      if (!tocando) recortador.esquecer();
      try { mascara = recortador.processar(w, h, (x, ...r) => x.drawImage(fonte, ...r), c.fundo.ajuste, c.fundo.borda); chaveRecorte = chave; }
      catch (e) { console.warn(e); return; }
    }
    return { mascara, foto: c.fundo.midia && midias.get(c.fundo.midia)?.img };
  }
  function montarFundo(c) {
    const f = c.fundo || fundoPadrao();
    $('f-tipo').value = f.tipo; $('f-cor').value = f.cor; $('f-pronto').value = f.pronto;
    for (const k of ['forca', 'ajuste', 'borda']) $('f-' + k).value = f[k];
    $('fo-cor').hidden = f.tipo !== 'cor'; $('fo-pronto').hidden = f.tipo !== 'pronto'; $('fo-foto').hidden = f.tipo !== 'foto'; $('fo-desfoque').hidden = f.tipo !== 'desfoque';
    $('fo-ajustes').hidden = f.tipo === 'original';
    $('efundofoto').textContent = f.midia ? 'Trocar a foto de fundo' : 'Escolher foto de fundo';
    mostrarLimite();
  }
  for (const k of ['tipo', 'cor', 'pronto', 'forca', 'ajuste', 'borda']) $('f-' + k).addEventListener('input', () => {
    const c = proj.clipes[sel]; if (!c) return;
    pausar();
    const v = $('f-' + k).value;
    if (k === 'tipo' && v !== 'original' && !comRecorte(c)) {
      const s = usoRecorte() + MONTAGEM.dur(c);
      if (passou(s)) { montarFundo(c); return aviso(msgLimite(s)); }
      aviso('');
    }
    c.fundo = { ...(c.fundo || fundoPadrao()), [k]: ['forca', 'ajuste', 'borda'].includes(k) ? +v : v };
    if (comRecorte(c)) { falhaRecorte = false; ligarRecorte(); }
    if (achar(t).i !== sel) t = inicioDe(sel) + Math.min(.8, MONTAGEM.dur(c) / 2);
    noQuadro = -1; guardar(); montarFundo(c);
    if (k === 'tipo' && v === 'foto' && !c.fundo.midia) aviso('Agora escolha a foto de fundo.');
  });
  $('efundofoto').onclick = () => $('earqfundo').click();
  $('earqfundo').onchange = async () => {
    const f = $('earqfundo').files[0], c = proj.clipes[sel]; $('earqfundo').value = '';
    if (!f || !c) return;
    const novo = usoRecorte() + (comRecorte(c) ? 0 : MONTAGEM.dur(c));
    if (!comRecorte(c) && passou(novo)) return aviso(msgLimite(novo));
    const midia = await novaMidia(f);
    await fotoDeFundo(midia);
    if (!midias.get(midia).img) return aviso('Não consegui abrir esta imagem. Use JPG ou PNG.');
    c.fundo = { ...(c.fundo || fundoPadrao()), tipo: 'foto', midia };
    ligarRecorte(); noQuadro = -1; guardar(); montarFundo(c);
  };
  $('efundotodos').onclick = () => {
    const f = proj.clipes[sel].fundo || fundoPadrao();
    const s = f.tipo === 'original' ? 0 : proj.clipes.filter(x => x.tipo === 'video').reduce((s, x) => s + MONTAGEM.dur(x), 0);
    if (passou(s)) return aviso(msgLimite(s));
    for (const x of proj.clipes) if (x.tipo === 'video') x.fundo = { ...f };
    guardar(); mostrarLimite(); aviso('Fundo aplicado a todos os vídeos.');
  };

  /* ---------- prévia ---------- */
  function ajustarTela() {
    const [pw, ph] = MONTAGEM.proporcao[proj.formato], k = 540 / Math.min(pw, ph);
    const w = Math.round(pw * k), h = Math.round(ph * k);
    const largura = `calc(34vh * ${pw / ph})`;
    if (tela.style.maxWidth !== largura) tela.style.maxWidth = largura;
    // as camadas começam com outro tamanho; só redimensiona quando muda
    for (const c of [tela, camada, antes]) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }
  function pausar() {
    tocando = false;
    for (const m of midias.values()) m.el?.pause();
    somMusica.pause(); somNarracao.pause();
    if (gravador?.state === 'recording') gravador.stop();
  }
  self.pausarEditor = () => pausar();
  function tocar() {
    if (!proj.clipes.length) return;
    if (t >= total() - .05) t = 0;
    tocando = true; ultimo = performance.now();
  }
  // mantém um som separado (música ou narração) no ponto certo
  function sincronizar(el, deve, ponto, volume) {
    if (!deve || !tocando) return el.paused || el.pause();
    el.volume = Math.max(0, Math.min(1, volume));
    const d = el.duration, alvo = Number.isFinite(d) && d ? ponto % d : ponto;
    if (Math.abs(el.currentTime - alvo) > .4) el.currentTime = alvo;
    if (el.paused) el.play().catch(() => {});
  }
  function quadro(agora) {
    requestAnimationFrame(quadro);
    if ($('montar').hidden || !aberto) return;
    ajustarTela();
    const passo = Math.min(.1, (agora - ultimo) / 1000); ultimo = agora;
    if (!proj.clipes.length) {
      tx.fillStyle = '#0a1330'; tx.fillRect(0, 0, tela.width, tela.height);
      tx.fillStyle = '#c6d4fa'; tx.font = '600 30px system-ui'; tx.textAlign = 'center'; tx.fillText('Adicione vídeos ou fotos', tela.width / 2, tela.height / 2);
      return;
    }
    const tt = total();
    t = Math.max(0, Math.min(tt - .001, t));
    const { i, c, local } = achar(t), m = midias.get(c.midia);
    if (noQuadro !== i) {
      // guarda o último quadro do clipe anterior para a transição
      if (i === noQuadro + 1 && noQuadro >= 0) { ax.drawImage(camada, 0, 0); antes.de = i; } else antes.de = null;
      for (const x of midias.values()) if (x !== m) x.el?.pause();
      noQuadro = i;
    }
    let pronto = true, w = 0, h = 0, fonte;
    if (c.tipo === 'foto') { fonte = m.img; w = fonte?.width; h = fonte?.height; }
    else {
      const v = fonte = m.el, alvo = c.ini + local * c.vel;
      w = v.videoWidth; h = v.videoHeight;
      v.playbackRate = c.vel; v.volume = Math.min(1, c.volume / 100); v.muted = c.volume === 0 || gravador?.state === 'recording';
      if (!v.seeking && Math.abs(v.currentTime - alvo) > (tocando ? .35 : .04)) v.currentTime = alvo;
      pronto = v.readyState >= 2 && !v.seeking;
      if (tocando && v.paused && pronto) v.play().catch(() => {});
      if (!tocando && !v.paused) v.pause();
    }
    if (c.tipo === 'foto' || m.el.readyState >= 2)
      MONTAGEM.clipe(cx, c, w, h, (x, ...r) => x.drawImage(fonte, ...r), local, antes.de === i ? antes : null, proj.clipes[i + 1],
        c.tipo === 'video' ? recorteDaPrevia(c, w, h, fonte, fonte.currentTime) : undefined);
    tx.drawImage(camada, 0, 0);
    MONTAGEM.sobrepor(tx, t, proj.textos, proj.logo, proj.logo && midias.get(proj.logo.midia).img);
    const mu = proj.musica, na = proj.narracao, gravando = gravador?.state === 'recording';
    sincronizar(somMusica, mu && !gravando, (mu?.inicio || 0) + t, (mu?.volume || 0) / 100 * (mu?.abaixar && (c.tipo === 'video' && c.volume > 0 || na && t >= na.inicio) ? .4 : 1));
    sincronizar(somNarracao, na && !gravando && t >= na.inicio && !(t - na.inicio > somNarracao.duration), t - (na?.inicio || 0), (na?.volume || 0) / 100);
    if (tocando && pronto) {
      t += passo;
      if (t >= tt) { t = tt - .001; pausar(); }
    }
    if (document.activeElement !== $('eposicao')) { $('eposicao').max = tt; $('eposicao').value = t; }
    const rotulo = `${mm(t)} / ${mm(tt)}`;
    if ($('etempo').textContent !== rotulo) $('etempo').textContent = rotulo;
    $('etocar').querySelector('use').setAttribute('href', tocando ? '#i-pausar' : '#i-tocar');
  }
  requestAnimationFrame(quadro);
  $('etocar').onclick = () => tocando ? pausar() : tocar();
  $('eposicao').oninput = () => { pausar(); t = +$('eposicao').value; const a = achar(t); if (a && a.i !== sel) { sel = a.i; montarClipes(); montarPainel(); } };

  /* ---------- clipes e painel ---------- */
  function montarClipes() {
    const itens = proj.clipes.map((c, i) => {
      const b = document.createElement('button'); b.className = 'clipe'; b.setAttribute('aria-pressed', i === sel);
      b.setAttribute('aria-label', `Clipe ${i + 1}: ${c.nome}`);
      const m = midias.get(c.midia);
      if (m.thumb) b.style.backgroundImage = `url(${m.thumb})`;
      b.append(Object.assign(document.createElement('span'), { textContent: `${i + 1} · ${seg(MONTAGEM.dur(c))}` }));
      b.onclick = () => { pausar(); sel = i; t = inicioDe(i) + (i && c.transicao !== 'nenhuma' ? .6 : 0); montarClipes(); montarPainel(); };
      return b;
    });
    const mais = document.createElement('button'); mais.className = 'clipe mais'; mais.id = 'emais';
    mais.append(icone('mais'), 'Adicionar'); mais.onclick = () => $('earquivo').click();
    $('eclipes').replaceChildren(...itens, mais);
    $('eclipes').children[sel]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('eresumo').textContent = proj.clipes.length ? `${proj.clipes.length} clipe(s) · duração ${mm(total())}` : 'Adicione pelo menos um vídeo ou foto.';
    $('egerar').disabled = !proj.clipes.length;
    $('egravar').disabled = !proj.clipes.length;
  }
  function montarPainel() {
    const c = proj.clipes[sel];
    $('esemclipe').hidden = !!c; $('eclipe').hidden = !c;
    if (!c) return;
    $('enome').textContent = `Clipe ${sel + 1}: ${c.nome}`;
    $('evideo').hidden = c.tipo === 'foto'; $('efoto').hidden = c.tipo !== 'foto'; $('esom').hidden = c.tipo === 'foto';
    if (c.tipo === 'video') {
      for (const k of ['ini', 'fim']) { $('c-' + k).max = c.total; $('c-' + k).value = c[k]; }
      $('v-ini').textContent = seg(c.ini); $('v-fim').textContent = seg(c.fim);
    }
    for (const k of ['dur', 'vel', 'volume', 'filtro', 'brilho', 'contraste', 'saturacao', 'encaixe', 'transicao']) if (c[k] !== undefined) $('c-' + k).value = c[k];
    $('c-movimento').checked = !!c.movimento;
    $('efundo').hidden = c.tipo === 'foto';
    if (c.tipo === 'video') { montarFundo(c); if (comRecorte(c)) ligarRecorte(); }
    rotulos(c);
    $('eantes').disabled = sel === 0; $('edepois').disabled = sel === proj.clipes.length - 1;
    $('c-transicao').disabled = sel === 0;
  }
  function rotulos(c) {
    if (c.tipo === 'foto') $('v-dur').textContent = seg(c.dur);
    for (const k of ['volume', 'brilho', 'contraste', 'saturacao']) $('v-' + k).textContent = c[k] + '%';
  }
  for (const k of ['ini', 'fim', 'dur', 'vel', 'volume', 'filtro', 'brilho', 'contraste', 'saturacao', 'encaixe', 'transicao']) {
    $('c-' + k).addEventListener('input', () => {
      const c = proj.clipes[sel]; if (!c) return;
      pausar();
      let v = $('c-' + k).value;
      if (!['filtro', 'encaixe', 'transicao'].includes(k)) v = +v;
      if (k === 'ini') { v = Math.min(v, c.fim - .2); c.ini = Math.max(0, v); $('v-ini').textContent = seg(c.ini); t = inicioDe(sel) + .001; }
      else if (k === 'fim') { c.fim = Math.min(c.total, Math.max(v, c.ini + .2)); $('v-fim').textContent = seg(c.fim); t = inicioDe(sel) + MONTAGEM.dur(c) - .05; }
      else c[k] = v;
      if (k === 'transicao') { t = inicioDe(Math.max(0, sel)) - .5; noQuadro = -1; guardar(); montarClipes(); return tocar(); }
      rotulos(c); guardar(); mostrarLimite();
      if (['ini', 'fim', 'dur', 'vel'].includes(k)) montarClipes();
    });
  }
  $('c-movimento').onchange = () => { proj.clipes[sel].movimento = $('c-movimento').checked; guardar(); };
  $('egirar').onclick = () => { const c = proj.clipes[sel]; c.giro = (c.giro + 90) % 360; guardar(); aviso(`Imagem girada: ${c.giro}°`); };
  $('etodos').onclick = () => {
    const c = proj.clipes[sel];
    for (const x of proj.clipes) for (const k of ['filtro', 'brilho', 'contraste', 'saturacao']) x[k] = c[k];
    guardar(); aviso('Filtro e ajustes aplicados a todos os clipes.');
  };
  const refazer = () => { noQuadro = -1; guardar(); montarClipes(); montarPainel(); };
  const mover = d => { pausar(); const l = proj.clipes; [l[sel], l[sel + d]] = [l[sel + d], l[sel]]; sel += d; t = inicioDe(sel); refazer(); };
  $('eantes').onclick = () => mover(-1);
  $('edepois').onclick = () => mover(1);
  $('eduplicar').onclick = () => { pausar(); proj.clipes.splice(sel + 1, 0, { ...proj.clipes[sel], id: uid() }); sel++; t = inicioDe(sel); refazer(); };
  $('eremover').onclick = () => {
    if (!confirm('Tirar este clipe da montagem?')) return;
    pausar(); proj.clipes.splice(sel, 1); sel = Math.max(0, Math.min(sel, proj.clipes.length - 1)); t = inicioDe(sel); refazer();
  };
  $('edividir').onclick = () => {
    pausar();
    const a = achar(t), c = a.c, d = MONTAGEM.dur(c);
    if (a.local < .2 || a.local > d - .2) return aviso('Leve a barra até o meio do clipe e toque em Dividir.');
    const outro = { ...c, id: uid(), transicao: 'nenhuma' };
    if (c.tipo === 'foto') { outro.dur = d - a.local; c.dur = a.local; }
    else { outro.ini = c.ini + a.local * c.vel; c.fim = outro.ini; }
    proj.clipes.splice(a.i + 1, 0, outro); sel = a.i + 1; aviso('Clipe dividido.'); refazer();
  };
  $('enovo').onclick = async () => {
    if (proj.clipes.length && !confirm('Começar uma montagem nova? A atual será apagada (os Projetos continuam).')) return;
    pausar();
    for (const m of midias.values()) { m.el?.remove(); URL.revokeObjectURL(m.url); }
    midias.clear(); proj = vazio(); sel = 0; t = 0; noQuadro = -1;
    await db('readwrite', s => s.clear(), 'midias').catch(() => {});
    ligarSons(); guardar(); atualizar(); aviso('');
  };
  document.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => {
    document.querySelectorAll('[data-aba]').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('[data-painel]').forEach(p => p.hidden = p.dataset.painel !== b.dataset.aba);
    aviso('');
  });

  /* ---------- textos ---------- */
  function montarTextos() {
    $('etextos').replaceChildren(...proj.textos.map(x => {
      const el = document.createElement('div'); el.className = 'cartao';
      const campo = (rotulo, input, chave, num) => {
        const l = document.createElement('label'); l.append(rotulo, input); input.value = x[chave];
        input.addEventListener('input', async () => {
          x[chave] = num ? +input.value : input.value; guardar();
          if (chave === 'fonte') await carregarFonte(x.fonte);
          if (chave !== 'txt' && chave !== 'tam') t = Math.min(total() - .01, x.ini + (chave === 'anim' ? 0 : Math.min(1, (x.fim - x.ini) / 2)));
          if (chave === 'anim') tocar();
        });
        return l;
      };
      const lista = origem => { const s = document.createElement('select'); s.innerHTML = $(origem).innerHTML; return s; };
      const numero = () => Object.assign(document.createElement('input'), { type: 'number', step: '0.5', min: '0', className: 'numero' });
      const texto = Object.assign(document.createElement('input'), { type: 'text', className: 'texto' });
      texto.onfocus = () => { pausar(); t = x.ini + Math.min(1, (x.fim - x.ini) / 2); };
      const grade = Object.assign(document.createElement('div'), { className: 'campos' });
      grade.append(campo('Aparece em (s)', numero(), 'ini', true), campo('Some em (s)', numero(), 'fim', true),
        campo('Fonte', lista('fonte'), 'fonte'), campo('Animação', lista('anim'), 'anim'), campo('Cor', lista('cor'), 'cor'),
        campo('Fundo', lista('fundo'), 'fundo'), campo('Posição', lista('posi'), 'posi'),
        campo('Tamanho', Object.assign(document.createElement('input'), { type: 'range', min: 3, max: 14, step: .5 }), 'tam', true));
      const fora = Object.assign(document.createElement('button'), { className: 'largo perigo', textContent: 'Excluir este texto' });
      fora.onclick = () => { proj.textos.splice(proj.textos.indexOf(x), 1); guardar(); montarTextos(); };
      el.append(campo('Texto', texto, 'txt'), grade, fora);
      return el;
    }));
  }
  $('enovotexto').onclick = async () => {
    pausar();
    const ini = +Math.max(0, t).toFixed(1);
    proj.textos.push({ txt: 'Seu título aqui', ini, fim: +(ini + 4).toFixed(1), fonte: 'montserrat', anim: 'surgir', cor: '#ffffff', fundo: 'contorno', posi: 'meio', tam: 8 });
    await carregarFonte('montserrat'); t = ini + 1; guardar(); montarTextos();
  };

  /* ---------- música e narração ---------- */
  function montarAudio() {
    const m = proj.musica, n = proj.narracao;
    $('emusicaop').hidden = !m; $('enarraop').hidden = !n;
    $('emusicanome').textContent = m ? m.nome : 'Nenhuma música escolhida.';
    if (m) { $('m-volume').value = m.volume; $('v-mvolume').textContent = m.volume + '%'; $('m-inicio').value = m.inicio; $('m-abaixar').checked = m.abaixar; }
    if (n) { $('n-volume').value = n.volume; $('v-nvolume').textContent = n.volume + '%'; $('n-inicio').value = n.inicio; }
  }
  $('emusica').onclick = () => $('earqmusica').click();
  $('earqmusica').onchange = async () => {
    const f = $('earqmusica').files[0]; $('earqmusica').value = '';
    if (!f) return;
    proj.musica = { midia: await novaMidia(f), nome: f.name, volume: 30, inicio: 0, abaixar: true };
    ligarSons(); guardar(); montarAudio();
  };
  $('m-volume').oninput = () => { proj.musica.volume = +$('m-volume').value; $('v-mvolume').textContent = proj.musica.volume + '%'; guardar(); };
  $('m-inicio').oninput = () => { proj.musica.inicio = Math.max(0, +$('m-inicio').value || 0); guardar(); };
  $('m-abaixar').onchange = () => { proj.musica.abaixar = $('m-abaixar').checked; guardar(); };
  $('esemmusica').onclick = () => { proj.musica = null; ligarSons(); guardar(); montarAudio(); };
  $('n-volume').oninput = () => { proj.narracao.volume = +$('n-volume').value; $('v-nvolume').textContent = proj.narracao.volume + '%'; guardar(); };
  $('n-inicio').oninput = () => { proj.narracao.inicio = Math.max(0, +$('n-inicio').value || 0); guardar(); };
  $('esemnarra').onclick = () => { proj.narracao = null; ligarSons(); guardar(); montarAudio(); };
  const botaoGravar = texto => $('egravar').querySelector('span').textContent = texto;
  $('egravar').onclick = async () => {
    if (gravador?.state === 'recording') return pausar();
    if (proj.narracao && !confirm('Substituir a narração atual?')) return;
    pausar();
    let mic;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { return aviso('Permita o uso do microfone para narrar.'); }
    if (t >= total() - .5) t = 0;
    const inicio = +t.toFixed(2), partes = [];
    const g = gravador = new MediaRecorder(mic);
    g.ondataavailable = e => e.data.size && partes.push(e.data);
    g.onstop = async () => {
      mic.getTracks().forEach(x => x.stop()); botaoGravar('Gravar narração');
      proj.narracao = { midia: await novaMidia(new Blob(partes, { type: g.mimeType })), inicio, volume: 100 };
      ligarSons(); guardar(); montarAudio(); aviso('Narração gravada. Toque em tocar para ouvir.');
    };
    g.start(500); botaoGravar('Parar narração'); aviso('Gravando… fale enquanto o vídeo passa.'); tocar();
  };

  /* ---------- logotipo ---------- */
  function montarLogo() {
    const l = proj.logo;
    $('elogoop').hidden = !l;
    if (l) { $('l-posi').value = l.posi; $('l-tam').value = l.tam; $('l-opac').value = l.opac; }
  }
  $('elogo').onclick = () => $('earqlogo').click();
  $('earqlogo').onchange = async () => {
    const f = $('earqlogo').files[0]; $('earqlogo').value = '';
    if (!f) return;
    let img;
    try { img = await createImageBitmap(f); } catch { return aviso('Não consegui abrir esta imagem. Use PNG ou JPG.'); }
    const midia = await novaMidia(f); midias.get(midia).img = img;
    proj.logo = { midia, posi: 'sd', tam: 22, opac: 100 }; guardar(); montarLogo();
  };
  for (const k of ['posi', 'tam', 'opac']) $('l-' + k).addEventListener('input', () => { proj.logo[k] = k === 'posi' ? $('l-' + k).value : +$('l-' + k).value; guardar(); });
  $('esemlogo').onclick = () => { proj.logo = null; guardar(); montarLogo(); };

  /* ---------- gerar o vídeo ---------- */
  $('e-formato').onchange = () => { proj.formato = $('e-formato').value; guardar(); };
  function atualizar() {
    $('e-formato').value = proj.formato;
    sel = Math.max(0, Math.min(sel, proj.clipes.length - 1)); noQuadro = -1;
    montarClipes(); montarPainel(); montarTextos(); montarAudio(); montarLogo(); listarProjetos();
  }
  $('egerar').onclick = () => {
    if (ocupado) return aviso('Aguarde terminar de adicionar os arquivos.');
    pausar();
    if (!self.VideoEncoder || !self.OffscreenCanvas) return aviso('Este navegador não consegue gerar o vídeo. Atualize o Chrome e tente de novo.');
    const uso = usoRecorte();
    if (passou(uso)) { informar(msgLimite(uso) + ' (Toque para fechar)'); return aviso(msgLimite(uso)); }
    let comeco = 0;
    const arquivos = {};
    for (const [id, m] of midias) arquivos[id] = m.blob;
    pedirAviso(); manterVivo(true);
    const w = new Worker('montador.js', { type: 'module' });
    const fim = () => { w.terminate(); manterVivo(false); $('exportando').hidden = true; cancelarExport = null; };
    const falhar = msg => { fim(); const m = 'Não consegui gerar o vídeo: ' + msg; aviso(m); avisar(m); };
    cancelarExport = fim; naTela = false;
    $('exportando').hidden = false; $('perc').textContent = 'Preparando…';
    $('dica').textContent = 'Pode usar outros aplicativos. Não feche o Meu Estúdio.';
    w.onerror = () => falhar('falha ao iniciar.');
    w.onmessage = async ({ data: d }) => {
      if (d.tipo === 'progresso') {
        $('perc').textContent = Math.min(99, Math.round(d.p * 100)) + '%';
        comeco ||= Date.now() - 1;
        const resta = (Date.now() - comeco) / 1000 * (1 - d.p) / d.p;
        if (d.p > .05) $('dica').textContent = `Faltam cerca de ${resta < 90 ? Math.ceil(resta / 5) * 5 + ' segundos' : Math.ceil(resta / 60) + ' minutos'}. Não feche o Meu Estúdio.`;
      }
      else if (d.tipo === 'erro') falhar(d.msg);
      else if (d.tipo === 'pronto') {
        fim();
        const novo = { id: Date.now(), blob: d.blob, ms: d.ms, info: d.info, titulo: 'Montagem' };
        let guardado = true;
        try { await db('readwrite', s => s.put(novo)); } catch { guardado = false; }
        avisar('Seu vídeo está pronto. Toque para abrir.');
        go('pronto');
        $('ptitulo').textContent = 'Vídeo editado pronto';
        $('pinfo').textContent = `${d.info} · ${mm(d.ms / 1000)}. Para legendar, abra em Projetos.`;
        URL.revokeObjectURL($('pvideo').src); $('pvideo').src = URL.createObjectURL(novo.blob);
        $('psalvar').onclick = () => baixar(novo);
        $('pcompartilhar').onclick = () => compartilhar(novo);
        if (!guardado) informar('Sem espaço para guardar no app. Salve agora o vídeo pronto. (Toque para fechar)');
      }
    };
    w.postMessage({ proj, midias: arquivos, qualidade: $('e-qualidade').value });
  };
  $('abrirEditor').onclick = () => abrirEditor();
  document.addEventListener('visibilitychange', () => { if (document.hidden) pausar(); });
})();
