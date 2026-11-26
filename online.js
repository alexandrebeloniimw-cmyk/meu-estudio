/* Alta precisão: Whisper large-v3 no serviço Groq, com a chave pessoal do usuário */
function wav(amostras) {
  const b = new DataView(new ArrayBuffer(44 + amostras.length * 2));
  const txt = (p, s) => [...s].forEach((c, i) => b.setUint8(p + i, c.charCodeAt(0)));
  txt(0, 'RIFF'); b.setUint32(4, 36 + amostras.length * 2, true); txt(8, 'WAVEfmt '); b.setUint32(16, 16, true);
  b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, 16000, true); b.setUint32(28, 32000, true);
  b.setUint16(32, 2, true); b.setUint16(34, 16, true); txt(36, 'data'); b.setUint32(40, amostras.length * 2, true);
  for (let i = 0; i < amostras.length; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, amostras[i])) * 32767, true);
  return new Blob([b], { type: 'audio/wav' });
}
async function transcreverOnline(audio, chave, signal, progresso) {
  const parte = 16000 * 600, chunks = []; // partes de 10 minutos (cabem no limite de 25 MB)
  for (let ini = 0; ini < audio.length; ini += parte) {
    progresso(Math.floor(ini / parte) + 1, Math.ceil(audio.length / parte));
    const f = new FormData();
    f.append('file', wav(audio.subarray(ini, ini + parte)), 'audio.wav');
    f.append('model', 'whisper-large-v3');
    f.append('language', 'pt');
    f.append('prompt', 'Transcrição em português do Brasil, com acentuação e pontuação.');
    f.append('response_format', 'verbose_json');
    f.append('timestamp_granularities[]', 'segment');
    let r;
    for (let tentativa = 1; ; tentativa++) {
      try { r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave }, body: f, signal }); break; }
      catch (e) {
        if (signal.aborted || tentativa === 3) throw new Error('sem conexão com o serviço');
        await new Promise(ok => setTimeout(ok, 2000 * tentativa));
      }
    }
    if (!r.ok) throw new Error(r.status === 401 ? 'chave recusada. Confira em Config.' : r.status === 429 ? 'limite gratuito atingido. Tente mais tarde.' : 'o serviço respondeu com erro ' + r.status);
    const j = await r.json(), base = ini / 16000;
    for (const s of j.segments || []) chunks.push({ text: s.text, timestamp: [s.start + base, s.end + base] });
  }
  return chunks;
}
