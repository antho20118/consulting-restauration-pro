import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { Recette } from "../types/recette";

type Props = {
  recettes: Recette[];
  onView: (recette: Recette) => void;
  onEdit: (recette: Recette) => void;
  onDelete: (recette: Recette) => void;
};

export default function RecettesTable({ recettes, onView, onEdit, onDelete }: Props) {
  const columns: GridColDef<Recette>[] = [
    {
      field: "nom",
      headerName: "Nom",
      flex: 2,
    },
    {
      field: "categorie",
      headerName: "Catégorie",
      flex: 1,
      valueGetter: (_value, row) => row.categorie?.nom ?? "",
    },
    {
      field: "portions",
      headerName: "Portions",
      width: 100,
    },
    {
      field: "coutParPortion",
      headerName: "Coût / portion",
      width: 140,
      valueFormatter: (value) => `${Number(value).toFixed(2)} €`,
    },
    {
      field: "prixVenteHT",
      headerName: "Prix de vente HT",
      width: 150,
      valueFormatter: (value) => (value != null ? `${Number(value).toFixed(2)} €` : "—"),
    },
    {
      field: "foodCostPct",
      headerName: "Food cost",
      width: 110,
      valueFormatter: (value) => (value != null ? `${Number(value).toFixed(1)} %` : "—"),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 220,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-table" onClick={() => onView(params.row)}>Fiche</button>
          <button className="btn-table" onClick={() => onEdit(params.row)}>Modifier</button>
          <button className="btn-table btn-danger" onClick={() => onDelete(params.row)}>Supprimer</button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ height: 600, width: "100%" }}>
      <DataGrid
        rows={recettes}
        columns={columns}
        pageSizeOptions={[10, 25, 50]}
        initialState={{
          pagination: {
            paginationModel: {
              pageSize: 25,
            },
          },
        }}
      />
    </div>
  );
}
