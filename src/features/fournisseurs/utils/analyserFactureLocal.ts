import { analyserListingLocal } from "../../ingredients/utils/analyseListingLocal";
import type { LigneListingExtraite } from "../../ingredients/services/listingFournisseurService";

// Repli local (sans IA) pour une facture, même principe et mêmes limites qu'analyseListingLocal.ts
// (Phase 4) : analyse par règles simples du texte lu par OCR, nettement moins fiable qu'une
// extraction par vision IA — l'utilisateur en est informé par le composant appelant. Ne devine
// jamais un numéro/une date/un montant absent ou non reconnu : renvoie null plutôt que d'inventer,
// exactement comme le fait extraireFacturePhoto côté IA. Les lignes de produits sont reconnues par
// le même analyseur que le listing (une ligne de facture se termine généralement par un prix, tout
// comme une ligne de listing) : réutilisé tel quel, jamais dupliqué.
export type ExtractionFactureLocale = {
  numero: string | null;
  dateDocument: string | null;
  montantTotal: number | null;
  lignes: LigneListingExtraite[];
};

const RE_NUMERO = /\b(?:facture\s*)?(?:n°|n(?=\s*[:°])|num[ée]ro|no(?=[.:°]|\s*\d))\s*[:°-]?\s*([A-Z0-9][A-Z0-9-/]{2,})/i;
const RE_DATE = /(\d{2})[/.-](\d{2})[/.-](\d{4})/;
const RE_MONTANT_TOTAL = /total\s*(?:ttc|ht)?\s*[:-]?\s*(\d+[.,]\d{2})/i;

export function analyserFactureLocal(texte: string): ExtractionFactureLocale {
  const correspondanceNumero = RE_NUMERO.exec(texte);
  const numero = correspondanceNumero ? correspondanceNumero[1] : null;

  const correspondanceDate = RE_DATE.exec(texte);
  const dateDocument = correspondanceDate
    ? `${correspondanceDate[3]}-${correspondanceDate[2]}-${correspondanceDate[1]}`
    : null;

  const correspondanceMontant = RE_MONTANT_TOTAL.exec(texte);
  const montantTotal = correspondanceMontant ? Number(correspondanceMontant[1].replace(",", ".")) : null;

  // Une ligne "Total (TTC/HT) : 123,45" se termine elle aussi par un nombre décimal et serait sinon
  // reconnue à tort comme une ligne de produit par analyserListingLocal (conçu pour un listing, où
  // ce cas ne se présente pas) : exclue avant l'analyse des lignes, jamais du texte utilisé pour
  // reconnaître le montant total lui-même ci-dessus.
  const texteSansLigneTotal = texte
    .split(/\r?\n/)
    .filter((ligne) => !/total/i.test(ligne))
    .join("\n");

  return { numero, dateDocument, montantTotal, lignes: analyserListingLocal(texteSansLigneTotal) };
}
