// Transcrição no próprio aparelho (Whisper). O áudio não sai do celular.
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
let asr, atual;

onmessage = async ({ data: { audio, modelo } }) => {
  try {
    if (atual !== modelo) {
      const { pipeline } = await import(LIB);
      const arquivos = {};
      const progress_callback = p => {
        if (p.status !== 'progress' || !p.total) return;
        arquivos[p.file] = [p.loaded, p.total];
        postMessage({ tipo: 'baixando', mb: Object.values(arquivos).reduce((s, a) => s + a[0], 0) / 1048576 });
      };
      const criar = dtype => pipeline('automatic-speech-recognition', modelo, { device: 'wasm', dtype, progress_callback });
      try { asr = await criar('q8'); }
      catch (e) { asr = await criar({ encoder_model: 'fp32', decoder_model_merged: 'q4' }); }
      atual = modelo;
    }
    postMessage({ tipo: 'transcrevendo' });
    const r = await asr(audio, { language: 'portuguese', task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    postMessage({ tipo: 'pronto', chunks: r.chunks || [] });
  } catch (e) {
    postMessage({ tipo: 'erro', msg: String(e?.message || e) });
  }
};
