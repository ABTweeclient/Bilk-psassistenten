/** 7900 öre -> "79", 7950 -> "79,50". Priset sätts i ören på servern. */
export function formatPriceOre(ore: number): string {
  if (!Number.isFinite(ore) || ore <= 0) return "";
  const kronor = ore / 100;
  return ore % 100 === 0
    ? String(Math.round(kronor))
    : kronor.toFixed(2).replace(".", ",");
}
