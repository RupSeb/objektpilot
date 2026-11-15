/*!
 * AnlageVKern: Rechenkern Anlage V (Standardfall Kapitalanlage-Wohnung)
 * Objektpilot · Canis Lupus Sebru Ltd. (Marke Stratvell)
 *
 * Grundlage: Marvin Bauers Excel „Anlage V 2025 – Test- und Programmierbasis“ (Blätter AfA,
 * Anlage V, Prüfungen, Testprotokoll), EStG, EStDV, EStR und BMF-Schreiben. Eigenständig
 * entwickelt, ohne Verwendung fremder Software oder Skills.
 *
 * Scope Phase 1: eine Wohnung (oder mehrere gleichartige) dauerhaft zu Wohnzwecken an Fremde
 * vermietet. Ferienwohnung, kurzfristige Vermietung, Angehörige, Teil-Eigennutzung,
 * Gewerbe, USt-Option, Denkmal/Sanierungsgebiet, § 7b, Herstellung, Gemeinschaften und
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

  var VERSION = '0.1.0';

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
  function pct(x) { return (Math.round(x * 10000) / 100).toLocaleString('de-DE') + ' %'; }
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
  function afaVerlauf(p, bisJahr) {
    var rows = [], bmg = p.bmg, rest = p.bmg, beginn = p.beginn;
    for (var j = beginn.j; j <= bisJahr; j++) {
      var zugang = num((p.zugaenge || {})[j]);
      if (zugang) { bmg += zugang; rest += zugang; }
      var m = monateImJahr(beginn, j, p.ende);
      var basis = p.methode === 'degressiv' ? rest : bmg;
      var a = Math.min(rest, basis * p.satz * m / 12);
      if (rest - a < 0.005) a = rest;
      rest -= a;
      rows.push({ jahr: j, monate: m, bmg: bmg, afa: a, restwert: rest });
      if (rest <= 0.005) { rest = 0; if (j < bisJahr) { for (var k = j + 1; k <= bisJahr; k++) rows.push({ jahr: k, monate: 0, bmg: bmg, afa: 0, restwert: 0 }); } break; }
    }
    return rows;
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
    if (e.sonderAfA7b) s.push('Sonderabschreibung § 7b EStG');
    if (e.veraeussertUebergang) s.push('Veräußerung im Jahr');
    var ort = num((i.miete || {}).ortsueblicheMieteMonat), kalt = num((i.miete || {}).kaltMonat);
    if (ort > 0 && kalt > 0 && kalt < 0.66 * ort) s.push('verbilligte Vermietung unter 66 % der ortsüblichen Miete');
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

    /* ---------- Einnahmen ---------- */
    var kaltJahr = miete.kaltJahr != null ? num(miete.kaltJahr) : num(miete.kaltMonat) * monate;
    var z13 = zeile('13', 'Mieteinnahmen Wohnung', einnahme(kaltJahr), 'E',
      miete.kaltJahr != null ? 'Jahressumme laut Eingabe' : monate + ' Monate × ' + eur(num(miete.kaltMonat)), miete.quelle || 'Mietvertrag, Kontoauszug');
    zeile('15', 'Summe Mieteinnahmen Wohnungen', z13.betrag, 'S', 'Zeile 13');
    var uml = miete.umlagenJahr != null ? num(miete.umlagenJahr) : num(miete.umlagenMonat) * monate;
    var z20 = zeile('20', 'Umlagen, laufende Neben- und Betriebskosten', einnahme(uml), 'E',
      miete.umlagenJahr != null ? 'Jahressumme laut Eingabe' : monate + ' Monate × ' + eur(num(miete.umlagenMonat)), 'Mietvertrag, Kontoauszug');
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
    var akGeb = 0, afaZeile = null, afaInfo = {};
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
      if (!satz) { satz = 0.02; hinweis('P10', 'rot', 'AfA-Satz nicht ermittelbar', 'Jahr der Fertigstellung fehlt. Vorläufig 2 % gerechnet.', '§ 7 Abs. 4 EStG'); }
      if (e.afaSatzAbweichend && methode === 'linear') hinweis('P10b', 'gelb', 'Abweichender AfA-Satz', 'Satz ' + pct(satz) + ' wegen kürzerer Nutzungsdauer. Gutachten zur Restnutzungsdauer prüfen.', '§ 7 Abs. 4 Satz 2 EStG');
      var verlauf = afaVerlauf({ bmg: akGeb, satz: satz, methode: methode, beginn: ueb, ende: ende, zugaenge: zugaenge }, vz);
      var jr = verlauf.filter(function (r) { return r.jahr === vz; })[0] || { afa: 0, monate: 0, restwert: akGeb };
      var vj = verlauf.filter(function (r) { return r.jahr === vz - 1; })[0];
      // Schlüssel nach Marvins Review-Liste R07: 2 bei erstmaliger AfA, Satzänderung, nachträglichen HK
      // oder Abweichung vom Vorjahresbetrag, sonst 1
      var schl = (erstjahr || zugaenge[vz] || e.afaSatzAbweichend || (vj && werbung(vj.afa) !== werbung(jr.afa))) ? 2 : 1;
      afaZeile = zeile('33', 'AfA Gebäude', werbung(jr.afa), 'W',
        (methode === 'degressiv' ? 'degressiv 5 % vom Restwert' : 'linear ' + pct(satz) + ' von ' + eur(jr.bmg || akGeb)) + ', ' + jr.monate + ' Monate',
        'Kaufvertrag: (Kaufpreis ' + eur(num(e.kaufpreis)) + (num(e.ruecklageImKaufpreis) ? ' − Rücklage ' + eur(num(e.ruecklageImKaufpreis)) : '') + (inventarImKP ? ' − Inventar ' + eur(inventarImKP) : '') + ' + Nebenkosten ' + eur(nk) + ') × Gebäudeanteil ' + pct(anteil),
        { satz: satz, methode: methode, schluessel: schl });
      afaInfo = { bmg: akGeb, satz: satz, methode: methode, monate: jr.monate, restwertEnde: jr.restwert, verlauf: verlauf, akGebaeude: akGeb };
      if (anteil < 0.30 || anteil > 0.90) hinweis('P09', 'gelb', 'Kaufpreisaufteilung prüfen', 'Gebäudeanteil ' + pct(anteil) + ' liegt außerhalb des Korridors 30 bis 90 %. Mit der Arbeitshilfe des BMF gegenrechnen.', 'BMF-Arbeitshilfe Kaufpreisaufteilung');
      else hinweis('P09', 'info', 'Kaufpreisaufteilung übernommen', 'Gebäudeanteil ' + pct(anteil) + ' laut ' + (e.quelleAufteilung || 'Kaufvertrag') + '. Eine vertragliche Aufteilung gilt, solange sie die realen Werte nicht grundlegend verfehlt.', '');
      if (erstjahr) hinweis('P06', 'info', 'Kaufjahr zeitanteilig', 'AfA, Miete und Kosten für ' + monate + ' Monate ab Übergang ' + fmtDatum(ueb) + '.', '§ 7 Abs. 1 Satz 4 EStG');
      if (num(e.ruecklageImKaufpreis) > 0) hinweis('P05a', 'info', 'Erhaltungsrücklage im Kaufpreis', eur(num(e.ruecklageImKaufpreis)) + ' mindern die Anschaffungskosten.', '');
    } else {
      hinweis('P04', 'rot', 'Anschaffungsdaten fehlen', 'Kaufpreis oder Übergang fehlen. AfA nicht berechnet.', 'Zeile 7');
    }
    var afaGeb = afaZeile ? afaZeile.betrag : 0;
    zeile('35', 'AfA Gebäude, abzugsfähig', afaGeb, 'S', 'Zeile 33');

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
    (fin.darlehen || []).forEach(function (dl) {
      if (dl.zinsenLautBescheinigung != null) { zinsen += num(dl.zinsenLautBescheinigung); zinsText.push('Bescheinigung ' + eur(num(dl.zinsenLautBescheinigung))); }
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
        if (q > 0.05 || num(dl.zinsbindungJahre) < 5) hinweis('P07', 'gelb', 'Disagio prüfen', 'Disagio ' + pct(q) + '. Sofort abziehbar nur, soweit marktüblich (bis 5 % bei mindestens 5 Jahren Zinsbindung).', 'BMF 20.10.2003, § 11 Abs. 2 EStG');
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
      if (anschaffungsnah) hinweis('P12', 'rot', '15-%-Grenze überschritten', 'Instandsetzung netto ' + eur(summeNetto) + ' in drei Jahren nach Anschaffung übersteigt 15 % der Gebäude-AK (' + eur(grenze15) + '). Als anschaffungsnahe Herstellungskosten in die AfA umgegliedert. Bescheide früherer Jahre prüfen.', '§ 6 Abs. 1 Nr. 1a EStG');
      else if (summeNetto > 0.8 * grenze15) hinweis('P12', 'gelb', '15-%-Grenze fast erreicht', 'Instandsetzung netto ' + eur(summeNetto) + ' von ' + eur(grenze15) + ' möglich bis ' + fmtDatum(fristEnde) + '.', '§ 6 Abs. 1 Nr. 1a EStG');
    }

    /* ---------- Hausgeld und laufende Kosten (Zahlungsprinzip § 11 EStG) ---------- */
    var hgMonate = hg.monate != null ? num(hg.monate) : monate;
    var hgGezahlt = hg.gezahltJahr != null ? num(hg.gezahltJahr) : num(hg.monat) * hgMonate;
    var hgUml = hg.umlagefaehigJahr != null ? num(hg.umlagefaehigJahr) : num(hg.umlagefaehigMonat) * hgMonate;
    var hgRL = hg.ruecklageJahr != null ? num(hg.ruecklageJahr) : num(hg.ruecklageMonat) * hgMonate;
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
    var abJahr = e.sonderAfA7b ? basisJahr : basisJahr + 1;
    var jahr = Math.max(num(i.vz) + 1, abJahr);
    var p = i;
    p.vz = jahr; p._ohneFreibetrag = true;
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
        ? 'Antrag auf Lohnsteuer-Ermäßigung für ' + jahr + '. Negative Einkünfte aus einem Gebäude wirken erst ab dem Jahr nach Anschaffung oder Fertigstellung' + (e.sonderAfA7b ? ', bei § 7b schon im Anschaffungsjahr' : '') + '. Mit Freibetrag ist jedes Jahr eine Erklärung Pflicht. Schätzung ohne Kirchensteuer und Solidaritätszuschlag.'
        : 'Kein Verlust erwartet, ein Freibetrag kommt nicht in Betracht.',
      rechtsgrundlage: '§ 37 Abs. 3, § 39a Abs. 1 Nr. 5 Buchst. b, § 46 Abs. 2 Nr. 4 EStG'
    };
  }

  return { version: VERSION, berechne: berechne, afaVerlauf: function (p, bis) { var q = clone(p); q.beginn = parseDatum(p.beginn); q.ende = parseDatum(p.ende); return afaVerlauf(q, bis); }, wgVerlauf: wgVerlauf, pruefeDegressiv: pruefeDegressiv, typSatz: typSatz, _intern: { einnahme: einnahme, werbung: werbung, kfm: kfm, monateImJahr: function (b, j, e) { return monateImJahr(parseDatum(b), j, parseDatum(e)); } } };
}));
