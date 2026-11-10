export function loadJSON(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
export function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }

const DEFAULTS = { tempo:70, metroOn:true, metroVol:60, mode:'wait', hands:'both', notation:'fr', labels:true,
  demo:false, autoOther:true, octaveTol:true, micLatency:60, micGate:12, pianoVol:70, zoom:100, auddToken:'',
  sound:'piano', a4:440, fingers:true, kbLabels:true, kbFollow:true };
export const S = Object.assign({}, DEFAULTS, loadJSON('pc_settings') || {});
// v1.3 : les lettres du clavier sont désormais affichées en permanence (réglage réactivé une fois)
if (!S.v13) { S.kbLabels = true; S.v13 = true; }
export const saveSettings = () => saveJSON('pc_settings', S);
