// Browser-only helper: turn a user-picked image File into a 512x512 PNG
// (base64, no data: prefix) suitable for POSTing to /api/captain-team-logo.
//
// Fills the square with the image's own top-left color, then centers the
// whole image (contain) so nothing is cropped. Runs entirely client-side
// (canvas), so no server image library is needed. Shared by the captain
// portal's Team Logo tab and the admin Teams editor.

const TILE = 512;

export function toSquarePngBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = TILE;
        canvas.height = TILE;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");

        // Sample the top-left pixel for the background fill.
        const probe = document.createElement("canvas");
        probe.width = img.naturalWidth;
        probe.height = img.naturalHeight;
        const pctx = probe.getContext("2d");
        let fill = "#0f1620";
        if (pctx) {
          pctx.drawImage(img, 0, 0);
          const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
          fill = `rgb(${r},${g},${b})`;
        }
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, TILE, TILE);

        // Contain the image, centered.
        const scale = Math.min(
          TILE / img.naturalWidth,
          TILE / img.naturalHeight,
        );
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (TILE - w) / 2, (TILE - h) / 2, w, h);

        const dataUrl = canvas.toDataURL("image/png");
        const comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      } catch (e) {
        reject(e as Error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image file."));
    };
    img.src = objectUrl;
  });
}
