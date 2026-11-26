// Exporta o vídeo com legendas dentro de um worker: não depende do app estar na tela
import './desenho.js';
import { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, canEncodeVideo, canEncodeAudio } from './vendor/mediabunny.min.mjs';

const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';

onmessage = async ({ data: { blob, segs, estilo } }) => {
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const v = await input.getPrimaryVideoTrack();
    if (!v) throw new Error('sem imagem');
    const w0 = await v.getDisplayWidth(), h0 = await v.getDisplayHeight();
    // taxa do original (bits por segundo); a saída nunca fica abaixo dela
    const dur = await input.computeDuration();
    const origem = dur ? blob.size * 8 / dur : 0;
    const taxa = (w, h) => Math.round(Math.min(60e6, Math.max(origem * 1.2, w * h * 30 * .25, 10e6)));
    // mantém a resolução original; só reduz se o aparelho não conseguir gravar nela
    const par = n => Math.floor(n / 2) * 2;
    let W = par(w0), H = par(h0), avc = await canEncodeVideo('avc', { width: W, height: H, bitrate: taxa(W, H) });
    const k = 1920 / Math.max(w0, h0);
    if (!avc && k < 1) { W = par(w0 * k); H = par(h0 * k); avc = await canEncodeVideo('avc', { width: W, height: H, bitrate: taxa(W, H) }); }
    const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingQuality = 'high';
    const video = {
      forceTranscode: true, allowTransformationMetadata: false, bitrate: taxa(W, H), keyFrameInterval: 2, processedWidth: W, processedHeight: H,
      process: s => { s.draw(ctx, 0, 0, W, H); desenhar(ctx, s.timestamp, segs, estilo); return canvas; }
    };
    if (avc) video.codec = 'avc';
    const audio = {};
    if (await canEncodeAudio('aac')) audio.codec = 'aac';
    const conv = await Conversion.init({ input, output, video, audio, showWarnings: false });
    if (!conv.isValid || conv.discardedTracks.some(d => d.track.type === 'video' || d.track.type === 'audio')) throw new Error('formato não suportado');
    let ultimo = 0, duracao = 0;
    conv.onProgress = (p, t) => { duracao = t || duracao; if (p - ultimo >= .01) { ultimo = p; postMessage({ tipo: 'progresso', p }); } };
    await conv.execute();
    postMessage({ tipo: 'pronto', blob: new Blob([output.target.buffer], { type: 'video/mp4' }), ms: duracao * 1000, info: `Original ${w0}×${h0}, ${mb(blob.size)} · Com legendas ${W}×${H}, ${mb(output.target.buffer.byteLength)}` });
  } catch (e) {
    postMessage({ tipo: 'erro', msg: String(e?.message || e) });
  }
};
