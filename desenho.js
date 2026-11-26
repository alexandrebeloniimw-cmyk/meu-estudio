// Desenho da legenda: igual na prévia e na exportação (página e worker)
self.desenhar = (ctx, t, segs, estilo) => {
  const s = segs.find(s => t >= s.ini && t < s.fim);
  if (!s || !s.txt.trim()) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const px = Math.round(Math.min(W, H) * estilo.tam / 100);
  ctx.font = `800 ${px}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const linhas = [];
  let l = '';
  for (const p of s.txt.trim().split(/\s+/)) {
    const tenta = l ? l + ' ' + p : p;
    if (l && ctx.measureText(tenta).width > W * .88) { linhas.push(l); l = p; } else l = tenta;
  }
  linhas.push(l);
  const alt = px * 1.3, bloco = alt * linhas.length;
  const centro = { baixo: H * .80, meio: H * .5, alto: H * .16 }[estilo.posi];
  linhas.forEach((texto, i) => {
    const y = centro - bloco / 2 + alt * (i + .5);
    if (estilo.fundo === 'caixa') {
      const w = Math.min(ctx.measureText(texto).width + px * .7, W);
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect((W - w) / 2, y - alt / 2, w, alt + 1);
    } else {
      ctx.strokeStyle = '#000'; ctx.lineWidth = px * .22; ctx.strokeText(texto, W / 2, y, W * .96);
    }
    ctx.fillStyle = estilo.cor; ctx.fillText(texto, W / 2, y, W * .96);
  });
};
