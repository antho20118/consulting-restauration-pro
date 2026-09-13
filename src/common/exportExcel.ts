type Feuille = {
  nom: string;
  lignes: Record<string, string | number>[];
};

// Génère un classeur .xlsx (une feuille par entrée de `feuilles`) et déclenche son téléchargement.
// xlsx est une grosse dépendance : on la charge à la demande plutôt que dans le bundle principal.
export async function exporterExcel(nomFichier: string, feuilles: Feuille[]) {
  const XLSX = await import("xlsx");

  const classeur = XLSX.utils.book_new();

  for (const feuille of feuilles) {
    const feuilleCalcul = XLSX.utils.json_to_sheet(feuille.lignes);
    XLSX.utils.book_append_sheet(classeur, feuilleCalcul, feuille.nom.slice(0, 31));
  }

  XLSX.writeFile(classeur, nomFichier);
}
