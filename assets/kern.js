/*!
 * AnlageVKern: Rechenkern Anlage V (Standardfall Kapitalanlage-Wohnung)
 * Objektpilot · Canis Lupus Sebru Ltd. (Marke Stratvell)
 *
 * Grundlage: Marvin Bauers Excel „Anlage V 2025 – Test- und Programmierbasis“ (Blätter AfA,
 * Anlage V, Prüfungen, Testprotokoll), EStG, EStDV, EStR und BMF-Schreiben. Eigenständig
 * entwickelt, ohne Verwendung fremder Software oder Skills.
 *
 * Scope: eine Wohnung (oder mehrere gleichartige) dauerhaft zu Wohnzwecken an Fremde
 * vermietet, auch mit Mieterwechsel, Leerstand und Sonderabschreibung nach § 7b. Werte können
 * aus einem Kontoauszug (CSV oder CAMT) kommen, mit Saldenabgleich, Klärungsliste und
 * Zehn-Tage-Regel. Ferienwohnung, kurzfristige Vermietung, Angehörige, Teil-Eigennutzung,
 * Gewerbe, USt-Option, Denkmal/Sanierungsgebiet, Herstellung, Gemeinschaften und
 * Veräußerung werden erkannt und als rot „Sonderfall, Kanzlei“ gemeldet.
 *
 * Läuft ohne Abhängigkeiten im Browser (global AnlageVKern) und in Node (module.exports).
 * Keine Rechts- oder Steuerberatung. Ergebnisse werden von der Kanzlei geprüft und freigegeben.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnlageVKern = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '0.2.0';

  /* ---------- Hilfen ---------- */
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function r2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  // Rundung wie Vordruck und Marvins Excel: Einnahmen INT(ROUND(x;2)), Werbungskosten -INT(-ROUND(x;2))
  function einnahme(x) { return Math.floor(r2(x)); }
  function werbung(x) { return -Math.floor(-r2(x)); }
  // kaufmännisch, halbe Beträge vom Nullpunkt weg (wie Excel RUNDEN)
  function kfm(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }
  function parseDatum(s) {
    if (!s) return null;
    if (typeof s === 'number') return { j: s, m: 1, t: 1 };
    var p = String(s).split('-');
    return { j: +p[0], m: +(p[1] || 1), t: +(p[2] || 1) };
  }
  function vor(a, b) { // a < b
    if (a.j !== b.j) return a.j < b.j;
    if (a.m !== b.m) return a.m < b.m;
    return a.t < b.t;
  }
  function fmtDatum(d) { return d ? (String(d.t).padStart(2, '0') + '.' + String(d.m).padStart(2, '0') + '.' + d.j) : ''; }
  function eur(x) { return (Math.round(x * 100) / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €'; }
  function pct(x) { return (Math.round(x * 10000) / 100).toLocaleString('de-DE') + '%'; }
  // Monate in einem Jahr ab Beginn (Monat des Beginns zählt voll, wie Excel-Blatt AfA) bis Ende
  function monateImJahr(beginn, jahr, ende) {
    if (!beginn || beginn.j > jahr) return 0;
    if (ende && ende.j < jahr) return 0;
    var von = beginn.j === jahr ? beginn.m : 1;
    var bis = ende && ende.j === jahr ? ende.m : 12;
    return Math.max(0, bis - von + 1);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- AfA Gebäude ---------- */
  function typSatz(fertigJahr) {
    if (!fertigJahr) return null;
    if (fertigJahr < 1925) return 0.025;
    if (fertigJahr <= 2022) return 0.02;
    return 0.03;
  }

  // § 7 Abs. 5a EStG: Herstellungsbeginn nach 30.09.2023 und vor 01.10.2029, bei Anschaffung
  // zusätzlich obligatorischer Vertrag im selben Fenster und Anschaffung bis Ende des Fertigstellungsjahres.
  function pruefeDegressiv(e) {
    var res = { zulaessig: true, gruende: [], fehlend: [] };
    var von = { j: 2023, m: 9, t: 30 }, bis = { j: 2029, m: 10, t: 1 };
    var kv = parseDatum(e.kaufvertrag), ueb = parseDatum(e.uebergang), bb = parseDatum(e.baubeginn);
    var fj = e.fertigJahr || (parseDatum(e.fertigstellung) || {}).j;
    if (!kv) { res.fehlend.push('Datum Kaufvertrag'); }
    else if (!(vor(von, kv) && vor(kv, bis))) { res.zulaessig = false; res.gruende.push('Kaufvertrag ' + fmtDatum(kv) + ' liegt nicht zwischen 01.10.2023 und 30.09.2029'); }
    if (!bb) { res.fehlend.push('Baubeginn (Bauantrag oder Baubeginnsanzeige)'); }
    else if (!(vor(von, bb) && vor(bb, bis))) { res.zulaessig = false; res.gruende.push('Baubeginn ' + fmtDatum(bb) + ' liegt nicht zwischen 01.10.2023 und 30.09.2029'); }
    if (!fj) { res.fehlend.push('Jahr der Fertigstellung'); }
    else if (ueb && ueb.j > fj) { res.zulaessig = false; res.gruende.push('Anschaffung ' + ueb.j + ' nach dem Jahr der Fertigstellung ' + fj); }
    return res;
  }

  // Jahresverlauf der Gebäude-AfA vom Beginn bis zum Zieljahr. Nachträgliche bzw. anschaffungsnahe
  // HK erhöhen die Bemessungsgrundlage zu Beginn des Zahlungsjahres (R 7.4 Abs. 9 EStR).
  // p.sonder = { start, betrag }: Sonderabschreibung § 7b im Anschaffungsjahr und den drei Folgejahren,
  // nicht zeitanteilig. Danach lineare AfA vom Restwert (§ 7a Abs. 9 EStG).
  function afaVerlauf(p, bisJahr) {
    var rows = [], bmg = p.bmg, rest = p.bmg, beginn = p.beginn, s = p.sonder, nachBasis = null;
    for (var j = beginn.j; j <= bisJahr; j++) {
      var zugang = num((p.zugaenge || {})[j]);
      if (zugang) { bmg += zugang; rest += zugang; if (nachBasis != null) nachBasis += zugang; }
      if (s && j === s.start + 4 && p.methode !== 'degressiv') nachBasis = rest;
      var m = monateImJahr(beginn, j, p.ende);
      var basis = p.methode === 'degressiv' ? rest : (nachBasis != null ? nachBasis : bmg);
      var a = Math.min(rest, basis * p.satz * m / 12);
      if (rest - a < 0.005) a = rest;
      rest -= a;
      var so = 0;
      if (s && j >= s.start && j < s.start + 4 && m > 0) { so = Math.min(rest, s.betrag); rest -= so; }
      rows.push({ jahr: j, monate: m, bmg: bmg, afa: a, sonder: so, restwert: rest });
      if (rest <= 0.005) { rest = 0; if (j < bisJahr) { for (var k = j + 1; k <= bisJahr; k++) rows.push({ jahr: k, monate: 0, bmg: bmg, afa: 0, sonder: 0, restwert: 0 }); } break; }
    }
    return rows;
  }

  /* ---------- § 7b Sonderabschreibung Mietwohnungsneubau ---------- */
  var F7B = [
    { name: '01.09.2018 bis 31.12.2021', von: { j: 2018, m: 9, t: 1 }, bis: { j: 2021, m: 12, t: 31 }, grenzeQm: 3000, bmgQm: 2000, eh40: false },
    { name: '01.01.2023 bis 30.09.2029', von: { j: 2023, m: 1, t: 1 }, bis: { j: 2029, m: 9, t: 30 }, grenzeQm: 5200, bmgQm: 4000, eh40: true }
  ];
  function hat7b(e) { return !!e && (e.sonderAfA7b === true || e.sonderAfA7b === 'ja'); }
  function pruefe7b(e, o, akGeb) {
    var res = { zulaessig: true, gruende: [], fehlend: [], fenster: null, bmg: 0, kostenQm: null };
    var ba = parseDatum(e.bauantrag), ueb = parseDatum(e.uebergang);
    var fj = e.fertigJahr || (parseDatum(e.fertigstellung) || {}).j;
    if (!ba) res.fehlend.push('Datum des Bauantrags oder der Bauanzeige');
    else {
      res.fenster = F7B.filter(function (f) { return !vor(ba, f.von) && !vor(f.bis, ba); })[0] || null;
      if (!res.fenster) { res.zulaessig = false; res.gruende.push('Bauantrag vom ' + fmtDatum(ba) + ' liegt in keinem Förderzeitraum (' + F7B.map(function (f) { return f.name; }).join(' oder ') + ')'); }
    }
    var qm = num((o || {}).wohnflaeche);
    if (!qm) res.fehlend.push('Wohnfläche');
    if (res.fenster && qm && akGeb) {
      res.kostenQm = akGeb / qm;
      if (res.kostenQm > res.fenster.grenzeQm) { res.zulaessig = false; res.gruende.push('Anschaffungskosten des Gebäudes ' + eur(Math.round(res.kostenQm)) + ' je m² liegen über der Grenze von ' + eur(res.fenster.grenzeQm)); }
      res.bmg = Math.min(akGeb, res.fenster.bmgQm * qm);
    }
    if (res.fenster && res.fenster.eh40) {
      if (e.eh40qng === 'nein') { res.zulaessig = false; res.gruende.push('Die Wohnung erfüllt nicht den Standard Effizienzhaus 40 mit QNG-Siegel'); }
      else if (e.eh40qng !== 'ja') res.fehlend.push('Nachweis Effizienzhaus 40 mit QNG-Siegel');
    }
    if (!fj) res.fehlend.push('Jahr der Fertigstellung');
    else if (ueb && ueb.j > fj) { res.zulaessig = false; res.gruende.push('Anschaffung ' + ueb.j + ' nicht bis zum Ende des Fertigstellungsjahres ' + fj); }
    return res;
  }

  /* ---------- Mietverhältnisse im Jahr (Mieterwechsel, Leerstand) ---------- */
  function tageImMonat(j, m) { return new Date(Date.UTC(j, m, 0)).getUTCDate(); }
  function spaeter(a, b) { return vor(a, b) ? b : a; }
  function frueher(a, b) { return vor(a, b) ? a : b; }
  function mieteAusVertraegen(vertraege, vz, ueb, ende) {
    var kalt = 0, uml = 0, leer = 0, besitz = 0;
    var vs = (vertraege || []).filter(function (v) { return v && parseDatum(v.von); });
    for (var m = 1; m <= 12; m++) {
      var tm = tageImMonat(vz, m), a = { j: vz, m: m, t: 1 }, z = { j: vz, m: m, t: tm };
      if (ueb && vor(z, ueb)) continue;
      if (ende && vor(ende, a)) continue;
      besitz++;
      var anfang = ueb ? spaeter(a, ueb) : a, schluss = ende ? frueher(z, ende) : z, belegt = 0;
      vs.forEach(function (v) {
        var s = spaeter(parseDatum(v.von), anfang), e = v.bis ? frueher(parseDatum(v.bis), schluss) : schluss;
        if (vor(e, s)) return;
        var f = (e.t - s.t + 1) / tm;
        kalt += num(v.kaltMonat) * f; uml += num(v.umlagenMonat) * f; belegt += f;
      });
      if (belegt === 0) leer++;
    }
    return { kalt: r2(kalt), uml: r2(uml), leer: leer, besitz: besitz };
  }

  /* ---------- Kontoauszug: einlesen, zuordnen, abgleichen ---------- */
  var KAT = {
    miete: { t: 'Miete', art: 'E' }, nk_abrechnung: { t: 'Nebenkostenabrechnung Mieter', art: 'E' }, kaution: { t: 'Kaution', art: 'N' },
    hausgeld: { t: 'Hausgeld', art: 'W' }, hg_abrechnung: { t: 'Hausgeldabrechnung', art: 'W' }, verwaltung: { t: 'Mietverwaltung', art: 'W' },
    darlehen: { t: 'Darlehensrate', art: 'N' }, zinsen: { t: 'Schuldzinsen', art: 'W' }, tilgung: { t: 'Tilgung', art: 'N' },
    grundsteuer: { t: 'Grundsteuer', art: 'W' }, versicherung: { t: 'Versicherung', art: 'W' }, kontofuehrung: { t: 'Kontoführung', art: 'W' },
    steuerberatung: { t: 'Steuerberatung', art: 'W' }, erhaltung: { t: 'Reparatur, Handwerker', art: 'W' },
    kauf: { t: 'Kauf oder Grundschuld', art: 'N' }, habenzins: { t: 'Guthabenzinsen', art: 'N' }, privat: { t: 'Privat, Umbuchung', art: 'N' },
    unklar: { t: 'Ungeklärt', art: '?' }
  };
  function parseBetrag(s) {
    if (s == null) return NaN;
    s = String(s).replace(/EUR|€|\s/gi, '');
    if (!s) return NaN;
    var neg = false, sh = /([SH])$/i.exec(s);
    if (sh) { neg = sh[1].toUpperCase() === 'S'; s = s.slice(0, -1); }
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^-/.test(s) || /-$/.test(s)) { neg = true; s = s.replace(/^-|-$/g, ''); }
    s = s.replace(/^\+/, '');
    if (!/^[\d.,]+$/.test(s)) return NaN;
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(/[.,]/g, '');
    var n = Number(s);
    return isFinite(n) ? (neg ? -n : n) : NaN;
  }
  function parseDatumText(s) {
    s = String(s || '').trim();
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s);
    if (m) { var j = +m[3]; if (j < 100) j += 2000; return j + '-' + String(+m[2]).padStart(2, '0') + '-' + String(+m[1]).padStart(2, '0'); }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }
  function csvZerlegen(text) {
    var zeilen = text.replace(/^﻿/, '').split(/\r?\n/), probe = zeilen.slice(0, 40).join('\n');
    var anz = function (c) { return probe.split(c).length - 1; };
    var d = anz(';') >= 5 ? ';' : anz('\t') >= 5 ? '\t' : ',';
    return zeilen.map(function (z) {
      var out = [], cur = '', inQ = false;
      for (var i = 0; i < z.length; i++) {
        var c = z[i];
        if (inQ) { if (c === '"') { if (z[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
        else if (c === '"') inQ = true;
        else if (c === d) { out.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      out.push(cur.trim());
      return out;
    });
  }
  function zahlInZeile(zellen, ab) {
    for (var i = ab; i < zellen.length; i++) { if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(zellen[i]) && !/,\d{2}/.test(zellen[i])) continue; var n = parseBetrag(zellen[i]); if (!isNaN(n)) return n; }
    return null;
  }
  function parseCsvKonto(text) {
    var rows = csvZerlegen(text), kopf = -1;
    for (var i = 0; i < Math.min(rows.length, 40); i++) {
      var lc = rows[i].map(function (c) { return c.toLowerCase(); });
      if (lc.some(function (c) { return /buchung|datum|valuta|wertstellung|^date/.test(c); }) && lc.some(function (c) { return /betrag|umsatz|^soll|^haben|amount/.test(c); })) { kopf = i; break; }
    }
    if (kopf < 0) throw new Error('Keine Spaltenüberschriften mit Datum und Betrag gefunden');
    var h = rows[kopf].map(function (c) { return c.toLowerCase(); });
    var finde = function (re, ausser) { for (var k = 0; k < h.length; k++) if (re.test(h[k]) && !(ausser && ausser.test(h[k]))) return k; return -1; };
    var cDat = finde(/^(buchungstag|buchungsdatum|buchung)$/); if (cDat < 0) cDat = finde(/buchung/, /text|art|zweck|status/); if (cDat < 0) cDat = finde(/datum|^date/); if (cDat < 0) cDat = finde(/valuta|wertstellung/);
    var cBet = finde(/^betrag|^umsatz|amount/, /ursprung|original|fremdw/), cSoll = finde(/^soll|ausgang|belastung|lastschrift/), cHaben = finde(/^haben|eingang|gutschrift/);
    var cSH = finde(/^(s\/h|soll\/haben|s\/h-kennzeichen)$/);
    var cTxt = [];
    h.forEach(function (x, k) { if (/verwendungszweck|buchungstext|vorgang|beschreibung|zweck|^text|buchungsdetails|umsatzart/.test(x) && k !== cDat) cTxt.push(k); });
    var cName = finde(/beg(ü|ue)nstigter|zahlungspflichtiger|auftraggeber|empf(ä|ae)nger|zahlungsbeteiligter|partner|^name|gegenseite/, /iban|bic|konto|blz/);
    var cSaldo = finde(/saldo|kontostand/);
    if (cDat < 0 || (cBet < 0 && cSoll < 0 && cHaben < 0)) throw new Error('Spalten für Datum oder Betrag nicht erkannt');
    var bew = [], anfang = null, ende = null;
    var meta = function (zellen) {
      var t = zellen.join(' ').toLowerCase();
      if (/anfangssaldo|alter kontostand|saldo alt|startsaldo|kontostand zu beginn/.test(t)) { var n = zahlInZeile(zellen, 1); if (n != null) anfang = n; }
      else if (/endsaldo|neuer kontostand|saldo neu|schlusssaldo|kontostand vom|kontostand am|aktueller kontostand/.test(t)) { var n2 = zahlInZeile(zellen, 1); if (n2 != null) ende = n2; }
    };
    for (var r = 0; r < rows.length; r++) {
      if (r === kopf) continue;
      var z = rows[r];
      var dat = r > kopf ? parseDatumText(z[cDat]) : null;
      if (!dat) { meta(z); continue; }
      var betrag;
      if (cBet >= 0) betrag = parseBetrag(z[cBet]);
      else { var s1 = parseBetrag(z[cSoll]), h1 = parseBetrag(z[cHaben]); betrag = (isNaN(h1) ? 0 : Math.abs(h1)) - (isNaN(s1) ? 0 : Math.abs(s1)); }
      if (cSH >= 0 && /^s/i.test(z[cSH] || '')) betrag = -Math.abs(betrag);
      if (isNaN(betrag) || betrag === 0) continue;
      bew.push({ datum: dat, betrag: r2(betrag), text: cTxt.map(function (k) { return z[k]; }).filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 160), name: cName >= 0 ? String(z[cName] || '').slice(0, 70) : '', saldo: cSaldo >= 0 ? parseBetrag(z[cSaldo]) : NaN });
    }
    var ab = 0, auf = 0;
    for (var q = 1; q < bew.length; q++) { if (bew[q].datum < bew[q - 1].datum) ab++; else if (bew[q].datum > bew[q - 1].datum) auf++; }
    if (ab > auf) bew.reverse();
    bew.forEach(function (b, k) { b._k = k; });
    bew.sort(function (a, b) { return a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a._k - b._k; });
    bew.forEach(function (b) { delete b._k; });
    if (bew.length && !isNaN(bew[0].saldo) && !isNaN(bew[bew.length - 1].saldo)) {
      if (anfang == null) anfang = r2(bew[0].saldo - bew[0].betrag);
      if (ende == null) ende = bew[bew.length - 1].saldo;
    }
    bew.forEach(function (b) { delete b.saldo; });
    return { format: 'CSV', anfang: anfang, ende: ende, bewegungen: bew };
  }
  function parseCamt(xml) {
    if (typeof DOMParser === 'undefined') throw new Error('CAMT kann nur im Browser gelesen werden');
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Die XML-Datei ist beschädigt');
    var tag = function (el, n) { return el ? el.getElementsByTagNameNS('*', n) : []; };
    var pfad = function (el, p) { var cur = el; p.split('/').forEach(function (n) { cur = cur && tag(cur, n)[0]; }); return cur ? cur.textContent.trim() : ''; };
    var anfang = null, ende = null, bew = [];
    Array.prototype.forEach.call(tag(doc, 'Bal'), function (b) {
      var cd = pfad(b, 'Tp/CdOrPrtry/Cd'), w = num(pfad(b, 'Amt')) * (pfad(b, 'CdtDbtInd') === 'DBIT' ? -1 : 1);
      if ((cd === 'OPBD' || cd === 'PRCD') && anfang == null) anfang = w;
      if (cd === 'CLBD') ende = w;
    });
    Array.prototype.forEach.call(tag(doc, 'Ntry'), function (n) {
      if (/PDNG|INFO/.test(pfad(n, 'Sts'))) return;
      var haben = pfad(n, 'CdtDbtInd') === 'CRDT', betrag = num(tag(n, 'Amt')[0] && tag(n, 'Amt')[0].textContent) * (haben ? 1 : -1);
      var dat = pfad(n, 'BookgDt/Dt') || pfad(n, 'BookgDt/DtTm').slice(0, 10) || pfad(n, 'ValDt/Dt');
      var txt = Array.prototype.map.call(tag(n, 'Ustrd'), function (u) { return u.textContent.trim(); }).join(' ') || pfad(n, 'AddtlNtryInf');
      var name = haben ? pfad(n, 'RltdPties/Dbtr/Nm') : pfad(n, 'RltdPties/Cdtr/Nm');
      if (!dat || !betrag) return;
      bew.push({ datum: dat.slice(0, 10), betrag: r2(betrag), text: txt.replace(/\s+/g, ' ').slice(0, 160), name: name.slice(0, 70) });
    });
    bew.sort(function (a, b) { return a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0; });
    return { format: 'CAMT', anfang: anfang, ende: ende, bewegungen: bew };
  }
  function kontoEinlesen(text, dateiname) {
    var r = /^\s*</.test(text) || /\.xml$|camt/i.test(dateiname || '') ? parseCamt(text) : parseCsvKonto(text);
    r.von = r.bewegungen.length ? r.bewegungen[0].datum : null;
    r.bis = r.bewegungen.length ? r.bewegungen[r.bewegungen.length - 1].datum : null;
    return r;
  }
  function kontoKontext(i) {
    var m = i.miete || {}, kalt = num(m.kaltMonat), uml = num(m.umlagenMonat);
    if (!kalt && Array.isArray(m.vertraege) && m.vertraege.length) { var lv = m.vertraege[m.vertraege.length - 1] || {}; kalt = num(lv.kaltMonat); uml = num(lv.umlagenMonat); }
    return { kalt: kalt, umlagen: uml, warm: kalt + uml, hausgeld: num((i.hausgeld || {}).monat) };
  }
  function kontoRegel(b, ctx) {
    ctx = ctx || {};
    var s = ((b.name || '') + ' ' + (b.text || '')).toLowerCase(), ein = b.betrag > 0, aus = b.betrag < 0, abs = Math.abs(b.betrag);
    var nah = function (x) { return x > 0 && Math.abs(abs - x) <= Math.max(1, x * 0.005); };
    if (/kaution|mietsicherheit/.test(s)) return 'kaution';
    if (/kaufpreis|grunderwerb|gerichtskasse|grundbuch|notar/.test(s)) return 'kauf';
    if (ein && /habenzins|zinsgutschrift|guthabenzins|zinsertrag/.test(s)) return 'habenzins';
    if (/grundsteuer|grundbesitzabgab|stadtkasse|gemeindekasse|steueramt/.test(s)) return 'grundsteuer';
    if (/steuerberat|steuerkanzlei|\bstbg\b/.test(s)) return 'steuerberatung';
    if (/(neben|betriebs)kosten.{0,3}(abrechnung|nachzahlung|erstattung|guthaben)|\b(nk|bk)[- ]?abrechnung/.test(s)) return 'nk_abrechnung';
    if (/(hausgeld|wohngeld|jahres).{0,3}abrechnung|abrechnungsspitze/.test(s)) return 'hg_abrechnung';
    if (aus && /mietverwaltung|sondereigentumsverwaltung|\bsev\b/.test(s)) return 'verwaltung';
    if (aus && (/hausgeld|wohngeld|eigent(ü|ue)mergemeinschaft|\bweg\b|hausverwaltung/.test(s) || nah(ctx.hausgeld))) return 'hausgeld';
    if (aus && /annuit|darlehen|kredit|baufinanz|hypothek|tilgung|zins/.test(s)) {
      var z = /zins/.test(s), t = /tilgung/.test(s);
      if (/sondertilgung/.test(s) || (t && !z)) return 'tilgung';
      if (z && !t && !/rate|annuit/.test(s)) return 'zinsen';
      return 'darlehen';
    }
    if (aus && /versicherung|haftpflicht|allianz|\baxa\b|\bhuk\b|\bergo\b|generali|provinzial|signal iduna/.test(s)) return 'versicherung';
    if (aus && /kontof(ü|ue)hrung|kontoentgelt|kontopreis|entgelt|rechnungsabschluss|abschluss|geb(ü|ue)hr/.test(s)) return 'kontofuehrung';
    if (aus && /reparatur|handwerk|sanit(ä|ae)r|heizung|elektro|maler|install|schl(ü|ue)ssel|instand|rohrreinigung|dachdecker|fliesen|bodenleger|tischler|schreiner|glaser/.test(s)) return 'erhaltung';
    if (ein && (/miete|mietzahlung|nutzungsentgelt|wohnung/.test(s) || nah(ctx.warm) || nah(ctx.kalt))) return 'miete';
    if (/umbuchung|(ü|ue)bertrag|eigen(ü|ue)berweisung|tagesgeld|sparplan|depot/.test(s)) return 'privat';
    return 'unklar';
  }
  function kontoZuordnen(bewegungen, ctx) {
    (bewegungen || []).forEach(function (b) { if (!b.manuell) b.kat = kontoRegel(b, ctx); });
    return bewegungen;
  }
  // Zehn-Tage-Regel (§ 11 Abs. 1 Satz 2, Abs. 2 Satz 2 EStG, H 11 EStH): regelmäßig wiederkehrende
  // Zahlungen, die kurz vor oder nach dem Jahreswechsel fällig sind und gezahlt werden, gehören in
  // das Jahr, zu dem sie wirtschaftlich gehören. Miete und Hausgeld sind im Voraus zum Monatsanfang
  // fällig: Eine Zahlung vom 22. bis 31.12. für Januar gehört ins neue Jahr. Eine Dezember-Miete im
  // Januar war schon Anfang Dezember fällig und bleibt im Zahlungsjahr. Zinsen sind meist zum
  // Monatsende fällig: Eine Belastung vom 1. bis 10.01. für Dezember gehört ins alte Jahr.
  var MONATE = ['januar|jan', 'februar|feb', 'märz|maerz|mrz', 'april|apr', 'mai', 'juni|jun', 'juli|jul', 'august|aug', 'september|sept|sep', 'oktober|okt', 'november|nov', 'dezember|dez'];
  function monatAusText(s) {
    s = String(s || '').toLowerCase();
    for (var k = 0; k < 12; k++) if (new RegExp('(^|[^a-zäöü])(' + MONATE[k] + ')([^a-zäöü]|$)').test(s)) return k + 1;
    var m = /(^|\D)(0?[1-9]|1[0-2])[\/.-](20\d{2}|\d{2})(\D|$)/.exec(s);
    return m ? +m[2] : null;
  }
  var REGELMAESSIG = { miete: 'vorschuessig', hausgeld: 'vorschuessig', verwaltung: 'vorschuessig', versicherung: 'vorschuessig', darlehen: 'nachschuessig', zinsen: 'nachschuessig' };
  function zuordnungsJahr(b, kat) {
    var d = parseDatum(b.datum), art = REGELMAESSIG[kat || b.kat];
    if (!d) return { jahr: null };
    if (b.zj) return { jahr: +b.zj, regel: +b.zj !== d.j, manuell: true };
    if (!art) return { jahr: d.j };
    var mon = monatAusText(b.text);
    if (d.m === 12 && d.t >= 22 && art === 'vorschuessig' && (mon === 1 || mon == null)) return { jahr: d.j + 1, regel: true, annahme: mon == null };
    if (d.m === 1 && d.t <= 10 && art === 'nachschuessig' && (mon === 12 || mon == null)) return { jahr: d.j - 1, regel: true, annahme: mon == null };
    if (d.m === 1 && d.t <= 10 && art === 'vorschuessig' && mon === 12) return { jahr: d.j, dezember: true };
    return { jahr: d.j };
  }
  function kontoVerdichten(konto, vz, ctx) {
    var R = { anzahl: 0, summe: {}, zehnTage: [], dezember: 0, unklar: [], erhaltung: [], mieteAnzahl: 0, dateien: [], andereJahre: 0 };
    var bew = (konto && konto.bewegungen) || [];
    bew.forEach(function (b) {
      if (b.dup) return;
      var kat = b.kat || kontoRegel(b, ctx), zj = zuordnungsJahr(b, kat);
      if (zj.jahr !== vz) { R.andereJahre++; return; }
      R.anzahl++;
      R.summe[kat] = r2((R.summe[kat] || 0) + b.betrag);
      if (zj.regel) R.zehnTage.push({ datum: b.datum, betrag: b.betrag, kat: kat, annahme: !!zj.annahme });
      if (zj.dezember) R.dezember++;
      if (kat === 'unklar') R.unklar.push(b);
      if (kat === 'erhaltung') R.erhaltung.push(b);
      if (kat === 'miete' && b.betrag > 0) R.mieteAnzahl++;
    });
    R.dateien = ((konto && konto.dateien) || []).map(function (f, k) {
      var summe = r2(bew.filter(function (b) { return b.f === k; }).reduce(function (s, b) { return s + b.betrag; }, 0));
      var hat = f.anfang != null && f.ende != null && !isNaN(f.anfang) && !isNaN(f.ende);
      var diff = hat ? r2(num(f.anfang) + summe - num(f.ende)) : null;
      return { name: f.name, anfang: hat ? num(f.anfang) : null, ende: hat ? num(f.ende) : null, summe: summe, differenz: diff, stimmt: hat ? Math.abs(diff) < 0.005 : null, von: f.von, bis: f.bis, n: f.n };
    });
    var von = null, bis = null;
    R.dateien.forEach(function (f) { if (f.von && (!von || f.von < von)) von = f.von; if (f.bis && (!bis || f.bis > bis)) bis = f.bis; });
    R.von = von; R.bis = bis;
    return R;
  }

  function wgVerlauf(w, bisJahr) {
    var beginn = parseDatum(w.anschaffung), nd = num(w.nutzungsdauer) || 10, ak = num(w.ak), rest = ak, rows = [];
    if (!beginn) return rows;
    for (var j = beginn.j; j <= bisJahr; j++) {
      var m = monateImJahr(beginn, j, null);
      var a = Math.min(rest, ak / nd * m / 12);
      rest -= a;
      rows.push({ jahr: j, afa: a, restwert: rest });
    }
    return rows;
  }

  /* ---------- Sonderfälle ---------- */
  function sonderfaelle(i) {
    var o = i.objekt || {}, e = i.erwerb || {}, s = [];
    if (o.nutzung === 'ferienwohnung' || o.ferienwohnung) s.push('Ferienwohnung (Anlage V-FeWo)');
    if (o.nutzung === 'kurzfristig' || o.kurzfristig) s.push('kurzfristige Vermietung');
    if (o.anAngehoerige) s.push('Vermietung an Angehörige (§ 21 Abs. 2 EStG)');
    if (num(o.eigengenutztQm) > 0) s.push('teilweise Eigennutzung');
    if (num(o.gewerbeQm) > 0) s.push('Gewerbe oder andere Räume');
    if (o.ustOption) s.push('Umsatzsteuer-Option § 9 UStG');
    if (o.denkmal || o.sanierungsgebiet) s.push('Denkmal oder Sanierungsgebiet (§§ 7h, 7i EStG)');
    if (o.gemeinschaft) s.push('Grundstücksgemeinschaft (Anlage V-Sonstige)');
    if (e.art && e.art !== 'anschaffung') s.push('Erwerb durch ' + e.art);
    if (e.veraeussertUebergang) s.push('Veräußerung im Jahr');
    var ort = num((i.miete || {}).ortsueblicheMieteMonat), kalt = num((i.miete || {}).kaltMonat);
    if (ort > 0 && kalt > 0 && kalt < 0.66 * ort) s.push('verbilligte Vermietung unter 66% der ortsüblichen Miete');
    return s;
  }

  /* ---------- Hauptfunktion ---------- */
  function berechne(eingabe) {
    var i = clone(eingabe || {});
    var vz = num(i.vz);
    var e = i.erwerb || {}, miete = i.miete || {}, hg = i.hausgeld || {}, fin = i.finanzierung || {};
    var sonst = i.sonstige || {}, pers = i.personen || {};
    var H = [], L = [];
    function hinweis(id, ampel, titel, text, rg) { H.push({ id: id, ampel: ampel, titel: titel, text: text, rechtsgrundlage: rg || '', blockiert: ampel === 'rot' }); }
    function zeile(z, feld, betrag, art, rechenweg, quelle, extra) {
      var l = { zeile: z, feld: feld, betrag: betrag, art: art, rechenweg: rechenweg || '', quelle: quelle || '' };
      if (extra) for (var k in extra) l[k] = extra[k];
      L.push(l); return l;
    }

    var ueb = parseDatum(e.uebergang);
    var ende = parseDatum(e.veraeussertUebergang);
    var kaufjahr = ueb ? ueb.j : null;
    var erstjahr = kaufjahr === vz;
    var monate = miete.monate != null ? num(miete.monate) : (ueb ? monateImJahr(ueb, vz, ende) : 12);

    /* Sonderfälle */
    var sf = sonderfaelle(i);
    sf.forEach(function (t, k) { hinweis('SF' + (k + 1), 'rot', 'Sonderfall, Kanzlei', t + '. Nicht im Festpreis-Standardfall, die Kanzlei rechnet und bepreist einzeln.'); });

    /* ---------- Kontoauszug (hat Vorrang vor Monatswerten und Mietverhältnissen) ---------- */
    var KV = null, kontoZinsen = 0;
    if (i.konto && (i.konto.bewegungen || []).length && i.konto.uebernehmen !== false) {
      var ctx = kontoKontext(i);
      KV = kontoVerdichten(i.konto, vz, ctx);
      var SU = KV.summe, mieteEin = num(SU.miete);
      if (mieteEin) {
        var qk = ctx.warm > 0 ? ctx.kalt / ctx.warm : 1;
        miete.kaltJahr = r2(mieteEin * qk); miete.umlagenJahr = r2(mieteEin - miete.kaltJahr);
        miete._herkunft = 'Kontoauszug: ' + KV.mieteAnzahl + ' Mietzahlungen über ' + eur(mieteEin) + (qk < 1 ? ', Kaltmiete ' + pct(qk) + ' laut Mietvertrag' : '');
        miete._herkunftUml = 'Kontoauszug: Anteil Nebenkosten ' + pct(1 - qk) + ' der Mietzahlungen';
        miete.quelle = 'Kontoauszug, Mietvertrag';
        if (!(ctx.warm > 0)) hinweis('K04', 'gelb', 'Aufteilung der Miete unklar', 'Ohne Kaltmiete und Nebenkosten aus dem Mietvertrag ist die ganze Mietzahlung als Kaltmiete gerechnet.', '');
      }
      if (SU.nk_abrechnung != null) miete.nkAbrechnung = SU.nk_abrechnung;
      if (SU.hausgeld != null) { hg.gezahltJahr = -SU.hausgeld; hg._ausKonto = true; }
      if (SU.verwaltung != null) hg.verwaltungJahr = -SU.verwaltung;
      var kd = i.kostenDirekt = i.kostenDirekt || {};
      if (SU.grundsteuer) kd.umlagefaehig = num(kd.umlagefaehig) - SU.grundsteuer;
      if (SU.versicherung) kd.nichtUmlagefaehig = num(kd.nichtUmlagefaehig) - SU.versicherung;
      if (SU.hg_abrechnung) kd.nichtUmlagefaehig = num(kd.nichtUmlagefaehig) - SU.hg_abrechnung;
      if (SU.kontofuehrung) sonst.kontofuehrung = num(sonst.kontofuehrung) - SU.kontofuehrung;
      if (SU.steuerberatung) sonst.steuerberatung = num(sonst.steuerberatung) - SU.steuerberatung;
      kontoZinsen = -num(SU.zinsen);
      i.erhaltung = i.erhaltung || [];
      KV.erhaltung.forEach(function (b) { if (b.betrag < 0) i.erhaltung.push({ datum: b.datum, brutto: -b.betrag, netto: r2(-b.betrag / 1.19), bezeichnung: b.name || b.text, quelle: 'Kontoauszug' }); });

      KV.dateien.forEach(function (f, k) {
        if (f.stimmt === false) hinweis('K01-' + (k + 1), 'rot', 'Kontoauszug unvollständig', f.name + ': Anfangssaldo ' + eur(f.anfang) + ' plus Umsätze ' + eur(f.summe) + ' ergibt ' + eur(r2(f.anfang + f.summe)) + ', laut Auszug ' + eur(f.ende) + '. Differenz ' + eur(f.differenz) + '. Es fehlen Umsätze oder ein Betrag ist falsch eingelesen.', 'Vollständigkeit der Einnahmen');
        else if (f.stimmt == null) hinweis('K01-' + (k + 1), 'gelb', 'Salden fehlen', f.name + ' enthält keinen Anfangs- und Endsaldo. Die Vollständigkeit der Umsätze ist nicht geprüft.', '');
        else hinweis('K01-' + (k + 1), 'ok', 'Kontoauszug vollständig', f.name + ': Anfangssaldo plus ' + f.n + ' Umsätze ergibt genau den Endsaldo.', '');
      });
      if (KV.unklar.length) hinweis('K02', 'rot', 'Ungeklärte Zahlungen', KV.unklar.length + (KV.unklar.length === 1 ? ' Zahlung' : ' Zahlungen') + ' über zusammen ' + eur(r2(KV.unklar.reduce(function (s, b) { return s + b.betrag; }, 0))) + ' sind keiner Position zugeordnet. Zuordnen oder als privat markieren.', '');
      if (KV.zehnTage.length) {
        var ann = KV.zehnTage.filter(function (x) { return x.annahme; }).length;
        hinweis('K03', ann ? 'gelb' : 'info', 'Zehn-Tage-Regel angewendet', KV.zehnTage.length + ' regelmäßige Zahlungen um den Jahreswechsel sind dem Jahr zugeordnet, zu dem sie gehören.' + (ann ? ' Bei ' + ann + ' Zahlungen ohne Monatsangabe ist angenommen, dass Miete oder Hausgeld im Dezember für Januar und Zinsen im Januar für Dezember gezahlt wurden. Bitte prüfen.' : ''), '§ 11 Abs. 1 Satz 2 und Abs. 2 Satz 2 EStG, H 11 EStH');
      }
      if (KV.dezember) hinweis('K03b', 'info', 'Dezember-Miete im Januar', KV.dezember + ' Zahlungen für Dezember kamen erst im Januar. Sie zählen im Jahr der Zahlung, weil sie schon Anfang Dezember fällig waren.', 'BFH, Urteil vom 27.06.2018, X R 44/16');
      if (KV.von && KV.von > (vz - 1) + '-12-22') hinweis('K06', 'info', 'Zeitraum ab 22.12. des Vorjahres', 'Eine Januar-Miete, die schon Ende Dezember ' + (vz - 1) + ' eingegangen ist, zählt für ' + vz + '. Lesen Sie dafür die Umsätze ab dem 22.12.' + (vz - 1) + ' ein.', '§ 11 EStG');
      if (KV.bis && KV.bis < vz + '-12-31' && KV.bis < new Date().toISOString().slice(0, 10)) hinweis('K06b', 'gelb', 'Kontoauszug endet vor Jahresende', 'Die Umsätze reichen nur bis ' + fmtDatum(parseDatum(KV.bis)) + '. Fehlende Monate werden nicht mitgerechnet.', '');
      if (KV.erhaltung.length) hinweis('K07', 'gelb', 'Reparaturen aus dem Kontoauszug', KV.erhaltung.length + ' Zahlungen an Handwerker sind als Erhaltung angesetzt, netto mit 19% Umsatzsteuer geschätzt. Bitte die Rechnungen hochladen, damit die Kanzlei Erhaltung, Verteilung und die 15%-Grenze prüft.', '§ 6 Abs. 1 Nr. 1a EStG, § 82b EStDV');
    }

    /* ---------- Mietverhältnisse (Mieterwechsel, Leerstand) ---------- */
    var vtr = Array.isArray(miete.vertraege) ? miete.vertraege.filter(function (v) { return v && parseDatum(v.von); }) : [];
    if (vtr.length) {
      var mv = mieteAusVertraegen(vtr, vz, ueb, ende);
      if (miete.kaltJahr == null) {
        miete.kaltJahr = mv.kalt; miete.umlagenJahr = mv.uml;
        miete._herkunft = vtr.map(function (v) { return fmtDatum(parseDatum(v.von)) + ' bis ' + (v.bis ? fmtDatum(parseDatum(v.bis)) : 'laufend') + ' ' + eur(num(v.kaltMonat)); }).join(' · ') + ', taggenau';
        miete._herkunftUml = 'Mietverhältnisse taggenau';
        miete.quelle = 'Mietverträge';
      }
      if (mv.leer) hinweis('P08c', 'gelb', 'Leerstand', mv.leer + (mv.leer === 1 ? ' Monat' : ' Monate') + ' ohne Mietverhältnis. Die Kosten bleiben abziehbar, wenn in der Zeit ernsthaft ein Mieter gesucht wurde. Inserate oder Maklerauftrag aufbewahren.', 'BFH zur Einkünfteerzielungsabsicht bei Leerstand');
      if (KV && KV.mieteAnzahl && KV.mieteAnzahl < mv.besitz - mv.leer) hinweis('K05', 'gelb', 'Weniger Mietzahlungen als Monate', KV.mieteAnzahl + ' Mietzahlungen bei ' + (mv.besitz - mv.leer) + ' vermieteten Monaten. Mietrückstand oder fehlende Umsätze?', '');
    } else if (KV && KV.mieteAnzahl && KV.mieteAnzahl < monate) {
      hinweis('K05', 'gelb', 'Weniger Mietzahlungen als Monate', KV.mieteAnzahl + ' Mietzahlungen bei ' + monate + ' Monaten. Mietrückstand, Leerstand oder fehlende Umsätze?', '');
    }
    if (KV && KV.mieteAnzahl > monate + 1) hinweis('K05b', 'gelb', 'Mehr Mietzahlungen als Monate', KV.mieteAnzahl + ' Mietzahlungen bei ' + monate + ' Monaten ab Übergang. Zahlungen vor dem Übergang stehen dem Verkäufer zu, Nachzahlungen gehören in die Zeile für frühere Jahre. Bitte prüfen.', '');

    /* ---------- Einnahmen ---------- */
    var kaltJahr = miete.kaltJahr != null ? num(miete.kaltJahr) : num(miete.kaltMonat) * monate;
    var z13 = zeile('13', 'Mieteinnahmen Wohnung', einnahme(kaltJahr), 'E',
      miete._herkunft || (miete.kaltJahr != null ? 'Jahressumme laut Eingabe' : monate + ' Monate × ' + eur(num(miete.kaltMonat))), miete.quelle || 'Mietvertrag, Kontoauszug');
    zeile('15', 'Summe Mieteinnahmen Wohnungen', z13.betrag, 'S', 'Zeile 13');
    var uml = miete.umlagenJahr != null ? num(miete.umlagenJahr) : num(miete.umlagenMonat) * monate;
    var z20 = zeile('20', 'Umlagen, laufende Neben- und Betriebskosten', einnahme(uml), 'E',
      miete._herkunftUml || (miete.umlagenJahr != null ? 'Jahressumme laut Eingabe' : monate + ' Monate × ' + eur(num(miete.umlagenMonat))), 'Mietvertrag, Kontoauszug');
    var z21 = zeile('21', 'Nachzahlungen und Erstattungen aus Nebenkostenabrechnung', einnahme(num(miete.nkAbrechnung)), 'E',
      'im Jahr erhaltene Nachzahlung (+) oder geleistete Erstattung (−)', 'Nebenkostenabrechnung an Mieter, Kontoauszug');
    var z25 = zeile('25', 'Mieten für frühere Jahre, verrechnete Kaution', einnahme(num(miete.fruehereJahre)), 'E', '', 'Kontoauszug');
    var z26 = zeile('26', 'Einnahmen aus Garagen, Stellplätzen', einnahme(num(miete.garageJahr)), 'E', '', 'Stellplatzvertrag');
    var ein = z13.betrag + z20.betrag + z21.betrag + z25.betrag + z26.betrag;
    zeile('32', 'Summe der Einnahmen', ein, 'S', 'Zeilen 15, 20, 21, 25, 26');

    /* ---------- Anschaffungsnahe HK und Erhaltung (vor der AfA, weil sie die BMG verändern) ---------- */
    var erh = (i.erhaltung || []).map(function (x) { var d = parseDatum(x.datum); return { d: d, x: x, netto: num(x.netto), brutto: x.brutto != null ? num(x.brutto) : num(x.netto) * 1.19 }; });
    var fristEnde = ueb ? { j: ueb.j + 3, m: ueb.m, t: ueb.t } : null;
    var innerhalb = erh.filter(function (r) { return ueb && r.d && !vor(r.d, ueb) && vor(r.d, fristEnde) && !r.x.jaehrlichUeblich; });
    var summeNetto = innerhalb.reduce(function (s, r) { return s + r.netto; }, 0);

    /* ---------- AfA Gebäude ---------- */
    var inventarImKP = (i.inventar || []).filter(function (w) { return w.imKaufpreis; }).reduce(function (s, w) { return s + num(w.ak); }, 0);
    var nk = typeof e.nebenkosten === 'object' && e.nebenkosten ? Object.keys(e.nebenkosten).reduce(function (s, k) { return s + num(e.nebenkosten[k]); }, 0) : num(e.nebenkosten);
    var anteil = num(e.gebaeudeanteil);
    if (anteil > 1) anteil = anteil / 100;
    var akGeb = 0, afaZeile = null, afaInfo = {}, sonder7b = null, sonderVZ = 0;
    var zugaenge = {};
    var grenze15 = 0, anschaffungsnah = false;

    if (i.bestand) {
      // Bestandsobjekt mit Werten aus der Vorjahreserklärung (Schlüssel 1 = wie Vorjahr)
      var b = i.bestand;
      var satzB = num(b.satz);
      var restB = b.restwert0101 != null ? num(b.restwert0101) : num(b.bmg);
      var afaB = Math.min(restB, (b.methode === 'degressiv' ? restB : num(b.bmg)) * satzB * (b.monate != null ? num(b.monate) : 12) / 12);
      afaZeile = zeile('33', 'AfA Gebäude', werbung(afaB), 'W',
        (b.methode === 'degressiv' ? 'degressiv ' : 'linear ') + pct(satzB) + ' von ' + eur(b.methode === 'degressiv' ? restB : num(b.bmg)),
        'Vorjahreserklärung / AfA-Verlauf', { satz: satzB, methode: b.methode || 'linear', schluessel: 1 });
      afaInfo = { bmg: num(b.bmg), satz: satzB, methode: b.methode || 'linear', restwertEnde: restB - afaB, quelle: 'Bestand' };
    } else if (ueb && num(e.kaufpreis) > 0) {
      akGeb = (num(e.kaufpreis) - num(e.ruecklageImKaufpreis) - inventarImKP + nk) * anteil;
      // 15-%-Grenze § 6 Abs. 1 Nr. 1a EStG
      grenze15 = 0.15 * akGeb;
      if (summeNetto > grenze15 && grenze15 > 0) {
        anschaffungsnah = true;
        innerhalb.forEach(function (r) { if (r.d.j <= vz) zugaenge[r.d.j] = (zugaenge[r.d.j] || 0) + r.brutto; });
      }
      var fertigJahr = e.fertigJahr || (parseDatum(e.fertigstellung) || {}).j;
      var methode = e.afaMethode === 'degressiv' ? 'degressiv' : 'linear';
      if (methode === 'degressiv') {
        var pd = pruefeDegressiv(e);
        if (!pd.zulaessig) {
          hinweis('P11', 'rot', 'Degressive AfA nicht zulässig', pd.gruende.join('. ') + '. Linear gerechnet, Kanzlei entscheidet.', '§ 7 Abs. 5a EStG');
          methode = 'linear';
        } else if (pd.fehlend.length) {
          hinweis('P11', 'gelb', 'Degressive AfA: Nachweis fehlt', 'Fehlt: ' + pd.fehlend.join(', ') + '. Degressiv gerechnet, vor Freigabe Unterlage anfordern.', '§ 7 Abs. 5a EStG');
        } else {
          hinweis('P11', 'ok', 'Degressive AfA plausibel', 'Kaufvertrag und Baubeginn im Zeitfenster, Anschaffung im Jahr der Fertigstellung.', '§ 7 Abs. 5a EStG');
        }
      }
      var satz = methode === 'degressiv' ? 0.05 : (e.afaSatzAbweichend ? num(e.afaSatzAbweichend) : typSatz(fertigJahr));
      if (!satz) { satz = 0.02; hinweis('P10', 'rot', 'AfA-Satz nicht ermittelbar', 'Jahr der Fertigstellung fehlt. Vorläufig 2% gerechnet.', '§ 7 Abs. 4 EStG'); }
      if (e.afaSatzAbweichend && methode === 'linear') hinweis('P10b', 'gelb', 'Abweichender AfA-Satz', 'Satz ' + pct(satz) + ' wegen kürzerer Nutzungsdauer. Gutachten zur Restnutzungsdauer prüfen.', '§ 7 Abs. 4 Satz 2 EStG');
      if (hat7b(e)) {
        var p7b = pruefe7b(e, i.objekt || {}, akGeb);
        if (!p7b.zulaessig) hinweis('P14', 'rot', 'Sonderabschreibung § 7b nicht zulässig', p7b.gruende.join('. ') + '. Ohne Sonderabschreibung gerechnet.', '§ 7b EStG');
        else if (!p7b.bmg) hinweis('P14', 'gelb', 'Sonderabschreibung § 7b: Angaben fehlen', 'Fehlt: ' + p7b.fehlend.join(', ') + '. Noch nicht gerechnet.', '§ 7b EStG');
        else {
          sonder7b = { start: ueb.j, betrag: p7b.bmg * 0.05, bmg: p7b.bmg, fenster: p7b.fenster };
          if (p7b.fehlend.length) hinweis('P14', 'gelb', 'Sonderabschreibung § 7b: Nachweis fehlt', 'Fehlt: ' + p7b.fehlend.join(', ') + '. Gerechnet, vor Freigabe Unterlage anfordern.', '§ 7b EStG');
          else hinweis('P14', 'ok', 'Sonderabschreibung § 7b plausibel', 'Bauantrag im Zeitraum ' + p7b.fenster.name + ', Anschaffungskosten ' + eur(Math.round(p7b.kostenQm)) + ' je m², Anschaffung im Jahr der Fertigstellung.', '§ 7b EStG');
          hinweis('P15', 'gelb', 'De-minimis-Erklärung', 'Die Sonderabschreibung ist eine De-minimis-Beihilfe. Der Käufer erklärt, welche De-minimis-Beihilfen er in den letzten drei Jahren erhalten hat.', '§ 7b Abs. 5 EStG');
          if (methode === 'degressiv') hinweis('P14b', 'gelb', 'Sonderabschreibung neben degressiver AfA', 'Beide sind angesetzt. Die Kanzlei prüft, ob die Kombination nach § 7a Abs. 4 EStG in der geltenden Fassung zulässig ist.', '§ 7a Abs. 4 EStG');
        }
      }
      var verlauf = afaVerlauf({ bmg: akGeb, satz: satz, methode: methode, beginn: ueb, ende: ende, zugaenge: zugaenge, sonder: sonder7b }, vz);
      var jr = verlauf.filter(function (r) { return r.jahr === vz; })[0] || { afa: 0, monate: 0, restwert: akGeb };
      var vj = verlauf.filter(function (r) { return r.jahr === vz - 1; })[0];
      // Schlüssel nach Marvins Review-Liste R07: 2 bei erstmaliger AfA, Satzänderung, nachträglichen HK
      // oder Abweichung vom Vorjahresbetrag, sonst 1
      var schl = (erstjahr || zugaenge[vz] || e.afaSatzAbweichend || (vj && werbung(vj.afa) !== werbung(jr.afa))) ? 2 : 1;
      afaZeile = zeile('33', 'AfA Gebäude', werbung(jr.afa), 'W',
        (methode === 'degressiv' ? 'degressiv 5% vom Restwert' : 'linear ' + pct(satz) + ' von ' + eur(jr.bmg || akGeb)) + ', ' + jr.monate + ' Monate',
        'Kaufvertrag: (Kaufpreis ' + eur(num(e.kaufpreis)) + (num(e.ruecklageImKaufpreis) ? ' − Rücklage ' + eur(num(e.ruecklageImKaufpreis)) : '') + (inventarImKP ? ' − Inventar ' + eur(inventarImKP) : '') + ' + Nebenkosten ' + eur(nk) + ') × Gebäudeanteil ' + pct(anteil),
        { satz: satz, methode: methode, schluessel: schl });
      afaInfo = { bmg: akGeb, satz: satz, methode: methode, monate: jr.monate, restwertEnde: jr.restwert, verlauf: verlauf, akGebaeude: akGeb };
      if (sonder7b) { sonderVZ = num(jr.sonder); afaInfo.sonder7b = { bmg: sonder7b.bmg, jahresbetrag: sonder7b.betrag, imJahr: sonderVZ, jahrNr: vz - sonder7b.start + 1 }; }
      if (anteil < 0.30 || anteil > 0.90) hinweis('P09', 'gelb', 'Kaufpreisaufteilung prüfen', 'Gebäudeanteil ' + pct(anteil) + ' liegt außerhalb des Korridors 30 bis 90%. Mit der Arbeitshilfe des BMF gegenrechnen.', 'BMF-Arbeitshilfe Kaufpreisaufteilung');
      else hinweis('P09', 'info', 'Kaufpreisaufteilung übernommen', 'Gebäudeanteil ' + pct(anteil) + ' laut ' + (e.quelleAufteilung || 'Kaufvertrag') + '. Eine vertragliche Aufteilung gilt, solange sie die realen Werte nicht grundlegend verfehlt.', '');
      if (erstjahr) hinweis('P06', 'info', 'Kaufjahr zeitanteilig', 'AfA, Miete und Kosten für ' + monate + ' Monate ab Übergang ' + fmtDatum(ueb) + '.', '§ 7 Abs. 1 Satz 4 EStG');
      if (num(e.ruecklageImKaufpreis) > 0) hinweis('P05a', 'info', 'Erhaltungsrücklage im Kaufpreis', eur(num(e.ruecklageImKaufpreis)) + ' mindern die Anschaffungskosten.', '');
    } else {
      hinweis('P04', 'rot', 'Anschaffungsdaten fehlen', 'Kaufpreis oder Übergang fehlen. AfA nicht berechnet.', 'Zeile 7');
    }
    var afaGeb = afaZeile ? afaZeile.betrag : 0;
    if (sonderVZ > 0) {
      var z34 = zeile('34', 'Sonderabschreibung nach § 7b EStG', werbung(sonderVZ), 'W',
        '5% von ' + eur(sonder7b.bmg) + ' (höchstens ' + eur(sonder7b.fenster.bmgQm) + ' je m²), Jahr ' + (vz - sonder7b.start + 1) + ' von 4, nicht zeitanteilig',
        'Bauantrag, Energieausweis, QNG-Zertifikat', { schluessel: 2 });
      afaGeb += z34.betrag;
    }
    zeile('35', 'AfA Gebäude, abzugsfähig', afaGeb, 'S', sonderVZ > 0 ? 'Zeilen 33 und 34' : 'Zeile 33');

    /* ---------- AfA bewegliche Wirtschaftsgüter ---------- */
    var wgSumme = 0, wgVJ = 0, gwgSofort = 0, wgText = [];
    (i.inventar || []).forEach(function (w) {
      var ak = num(w.ak), d = parseDatum(w.anschaffung) || ueb;
      if (!ak || !d) return;
      if (ak <= 800 && !w.imKaufpreis) { if (d.j === vz) gwgSofort += ak; return; }
      var v = wgVerlauf({ ak: ak, anschaffung: (d.j + '-' + d.m + '-' + d.t), nutzungsdauer: w.nutzungsdauer }, vz);
      var jr = v.filter(function (r) { return r.jahr === vz; })[0];
      var vjr = v.filter(function (r) { return r.jahr === vz - 1; })[0];
      if (vjr) wgVJ += vjr.afa;
      if (jr) { wgSumme += jr.afa; wgText.push((w.bezeichnung || 'Inventar') + ' ' + eur(ak) + ', ' + (num(w.nutzungsdauer) || 10) + ' Jahre, Restwert ' + eur(jr.restwert)); }
    });
    var wgNeu = (i.inventar || []).some(function (w) { var d = parseDatum(w.anschaffung) || ueb; return d && d.j === vz; });
    var z42 = zeile('42', 'AfA bewegliche Wirtschaftsgüter', werbung(wgSumme), 'W', wgText.join(' · '), 'Kaufvertrag, Kaufbelege', { schluessel: (wgNeu || werbung(wgVJ) !== werbung(wgSumme)) ? 2 : 1 });
    zeile('45', 'AfA bewegliche Wirtschaftsgüter, abzugsfähig', z42.betrag, 'S', 'Zeile 42');

    /* ---------- Finanzierung ---------- */
    var zinsen = 0, zinsGeschaetzt = false, disagio = 0, zinsText = [];
    if (!(fin.darlehen || []).length && kontoZinsen > 0) { zinsen += kontoZinsen; zinsText.push('Kontoauszug ' + eur(kontoZinsen)); }
    (fin.darlehen || []).forEach(function (dl, k) {
      if (dl.zinsenLautBescheinigung != null) { zinsen += num(dl.zinsenLautBescheinigung); zinsText.push('Bescheinigung ' + eur(num(dl.zinsenLautBescheinigung))); }
      else if (k === 0 && kontoZinsen > 0) { zinsen += kontoZinsen; zinsText.push('Kontoauszug ' + eur(kontoZinsen)); }
      else {
        var mz = dl.monate != null ? num(dl.monate) : monate;
        var basis = num(dl.restschuld0101) || num(dl.betrag);
        var z = basis * num(dl.zins) * mz / 12;
        zinsen += z; zinsGeschaetzt = true;
        zinsText.push('geschätzt ' + eur(basis) + ' × ' + pct(num(dl.zins)) + ' × ' + mz + '/12');
      }
      if (num(dl.disagio) > 0 && (parseDatum(dl.auszahlung) || ueb || {}).j === vz) {
        disagio += num(dl.disagio);
        var q = num(dl.betrag) ? num(dl.disagio) / num(dl.betrag) : 0;
        if (q > 0.05 || num(dl.zinsbindungJahre) < 5) hinweis('P07', 'gelb', 'Disagio prüfen', 'Disagio ' + pct(q) + '. Sofort abziehbar nur, soweit marktüblich (bis 5% bei mindestens 5 Jahren Zinsbindung).', 'BMF 20.10.2003, § 11 Abs. 2 EStG');
      }
    });
    if (zinsGeschaetzt) hinweis('P03', 'gelb', 'Zinsbescheinigung fehlt', 'Schuldzinsen aus dem Darlehensvertrag geschätzt. Bescheinigung anfordern oder Schätzung bewusst übernehmen.', '§ 9 Abs. 1 Nr. 1 EStG');
    var z46 = zeile('46', 'Schuldzinsen (ohne Tilgung)', werbung(zinsen + disagio), 'W', zinsText.join(' · ') + (disagio ? ' · Disagio ' + eur(disagio) : ''), 'Zinsbescheinigung, Darlehensvertrag', { geschaetzt: zinsGeschaetzt });
    zeile('48', 'Schuldzinsen, abzugsfähig', z46.betrag, 'S', 'Zeile 46');
    var gb = num(fin.geldbeschaffungskosten);
    var z49 = zeile('49', 'Geldbeschaffungskosten', werbung(gb), 'W', gb ? 'im Jahr gezahlt' : '', 'Notar- und Grundbuchrechnung Grundschuld, Schätzkosten');
    zeile('51', 'Geldbeschaffungskosten, abzugsfähig', z49.betrag, 'S', 'Zeile 49');

    /* ---------- Erhaltung ---------- */
    var sofort = 0, verteiltGesamt = 0, verteiltVZ = 0;
    erh.forEach(function (r) {
      if (!r.d || r.d.j !== vz) return;
      if (anschaffungsnah && innerhalb.indexOf(r) >= 0) return; // in AfA-BMG umgegliedert
      var jahre = num(r.x.verteilenJahre) || 1;
      if (jahre > 1) {
        if (jahre > 5) hinweis('P13', 'rot', 'Verteilungszeitraum unzulässig', 'Verteilung auf ' + jahre + ' Jahre. Zulässig sind 2 bis 5 Jahre.', '§ 82b EStDV');
        verteiltGesamt += r.brutto; verteiltVZ += r.brutto / jahre;
      } else sofort += r.brutto;
    });
    sofort += num(hg.ruecklageVerwendetFuerErhaltung);
    var z55 = zeile('55', 'Erhaltungsaufwendungen, sofort abziehbar', werbung(sofort), 'W', '', 'Handwerkerrechnungen, Hausgeldabrechnung (Entnahme Rücklage)');
    if (verteiltGesamt) {
      zeile('57', 'Zu verteilende Erhaltungsaufwendungen, Gesamtaufwand', werbung(verteiltGesamt), 'I', '', 'Handwerkerrechnungen');
      zeile('57a', 'davon im Jahr abzuziehen', werbung(verteiltVZ), 'I', '', '');
    }
    var z58 = zeile('58', 'Zu verteilende Erhaltung des Jahres', werbung(verteiltVZ), 'W', '', '');
    var vjMap = { 4: '61', 3: '64', 2: '67', 1: '70' }, vjSum = 0;
    (i.erhaltungVorjahre || []).forEach(function (v) {
      var diff = vz - num(v.jahr), z = vjMap[diff];
      if (!z) return;
      var l = zeile(z, 'Anteil verteilter Erhaltung aus ' + v.jahr, werbung(num(v.betragImJahr)), 'W', '', 'Vorjahreserklärung');
      vjSum += l.betrag;
    });
    if (summeNetto > 0 && grenze15 > 0) {
      if (anschaffungsnah) hinweis('P12', 'rot', '15-%-Grenze überschritten', 'Instandsetzung netto ' + eur(summeNetto) + ' in drei Jahren nach Anschaffung übersteigt 15% der Gebäude-AK (' + eur(grenze15) + '). Als anschaffungsnahe Herstellungskosten in die AfA umgegliedert. Bescheide früherer Jahre prüfen.', '§ 6 Abs. 1 Nr. 1a EStG');
      else if (summeNetto > 0.8 * grenze15) hinweis('P12', 'gelb', '15-%-Grenze fast erreicht', 'Instandsetzung netto ' + eur(summeNetto) + ' von ' + eur(grenze15) + ' möglich bis ' + fmtDatum(fristEnde) + '.', '§ 6 Abs. 1 Nr. 1a EStG');
    }

    /* ---------- Hausgeld und laufende Kosten (Zahlungsprinzip § 11 EStG) ---------- */
    var hgMonate = hg.monate != null ? num(hg.monate) : monate;
    var hgGezahlt = hg.gezahltJahr != null ? num(hg.gezahltJahr) : num(hg.monat) * hgMonate;
    var hgUml = hg.umlagefaehigJahr != null ? num(hg.umlagefaehigJahr) : num(hg.umlagefaehigMonat) * hgMonate;
    var hgRL = hg.ruecklageJahr != null ? num(hg.ruecklageJahr) : num(hg.ruecklageMonat) * hgMonate;
    if (hg._ausKonto && hg.umlagefaehigJahr == null && hg.ruecklageJahr == null) {
      var hgSoll = num(hg.monat) * hgMonate;
      if (num(hg.monat) > 0) { hgUml = r2(hgGezahlt * num(hg.umlagefaehigMonat) / num(hg.monat)); hgRL = r2(hgGezahlt * num(hg.ruecklageMonat) / num(hg.monat)); }
      if (hgSoll > 0 && Math.abs(hgGezahlt - hgSoll) > Math.max(5, hgSoll * 0.02)) hinweis('K08', 'gelb', 'Hausgeld weicht vom Wirtschaftsplan ab', 'Laut Kontoauszug ' + eur(hgGezahlt) + ' gezahlt, laut Wirtschaftsplan ' + eur(hgSoll) + ' für ' + hgMonate + ' Monate. Umlagefähiger Anteil und Rücklage sind anteilig aus der Zahlung gerechnet. Läuft ein Teil über ein anderes Konto?', '§ 11 Abs. 2 EStG');
      if (!(num(hg.monat) > 0)) hinweis('K08', 'gelb', 'Aufteilung des Hausgelds fehlt', 'Ohne Wirtschaftsplan ist das ganze Hausgeld als nicht umlagefähig gerechnet, auch die Rücklage. Bitte Wirtschaftsplan ergänzen.', '');
    }
    var vja = hg.vorjahresabrechnung || {};
    var umlagef = hgUml + num(vja.umlagefaehig) + num((i.kostenDirekt || {}).umlagefaehig);
    var sev = hg.verwaltungJahr != null ? num(hg.verwaltungJahr) : num(hg.verwaltungMonat) * hgMonate;
    var nichtUml = (hgGezahlt - hgUml - hgRL) + num(vja.nichtUmlagefaehig) + sev + num((i.kostenDirekt || {}).nichtUmlagefaehig);
    var z73 = zeile('73', 'Umgelegte Kosten', werbung(umlagef), 'W', 'Hausgeld umlagefähig ' + eur(hgUml) + (num(vja.umlagefaehig) ? ', Vorjahresabrechnung ' + eur(num(vja.umlagefaehig)) : ''), 'Wirtschaftsplan, Hausgeldabrechnung, Kontoauszug');
    zeile('75', 'Umgelegte Kosten, abzugsfähig', z73.betrag, 'S', 'Zeile 73');
    var z76 = zeile('76', 'Nicht umgelegte Kosten', werbung(nichtUml), 'W', 'Hausgeld ' + eur(hgGezahlt) + ' − umlagefähig ' + eur(hgUml) + ' − Rücklage ' + eur(hgRL) + (sev ? ' + Verwaltung ' + eur(sev) : '') + (num(vja.nichtUmlagefaehig) ? ' + Vorjahresabrechnung ' + eur(num(vja.nichtUmlagefaehig)) : ''), 'Wirtschaftsplan, Verwaltervertrag, Kontoauszug');
    zeile('78', 'Nicht umgelegte Kosten, abzugsfähig', z76.betrag, 'S', 'Zeile 76');
    if (hgRL > 0) hinweis('P05', 'info', 'Rücklage herausgerechnet', 'Zuführung zur Erhaltungsrücklage ' + eur(hgRL) + ' ist erst bei Verwendung abziehbar.', '§ 11 Abs. 2 EStG, BFH zur Erhaltungsrücklage');
    if (uml > 0 && umlagef === 0) hinweis('P21', 'gelb', 'Umlagen ohne umgelegte Kosten', 'Der Mieter zahlt Nebenkosten, es sind aber keine umlagefähigen Kosten erfasst. Hausgeldaufteilung prüfen.', '');

    var sonstSumme = gwgSofort + ['steuerberatung', 'fahrtkosten', 'kontofuehrung', 'rechtskosten', 'sonstiges'].reduce(function (s, k) { return s + num(sonst[k]); }, 0);
    var z80 = zeile('80', 'Sonstige Kosten', werbung(sonstSumme), 'W', [gwgSofort ? 'GWG ' + eur(gwgSofort) : '', num(sonst.steuerberatung) ? 'Steuerberatung ' + eur(num(sonst.steuerberatung)) : ''].filter(Boolean).join(' · '), 'Belege');
    zeile('82', 'Sonstige Kosten, abzugsfähig', z80.betrag, 'S', 'Zeile 80');

    var wk = afaGeb + z42.betrag + z46.betrag + z49.betrag + z55.betrag + z58.betrag + vjSum + z73.betrag + z76.betrag + z80.betrag;
    zeile('83', 'Summe der Werbungskosten', wk, 'S', 'Zeilen 35, 45, 48, 51, 55, 60 bis 72, 75, 78, 82');
    var ueberschuss = ein - wk;
    zeile('85', 'Überschuss', ueberschuss, 'S', 'Zeile 32 − Zeile 83');
    var anteilA = pers.anteilA != null ? num(pers.anteilA) : 1;
    var pA = kfm(ueberschuss * anteilA), pB = ueberschuss - pA;
    zeile('86A', 'Zurechnung Person A', pA, 'S', pct(anteilA));
    if (anteilA < 1) zeile('86B', 'Zurechnung Person B', pB, 'S', pct(1 - anteilA));

    if (monate === 0 && vz === kaufjahr) hinweis('P08', 'gelb', 'Keine Mietmonate', 'Im Jahr wurde keine Miete erfasst. Vermietungsabsicht dokumentieren.', '');
    if (kaltJahr === 0 && monate > 0) hinweis('P08b', 'gelb', 'Leerstand', 'Keine Mieteinnahmen trotz ' + monate + ' Besitzmonaten. Vermietungsabsicht und Bemühungen nachweisen.', 'BFH zur Einkünfteerzielungsabsicht');
    if (num(sonst.steuerberatung) > 0) hinweis('P16', 'info', 'Steuerberatungskosten', 'Abziehbar ist nur der Anteil für die Anlage V.', '');

    /* ---------- Freigabe ---------- */
    var quittiert = ((i.kanzlei || {}).quittiert) || [];
    var offen = H.filter(function (h) { return h.ampel === 'rot' && quittiert.indexOf(h.id) < 0; }).map(function (h) { return h.id; });

    var ergebnis = {
      version: VERSION, vz: vz, monate: monate, erstjahr: erstjahr,
      zeilen: L, betrag: function (z) { var l = L.filter(function (x) { return x.zeile === z; })[0]; return l ? l.betrag : 0; },
      summen: { einnahmen: ein, werbungskosten: wk, ueberschuss: ueberschuss, personA: pA, personB: anteilA < 1 ? pB : 0 },
      afa: afaInfo, hinweise: H, sonderfall: sf.length > 0,
      freigabe: { moeglich: offen.length === 0, blockiertDurch: offen }
    };
    if (!i._ohneFreibetrag) ergebnis.freibetrag = schaetzeFreibetrag(eingabe, ergebnis);
    return ergebnis;
  }

  /* ---------- Freibetrag (Lohnsteuer-Ermäßigung) für das Folgejahr ---------- */
  function schaetzeFreibetrag(eingabe, erg) {
    var i = clone(eingabe), e = i.erwerb || {};
    var ueb = parseDatum(e.uebergang);
    var fj = e.fertigJahr || (parseDatum(e.fertigstellung) || {}).j;
    var basisJahr = ueb ? ueb.j : (fj || i.vz);
    var abJahr = hat7b(e) ? basisJahr : basisJahr + 1;
    var jahr = Math.max(num(i.vz) + 1, abJahr);
    var p = i;
    p.vz = jahr; p._ohneFreibetrag = true;
    delete p.konto;
    p.miete = p.miete || {};
    delete p.miete.kaltJahr; delete p.miete.umlagenJahr; p.miete.monate = 12; p.miete.nkAbrechnung = 0; p.miete.fruehereJahre = 0;
    if (p.miete.garageJahr) p.miete.garageJahr = num(p.miete.garageJahr) / Math.max(1, num(erg.monate)) * 12;
    p.hausgeld = p.hausgeld || {}; p.hausgeld.monate = 12; delete p.hausgeld.vorjahresabrechnung;
    ['gezahltJahr', 'umlagefaehigJahr', 'ruecklageJahr', 'verwaltungJahr'].forEach(function (k) {
      if (p.hausgeld[k] != null) { var mk = k.replace('Jahr', 'Monat').replace('gezahltMonat', 'monat'); p.hausgeld[mk] = num(p.hausgeld[k]) / Math.max(1, num(erg.monate)); delete p.hausgeld[k]; }
    });
    delete p.hausgeld.ruecklageVerwendetFuerErhaltung;
    p.finanzierung = p.finanzierung || {}; p.finanzierung.geldbeschaffungskosten = 0;
    (p.finanzierung.darlehen || []).forEach(function (d) { d.zinsenLautBescheinigung = null; d.disagio = 0; d.monate = 12; });
    p.erhaltung = []; p.erhaltungVorjahre = []; p.sonstige = {};
    p.kanzlei = {};
    var r = berechne(p);
    var verlust = Math.max(0, -r.summen.ueberschuss);
    var gs = (i.personen || {}).grenzsteuersatz;
    var wirkung = gs != null ? verlust * num(gs) : null;
    return {
      jahr: jahr, abJahrMoeglich: abJahr,
      geschaetzteEinkuenfte: r.summen.ueberschuss, freibetrag: verlust,
      steuerwirkungJahr: wirkung, steuerwirkungMonat: wirkung != null ? wirkung / 12 : null,
      hinweis: verlust > 0
        ? 'Antrag auf Lohnsteuer-Ermäßigung für ' + jahr + '. Negative Einkünfte aus einem Gebäude wirken erst ab dem Jahr nach Anschaffung oder Fertigstellung' + (hat7b(e) ? ', bei § 7b schon im Anschaffungsjahr' : '') + '. Mit Freibetrag ist jedes Jahr eine Erklärung Pflicht. Schätzung ohne Kirchensteuer und Solidaritätszuschlag.'
        : 'Kein Verlust erwartet, ein Freibetrag kommt nicht in Betracht.',
      rechtsgrundlage: '§ 37 Abs. 3, § 39a Abs. 1 Nr. 5 Buchst. b, § 46 Abs. 2 Nr. 4 EStG'
    };
  }

  return { version: VERSION, berechne: berechne, pruefe7b: pruefe7b, mieteAusVertraegen: function (v, vz, ueb, ende) { return mieteAusVertraegen(v, vz, parseDatum(ueb), parseDatum(ende)); },
    konto: { KAT: KAT, einlesen: kontoEinlesen, csv: parseCsvKonto, camt: parseCamt, betrag: parseBetrag, regel: kontoRegel, zuordnen: kontoZuordnen, jahr: zuordnungsJahr, verdichten: kontoVerdichten, kontext: kontoKontext, monat: monatAusText },
    afaVerlauf: function (p, bis) { var q = clone(p); q.beginn = parseDatum(p.beginn); q.ende = parseDatum(p.ende); return afaVerlauf(q, bis); }, wgVerlauf: wgVerlauf, pruefeDegressiv: pruefeDegressiv, typSatz: typSatz, _intern: { einnahme: einnahme, werbung: werbung, kfm: kfm, monateImJahr: function (b, j, e) { return monateImJahr(parseDatum(b), j, parseDatum(e)); } } };
}));
