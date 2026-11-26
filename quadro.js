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

  // pinta o clipe na camada: w e h são o tamanho da imagem original; pintar(ctx,x,y,lw,lh) a desenha
  function clipe(ctx, c, w, h, pintar, t, anterior, proximo) {
    const W = ctx.canvas.width, H = ctx.canvas.height, d = dur(c);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (w && h) {
      const deitado = c.giro % 180 !== 0, rw = deitado ? h : w, rh = deitado ? w : h;
      let k = (c.encaixe === 'ajustar' ? Math.min : Math.max)(W / rw, H / rh);
      if (c.tipo === 'foto' && c.movimento) k *= 1 + .12 * Math.min(1, t / d);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(c.giro * Math.PI / 180); ctx.filter = filtro(c);
      pintar(ctx, -w * k / 2, -h * k / 2, w * k, h * k);
      ctx.restore();
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
