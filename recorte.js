// Separa a pessoa do fundo no próprio aparelho (MediaPipe). Usado na prévia e na exportação.
(() => {
  const base = new URL('vendor/mp/', self.location.href).href;
  const novoCanvas = (w, h) => self.document ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : new OffscreenCanvas(w, h);
  let pronto;
  async function abrir() {
    const { FilesetResolver, ImageSegmenter } = await import(base + 'vision_bundle.mjs');
    let erro;
    // tenta a placa de vídeo e, se não der, o processador
    for (const delegate of ['GPU', 'CPU']) {
      try {
        const arquivos = await FilesetResolver.forVisionTasks(base.slice(0, -1), true);
        // carrega o programa como módulo (funciona na página e no worker)
        self.ModuleFactory = (await import(arquivos.wasmLoaderPath)).default;
        arquivos.wasmLoaderPath = '';
        return await ImageSegmenter.createFromOptions(arquivos, {
          baseOptions: { modelAssetPath: base + 'selfie_segmentation.tflite', delegate },
          canvas: novoCanvas(1, 1), runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false
        });
      } catch (e) { erro = e; }
    }
    throw erro;
  }
  const carregar = () => pronto ||= abrir().catch(e => { pronto = null; throw e; });

  // cada recortador guarda a própria máscara (e a anterior, para a borda não tremer)
  function criar(modelo) {
    const entrada = novoCanvas(1, 1), ex = entrada.getContext('2d', { willReadFrequently: false });
    const mascara = novoCanvas(1, 1), mx = mascara.getContext('2d');
    let antes = null, imagem = null;
    return {
      mascara,
      esquecer() { antes = null; },
      // w e h: tamanho da imagem; pintar(ctx,x,y,lw,lh) a desenha; ajuste e borda vão de 0 a 100
      processar(w, h, pintar, ajuste, borda) {
        const k = Math.min(1, 384 / Math.max(w, h)), lw = Math.max(2, Math.round(w * k)), lh = Math.max(2, Math.round(h * k));
        if (entrada.width !== lw || entrada.height !== lh) { entrada.width = lw; entrada.height = lh; antes = null; }
        pintar(ex, 0, 0, lw, lh);
        const r = modelo.segment(entrada), m = r.confidenceMasks[0], v = m.getAsFloat32Array();
        if (mascara.width !== m.width || mascara.height !== m.height || !imagem) {
          mascara.width = m.width; mascara.height = m.height; imagem = mx.createImageData(m.width, m.height); antes = null;
        }
        const meio = .2 + ajuste / 100 * .6, faixa = .03 + borda / 100 * .35, d = imagem.data;
        if (!antes) antes = Float32Array.from(v);
        for (let i = 0; i < v.length; i++) {
          // pequenas variações são suavizadas; movimentos grandes passam direto
          const dif = Math.abs(v[i] - antes[i]), s = antes[i] += (v[i] - antes[i]) * Math.min(1, .45 + dif * 1.5);
          const a = Math.max(0, Math.min(1, (s - meio + faixa) / (2 * faixa)));
          d[i * 4 + 3] = a * a * (3 - 2 * a) * 255;
        }
        mx.putImageData(imagem, 0, 0);
        r.close();
        return mascara;
      }
    };
  }
  self.RECORTE = { carregar, criar: async () => criar(await carregar()) };
})();
