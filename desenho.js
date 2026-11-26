// Desenho da legenda: igual na prévia e na exportação (página e worker)
// fontes livres (licença OFL, ver vendor/fontes-LICENCAS.txt): [arquivo, peso, escala]
self.FONTES = {
  sistema: [null, 800, 1], montserrat: ['montserrat-latin-800', 800, 1], poppins: ['poppins-latin-800', 800, 1],
  anton: ['anton-latin-400', 400, 1.05], bebas: ['bebas-neue-latin-400', 400, 1.25], oswald: ['oswald-latin-700', 700, 1.05],
  playfair: ['playfair-display-latin-700', 700, 1], pacifico: ['pacifico-latin-400', 400, .95],
  lobster: ['lobster-latin-400', 400, 1.1], bangers: ['bangers-latin-400', 400, 1.15]
};
const carregadas = {};
self.carregarFonte = id => {
  const arq = FONTES[id]?.[0];
  if (!arq) return Promise.resolve();
  return carregadas[id] ||= new FontFace('leg-' + id, `url(vendor/${arq.replace(/-(\d+)$/, '-$1-normal')}.woff2)`, { weight: String(FONTES[id][1]) })
    .load().then(f => { (self.document ? document.fonts : self.fonts).add(f); })
    .catch(() => { delete carregadas[id]; });
};
const suave = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const elastico = x => { const v = Math.min(1, Math.max(0, x)) - 1; return 1 + 2.7 * v * v * v + 1.7 * v * v; };

self.desenhar = (ctx, t, segs, estilo) => {
  const s = segs.find(s => t >= s.ini && t < s.fim);
  if (!s || !s.txt.trim()) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const [arq, peso, escala] = FONTES[estilo.fonte] || FONTES.sistema;
  const px = Math.round(Math.min(W, H) * estilo.tam / 100 * escala);
  const p = t - s.ini, dur = Math.max(.1, s.fim - s.ini), anim = estilo.anim || 'nenhuma';
  ctx.save();
  ctx.font = `${peso} ${px}px ${arq ? `"leg-${estilo.fonte}", ` : ''}system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  // linhas de palavras; o momento de cada palavra é proporcional ao número de letras
  const palavras = s.txt.trim().split(/\s+/), letras = palavras.join('').length;
  let antes = 0;
  const linhas = [[]];
  for (const texto of palavras) {
    const l = linhas[linhas.length - 1];
    const palavra = { texto, de: antes / letras * dur * .92 };
    antes += texto.length; palavra.ate = antes / letras * dur * .92;
    if (l.length && ctx.measureText([...l.map(x => x.texto), texto].join(' ')).width > W * .88) linhas.push([palavra]);
    else l.push(palavra);
  }
  const alt = px * 1.3, bloco = alt * linhas.length;
  const centro = { baixo: H * .80, meio: H * .5, alto: H * .16 }[estilo.posi];
  if (anim === 'surgir') ctx.globalAlpha = suave(p / .4);
  if (anim === 'subir') { ctx.globalAlpha = suave(p / .3); ctx.translate(0, (1 - suave(p / .35)) * px * 1.6); }
  if (anim === 'deslizar') ctx.translate((suave(p / .35) - 1) * W, 0);
  if (anim === 'zoom') { const k = .4 + .6 * elastico(p / .35); ctx.translate(W / 2, centro); ctx.scale(k, k); ctx.translate(-W / 2, -centro); }
  let restam = anim === 'digitar' ? Math.ceil(s.txt.length * Math.min(1, p / (dur * .65))) : Infinity;
  const realce = estilo.cor === '#ffe600' ? '#2dd4bf' : '#ffe600';
  linhas.forEach((linha, i) => {
    const y = centro - bloco / 2 + alt * (i + .5);
    const frase = linha.map(x => x.texto).join(' '), largura = ctx.measureText(frase).width;
    ctx.save();
    // uma palavra muito comprida é encolhida para caber
    const k = Math.min(1, W * .94 / largura);
    ctx.translate(W / 2, y); ctx.scale(k, 1);
    const x0 = -largura / 2;
    const visivel = anim === 'palavra' ? linha.some(x => p >= x.de) : restam > 0;
    if (estilo.fundo === 'caixa' && visivel) {
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(x0 - px * .35, -alt / 2, largura + px * .7, alt + 1);
    }
    let prefixo = '';
    for (const palavra of linha) {
      const x = x0 + ctx.measureText(prefixo).width;
      const texto = restam === Infinity ? palavra.texto : palavra.texto.slice(0, Math.max(0, restam));
      restam -= palavra.texto.length + 1; prefixo += palavra.texto + ' ';
      if (!texto || (anim === 'palavra' && p < palavra.de)) continue;
      const atual = anim === 'destaque' && p >= palavra.de && (p < palavra.ate || palavra === linhas.at(-1).at(-1));
      if (estilo.fundo !== 'caixa') { ctx.strokeStyle = '#000'; ctx.lineWidth = px * .22; ctx.strokeText(texto, x, 0); }
      ctx.fillStyle = atual ? realce : estilo.cor; ctx.fillText(texto, x, 0);
    }
    ctx.restore();
  });
  ctx.restore();
};
