/* Objektpilot · App. Ohne Build-Schritt, läuft als statische Seite. Daten in Supabase (Frankfurt), Zugriff über RLS. */
(function () {
  'use strict';
  var C = window.OP_CONFIG;
  var sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
  var Kern = window.AnlageVKern;
  var S = { session: null, profil: null, orgs: [], timer: null, pruefStart: null, pruefAkte: null };

  /* ---------- Hilfen ---------- */
  var main = document.getElementById('inhalt');
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
  function eur(v) { return v == null || v === '' || isNaN(v) ? '' : nf0.format(Math.round(v)) + ' €'; }
  function eur2(v) { return v == null || isNaN(v) ? '' : new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' €'; }
  function parseNum(s) {
    if (s == null) return null; s = String(s).trim().replace(/[€%\s]/g, '');
    if (!s) return null;
    if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    var n = Number(s); return isFinite(n) ? n : NaN;
  }
  function dDE(s) { if (!s) return ''; var d = String(s).slice(0, 10).split('-'); return d.length === 3 ? d[2] + '.' + d[1] + '.' + d[0] : s; }
  function zeit(s) { var d = new Date(s); return d.toLocaleDateString('de-DE') + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
  function mmss(s) { s = Math.round(s || 0); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function get(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function set(o, p, v) {
    var ks = p.split('.'), cur = o;
    for (var i = 0; i < ks.length - 1; i++) {
      var k = ks[i], nk = ks[i + 1];
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = /^\d+$/.test(nk) ? [] : {};
      cur = cur[k];
    }
    if (v === null || v === undefined || v === '') delete cur[ks[ks.length - 1]]; else cur[ks[ks.length - 1]] = v;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
  function toast(t, bad) { var el = $('#toast'); el.textContent = t; el.className = 'toast' + (bad ? ' bad' : ''); el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 3200); }
  function fehler(e) { console.error(e); var m = (e && (e.message || e.error_description)) || 'Unbekannter Fehler'; toast(menschlich(m), true); }
  function menschlich(m) {
    if (/rate limit|too many/i.test(m)) return 'Zu viele Versuche in kurzer Zeit. Bitte warten Sie eine Minute.';
    if (/expired|invalid/i.test(m) && /otp|token|code/i.test(m)) return 'Der Code ist abgelaufen oder falsch. Fordern Sie einfach einen neuen an.';
    if (/Keine Berechtigung/.test(m)) return 'Dafür fehlt Ihnen die Berechtigung.';
    if (/fetch|network/i.test(m)) return 'Keine Verbindung. Prüfen Sie Ihr Internet und versuchen Sie es erneut.';
    if (/sending.*email|smtp|mail/i.test(m)) return 'Die E-Mail mit Ihrem Code konnte gerade nicht verschickt werden. Bitte versuchen Sie es in ein paar Minuten erneut oder schreiben Sie an ' + ((window.OP_CONFIG && OP_CONFIG.kontakt) || 'uns') + '.';
    if (/\b(error|failed|unable|invalid|not|unexpected)\b/i.test(m)) return 'Da ist etwas schiefgegangen. Bitte versuchen Sie es erneut.';
    return m;
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; }
  function mount(html, titel) {
    main.innerHTML = html;
    if (titel) document.title = titel + ' · Objektpilot';
    var h = main.querySelector('h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }
  function laden() { main.innerHTML = '<div class="wrap narrow"><div class="stack" aria-busy="true"><div class="skel" style="width:35%"></div><div class="skel" style="height:40px;width:70%"></div><div class="skel"></div><div class="skel"></div><div class="skel" style="width:60%"></div></div></div>'; }
  function q(r) { if (r.error) throw r.error; return r.data; }
  function steuerIdOk(s) {
    s = String(s || '').replace(/\s/g, '');
    if (!/^[1-9]\d{10}$/.test(s)) return false;
    var p = 10;
    for (var i = 0; i < 10; i++) { var sum = (Number(s[i]) + p) % 10; if (sum === 0) sum = 10; p = (sum * 2) % 11; }
    var c = 11 - p; if (c === 10) c = 0;
    return c === Number(s[10]);
  }

  /* ---------- Felder ---------- */
  var DOKTYPEN = [
    { k: 'kaufvertrag', t: 'Notarieller Kaufvertrag', req: 1 },
    { k: 'kaufpreisaufteilung', t: 'Kaufpreisaufteilung', req: 0 },
    { k: 'mietvertrag', t: 'Mietvertrag', req: 1 },
    { k: 'darlehensvertrag', t: 'Darlehensvertrag', req: 1 },
    { k: 'notar_grundschuld', t: 'Notarrechnung zur Grundschuld', req: 0 },
    { k: 'wirtschaftsplan', t: 'Wirtschaftsplan oder Hausgeldabrechnung', req: 1 },
    { k: 'zinsbescheinigung', t: 'Jahreszinsbescheinigung der Bank', req: 0 },
    { k: 'sonstiges', t: 'Weitere Unterlage', req: 0 }
  ];
  var F = {
    wohnung: [
      { p: 'eingabe.objekt.adresse', l: 'Anschrift der Wohnung', t: 'text', req: 1, ac: 'off', h: 'Straße, Hausnummer, Ort und Nummer der Wohnung, zum Beispiel „WE 7“.' },
      { p: 'eingabe.objekt.wohnflaeche', l: 'Wohnfläche', t: 'num', suf: 'm²' },
      { p: 'eingabe.erwerb.kaufvertrag', l: 'Datum des Kaufvertrags', t: 'date', req: 1, h: 'Das Datum der notariellen Beurkundung, ganz oben im Kaufvertrag.' },
      { p: 'eingabe.erwerb.uebergang', l: 'Übergang von Nutzen und Lasten', t: 'date', req: 1, h: 'Steht im Kaufvertrag, oft unter „Besitzübergang“. Ab diesem Tag zählen Miete und Abschreibung.' },
      { p: 'eingabe.erwerb.fertigJahr', l: 'Baujahr oder Jahr der Fertigstellung', t: 'year', req: 1 },
      { p: 'eingabe.erwerb.baubeginn', l: 'Baubeginn', t: 'date', h: 'Nur bei Neubauten nötig. Steht im Bauträgervertrag oder in der Baugenehmigung. Davon hängt die degressive Abschreibung ab.' },
      { p: 'eingabe.erwerb.kaufpreis', l: 'Kaufpreis', t: 'eur', req: 1 },
      { p: 'eingabe.erwerb.gebaeudeanteil', l: 'Anteil des Gebäudes am Kaufpreis', t: 'pct', req: 1, h: 'Laut Kaufvertrag oder Kaufpreisaufteilung. Nur das Gebäude wird abgeschrieben, Grund und Boden nicht.' },
      { p: 'eingabe.erwerb.nebenkosten', l: 'Kaufnebenkosten', t: 'eur', req: 1, h: 'Grunderwerbsteuer, Notar und Grundbuch für den Kauf, Makler. Kosten für die Grundschuld gehören zur Finanzierung.' },
      { p: 'eingabe.erwerb.ruecklageImKaufpreis', l: 'Anteil Erhaltungsrücklage im Kaufpreis', t: 'eur', h: 'Steht manchmal im Kaufvertrag. Wenn nicht erwähnt, leer lassen.' },
      { p: 'eingabe.inventar.0.ak', l: 'Einbauküche oder Möbel im Kaufpreis', t: 'eur', h: 'Nur wenn im Kaufvertrag ein eigener Betrag genannt ist.' },
      { p: 'eingabe.erwerb.afaMethode', l: 'Abschreibung', t: 'select', req: 1, opts: [['linear', 'Linear'], ['degressiv', 'Degressiv 5 % (Neubau)']], h: 'Bei Neubauten mit Baubeginn ab Oktober 2023 ist oft die degressive Abschreibung möglich. Die Kanzlei prüft das.' }
    ],
    miete: [
      { p: 'eingabe.miete.kaltMonat', l: 'Kaltmiete pro Monat', t: 'eur', req: 1, h: 'Laut Mietvertrag, ohne Nebenkosten.' },
      { p: 'eingabe.miete.umlagenMonat', l: 'Nebenkosten-Vorauszahlung des Mieters pro Monat', t: 'eur', req: 1, h: 'Der Betrag, den der Mieter zusätzlich für Betriebskosten zahlt.' },
      { p: 'eingabe.miete.nkAbrechnung', l: 'Nachzahlung des Mieters aus der Nebenkostenabrechnung', t: 'eur', h: 'Nur wenn im Jahr eine Abrechnung gezahlt wurde. Eine Erstattung an den Mieter mit Minus eintragen.' }
    ],
    finanzierung: [
      { p: 'eingabe.finanzierung.darlehen.0.betrag', l: 'Darlehensbetrag', t: 'eur', req: 1 },
      { p: 'eingabe.finanzierung.darlehen.0.zins', l: 'Sollzins', t: 'pct', req: 1, h: 'Der gebundene Sollzins laut Darlehensvertrag, nicht der Effektivzins.' },
      { p: 'eingabe.finanzierung.darlehen.0.zinsenLautBescheinigung', l: 'Gezahlte Zinsen laut Jahreszinsbescheinigung', t: 'eur', h: 'Kommt von der Bank meist im Januar. Ohne Angabe schätzen wir die Zinsen aus dem Sollzins.' },
      { p: 'eingabe.finanzierung.darlehen.0.disagio', l: 'Disagio', t: 'eur', h: 'Nur wenn bei der Auszahlung ein Abschlag einbehalten wurde.' },
      { p: 'eingabe.finanzierung.geldbeschaffungskosten', l: 'Kosten für die Grundschuld', t: 'eur', h: 'Notar und Grundbuch für die Eintragung der Grundschuld, Schätz- und Bereitstellungsgebühren.' }
    ],
    hausgeld: [
      { p: 'eingabe.hausgeld.monat', l: 'Hausgeld pro Monat', t: 'eur', req: 1, h: 'Der Betrag, den Sie monatlich an die Hausverwaltung zahlen. Steht im Wirtschaftsplan.' },
      { p: 'eingabe.hausgeld.umlagefaehigMonat', l: 'Davon umlagefähig', t: 'eur', req: 1, h: 'Der Teil, den Sie auf den Mieter umlegen dürfen. Im Wirtschaftsplan meist getrennt ausgewiesen.' },
      { p: 'eingabe.hausgeld.ruecklageMonat', l: 'Davon Zuführung zur Erhaltungsrücklage', t: 'eur', req: 1, h: 'Dieser Teil ist erst abziehbar, wenn die Rücklage für Reparaturen ausgegeben wird. Wir rechnen ihn heraus.' },
      { p: 'eingabe.hausgeld.verwaltungMonat', l: 'Sondereigentumsverwaltung pro Monat', t: 'eur', h: 'Nur wenn eine Mietverwaltung für Ihre Wohnung extra berechnet wird.' }
    ],
    person: [
      { p: 'stammdaten.vorname', l: 'Vorname', t: 'text', req: 1, ac: 'given-name' },
      { p: 'stammdaten.nachname', l: 'Nachname', t: 'text', req: 1, ac: 'family-name' },
      { p: 'stammdaten.geburtsdatum', l: 'Geburtsdatum', t: 'date', req: 1, ac: 'bday' },
      { p: 'stammdaten.strasse', l: 'Straße und Hausnummer', t: 'text', req: 1, ac: 'address-line1' },
      { p: 'stammdaten.plz', l: 'Postleitzahl', t: 'plz', req: 1, ac: 'postal-code' },
      { p: 'stammdaten.ort', l: 'Ort', t: 'text', req: 1, ac: 'address-level2' },
      { p: 'stammdaten.steuerId', l: 'Steuerliche Identifikationsnummer', t: 'steuerid', req: 1, h: 'Elf Ziffern. Steht auf Ihrer Lohnabrechnung oder dem letzten Steuerbescheid.' },
      { p: 'stammdaten.finanzamt', l: 'Zuständiges Finanzamt', t: 'text', h: 'Das Finanzamt Ihres Wohnorts. Wenn Sie es nicht wissen, leer lassen.' },
      { p: 'stammdaten.steuernummer', l: 'Steuernummer', t: 'text', h: 'Nur wenn Sie schon eine haben, zum Beispiel aus einem Steuerbescheid.' },
      { p: 'eingabe.personen.grenzsteuersatz', l: 'Ihr Grenzsteuersatz', t: 'pct', h: 'Nur für die Schätzung Ihrer monatlichen Ersparnis. Bei rund 60.000 € Jahresbrutto sind es meist um 40 %. Leer lassen geht auch.' }
    ]
  };
  var IC = {
    fallcheck: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>',
    wohnung: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    miete: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M17 6l3 3"/><path d="M15 8l2 2"/>',
    finanzierung: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 21h18"/>',
    hausgeld: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>',
    unterlagen: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 17v-6M9.5 13.5L12 11l2.5 2.5"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    auftrag: '<path d="M12 3l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 21l-2.6-1.9-3.2.1-1-3L2.6 14.3l1-3-1-3 2.6-1.9 1-3 3.2.1z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>'
  };
  function ico(k, cls) { return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (IC[k] || '') + '</svg>'; }
  var ABS = [
    { k: 'fallcheck', t: 'Passt Ihr Fall?', s: 'Vier kurze Fragen, eine Minute' },
    { k: 'wohnung', t: 'Wohnung und Kauf', s: 'Kaufpreis, Übergabe, Gebäudeanteil' },
    { k: 'miete', t: 'Mieteinnahmen', s: 'Kaltmiete und Nebenkosten' },
    { k: 'finanzierung', t: 'Finanzierung', s: 'Darlehen und Zinsen' },
    { k: 'hausgeld', t: 'Hausgeld', s: 'Aus dem Wirtschaftsplan der Verwaltung' },
    { k: 'unterlagen', t: 'Unterlagen', s: 'Fotos oder PDFs hochladen' },
    { k: 'person', t: 'Ihre Angaben', s: 'Name, Anschrift, Steuer-ID' },
    { k: 'auftrag', t: 'Prüfen und beauftragen', s: 'Kanzlei wählen und abschicken' }
  ];

  function anzeige(f, v) {
    if (v == null || v === '') return '';
    if (f.t === 'eur') return nf2.format(v);
    if (f.t === 'pct') return nf2.format(Math.round(v * 10000) / 100);
    if (f.t === 'num') return nf2.format(v);
    return String(v);
  }
  function wert(f, raw) {
    raw = String(raw == null ? '' : raw).trim();
    if (raw === '') return { v: null };
    if (f.t === 'eur' || f.t === 'num') { var n = parseNum(raw); return isNaN(n) ? { err: 'Bitte eine Zahl eingeben, zum Beispiel 1.250,00.' } : { v: n }; }
    if (f.t === 'pct') { var p = parseNum(raw); if (isNaN(p)) return { err: 'Bitte eine Zahl eingeben, zum Beispiel 83.' }; if (p < 0 || p > 100) return { err: 'Bitte einen Wert zwischen 0 und 100 eingeben.' }; return { v: Math.round(p * 100) / 10000 }; }
    if (f.t === 'year') { var y = parseInt(raw, 10); return (y > 1800 && y < 2100) ? { v: y } : { err: 'Bitte ein Jahr mit vier Ziffern eingeben.' }; }
    if (f.t === 'plz') return /^\d{5}$/.test(raw) ? { v: raw } : { err: 'Die Postleitzahl hat fünf Ziffern.' };
    if (f.t === 'steuerid') { var s = raw.replace(/\s/g, ''); return steuerIdOk(s) ? { v: s } : { err: 'Diese Nummer stimmt nicht. Bitte prüfen Sie die elf Ziffern.' }; }
    return { v: raw };
  }
  function feldHtml(f, D, vomV, id) {
    var v = get(D, f.p), fid = 'f_' + (id || f.p.replace(/\W/g, '_'));
    var vonVertrieb = vomV && v != null && JSON.stringify(get(vomV, f.p.replace(/^eingabe\./, ''))) === JSON.stringify(v);
    var input;
    if (f.t === 'select') {
      input = '<div class="inp"><select id="' + fid + '" data-p="' + f.p + '" data-t="select"><option value="">Bitte wählen</option>' + f.opts.map(function (o) { return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    } else {
      var typ = f.t === 'date' ? 'date' : 'text';
      var im = { eur: 'decimal', pct: 'decimal', num: 'decimal', year: 'numeric', plz: 'numeric', steuerid: 'numeric' }[f.t];
      var suf = f.t === 'eur' ? '€' : f.t === 'pct' ? '%' : f.suf || '';
      input = '<div class="inp' + (suf ? ' has-suf' : '') + '"><input id="' + fid + '" type="' + typ + '" data-p="' + f.p + '" data-t="' + f.t + '"' + (im ? ' inputmode="' + im + '"' : '') + (f.ac ? ' autocomplete="' + f.ac + '"' : '') + ' value="' + esc(f.t === 'date' ? (v || '') : anzeige(f, v)) + '"' + (f.req ? ' aria-required="true"' : '') + ' aria-describedby="' + fid + '_e' + (f.h ? ' ' + fid + '_h' : '') + '">' + (suf ? '<span class="suf">' + suf + '</span>' : '') + '</div>';
    }
    return '<div class="field" data-field="' + f.p + '"><label for="' + fid + '">' + esc(f.l) + (f.req ? '' : ' <span class="muted" style="font-weight:400">(optional)</span>') + '</label>' +
      (vonVertrieb ? '<span class="src">Vom Vertrieb übernommen, bitte prüfen</span>' : '') + input +
      '<span class="errmsg" id="' + fid + '_e" aria-live="polite"></span>' +
      (f.h ? '<details class="help" id="' + fid + '_h"><summary>Wo finde ich das?</summary><p>' + esc(f.h) + '</p></details>' : '') + '</div>';
  }
  function fehlend(fields, D) { return fields.filter(function (f) { var v = get(D, f.p); return f.req && (v == null || v === ''); }); }

  /* ---------- Kopf und Navigation ---------- */
  function nav() {
    var n = $('#nav'), p = S.profil, h = location.hash;
    if (!S.session || !p) { n.innerHTML = ''; return; }
    var links = [];
    if (p.rolle === 'kaeufer') links.push(['#/wohnungen', 'Meine Wohnungen']);
    if (p.rolle === 'vertrieb') { links.push(['#/vertrieb', 'Käufer']); links.push(['#/vertrieb/neu', 'Übergeben']); }
    if (p.rolle === 'kanzlei') links.push(['#/kanzlei', 'Fälle']);
    if (p.rolle === 'admin') links.push(['#/admin', 'Verwaltung']);
    n.innerHTML = links.map(function (l) { return '<a href="' + l[0] + '"' + (h === l[0] || (l[0] !== '#/' && h.indexOf(l[0]) === 0 && !(l[0] === '#/vertrieb' && h === '#/vertrieb/neu')) ? ' aria-current="page"' : '') + '>' + l[1] + '</a>'; }).join('') +
      '<span class="who" title="' + esc(p.email) + '">' + esc(p.name || p.email) + '</span><button type="button" data-act="abmelden">Abmelden</button>';
    $('#kopfZusatz').textContent = { kaeufer: 'Anlage V für Kapitalanleger', vertrieb: 'Für Vertriebe', kanzlei: 'Kanzlei', admin: 'Verwaltung' }[p.rolle] || '';
  }

  /* ---------- Anmeldung ---------- */
  function viewAnmelden() {
    var mail = (new URLSearchParams(location.search)).get('mail') || sessionStorageGet('op_mail') || '';
    mount('<div class="auth">' +
      '<section class="side" aria-label="Über Objektpilot"><span class="eyebrow">Anlage V für Kapitalanleger</span><h1>Mehr netto<br>aus Ihrer Wohnung.<br><em>Von der Kanzlei geprüft.</em></h1>' +
      '<div class="demo" aria-hidden="true"><span>Beispiel: Ihr Netto-Plus mit Freibetrag</span><strong>+551 €</strong><small>im Monat, vorläufig</small></div>' +
      '<ul><li>Kam die Wohnung über einen Vertrieb, sind die Kaufdaten schon da. Sonst tragen Sie sie in etwa 15 Minuten selbst ein.</li><li>Eine Steuerkanzlei prüft alles und gibt die Anlage V frei.</li><li>Server in Frankfurt. Ein Vertrieb sieht keine Steuerdaten.</li></ul></section>' +
      '<section class="form"><div class="stack" id="authBox">' + authSchritt1(mail) + '</div></section></div>', 'Anmelden');
  }
  function authSchritt1(mail) {
    return '<h1 class="h2">Anmelden</h1><p class="muted">Ohne Passwort. Wir schicken Ihnen einen Code per E-Mail.</p>' +
      '<form class="stack" id="fMail" novalidate><div class="field"><label for="mail">E-Mail-Adresse</label><div class="inp"><input id="mail" type="email" autocomplete="email" inputmode="email" required value="' + esc(mail) + '" aria-describedby="mail_e"></div><span class="errmsg" id="mail_e" aria-live="polite"></span></div>' +
      '<button class="btn block" type="submit">Code anfordern</button></form>' +
      '<p class="tiny">Mit der Anmeldung gelten unsere <a href="datenschutz.html">Datenschutzhinweise</a>.</p>';
  }
  function authSchritt2(mail) {
    return '<h1 class="h2">Code eingeben</h1><p class="muted">Wir haben eine E-Mail an <b>' + esc(mail) + '</b> geschickt. Geben Sie den Code ein oder tippen Sie auf den Link in der E-Mail.</p>' +
      '<form class="stack" id="fCode" novalidate><div class="field"><label for="code">Code aus der E-Mail</label><div class="inp"><input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required aria-describedby="code_e"></div><span class="errmsg" id="code_e" aria-live="polite"></span></div>' +
      '<button class="btn block" type="submit">Anmelden</button></form>' +
      '<div class="row small"><button class="link" type="button" data-act="neuerCode" id="btnNeu" disabled>Neuen Code senden</button><span class="muted" id="cd"></span><span class="spacer"></span><button class="link" type="button" data-act="andereMail">Andere Adresse</button></div>' +
      '<p class="tiny">Keine E-Mail da? Schauen Sie auch im Spam-Ordner nach.</p>';
  }
  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { } }
  var countdownIv;
  function countdown() {
    var s = 60, b = $('#btnNeu'), c = $('#cd'); clearInterval(countdownIv);
    if (b) b.disabled = true;
    countdownIv = setInterval(function () { s--; if (c) c.textContent = s > 0 ? 'in ' + s + ' s' : ''; if (s <= 0) { clearInterval(countdownIv); if (b) b.disabled = false; } }, 1000);
  }
  async function codeSenden(mail) {
    var redirect = location.origin + location.pathname;
    var r = await sb.auth.signInWithOtp({ email: mail, options: { shouldCreateUser: true, emailRedirectTo: redirect } });
    if (r.error) throw r.error;
    sessionStorageSet('op_mail', mail);
  }

  /* ---------- Zwei-Faktor für Vertrieb, Kanzlei, Verwaltung ---------- */
  async function mfaPruefen() {
    var r = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (r.error) throw r.error;
    if (r.data.currentLevel === 'aal2') return true;
    if (r.data.nextLevel === 'aal2') { viewMfaCode(); return false; }
    viewMfaEinrichten(); return false;
  }
  async function viewMfaEinrichten() {
    laden();
    try {
      var f = await sb.auth.mfa.listFactors();
      (f.data && f.data.all || []).filter(function (x) { return x.status === 'unverified'; }).forEach(function (x) { sb.auth.mfa.unenroll({ factorId: x.id }); });
      var e = q(await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Objektpilot ' + Date.now() }));
      mount('<div class="wrap narrow"><div class="card pad-l stack"><span class="eyebrow">Sicherheit</span><h1 class="h2">Zweiten Faktor einrichten</h1>' +
        '<p class="muted">Für Vertrieb und Kanzlei ist ein zweiter Faktor Pflicht. Scannen Sie den QR-Code mit einer Authenticator-App, zum Beispiel Microsoft Authenticator, Google Authenticator oder 1Password.</p>' +
        '<div class="row" style="align-items:flex-start"><img src="' + esc(e.totp.qr_code) + '" alt="QR-Code für die Authenticator-App" width="180" height="180" style="background:#fff;border-radius:12px;padding:8px">' +
        '<div class="stack-s" style="flex:1;min-width:200px"><span class="small muted">Oder diesen Schlüssel von Hand eingeben:</span><code class="mono small" style="word-break:break-all">' + esc(e.totp.secret) + '</code></div></div>' +
        '<form class="stack" id="fMfaNeu" data-factor="' + e.id + '"><div class="field"><label for="mfa">Sechsstelliger Code aus der App</label><div class="inp"><input id="mfa" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div><span class="errmsg" id="mfa_e" aria-live="polite"></span></div><button class="btn" type="submit">Bestätigen</button></form></div></div>', 'Sicherheit');
    } catch (err) { fehler(err); }
  }
  function viewMfaCode() {
    mount('<div class="wrap narrow"><div class="card pad-l stack"><span class="eyebrow">Sicherheit</span><h1 class="h2">Code aus der Authenticator-App</h1><p class="muted">Bitte bestätigen Sie die Anmeldung mit dem aktuellen Code.</p>' +
      '<form class="stack" id="fMfa"><div class="field"><label for="mfa">Sechsstelliger Code</label><div class="inp"><input id="mfa" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div><span class="errmsg" id="mfa_e" aria-live="polite"></span></div><button class="btn" type="submit">Bestätigen</button></form></div></div>', 'Sicherheit');
  }

  /* ---------- Start und Routing ---------- */
  async function profilLaden() {
    for (var i = 0; i < 5; i++) {
      var r = await sb.from('profil').select('*').eq('id', S.session.user.id).maybeSingle();
      if (r.data) return r.data;
      await new Promise(function (res) { setTimeout(res, 400); });
    }
    throw new Error('Ihr Konto wird noch eingerichtet. Bitte laden Sie die Seite in ein paar Sekunden neu.');
  }
  async function boot() {
    var r = await sb.auth.getSession();
    S.session = r.data.session;
    if (!S.session) { S.profil = null; nav(); viewAnmelden(); return; }
    try {
      S.profil = await profilLaden();
      if (S.profil.rolle !== 'kaeufer') { if (!(await mfaPruefen())) { nav(); return; } }
      var o = await sb.from('organisation').select('*').order('name'); S.orgs = o.data || [];
      nav(); route();
    } catch (e) { fehler(e); }
  }
  function route() {
    stopTimer(); FK = null;
    if (route._h !== location.hash) { viewAbschnitt._alle = false; route._h = location.hash; }
    if (!S.session) { viewAnmelden(); return; }
    var h = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean), r = S.profil.rolle;
    nav();
    if (h[0] === 'konto') return viewKonto();
    if (r === 'kaeufer') { if (h[0] === 'akte' && h[1]) return h[2] ? viewAbschnitt(h[1], h[2]) : viewAkte(h[1]); return viewKaeuferStart(); }
    if (r === 'vertrieb') { if (h[0] === 'vertrieb' && h[1] === 'neu') return viewVertriebNeu(); return viewVertrieb(); }
    if (r === 'kanzlei') { if (h[0] === 'kanzlei' && h[1]) return viewFall(h[1]); return viewKanzlei(); }
    if (r === 'admin') return viewAdmin();
  }

  /* ---------- Käufer ---------- */
  async function viewKaeuferStart() {
    laden();
    try {
      await sb.rpc('kaeufer_verknuepfen');
      var akten = q(await sb.from('akte').select('id,nummer,objekt_bezeichnung,vz,status,updated_at').order('created_at', { ascending: false }));
      if (akten.length === 1 && !viewKaeuferStart._liste && location.hash !== '#/wohnungen') { location.replace('#/akte/' + akten[0].id); return; }
      var jahr = new Date().getFullYear();
      var neuForm = '<form class="card pad stack" id="fNeuAkte" novalidate><h2 class="h3">' + (akten.length ? 'Weitere Wohnung anlegen' : 'Wohnung anlegen') + '</h2>' +
        '<div class="grid2"><div class="field"><label for="n_obj">Wohnung</label><div class="inp"><input id="n_obj" required placeholder="Leipzig, Musterstraße 12, WE 7" autocomplete="off"></div><span class="errmsg" id="n_obj_e" aria-live="polite"></span></div>' +
        '<div class="field"><label for="n_vz">Steuerjahr</label><div class="inp"><select id="n_vz">' + [jahr - 2, jahr - 1, jahr].map(function (y) { return '<option' + (y === jahr ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></div></div></div>' +
        '<button class="btn gold" type="submit">Anlegen und loslegen →</button></form>';
      if (!akten.length) {
        mount('<div class="wrap narrow stack"><section class="hero"><span class="eyebrow">Willkommen</span><h1 class="title" style="color:#fff">Ihre Anlage V,<br><span style="color:var(--y)">von der Kanzlei geprüft.</span></h1>' +
          '<p>Legen Sie Ihre Wohnung an und tragen Sie die Zahlen aus Kaufvertrag, Mietvertrag und Darlehensvertrag ein. Das dauert etwa 15 Minuten. Danach prüft eine Steuerkanzlei alles zum Festpreis und gibt die Anlage V frei.</p>' +
          '<div class="row small"><span>✓ Netto-Plus sofort sichtbar</span><span>✓ Festpreis ab 249 €</span><span>✓ Server in Frankfurt</span></div></section>' + neuForm +
          '<div class="note info"><span class="ic" aria-hidden="true">i</span><span><b>Kommt Ihre Wohnung über einen Vertrieb?</b>Dann müssen Sie nichts anlegen. Sie erscheint hier automatisch, sobald der Vertrieb sie mit <b>' + esc(S.profil.email) + '</b> übergeben hat.</span></div></div>', 'Meine Wohnungen');
        return;
      }
      mount('<div class="wrap narrow stack"><span class="eyebrow">Meine Wohnungen</span><h1 class="title">Ihre Anlagen V</h1><ul class="tasks">' +
        akten.map(function (a) { return '<li><a href="#/akte/' + a.id + '"><span class="n" aria-hidden="true">' + String(a.vz).slice(2) + '</span><span class="t"><b>' + esc(a.objekt_bezeichnung) + '</b><span>Steuerjahr ' + a.vz + ' · ' + a.nummer + '</span></span>' + statusChip(a.status) + '</a></li>'; }).join('') + '</ul>' +
        '<details class="help"><summary>Weitere Wohnung oder weiteres Steuerjahr anlegen</summary><div style="margin-top:10px">' + neuForm + '</div></details></div>', 'Meine Wohnungen');
    } catch (e) { fehler(e); }
  }
  var STATUS = {
    eingeladen: ['Neu', 'c-grey'], in_erfassung: ['In Bearbeitung', 'c-info'], in_pruefung: ['Bei der Kanzlei', 'c-warn'],
    rueckfrage: ['Rückfrage', 'c-bad'], freigegeben: ['Freigegeben', 'c-ok'], abgeschlossen: ['Abgeschlossen', 'c-ok'],
    eigener_stb: ['Datenpaket bereit', 'c-ok'], sonderfall: ['Angebot folgt', 'c-gold']
  };
  function statusChip(s) { var x = STATUS[s] || [s, 'c-grey']; return '<span class="chip ' + x[1] + '">' + x[0] + '</span>'; }

  var A = { akte: null, daten: null, docs: [], msgs: [], pruefung: null, mandat: null };
  async function akteLaden(id) {
    var r = await Promise.all([
      sb.from('akte').select('*').eq('id', id).maybeSingle(),
      sb.from('akte_daten').select('*').eq('akte_id', id).maybeSingle(),
      sb.from('dokument').select('*').eq('akte_id', id).order('created_at'),
      sb.from('nachricht').select('*').eq('akte_id', id).order('created_at'),
      sb.from('akte_pruefung').select('*').eq('akte_id', id).maybeSingle(),
      sb.from('mandat').select('*').eq('akte_id', id).maybeSingle()
    ]);
    A.akte = q(r[0]); if (!A.akte) throw new Error('Diese Akte gibt es nicht oder Sie haben keinen Zugriff.');
    A.daten = q(r[1]) || { akte_id: id, eingabe: {}, stammdaten: {}, fallcheck: {}, erledigt: {}, vom_vertrieb: {} };
    A.docs = q(r[2]) || []; A.msgs = q(r[3]) || []; A.pruefung = q(r[4]); A.mandat = q(r[5]);
  }
  function kernEingabe(daten, vz, quittiert) {
    var e = clone(daten.eingabe);
    e.vz = vz;
    e.objekt = Object.assign({ nutzung: 'dauer', anAngehoerige: false, eigengenutztQm: 0, ustOption: false, denkmal: false }, e.objekt || {});
    e.personen = Object.assign({ anteilA: 1 }, e.personen || {});
    e.inventar = (e.inventar || []).filter(function (x) { return x && x.ak > 0; }).map(function (x) { return Object.assign({ bezeichnung: 'Einbauküche', imKaufpreis: true, nutzungsdauer: 10 }, x); });
    e.finanzierung = e.finanzierung || {}; e.finanzierung.darlehen = (e.finanzierung.darlehen || []).filter(Boolean);
    e.miete = e.miete || {}; e.hausgeld = e.hausgeld || {};
    e.kanzlei = { quittiert: quittiert || [] };
    return e;
  }
  function rechne(daten, vz, quittiert) {
    try { return Kern.berechne(kernEingabe(daten, vz, quittiert)); } catch (e) { console.warn(e); return null; }
  }
  function absFertig(k) { return !!(A.daten.erledigt || {})[k]; }
  function fortschritt() { return ABS.slice(0, 7).filter(function (a) { return absFertig(a.k); }).length; }

  async function viewAkte(id) {
    laden();
    try {
      await akteLaden(id);
      if (A.akte.status === 'eingeladen') { await sb.rpc('kaeufer_oeffnen', { p_akte: id }); A.akte.status = 'in_erfassung'; }
      var a = A.akte, offen = a.status === 'in_erfassung';
      var kopf = '<div class="stack-s"><span class="eyebrow">' + esc(a.nummer) + ' · Steuerjahr ' + a.vz + '</span><h1 class="title">' + esc(a.objekt_bezeichnung) + '</h1><div class="row">' + statusChip(a.status) + '</div></div>';
      if (offen) {
        var n = fortschritt(), naechste = ABS.filter(function (x) { return !absFertig(x.k); })[0] || ABS[7];
        var alleFertig = n >= 7;
        var rv = rechne(A.daten, a.vz, []), plus = rv && rv.freibetrag && rv.freibetrag.steuerwirkungMonat;
        mount('<div class="wrap narrow stack">' + kopf +
          '<section class="hero" aria-label="Ihr Netto-Plus und Fortschritt"><span class="eyebrow">Ihr Netto-Plus' + (plus ? ' ab ' + rv.freibetrag.jahr : '') + '</span>' +
          (plus ? '<div class="big num">+' + eur(plus) + '<small>im Monat, vorläufig</small></div><p class="small">So viel weniger Lohnsteuer zahlen Sie voraussichtlich mit Freibetrag. Die Kanzlei prüft die Zahl, bevor sie gilt.</p>'
            : '<div class="big">+ ? €<small>im Monat</small></div><p class="small">Sobald Wohnung, Miete und Finanzierung eingetragen sind, sehen Sie hier, wie viel mehr netto im Monat drin ist.</p>') +
          '<div class="row"><b>' + n + ' von 7 Schritten erledigt</b><span class="spacer"></span><span class="tiny">Alles wird automatisch gespeichert</span></div><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="7" aria-valuenow="' + n + '"><i style="width:' + Math.max(3, Math.round(n / 7 * 100)) + '%"></i></div>' +
          '<a class="btn" href="#/akte/' + id + '/' + naechste.k + '">' + (n === 0 ? 'Jetzt starten' : 'Weiter mit: ' + naechste.t) + ' →</a></section>' +
          '<ol class="tasks">' + ABS.map(function (x, i) {
            var fertig = absFertig(x.k), gesperrt = x.k === 'auftrag' && !alleFertig;
            var inner = '<span class="n" aria-hidden="true">' + ico(fertig ? 'check' : x.k) + '</span><span class="t"><b>' + x.t + '</b><span>' + x.s + '</span></span>' + (fertig ? '<span class="chip c-ok">Erledigt</span>' : gesperrt ? '<span class="chip c-grey">Zuerst Schritte 1 bis 7</span>' : '<span class="chip c-grey">Offen</span>');
            return '<li class="' + (fertig ? 'done' : '') + '">' + (gesperrt ? '<span class="dis">' + inner + '</span>' : '<a href="#/akte/' + id + '/' + x.k + '">' + inner + '</a>') + '</li>';
          }).join('') + '</ol>' +
          '<div class="note info"><span class="ic" aria-hidden="true">i</span><span><b>Wer sieht was?</b>Ihre Angaben sehen nur Sie und die Kanzlei, die Sie wählen.' + (a.vertrieb_id ? ' Ihr Vertrieb sieht keine Steuerdaten.' : '') + '</span></div></div>', a.objekt_bezeichnung);
        return;
      }
      mount('<div class="wrap narrow stack">' + kopf + statusInhalt() + '</div>', a.objekt_bezeichnung);
    } catch (e) { fehler(e); }
  }
  function werktagePlus(s, n) {
    var d = s ? new Date(s) : new Date();
    while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n--; }
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function kanzleiName(id) { var o = S.orgs.filter(function (x) { return x.id === id; })[0]; return o ? o.name : 'Ihre Kanzlei'; }
  function nachrichtenHtml(msgs, ich) {
    if (!msgs.length) return '';
    return '<div class="stack-s" role="log" aria-label="Nachrichten">' + msgs.map(function (m) { return '<div class="msg ' + m.von_rolle + '">' + esc(m.text) + '<small>' + (m.von_rolle === ich ? 'Sie' : m.von_rolle === 'kanzlei' ? 'Kanzlei' : 'Käufer') + ' · ' + zeit(m.created_at) + '</small></div>'; }).join('') + '</div>';
  }
  function statusInhalt() {
    var a = A.akte, s = a.status, kname = kanzleiName(a.kanzlei_id);
    var schritte = [['Angaben und Unterlagen vollständig', 1], ['Beauftragt bei ' + esc(kname), 1], ['Prüfung durch die Kanzlei', s === 'freigegeben' || s === 'abgeschlossen' ? 1 : 2], ['Anlage V freigegeben', s === 'freigegeben' || s === 'abgeschlossen' ? 1 : 0]];
    var html = '';
    if (s === 'eigener_stb') return datenpaketHtml();
    if (s === 'sonderfall') {
      html += '<div class="note warn"><span class="ic" aria-hidden="true">!</span><span><b>Ihr Fall braucht eine individuelle Prüfung</b>' + esc(kname) + ' sieht sich Ihre Angaben an und meldet sich mit einem Angebot. Das kann ein paar Tage dauern.</span></div>';
      html += nachrichtenHtml(A.msgs, 'kaeufer');
      return html;
    }
    html += '<div class="card pad"><div class="tl">' + schritte.map(function (x) { return '<div class="' + (x[1] === 1 ? 'd' : x[1] === 2 ? 'now' : '') + '"><span><b>' + x[0] + '</b>' + (x[1] === 2 ? '<small>' + (s === 'rueckfrage' ? 'Die Kanzlei hat eine Frage an Sie' : 'Voraussichtlich fertig bis ' + werktagePlus(a.updated_at, 5)) + '</small>' : '') + '</span></div>'; }).join('') + '</div></div>';
    if (s === 'rueckfrage' || A.msgs.length) {
      html += '<section class="card pad stack" aria-labelledby="nh"><h2 class="h3" id="nh">Nachrichten mit der Kanzlei</h2>' + nachrichtenHtml(A.msgs, 'kaeufer') +
        (s === 'rueckfrage' ? '<form class="stack" id="fAntwort"><div class="field"><label for="antwort">Ihre Antwort</label><textarea class="ta" id="antwort" rows="3" required></textarea></div><div class="row"><button class="btn" type="submit">Antwort senden</button><a class="btn sec" href="#/akte/' + a.id + '/unterlagen">Unterlage nachreichen</a></div></form>' : '') + '</section>';
    }
    if ((s === 'freigegeben' || s === 'abgeschlossen') && A.pruefung && A.pruefung.ergebnis) html += ergebnisHtml(A.pruefung.ergebnis, true);
    return html;
  }
  function anlageVTabelle(r) {
    var E = r.zeilen.filter(function (l) { return l.art === 'E' && l.betrag; }), W = r.zeilen.filter(function (l) { return l.art === 'W' && l.betrag; });
    var row = function (l) { return '<tr><td class="zl">' + esc(l.zeile) + '</td><td>' + esc(l.feld) + '</td><td class="r">' + nf0.format(l.betrag) + '</td></tr>'; };
    return '<div class="tw"><table><thead><tr><th>Zeile</th><th>Eintrag</th><th class="r">Euro</th></tr></thead><tbody>' + E.map(row).join('') +
      '<tr class="sum"><td class="zl">32</td><td>Summe der Einnahmen</td><td class="r">' + nf0.format(r.summen.einnahmen) + '</td></tr>' + W.map(row).join('') +
      '<tr class="sum"><td class="zl">83</td><td>Summe der Werbungskosten</td><td class="r">' + nf0.format(r.summen.werbungskosten) + '</td></tr>' +
      '<tr class="sum"><td class="zl">85</td><td>Überschuss</td><td class="r">' + nf0.format(r.summen.ueberschuss) + '</td></tr></tbody></table></div>';
  }
  function freibetragHtml(fb) {
    if (!fb || !fb.freibetrag) return '';
    return '<div class="hero"><span class="eyebrow">Ihr Netto-Plus ab ' + fb.jahr + '</span>' +
      (fb.steuerwirkungMonat ? '<div class="big num">+' + eur(fb.steuerwirkungMonat) + '<small>im Monat</small></div><p>Mit einem Freibetrag von <b style="color:#fff">' + eur(fb.freibetrag) + '</b> zahlen Sie voraussichtlich so viel weniger Lohnsteuer.</p>' : '<div class="big num">' + eur(fb.freibetrag) + '<small>Freibetrag</small></div><p>Tragen Sie Ihren Grenzsteuersatz ein, dann zeigen wir die monatliche Wirkung.</p>') +
      '<p class="small muted">Den Antrag auf Lohnsteuer-Ermäßigung stellen Sie in Mein ELSTER. Er gilt in der Regel ab dem Jahr nach dem Kauf. Mit Freibetrag ist jedes Jahr eine Steuererklärung Pflicht.</p></div>';
  }
  function ergebnisHtml(r, freigegeben) {
    var a = A.akte, sd = (A.daten && A.daten.stammdaten) || {};
    return '<section class="stack" aria-labelledby="erg"><h2 class="h2" id="erg">Ihre Anlage V ' + r.vz + '</h2>' +
      '<div class="sheet"><span class="stamp' + (freigegeben ? '' : ' draft') + '">' + (freigegeben ? 'Geprüft und freigegeben<br>' + esc(kanzleiName(a.kanzlei_id)) : 'Entwurf<br>nicht geprüft') + '</span>' +
      '<div class="stack-s" style="margin-bottom:12px"><b>' + esc([sd.vorname, sd.nachname].filter(Boolean).join(' ')) + '</b><span class="small muted">' + esc(a.objekt_bezeichnung) + (freigegeben && A.pruefung ? ' · freigegeben am ' + dDE(A.pruefung.freigabe_am) : '') + '</span></div>' +
      anlageVTabelle(r) + '<p class="tiny" style="margin-top:12px">Zeilen nach dem Vordruck Anlage V 2025. Beträge in vollen Euro.</p></div>' +
      freibetragHtml(r.freibetrag) +
      '<div class="card pad stack noprint"><h3 class="h3">So geht es weiter</h3><ol class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px"><li>Speichern Sie die Anlage V als PDF.</li><li>Tragen Sie die Werte in Mein ELSTER in die Anlage V Ihrer Einkommensteuererklärung ein oder geben Sie das PDF Ihrem Steuerberater.</li><li>Für den Freibetrag stellen Sie in Mein ELSTER einen Antrag auf Lohnsteuer-Ermäßigung.</li></ol>' +
      '<div class="row"><button class="btn" type="button" data-act="drucken">Als PDF speichern</button></div></div></section>';
  }
  function datenpaketHtml() {
    var r = rechne(A.daten, A.akte.vz, []);
    return '<div class="note ok"><span class="ic" aria-hidden="true">✓</span><span><b>Ihr Datenpaket ist bereit</b>Geben Sie das PDF und die Unterlagen Ihrem Steuerberater. Die Werte sind vorbereitet, aber von keiner Kanzlei geprüft.</span></div>' +
      (r ? ergebnisHtml(r, false) : '') +
      '<section class="card pad stack"><h2 class="h3">Ihre Unterlagen</h2>' + dokListe(A.docs, false) + '</section>';
  }
  function dokListe(docs, loeschen) {
    if (!docs.length) return '<p class="small muted">Noch keine Unterlagen.</p>';
    return '<ul class="docs">' + docs.map(function (d) {
      var t = (DOKTYPEN.filter(function (x) { return x.k === d.typ; })[0] || {}).t || d.typ;
      var ext = (d.dateiname.split('.').pop() || '').slice(0, 4).toUpperCase();
      return '<li><span class="ic" aria-hidden="true">' + esc(ext) + '</span><span style="flex:1;min-width:0"><b class="small">' + esc(t) + '</b><br><span class="tiny">' + esc(d.dateiname) + ' · ' + (d.quelle === 'vertrieb' ? 'vom Vertrieb' : d.quelle === 'kanzlei' ? 'von der Kanzlei' : 'von Ihnen') + '</span></span>' +
        '<button class="btn ghost sm" type="button" data-act="dokOeffnen" data-pfad="' + esc(d.pfad) + '">Öffnen</button>' +
        (loeschen && d.quelle === 'kaeufer' && d.hochgeladen_von === S.session.user.id ? '<button class="btn ghost sm" type="button" data-act="dokLoeschen" data-id="' + d.id + '" data-pfad="' + esc(d.pfad) + '" aria-label="' + esc(d.dateiname) + ' löschen">Löschen</button>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  /* Abschnitte */
  var FK = null;
  function fokusLeer(el) {
    if (el.matches('fieldset')) return !el.querySelector('[aria-pressed="true"]');
    return $$('[data-p]', el).some(function (inp) { return !inp.value; });
  }
  function fokusInit(k, nachAuswahl) {
    FK = null;
    if (k === 'unterlagen' || k === 'auftrag' || viewAbschnitt._alle) return;
    var box = $('#fAbs > .stack'); if (!box) return;
    var steps = Array.prototype.filter.call(box.children, function (el) { return el.matches('.field, .grid2, fieldset, .note'); });
    if (steps.length < 2) return;
    var start = steps.findIndex(fokusLeer); if (start < 0) start = nachAuswahl ? steps.length - 1 : 0;
    FK = { k: k, steps: steps, i: start };
    box.classList.add('fokus');
    var segs = document.createElement('div'); segs.className = 'fsegs'; segs.setAttribute('aria-hidden', 'true');
    segs.innerHTML = steps.map(function () { return '<i></i>'; }).join(''); box.parentNode.insertBefore(segs, box);
    var bar = $('.savebar .inner');
    if (bar && !$('#fWeiter')) {
      bar.insertAdjacentHTML('afterbegin', '<button class="btn sec" type="button" data-act="fZurueck" id="fZurueck">Zurück</button><button class="btn gold" type="button" data-act="fWeiter" id="fWeiter">Weiter</button>');
      var orig = $('[data-act="absWeiter"]'); if (orig) orig.classList.add('fk-aus'); $$('.savebar .btn.ghost').forEach(function (x) { x.classList.add('fk-aus'); });
      bar.insertAdjacentHTML('beforeend', '<button class="link small" type="button" data-act="fAlle">Alle Fragen auf einmal</button>');
    }
    fokusZeigen(!nachAuswahl);
  }
  function fokusZeigen(fokus) {
    if (!FK) return;
    FK.steps.forEach(function (el, j) { el.classList.toggle('fk-aus', j !== FK.i); });
    $$('.fsegs i').forEach(function (el, j) { el.className = j < FK.i ? 'd' : j === FK.i ? 'now' : ''; });
    var letzte = FK.i >= FK.steps.length - 1, w = $('#fWeiter'), z = $('#fZurueck');
    if (w) w.textContent = letzte ? 'Speichern und weiter' : 'Weiter';
    if (z) z.disabled = FK.i === 0;
    var cur = FK.steps[FK.i]; cur.classList.remove('fk-rein'); void cur.offsetWidth; cur.classList.add('fk-rein');
    if (fokus) { var f = cur.querySelector('input,select,button'); if (f) f.focus({ preventScroll: true }); }
  }
  function fokusWeiter() {
    if (!FK) return;
    var cur = FK.steps[FK.i], ok = true;
    $$('[data-p]', cur).forEach(function (inp) { if (!pruefeFeld(inp, true).ok) ok = false; });
    if (cur.matches('fieldset') && fokusLeer(cur)) { toast('Bitte wählen Sie eine Antwort.', true); return; }
    if (!ok) { var e = cur.querySelector('[aria-invalid="true"]'); if (e) e.focus(); return; }
    if (FK.i >= FK.steps.length - 1) { var orig = $('[data-act="absWeiter"]'); if (orig) orig.click(); return; }
    FK.i++; fokusZeigen(true); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  var aktAbs = null;
  async function viewAbschnitt(id, k) {
    laden();
    try {
      if (!A.akte || A.akte.id !== id) await akteLaden(id);
      else { var d = await sb.from('dokument').select('*').eq('akte_id', id).order('created_at'); A.docs = d.data || []; }
      var a = A.akte;
      if (['in_erfassung', 'eingeladen', 'rueckfrage'].indexOf(a.status) < 0) { location.replace('#/akte/' + id); return; }
      var i = ABS.findIndex(function (x) { return x.k === k; }); if (i < 0) { location.replace('#/akte/' + id); return; }
      aktAbs = k;
      var abs = ABS[i], body = '';
      if (k === 'fallcheck') body = fallcheckHtml();
      else if (k === 'unterlagen') body = unterlagenHtml();
      else if (k === 'auftrag') body = auftragHtml();
      else body = '<div class="stack">' + (k === 'wohnung' ? '<div class="grid2">' + F.wohnung.slice(0, 2).map(function (f) { return feldHtml(f, A.daten, A.daten.vom_vertrieb); }).join('') + '</div>' + F.wohnung.slice(2).map(function (f) { return feldHtml(f, A.daten, A.daten.vom_vertrieb); }).join('') :
        k === 'person' ? '<div class="grid2">' + F.person.slice(0, 2).map(function (f) { return feldHtml(f, A.daten); }).join('') + '</div>' + feldHtml(F.person[2], A.daten) + feldHtml(F.person[3], A.daten) + '<div class="grid2">' + F.person.slice(4, 6).map(function (f) { return feldHtml(f, A.daten); }).join('') + '</div>' + F.person.slice(6).map(function (f) { return feldHtml(f, A.daten); }).join('') :
          F[k].map(function (f) { return feldHtml(f, A.daten, A.daten.vom_vertrieb); }).join('')) + '</div>';
      var intro = {
        wohnung: 'Die meisten Angaben stehen im Kaufvertrag.' + (a.vertrieb_id ? ' Was Ihr Vertrieb schon eingetragen hat, ist markiert. Bitte prüfen Sie es kurz.' : ' Unter jedem Feld steht, wo Sie die Zahl finden.'),
        miete: 'Laut Mietvertrag. Gerechnet wird ab dem Übergang der Wohnung.',
        finanzierung: 'Laut Darlehensvertrag. Tilgung spielt für die Steuer keine Rolle, nur die Zinsen.',
        hausgeld: 'Alle Werte stehen im Wirtschaftsplan Ihrer Hausverwaltung. Gezählt wird, was Sie im Jahr tatsächlich gezahlt haben.',
        person: 'Diese Angaben braucht die Kanzlei für die Anlage V und die Vergütungsvereinbarung.'
      }[k];
      var weiter = k === 'auftrag' ? '' : '<div class="savebar noprint"><div class="inner"><button class="btn" type="button" data-act="absWeiter" data-k="' + k + '">Speichern und weiter</button><a class="btn ghost" href="#/akte/' + id + '">Zur Übersicht</a><span class="spacer"></span><span class="saved" id="saved" aria-live="polite"></span></div></div>';
      mount('<div class="wrap narrow stack"><a class="link small noprint" href="#/akte/' + id + '">← ' + esc(a.objekt_bezeichnung) + '</a>' +
        '<div class="stack-s"><span class="eyebrow abs-kopf">' + ico(k) + 'Schritt ' + (i + 1) + ' von 8</span><h1 class="title">' + abs.t + '</h1>' + (intro ? '<p class="lead">' + intro + '</p>' : '') + '</div>' +
        '<div id="errsum"></div><form class="stack" id="fAbs" novalidate onsubmit="return false">' + body + '</form>' + weiter + '</div>', abs.t);
      fokusInit(k);
    } catch (e) { fehler(e); }
  }
  function fallcheckHtml() {
    var c = A.daten.fallcheck || {};
    var frage = function (key, label, opts) { return '<fieldset class="stack-s" style="border:0;padding:0;margin:0"><legend class="legend">' + label + '</legend><div class="choice">' + opts.map(function (o) { return '<button type="button" data-act="fc" data-k="' + key + '" data-v="' + o[0] + '" aria-pressed="' + (c[key] === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div></fieldset>'; };
    var vollst = c.nutzung && c.wohnungen && c.art && c.angestellt;
    var sf = sonderfall(c);
    return '<div class="stack">' + frage('nutzung', 'Wie vermieten Sie die Wohnung?', [['dauer', 'Dauerhaft an Fremde'], ['fewo', 'Als Ferienwohnung'], ['ang', 'An Angehörige']]) +
      frage('wohnungen', 'Wie viele Wohnungen vermieten Sie insgesamt?', [['1', 'Eine'], ['2-3', 'Zwei oder drei'], ['4+', 'Vier oder mehr']]) +
      frage('art', 'Was für ein Objekt ist es?', [['neubau', 'Neubau'], ['bestand', 'Bestand'], ['denkmal', 'Denkmal oder Sanierungsgebiet']]) +
      frage('angestellt', 'Sind Sie angestellt?', [['ja', 'Ja'], ['nein', 'Nein, selbstständig oder anderes']]) +
      (vollst ? (sf ? '<div class="note warn"><span class="ic" aria-hidden="true">!</span><span><b>Ihr Fall braucht eine individuelle Prüfung</b>Sie können trotzdem alles eintragen. Die Kanzlei meldet sich dann mit einem eigenen Angebot statt des Festpreises.</span></div>' :
        '<div class="note ok"><span class="ic" aria-hidden="true">✓</span><span><b>Standardfall</b>Ihre Anlage V gibt es zum Festpreis. ' + (c.angestellt === 'ja' ? 'Weil Sie angestellt sind, bekommen Sie zusätzlich die Zahlen für den Freibetrag.' : 'Statt eines Freibetrags passt bei Ihnen eine Anpassung der Vorauszahlungen, das klärt die Kanzlei.') + '</span></div>') : '') + '</div>';
  }
  function sonderfall(c) { return c.nutzung && (c.nutzung !== 'dauer' || c.wohnungen === '4+' || c.art === 'denkmal'); }
  function unterlagenHtml() {
    return '<div class="stack"><p class="small muted">PDF oder Foto, bis 20 MB je Datei. Am Handy können Sie direkt die Kamera nutzen.</p><ul class="tasks">' + DOKTYPEN.filter(function (t) { return t.k !== 'sonstiges'; }).map(function (t) {
      var da = A.docs.filter(function (d) { return d.typ === t.k; });
      return '<li><div class="dis" style="opacity:1"><span class="n" aria-hidden="true" style="' + (da.length ? 'background:var(--ok);border-color:var(--ok);color:#fff' : '') + '">' + (da.length ? '✓' : '') + '</span><span class="t"><b>' + t.t + (t.req ? '' : ' <span class="muted" style="font-weight:400">(falls vorhanden)</span>') + '</b><span>' + (da.length ? da.map(function (d) { return esc(d.dateiname) + (d.quelle === 'vertrieb' ? ' · vom Vertrieb' : ''); }).join(', ') : 'Noch nicht vorhanden') + '</span></span>' +
        '<label class="btn sec sm">' + (da.length ? 'Weitere' : 'Hochladen') + '<input type="file" class="sr" data-act="upload" data-typ="' + t.k + '" accept="application/pdf,image/*" multiple></label></div></li>';
    }).join('') + '</ul>' +
      '<div class="drop" id="drop"><p class="small"><b>Weitere Unterlagen</b> hierher ziehen oder <label class="link" style="cursor:pointer">auswählen<input type="file" class="sr" data-act="upload" data-typ="sonstiges" accept="application/pdf,image/*" multiple></label></p></div>' +
      '<div id="uplStatus" class="small muted" aria-live="polite"></div>' +
      '<details class="help"><summary>Ihre Dateien</summary><div style="margin-top:8px">' + dokListe(A.docs, true) + '</div></details></div>';
  }
  function auftragHtml() {
    var r = rechne(A.daten, A.akte.vz, []), c = A.daten.fallcheck || {}, sf = sonderfall(c);
    var kanzleien = S.orgs.filter(function (o) { return o.typ === 'kanzlei' && o.aktiv; });
    var uebJahr = parseInt(String(get(A.daten, 'eingabe.erwerb.uebergang') || '').slice(0, 4), 10);
    var kaufjahr = uebJahr === A.akte.vz;
    var preis = function (o) { return kaufjahr ? (o.preis_kaufjahr || 349) : (o.preis_folgejahr || 249); };
    var w = A.daten._wahl || '';
    var vorschau = r ? '<section class="card pad stack" aria-labelledby="vs"><div class="row"><h2 class="h3" id="vs">Vorschau Ihrer Anlage V</h2><span class="chip c-gold">Wird von der Kanzlei geprüft</span></div>' +
      '<div class="kpis"><div class="kpi card"><strong class="num">' + eur(r.summen.einnahmen) + '</strong><span>Einnahmen ' + A.akte.vz + '</span></div><div class="kpi card"><strong class="num">' + eur(r.summen.werbungskosten) + '</strong><span>Werbungskosten</span></div><div class="kpi card"><strong class="num">' + eur(r.summen.ueberschuss) + '</strong><span>Ergebnis</span></div></div>' +
      (r.freibetrag && r.freibetrag.steuerwirkungMonat ? '<p class="small">Mit Freibetrag ab ' + r.freibetrag.jahr + ' voraussichtlich rund <b>' + eur(r.freibetrag.steuerwirkungMonat) + ' mehr netto im Monat</b>.</p>' : '') + '</section>' : '';
    var opts = kanzleien.map(function (o) { return '<button type="button" class="opt" data-act="wahl" data-v="' + o.id + '" aria-pressed="' + (w === o.id) + '"><i class="dot" aria-hidden="true"></i><span><b>' + esc(o.name) + '</b><span>' + (sf ? 'Prüft Ihren Fall und macht Ihnen ein Angebot' : 'Prüft und gibt frei. Festpreis ' + eur2(preis(o)) + ' inkl. 19 % USt, Rückfragen inklusive') + '</span></span></button>'; }).join('') +
      '<button type="button" class="opt" data-act="wahl" data-v="eigen" aria-pressed="' + (w === 'eigen') + '"><i class="dot" aria-hidden="true"></i><span><b>Mein eigener Steuerberater</b><span>Sie bekommen die vorbereitete Anlage V und alle Unterlagen als Datenpaket</span></span></button>';
    var gew = kanzleien.filter(function (o) { return o.id === w; })[0];
    var mandatText = gew ? 'Ich beauftrage ' + gew.name + ' mit der Prüfung und Erstellung der Anlage V für die Wohnung ' + A.akte.objekt_bezeichnung + ' für das Steuerjahr ' + A.akte.vz + ' auf Grundlage meiner Angaben und Unterlagen. ' +
      (sf ? 'Die Kanzlei macht mir zuerst ein Angebot. Ein Auftrag kommt erst zustande, wenn ich das Angebot annehme.' : 'Vergütung: Festpreis ' + eur2(preis(gew)) + ' einschließlich 19 % Umsatzsteuer, abweichend von der gesetzlichen Vergütung nach der Steuerberatervergütungsverordnung (Vergütungsvereinbarung in Textform nach § 4 StBVV). Rückfragen der Kanzlei zur Anlage V sind enthalten. Nicht enthalten sind die Einkommensteuererklärung und die Übermittlung an das Finanzamt. Die Rechnung stellt die Kanzlei direkt an mich.') : '';
    return '<div class="stack">' + vorschau +
      '<fieldset class="stack-s" style="border:0;padding:0;margin:0"><legend class="h3" style="margin-bottom:8px">Wer soll Ihre Anlage V prüfen?</legend><p class="small muted" style="margin-bottom:8px">Sie wählen frei. Ihr Vertrieb erfährt nicht, wen Sie wählen.</p>' + opts + '</fieldset>' +
      (w ? '<div class="card pad stack">' +
        (w === 'eigen' ? '<label class="check"><input type="checkbox" id="c1"> <span>Ich möchte die vorbereitete Anlage V und meine Unterlagen als Datenpaket für meinen Steuerberater.</span></label>' :
          '<details class="help" open><summary>Auftrag und Vergütung</summary><p>' + esc(mandatText) + '</p></details><label class="check"><input type="checkbox" id="c1"> <span>' + (sf ? 'Ich bitte um ein Angebot zu den genannten Bedingungen.' : 'Ich erteile den Auftrag zu diesen Bedingungen.') + '</span></label>') +
        '<label class="check"><input type="checkbox" id="c2"> <span>Ich habe die <a href="datenschutz.html" target="_blank" rel="noopener">Datenschutzhinweise</a> gelesen.</span></label>' +
        (A.akte.vertrieb_id ? '<label class="check"><input type="checkbox" id="c3"> <span>Mein Vertrieb darf sehen, dass der Steuerservice läuft. <span class="muted">Freiwillig, ohne Zahlen und ohne Kanzleiname.</span></span></label>' : '') +
        '<button class="btn gold block" type="button" data-act="beauftragen">' + (w === 'eigen' ? 'Datenpaket erstellen' : sf ? 'Angebot anfordern' : 'Verbindlich beauftragen') + '</button></div>' : '') + '</div>';
  }

  /* Speichern */
  var speichern = debounce(async function () {
    var el = $('#saved'); if (el) { el.className = 'saved'; el.textContent = 'Speichert …'; }
    try {
      var d = A.daten;
      q(await sb.from('akte_daten').update({ eingabe: d.eingabe, stammdaten: d.stammdaten, fallcheck: d.fallcheck, erledigt: d.erledigt }).eq('akte_id', A.akte.id));
      if (el) { el.className = 'saved ok'; el.textContent = 'Gespeichert'; }
    } catch (e) { if (el) { el.className = 'saved'; el.textContent = 'Nicht gespeichert'; } fehler(e); }
  }, 600);
  function feldDef(p) { var all = [].concat(F.wohnung, F.miete, F.finanzierung, F.hausgeld, F.person); return all.filter(function (f) { return f.p === p; })[0]; }
  function pruefeFeld(input, final) {
    var f = feldDef(input.dataset.p) || { t: input.dataset.t, p: input.dataset.p };
    var box = input.closest('.field'), msg = box && box.querySelector('.errmsg');
    var r = f.t === 'select' || f.t === 'date' ? { v: input.value || null } : wert(f, input.value);
    if (r.err) { if (final) { box.classList.add('err'); input.setAttribute('aria-invalid', 'true'); msg.textContent = r.err; } return { ok: false, f: f }; }
    if (final && f.req && (r.v == null)) { box.classList.add('err'); input.setAttribute('aria-invalid', 'true'); msg.textContent = 'Bitte ausfüllen.'; return { ok: false, f: f, v: r.v }; }
    box.classList.remove('err'); input.removeAttribute('aria-invalid'); msg.textContent = '';
    return { ok: true, f: f, v: r.v };
  }

  /* ---------- Vertrieb ---------- */
  var VSTAT = { eingeladen: ['Eingeladen', 'c-grey'], angenommen: ['Einladung angenommen', 'c-info'], aktiv: ['Steuerservice aktiv', 'c-gold'], erledigt: ['Erledigt', 'c-ok'] };
  async function viewVertrieb() {
    laden();
    try {
      var rows = q(await sb.rpc('vertrieb_akten'));
      var org = S.orgs.filter(function (o) { return o.id === S.profil.organisation_id; })[0];
      mount('<div class="wrap stack"><div class="row" style="align-items:flex-end"><div class="stack-s"><span class="eyebrow">' + esc(org ? org.name : 'Vertrieb') + '</span><h1 class="title">Ihre Käufer</h1></div><span class="spacer"></span><a class="btn gold" href="#/vertrieb/neu">+ Käufer übergeben</a></div>' +
        (rows.length ? (function () {
          var an = rows.filter(function (a) { return a.status !== 'eingeladen'; }).length, fe = rows.filter(function (a) { return a.status === 'erledigt'; }).length;
          return '<div class="kpis"><div class="card kpi"><strong>' + rows.length + '</strong><span>übergeben</span></div><div class="card kpi"><strong>' + an + '</strong><span>angenommen · ' + Math.round(an / rows.length * 100) + ' %</span></div><div class="card kpi dark"><strong>' + fe + '</strong><span>erledigt</span></div></div>';
        })() : '') +
        (rows.length ? '<div class="card tw"><table><thead><tr><th>Akte</th><th>Käufer</th><th>Wohnung</th><th>Jahr</th><th>Unterlagen</th><th>Status</th></tr></thead><tbody>' +
          rows.map(function (a) { var s = VSTAT[a.status] || [a.status, 'c-grey']; return '<tr><td class="mono small">' + esc(a.nummer) + '</td><td><b>' + esc(a.kaeufer_name) + '</b><br><span class="tiny">' + esc(a.kaeufer_email) + '</span></td><td>' + esc(a.objekt_bezeichnung) + '</td><td class="num">' + a.vz + '</td><td class="num">' + a.dokumente + '</td><td><span class="chip ' + s[1] + '">' + s[0] + '</span></td></tr>'; }).join('') + '</tbody></table></div>' :
          '<div class="card empty"><div class="ill" aria-hidden="true"></div><h2 class="h2">Noch keine Käufer übergeben</h2><p class="muted" style="max-width:46ch">Am besten direkt nach dem Notartermin. Das dauert zwei Minuten, die Unterlagen haben Sie ja schon.</p><a class="btn" href="#/vertrieb/neu">Ersten Käufer übergeben</a></div>') +
        '<div class="note info"><span class="ic" aria-hidden="true">i</span><span><b>Datenwand</b>Sie sehen nur, ob Ihr Käufer die Einladung angenommen hat. Steuerdaten, Ergebnisse und die gewählte Kanzlei sehen Sie nicht. Den Status „Steuerservice aktiv“ sehen Sie nur, wenn Ihr Käufer zustimmt.</span></div></div>', 'Ihre Käufer');
    } catch (e) { fehler(e); }
  }
  var VNEU = { eingabe: {}, files: [] };
  function viewVertriebNeu() {
    VNEU = { eingabe: { erwerb: { afaMethode: 'linear' } }, files: [] };
    var jahr = new Date().getFullYear();
    var kauf = F.wohnung.filter(function (f) { return ['eingabe.objekt.adresse', 'eingabe.erwerb.afaMethode'].indexOf(f.p) < 0; });
    var mk = function (f) { var g = Object.assign({}, f, { req: f.req && /kaufpreis|uebergang|kaufvertrag/.test(f.p) ? 1 : 0, p: f.p }); return feldHtml(g, { eingabe: VNEU.eingabe }, null, 'v' + f.p.replace(/\W/g, '_')); };
    mount('<div class="wrap narrow stack"><a class="link small" href="#/vertrieb">← Ihre Käufer</a><div class="stack-s"><span class="eyebrow">Übergabe</span><h1 class="title">Käufer übergeben</h1><p class="lead">Was Sie hier eintragen, muss Ihr Käufer nicht mehr suchen. Alles außer Name, E-Mail und Wohnung ist freiwillig.</p></div>' +
      '<form class="stack" id="fUeb" novalidate>' +
      '<section class="card pad stack"><h2 class="h3">Käufer</h2><div class="grid2">' +
      '<div class="field"><label for="u_name">Name</label><div class="inp"><input id="u_name" required autocomplete="off"></div><span class="errmsg"></span></div>' +
      '<div class="field"><label for="u_mail">E-Mail</label><div class="inp"><input id="u_mail" type="email" inputmode="email" required autocomplete="off"></div><span class="errmsg"></span></div></div>' +
      '<div class="grid2"><div class="field"><label for="u_obj">Wohnung</label><div class="inp"><input id="u_obj" required placeholder="Leipzig, Musterstraße 12, WE 7"></div><span class="errmsg"></span></div>' +
      '<div class="field"><label for="u_vz">Steuerjahr</label><div class="inp"><select id="u_vz">' + [jahr - 1, jahr, jahr + 1].map(function (y) { return '<option' + (y === jahr ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></div></div></div></section>' +
      '<section class="card pad stack"><h2 class="h3">Kauf</h2>' + kauf.map(mk).join('') + feldHtml(Object.assign({}, F.wohnung[11]), { eingabe: VNEU.eingabe }, null, 'v_afa') + '</section>' +
      '<section class="card pad stack"><h2 class="h3">Miete und Finanzierung</h2><div class="grid2">' + [F.miete[0], F.miete[1], F.finanzierung[0], F.finanzierung[1]].map(function (f) { return feldHtml(Object.assign({}, f, { req: 0 }), { eingabe: VNEU.eingabe }, null, 'v' + f.p.replace(/\W/g, '_')); }).join('') + '</div>' + feldHtml(Object.assign({}, F.finanzierung[4], { req: 0 }), { eingabe: VNEU.eingabe }, null, 'v_gb') + '</section>' +
      '<section class="card pad stack"><h2 class="h3">Unterlagen</h2><p class="small muted">Kaufvertrag, Kaufpreisaufteilung, Mietvertrag, Darlehensvertrag. PDF, bis 20 MB je Datei.</p>' +
      '<div class="drop" id="drop"><p class="small"><b>Dateien hierher ziehen</b> oder <label class="link" style="cursor:pointer">auswählen<input type="file" class="sr" id="u_files" accept="application/pdf,image/*" multiple></label></p></div><ul class="docs" id="u_list"></ul></section>' +
      '<label class="check"><input type="checkbox" id="u_ok"> <span>Mein Käufer hat in die Weitergabe seiner Kaufunterlagen an Objektpilot eingewilligt.</span></label>' +
      '<div class="savebar"><div class="inner"><button class="btn" type="submit">Übergeben</button><a class="btn ghost" href="#/vertrieb">Abbrechen</a></div></div></form></div>', 'Käufer übergeben');
  }
  function vListe() {
    var ul = $('#u_list'); if (!ul) return;
    ul.innerHTML = VNEU.files.map(function (x, i) {
      return '<li><span class="ic" aria-hidden="true">' + esc((x.file.name.split('.').pop() || '').slice(0, 4).toUpperCase()) + '</span><span style="flex:1;min-width:0" class="small">' + esc(x.file.name) + '</span><div class="inp" style="width:220px"><select data-act="vTyp" data-i="' + i + '" aria-label="Art der Unterlage">' + DOKTYPEN.map(function (t) { return '<option value="' + t.k + '"' + (x.typ === t.k ? ' selected' : '') + '>' + t.t + '</option>'; }).join('') + '</select></div><button class="btn ghost sm" type="button" data-act="vEntf" data-i="' + i + '">Entfernen</button></li>';
    }).join('');
  }
  function rateTyp(n) { n = n.toLowerCase(); if (/kaufpreisauf|aufteilung/.test(n)) return 'kaufpreisaufteilung'; if (/kauf|notar.*vertrag|urkunde/.test(n)) return 'kaufvertrag'; if (/miet/.test(n)) return 'mietvertrag'; if (/darlehen|kredit|finanz/.test(n)) return 'darlehensvertrag'; if (/grundschuld/.test(n)) return 'notar_grundschuld'; if (/wirtschaftsplan|hausgeld/.test(n)) return 'wirtschaftsplan'; if (/zins/.test(n)) return 'zinsbescheinigung'; return 'sonstiges'; }
  function einladungText(name, mail) {
    var link = location.origin + location.pathname + '?mail=' + encodeURIComponent(mail);
    return 'Hallo ' + name.split(' ')[0] + ',\n\nherzlichen Glückwunsch zu Ihrer Wohnung. Damit die Steuerersparnis bei Ihnen ankommt, haben wir Ihre Kaufunterlagen an Objektpilot übergeben. Dort ist Ihre Anlage V schon zum großen Teil vorbereitet, eine Steuerkanzlei prüft sie und gibt sie frei.\n\nSo geht es los:\n1. Öffnen Sie ' + link + '\n2. Melden Sie sich mit dieser E-Mail-Adresse an, Sie bekommen einen Code.\n3. Prüfen und ergänzen Sie Ihre Angaben, das dauert etwa zehn Minuten.\n\nIhre Steuerdaten sehen nur Sie und die Kanzlei, die Sie wählen.\n\nViele Grüße';
  }

  /* ---------- Kanzlei ---------- */
  var KTAB = 'pruefen';
  async function viewKanzlei() {
    laden();
    try {
      var akten = q(await sb.from('akte').select('id,nummer,kaeufer_name,objekt_bezeichnung,vz,status,updated_at,akte_pruefung(pruefzeit_sek,freigabe_am)').order('updated_at', { ascending: true }));
      var gruppen = { pruefen: ['in_pruefung'], rueckfrage: ['rueckfrage'], sonderfall: ['sonderfall'], fertig: ['freigegeben', 'abgeschlossen'] };
      var zahl = function (g) { return akten.filter(function (a) { return gruppen[g].indexOf(a.status) >= 0; }).length; };
      var fertig = akten.filter(function (a) { return gruppen.fertig.indexOf(a.status) >= 0 && a.akte_pruefung && a.akte_pruefung.pruefzeit_sek; });
      var schnitt = fertig.length ? fertig.reduce(function (s, a) { return s + a.akte_pruefung.pruefzeit_sek; }, 0) / fertig.length : 0;
      var liste = akten.filter(function (a) { return gruppen[KTAB].indexOf(a.status) >= 0; });
      var org = S.orgs.filter(function (o) { return o.id === S.profil.organisation_id; })[0];
      mount('<div class="wrap stack"><div class="stack-s"><span class="eyebrow">' + esc(org ? org.name : 'Kanzlei') + '</span><h1 class="title">Fälle</h1></div>' +
        '<div class="kpis"><div class="card kpi dark"><strong>' + zahl('pruefen') + '</strong><span>warten auf Prüfung</span></div><div class="card kpi"><strong>' + zahl('rueckfrage') + '</strong><span>Rückfrage beim Käufer</span></div><div class="card kpi"><strong>' + zahl('fertig') + '</strong><span>freigegeben</span></div><div class="card kpi"><strong>' + (schnitt ? mmss(schnitt) : '0:00') + '</strong><span>Prüfzeit im Schnitt, Minuten</span></div></div>' +
        '<div class="card pad"><div class="tabs" role="tablist">' + [['pruefen', 'Zu prüfen'], ['rueckfrage', 'Rückfrage'], ['sonderfall', 'Sonderfälle'], ['fertig', 'Freigegeben']].map(function (t) { return '<button role="tab" type="button" data-act="ktab" data-v="' + t[0] + '" aria-selected="' + (KTAB === t[0]) + '">' + t[1] + ' <span class="muted">' + zahl(t[0]) + '</span></button>'; }).join('') + '</div>' +
        (liste.length ? '<div class="tw"><table><thead><tr><th>Akte</th><th>Käufer</th><th>Wohnung</th><th>Jahr</th><th>Seit</th><th class="r">Prüfzeit</th></tr></thead><tbody>' +
          liste.map(function (a) { return '<tr class="click" data-act="fallOeffnen" data-id="' + a.id + '" tabindex="0"><td class="mono small">' + esc(a.nummer) + '</td><td><b>' + esc(a.kaeufer_name) + '</b></td><td>' + esc(a.objekt_bezeichnung) + '</td><td class="num">' + a.vz + '</td><td class="small">' + dDE(a.updated_at) + '</td><td class="r mono small">' + (a.akte_pruefung && a.akte_pruefung.pruefzeit_sek ? mmss(a.akte_pruefung.pruefzeit_sek) : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' :
          '<div class="empty"><div class="ill" aria-hidden="true"></div><p class="muted">Hier ist gerade nichts.</p></div>') + (liste.length ? '<p class="tiny" style="margin-top:12px">Tastatur: <b class="mono">J</b> und <b class="mono">K</b> blättern, <b class="mono">Enter</b> öffnet den Fall.</p>' : '') + '</div></div>', 'Fälle');
    } catch (e) { fehler(e); }
  }
  var K = { quittiert: [] };
  async function viewFall(id) {
    laden();
    try {
      await akteLaden(id);
      K.quittiert = (A.pruefung && A.pruefung.quittiert) || [];
      fallRender();
      if (A.akte.status === 'in_pruefung') startTimer(id);
    } catch (e) { fehler(e); }
  }
  function fallRender() {
    var a = A.akte, sd = A.daten.stammdaten || {}, r = rechne(A.daten, a.vz, K.quittiert);
    var frei = a.status === 'freigegeben' || a.status === 'abgeschlossen';
    var res = frei && A.pruefung && A.pruefung.ergebnis ? A.pruefung.ergebnis : r;
    var editierbar = a.status === 'in_pruefung' || a.status === 'rueckfrage';
    var zeilen = res ? res.zeilen.filter(function (l) { return (l.art === 'E' || l.art === 'W') && l.betrag; }).map(function (l) {
      return '<tr><td class="zl">' + esc(l.zeile) + '</td><td>' + esc(l.feld) + '<div class="rw">' + esc(l.rechenweg || '') + '</div></td><td class="small muted">' + esc(l.quelle || '') + '</td><td class="r">' + (l.art === 'W' ? '−' : '') + nf0.format(l.betrag) + ' €</td></tr>';
    }).join('') + '<tr class="sum"><td class="zl">85</td><td>Einkünfte aus Vermietung</td><td></td><td class="r">' + nf0.format(res.summen.ueberschuss) + ' €</td></tr>' : '';
    var hinweise = res ? res.hinweise.filter(function (h) { return h.ampel !== 'ok' || true; }).map(function (h) {
      var q_ = K.quittiert.indexOf(h.id) >= 0;
      return '<div class="hint ' + h.ampel + '"><b>' + esc(h.titel) + '</b><span>' + esc(h.text) + '</span>' + (h.rechtsgrundlage ? '<span class="rg">' + esc(h.rechtsgrundlage) + '</span>' : '') +
        (h.ampel === 'rot' && editierbar ? '<label class="check" style="padding:4px 0 0"><input type="checkbox" data-act="quitt" data-id="' + h.id + '"' + (q_ ? ' checked' : '') + '> <span class="small">Geprüft, Freigabe trotzdem möglich</span></label>' : '') + '</div>';
    }).join('') : '<p class="small">Die Berechnung braucht noch Angaben.</p>';
    var korr = editierbar ? '<details class="card pad"><summary class="h3" style="cursor:pointer">Werte korrigieren</summary><form class="stack" id="fKorr" novalidate onsubmit="return false" style="margin-top:14px"><div class="grid2">' +
      ['eingabe.erwerb.gebaeudeanteil', 'eingabe.erwerb.afaMethode', 'eingabe.erwerb.kaufpreis', 'eingabe.erwerb.nebenkosten', 'eingabe.erwerb.fertigJahr', 'eingabe.erwerb.baubeginn', 'eingabe.miete.kaltMonat', 'eingabe.miete.umlagenMonat', 'eingabe.finanzierung.darlehen.0.zinsenLautBescheinigung', 'eingabe.finanzierung.geldbeschaffungskosten', 'eingabe.hausgeld.monat', 'eingabe.hausgeld.umlagefaehigMonat', 'eingabe.hausgeld.ruecklageMonat', 'eingabe.erwerb.ruecklageImKaufpreis'].map(function (p) { var f = Object.assign({}, feldDef(p)); delete f.h; return feldHtml(f, A.daten, null, 'k' + p.replace(/\W/g, '_')); }).join('') +
      '</div><p class="tiny" id="saved" aria-live="polite">Änderungen werden gespeichert und protokolliert.</p></form></details>' : '';
    var blockiert = res && res.freigabe && !res.freigabe.moeglich;
    mount('<div class="wrap stack"><a class="link small" href="#/kanzlei">← Alle Fälle</a>' +
      '<div class="row" style="align-items:flex-end"><div class="stack-s"><span class="eyebrow">' + esc(a.nummer) + ' · Anlage V ' + a.vz + '</span><h1 class="title">' + esc(a.kaeufer_name) + '</h1><span class="muted">' + esc(a.objekt_bezeichnung) + '</span></div><span class="spacer"></span>' + statusChip(a.status) + (a.status === 'in_pruefung' ? '<span class="timer" id="timer">Prüfzeit ' + mmss((A.pruefung && A.pruefung.pruefzeit_sek) || 0) + '</span>' : '') + '</div>' +
      '<div class="split"><div class="stack">' +
      '<section class="card pad stack"><h2 class="h3">Anlage V ' + a.vz + (frei ? ' · freigegeben' : ' · Entwurf') + '</h2><div class="tw"><table><thead><tr><th>Zeile</th><th>Position und Rechenweg</th><th>Quelle</th><th class="r">Betrag</th></tr></thead><tbody>' + zeilen + '</tbody></table></div>' +
      (res && res.freibetrag && res.freibetrag.freibetrag ? '<p class="small">Freibetrag ' + res.freibetrag.jahr + ': <b>' + eur(res.freibetrag.freibetrag) + '</b>' + (res.freibetrag.steuerwirkungMonat ? ', Wirkung rund ' + eur(res.freibetrag.steuerwirkungMonat) + ' im Monat' : '') + '</p>' : '') + '</section>' +
      korr +
      '<section class="card pad stack"><h2 class="h3">Steuerpflichtige Person</h2><dl class="grid2 small" style="margin:0">' +
      [['Name', [sd.vorname, sd.nachname].filter(Boolean).join(' ')], ['Geburtsdatum', dDE(sd.geburtsdatum)], ['Anschrift', [sd.strasse, [sd.plz, sd.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')], ['Steuer-ID', sd.steuerId], ['Finanzamt', sd.finanzamt], ['Steuernummer', sd.steuernummer]].map(function (x) { return '<div><dt class="muted">' + x[0] + '</dt><dd style="margin:0"' + (x[0] === 'Steuer-ID' ? ' class="mono"' : '') + '>' + esc(x[1] || 'nicht angegeben') + '</dd></div>'; }).join('') + '</dl>' +
      (A.mandat ? '<p class="tiny">Mandat vom ' + dDE(A.mandat.vereinbart_am) + ', Festpreis ' + eur2(A.mandat.verguetung_brutto) + ' brutto</p>' : '') + '</section>' +
      '</div><div class="stack">' +
      '<section class="card pad stack" aria-labelledby="hw"><h2 class="h3" id="hw">Hinweise der Prüfung</h2>' + hinweise + '</section>' +
      '<section class="card pad stack"><h2 class="h3">Unterlagen</h2>' + dokListe(A.docs, false) + '</section>' +
      '<section class="card pad stack"><h2 class="h3">Nachrichten</h2>' + (nachrichtenHtml(A.msgs, 'kanzlei') || '<p class="small muted">Noch keine Nachrichten.</p>') +
      (editierbar || a.status === 'sonderfall' ? '<form class="stack" id="fFrage"><div class="field"><label for="frage">' + (a.status === 'sonderfall' ? 'Nachricht oder Angebot an den Käufer' : 'Rückfrage an den Käufer') + '</label><textarea class="ta" id="frage" rows="3" required></textarea></div><button class="btn sec" type="submit"' + (a.status === 'rueckfrage' ? ' disabled' : '') + '>Senden</button></form>' : '') + '</section>' +
      (a.status === 'in_pruefung' ? '<div class="card pad stack"><button class="btn gold block" type="button" data-act="freigeben"' + (blockiert ? ' disabled' : '') + '>Anlage V freigeben</button>' + (blockiert ? '<p class="tiny">Erst alle roten Hinweise prüfen und abhaken.</p>' : '<p class="tiny">Der Käufer bekommt die Anlage V und die Zahlen für den Freibetrag. Ihre Freigabe wird mit Datum und Rechenstand gespeichert.</p>') + '</div>' : '') +
      (frei && A.pruefung ? '<div class="note ok"><span class="ic" aria-hidden="true">✓</span><span><b>Freigegeben am ' + dDE(A.pruefung.freigabe_am) + '</b>Prüfzeit ' + mmss(A.pruefung.pruefzeit_sek) + ' Minuten. Rechenkern ' + esc(A.pruefung.kern_version || '') + '.</span></div>' : '') +
      '</div></div></div>', a.kaeufer_name);
  }
  function startTimer(id) {
    stopTimer(); S.pruefAkte = id; S.pruefStart = Date.now();
    var basis = (A.pruefung && A.pruefung.pruefzeit_sek) || 0, gemeldet = 0;
    S.timer = setInterval(function () {
      if (document.hidden) return;
      var lauf = Math.round((Date.now() - S.pruefStart) / 1000);
      var el = $('#timer'); if (el) el.textContent = 'Prüfzeit ' + mmss(basis + lauf);
      if (lauf - gemeldet >= 30) { var d = lauf - gemeldet; gemeldet = lauf; sb.rpc('kanzlei_pruefzeit', { p_akte: id, p_sek: d }).then(function () { }); }
    }, 1000);
    S._timerRest = function () { var lauf = Math.round((Date.now() - S.pruefStart) / 1000); var d = lauf - gemeldet; gemeldet = lauf; if (d > 0) return sb.rpc('kanzlei_pruefzeit', { p_akte: id, p_sek: d }).then(function () { }); };
  }
  function stopTimer() { var p = null; if (S.timer) { clearInterval(S.timer); S.timer = null; if (S._timerRest) p = S._timerRest(); S._timerRest = null; } return Promise.resolve(p); }
  var korrSpeichern = debounce(async function () {
    var el = $('#saved'); if (el) el.textContent = 'Speichert …';
    try { q(await sb.from('akte_daten').update({ eingabe: A.daten.eingabe }).eq('akte_id', A.akte.id)); fallRender(); var e2 = $('#saved'); if (e2) e2.textContent = 'Gespeichert und neu gerechnet'; var d = $('details.card'); if (d) d.open = true; }
    catch (e) { fehler(e); }
  }, 700);

  /* ---------- Verwaltung ---------- */
  async function viewAdmin() {
    laden();
    try {
      var r = await Promise.all([sb.from('organisation').select('*').order('typ'), sb.from('team_einladung').select('*').order('created_at', { ascending: false }), sb.rpc('admin_uebersicht'), sb.from('profil').select('email,name,rolle,organisation_id').neq('rolle', 'kaeufer')]);
      var orgs = q(r[0]), einl = q(r[1]), ueb = q(r[2]) || [], team = q(r[3]) || [];
      S.orgs = orgs;
      var oname = function (id) { var o = orgs.filter(function (x) { return x.id === id; })[0]; return o ? o.name : '–'; };
      var akten = ueb.filter(function (u) { return u.status; }).reduce(function (s, u) { return s + u.anzahl; }, 0);
      var em = String(S.profil.email || ''), at = em.indexOf('@'), alias = function (r) { return at > 0 ? em.slice(0, at).split('+')[0] + '+' + r + em.slice(at) : r; };
      var rollen = [['kaeufer', 'Kapitalanleger', 'Wohnung anlegen, Daten eintragen, Netto-Plus sehen, Kanzlei beauftragen.'], ['vertrieb', 'Vertrieb', 'Käufer übergeben und sehen, wer die Einladung angenommen hat.'], ['kanzlei', 'Kanzlei', 'Fälle prüfen, Rückfragen stellen, Anlage V freigeben.']];
      var probe = '<section class="hero"><span class="eyebrow">Ansichten ausprobieren</span><h2 class="h2" style="color:#fff">So sieht es für Ihre Kunden aus</h2>' +
        '<p class="small">Öffnen Sie ein privates Browserfenster und melden Sie sich mit einer dieser Adressen an. Die Codes landen in Ihrem normalen Postfach. Vertrieb und Kanzlei fragen beim ersten Mal nach der Authenticator-App.</p>' +
        '<div class="grid3">' + rollen.map(function (r) { return '<div class="stack-s" style="background:#222;border-radius:16px;padding:16px"><b style="color:var(--y)">' + r[1] + '</b><span class="small">' + r[2] + '</span><code class="mono tiny" style="color:#fff;word-break:break-all">' + esc(alias(r[0])) + '</code><button class="btn sm" type="button" data-act="aliasKopieren" data-v="' + esc(alias(r[0])) + '">Adresse kopieren</button></div>'; }).join('') + '</div>' +
        '<p class="tiny">Vertrieb- und Kanzlei-Adressen funktionieren nur, wenn sie unten im Team eingeladen sind. Jede neue Adresse ist sonst automatisch Kapitalanleger.</p></section>';
      mount('<div class="wrap stack"><div class="stack-s"><span class="eyebrow">Betrieb</span><h1 class="title">Verwaltung</h1><p class="muted">Hier legen Sie Vertriebe und Kanzleien an und laden Mitarbeiter ein. Steuerdaten sind hier nicht sichtbar.</p></div>' + probe +
        '<div class="kpis"><div class="card kpi"><strong>' + orgs.filter(function (o) { return o.typ === 'vertrieb'; }).length + '</strong><span>Vertriebe</span></div><div class="card kpi"><strong>' + orgs.filter(function (o) { return o.typ === 'kanzlei'; }).length + '</strong><span>Kanzleien</span></div><div class="card kpi"><strong>' + team.length + '</strong><span>Teammitglieder</span></div></div>' +
        '<div class="split"><section class="card pad stack"><h2 class="h3">Organisationen</h2><div class="tw"><table><thead><tr><th>Name</th><th>Typ</th><th>Ort</th></tr></thead><tbody>' + orgs.map(function (o) { return '<tr><td><b>' + esc(o.name) + '</b></td><td>' + esc(o.typ) + '</td><td class="small">' + esc(o.anschrift || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<form class="stack" id="fOrg"><h3 class="h3">Neue Organisation</h3><div class="grid2"><div class="field"><label for="o_name">Name</label><div class="inp"><input id="o_name" required></div></div><div class="field"><label for="o_typ">Typ</label><div class="inp"><select id="o_typ"><option value="vertrieb">Vertrieb</option><option value="kanzlei">Kanzlei</option><option value="hausverwaltung">Hausverwaltung</option></select></div></div></div><div class="field"><label for="o_ort">Anschrift oder Ort</label><div class="inp"><input id="o_ort"></div></div><button class="btn sec" type="submit">Anlegen</button></form></section>' +
        '<section class="card pad stack"><h2 class="h3">Team</h2><ul class="docs">' + team.map(function (t) { return '<li><span style="flex:1"><b class="small">' + esc(t.name || t.email) + '</b><br><span class="tiny">' + esc(t.email) + ' · ' + esc(t.rolle) + ' · ' + esc(oname(t.organisation_id)) + '</span></span><span class="chip c-ok">aktiv</span></li>'; }).join('') +
        einl.filter(function (e) { return !team.some(function (t) { return String(t.email).toLowerCase() === String(e.email).toLowerCase(); }); }).map(function (e) { return '<li><span style="flex:1"><b class="small">' + esc(e.name || e.email) + '</b><br><span class="tiny">' + esc(e.email) + ' · ' + esc(e.rolle) + ' · ' + esc(oname(e.organisation_id)) + '</span></span><span class="chip c-grey">eingeladen</span></li>'; }).join('') + '</ul>' +
        '<form class="stack" id="fTeam"><h3 class="h3">Mitarbeiter einladen</h3><p class="tiny">Die Person meldet sich danach einfach mit dieser E-Mail an und bekommt automatisch die Rolle.</p><div class="grid2"><div class="field"><label for="t_mail">E-Mail</label><div class="inp"><input id="t_mail" type="email" required></div></div><div class="field"><label for="t_name">Name</label><div class="inp"><input id="t_name"></div></div><div class="field"><label for="t_rolle">Rolle</label><div class="inp"><select id="t_rolle"><option value="vertrieb">Vertrieb</option><option value="kanzlei">Kanzlei</option><option value="hausverwaltung">Hausverwaltung</option><option value="admin">Verwaltung</option></select></div></div><div class="field"><label for="t_org">Organisation</label><div class="inp"><select id="t_org">' + orgs.map(function (o) { return '<option value="' + o.id + '">' + esc(o.name) + '</option>'; }).join('') + '</select></div></div></div><button class="btn sec" type="submit">Einladen</button></form></section></div></div>', 'Verwaltung');
    } catch (e) { fehler(e); }
  }
  function viewKonto() {
    mount('<div class="wrap narrow"><div class="card pad-l stack"><h1 class="h2">Ihr Konto</h1><p class="small">' + esc(S.profil.email) + '</p><button class="btn sec" data-act="abmelden">Abmelden</button></div></div>', 'Konto');
  }

  /* ---------- Hochladen ---------- */
  function dateiname(n) { return n.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80); }
  async function hochladen(files, typ, quelle, akteId) {
    var st = $('#uplStatus'); var ok = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.size > 20 * 1024 * 1024) { toast(f.name + ' ist größer als 20 MB.', true); continue; }
      if (st) st.textContent = 'Lädt ' + f.name + ' hoch …';
      var pfad = akteId + '/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '' + i) + '-' + dateiname(f.name);
      var up = await sb.storage.from('unterlagen').upload(pfad, f, { contentType: f.type || 'application/octet-stream', upsert: false });
      if (up.error) { fehler(up.error); continue; }
      var ins = await sb.from('dokument').insert({ akte_id: akteId, typ: typ, dateiname: f.name, pfad: pfad, groesse: f.size, quelle: quelle });
      if (ins.error) { await sb.storage.from('unterlagen').remove([pfad]); fehler(ins.error); continue; }
      ok++;
    }
    if (st) st.textContent = ok ? ok + (ok === 1 ? ' Datei hochgeladen' : ' Dateien hochgeladen') : '';
    return ok;
  }

  /* ---------- Ereignisse ---------- */
  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
    var act = b.dataset.act;
    try {
      if (act === 'fWeiter') { fokusWeiter(); return; }
      if (act === 'fZurueck') { if (FK && FK.i > 0) { FK.i--; fokusZeigen(true); } return; }
      if (act === 'fAlle') { viewAbschnitt._alle = true; route(); return; }
      if (act === 'aliasKopieren') { try { await navigator.clipboard.writeText(b.dataset.v); toast('Kopiert: ' + b.dataset.v); } catch (x) { toast(b.dataset.v); } return; }
      if (act === 'abmelden') { stopTimer(); await sb.auth.signOut(); A = { akte: null, daten: null, docs: [], msgs: [], pruefung: null, mandat: null }; location.hash = '#/'; boot(); return; }
      if (act === 'andereMail') { $('#authBox').innerHTML = authSchritt1(''); $('#mail').focus(); return; }
      if (act === 'neuerCode') { var m = sessionStorageGet('op_mail'); await codeSenden(m); toast('Neuer Code ist unterwegs.'); countdown(); return; }
      if (act === 'fc') {
        A.daten.fallcheck = A.daten.fallcheck || {}; A.daten.fallcheck[b.dataset.k] = b.dataset.v;
        var c = A.daten.fallcheck; c.sonderfall = !!sonderfall(c);
        set(A.daten, 'eingabe.objekt.nutzung', c.nutzung === 'fewo' ? 'fewo' : 'dauer');
        set(A.daten, 'eingabe.objekt.anAngehoerige', c.nutzung === 'ang');
        set(A.daten, 'eingabe.objekt.denkmal', c.art === 'denkmal');
        var vorher = FK ? FK.i : 0;
        $('#fAbs').innerHTML = fallcheckHtml(); $$('.fsegs').forEach(function (x) { x.remove(); });
        fokusInit('fallcheck', true);
        if (FK) { FK.i = vorher; fokusZeigen(false); var nb = $('[data-k="' + b.dataset.k + '"][data-v="' + b.dataset.v + '"]'); if (nb) nb.focus(); setTimeout(function () { if (FK && FK.i === vorher && FK.i < FK.steps.length - 1) { FK.i++; fokusZeigen(true); } }, 280); }
        speichern(); return;
      }
      if (act === 'absWeiter') {
        var k = b.dataset.k, fehl = [];
        $$('#fAbs [data-p]').forEach(function (inp) { var r = pruefeFeld(inp, true); if (!r.ok) fehl.push(r.f); });
        if (k === 'fallcheck') { var cc = A.daten.fallcheck || {}; if (!(cc.nutzung && cc.wohnungen && cc.art && cc.angestellt)) { toast('Bitte beantworten Sie alle vier Fragen.', true); return; } }
        if (k === 'unterlagen') { var fehlt = DOKTYPEN.filter(function (t) { return t.req && !A.docs.some(function (d) { return d.typ === t.k; }); }); if (fehlt.length && !b.dataset.trotzdem) { b.dataset.trotzdem = '1'; toast('Es fehlen noch: ' + fehlt.map(function (t) { return t.t; }).join(', ') + '. Nochmal tippen, um trotzdem weiterzugehen.', true); return; } }
        if (fehl.length) {
          $('#errsum').innerHTML = '<div class="note bad" role="alert" tabindex="-1" id="errbox"><span class="ic" aria-hidden="true">!</span><span><b>Bitte prüfen Sie ' + (fehl.length === 1 ? 'ein Feld' : fehl.length + ' Felder') + '</b>' + fehl.map(function (f) { return '<a href="#f_' + f.p.replace(/\W/g, '_') + '" class="link" style="display:block">' + esc(f.l) + '</a>'; }).join('') + '</span></div>';
          $('#errbox').focus(); return;
        }
        A.daten.erledigt = A.daten.erledigt || {}; A.daten.erledigt[k] = true;
        q(await sb.from('akte_daten').update({ eingabe: A.daten.eingabe, stammdaten: A.daten.stammdaten, fallcheck: A.daten.fallcheck, erledigt: A.daten.erledigt }).eq('akte_id', A.akte.id));
        var i = ABS.findIndex(function (x) { return x.k === k; });
        var naechste = ABS.slice(i + 1).filter(function (x) { return !absFertig(x.k); })[0];
        if (A.akte.status === 'rueckfrage') { location.hash = '#/akte/' + A.akte.id; return; }
        location.hash = '#/akte/' + A.akte.id + (naechste && (naechste.k !== 'auftrag' || fortschritt() >= 7) ? '/' + naechste.k : '');
        return;
      }
      if (act === 'wahl') { A.daten._wahl = b.dataset.v; $('#fAbs').innerHTML = auftragHtml(); var nb2 = $('[data-act="wahl"][data-v="' + b.dataset.v + '"]'); if (nb2) nb2.focus(); return; }
      if (act === 'beauftragen') {
        if (!$('#c1').checked || !$('#c2').checked) { toast('Bitte bestätigen Sie den Auftrag und die Datenschutzhinweise.', true); return; }
        b.disabled = true; b.textContent = 'Wird gesendet …';
        var w = A.daten._wahl;
        var st = q(await sb.rpc('kaeufer_beauftragen', { p_akte: A.akte.id, p_wahl: w === 'eigen' ? 'eigen' : 'kanzlei', p_kanzlei: w === 'eigen' ? null : w, p_status_an_vertrieb: !!($('#c3') && $('#c3').checked), p_text_version: C.textVersionMandat }));
        toast(st === 'eigener_stb' ? 'Ihr Datenpaket ist bereit.' : st === 'sonderfall' ? 'Anfrage an die Kanzlei gesendet.' : 'Auftrag erteilt. Die Kanzlei prüft jetzt.');
        A.akte = null; location.hash = '#/akte/' + A.daten.akte_id; return;
      }
      if (act === 'dokOeffnen') { var w2 = window.open('', '_blank'); var s = q(await sb.storage.from('unterlagen').createSignedUrl(b.dataset.pfad, 120)); if (w2) w2.location = s.signedUrl; else location.href = s.signedUrl; return; }
      if (act === 'dokLoeschen') {
        if (b.dataset.sicher !== '1') { b.dataset.sicher = '1'; b.textContent = 'Wirklich löschen?'; return; }
        q(await sb.from('dokument').delete().eq('id', b.dataset.id)); await sb.storage.from('unterlagen').remove([b.dataset.pfad]); toast('Gelöscht'); viewAbschnitt(A.akte.id, 'unterlagen'); return;
      }
      if (act === 'drucken') { window.print(); if (A.akte && A.akte.status === 'freigegeben') sb.rpc('kaeufer_abschliessen', { p_akte: A.akte.id }).then(function () { }); return; }
      if (act === 'ktab') { KTAB = b.dataset.v; viewKanzlei(); return; }
      if (act === 'fallOeffnen') { location.hash = '#/kanzlei/' + b.dataset.id; return; }
      if (act === 'freigeben') {
        var r = rechne(A.daten, A.akte.vz, K.quittiert);
        if (!r || !r.freigabe.moeglich) { toast('Erst alle roten Hinweise prüfen.', true); return; }
        b.disabled = true; b.textContent = 'Wird freigegeben …';
        await stopTimer();
        q(await sb.rpc('kanzlei_freigeben', { p_akte: A.akte.id, p_ergebnis: JSON.parse(JSON.stringify(r)), p_kern_version: Kern.version, p_quittiert: K.quittiert }));
        toast('Freigegeben. Der Käufer sieht jetzt seine Anlage V.'); viewFall(A.akte.id); return;
      }
      if (act === 'vEntf') { VNEU.files.splice(+b.dataset.i, 1); vListe(); return; }
    } catch (err) { fehler(err); b.disabled = false; }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.matches('tr.click')) e.target.click(); });
  document.addEventListener('keydown', function (e) {
    if (FK && e.key === 'Enter' && e.target.matches('#fAbs input')) { e.preventDefault(); fokusWeiter(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var rows = $$('tr.click'); if (!rows.length) return;
    var i = rows.indexOf(document.activeElement);
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); rows[Math.min(rows.length - 1, i + 1)].focus(); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); rows[Math.max(0, i - 1)].focus(); }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.matches('#fAbs [data-p], #fKorr [data-p]')) {
      var r = pruefeFeld(t, false);
      if (r.ok) { set(A.daten, t.dataset.p, r.v); if (t.closest('#fKorr')) korrSpeichern(); else speichern(); }
    }
    if (t.matches('#fUeb [data-p]')) { var r2 = pruefeFeld(t, false); if (r2.ok) set(VNEU, t.dataset.p, r2.v); }
  });
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (!(t.matches && t.matches('[data-p]'))) return;
    var leer = !String(t.value || '').trim();
    var r = pruefeFeld(t, !leer);
    if (r.ok && r.v != null && ['eur', 'pct', 'num'].indexOf(t.dataset.t) >= 0) t.value = anzeige(r.f, r.v);
  });
  document.addEventListener('change', async function (e) {
    var t = e.target;
    try {
      if (t.matches('select[data-p]')) { var r = pruefeFeld(t, false); if (t.closest('#fUeb')) set(VNEU, t.dataset.p, r.v); else { set(A.daten, t.dataset.p, r.v); if (t.closest('#fKorr')) korrSpeichern(); else speichern(); } }
      if (t.matches('[data-act="upload"]')) { var n = await hochladen(t.files, t.dataset.typ, 'kaeufer', A.akte.id); t.value = ''; if (n) { toast(n === 1 ? 'Datei hochgeladen' : n + ' Dateien hochgeladen'); viewAbschnitt(A.akte.id, 'unterlagen'); } }
      if (t.id === 'u_files') { Array.prototype.forEach.call(t.files, function (f) { VNEU.files.push({ file: f, typ: rateTyp(f.name) }); }); t.value = ''; vListe(); }
      if (t.matches('[data-act="vTyp"]')) VNEU.files[+t.dataset.i].typ = t.value;
      if (t.matches('[data-act="quitt"]')) {
        var id = t.dataset.id; K.quittiert = K.quittiert.filter(function (x) { return x !== id; }); if (t.checked) K.quittiert.push(id);
        await sb.rpc('kanzlei_quittieren', { p_akte: A.akte.id, p_quittiert: K.quittiert }); fallRender();
      }
    } catch (err) { fehler(err); }
  });
  ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, async function (e) {
      var d = e.target.closest && e.target.closest('#drop'); if (!d) return;
      e.preventDefault();
      if (ev === 'dragover') d.classList.add('over');
      if (ev === 'dragleave') d.classList.remove('over');
      if (ev === 'drop') {
        d.classList.remove('over');
        if ($('#fUeb')) { Array.prototype.forEach.call(e.dataTransfer.files, function (f) { VNEU.files.push({ file: f, typ: rateTyp(f.name) }); }); vListe(); return; }
        var n = await hochladen(e.dataTransfer.files, 'sonstiges', 'kaeufer', A.akte.id); if (n) viewAbschnitt(A.akte.id, 'unterlagen');
      }
    });
  });

  document.addEventListener('submit', async function (e) {
    var f = e.target; e.preventDefault();
    try {
      if (f.id === 'fMail') {
        var mail = $('#mail').value.trim(), em = $('#mail_e');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { em.textContent = 'Bitte eine gültige E-Mail-Adresse eingeben.'; $('#mail').setAttribute('aria-invalid', 'true'); $('#mail').focus(); return; }
        var btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Wird gesendet …';
        try { await codeSenden(mail); } catch (err) { btn.disabled = false; btn.textContent = 'Code anfordern'; throw err; }
        $('#authBox').innerHTML = authSchritt2(mail); $('#code').focus(); countdown(); return;
      }
      if (f.id === 'fCode') {
        var code = $('#code').value.replace(/\s/g, '');
        if (!/^\d{6,8}$/.test(code)) { $('#code_e').textContent = 'Der Code besteht aus Ziffern.'; return; }
        var r = await sb.auth.verifyOtp({ email: sessionStorageGet('op_mail'), token: code, type: 'email' });
        if (r.error) { $('#code_e').textContent = menschlich(r.error.message); $('#code').focus(); return; }
        return;
      }
      if (f.id === 'fMfaNeu' || f.id === 'fMfa') {
        var c = $('#mfa').value.replace(/\s/g, ''), fid = f.dataset.factor;
        if (!fid) { var l = q(await sb.auth.mfa.listFactors()); fid = (l.totp[0] || {}).id; }
        var v = await sb.auth.mfa.challengeAndVerify({ factorId: fid, code: c });
        if (v.error) { $('#mfa_e').textContent = 'Der Code passt nicht. Bitte den aktuellen Code aus der App eingeben.'; return; }
        toast('Bestätigt'); boot(); return;
      }
      if (f.id === 'fNeuAkte') {
        var obj = $('#n_obj').value.trim();
        if (!obj) { $('#n_obj_e').textContent = 'Bitte geben Sie Ort, Straße und Wohnungsnummer an.'; $('#n_obj').focus(); return; }
        var nid = q(await sb.rpc('kaeufer_akte_anlegen', { p_objekt: obj, p_vz: parseInt($('#n_vz').value, 10) }));
        toast('Wohnung angelegt'); location.hash = '#/akte/' + nid; return;
      }
      if (f.id === 'fAntwort') { var t = $('#antwort').value.trim(); if (!t) return; q(await sb.rpc('kaeufer_antworten', { p_akte: A.akte.id, p_text: t })); toast('Antwort gesendet'); viewAkte(A.akte.id); return; }
      if (f.id === 'fFrage') { var t2 = $('#frage').value.trim(); if (!t2) return; await stopTimer(); q(await sb.rpc('kanzlei_rueckfrage', { p_akte: A.akte.id, p_text: t2 })); toast('Nachricht an den Käufer gesendet'); viewFall(A.akte.id); return; }
      if (f.id === 'fUeb') {
        var name = $('#u_name').value.trim(), mail2 = $('#u_mail').value.trim(), obj = $('#u_obj').value.trim(), fehl = [];
        if (!name) fehl.push('Name'); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail2)) fehl.push('E-Mail'); if (!obj) fehl.push('Wohnung');
        if (!$('#u_ok').checked) fehl.push('Einwilligung des Käufers');
        if (fehl.length) { toast('Bitte prüfen: ' + fehl.join(', '), true); return; }
        var sbtn = f.querySelector('button[type="submit"]'); sbtn.disabled = true; sbtn.textContent = 'Wird übergeben …';
        var ein = clone(VNEU.eingabe); set(ein, 'objekt.adresse', obj);
        var id = q(await sb.rpc('uebergabe_anlegen', { p_name: name, p_email: mail2, p_objekt: obj, p_vz: +$('#u_vz').value, p_eingabe: ein }));
        for (var i = 0; i < VNEU.files.length; i++) await hochladen([VNEU.files[i].file], VNEU.files[i].typ, 'vertrieb', id);
        var txt = einladungText(name, mail2);
        mount('<div class="wrap narrow stack"><div class="note ok"><span class="ic" aria-hidden="true">✓</span><span><b>' + esc(name) + ' ist übergeben</b>Jetzt nur noch die Einladung schicken. Am besten von Ihrer eigenen Adresse, Ihr Käufer kennt Sie.</span></div>' +
          '<h1 class="h2">Einladung an ' + esc(name) + '</h1><textarea class="ta" id="einl" rows="14" readonly>' + esc(txt) + '</textarea>' +
          '<div class="row"><button class="btn" type="button" id="kopieren">Text kopieren</button><a class="btn sec" href="mailto:' + encodeURIComponent(mail2) + '?subject=' + encodeURIComponent('Ihre Anlage V zur neuen Wohnung') + '&body=' + encodeURIComponent(txt) + '">Im Mailprogramm öffnen</a><a class="btn ghost" href="#/vertrieb">Zur Übersicht</a></div></div>', 'Einladung');
        $('#kopieren').onclick = function () { var ta = $('#einl'); (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).then(function () { toast('Kopiert'); }, function () { ta.select(); document.execCommand('copy'); toast('Kopiert'); }); };
        return;
      }
      if (f.id === 'fOrg') { q(await sb.from('organisation').insert({ name: $('#o_name').value.trim(), typ: $('#o_typ').value, anschrift: $('#o_ort').value.trim() || null })); toast('Angelegt'); viewAdmin(); return; }
      if (f.id === 'fTeam') { q(await sb.from('team_einladung').upsert({ email: $('#t_mail').value.trim().toLowerCase(), name: $('#t_name').value.trim() || null, rolle: $('#t_rolle').value, organisation_id: $('#t_org').value })); toast('Eingeladen. Die Person meldet sich einfach mit ihrer E-Mail an.'); viewAdmin(); return; }
    } catch (err) { fehler(err); var b = f.querySelector('button[type="submit"],button:not([type])'); if (b) b.disabled = false; }
  });

  window.addEventListener('hashchange', function () { if (S.session && S.profil) route(); });
  window.addEventListener('beforeunload', function () { if (S._timerRest) S._timerRest(); });
  sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') { if (ev === 'SIGNED_IN' && S.session) return; setTimeout(boot, 0); } });
  if (location.search.indexOf('code=') >= 0 || location.search.indexOf('error') >= 0) {
    setTimeout(function () { history.replaceState(null, '', location.pathname + (location.hash || '#/')); }, 1500);
  }
  boot();
})();
