/** White or near-black, whichever reads better on a hex colour (WCAG contrast); other formats are left to CSS. */
export function readableOn(color: string): string | null {
  const luminance = (hex: string) => {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const channel = parseInt(full.slice(i, i + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return null;
  const background = luminance(hex);
  const onWhite = 1.05 / (background + 0.05);
  const onDark = (background + 0.05) / (luminance("141414") + 0.05);
  return onWhite >= onDark ? "#ffffff" : "#141414";
}

function rgb(color: string): [number, number, number] | null {
  try {
    const context = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) return null;
    const first = "#010203";
    const second = "#fefdfc";
    context.fillStyle = first;
    context.fillStyle = color;
    const parsedFirst = context.fillStyle;
    context.fillStyle = second;
    context.fillStyle = color;
    const parsedSecond = context.fillStyle;
    if (parsedFirst === first && parsedSecond === second) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    if (alpha !== 255) return null;
    return [red!, green!, blue!];
  } catch {
    return null;
  }
}

function luminance([red, green, blue]: [number, number, number]) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

const warned = new Set<string>();

/** Warns once when a configured primary color has insufficient text contrast. */
export function warnIfLowContrast(element: HTMLElement, component: string) {
  const styles = getComputedStyle(element);
  const background = rgb(styles.getPropertyValue("--ck-color-primary").trim());
  const foreground = rgb(
    styles.getPropertyValue("--ck-color-on-primary").trim(),
  );
  if (!background || !foreground) return;
  const light = luminance(background);
  const dark = luminance(foreground);
  const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  if (ratio >= 4.5) return;
  const key = `${component}:${Math.round(ratio * 100) / 100}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[Cheerkit] ${component}: text on the primary color has a contrast ratio below 4.5:1. Adjust --ck-color-primary or --ck-color-on-primary to improve readability.`,
  );
}
