import * as XLSX from "xlsx";

type Feuille = {
  nom: string;
  lignes: Record<string, string | number>[];
};

// Génère un classeur .xlsx (une feuille par entrée de `feuilles`) et déclenche son téléchargement.
export function exporterExcel(nomFichier: string, feuilles: Feuille[]) {
  const classeur = XLSX.utils.book_new();

  for (const feuille of feuilles) {
    const feuilleCalcul = XLSX.utils.json_to_sheet(feuille.lignes);
    XLSX.utils.book_append_sheet(classeur, feuilleCalcul, feuille.nom.slice(0, 31));
  }

  XLSX.writeFile(classeur, nomFichier);
}
