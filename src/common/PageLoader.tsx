export default function PageLoader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 300,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: "3px solid var(--couleur-bordure)",
          borderTopColor: "var(--couleur-primaire)",
          borderRadius: "50%",
          animation: "tourner 0.7s linear infinite",
        }}
      />
      <style>{`
        @keyframes tourner {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
