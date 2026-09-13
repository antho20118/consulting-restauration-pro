import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { Fournisseur } from "../types/fournisseur";

type Props = {
  fournisseurs: Fournisseur[];
  onEdit: (fournisseur: Fournisseur) => void;
  onDelete: (fournisseur: Fournisseur) => void;
};

export default function FournisseursTable({ fournisseurs, onEdit, onDelete }: Props) {
  const columns: GridColDef<Fournisseur>[] = [
    {
      field: "nom",
      headerName: "Nom",
      flex: 1,
    },
    {
      field: "telephone",
      headerName: "Téléphone",
      width: 140,
      valueGetter: (_value, row) => row.telephone ?? "",
    },
    {
      field: "email",
      headerName: "Email",
      flex: 1,
      valueGetter: (_value, row) => row.email ?? "",
    },
    {
      field: "siteWeb",
      headerName: "Site web",
      flex: 1,
      valueGetter: (_value, row) => row.siteWeb ?? "",
    },
    {
      field: "tarifs",
      headerName: "Tarifs liés",
      width: 110,
      valueGetter: (_value, row) => row._count?.tarifs ?? 0,
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
        rows={fournisseurs}
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
