const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22+, no native build needed

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const db = new DatabaseSync(path.join(__dirname, 'blood.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS donors(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, bg TEXT NOT NULL, city TEXT NOT NULL, phone TEXT NOT NULL, available INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY AUTOINCREMENT, patient TEXT NOT NULL, bg TEXT NOT NULL, units INTEGER NOT NULL, hospital TEXT NOT NULL, city TEXT NOT NULL, urgency TEXT NOT NULL, contact TEXT NOT NULL, status TEXT DEFAULT 'Open', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS responses(id INTEGER PRIMARY KEY AUTOINCREMENT, rid INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, rid INTEGER NOT NULL, did INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.redirect('/#/admin'));

const clean = (v, n = 100) => String(v ?? '').trim().slice(0, n);
const phoneOk = p => /^[0-9+ -]{7,20}$/.test(p);
const tokens = new Set();
const auth = (req, res, next) => tokens.has(req.headers['x-token']) ? next() : res.status(401).json({ error: 'Unauthorized' });
const bad = (res, msg = 'Please fill all fields correctly.') => res.status(400).json({ error: msg });

/* ---------- Public API (no patient names or contacts exposed) ---------- */
app.get('/api/public', (req, res) => {
  res.json({
    reqs: db.prepare("SELECT id, bg, units, hospital, city, urgency, created_at FROM requests WHERE status='Open' ORDER BY id DESC").all(),
    donors: db.prepare('SELECT bg FROM donors').all(),
    fulfilled: db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status='Fulfilled'").get().n
  });
});

app.post('/api/requests', (req, res) => {
  const b = req.body || {};
  const r = { patient: clean(b.patient), bg: clean(b.bg, 4), units: parseInt(b.units, 10), hospital: clean(b.hospital),
    city: clean(b.city), urgency: clean(b.urgency, 10), contact: clean(b.contact, 20) };
  if (!r.patient || !r.hospital || !r.city || !GROUPS.includes(r.bg) || !(r.units >= 1 && r.units <= 20) ||
      !['Critical', 'Urgent', 'Normal'].includes(r.urgency) || !phoneOk(r.contact)) return bad(res);
  const info = db.prepare('INSERT INTO requests(patient,bg,units,hospital,city,urgency,contact) VALUES(?,?,?,?,?,?,?)')
    .run(r.patient, r.bg, r.units, r.hospital, r.city, r.urgency, r.contact);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.post('/api/donors', (req, res) => {
  const b = req.body || {};
  const d = { name: clean(b.name), bg: clean(b.bg, 4), city: clean(b.city), phone: clean(b.phone, 20) };
  if (!d.name || !d.city || !GROUPS.includes(d.bg) || !phoneOk(d.phone)) return bad(res);
  db.prepare('INSERT INTO donors(name,bg,city,phone) VALUES(?,?,?,?)').run(d.name, d.bg, d.city, d.phone);
  res.json({ ok: true });
});

app.post('/api/requests/:id/respond', (req, res) => {
  const name = clean(req.body?.name), phone = clean(req.body?.phone, 20);
  const r = db.prepare("SELECT id FROM requests WHERE id=? AND status='Open'").get(req.params.id);
  if (!r || !name || !phoneOk(phone)) return bad(res, 'Invalid response.');
  db.prepare('INSERT INTO responses(rid,name,phone) VALUES(?,?,?)').run(r.id, name, phone);
  res.json({ ok: true });
});

/* ---------- Admin API ---------- */
app.post('/api/admin/login', (req, res) => {
  if (req.body?.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Wrong password' });
  const t = crypto.randomBytes(24).toString('hex'); tokens.add(t); res.json({ token: t });
});

app.get('/api/admin/all', auth, (req, res) => {
  res.json({
    requests: db.prepare('SELECT * FROM requests ORDER BY id ASC').all(),
    donors: db.prepare('SELECT * FROM donors ORDER BY id ASC').all().map(d => ({ ...d, available: !!d.available })),
    responses: db.prepare('SELECT * FROM responses ORDER BY id ASC').all(),
    notes: db.prepare('SELECT * FROM notifications').all()
  });
});

app.patch('/api/admin/requests/:id', auth, (req, res) => {
  if (!['Open', 'Fulfilled', 'Cancelled'].includes(req.body?.status)) return bad(res, 'Bad status');
  db.prepare('UPDATE requests SET status=? WHERE id=?').run(req.body.status, req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/requests/:id/notify', auth, (req, res) => {
  const ids = (req.body?.donor_ids || []).map(Number).filter(Boolean);
  const get = db.prepare('SELECT name, phone FROM donors WHERE id=?');
  const ins = db.prepare('INSERT INTO notifications(rid,did) VALUES(?,?)');
  let n = 0;
  ids.forEach(id => {
    const d = get.get(id); if (!d) return;
    ins.run(req.params.id, id); n++;
    // Hook your SMS / WhatsApp / email provider here.
    console.log(`[NOTIFY] request #${req.params.id} -> ${d.name} (${d.phone})`);
  });
  res.json({ notified: n });
});

app.patch('/api/admin/donors/:id', auth, (req, res) => {
  db.prepare('UPDATE donors SET available=? WHERE id=?').run(req.body?.available ? 1 : 0, req.params.id); res.json({ ok: true });
});
app.delete('/api/admin/donors/:id', auth, (req, res) => {
  db.prepare('DELETE FROM donors WHERE id=?').run(req.params.id); res.json({ ok: true });
});

app.listen(PORT, () => console.log(`LifeLink running at http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin`));
