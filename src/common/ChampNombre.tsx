import { useState } from "react";
import type { CSSProperties } from "react";

// Un <input type="number"> refuse la virgule comme séparateur décimal selon la locale du
// navigateur (indépendamment de la langue de la page) : impossible d'y taper "1,5". On utilise
// donc un champ texte qui accepte les deux séparateurs et ne convertit qu'à l'usage.
function parseDecimaleFr(texte: string): number | null {
  const nettoye = texte.trim().replace(",", ".");
  if (nettoye === "" || nettoye === ".") return null;
  const n = parseFloat(nettoye);
  return Number.isFinite(n) ? n : null;
}

function versTexte(v: number): string {
  return String(v).replace(".", ",");
}

type Props = {
  valeur: number;
  onChanger: (n: number | null) => void;
  style?: CSSProperties;
  placeholder?: string;
};

export default function ChampNombre({ valeur, onChanger, style, placeholder }: Props) {
  const [texte, setTexte] = useState(() => versTexte(valeur));
  const [derniereValeur, setDerniereValeur] = useState(valeur);

  // Resynchronise depuis le parent uniquement quand la prop change réellement (et seulement si
  // ce n'est pas déjà ce que la saisie en cours produirait, sinon on effacerait la virgule tapée
  // avant que l'utilisateur ait fini) — ajustement pendant le rendu plutôt que dans un effet.
  if (valeur !== derniereValeur) {
    setDerniereValeur(valeur);
    if (parseDecimaleFr(texte) !== valeur) setTexte(versTexte(valeur));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      style={style}
      placeholder={placeholder}
      value={texte}
      onChange={(e) => {
        const brut = e.target.value;
        if (!/^\d*[.,]?\d*$/.test(brut)) return;
        setTexte(brut);
        onChanger(parseDecimaleFr(brut));
      }}
    />
  );
}
