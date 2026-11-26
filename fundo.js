/* Segundo plano: mantém a página ativa durante tarefas longas e avisa quando terminam */
let somVivo;
// Um som praticamente inaudível em repetição reduz a chance de o Android congelar o app.
function manterVivo(ligar) {
  if (!ligar) { somVivo?.pause(); return; }
  if (!somVivo) {
    const taxa = 8000, n = taxa * 10, b = new DataView(new ArrayBuffer(44 + n * 2));
    const txt = (p, s) => [...s].forEach((c, i) => b.setUint8(p + i, c.charCodeAt(0)));
    txt(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); txt(8, 'WAVEfmt '); b.setUint32(16, 16, true);
    b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, taxa, true); b.setUint32(28, taxa * 2, true);
    b.setUint16(32, 2, true); b.setUint16(34, 16, true); txt(36, 'data'); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.round(24 * Math.sin(i * 2 * Math.PI * 60 / taxa)), true);
    somVivo = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
    somVivo.loop = true;
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: 'Meu Estúdio: processando' });
  }
  somVivo.play().catch(() => {});
}
function pedirAviso() { if (self.Notification?.permission === 'default') Notification.requestPermission().catch(() => {}); }
async function avisar(texto) {
  if (!document.hidden || self.Notification?.permission !== 'granted') return;
  try { (await navigator.serviceWorker.ready).showNotification('Meu Estúdio', { body: texto, icon: 'icon-192.png', tag: 'estudio' }); } catch {}
}
