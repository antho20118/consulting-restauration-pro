import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { Ingredient } from "../types/ingredient";

type Props = {
  ingredients: Ingredient[];
  onEdit: (ingredient: Ingredient) => void;
  onDelete: (ingredient: Ingredient) => void;
};

export default function IngredientsTable({ ingredients, onEdit, onDelete }: Props) {
  const columns: GridColDef<Ingredient>[] = [
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
      field: "unite",
      headerName: "Unité",
      width: 120,
      valueGetter: (_value, row) =>
        row.tarifs?.[0]?.unite?.symbole ?? "",
    },

    {
      field: "fournisseur",
      headerName: "Fournisseur",
      flex: 1,
      valueGetter: (_value, row) =>
        row.tarifs?.[0]?.fournisseur?.nom ?? "",
    },

    {
      field: "prix",
      headerName: "Prix HT",
      width: 120,
      valueGetter: (_value, row) =>
        row.tarifs?.[0]?.prixHT ?? 0,

      valueFormatter: (value) =>
        `${Number(value).toFixed(2)} €`,
    },

    {
      field: "stock",
      headerName: "Stock",
      width: 120,
      valueGetter: (_value, row) =>
        row.stocks?.[0]?.quantite ?? 0,
    },

    {
      field: "allergenes",
      headerName: "Allergènes",
      flex: 1,
      valueGetter: (_value, row) => row.allergenes.map((a) => a.allergene.nom).join(", "),
    },

    {
      field: "actions",
      headerName: "Actions",
      width: 160,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onEdit(params.row)}>Modifier</button>
          <button onClick={() => onDelete(params.row)}>Supprimer</button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ height: 600, width: "100%" }}>
      <DataGrid
        rows={ingredients}
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