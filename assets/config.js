// Öffentliche Verbindungsdaten. Der Schlüssel ist für den Browser bestimmt, der Schutz liegt in den Datenbankregeln (RLS).
window.OP_CONFIG = {
  supabaseUrl: 'https://thmsfwjucjvqvdmzoaua.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRobXNmd2p1Y2p2cXZkbXpvYXVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3MzAzMTQsImV4cCI6MjExMDMwNjMxNH0.0dlXfbZBfshGb34htkIJzMaMMq4ojMt0HpgN0eMi_lk',
  kontakt: 's.ruppert@stratvell.net',
  // Ansprechpartner für Vertriebe im Pilotprogramm (Karte in „Ihre Käufer“)
  ansprechpartner: { name: 'Florian Mack', titel: 'Steuerberater', firma: 'Mack GmbH Steuerberatungsgesellschaft, Fulda', mail: 'fm@mack-steuerberater.de', bild: 'assets/team/florian-mack.jpg' },
  textVersionMandat: 'mandat-anlagev-2026-11',
  // Google Maps (3D-Luftbild der Wohnung). Leer = Funktion aus. Schlüssel in der Google Cloud auf
  // app.stratvell.net beschränken. Geladen wird erst, wenn der Nutzer das Luftbild einschaltet.
  googleMapsKey: 'AIzaSyDAIeI9e2jB8f2KcHmwcnGrXH0QrVXMYWk'
};
