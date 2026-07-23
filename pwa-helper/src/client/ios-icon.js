function ensureHeadLink(rel, selector = `link[rel="${rel}"]`) {
  let link = document.head?.querySelector(selector);
  if (!(link instanceof HTMLLinkElement)) {
    link = document.createElement("link");
    link.rel = rel;
    document.head?.appendChild(link);
  }
  return link;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${src}`));
    image.src = src;
  });
}

async function createIosTouchIconUrl() {
  const image = await loadImage(IOS_ICON_SOURCE);
  const canvas = document.createElement("canvas");
  canvas.width = IOS_ICON_SIZE;
  canvas.height = IOS_ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");

  const gradient = context.createLinearGradient(0, 0, IOS_ICON_SIZE, IOS_ICON_SIZE);
  gradient.addColorStop(0, IOS_ICON_GRADIENT[0]);
  gradient.addColorStop(0.52, IOS_ICON_GRADIENT[1]);
  gradient.addColorStop(1, IOS_ICON_GRADIENT[2]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, IOS_ICON_SIZE, IOS_ICON_SIZE);

  const iconSize = IOS_ICON_SIZE - IOS_ICON_PADDING * 2;
  const logoCanvas = document.createElement("canvas");
  logoCanvas.width = IOS_ICON_SIZE;
  logoCanvas.height = IOS_ICON_SIZE;
  const logoContext = logoCanvas.getContext("2d");
  if (!logoContext) throw new Error("Canvas 2D context is unavailable.");

  logoContext.drawImage(image, IOS_ICON_PADDING, IOS_ICON_PADDING, iconSize, iconSize);
  logoContext.globalCompositeOperation = "source-in";
  logoContext.fillStyle = IOS_ICON_LOGO_FILL;
  logoContext.fillRect(IOS_ICON_PADDING, IOS_ICON_PADDING, iconSize, iconSize);
  context.drawImage(logoCanvas, 0, 0);

  return canvas.toDataURL("image/png");
}

function createIosIconInstaller({ setIosIconStatus, log, warn }) {
  async function install() {
    try {
      const url = await createIosTouchIconUrl();
      const link = ensureHeadLink("apple-touch-icon");
      link.href = url;
      link.sizes = `${IOS_ICON_SIZE}x${IOS_ICON_SIZE}`;
      link.type = "image/png";
      setIosIconStatus("active");
      log("installed iOS touch icon override");
    } catch (error) {
      setIosIconStatus("error");
      warn("failed to install iOS touch icon override", error);
    }
  }

  return { install };
}
