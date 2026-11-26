// Gera o vídeo do editor dentro de um worker: imagem quadro a quadro e mistura do som
import './desenho.js';
import './quadro.js';
import './recorte.js';
import { Input, Output, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, VideoSampleSink, AudioSampleSink, CanvasSource, AudioSampleSource, AudioSample, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec } from './vendor/mediabunny.min.mjs';

const FPS = 30, SR = 48000, POR_QUADRO = SR / FPS;
const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const abrir = blob => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });

// lê um pedaço do áudio (em segundos) como estéreo a 48 kHz
async function lerSom(blob, de, ate) {
  const trilha = await abrir(blob).getPrimaryAudioTrack();
  if (!trilha) return null;
  if (!await trilha.canDecode()) throw new Error('este aparelho não lê um dos áudios');
  ate ??= await trilha.computeDuration();
  const n = Math.max(0, Math.round((ate - de) * SR));
  const saida = [new Float32Array(n), new Float32Array(n)];
  for await (const s of new AudioSampleSink(trilha).samples(de, ate)) {
    const sr = s.sampleRate, nq = s.numberOfFrames;
    const canais = [0, 1].map(c => {
      const d = new Float32Array(nq);
      s.copyTo(d, { planeIndex: Math.min(c, s.numberOfChannels - 1), format: 'f32-planar' });
      return d;
    });
    const ini = Math.max(0, Math.ceil((s.timestamp - de) * SR)), fim = Math.min(n, Math.ceil((s.timestamp + nq / sr - de) * SR));
    for (let i = ini; i < fim; i++) {
      const p = Math.max(0, (de + i / SR - s.timestamp) * sr), j = Math.min(nq - 1, p | 0), k = Math.min(nq - 1, j + 1), f = p - j;
      for (let c = 0; c < 2; c++) saida[c][i] = canais[c][j] * (1 - f) + canais[c][k] * f;
    }
    s.close();
  }
  return saida;
}
// muda a velocidade sem afinar ou engrossar a voz (sobreposição de pequenos trechos)
function esticar(entrada, vel, n) {
  const TAM = 2048, PASSO = 1024, BUSCA = 480;
  const saida = [new Float32Array(n), new Float32Array(n)], total = entrada[0].length;
  const janela = Float32Array.from({ length: TAM }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / TAM));
  let anterior = null;
  for (let o = -PASSO; o < n; o += PASSO) {
    const ideal = Math.max(0, Math.round(o * vel));
    let melhor = ideal;
    if (anterior !== null) {
      // procura o ponto que melhor continua o trecho anterior
      let maior = -Infinity;
      const alvo = anterior + PASSO;
      for (let p = Math.max(0, ideal - BUSCA); p <= ideal + BUSCA; p += 4) {
        let s = 0;
        for (let i = 0; i < PASSO; i += 8) s += (entrada[0][p + i] || 0) * (entrada[0][alvo + i] || 0);
        if (s > maior) { maior = s; melhor = p; }
      }
    }
    anterior = melhor;
    for (let i = Math.max(0, -o); i < TAM && o + i < n; i++) {
      const j = melhor + i;
      if (j >= total) break;
      saida[0][o + i] += entrada[0][j] * janela[i]; saida[1][o + i] += entrada[1][j] * janela[i];
    }
  }
  return saida;
}

onmessage = async ({ data: { proj, midias, qualidade } }) => {
  try {
    const { clipes, textos, musica, narracao, logo } = proj;
    const quadros = clipes.map(c => Math.max(1, Math.round(MONTAGEM.dur(c) * FPS)));
    const totalQ = quadros.reduce((a, b) => a + b, 0), totalS = totalQ * POR_QUADRO;

    // tamanho da saída
    const fontes = new Map();
    let maiorLado = 0;
    for (const c of clipes) {
      if (fontes.has(c.midia)) continue;
      if (c.tipo === 'foto') {
        const img = await createImageBitmap(midias[c.midia], { imageOrientation: 'from-image' });
        fontes.set(c.midia, { img });
        maiorLado = Math.max(maiorLado, Math.min(img.width, img.height));
      } else {
        const input = abrir(midias[c.midia]), v = await input.getPrimaryVideoTrack();
        if (!v || !await v.canDecode()) throw new Error(`este aparelho não lê o vídeo “${c.nome}”`);
        const inicio = await v.getFirstTimestamp();
        fontes.set(c.midia, { v, inicio, som: !!await input.getPrimaryAudioTrack() });
        maiorLado = Math.max(maiorLado, Math.min(await v.getDisplayWidth(), await v.getDisplayHeight()));
      }
    }
    const [pw, ph] = MONTAGEM.proporcao[proj.formato];
    const par = n => Math.round(n / 2) * 2;
    const medidas = lado => [par(lado * pw / Math.min(pw, ph)), par(lado * ph / Math.min(pw, ph))];
    const taxa = (w, h) => Math.round(Math.min(60e6, Math.max(w * h * FPS * .25, 10e6)));
    const escolher = ([w, h]) => getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width: w, height: h, bitrate: taxa(w, h) });
    let lado = qualidade === 'max' ? Math.min(2160, Math.max(1080, maiorLado)) : 1080;
    let [W, H] = medidas(lado), codec = await escolher([W, H]);
    if (codec !== 'avc' && lado > 1080) { [W, H] = medidas(1080); codec = await escolher([W, H]); }
    if (!codec) throw new Error('este aparelho não grava vídeo neste tamanho');

    const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d', { alpha: false });
    const camada = new OffscreenCanvas(W, H), cx = camada.getContext('2d', { alpha: false });
    const antes = new OffscreenCanvas(W, H), ax = antes.getContext('2d', { alpha: false });
    cx.imageSmoothingQuality = 'high';
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const saidaV = new CanvasSource(canvas, { codec, bitrate: taxa(W, H), keyFrameInterval: 2 });
    output.addVideoTrack(saidaV, { frameRate: FPS });
    const codecA = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SR, bitrate: 192e3 });
    if (!codecA) throw new Error('este aparelho não grava o som');
    const saidaA = new AudioSampleSource({ codec: codecA, bitrate: 192e3 });
    output.addAudioTrack(saidaA);

    await Promise.all(textos.map(t => carregarFonte(t.fonte)));
    const imagemLogo = logo ? await createImageBitmap(midias[logo.midia]) : null;
    const comRecorte = c => c.tipo === 'video' && c.fundo && c.fundo.tipo !== 'original';
    const recortador = clipes.some(comRecorte) ? await RECORTE.criar() : null;
    const fotos = new Map();
    for (const c of clipes) if (comRecorte(c) && c.fundo.tipo === 'foto' && midias[c.fundo.midia] && !fotos.has(c.fundo.midia))
      fotos.set(c.fundo.midia, await createImageBitmap(midias[c.fundo.midia], { imageOrientation: 'from-image' }));
    const fundo = musica ? await lerSom(midias[musica.midia], 0) : null;
    const voz2 = narracao ? await lerSom(midias[narracao.midia], 0) : null;
    await output.start();

    let q = 0, ultimo = 0, abaixado = 1;
    for (let i = 0; i < clipes.length; i++) {
      const c = clipes[i], f = fontes.get(c.midia), n = quadros[i], base = q * POR_QUADRO;

      const imagem = async () => {
        const pintar = async (k, w, h, desenhaFonte) => {
          let recorte;
          if (comRecorte(c) && w) recorte = { mascara: recortador.processar(w, h, desenhaFonte, c.fundo.ajuste, c.fundo.borda), foto: fotos.get(c.fundo.midia) };
          MONTAGEM.clipe(cx, c, w, h, desenhaFonte, k / FPS, i ? antes : null, clipes[i + 1], recorte);
          ctx.drawImage(camada, 0, 0);
          MONTAGEM.sobrepor(ctx, (q + k) / FPS, textos, logo, imagemLogo);
          await saidaV.add((q + k) / FPS, 1 / FPS);
          const p = (q + k + 1) / totalQ;
          if (p - ultimo >= .01) { ultimo = p; postMessage({ tipo: 'progresso', p }); }
        };
        if (c.tipo === 'foto') {
          for (let k = 0; k < n; k++) await pintar(k, f.img.width, f.img.height, (x, ...r) => x.drawImage(f.img, ...r));
          return;
        }
        const tempos = Array.from({ length: n }, (_, k) => Math.max(f.inicio, c.ini + Math.min(k / FPS * c.vel, c.fim - c.ini - .001)));
        let k = 0;
        for await (const s of new VideoSampleSink(f.v).samplesAtTimestamps(tempos)) {
          if (s) await pintar(k, s.displayWidth, s.displayHeight, (x, ...r) => s.draw(x, ...r));
          else await pintar(k, 0, 0, () => {});
          s?.close(); k++;
        }
      };

      const som = async () => {
        const ns = n * POR_QUADRO;
        let voz = null;
        if (c.tipo === 'video' && f.som && c.volume > 0) {
          voz = await lerSom(midias[c.midia], c.ini, c.fim);
          if (c.vel !== 1) voz = esticar(voz, c.vel, ns);
        }
        const mix = [new Float32Array(ns), new Float32Array(ns)];
        const ini2 = narracao ? Math.round(narracao.inicio * SR) : 0;
        for (let b = 0; b < ns; b += 960) {
          const fim = Math.min(ns, b + 960);
          let energia = 0;
          for (let j = b; j < fim; j++) {
            const borda = Math.min(1, j / 384, (ns - j) / 384); // evita estalo nas emendas
            for (let ch = 0; ch < 2; ch++) {
              let v = voz && j < voz[ch].length ? voz[ch][j] * c.volume / 100 * borda : 0;
              const m = base + j - ini2;
              if (voz2 && m >= 0 && m < voz2[ch].length) v += voz2[ch][m] * narracao.volume / 100;
              mix[ch][j] = v; energia += v * v;
            }
          }
          if (!fundo || !fundo[0].length) continue;
          // abaixa a música enquanto alguém fala
          const alvo = musica.abaixar && Math.sqrt(energia / ((fim - b) * 2)) > .02 ? .3 : 1;
          const novo = abaixado + (alvo - abaixado) * (alvo < abaixado ? .35 : .04);
          for (let j = b; j < fim; j++) {
            const g = base + j, entra = Math.min(1, g / (SR * .5), (totalS - g) / (SR * 1.5));
            const ganho = musica.volume / 100 * entra * (abaixado + (novo - abaixado) * (j - b) / (fim - b));
            const m = (Math.round(musica.inicio * SR) + g) % fundo[0].length;
            mix[0][j] += fundo[0][m] * ganho; mix[1][j] += fundo[1][m] * ganho;
          }
          abaixado = novo;
        }
        for (let b = 0; b < ns; b += SR / 2) {
          const t = Math.min(SR / 2, ns - b), dados = new Float32Array(t * 2);
          for (let ch = 0; ch < 2; ch++) for (let j = 0; j < t; j++) dados[ch * t + j] = Math.max(-1, Math.min(1, mix[ch][b + j]));
          const a = new AudioSample({ data: dados, format: 'f32-planar', numberOfChannels: 2, sampleRate: SR, timestamp: (base + b) / SR });
          await saidaA.add(a); a.close();
        }
      };

      recortador?.esquecer();
      await Promise.all([imagem(), som()]);
      ax.drawImage(camada, 0, 0);
      q += n;
    }
    await output.finalize();
    const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
    postMessage({ tipo: 'pronto', blob, ms: totalQ / FPS * 1000, info: `Montagem ${W}×${H}, ${mb(blob.size)}` });
  } catch (e) {
    postMessage({ tipo: 'erro', msg: String(e?.message || e) });
  }
};
