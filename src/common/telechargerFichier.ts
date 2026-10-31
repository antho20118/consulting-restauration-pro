// Livre au navigateur un fichier construit en mémoire (Blob), comme un vrai téléchargement plutôt
// qu'un affichage : seul moyen pour un contenu obtenu par un appel authentifié (apiFetch) ou fabriqué
// localement — jamais un lien direct vers l'API, qui échouerait sans jeton.
export function telechargerFichier(nom: string, contenu: Blob): void {
  const url = URL.createObjectURL(contenu);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = nom;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  URL.revokeObjectURL(url);
}
