// Lecture d'un fichier Excel/CSV envoyé par un fournisseur : renvoie les en-têtes et les lignes
// brutes (tableaux de cellules), pour permettre à l'utilisateur de faire correspondre les
// colonnes avant l'import. Chargement de xlsx en lazy loading pour ne pas alourdir le bundle
// principal (même logique que l'export, voir exportExcel.ts).

export type FichierImporte = {
  entetes: string[];
  lignes: string[][];
};

export async function lireFichierImport(fichier: File): Promise<FichierImporte> {
  const XLSX = await import("xlsx");

  const donnees = await fichier.arrayBuffer();
  const classeur = XLSX.read(donnees, { type: "array" });
  const feuille = classeur.Sheets[classeur.SheetNames[0]];
  const lignes: string[][] = XLSX.utils.sheet_to_json(feuille, { header: 1, defval: "" });

  if (lignes.length < 2) {
    throw new Error("Le fichier semble vide.");
  }

  const [entete, ...reste] = lignes;

  return {
    entetes: entete.map((h) => String(h)),
    lignes: reste.filter((ligne) => ligne.some((cellule) => String(cellule).trim() !== "")),
  };
}
