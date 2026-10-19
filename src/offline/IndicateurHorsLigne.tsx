import { Link } from "react-router-dom";
import { useEnLigne } from "./useEnLigne";
import { useFileAttente } from "./useFileAttente";

// Toujours visible dans le menu (Sidebar.tsx), jamais seulement sur les pages concernées : en
// cuisine, l'utilisateur doit pouvoir constater d'un coup d'œil qu'il est hors ligne avant même
// d'ouvrir une page qui l'exigerait. Les saisies en attente ouvrent leur écran de suivi (motif d'un
// refus, abandon — voir SaisiesEnAttentePage), une saisie refusée y étant signalée en rouge.
export default function IndicateurHorsLigne({ onOuvrir }: { onOuvrir?: () => void }) {
  const enLigne = useEnLigne();
  const { enAttente, refusees } = useFileAttente();

  if (enLigne && enAttente === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: refusees > 0 ? "#8c1d18" : enLigne ? "#3b4447" : "#946200",
        borderRadius: 8,
        padding: "8px 12px",
        marginBottom: 16,
        fontSize: 13,
      }}
    >
      {!enLigne && <span>📡 Hors ligne</span>}
      {enAttente > 0 && (
        <Link to="/saisies-en-attente" onClick={onOuvrir} style={{ color: "white" }}>
          {enAttente} action{enAttente > 1 ? "s" : ""} en attente de synchronisation
          {refusees > 0 && ` — dont ${refusees} refusée${refusees > 1 ? "s" : ""}, à vérifier`}
        </Link>
      )}
    </div>
  );
}
