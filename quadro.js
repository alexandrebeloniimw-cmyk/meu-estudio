// Desenho de cada quadro do editor: igual na prévia e na exportação (página e worker)
(() => {
  const FILTROS = {
    normal: '', pb: 'grayscale(1)', sepia: 'sepia(.75)', quente: 'sepia(.28) saturate(1.25)',
    frio: 'sepia(.25) hue-rotate(170deg) saturate(1.1)', vivo: 'saturate(1.45) contrast(1.08)',
    cinema: 'contrast(1.18) saturate(.82) brightness(.95)', suave: 'contrast(.9) brightness(1.08) saturate(.95)'
  };
  const TRANS = .6; // duração das transições, em segundos
  const dur = c => c.tipo === 'foto' ? c.dur : (c.fim - c.ini) / c.vel;
  const filtro = c => [FILTROS[c.filtro] || '',
    c.brilho !== 100 ? `brightness(${c.brilho / 100})` : '',
    c.contraste !== 100 ? `contrast(${c.contraste / 100})` : '',
    c.saturacao !== 100 ? `saturate(${c.saturacao / 100})` : ''].join(' ').trim() || 'none';

  const auxiliares = {};
  function auxiliar(nome, w, h) {
    const c = auxiliares[nome] ||= self.document ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d'); x.clearRect(0, 0, w, h);
    return [c, x];
  }
  // fundos prontos, desenhados pelo próprio app
  const PRONTOS = {
    estudio: ['#2d56ad', '#0b1740'], claro: ['#ffffff', '#c3d0ea'], quente: ['#e7b57a', '#4a2412'],
    palco: ['#4a3a8c', '#07050f'], luzes: ['#1d2f63', '#050a1c'], natureza: ['#bfe3c9', '#1f5141']
  };
  function pronto(ctx, nome, W, H) {
    const [claro, escuro] = PRONTOS[nome] || PRONTOS.estudio, M = Math.max(W, H);
    const g = ctx.createRadialGradient(W / 2, H * .32, M * .02, W / 2, H * .4, M * .75);
    g.addColorStop(0, claro); g.addColorStop(1, escuro); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (nome === 'luzes') for (let i = 0; i < 26; i++) {
      const x = (i * 0.618 % 1) * W, y = (i * 0.377 % 1) * H, r = M * (.018 + (i * .271 % 1) * .045);
      const l = ctx.createRadialGradient(x, y, 0, x, y, r);
      l.addColorStop(0, i % 3 ? 'rgba(150,185,255,.4)' : 'rgba(255,210,140,.45)'); l.addColorStop(.75, i % 3 ? 'rgba(150,185,255,.22)' : 'rgba(255,210,140,.24)'); l.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = l; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (nome === 'palco') {
      ctx.fillStyle = 'rgba(255,255,255,.07)';
      for (const x of [.15, .85]) { ctx.beginPath(); ctx.moveTo(x * W, 0); ctx.lineTo((x - .3) * W, H); ctx.lineTo((x + .3) * W, H); ctx.fill(); }
    }
  }
  function cobrir(ctx, img, W, H) {
    const k = Math.max(W / img.width, H / img.height);
    ctx.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
  }

  // pinta o clipe na camada: w e h são o tamanho da imagem original; pintar(ctx,x,y,lw,lh) a desenha.
  // recorte (opcional): { mascara, foto } para trocar o fundo
  function clipe(ctx, c, w, h, pintar, t, anterior, proximo, recorte) {
    const W = ctx.canvas.width, H = ctx.canvas.height, d = dur(c);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (w && h) {
      const deitado = c.giro % 180 !== 0, rw = deitado ? h : w, rh = deitado ? w : h;
      let k = (c.encaixe === 'ajustar' ? Math.min : Math.max)(W / rw, H / rh);
      if (c.tipo === 'foto' && c.movimento) k *= 1 + .12 * Math.min(1, t / d);
      const posicionar = x => { x.save(); x.translate(x.canvas.width / 2, x.canvas.height / 2); x.rotate(c.giro * Math.PI / 180); };
      const f = c.tipo === 'video' ? c.fundo : null, trocar = recorte?.mascara && f && f.tipo !== 'original';
      if (!trocar) {
        posicionar(ctx); ctx.filter = filtro(c); pintar(ctx, -w * k / 2, -h * k / 2, w * k, h * k); ctx.restore();
      } else {
        if (f.tipo === 'cor') { ctx.fillStyle = f.cor; ctx.fillRect(0, 0, W, H); }
        else if (f.tipo === 'foto' && recorte.foto) cobrir(ctx, recorte.foto, W, H);
        else if (f.tipo === 'desfoque') {
          // desfoca numa versão pequena: fica leve para o celular
          const [p, px] = auxiliar('fundo', Math.round(W / 6), Math.round(H / 6));
          posicionar(px); px.filter = `blur(${1 + f.forca / 12}px) ${c.filtro === 'normal' ? '' : FILTROS[c.filtro]}`;
          pintar(px, -w * k / 12 * 1.04, -h * k / 12 * 1.04, w * k / 6 * 1.04, h * k / 6 * 1.04); px.restore();
          ctx.drawImage(p, 0, 0, W, H);
        } else pronto(ctx, f.pronto, W, H);
        const [pessoa, qx] = auxiliar('pessoa', W, H);
        posicionar(qx); qx.filter = filtro(c); pintar(qx, -w * k / 2, -h * k / 2, w * k, h * k);
        qx.globalCompositeOperation = 'destination-in'; qx.filter = `blur(${f.borda / 100 * Math.min(W, H) / 400}px)`;
        qx.drawImage(recorte.mascara, -w * k / 2, -h * k / 2, w * k, h * k); qx.restore();
        ctx.drawImage(pessoa, 0, 0);
      }
    }
    const p = t / Math.min(TRANS, d / 2);
    if (p < 1 && anterior) {
      ctx.save();
      if (c.transicao === 'dissolver') { ctx.globalAlpha = 1 - p; ctx.drawImage(anterior, 0, 0, W, H); }
      if (c.transicao === 'deslizar') ctx.drawImage(anterior, -W * p * p * (3 - 2 * p), 0, W, H);
      ctx.restore();
    }
    const veu = (tipo, a) => {
      if (a <= 0) return;
      ctx.fillStyle = tipo === 'clarao' ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H);
    };
    const meia = Math.min(TRANS / 1.5, d / 2);
    if (['escurecer', 'clarao'].includes(c.transicao)) veu(c.transicao, 1 - t / meia);
    if (['escurecer', 'clarao'].includes(proximo?.transicao)) veu(proximo.transicao, 1 - (d - t) / meia);
  }

  // textos e logotipo por cima do vídeo
  function sobrepor(ctx, t, textos, logo, imagem) {
    for (const x of textos) desenhar(ctx, t, [x], x);
    if (!logo || !imagem) return;
    const W = ctx.canvas.width, H = ctx.canvas.height, m = Math.min(W, H) * .04;
    let lw = Math.min(W, H) * logo.tam / 100, lh = lw * imagem.height / imagem.width;
    if (lh > H * .5) { lw *= H * .5 / lh; lh = H * .5; }
    const x = logo.posi === 'centro' ? (W - lw) / 2 : logo.posi[1] === 'e' ? m : W - m - lw;
    const y = logo.posi === 'centro' ? (H - lh) / 2 : logo.posi[0] === 's' ? m : H - m - lh;
    ctx.save(); ctx.globalAlpha = logo.opac / 100; ctx.drawImage(imagem, x, y, lw, lh); ctx.restore();
  }
  self.MONTAGEM = { dur, clipe, sobrepor, proporcao: { v: [9, 16], h: [16, 9], q: [1, 1] } };
})();
