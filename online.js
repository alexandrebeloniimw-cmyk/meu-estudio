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
async function pedir(amostras, chave, signal) {
  const f = new FormData();
  f.append('file', wav(amostras), 'audio.wav');
  f.append('model', 'whisper-large-v3');
  f.append('language', 'pt');
  f.append('temperature', '0');
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
  return (await r.json()).segments || [];
}
// trechos com som de voz (volume) que ficaram sem legenda por mais de 2 segundos
function lacunas(audio, chunks) {
  const q = 1600, niveis = []; // quadros de 0,1 s
  for (let i = 0; i < audio.length; i += q) {
    let soma = 0; const fim = Math.min(i + q, audio.length);
    for (let j = i; j < fim; j++) soma += audio[j] * audio[j];
    niveis.push(Math.sqrt(soma / (fim - i)));
  }
  const forte = [...niveis].sort((a, b) => a - b)[Math.floor(niveis.length * .9)] || 0;
  const limite = Math.max(forte * .2, .005);
  const vazios = []; let t = 0;
  for (const c of [...chunks].sort((a, b) => a.timestamp[0] - b.timestamp[0])) {
    if (c.timestamp[0] - t > 2) vazios.push([t, c.timestamp[0]]);
    t = Math.max(t, c.timestamp[1]);
  }
  if (audio.length / 16000 - t > 2) vazios.push([t, audio.length / 16000]);
  return vazios.filter(([a, b]) => niveis.slice(Math.floor(a * 10), Math.ceil(b * 10)).filter(n => n > limite).length >= 10);
}
async function transcreverOnline(audio, chave, signal, progresso) {
  const parte = 16000 * 600, chunks = []; // partes de 10 minutos (cabem no limite de 25 MB)
  const juntar = (segs, base, de, ate) => {
    for (const s of segs) {
      const ini = Math.max(s.start + base, de), fim = Math.min(s.end + base, ate);
      if (s.text.trim() && fim > ini) chunks.push({ text: s.text, timestamp: [ini, fim] });
    }
  };
  for (let ini = 0; ini < audio.length; ini += parte) {
    progresso(`Transcrevendo online (parte ${Math.floor(ini / parte) + 1} de ${Math.ceil(audio.length / parte)})…`);
    const pedaco = audio.subarray(ini, ini + parte);
    juntar(await pedir(pedaco, chave, signal), ini / 16000, ini / 16000, (ini + pedaco.length) / 16000);
  }
  // segunda passagem: reenvia só os trechos que ficaram sem texto
  const faltas = lacunas(audio, chunks).slice(0, 12);
  for (const [n, [de, ate]] of faltas.entries()) {
    progresso(`Recuperando trecho sem legenda (${n + 1} de ${faltas.length})…`);
    for (let a = de; a < ate - 1; a += 600) {
      const b = Math.min(a + 600, ate), base = Math.max(a - .2, 0);
      try {
        const segs = await pedir(audio.subarray(Math.floor(base * 16000), Math.ceil((b + .2) * 16000)), chave, signal);
        // descarta "frases inventadas" em ruído ou silêncio
        juntar(segs.filter(s => !(s.no_speech_prob > .6 || s.avg_logprob < -1)), base, a, b);
      } catch (e) {
        if (signal.aborted) throw e; // sem a recuperação, entrega o que já foi transcrito
      }
    }
  }
  chunks.sort((a, b) => a.timestamp[0] - b.timestamp[0]);
  return { chunks, faltam: lacunas(audio, chunks) };
}
