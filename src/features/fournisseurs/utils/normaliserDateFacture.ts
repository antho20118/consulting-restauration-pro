// Normalise une date de facture lue automatiquement (extraction IA ou repli OCR local) vers le
// format ISO (AAAA-MM-JJ) attendu par <input type="date"> côté client et fiable pour `new Date(...)`
// côté serveur (server/routes/listingsFournisseur.ts) — contrairement à une chaîne "JJ/MM/AAAA"
// brute que Date ne parse pas de façon fiable. L'extraction IA (importFacturePhotoIA.ts) rapporte
// volontairement la date telle qu'écrite sur le document (ex. "15/03/2026"), sans la convertir :
// cette conversion est donc faite ici, au moment de l'affichage, jamais dans l'extraction elle-même.
// Ne devine jamais une date non reconnue : renvoie null plutôt que d'inventer.
export function normaliserDateFacture(brute: string | null): string | null {
  if (!brute) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(brute.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const francaise = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(brute.trim());
  if (francaise) return `${francaise[3]}-${francaise[2]}-${francaise[1]}`;

  return null;
}
