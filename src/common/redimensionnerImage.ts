// Redimensionne une image côté client avant de l'envoyer au serveur (stockée en base64 en base,
// sans dépendre d'un stockage de fichiers externe ni d'un disque persistant en production) : une
// photo de plat prise au téléphone peut peser plusieurs Mo, largement inutile pour un aperçu.
export function redimensionnerImage(fichier: File, largeurMax = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();

    lecteur.onload = () => {
      const image = new Image();

      image.onload = () => {
        const ratio = Math.min(1, largeurMax / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = image.width * ratio;
        canvas.height = image.height * ratio;

        const contexte = canvas.getContext("2d");
        if (!contexte) {
          reject(new Error("Impossible de traiter l'image"));
          return;
        }

        contexte.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };

      image.onerror = () => reject(new Error("Impossible de lire cette image"));
      image.src = lecteur.result as string;
    };

    lecteur.onerror = () => reject(new Error("Impossible de lire ce fichier"));
    lecteur.readAsDataURL(fichier);
  });
}
