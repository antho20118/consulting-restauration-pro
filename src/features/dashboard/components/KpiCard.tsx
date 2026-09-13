type Props = {
  label: string;
  value: string;
  hint?: string;
};

export default function KpiCard({ label, value, hint }: Props) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 10,
        padding: 20,
        flex: 1,
        minWidth: 180,
        boxShadow: "0 1px 3px rgba(0,0,0,.08)",
      }}
    >
      <div style={{ color: "#52514e", fontSize: 14, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: "#0b0b0b" }}>{value}</div>
      {hint && <div style={{ color: "#898781", fontSize: 13, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
