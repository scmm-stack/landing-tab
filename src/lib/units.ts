/**
 * Settings hold plain numbers, which are pixels at the browser's default text size.
 * Drawing them in rem makes them grow along with the text if someone enlarges it.
 */
const DEFAULT_ROOT_PX = 16;

export const rem = (px: number): string => `${px / DEFAULT_ROOT_PX}rem`;

/** The same size for reading: rounded, as a slider shows it. */
export const remLabel = (px: number): string => `${Number((px / DEFAULT_ROOT_PX).toFixed(2))}rem`;
