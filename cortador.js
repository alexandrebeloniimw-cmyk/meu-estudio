// Gera o vídeo cortado juntando os trechos mantidos (roda em um worker)
import { Input, Output, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, VideoSampleSink, AudioSampleSink, CanvasSource, AudioSampleSource, AudioSample, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec } from './vendor/mediabunny.min.mjs';

const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
const FUSAO = .008; // suaviza o som nas emendas para não estalar

onmessage = async ({ data: { blob, trechos } }) => {
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const v = await input.getPrimaryVideoTrack();
    if (!v) throw new Error('sem imagem');
    if (!await v.canDecode()) throw new Error('este aparelho não lê a imagem deste vídeo');
    const a = await input.getPrimaryAudioTrack();
    if (a && !await a.canDecode()) throw new Error('este aparelho não lê o som deste vídeo');
    const w0 = await v.getDisplayWidth(), h0 = await v.getDisplayHeight();
    const dur = await input.computeDuration();
    const origem = dur ? blob.size * 8 / dur : 0;
    // mantém a resolução original; só reduz se o aparelho não conseguir gravar nela
    const par = n => Math.floor(n / 2) * 2;
    const taxa = (w, h) => Math.round(Math.min(60e6, Math.max(origem * 1.2, w * h * 30 * .25, 10e6)));
    const escolher = (w, h) => getFirstEncodableVideoCodec(['avc', 'vp9', 'vp8'], { width: w, height: h, bitrate: taxa(w, h) });
    let W = par(w0), H = par(h0), codec = await escolher(W, H);
    const k = 1920 / Math.max(w0, h0);
    if (codec !== 'avc' && k < 1) { W = par(w0 * k); H = par(h0 * k); codec = await escolher(W, H); }
    if (!codec) throw new Error('este aparelho não grava vídeo neste formato');
    const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingQuality = 'high';
    const saidaV = new CanvasSource(canvas, { codec, bitrate: taxa(W, H), keyFrameInterval: 2 });
    output.addVideoTrack(saidaV);
    let saidaA;
    if (a) {
      const c = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: await a.getNumberOfChannels(), sampleRate: await a.getSampleRate(), bitrate: 192e3 });
      if (!c) throw new Error('este aparelho não grava o som');
      saidaA = new AudioSampleSource({ codec: c, bitrate: 192e3 });
      output.addAudioTrack(saidaA);
    }
    await output.start();
    const total = trechos.reduce((s, [i, f]) => s + f - i, 0);
    let base = 0, ultimo = 0;

    const imagem = async (ini, fim) => {
      for await (const s of new VideoSampleSink(v).samples(ini, fim)) {
        const de = Math.max(s.timestamp, ini), ate = Math.min(s.timestamp + (s.duration || 1 / 30), fim);
        if (ate - de > .001) {
          s.draw(ctx, 0, 0, W, H);
          const t = base + de - ini;
          await saidaV.add(t, ate - de);
          const p = (t) / total;
          if (p - ultimo >= .01) { ultimo = p; postMessage({ tipo: 'progresso', p }); }
        }
        s.close();
      }
    };
    const som = async (ini, fim) => {
      if (!saidaA) return;
      for await (const s of new AudioSampleSink(a).samples(ini, fim)) {
        const sr = s.sampleRate, nc = s.numberOfChannels;
        const de = Math.max(0, Math.round((ini - s.timestamp) * sr));
        const ate = Math.min(s.numberOfFrames, Math.round((fim - s.timestamp) * sr));
        const n = ate - de;
        if (n > 0) {
          const dados = new Float32Array(n * nc), inicio = s.timestamp + de / sr;
          for (let c = 0; c < nc; c++) {
            const faixa = dados.subarray(c * n, (c + 1) * n);
            s.copyTo(faixa, { planeIndex: c, format: 'f32-planar', frameOffset: de, frameCount: n });
            for (let i = 0; i < n; i++) {
              const t = inicio + i / sr, g = Math.min((t - ini) / FUSAO, (fim - t) / FUSAO);
              if (g < 1) faixa[i] *= Math.max(0, g);
            }
          }
          const novo = new AudioSample({ data: dados, format: 'f32-planar', numberOfChannels: nc, sampleRate: sr, timestamp: Math.max(0, base + inicio - ini) });
          await saidaA.add(novo); novo.close();
        }
        s.close();
      }
    };

    for (const [ini, fim] of trechos) {
      await Promise.all([imagem(ini, fim), som(ini, fim)]);
      base += fim - ini;
    }
    await output.finalize();
    const saida = new Blob([output.target.buffer], { type: 'video/mp4' });
    postMessage({ tipo: 'pronto', blob: saida, ms: total * 1000, info: `Original ${w0}×${h0}, ${mb(blob.size)} · Cortado ${W}×${H}, ${mb(saida.size)}` });
  } catch (e) {
    postMessage({ tipo: 'erro', msg: String(e?.message || e) });
  }
};
