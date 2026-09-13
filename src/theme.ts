import { createTheme } from "@mui/material/styles";

// Sans thème personnalisé, les DataGrid (utilisées pour presque toutes les listes de l'appli)
// s'affichent avec la palette bleue par défaut de MUI, en décalage avec le reste de l'interface
// (bouton, sidebar, écran de connexion) qui utilise le vert/teal comme couleur de marque.
const theme = createTheme({
  palette: {
    primary: {
      main: "#16a085",
      dark: "#128f76",
    },
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
});

export default theme;
