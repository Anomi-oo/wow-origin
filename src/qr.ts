import QRCode from 'qrcode';

/** Render without Canvas so the same implementation works in Node and Workers. */
export function qrCodeDataUrl(value: string, margin = 1): string {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const viewBoxSize = size + margin * 2;
  const paths: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (qr.modules.get(row, column)) paths.push(`M${column + margin} ${row + margin}h1v1h-1z`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${viewBoxSize}v${viewBoxSize}H0z"/><path fill="#000" d="${paths.join('')}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
