// GET /api/health
// Quick check that the server functions are deployed and reachable.
// Open https://YOUR-SITE.vercel.app/api/health in a browser — it must return {"ok":true}.
// If it returns a 404 page instead, the API is not running (wrong host / static-only deploy).
export default function handler(req, res) {
  res.status(200).json({ ok: true, app: 'Spicy Link Generator', api: 'v1' });
}
