/* Vorschau mit Beispieldaten. Aktiv nur mit ?demo=kaeufer|vertrieb|kanzlei in der Adresse.
   Ersetzt die Datenbankverbindung durch einen Speicher im Browser-Tab. Nichts wird an den Server geschickt. */
(function () {
  'use strict';
  var m = /[?&]demo=(kaeufer|vertrieb|kanzlei)\b/.exec(location.search);
  if (!m) return;
  var ROLLE = m[1];
  var KEY = 'op_demo_db_v2';
  var jetzt = function () { return new Date().toISOString(); };
  var tage = function (n) { var d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };
  var nid = function () { return 'd' + Math.random().toString(36).slice(2, 10); };

  var KAUF = { miete: { kaltMonat: 750, umlagenMonat: 160 }, erwerb: { baubeginn: '2024-05-01', kaufpreis: 300000, uebergang: '2026-04-01', afaMethode: 'degressiv', fertigJahr: 2026, kaufvertrag: '2026-02-10', nebenkosten: 21000, gebaeudeanteil: 0.83, ruecklageImKaufpreis: 1500 }, objekt: { adresse: 'Leipzig, Musterstraße 12, WE 7', wohnflaeche: 58 }, inventar: [{ ak: 8000 }], finanzierung: { darlehen: [{ zins: 0.037, betrag: 270000 }], geldbeschaffungskosten: 1150 } };
  function kopie(o) { return JSON.parse(JSON.stringify(o)); }
  function voll(adresse, extra) {
    var e = kopie(KAUF); e.objekt.adresse = adresse; e.objekt.nutzung = 'dauer'; e.objekt.denkmal = false; e.objekt.anAngehoerige = false;
    e.hausgeld = { monat: 290, ruecklageMonat: 35, verwaltungMonat: 30, umlagefaehigMonat: 150 }; e.personen = { grenzsteuersatz: 0.42 };
    return Object.assign(e, extra || {});
  }
  var FC = { art: 'neubau', nutzung: 'dauer', wohnungen: '1', angestellt: 'ja', sonderfall: false };
  var ALLE = { fallcheck: true, wohnung: true, miete: true, finanzierung: true, hausgeld: true, unterlagen: true, person: true };

  function startDaten() {
    var db = {
      organisation: [
        { id: 'k1', name: 'Bauer & Weigl Steuerberater', typ: 'kanzlei', aktiv: true, preis_kaufjahr: 349, preis_folgejahr: 249, anschrift: '' },
        { id: 'k2', name: 'Mack GmbH Steuerberatungsgesellschaft', typ: 'kanzlei', aktiv: true, preis_kaufjahr: 349, preis_folgejahr: 249, anschrift: 'Fulda', kontakt_name: 'Florian Mack', kontakt_titel: 'Steuerberater', kontakt_bild: 'assets/team/florian-mack.jpg' },
        { id: 'v1', name: 'Musterhaus Kapitalanlagen GmbH', typ: 'vertrieb', aktiv: true, anschrift: '' }
      ],
      profil: [
        { id: 'u-kaeufer', email: 'anna.weber@beispiel.de', name: 'Anna Weber', rolle: 'kaeufer', organisation_id: null },
        { id: 'u-vertrieb', email: 'vertrieb@beispiel.de', name: 'Tom Berater', rolle: 'vertrieb', organisation_id: 'v1' },
        { id: 'u-kanzlei', email: 'kanzlei@beispiel.de', name: 'Kanzlei Bauer & Weigl', rolle: 'kanzlei', organisation_id: 'k1' }
      ],
      akte: [], akte_daten: [], dokument: [], nachricht: [], akte_pruefung: [], mandat: [], team_einladung: []
    };
    function akte(id, nr, name, mail, kid, obj, status, kanzlei, daten, tageAlt) {
      db.akte.push({ id: id, nummer: nr, vertrieb_id: 'v1', kaeufer_email: mail, kaeufer_name: name, kaeufer_id: kid, objekt_bezeichnung: obj, vz: 2026, status: status, wahl: kanzlei ? 'kanzlei' : null, kanzlei_id: kanzlei, status_an_vertrieb: true, created_at: tage(-tageAlt), updated_at: tage(-Math.max(0, tageAlt - 3)) });
      db.akte_daten.push(Object.assign({ akte_id: id, vom_vertrieb: kopie(KAUF) }, daten));
      ['kaufvertrag', 'mietvertrag', 'darlehensvertrag'].forEach(function (t) { db.dokument.push({ id: nid(), akte_id: id, typ: t, dateiname: t[0].toUpperCase() + t.slice(1) + '.pdf', pfad: id + '/' + t + '.pdf', groesse: 120000, quelle: 'vertrieb', created_at: tage(-tageAlt) }); });
    }
    // Anna Weber: Kapitalanlegerin, mitten in der Erfassung
    akte('a-anna', 'WN-2041', 'Anna Weber', 'anna.weber@beispiel.de', 'u-kaeufer', 'Leipzig, Musterstraße 12, WE 7', 'in_erfassung', null,
      { eingabe: voll('Leipzig, Musterstraße 12, WE 7', { hausgeld: {}, personen: {} }), stammdaten: {}, fallcheck: kopie(FC), erledigt: { fallcheck: true, wohnung: true, miete: true } }, 6);
    // Für die Kanzlei: zwei Fälle in Prüfung, einer mit Rückfrage, einer freigegeben
    var sd = function (v, n) { return { vorname: v, nachname: n, strasse: 'Beispielweg 3', plz: '80331', ort: 'München', geburtsdatum: '1986-03-14', steuerId: '57302946185', finanzamt: 'München' }; };
    akte('a-markus', 'WN-2038', 'Markus Krüger', 'm.krueger@beispiel.de', 'u-x1', 'Dresden-Neustadt, Alaunstraße 40, WE 3', 'in_pruefung', 'k1', { eingabe: voll('Dresden-Neustadt, Alaunstraße 40, WE 3'), stammdaten: sd('Markus', 'Krüger'), fallcheck: kopie(FC), erledigt: kopie(ALLE) }, 9);
    akte('a-selin', 'WN-2035', 'Selin Yilmaz', 's.yilmaz@beispiel.de', 'u-x2', 'Potsdam-West, Zeppelinstraße 21, WE 21', 'in_pruefung', 'k1', { eingabe: voll('Potsdam-West, Zeppelinstraße 21, WE 21', { erwerb: Object.assign(kopie(KAUF.erwerb), { kaufpreis: 289000, baubeginn: null }) }), stammdaten: sd('Selin', 'Yilmaz'), fallcheck: kopie(FC), erledigt: kopie(ALLE) }, 11);
    akte('a-thomas', 'WN-2031', 'Thomas Hoffmann', 't.hoffmann@beispiel.de', 'u-x3', 'Leipzig-Plagwitz, Karl-Heine-Straße 7, WE 7', 'rueckfrage', 'k1', { eingabe: voll('Leipzig-Plagwitz, Karl-Heine-Straße 7, WE 7'), stammdaten: sd('Thomas', 'Hoffmann'), fallcheck: kopie(FC), erledigt: kopie(ALLE) }, 14);
    db.nachricht.push({ id: nid(), akte_id: 'a-thomas', von_rolle: 'kanzlei', text: 'Gehört der Stellplatz zur Wohnung oder wurde er separat gekauft?', created_at: tage(-2) });
    akte('a-julia', 'WN-2024', 'Julia Brandt', 'j.brandt@beispiel.de', 'u-x4', 'Berlin-Pankow, Florastraße 9, WE 12', 'freigegeben', 'k1', { eingabe: voll('Berlin-Pankow, Florastraße 9, WE 12'), stammdaten: sd('Julia', 'Brandt'), fallcheck: kopie(FC), erledigt: kopie(ALLE) }, 20);
    // Nur beim Vertrieb sichtbar
    akte('a-neu1', 'WN-2043', 'Lena Vogt', 'l.vogt@beispiel.de', null, 'Leipzig-Gohlis, Lindenthaler Straße 2, WE 4', 'eingeladen', null, { eingabe: kopie(KAUF), stammdaten: {}, fallcheck: {}, erledigt: {} }, 1);
    db.mandat.push({ id: nid(), akte_id: 'a-julia', vereinbart_am: tage(-15), verguetung_brutto: 349 });
    return db;
  }
  var DB;
  try { DB = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { DB = null; }
  if (!DB || !DB.akte) DB = startDaten();
  function sichern() { try { sessionStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { } }

  var ICH = DB.profil.filter(function (p) { return p.rolle === ROLLE; })[0];
  var meinOrg = ICH.organisation_id;

  function sichtbar(tab) {
    var rows = DB[tab] || [];
    if (tab !== 'akte') return rows;
    return rows.filter(function (a) {
      if (ROLLE === 'kaeufer') return a.kaeufer_id === ICH.id;
      if (ROLLE === 'kanzlei') return a.kanzlei_id === meinOrg && ['in_pruefung', 'rueckfrage', 'sonderfall', 'freigegeben', 'abgeschlossen'].indexOf(a.status) >= 0;
      return a.vertrieb_id === meinOrg;
    });
  }
  function schmuecken(tab, r) {
    if (tab !== 'akte') return r;
    var p = DB.akte_pruefung.filter(function (x) { return x.akte_id === r.id; })[0] || null;
    return Object.assign({}, r, { akte_pruefung: p });
  }
  function antwort(d) { return Promise.resolve({ data: d, error: null }); }
  function Q(tab) {
    var f = [], einzel = false, op = 'select', last = null;
    var o = {
      select: function () { return o; }, order: function () { return o; }, limit: function () { return o; }, in: function () { return o; },
      eq: function (c, v) { f.push([c, v, true]); return o; }, neq: function (c, v) { f.push([c, v, false]); return o; },
      maybeSingle: function () { einzel = true; return o; }, single: function () { einzel = true; return o; },
      update: function (p) { op = 'update'; last = p; return o; }, insert: function (p) { op = 'insert'; last = p; return o; },
      upsert: function (p) { op = 'insert'; last = p; return o; }, delete: function () { op = 'delete'; return o; },
      then: function (a, b) { return antwort(lauf()).then(function (d) { return d; }).then(a, b); }
    };
    function passt(r) { return f.every(function (x) { return (String(r[x[0]]) === String(x[1])) === x[2]; }); }
    function lauf() {
      DB[tab] = DB[tab] || [];
      if (op === 'insert') { [].concat(last).forEach(function (p) { DB[tab].push(Object.assign({ id: nid(), created_at: jetzt() }, p, tab === 'dokument' ? { hochgeladen_von: ICH.id } : {})); }); sichern(); return null; }
      if (op === 'update') { DB[tab].filter(passt).forEach(function (r) { Object.assign(r, kopie(last)); }); sichern(); return null; }
      if (op === 'delete') { DB[tab] = DB[tab].filter(function (r) { return !passt(r); }); sichern(); return null; }
      var d = sichtbar(tab).filter(passt).map(function (r) { return schmuecken(tab, r); });
      return einzel ? (d[0] || null) : d;
    }
    return o;
  }
  function akteVon(id) { return DB.akte.filter(function (a) { return a.id === id; })[0]; }
  function datenVon(id) { return DB.akte_daten.filter(function (a) { return a.akte_id === id; })[0]; }
  var nr = 2050;
  function neueAkte(name, mail, kid, obj, vz, status, ein, vomVertrieb) {
    var id = nid();
    DB.akte.push({ id: id, nummer: 'WN-' + (nr++), vertrieb_id: vomVertrieb ? meinOrg : null, kaeufer_email: mail, kaeufer_name: name, kaeufer_id: kid, objekt_bezeichnung: obj, vz: vz, status: status, wahl: null, kanzlei_id: null, status_an_vertrieb: false, created_at: jetzt(), updated_at: jetzt() });
    DB.akte_daten.push({ akte_id: id, eingabe: ein || {}, vom_vertrieb: vomVertrieb ? kopie(ein || {}) : {}, stammdaten: {}, fallcheck: {}, erledigt: {} });
    return id;
  }
  var RPC = {
    kaeufer_verknuepfen: function () { return 0; },
    kaeufer_oeffnen: function (p) { var a = akteVon(p.p_akte); if (a && a.status === 'eingeladen') a.status = 'in_erfassung'; },
    kaeufer_akte_anlegen: function (p) { return neueAkte(ICH.name, ICH.email, ICH.id, p.p_objekt, p.p_vz, 'in_erfassung', { objekt: { adresse: p.p_objekt } }, false); },
    kaeufer_beauftragen: function (p) {
      var a = akteVon(p.p_akte), d = datenVon(p.p_akte), sf = d && d.fallcheck && d.fallcheck.sonderfall;
      a.status = p.p_wahl === 'eigen' ? 'eigener_stb' : sf ? 'sonderfall' : 'in_pruefung'; a.kanzlei_id = p.p_kanzlei; a.wahl = p.p_wahl; a.status_an_vertrieb = p.p_status_an_vertrieb; a.updated_at = jetzt();
      if (p.p_kanzlei && !sf) DB.mandat.push({ id: nid(), akte_id: a.id, vereinbart_am: jetzt(), verguetung_brutto: 349 });
      return a.status;
    },
    kaeufer_antworten: function (p) { DB.nachricht.push({ id: nid(), akte_id: p.p_akte, von_rolle: 'kaeufer', text: p.p_text, created_at: jetzt() }); akteVon(p.p_akte).status = 'in_pruefung'; },
    kaeufer_abschliessen: function (p) { akteVon(p.p_akte).status = 'abgeschlossen'; },
    vertrieb_akten: function () {
      return sichtbar('akte').map(function (a) {
        var st = a.status === 'eingeladen' ? 'eingeladen' : ['freigegeben', 'abgeschlossen', 'eigener_stb'].indexOf(a.status) >= 0 ? 'erledigt' : ['in_pruefung', 'rueckfrage', 'sonderfall'].indexOf(a.status) >= 0 && a.status_an_vertrieb ? 'aktiv' : 'angenommen';
        return { id: a.id, nummer: a.nummer, kaeufer_name: a.kaeufer_name, kaeufer_email: a.kaeufer_email, objekt_bezeichnung: a.objekt_bezeichnung, vz: a.vz, status: st, dokumente: DB.dokument.filter(function (d) { return d.akte_id === a.id && d.quelle === 'vertrieb'; }).length };
      }).reverse();
    },
    uebergabe_anlegen: function (p) { return neueAkte(p.p_name, p.p_email, null, p.p_objekt, p.p_vz, 'eingeladen', p.p_eingabe, true); },
    kanzlei_pruefzeit: function (p) { var x = pruefung(p.p_akte); x.pruefzeit_sek = (x.pruefzeit_sek || 0) + p.p_sek; },
    kanzlei_quittieren: function (p) { pruefung(p.p_akte).quittiert = p.p_quittiert; },
    kanzlei_rueckfrage: function (p) { DB.nachricht.push({ id: nid(), akte_id: p.p_akte, von_rolle: 'kanzlei', text: p.p_text, created_at: jetzt() }); var a = akteVon(p.p_akte); if (a.status !== 'sonderfall') a.status = 'rueckfrage'; },
    kanzlei_freigeben: function (p) { var x = pruefung(p.p_akte); x.ergebnis = p.p_ergebnis; x.kern_version = p.p_kern_version; x.quittiert = p.p_quittiert; x.freigabe_am = jetzt(); x.pruefzeit_sek = x.pruefzeit_sek || 420; akteVon(p.p_akte).status = 'freigegeben'; },
    admin_uebersicht: function () { return []; }
  };
  function pruefung(id) { var x = DB.akte_pruefung.filter(function (r) { return r.akte_id === id; })[0]; if (!x) { x = { akte_id: id, quittiert: [], pruefzeit_sek: 0 }; DB.akte_pruefung.push(x); } return x; }

  var BEISPIEL = URL.createObjectURL(new Blob(['<!doctype html><meta charset="utf-8"><title>Beispielunterlage</title><body style="font:16px system-ui;padding:40px;max-width:640px"><h1>Beispielunterlage</h1><p>In der Vorschau gibt es keine echten Dateien. Im echten Betrieb öffnet sich hier das hochgeladene PDF.</p></body>'], { type: 'text/html' }));
  var client = {
    auth: {
      getSession: function () { return antwort({ session: { user: { id: ICH.id, email: ICH.email } } }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () { } } } }; },
      signOut: function () { location.href = location.pathname; return antwort(null); },
      mfa: { getAuthenticatorAssuranceLevel: function () { return antwort({ currentLevel: 'aal2', nextLevel: 'aal2' }); } }
    },
    from: Q,
    rpc: function (n, p) { try { var r = RPC[n] ? RPC[n](p || {}) : null; sichern(); return antwort(r === undefined ? null : r); } catch (e) { return Promise.resolve({ data: null, error: e }); } },
    storage: { from: function () { return {
      upload: function () { return antwort({}); }, remove: function () { return antwort({}); },
      createSignedUrl: function () { return antwort({ signedUrl: BEISPIEL }); }
    }; } }
  };
  window.supabase = { createClient: function () { return client; } };

  // Hinweisleiste oben
  var NAMEN = { kaeufer: 'Kapitalanleger', vertrieb: 'Vertrieb', kanzlei: 'Kanzlei' };
  function leiste() {
    var d = document.createElement('div'); d.className = 'demo-leiste'; d.setAttribute('role', 'note');
    d.innerHTML = '<b>Vorschau mit Beispieldaten</b><span class="demo-weg">Nichts wird gespeichert oder verschickt.</span><span class="demo-rollen">' +
      ['kaeufer', 'vertrieb', 'kanzlei'].map(function (r) { return '<a href="?demo=' + r + '#/"' + (r === ROLLE ? ' aria-current="true"' : '') + '>' + NAMEN[r] + '</a>'; }).join('') + '</span>' +
      '<button type="button" id="demoReset">Zurücksetzen</button><a href="' + location.pathname + '#/admin">Beenden</a>';
    document.body.insertBefore(d, document.body.firstChild);
    document.getElementById('demoReset').onclick = function () { try { sessionStorage.removeItem(KEY); } catch (e) { } location.reload(); };
  }
  if (document.body) leiste(); else document.addEventListener('DOMContentLoaded', leiste);
})();
