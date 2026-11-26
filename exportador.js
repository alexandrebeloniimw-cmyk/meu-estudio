// Exporta o vídeo com legendas dentro de um worker: não depende do app estar na tela
import './desenho.js';
import { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS, canEncodeVideo, canEncodeAudio } from './vendor/mediabunny.min.mjs';

onmessage = async ({ data: { blob, segs, estilo } }) => {
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const v = await input.getPrimaryVideoTrack();
    if (!v) throw new Error('sem imagem');
    const w0 = await v.getDisplayWidth(), h0 = await v.getDisplayHeight();
    const k = Math.min(1, 1920 / Math.max(w0, h0));
    const W = Math.round(w0 * k / 2) * 2, H = Math.round(h0 * k / 2) * 2;
    const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d');
    const video = {
      forceTranscode: true, allowTransformationMetadata: false, bitrate: 8e6, processedWidth: W, processedHeight: H,
      process: s => { s.draw(ctx, 0, 0, W, H); desenhar(ctx, s.timestamp, segs, estilo); return canvas; }
    };
    if (await canEncodeVideo('avc', { width: W, height: H })) video.codec = 'avc';
    const audio = {};
    if (await canEncodeAudio('aac')) audio.codec = 'aac';
    const conv = await Conversion.init({ input, output, video, audio, showWarnings: false });
    if (!conv.isValid || conv.discardedTracks.some(d => d.track.type === 'video' || d.track.type === 'audio')) throw new Error('formato não suportado');
    let ultimo = 0, duracao = 0;
    conv.onProgress = (p, t) => { duracao = t || duracao; if (p - ultimo >= .01) { ultimo = p; postMessage({ tipo: 'progresso', p }); } };
    await conv.execute();
    postMessage({ tipo: 'pronto', blob: new Blob([output.target.buffer], { type: 'video/mp4' }), ms: duracao * 1000 });
  } catch (e) {
    postMessage({ tipo: 'erro', msg: String(e?.message || e) });
  }
};
