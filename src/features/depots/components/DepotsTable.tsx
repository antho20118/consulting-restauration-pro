import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import type { Depot } from "../types/depot";

type Props = {
  depots: Depot[];
  onEdit: (depot: Depot) => void;
  onDelete: (depot: Depot) => void;
};

export default function DepotsTable({ depots, onEdit, onDelete }: Props) {
  const columns: GridColDef<Depot>[] = [
    {
      field: "nom",
      headerName: "Nom",
      flex: 1,
    },
    {
      field: "description",
      headerName: "Description",
      flex: 2,
      valueGetter: (_value, row) => row.description ?? "",
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
        rows={depots}
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
