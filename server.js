const express = require('express');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '1mb' }));

const LOGO = path.join(__dirname, 'assets', 'logo.png');
const RNC_EMPRESA = '131161839';

// ---- Paleta de marca ----
const BROWN = '#5E4528', BROWN2 = '#6B4F2A', CARAMEL = '#B5835A', ACCENT = '#EA580C';
const CREAM = '#FAF4EA', LINE = '#E6D8C2', MUTED = '#8A7A60', INK = '#3D2E1C';

function money(n) {
  return 'RD$ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(s) { const m = String(s == null ? '' : s).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; }

// Tarifa de corte por metro lineal según espesor (mm)
function tarifaCorte(esp) {
  if (esp > 30) return 30;
  if (esp >= 21) return 23.985;
  return 21.615; // 3–20mm (por defecto)
}
const TARIFA_CANTEADO = 2.25;
const ITBIS = 0.18;

// ---- Base de precios de productos (por código) + Chatwoot ----
let PRECIOS = {};
try { PRECIOS = require('./precios.json'); } catch (e) { console.warn('precios.json no encontrado'); }
const CW_BASE = 'https://app.chatwoot.com';
const CW_ACCOUNT = process.env.CHATWOOT_ACCOUNT || '168113';
const CW_TOKEN = process.env.CHATWOOT_TOKEN || 'jbPNpq2gdAdmE6fae6QUKUpE';

// Extrae un campo del mensaje de la web
function extraer(texto, etiqueta) {
  const re = new RegExp(etiqueta + '\\s*:?\\s*(.+)', 'i');
  const m = texto.match(re);
  return m ? m[1].trim() : '';
}

function parseYcalcular(body) {
  const t = String(body.mensaje || body.texto || '');
  const cliente = extraer(t, 'Cliente') || body.nombre || 'Cliente';
  const rnc = extraer(t, 'RNC/C[eé]dula') || extraer(t, 'RNC') || '';
  const tel = extraer(t, 'Tel[eé]fono') || body.telefono || '';
  const material = extraer(t, 'Material') || '';
  const tablero = extraer(t, 'Tablero') || '';
  const espesor = num(extraer(t, 'Espesor'));
  const mCorteM = t.match(/Metros\s*\(est[^\n:]*:?\s*([\d.,]+)/i);
  const mCorte = mCorteM ? num(mCorteM[1]) : num(extraer(t, 'Metros de corte'));
  const mCanteado = num(extraer(t, 'Metros de canteado'));
  const cortes = num(extraer(t, 'Cortes de tablero'));

  const tCorte = tarifaCorte(espesor);
  const subCorte = mCorte * tCorte;
  const subCanteado = mCanteado * TARIFA_CANTEADO;
  const subtotal = subCorte + subCanteado;
  const itbis = subtotal * ITBIS;
  const total = subtotal + itbis;

  return { cliente, rnc, tel, material, tablero, espesor, cortes, mCorte, mCanteado, tCorte, subCorte, subCanteado, subtotal, itbis, total };
}

function fecha() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function numeroCot() {
  const d = new Date();
  return `COT-${d.getFullYear()}-${String(Date.now()).slice(-5)}`;
}

function construirPDF(c, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(res);
  const W = 595.28, M = 45;
  const cot = numeroCot();

  // --- Encabezado ---
  try { doc.image(LOGO, M, 45, { height: 62 }); } catch (e) {}
  doc.fontSize(13).fillColor(BROWN).font('Helvetica-Bold').text('Maderas Ibéricas', W - M - 260, 46, { width: 260, align: 'right' });
  doc.fontSize(9).fillColor(MUTED).font('Helvetica')
    .text('RNC: ' + RNC_EMPRESA, W - M - 260, 64, { width: 260, align: 'right' })
    .text('Avda. Jacinto Mañón 17, Plaza 17, Piantini', { width: 260, align: 'right' })
    .text('Santo Domingo, R.D.', { width: 260, align: 'right' })
    .text('Tel: +1 809 957 6500 · info@finsawood.com', { width: 260, align: 'right' });
  doc.moveTo(M, 120).lineTo(W - M, 120).lineWidth(2.5).strokeColor(BROWN2).stroke();

  // --- Título ---
  doc.fontSize(28).fillColor(BROWN).font('Helvetica-Bold').text('COTIZACIÓN', M, 138);
  doc.fontSize(9.5).fillColor(MUTED).font('Helvetica')
    .text('No. ' + cot, W - M - 200, 140, { width: 200, align: 'right' })
    .text('Fecha: ' + fecha(), { width: 200, align: 'right' })
    .text('Válida por: 15 días', { width: 200, align: 'right' });
  // barra acento
  doc.rect(M, 178, W - 2 * M, 4).fill(ACCENT);

  // --- Cliente ---
  let y = 198;
  doc.roundedRect(M, y, W - 2 * M, 46, 6).fillAndStroke(CREAM, LINE);
  const cols = [[M + 16, 'CLIENTE', c.cliente], [M + 200, 'RNC / CÉDULA', c.rnc || '—'], [M + 360, 'TELÉFONO', c.tel || '—']];
  cols.forEach(([x, lab, val]) => {
    doc.fontSize(7.5).fillColor(CARAMEL).font('Helvetica-Bold').text(lab, x, y + 10);
    doc.fontSize(11).fillColor(INK).font('Helvetica-Bold').text(val, x, y + 22, { width: 170 });
  });

  // --- Subtítulo servicio ---
  y += 62;
  doc.fontSize(9.5).fillColor(MUTED).font('Helvetica')
    .text('Servicio de corte y canteo' + (c.material ? ' — ' + c.material : '') + (c.tablero ? ' · Tablero ' + c.tablero : ''), M, y, { width: W - 2 * M });

  // --- Tabla ---
  y += 22;
  const colX = { concepto: M + 12, detalle: M + 150, tarifa: W - M - 200, importe: W - M - 12 };
  doc.rect(M, y, W - 2 * M, 26).fill(BROWN2);
  doc.fontSize(9.5).fillColor('#fff').font('Helvetica-Bold')
    .text('Concepto', colX.concepto, y + 8)
    .text('Detalle', colX.detalle, y + 8)
    .text('Tarifa', colX.tarifa - 60, y + 8, { width: 120, align: 'right' })
    .text('Importe', W - M - 112, y + 8, { width: 100, align: 'right' });
  y += 26;
  const filas = [
    ['Corte de tablero', c.mCorte.toFixed(2) + ' m' + (c.cortes ? ' · ' + c.cortes + ' cortes' : '') + ' (esp. ' + (c.espesor || '—') + ' mm)', 'RD$ ' + c.tCorte + '/m', money(c.subCorte)],
    ['Canteado', c.mCanteado.toFixed(2) + ' m lineales', 'RD$ ' + TARIFA_CANTEADO + '/m', money(c.subCanteado)]
  ];
  doc.font('Helvetica').fillColor(INK).fontSize(10.5);
  filas.forEach(([a, b, tar, imp]) => {
    doc.fillColor(INK).font('Helvetica').text(a, colX.concepto, y + 9, { width: 135 });
    doc.fillColor('#5b4a34').text(b, colX.detalle, y + 9, { width: 210 });
    doc.text(tar, W - M - 232, y + 9, { width: 120, align: 'right' });
    doc.font('Helvetica-Bold').fillColor(INK).text(imp, W - M - 112, y + 9, { width: 100, align: 'right' });
    doc.moveTo(M, y + 34).lineTo(W - M, y + 34).lineWidth(0.7).strokeColor('#EADFCE').stroke();
    y += 34;
  });

  // --- Totales ---
  y += 12;
  const tx = W - M - 250;
  const linea = (lab, val, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 10).fillColor(bold ? INK : MUTED)
      .text(lab, tx, y, { width: 130 });
    doc.font('Helvetica-Bold').fillColor(INK).text(val, tx + 120, y, { width: 130, align: 'right' });
    y += 20;
  };
  linea('Subtotal', money(c.subtotal));
  linea('ITBIS (18%)', money(c.itbis));
  // caja total
  doc.roundedRect(tx - 4, y - 2, 258, 30, 5).fill(BROWN);
  doc.fontSize(14).fillColor('#fff').font('Helvetica-Bold').text('TOTAL', tx + 6, y + 6);
  doc.text(money(c.total), tx + 6, y + 6, { width: 236, align: 'right' });
  y += 44;

  // --- Nota ---
  const noteH = 46;
  doc.rect(M, y, 4, noteH).fill(ACCENT);
  doc.roundedRect(M + 4, y, W - 2 * M - 4, noteH, 4).fill('#FFF7EF');
  doc.fontSize(9).fillColor('#7A5A3A').font('Helvetica')
    .text('Cotización estimada del servicio de corte y canteo. No incluye el precio de los tableros. Los cortes especiales (curvo, fresa, express, meganite) se cotizan aparte. El valor exacto se confirma en el taller.',
      M + 16, y + 10, { width: W - 2 * M - 28 });

  // --- Pie ---
  const fy = 790;
  doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.7).strokeColor(LINE).stroke();
  doc.fontSize(8.5).fillColor(MUTED).font('Helvetica')
    .text('Maderas Ibéricas · Piantini · Haina · Santo Domingo Este   |   +1 809 957 6500 · info@finsawood.com', M, fy + 8, { width: W - 2 * M, align: 'center' })
    .text('Gracias por su preferencia.', { width: W - 2 * M, align: 'center' });

  doc.end();
}

// ============ COTIZACIÓN DE PRODUCTOS (con precios) ============
function money2(n, cur) {
  const sym = cur === 'USD' ? 'US$ ' : cur === 'EUR' ? '€ ' : 'RD$ ';
  return sym + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Resuelve cada item a un precio: primero por código, luego por descripción exacta/contiene.
// Los que no tienen precio se OMITEN (van a "omitidos").
function resolverItems(items) {
  const incluidos = [], omitidos = [];
  for (const it of (items || [])) {
    const cant = num(it.cantidad != null ? it.cantidad : it.cant) || 0;
    const codigo = (it.codigo || it.code || '').toString().trim().toUpperCase();
    let rec = null;
    if (codigo && PRECIOS[codigo]) rec = { codigo, ...PRECIOS[codigo] };
    if (!rec) {
      const desc = (it.descripcion || it.desc || '').toString().trim().toUpperCase();
      if (desc.length >= 4) {
        for (const [k, v] of Object.entries(PRECIOS)) {
          if (v.d.toUpperCase() === desc) { rec = { codigo: k, ...v }; break; }
        }
        if (!rec) for (const [k, v] of Object.entries(PRECIOS)) {
          if (v.d.toUpperCase().includes(desc)) { rec = { codigo: k, ...v }; break; }
        }
      }
    }
    if (rec && cant > 0) {
      incluidos.push({ codigo: rec.codigo, desc: rec.d, unidad: rec.u || '', moneda: rec.m || 'DOP', precio: rec.p, cantidad: cant, importe: rec.p * cant });
    } else {
      omitidos.push({ codigo: it.codigo || '', descripcion: it.descripcion || it.desc || '', cantidad: cant });
    }
  }
  return { incluidos, omitidos };
}

function totalesPorMoneda(incluidos) {
  const g = {};
  for (const it of incluidos) {
    const m = it.moneda || 'DOP';
    if (!g[m]) g[m] = { subtotal: 0 };
    g[m].subtotal += it.importe;
  }
  for (const m of Object.keys(g)) { g[m].itbis = g[m].subtotal * ITBIS; g[m].total = g[m].subtotal + g[m].itbis; }
  return g;
}

function construirPDFProductos(data, incluidos, totales) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28, M = 45;
    const cot = numeroCot();

    // Encabezado
    try { doc.image(LOGO, M, 45, { height: 62 }); } catch (e) {}
    doc.fontSize(13).fillColor(BROWN).font('Helvetica-Bold').text('Maderas Ibéricas', W - M - 260, 46, { width: 260, align: 'right' });
    doc.fontSize(9).fillColor(MUTED).font('Helvetica')
      .text('RNC: ' + RNC_EMPRESA, W - M - 260, 64, { width: 260, align: 'right' })
      .text('Avda. Jacinto Mañón 17, Plaza 17, Piantini', { width: 260, align: 'right' })
      .text('Santo Domingo, R.D.', { width: 260, align: 'right' })
      .text('Tel: +1 809 957 6500 · info@finsawood.com', { width: 260, align: 'right' });
    doc.moveTo(M, 120).lineTo(W - M, 120).lineWidth(2.5).strokeColor(BROWN2).stroke();

    // Título
    doc.fontSize(28).fillColor(BROWN).font('Helvetica-Bold').text('COTIZACIÓN', M, 138);
    doc.fontSize(9.5).fillColor(MUTED).font('Helvetica')
      .text('No. ' + cot, W - M - 200, 140, { width: 200, align: 'right' })
      .text('Fecha: ' + fecha(), { width: 200, align: 'right' })
      .text('Válida por: 15 días', { width: 200, align: 'right' });
    doc.rect(M, 178, W - 2 * M, 4).fill(ACCENT);

    // Cliente / RNC / Empresa
    let y = 198;
    doc.roundedRect(M, y, W - 2 * M, 46, 6).fillAndStroke(CREAM, LINE);
    const cols = [[M + 16, 'CLIENTE', data.cliente], [M + 200, 'RNC / CÉDULA', data.rnc || '—'], [M + 360, 'EMPRESA', data.empresa || '—']];
    cols.forEach(([x, lab, val]) => {
      doc.fontSize(7.5).fillColor(CARAMEL).font('Helvetica-Bold').text(lab, x, y + 10);
      doc.fontSize(10.5).fillColor(INK).font('Helvetica-Bold').text(String(val || '—'), x, y + 22, { width: 175 });
    });

    // Cabecera de tabla
    y += 62;
    doc.rect(M, y, W - 2 * M, 26).fill(BROWN2);
    doc.fontSize(9).fillColor('#fff').font('Helvetica-Bold')
      .text('Producto', M + 12, y + 8, { width: 238 })
      .text('Cant.', 300, y + 8, { width: 70, align: 'right' })
      .text('Precio', 375, y + 8, { width: 80, align: 'right' })
      .text('Importe', 460, y + 8, { width: 88, align: 'right' });
    y += 26;

    // Filas
    for (const it of incluidos) {
      const descH = doc.font('Helvetica').fontSize(9.5).heightOfString(it.desc, { width: 238 });
      const rowH = Math.max(30, descH + 16);
      if (y + rowH > 762) { doc.addPage(); y = 50; }
      doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(it.desc, M + 12, y + 6, { width: 238 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5).text('Cód: ' + it.codigo, M + 12, y + 6 + descH + 1, { width: 238 });
      doc.fillColor(INK).font('Helvetica').fontSize(9.5)
        .text(it.cantidad + ' ' + (it.unidad || ''), 300, y + 6, { width: 70, align: 'right' })
        .text(money2(it.precio, it.moneda), 375, y + 6, { width: 80, align: 'right' });
      doc.font('Helvetica-Bold').fillColor(INK).text(money2(it.importe, it.moneda), 460, y + 6, { width: 88, align: 'right' });
      doc.moveTo(M, y + rowH).lineTo(W - M, y + rowH).lineWidth(0.7).strokeColor('#EADFCE').stroke();
      y += rowH;
    }

    // Totales por moneda
    y += 12;
    const tx = W - M - 250, multi = Object.keys(totales).length > 1;
    for (const [cur, t] of Object.entries(totales)) {
      if (y + 92 > 780) { doc.addPage(); y = 50; }
      const linea = (lab, val, bold) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 10).fillColor(bold ? INK : MUTED).text(lab, tx, y, { width: 130 });
        doc.font('Helvetica-Bold').fillColor(INK).text(val, tx + 120, y, { width: 130, align: 'right' });
        y += 20;
      };
      linea('Subtotal' + (multi ? ' (' + cur + ')' : ''), money2(t.subtotal, cur));
      linea('ITBIS (18%)', money2(t.itbis, cur));
      doc.roundedRect(tx - 4, y - 2, 258, 30, 5).fill(BROWN);
      doc.fontSize(13).fillColor('#fff').font('Helvetica-Bold').text('TOTAL' + (multi ? ' ' + cur : ''), tx + 6, y + 7);
      doc.text(money2(t.total, cur), tx + 6, y + 7, { width: 236, align: 'right' });
      y += 44;
    }

    // Nota
    y += 6;
    if (y + 60 > 780) { doc.addPage(); y = 50; }
    const noteH = 46;
    doc.rect(M, y, 4, noteH).fill(ACCENT);
    doc.roundedRect(M + 4, y, W - 2 * M - 4, noteH, 4).fill('#FFF7EF');
    doc.fontSize(9).fillColor('#7A5A3A').font('Helvetica')
      .text('Cotización estimada de productos. Precios de lista sujetos a cambio y disponibilidad. No incluye servicio de corte, canteo ni transporte, salvo indicación. El valor exacto se confirma en la sucursal.',
        M + 16, y + 10, { width: W - 2 * M - 28 });

    // Pie
    const fy = 790;
    doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.7).strokeColor(LINE).stroke();
    doc.fontSize(8.5).fillColor(MUTED).font('Helvetica')
      .text('Maderas Ibéricas · Piantini · Haina · Santo Domingo Este   |   +1 809 957 6500 · info@finsawood.com', M, fy + 8, { width: W - 2 * M, align: 'center' })
      .text('Gracias por su preferencia.', { width: W - 2 * M, align: 'center' });

    doc.end();
  });
}

async function subirAChatwoot(convId, buffer, filename, content) {
  const url = `${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/conversations/${convId}/messages`;
  const form = new FormData();
  form.append('message_type', 'outgoing');
  form.append('content', content);
  form.append('attachments[]', new Blob([buffer], { type: 'application/pdf' }), filename);
  const r = await fetch(url, { method: 'POST', headers: { api_access_token: CW_TOKEN }, body: form });
  if (!r.ok) throw new Error('Chatwoot ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return true;
}

// Cotización de productos: arma el PDF y (si hay conversation_id) lo sube a Chatwoot
app.post('/cotizacion-productos', async (req, res) => {
  try {
    const b = req.body || {};
    let items = b.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
    const data = {
      cliente: (b.cliente || 'Cliente').toString().replace(/[\r\n"]+/g, ' ').trim().slice(0, 60) || 'Cliente',
      rnc: (b.rnc || '').toString().trim().slice(0, 30),
      empresa: (b.empresa || '').toString().trim().slice(0, 60),
      telefono: (b.telefono || '').toString().trim()
    };
    const { incluidos, omitidos } = resolverItems(items);
    if (!incluidos.length) {
      return res.json({ ok: false, reason: 'sin_precios', mensaje: 'Ningún producto tiene precio disponible para cotizar automáticamente.', omitidos });
    }
    const totales = totalesPorMoneda(incluidos);
    const pdf = await construirPDFProductos(data, incluidos, totales);
    if (b.debug) { res.setHeader('Content-Type', 'application/pdf'); return res.end(pdf); }
    const filename = ('Cotizacion ' + data.cliente).replace(/[\r\n"\/]+/g, ' ').trim().slice(0, 50) + '.pdf';
    let enviado = false;
    if (b.conversation_id) {
      try { await subirAChatwoot(b.conversation_id, pdf, filename, '📄 Aquí tienes tu cotización. Cualquier duda, con gusto te ayudo.'); enviado = true; }
      catch (e) { console.error('Chatwoot upload error:', String(e.message || e)); }
    }
    // Respuesta SIN montos: el bot nunca debe ver ni decir precios.
    res.json({ ok: true, enviado, productos_cotizados: incluidos.length, omitidos: omitidos.map(o => o.descripcion || o.codigo).filter(Boolean) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

app.get('/', (req, res) => res.send('Maderas Cotización PDF · OK'));

// Genera el PDF y lo devuelve como archivo (binario)
app.post('/cotizacion', (req, res) => {
  try {
    const c = parseYcalcular(req.body || {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Cotizacion-Maderas.pdf"');
    construirPDF(c, res);
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
});

// Variante: devuelve también los totales calculados en JSON (para pruebas)
app.post('/calcular', (req, res) => {
  try { res.json(parseYcalcular(req.body || {})); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

// ==== Envío de catálogos/recursos PDF directo al chat (sin link) ====
const RECURSOS_BASE = 'https://maderasibericascorte.com/recursos';
const RECURSOS = {
  'carta-finsa':      { file: 'carta-colores-finsa.pdf',      nombre: 'Carta de Colores Finsa.pdf',            texto: '📖 Carta de colores Finsa' },
  'carta-dominicana': { file: 'carta-colores-dominicana.pdf', nombre: 'Carta de Colores Finsa Dominicana.pdf', texto: '📖 Carta de colores Finsa Dominicana' },
  'novedades':        { file: 'novedades-finsa-2026.pdf',     nombre: 'Novedades Finsa 2026.pdf',               texto: '✨ Novedades Finsa 2026' },
  'riepe':            { file: 'riepe-catalogo.pdf',        nombre: 'Catalogo RIEPE.pdf',                     texto: '🧴 Catálogo RIEPE (limpiadores, desmoldeantes y colas)' }
};

app.post('/enviar-recurso', async (req, res) => {
  try {
    const b = req.body || {};
    const convId = b.conversation_id;
    if (!convId) return res.json({ ok: false, reason: 'sin_conversacion' });
    const raw = (b.recurso || '').toString();
    let claves;
    if (/\btodos?\b|\btodas?\b|los cat[aá]logos|^\s*cat[aá]logos?\s*$/i.test(raw)) {
      claves = Object.keys(RECURSOS); // Ver catálogos = manda TODOS
    } else {
      claves = raw.split(',').map(s => s.trim()).filter(Boolean).map(k => {
        const l = k.toLowerCase();
        if (l.includes('riepe') || l.includes('limpiador') || l.includes('antiadherente') || l.includes('desmold')) return 'riepe';
      if (l.includes('novedad')) return 'novedades';
        if (l.includes('dominic')) return 'carta-dominicana';
        if (l.includes('carta') || l.includes('color') || l.includes('finsa')) return 'carta-finsa';
        return k;
      });
      // "carta de colores" en general => manda las dos cartas
      if (/color|carta/i.test(raw) && !/dominic/i.test(raw)) claves.push('carta-dominicana');
      claves = [...new Set(claves)].filter(k => RECURSOS[k]);
    }
    if (!claves.length) return res.json({ ok: false, reason: 'recurso_desconocido' });
    const enviados = [];
    for (const k of claves) {
      const r = RECURSOS[k];
      const resp = await fetch(`${RECURSOS_BASE}/${r.file}`);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());
      await subirAChatwoot(convId, buf, r.nombre, r.texto);
      enviados.push(k);
    }
    res.json({ ok: enviados.length > 0, enviados });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Cotización PDF en puerto ' + PORT));
