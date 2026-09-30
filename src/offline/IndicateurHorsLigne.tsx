import { useEnLigne } from "./useEnLigne";
import { useFileAttente } from "./useFileAttente";

// Toujours visible dans le menu (Sidebar.tsx), jamais seulement sur les pages concernées : en
// cuisine, l'utilisateur doit pouvoir constater d'un coup d'œil qu'il est hors ligne avant même
// d'ouvrir une page qui l'exigerait.
export default function IndicateurHorsLigne() {
  const enLigne = useEnLigne();
  const { enAttente } = useFileAttente();

  if (enLigne && enAttente === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: enLigne ? "#3b4447" : "#946200",
        borderRadius: 8,
        padding: "8px 12px",
        marginBottom: 16,
        fontSize: 13,
      }}
    >
      {!enLigne && <span>📡 Hors ligne</span>}
      {enAttente > 0 && (
        <span>
          {enAttente} action{enAttente > 1 ? "s" : ""} en attente de synchronisation
        </span>
      )}
    </div>
  );
}
