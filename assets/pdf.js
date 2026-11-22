/* Wohnnetto · PDF der Anlage V. Eigener, kleiner PDF-Erzeuger ohne fremde Bibliothek (Standardschrift Helvetica, WinAnsi). */
(function () {
  'use strict';
  var W = 595.28, H = 841.89, RAND = 50;
  var ZIFFERN = { '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, '.': 278, ',': 278, '-': 333, ' ': 278, '€': 556, '%': 889 };

  function winAnsi(s) {
    var out = '', map = { 0x20AC: 0x80, 0x201E: 0x84, 0x2026: 0x85, 0x201C: 0x93, 0x201D: 0x94, 0x2013: 0x96, 0x2014: 0x97, 0x2212: 0x2D, 0x2009: 0x20, 0x202F: 0x20, 0x00A0: 0x20 };
    s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (map[c] != null) out += String.fromCharCode(map[c]);
      else if (c < 256) out += String.fromCharCode(c);
      else out += '?';
    }
    return out;
  }
  function pdfText(s) { return winAnsi(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  function breite(s, size, fett) {
    var w = 0; s = String(s);
    for (var i = 0; i < s.length; i++) { var ch = s[i]; w += ZIFFERN[ch] != null ? ZIFFERN[ch] : (/[A-ZÄÖÜ]/.test(ch) ? 680 : /[mwMW]/.test(ch) ? 833 : /[iljtfI]/.test(ch) ? 260 : 540); }
    return w / 1000 * size * (fett ? 1.05 : 1);
  }
  function farbe(c) { return (c || [0, 0, 0]).map(function (x) { return (x / 255).toFixed(3); }).join(' '); }

  function Doc() { this.seiten = []; this.neueSeite(); }
  Doc.prototype.neueSeite = function () { this.ops = []; this.seiten.push(this.ops); this.y = H - RAND; };
  Doc.prototype.text = function (x, y, s, size, fett, c) { this.ops.push('BT /' + (fett ? 'F2' : 'F1') + ' ' + size + ' Tf ' + farbe(c) + ' rg ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + pdfText(s) + ') Tj ET'); };
  Doc.prototype.rechts = function (xr, y, s, size, fett, c) { this.text(xr - breite(s, size, fett), y, s, size, fett, c); };
  Doc.prototype.rect = function (x, y, w, h, c) { this.ops.push(farbe(c) + ' rg ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f'); };
  Doc.prototype.linie = function (x1, y1, x2, y2, c, d) { this.ops.push(farbe(c) + ' RG ' + (d || 0.6) + ' w ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S'); };
  Doc.prototype.platz = function (h) { if (this.y - h < RAND + 40) { this.neueSeite(); return true; } return false; };
  Doc.prototype.absatz = function (x, s, size, maxB, fett, c, abstand) {
    var worte = String(s).split(/\s+/), zeilen = [], zeile = [], self = this, lh = size * 1.4;
    worte.forEach(function (w) { var test = zeile.concat(w).join(' '); if (breite(test, size, fett) > maxB && zeile.length) { zeilen.push(zeile); zeile = [w]; } else zeile.push(w); });
    if (zeile.length) zeilen.push(zeile);
    // kein einzelnes Wort allein in der letzten Zeile
    var n = zeilen.length;
    if (n > 1 && zeilen[n - 1].length === 1 && zeilen[n - 2].length > 2) zeilen[n - 1].unshift(zeilen[n - 2].pop());
    zeilen.forEach(function (z) { self.platz(lh); self.text(x, self.y - size, z.join(' '), size, fett, c); self.y -= lh; });
    this.y -= abstand || 0;
  };
  Doc.prototype.bytes = function (fuss) {
    var objs = [], n = this.seiten.length;
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    var kids = []; for (var i = 0; i < n; i++) kids.push((5 + i * 2) + ' 0 R');
    objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    for (var p = 0; p < n; p++) {
      var ops = this.seiten[p].slice();
      if (fuss) {
        var t = fuss + '   Seite ' + (p + 1) + ' von ' + n;
        ops.push('BT /F1 7.5 Tf 0.45 0.45 0.45 rg ' + RAND + ' 28 Td (' + pdfText(t) + ') Tj ET');
      }
      var inhalt = ops.join('\n');
      objs[5 + p * 2] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + (6 + p * 2) + ' 0 R >>';
      objs[6 + p * 2] = '<< /Length ' + inhalt.length + ' >>\nstream\n' + inhalt + '\nendstream';
    }
    var out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', offs = [];
    for (var k = 1; k < objs.length; k++) { offs[k] = out.length; out += k + ' 0 obj\n' + objs[k] + '\nendobj\n'; }
    var xref = out.length;
    out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (var m = 1; m < objs.length; m++) out += String(offs[m]).padStart(10, '0') + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + objs.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    var b = new Uint8Array(out.length);
    for (var z = 0; z < out.length; z++) b[z] = out.charCodeAt(z) & 0xFF;
    return b;
  }

  var nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  function euro(v) { return nf.format(Math.round(v || 0)) + ' €'; }
  var SCHWARZ = [17, 17, 17], GRAU = [110, 110, 110], LINIE = [210, 210, 210], GELB = [255, 210, 63], HELL = [245, 245, 245], GRUEN = [30, 120, 70];

  // info: { r, vz, name, steuerId, anschrift, objekt, nummer, kanzlei, freigegeben, freigabeAm, kernVersion }
  function anlageV(info) {
    var d = new Doc(), r = info.r, x2 = W - RAND, breiteText = x2 - RAND;
    // Kopf
    // Logo: gelbes Feld mit Haus und Plus wie im Favicon (Vorlage 44 x 44)
    var lx = RAND, ly = H - RAND - 6, s = 26 / 44, P = function (x, y) { return (lx + x * s).toFixed(2) + ' ' + (ly + 26 - y * s).toFixed(2); };
    d.rect(lx, ly, 26, 26, GELB);
    d.ops.push('0.067 0.067 0.067 RG 2 w 1 J 1 j ' + P(11, 23) + ' m ' + P(22, 13) + ' l ' + P(33, 23) + ' l S ' + P(15, 21) + ' m ' + P(15, 31) + ' l ' + P(29, 31) + ' l ' + P(29, 21) + ' l S 1.6 w ' + P(22, 23.5) + ' m ' + P(22, 29) + ' l S ' + P(19.25, 26.25) + ' m ' + P(24.75, 26.25) + ' l S');
    d.text(RAND + 36, H - RAND + 4, 'Wohnnetto', 11, true, SCHWARZ);
    d.text(RAND + 36, H - RAND - 8, 'Anlage V für Kapitalanleger', 8, false, GRAU);
    if (info.freigegeben) {
      d.rechts(x2, H - RAND + 4, 'Geprüft und freigegeben', 10, true, GRUEN);
      d.rechts(x2, H - RAND - 8, (info.kanzlei || '') + (info.freigabeAm ? ', ' + info.freigabeAm : ''), 8, false, GRAU);
    } else {
      d.rechts(x2, H - RAND + 4, 'Entwurf, nicht von einer Kanzlei geprüft', 10, true, [160, 110, 0]);
    }
    d.y = H - RAND - 52;
    d.text(RAND, d.y, 'Anlage V ' + info.vz, 24, true, SCHWARZ); d.y -= 20;
    d.text(RAND, d.y, 'Einkünfte aus Vermietung und Verpachtung', 10, false, GRAU); d.y -= 26;

    // Angaben
    var spalte = function (x, titel, zeilen) {
      var y = d.y; d.text(x, y, titel, 8, true, GRAU); y -= 14;
      zeilen.filter(function (z) { return z; }).forEach(function (z) { d.text(x, y, z, 9.5, false, SCHWARZ); y -= 13; });
      return y;
    };
    var y1 = spalte(RAND, 'STEUERPFLICHTIGE PERSON', [info.name, info.steuerId ? 'Steuer-ID ' + info.steuerId : '', info.anschrift]);
    var y2 = spalte(RAND + breiteText / 2, 'WOHNUNG', [info.objekt, info.nummer ? 'Akte ' + info.nummer : '', 'Steuerjahr ' + info.vz]);
    d.y = Math.min(y1, y2) - 12;

    // Tabelle
    var kopf = function () {
      d.rect(RAND, d.y - 6, breiteText, 20, SCHWARZ);
      d.text(RAND + 8, d.y, 'Zeile', 8.5, true, [255, 255, 255]);
      d.text(RAND + 56, d.y, 'Eintrag', 8.5, true, [255, 255, 255]);
      d.rechts(x2 - 8, d.y, 'Euro', 8.5, true, [255, 255, 255]);
      d.y -= 22;
    };
    kopf();
    var zeile = function (z, feld, betrag, summe) {
      if (d.platz(18)) { kopf(); }
      if (summe) d.rect(RAND, d.y - 5, breiteText, 17, HELL);
      d.text(RAND + 8, d.y, z, 9, summe, GRAU);
      var f = feld; while (breite(f, 9.5, summe) > breiteText - 160 && f.length > 10) f = f.slice(0, -2);
      if (f !== feld) f += '…';
      d.text(RAND + 56, d.y, f, 9.5, summe, SCHWARZ);
      d.rechts(x2 - 8, d.y, euro(betrag), 9.5, summe, SCHWARZ);
      d.linie(RAND, d.y - 5, x2, d.y - 5, LINIE, 0.4);
      d.y -= 17;
    };
    var E = r.zeilen.filter(function (l) { return l.art === 'E' && l.betrag; }), Wk = r.zeilen.filter(function (l) { return l.art === 'W' && l.betrag; });
    E.forEach(function (l) { zeile(l.zeile, l.feld, l.betrag); });
    zeile('32', 'Summe der Einnahmen', r.summen.einnahmen, true);
    Wk.forEach(function (l) { zeile(l.zeile, l.feld, l.betrag); });
    zeile('83', 'Summe der Werbungskosten', r.summen.werbungskosten, true);
    zeile('85', 'Überschuss der Einnahmen über die Werbungskosten', r.summen.ueberschuss, true);
    if (r.summen.personB) { zeile('86', 'Anteil Person A', r.summen.personA); zeile('86', 'Anteil Person B', r.summen.personB); }
    d.y -= 6;
    d.absatz(RAND, 'Zeilennummern nach dem Vordruck Anlage V. Beträge in vollen Euro, Einnahmen abgerundet und Werbungskosten aufgerundet.', 7.5, breiteText, false, GRAU, 14);

    // Freibetrag
    var fb = r.freibetrag;
    if (fb && fb.freibetrag) {
      d.platz(80);
      d.rect(RAND, d.y - 58, breiteText, 64, [255, 244, 204]);
      d.text(RAND + 12, d.y - 8, 'Freibetrag für ' + fb.jahr, 11, true, SCHWARZ);
      d.text(RAND + 12, d.y - 24, 'Voraussichtlicher Verlust aus Vermietung: ' + euro(fb.freibetrag), 9.5, false, SCHWARZ);
      if (fb.steuerwirkungMonat) d.text(RAND + 12, d.y - 38, 'Weniger Lohnsteuer: rund ' + euro(fb.steuerwirkungJahr) + ' im Jahr, ' + euro(fb.steuerwirkungMonat) + ' im Monat', 9.5, true, SCHWARZ);
      d.text(RAND + 12, d.y - 52, 'Antrag auf Lohnsteuer-Ermäßigung in Mein ELSTER. Mit Freibetrag ist jedes Jahr eine Steuererklärung Pflicht.', 8, false, GRAU);
      d.y -= 76;
    }

    // So geht es weiter
    d.platz(90);
    d.text(RAND, d.y, 'So geht es weiter', 11, true, SCHWARZ); d.y -= 16;
    [
      '1. Öffnen Sie in Mein ELSTER Ihre Einkommensteuererklärung ' + info.vz + ' und fügen Sie die Anlage V für diese Wohnung hinzu.',
      '2. Übertragen Sie die Beträge aus der Tabelle in die gleichlautenden Zeilen. Oder geben Sie dieses PDF Ihrem Steuerberater.',
      '3. Bewahren Sie Kaufvertrag, Darlehensunterlagen und Hausgeldabrechnung auf. Das Finanzamt kann sie anfordern.'
    ].forEach(function (t) { d.absatz(RAND, t, 9, breiteText, false, SCHWARZ, 3); });

    var fuss = 'Erstellt mit Wohnnetto' + (info.freigegeben && info.kanzlei ? '. Steuerliche Prüfung und Freigabe: ' + info.kanzlei : '. Ohne Prüfung durch eine Kanzlei') + (info.kernVersion ? '. Rechenkern ' + info.kernVersion : '') + '.';
    return new Blob([d.bytes(fuss)], { type: 'application/pdf' });
  }

  window.OP_PDF = { anlageV: anlageV };
}());
